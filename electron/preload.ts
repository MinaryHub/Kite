import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: 'electron' as const,
  initialFiles: (): Promise<string[]> => ipcRenderer.invoke('app:initial-files'),
  openDialog: (filters: any): Promise<string[]> => ipcRenderer.invoke('file:open-dialog', filters),
  readFile: (p: string): Promise<Uint8Array> => ipcRenderer.invoke('file:read', p),
  saveDialog: (defaultPath: string, filters: any): Promise<string | null> => ipcRenderer.invoke('file:save-dialog', defaultPath, filters),
  writeFile: (p: string, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('file:write', p, data),
  exists: (p: string): Promise<boolean> => ipcRenderer.invoke('file:exists', p),
  imageDialog: (): Promise<{ name: string; data: Uint8Array }[]> => ipcRenderer.invoke('file:image-dialog'),
  showItemInFolder: (p: string) => ipcRenderer.invoke('shell:show-item', p),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getRecent: (): Promise<string[]> => ipcRenderer.invoke('recent:get'),
  addRecent: (p: string): Promise<string[]> => ipcRenderer.invoke('recent:add', p),
  clearRecent: (): Promise<string[]> => ipcRenderer.invoke('recent:clear'),
  getPrefs: (): Promise<any> => ipcRenderer.invoke('prefs:get'),
  setPrefs: (prefs: any): Promise<boolean> => ipcRenderer.invoke('prefs:set', prefs),
  autosaveWrite: (id: string, json: string) => ipcRenderer.invoke('autosave:write', id, json),
  autosaveRemove: (id: string) => ipcRenderer.invoke('autosave:remove', id),
  autosaveList: (): Promise<{ id: string; json: string; mtime: number }[]> => ipcRenderer.invoke('autosave:list'),
  printToPdf: (opts: { widthMm: number; heightMm: number; defaultPath: string }): Promise<string | null> => ipcRenderer.invoke('print:pdf', opts),
  print: (opts: { widthMm: number; heightMm: number; landscape: boolean }): Promise<boolean> => ipcRenderer.invoke('print:print', opts),
  paste: () => ipcRenderer.invoke('edit:paste'),
  pastePlain: () => ipcRenderer.invoke('edit:paste-plain'),
  setTitle: (t: string) => ipcRenderer.invoke('app:set-title', t),
  closeConfirmed: () => ipcRenderer.invoke('app:close-confirmed'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  toggleDevtools: () => ipcRenderer.invoke('app:devtools'),
  listFonts: (): Promise<string[]> => ipcRenderer.invoke('fonts:list'),
  convertDoc: (data: Uint8Array): Promise<any> => ipcRenderer.invoke('doc:convert', data),
  onOpenFiles: (cb: (files: string[]) => void) => {
    const h = (_e: unknown, files: string[]) => cb(files);
    ipcRenderer.on('app:open-files', h);
    return () => ipcRenderer.removeListener('app:open-files', h);
  },
  onRequestClose: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('app:request-close', h);
    return () => ipcRenderer.removeListener('app:request-close', h);
  },
};

contextBridge.exposeInMainWorld('khwp', api);

export type KhwpApi = typeof api;
