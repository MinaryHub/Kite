import { app, BrowserWindow, dialog, ipcMain, shell, Menu, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let forceClose = false;
const pendingFiles: string[] = [];

const DOC_EXT = /\.(hwp|hwpx|docx|doc|pdf|md|markdown|txt|html?)$/i;

function filesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('-') && DOC_EXT.test(a) && fs.existsSync(a));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (files.length) mainWindow.webContents.send('app:open-files', files);
    }
  });
}

pendingFiles.push(...filesFromArgv(process.argv));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'K-HWP 워드프로세서',
    backgroundColor: '#e9ebee',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  if (isDev) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  // 자가 점검 (KHWP_SMOKE=1): 문서를 연 뒤 상태를 출력하고 종료
  if (process.env.KHWP_SMOKE) {
    mainWindow.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await mainWindow!.webContents.executeJavaScript(
            `(() => { const d = [...document.querySelectorAll('.doc-tab .dt-title')].map(e => e.textContent); return JSON.stringify({ tabs: d, pages: document.querySelectorAll('.workspace:not(.hidden-doc) .paper').length, title: document.title, hasApi: !!window.khwp }); })()`,
          );
          fs.writeFileSync(process.env.KHWP_SMOKE!, 'SMOKE ' + r);
        } catch (e) {
          fs.writeFileSync(process.env.KHWP_SMOKE!, 'SMOKE-ERR ' + String(e));
        }
        forceClose = true;
        app.exit(0);
      }, 8000);
    });
  }
  mainWindow.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    mainWindow?.webContents.send('app:request-close');
  });
  mainWindow.on('closed', () => (mainWindow = null));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow?.webContents.toggleDevTools();
  });
  try {
    session.defaultSession.setSpellCheckerLanguages(['en-US']);
  } catch {
    /* 무시 */
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------- 파일 ----------------
const userData = () => app.getPath('userData');

ipcMain.handle('app:initial-files', () => {
  const f = [...pendingFiles];
  pendingFiles.length = 0;
  return f;
});

ipcMain.handle('file:open-dialog', async (_e, filters) => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: '불러오기',
    properties: ['openFile', 'multiSelections'],
    filters,
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle('file:read', async (_e, p: string) => {
  const buf = await fs.promises.readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

ipcMain.handle('file:save-dialog', async (_e, defaultPath: string, filters) => {
  const res = await dialog.showSaveDialog(mainWindow!, { title: '다른 이름으로 저장', defaultPath, filters });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('file:write', async (_e, p: string, data: Uint8Array) => {
  // 안전한 저장: 임시 파일에 쓴 뒤 교체
  const tmp = p + '.khwp-tmp';
  await fs.promises.writeFile(tmp, Buffer.from(data));
  await fs.promises.rename(tmp, p);
  return true;
});

ipcMain.handle('file:exists', (_e, p: string) => fs.existsSync(p));

ipcMain.handle('file:image-dialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: '그림 넣기',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '그림 파일', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
  });
  if (res.canceled) return [];
  return Promise.all(
    res.filePaths.map(async (p) => {
      const buf = await fs.promises.readFile(p);
      return { name: path.basename(p), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    }),
  );
});

ipcMain.handle('shell:show-item', (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle('shell:open-external', (_e, url: string) => {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
});

// ---------------- 최근 문서 ----------------
const recentPath = () => path.join(userData(), 'recent.json');
function readRecent(): string[] {
  try {
    return JSON.parse(fs.readFileSync(recentPath(), 'utf8')).filter((p: string) => fs.existsSync(p));
  } catch {
    return [];
  }
}
ipcMain.handle('recent:get', () => readRecent());
ipcMain.handle('recent:add', (_e, p: string) => {
  const list = [p, ...readRecent().filter((x) => x !== p)].slice(0, 15);
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(recentPath(), JSON.stringify(list));
  try {
    app.addRecentDocument(p);
  } catch {
    /* 무시 */
  }
  return list;
});
ipcMain.handle('recent:clear', () => {
  try {
    fs.unlinkSync(recentPath());
  } catch {
    /* 무시 */
  }
  return [];
});

// ---------------- 설정 ----------------
const prefsPath = () => path.join(userData(), 'prefs.json');
ipcMain.handle('prefs:get', () => {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
  } catch {
    return {};
  }
});
ipcMain.handle('prefs:set', (_e, prefs) => {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
  try {
    session.defaultSession.setSpellCheckerLanguages(prefs.spellcheck ? ['en-US'] : []);
  } catch {
    /* 무시 */
  }
  return true;
});

// ---------------- 자동 저장 / 복구 ----------------
const autosaveDir = () => path.join(userData(), 'autosave');
ipcMain.handle('autosave:write', async (_e, id: string, json: string) => {
  await fs.promises.mkdir(autosaveDir(), { recursive: true });
  await fs.promises.writeFile(path.join(autosaveDir(), `${id}.json`), json, 'utf8');
  return true;
});
ipcMain.handle('autosave:remove', async (_e, id: string) => {
  try {
    await fs.promises.unlink(path.join(autosaveDir(), `${id}.json`));
  } catch {
    /* 무시 */
  }
  return true;
});
ipcMain.handle('autosave:list', async () => {
  try {
    const files = await fs.promises.readdir(autosaveDir());
    const out: { id: string; json: string; mtime: number }[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(autosaveDir(), f);
      const st = await fs.promises.stat(p);
      out.push({ id: f.replace(/\.json$/, ''), json: await fs.promises.readFile(p, 'utf8'), mtime: st.mtimeMs });
    }
    return out;
  } catch {
    return [];
  }
});

// ---------------- 인쇄 / PDF ----------------
ipcMain.handle('print:pdf', async (_e, opts: { widthMm: number; heightMm: number; defaultPath: string }) => {
  if (!mainWindow) return null;
  const target = await dialog.showSaveDialog(mainWindow, {
    title: 'PDF로 저장',
    defaultPath: opts.defaultPath,
    filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
  });
  if (target.canceled || !target.filePath) return null;
  const data = await mainWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    pageSize: { width: opts.widthMm / 25.4, height: opts.heightMm / 25.4 },
  });
  await fs.promises.writeFile(target.filePath, data);
  return target.filePath;
});

ipcMain.handle('print:print', async (_e, opts: { widthMm: number; heightMm: number; landscape: boolean }) => {
  if (!mainWindow) return false;
  return new Promise((resolve) => {
    mainWindow!.webContents.print(
      {
        silent: false,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) },
      },
      (ok) => resolve(ok),
    );
  });
});

// ---------------- 편집 (붙이기 등) ----------------
ipcMain.handle('edit:paste', () => mainWindow?.webContents.paste());
ipcMain.handle('edit:paste-plain', () => mainWindow?.webContents.pasteAndMatchStyle());

ipcMain.handle('app:set-title', (_e, title: string) => mainWindow?.setTitle(title));
ipcMain.handle('app:close-confirmed', () => {
  forceClose = true;
  mainWindow?.close();
});
ipcMain.handle('app:toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
ipcMain.handle('app:devtools', () => mainWindow?.webContents.toggleDevTools());
ipcMain.handle('app:version', () => app.getVersion());

// ---------------- 시스템 글꼴 목록 ----------------
let fontCache: string[] | null = null;
ipcMain.handle('fonts:list', async () => {
  if (fontCache) return fontCache;
  if (process.platform !== 'win32') return [];
  const script =
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
  fontCache = await new Promise<string[]>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    });
  });
  return fontCache;
});

