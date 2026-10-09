(() => {
  'use strict';
  const bridge = window.NotchDesktop;
  if (!bridge) return;
  document.body.classList.add('desktop-dashboard');
  const notch = document.getElementById('notch');
  const identities = new WeakMap(); let count = 0, scheduled = false;
  function publish() {
    scheduled = false;
    if (!window.NotchDrop) return;
    const forms = [];
    for (const control of notch.querySelectorAll('button,input')) {
      if (!identities.has(control)) identities.set(control, `d${++count}`);
      control.dataset.desktopAction = identities.get(control);
      if (control.matches('input')) forms.push({ id: control.dataset.desktopAction, value: control.value, checked: control.checked });
    }
    const snapshot = notch.cloneNode(true);
    // Progress values travel separately; changing them must not replace controls
    // underneath the mouse while the user is clicking or scrubbing.
    snapshot.querySelectorAll('input[type=range]').forEach(input => { input.removeAttribute('style'); input.removeAttribute('aria-valuetext'); });
    bridge.publish({ html: snapshot.innerHTML, classes: notch.className, state: notch.dataset.state, enabled: NotchDrop.getSettings().notch, playing: document.body.classList.contains('music-playing'), forms });
  }
  const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(publish, 80); } };
  // Attribute tagging is excluded to avoid observer feedback loops.
  new MutationObserver(records => { if (records.some(r => r.type !== 'attributes' || r.attributeName !== 'data-desktop-action')) schedule(); }).observe(notch, { childList: true, subtree: true, characterData: true, attributes: true });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  bridge.onRefresh(publish);
  bridge.onAction(action => {
    if (action.kind === 'spotify-connect') document.getElementById('spotify-desktop-connect')?.click();
    else if (action.kind === 'hover') notch.dispatchEvent(new MouseEvent('mouseenter'));
    else if (action.kind === 'leave') notch.dispatchEvent(new MouseEvent('mouseleave'));
    else if (action.kind === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (action.kind === 'drag') { const data = new DataTransfer(); data.items.add(new File([''], 'pending')); document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true })); }
    else if (action.kind === 'dragend') document.dispatchEvent(new Event('dragend'));
    else {
      const control = notch.querySelector(`[data-desktop-action="${action.id}"]`);
      if (!control || control.disabled) return;
      if (action.kind === 'click') control.click();
      else if (control.matches('input')) { control.value = action.value; control.checked = !!action.checked; control.dispatchEvent(new Event(action.kind, { bubbles: true })); }
    }
    publish();
  });
  bridge.onDrop(payload => {
    const data = new DataTransfer();
    if (payload.files) for (const file of payload.files) data.items.add(new File([file.bytes], file.name, { type: file.type }));
    else data.setData('text/plain', payload.text);
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    publish();
  });
  // Dialogs need the normal command-center window (QR codes, preferences, prank scenes).
  for (const dialog of document.querySelectorAll('dialog')) new MutationObserver(() => { if (dialog.open) bridge.showDashboard(); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  setInterval(publish, 300);
  publish();
})();
