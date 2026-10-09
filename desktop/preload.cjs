'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const on = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
// Small, explicit APIs only. No Node, filesystem, shell, or raw IPC in renderers.
contextBridge.exposeInMainWorld('NotchDesktop', Object.freeze({
  publish: snapshot => ipcRenderer.send('notch:publish', snapshot),
  action: action => ipcRenderer.send('notch:action', action),
  region: rectangle => ipcRenderer.send('notch:region', rectangle),
  drop: payload => ipcRenderer.invoke('notch:drop', payload),
  showDashboard: () => ipcRenderer.send('notch:show-dashboard'),
  menu: () => ipcRenderer.send('notch:menu'),
  ready: () => ipcRenderer.send('notch:ready'),
  spotify: (action, position) => ipcRenderer.invoke('notch:spotify', { action, position }),
  onSnapshot: callback => on('notch:snapshot', callback),
  onAction: callback => on('notch:perform', callback),
  onDrop: callback => on('notch:receive-drop', callback),
  onPointer: callback => on('notch:pointer', callback),
  onRefresh: callback => on('notch:refresh', callback)
}));
