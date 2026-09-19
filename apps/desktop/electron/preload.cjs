const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ratecadDesktop', {
  platform: process.platform,
  onMenuAction: (handler) => {
    const channels = ['menu:new', 'menu:undo', 'menu:redo', 'menu:delete'];
    const listeners = channels.map((channel) => {
      const listener = () => handler(channel.replace('menu:', ''));
      ipcRenderer.on(channel, listener);
      return { channel, listener };
    });
    return () => {
      for (const { channel, listener } of listeners) {
        ipcRenderer.removeListener(channel, listener);
      }
    };
  },
});
