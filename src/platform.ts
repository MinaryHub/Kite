import type { KiteApi } from '../electron/preload';

declare global {
  interface Window {
    kite?: KiteApi;
  }
}

export interface OpenedFile {
  name: string;
  path: string | null;
  data: Uint8Array;
}

const api = typeof window !== 'undefined' ? window.kite : undefined;
export const isElectron = !!api;

function baseName(p: string) {
  return p.split(/[\\/]/).pop() || p;
}

function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files || []));
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

const LS_PREFIX = 'kite:';

// 예전 이름(K-HWP) 때의 로컬 저장소 키를 새 이름으로 옮긴다 (한 번만)
try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem('kite:migrated')) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('khwp:')) {
        const nk = 'kite:' + k.slice(5);
        if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k) || '');
      }
    }
    localStorage.setItem('kite:migrated', '1');
  }
} catch {
  /* 저장소를 쓸 수 없는 환경 */
}

export const platform = {
  isElectron,

  async openFiles(filters: { name: string; extensions: string[] }[]): Promise<OpenedFile[]> {
    if (api) {
      const paths = await api.openDialog(filters);
      return Promise.all(paths.map((p) => this.readPath(p)));
    }
    const exts = filters[0]?.extensions.map((e) => '.' + e).join(',') || '';
    const files = await pickFiles(exts);
    return Promise.all(files.map(async (f) => ({ name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) })));
  },

  async readPath(p: string): Promise<OpenedFile> {
    if (!api) throw new Error('파일 경로로 열기는 데스크톱 앱에서만 가능합니다.');
    const data = await api.readFile(p);
    return { name: baseName(p), path: p, data: new Uint8Array(data) };
  },

  /** 저장 위치 선택. 브라우저에서는 파일 이름만 돌려준다. */
  async chooseSavePath(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    if (api) return api.saveDialog(defaultName, filters);
    const name = window.prompt('저장할 파일 이름', defaultName);
    return name || null;
  },

  async writeFile(pathOrName: string, data: Uint8Array): Promise<void> {
    if (api) {
      await api.writeFile(pathOrName, data);
      return;
    }
    const blob = new Blob([data as BlobPart]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = baseName(pathOrName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  async pickImages(): Promise<{ name: string; data: Uint8Array }[]> {
    if (api) return api.imageDialog();
    const files = await pickFiles('image/*');
    return Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  },

  async print(opts: { widthMm: number; heightMm: number; landscape: boolean }) {
    if (api) return api.print(opts);
    window.print();
    return true;
  },

  async printToPdf(opts: { widthMm: number; heightMm: number; defaultPath: string; path?: string }): Promise<string | null> {
    if (api) return api.printToPdf(opts);
    window.print();
    return null;
  },

  async getRecent(): Promise<string[]> {
    return api ? api.getRecent() : [];
  },
  async addRecent(p: string): Promise<string[]> {
    return api ? api.addRecent(p) : [];
  },
  async clearRecent(): Promise<string[]> {
    return api ? api.clearRecent() : [];
  },

  async getPrefs(): Promise<any> {
    if (api) return api.getPrefs();
    try {
      return JSON.parse(localStorage.getItem(LS_PREFIX + 'prefs') || '{}');
    } catch {
      return {};
    }
  },
  async setPrefs(p: any) {
    if (api) return api.setPrefs(p);
    try {
      localStorage.setItem(LS_PREFIX + 'prefs', JSON.stringify(p));
    } catch {
      /* 무시 */
    }
  },

  async autosaveWrite(id: string, json: string) {
    if (api) return api.autosaveWrite(id, json);
    try {
      localStorage.setItem(LS_PREFIX + 'autosave:' + id, json);
    } catch {
      /* 용량 초과 등 무시 */
    }
  },
  async autosaveRemove(id: string) {
    if (api) return api.autosaveRemove(id);
    try {
      localStorage.removeItem(LS_PREFIX + 'autosave:' + id);
    } catch {
      /* 무시 */
    }
  },
  async autosaveList(): Promise<{ id: string; json: string; mtime: number }[]> {
    if (api) return api.autosaveList();
    const out: { id: string; json: string; mtime: number }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(LS_PREFIX + 'autosave:')) out.push({ id: k.slice((LS_PREFIX + 'autosave:').length), json: localStorage.getItem(k)!, mtime: Date.now() });
      }
    } catch {
      /* 무시 */
    }
    return out;
  },

  async listFonts(): Promise<string[]> {
    if (api) return api.listFonts();
    try {
      const q = (window as any).queryLocalFonts;
      if (q) {
        const fonts = await q();
        return [...new Set<string>(fonts.map((f: any) => f.family))];
      }
    } catch {
      /* 권한 거부 등 */
    }
    return [];
  },

  async convertDoc(data: Uint8Array) {
    if (!api) return { kind: 'error', message: 'DOC 형식은 데스크톱 앱에서만 열 수 있습니다.' } as const;
    return api.convertDoc(data);
  },

  async paste(plain = false) {
    if (api) return plain ? api.pastePlain() : api.paste();
    document.execCommand('paste');
  },

  setTitle(t: string) {
    document.title = t;
    api?.setTitle(t);
  },

  onOpenFiles(cb: (files: string[]) => void) {
    return api ? api.onOpenFiles(cb) : () => {};
  },
  onRequestClose(cb: () => void) {
    return api ? api.onRequestClose(cb) : () => {};
  },
  onAutosaveNow(cb: () => void) {
    return api ? api.onAutosaveNow(cb) : () => {};
  },
  autosaveFlushed() {
    api?.autosaveFlushed();
  },
  /** 끌어다 놓은 파일의 경로 (브라우저에서는 없음) */
  droppedFilePath(file: File): string | null {
    return api ? api.droppedFilePath(file) : null;
  },
  async version(): Promise<string> {
    return api ? api.appVersion() : '';
  },
  closeConfirmed() {
    if (api) api.closeConfirmed();
  },
  async initialFiles(): Promise<string[]> {
    return api ? api.initialFiles() : [];
  },
  showItemInFolder(p: string) {
    api?.showItemInFolder(p);
  },
  openExternal(url: string) {
    if (api) api.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  },
  toggleFullscreen() {
    if (api) api.toggleFullscreen();
    else if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  },
};
