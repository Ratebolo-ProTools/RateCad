const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ratecadDesktop', {
  platform: process.platform,
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  /** P3-B4B2B — main asks renderer to prepare safe exit (window X / OS quit). */
  onPrepareExit: (handler) => {
    const listener = (_event, payload) => {
      if (!payload || typeof payload.requestId !== 'number') return;
      handler(payload.requestId);
    };
    ipcRenderer.on('app:prepare-exit', listener);
    return () => ipcRenderer.removeListener('app:prepare-exit', listener);
  },
  respondExitPreparation: (payload) =>
    ipcRenderer.invoke('app:exit-response', payload),
  openDrawing: () => ipcRenderer.invoke('dialog:openRatecad'),
  openDrawingPath: (filePath) =>
    ipcRenderer.invoke('fs:openRatecadPath', filePath),
  saveDrawing: (payload) => ipcRenderer.invoke('dialog:saveRatecad', payload),
  quickSave: (payload) => ipcRenderer.invoke('fs:quickSaveRatecad', payload),
  /** After renderer preparation succeeds — authorize process quit. */
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
