const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#121417',
    title: 'RateCAD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    if (process.env.RATECAD_DEBUG === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(action) {
  mainWindow?.webContents.send('menu:action', action);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Drawing',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('saveAs'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send('redo'),
        },
        { type: 'separator' },
        {
          label: 'Delete',
          accelerator: 'Delete',
          click: () => send('delete'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const FILTERS = [
  { name: 'RateCAD Drawing', extensions: ['ratecad'] },
  { name: 'All Files', extensions: ['*'] },
];

ipcMain.handle('dialog:openRatecad', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Open RateCAD Drawing',
    filters: FILTERS,
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return { canceled: false, filePath, contents };
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Failed to read file',
    };
  }
});

ipcMain.handle('dialog:saveRatecad', async (_event, payload) => {
  const { contents, defaultPath, forceDialog } = payload ?? {};
  let filePath = payload?.filePath;

  if (forceDialog || !filePath) {
    const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: 'Save RateCAD Drawing',
      defaultPath: defaultPath || 'Untitled.ratecad',
      filters: FILTERS,
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    filePath = result.filePath.endsWith('.ratecad')
      ? result.filePath
      : `${result.filePath}.ratecad`;
  }

  try {
    await fs.writeFile(filePath, contents, 'utf8');
    return { canceled: false, filePath };
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Failed to write file',
    };
  }
});

ipcMain.handle('dialog:confirmDiscard', async (_event, message) => {
  const result = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'question',
    buttons: ['Cancel', 'Discard'],
    defaultId: 0,
    cancelId: 0,
    title: 'Unsaved changes',
    message: message || 'Discard unsaved changes?',
  });
  return result.response === 1;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
