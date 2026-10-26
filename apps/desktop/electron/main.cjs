const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** When true, the next close event proceeds without asking the renderer. */
let shutdownAuthorized = false;

/**
 * In-flight exit handshake with the renderer.
 * Missing / late / mismatched replies never authorize close.
 * @type {{ requestId: number } | null}
 */
let exitHandshake = null;
let exitRequestSeq = 0;

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

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
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

  mainWindow.on('close', (event) => {
    if (shutdownAuthorized) {
      return;
    }
    // Always prevent until the renderer explicitly approves.
    event.preventDefault();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (exitHandshake) {
      // Duplicate close (X / Alt+F4 / quit) while preparing — ignore.
      return;
    }
    if (mainWindow.webContents.isDestroyed() || mainWindow.webContents.isCrashed()) {
      // Renderer unavailable — do NOT treat as approval.
      console.warn('[exit] renderer unavailable; refusing to close');
      return;
    }

    exitRequestSeq += 1;
    const requestId = exitRequestSeq;
    exitHandshake = { requestId };
    try {
      mainWindow.webContents.send('app:prepare-exit', { requestId });
    } catch (err) {
      console.warn('[exit] failed to send prepare-exit', err);
      exitHandshake = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    exitHandshake = null;
    shutdownAuthorized = false;
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

ipcMain.handle('dialog:saveRatecad', async (_event, payload) => {
  const { contents, defaultPath, forceDialog } = payload ?? {};
  let filePath = payload?.filePath;

  const writeTo = async (target) => {
    await fs.writeFile(target, contents, 'utf8');
    return { canceled: false, filePath: target };
  };

  if (forceDialog || !filePath) {
    try {
      const result = await Promise.race([
        dialog.showSaveDialog(mainWindow ?? undefined, {
          title: 'Save RateCAD Drawing',
          defaultPath: defaultPath || 'Untitled.ratecad',
          filters: FILTERS,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('dialog-timeout')), 2500),
        ),
      ]);
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      filePath = result.filePath.endsWith('.ratecad')
        ? result.filePath
        : `${result.filePath}.ratecad`;
      return writeTo(filePath);
    } catch {
      const fallbackDir = app.getPath('documents');
      const name = defaultPath || `Untitled-${Date.now()}.ratecad`;
      filePath = path.join(fallbackDir, name.endsWith('.ratecad') ? name : `${name}.ratecad`);
      return writeTo(filePath);
    }
  }

  try {
    return writeTo(filePath);
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Failed to write file',
    };
  }
});

ipcMain.handle('dialog:openRatecad', async () => {
  try {
    const result = await Promise.race([
      dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Open RateCAD Drawing',
        filters: FILTERS,
        properties: ['openFile'],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('dialog-timeout')), 2500),
      ),
    ]);
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const contents = await fs.readFile(filePath, 'utf8');
    return { canceled: false, filePath, contents };
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Failed to open file',
    };
  }
});

ipcMain.handle('fs:quickSaveRatecad', async (_event, payload) => {
  const { contents, preferredName } = payload ?? {};
  try {
    const dir = app.getPath('documents');
    const name = (preferredName || `Drawing-${Date.now()}`).replace(/\.ratecad$/i, '');
    const filePath = path.join(dir, `${name}.ratecad`);
    await fs.writeFile(filePath, contents, 'utf8');
    return { canceled: false, filePath };
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Quick save failed',
    };
  }
});

ipcMain.handle('fs:openRatecadPath', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { canceled: false, error: 'Missing file path' };
  }
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return { canceled: false, filePath, contents };
  } catch (err) {
    return {
      canceled: false,
      error: err instanceof Error ? err.message : 'Failed to open file',
    };
  }
});

/**
 * Renderer finished exit preparation for a window-close handshake.
 * Stale requestIds are ignored. Missing approval never closes.
 */
ipcMain.handle('app:exit-response', (_event, payload) => {
  const requestId = payload?.requestId;
  const status = payload?.status;
  if (
    typeof requestId !== 'number' ||
    !exitHandshake ||
    exitHandshake.requestId !== requestId
  ) {
    return { ok: false, ignored: true };
  }

  exitHandshake = null;

  if (status === 'approved') {
    shutdownAuthorized = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return { ok: true, closed: true };
  }

  // canceled | failed | anything else → keep window open
  shutdownAuthorized = false;
  return { ok: true, closed: false };
});

/**
 * Called by renderer Application Menu Exit AFTER preparation already succeeded.
 * Does not ask the renderer again — authorizes the final close only.
 * Uses window.close() (guarded) rather than an unguarded destroy().
 */
ipcMain.handle('app:quit', () => {
  shutdownAuthorized = true;
  exitHandshake = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  } else {
    app.quit();
  }
  return { ok: true };
});

/**
 * Belt-and-suspenders: app.quit() / menu role:quit / OS quit must not
 * terminate while unsaved drawings are unresolved. Cancel the quit wave
 * and route through the window close handshake unless already authorized.
 */
app.on('before-quit', (event) => {
  if (shutdownAuthorized) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  if (exitHandshake) return;
  // Trigger the same prepare-exit path as the window X button.
  try {
    mainWindow.close();
  } catch (err) {
    console.warn('[exit] before-quit could not request window close', err);
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Windows already closed through the guarded path (or never created).
    shutdownAuthorized = true;
    app.quit();
  }
});
