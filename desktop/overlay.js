(() => {
  'use strict';
  const bridge = window.NotchDesktop, notch = document.getElementById('notch');
  if (!bridge) return;
  let previousHTML = '', pressed = false, queuedSnapshot = null, dragging = false, errorTimer;
  function reportRegion() {
    const r = notch.getBoundingClientRect();
    bridge.region({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  function render(data) {
    if (pressed) { queuedSnapshot = data; return; }
    notch.dataset.state = data.state;
    notch.className = data.classes;
    document.body.classList.toggle('music-playing', data.playing);
    if (data.html !== previousHTML) {
      // HTML comes only from the app's own safe-text DOM, never from peer packet HTML.
      const template = document.createElement('template'); template.innerHTML = data.html;
      template.content.querySelectorAll('script,iframe,object,embed,link,style').forEach(node => node.remove());
      for (const node of template.content.querySelectorAll('*')) for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || ['srcdoc','href','src'].includes(attr.name)) node.removeAttribute(attr.name);
      }
      notch.replaceChildren(template.content); previousHTML = data.html;
    }
    for (const value of data.forms) {
      if (!/^d\d+$/.test(value.id)) continue;
      const input = notch.querySelector(`[data-desktop-action="${value.id}"]`);
      if (!input) continue;
      if (value.value !== undefined) input.value = value.value;
      if (value.checked !== undefined) input.checked = value.checked;
    }
    reportRegion();
  }
  bridge.onSnapshot(render);
  bridge.onPointer(over => { if (!dragging) bridge.action({ kind: over ? 'hover' : 'leave' }); });
  notch.addEventListener('mouseenter', () => { if (!dragging) bridge.action({ kind: 'hover' }); });
  notch.addEventListener('mouseleave', () => { if (!dragging) bridge.action({ kind: 'leave' }); });
  const observer = new ResizeObserver(reportRegion); observer.observe(notch);
  notch.addEventListener('click', event => {
    const control = event.target.closest('button[data-desktop-action]');
    if (!control) return;
    event.preventDefault(); bridge.action({ kind: 'click', id: control.dataset.desktopAction });
  });
  for (const kind of ['input', 'change']) notch.addEventListener(kind, event => {
    const input = event.target.closest('input[data-desktop-action]');
    if (input) bridge.action({ kind, id: input.dataset.desktopAction, value: input.value, checked: input.checked });
  });
  notch.addEventListener('pointerdown', event => { if (event.target.closest('button,input')) pressed = true; });
  function releaseControl() {
    // Wait until the click/change dispatch finishes before replacing its DOM node.
    setTimeout(() => { pressed = false; if (queuedSnapshot) { const next = queuedSnapshot; queuedSnapshot = null; render(next); } }, 0);
  }
  window.addEventListener('pointerup', releaseControl);
  window.addEventListener('pointercancel', releaseControl);
  window.addEventListener('blur', releaseControl);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') bridge.action({ kind: 'escape' }); });
  window.addEventListener('contextmenu', event => { event.preventDefault(); bridge.menu(); });
  const isDrop = event => event.dataTransfer && [...event.dataTransfer.types].some(type => ['Files','text/plain','text/uri-list'].includes(type));
  document.addEventListener('dragover', event => { if (!isDrop(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (!dragging) { dragging = true; bridge.action({ kind: 'drag' }); } });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) { dragging = false; bridge.action({ kind: 'dragend' }); } });
  document.addEventListener('drop', async event => {
    if (!isDrop(event)) return;
    event.preventDefault(); dragging = false;
    try {
      const files = [...event.dataTransfer.files]; let payload;
      if (files.length) {
        if (files.length > 16 || files.some(f => f.size > 100 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 200 * 1024 * 1024) throw new Error('Drop up to 16 files, at most 100 MB each and 200 MB total.');
        payload = { files: await Promise.all(files.map(async file => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))) };
      } else payload = { text: event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list') };
      const result = await bridge.drop(payload);
      if (result?.error) throw new Error(result.error);
    } catch (error) {
      const message = document.getElementById('drop-error'); message.textContent = error.message; message.hidden = false;
      clearTimeout(errorTimer); errorTimer = setTimeout(() => { message.hidden = true; }, 5000);
    } finally { bridge.action({ kind: 'dragend' }); }
  });
  bridge.ready();
})();
