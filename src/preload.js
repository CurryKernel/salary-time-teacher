'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('salary', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  setView: (view) => ipcRenderer.send('window:set-view', view),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  onSettingsUpdated: (callback) => {
    const listener = (event, value) => callback(value);
    ipcRenderer.on('settings:updated', listener);
    return () => ipcRenderer.removeListener('settings:updated', listener);
  },
  onDebugView: (callback) => {
    const listener = (event, value) => callback(value);
    ipcRenderer.on('debug:view', listener);
    return () => ipcRenderer.removeListener('debug:view', listener);
  }
});