// ---------------- 구형 DOC 변환 ----------------
ipcMain.handle('doc:convert', async (_e, data: Uint8Array) => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'khwp-'));
  const src = path.join(tmpDir, 'input.doc');
  const dst = path.join(tmpDir, 'output.docx');
  await fs.promises.writeFile(src, Buffer.from(data));
  try {
    // 1) Microsoft Word가 설치되어 있으면 COM 자동화로 DOCX 변환 (서식 유지)
    if (process.platform === 'win32') {
      // 사용자가 이미 Word를 쓰고 있으면 그 인스턴스에 붙을 수 있으므로,
      // 우리가 새로 띄운 경우에만 숨기고 종료한다.
      const ps = `$ErrorActionPreference='Stop'; $running = @(Get-Process WINWORD -ErrorAction SilentlyContinue).Count -gt 0; $w = New-Object -ComObject Word.Application; if (-not $running) { $w.Visible = $false }; $w.DisplayAlerts = 0; try { $d = $w.Documents.Open('${src.replace(/'/g, "''")}', $false, $true, $false); $d.SaveAs2('${dst.replace(/'/g, "''")}', 16); $d.Close($false) } finally { if (-not $running -and $w.Documents.Count -eq 0) { $w.Quit() } }`;
      const ok = await new Promise<boolean>((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000, windowsHide: true }, (err) => resolve(!err));
      });
      if (ok && fs.existsSync(dst)) {
        const buf = await fs.promises.readFile(dst);
        return { kind: 'docx', data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
      }
      // 2) LibreOffice
      const soffice = ['C:/Program Files/LibreOffice/program/soffice.exe', 'C:/Program Files (x86)/LibreOffice/program/soffice.exe'].find((p) => fs.existsSync(p));
      if (soffice) {
        const ok2 = await new Promise<boolean>((resolve) => {
          execFile(soffice, ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, src], { timeout: 90000, windowsHide: true }, (err) => resolve(!err));
        });
        const out2 = path.join(tmpDir, 'input.docx');
        if (ok2 && fs.existsSync(out2)) {
          const buf = await fs.promises.readFile(out2);
          return { kind: 'docx', data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
        }
      }
    }
    // 3) 텍스트 추출
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WordExtractor = require('word-extractor');
    const extractor = new WordExtractor();
    const doc = await extractor.extract(Buffer.from(data));
    return {
      kind: 'text',
      body: doc.getBody(),
      headers: doc.getHeaders({ includeFooters: false }),
      footers: doc.getFooters(),
      footnotes: doc.getFootnotes(),
    };
  } catch (e: any) {
    return { kind: 'error', message: 'DOC 파일을 읽을 수 없습니다: ' + (e?.message || e) };
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
