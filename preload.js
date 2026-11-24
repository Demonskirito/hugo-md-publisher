'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mdLocal', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (cfg) => ipcRenderer.invoke('save-settings', cfg),
  saveToken: (token) => ipcRenderer.invoke('save-token', token),
  verifyToken: (token) => ipcRenderer.invoke('verify-token', token),
  listRepos: () => ipcRenderer.invoke('list-repos'),
  inspectLocal: (dir) => ipcRenderer.invoke('inspect-local', dir),
  selectDir: () => ipcRenderer.invoke('select-dir'),
  selectHugo: () => ipcRenderer.invoke('select-hugo'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  analyzeFile: (p) => ipcRenderer.invoke('analyze-file', p),
  publish: (payload) => ipcRenderer.invoke('publish', payload),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onLog: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('publish-log', listener);
    return () => ipcRenderer.removeListener('publish-log', listener);
  }
});
