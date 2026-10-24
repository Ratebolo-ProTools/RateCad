const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ratecadDesktop', {
  platform: process.platform,
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  openDrawing: () => ipcRenderer.invoke('dialog:openRatecad'),
  openDrawingPath: (filePath) =>
    ipcRenderer.invoke('fs:openRatecadPath', filePath),
  saveDrawing: (payload) => ipcRenderer.invoke('dialog:saveRatecad', payload),
  quickSave: (payload) => ipcRenderer.invoke('fs:quickSaveRatecad', payload),
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
