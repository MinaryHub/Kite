import { DocTab } from '../doc/docTab';
import { platform } from '../platform';
import { importDocument, exportDocument, SAVE_FORMATS, OPEN_FILTERS } from '../formats';
import { baseName, splitExt } from '../formats/common';
import type { SaveFormatId } from '../types';
import { withPrintRoot } from '../print';
import { viewState } from '../editor/viewState';
import { KOREAN_FONTS, LATIN_FONTS } from '../fonts';

export interface DialogState {
  type: string;
  props?: any;
}

export interface ConfirmButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface ConfirmState {
  title: string;
  message: string;
  buttons: ConfirmButton[];
  resolve: (id: string) => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'warn';
}

export interface Prefs {
  autosaveMinutes: number;
  defaultFont: string;
  defaultFontSize: number;
  spellcheck: boolean;
  recentFonts: string[];
  defaultSaveFormat: SaveFormatId;
}

export interface ViewOptions {
  ruler: boolean;
  statusbar: boolean;
  marks: boolean;
  guides: boolean;
  transparent: boolean;
  toolbar: boolean;
  formatbar: boolean;
}

export interface PainterState {
  marks: any[];
  para: Record<string, any> | null;
}

let toastSeq = 0;

export class AppController {
  docs: DocTab[] = [];
  activeId: string | null = null;
  zoom = 1;
  zoomMode: 'custom' | 'width' | 'page' = 'custom';
  view: ViewOptions = { ruler: true, statusbar: true, marks: false, guides: true, transparent: true, toolbar: true, formatbar: true };
  dialog: DialogState | null = null;
  confirmState: ConfirmState | null = null;
  findOpen: 'find' | 'replace' | null = null;
  previewOpen = false;
  aiOpen = false;
  toasts: Toast[] = [];
  busy: string | null = null;
  recent: string[] = [];
  systemFonts: string[] = [];
  painter: PainterState | null = null;
  prefs: Prefs = {
    autosaveMinutes: 5,
    defaultFont: '함초롬바탕',
    defaultFontSize: 10,
    spellcheck: false,
    recentFonts: [],
    defaultSaveFormat: 'hwpx',
  };
  private listeners = new Set<() => void>();
  private untitledNo = 0;
  private autosaveTimer: any = null;
  private docUnsubs = new Map<string, () => void>();

  get active(): DocTab | null {
    return this.docs.find((d) => d.id === this.activeId) || null;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit() {
    this.listeners.forEach((f) => f());
  }

  set(p: Partial<AppController>) {
    Object.assign(this, p);
    this.emit();
  }

  async init() {
    try {
      const prefs = await platform.getPrefs();
      if (prefs && typeof prefs === 'object') this.prefs = { ...this.prefs, ...prefs };
      if (prefs?.view) this.view = { ...this.view, ...prefs.view };
      if (prefs?.zoom) this.zoom = prefs.zoom;
    } catch {
      /* 무시 */
    }
    this.recent = await platform.getRecent();
    platform.listFonts().then((f) => {
      this.systemFonts = f;
      this.emit();
    });
    platform.onOpenFiles((files) => files.forEach((f) => this.openPath(f)));
    platform.onRequestClose(() => this.requestQuit());
    const initial = await platform.initialFiles();
    for (const f of initial) await this.openPath(f);
    await this.checkRecovery();
    if (!this.docs.length) this.newDoc();
    this.restartAutosave();
    this.emit();
  }

  savePrefs() {
    platform.setPrefs({ ...this.prefs, view: this.view, zoom: this.zoom });
  }

  // ---------------- 알림 ----------------
  toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
    const t = { id: ++toastSeq, text, kind };
    this.toasts = [...this.toasts, t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, ms);
  }

  confirm(title: string, message: string, buttons: ConfirmButton[]): Promise<string> {
    return new Promise((resolve) => {
      this.confirmState = {
        title,
        message,
        buttons,
        resolve: (id) => {
          this.confirmState = null;
          this.emit();
          resolve(id);
        },
      };
      this.emit();
    });
  }

  openDialog(type: string, props?: any) {
    this.dialog = { type, props };
    this.emit();
  }

  closeDialog() {
    this.dialog = null;
    this.emit();
    setTimeout(() => this.active?.editor.commands.focus(), 0);
  }

  // ---------------- 문서 ----------------
  private addDoc(tab: DocTab) {
    this.docs = [...this.docs, tab];
    this.activeId = tab.id;
    this.docUnsubs.set(
      tab.id,
      tab.subscribe(() => {
        this.updateTitle();
        this.emit();
      }),
    );
    this.updateTitle();
    this.emit();
    setTimeout(() => tab.editor.commands.focus('start'), 50);
  }

  newDoc() {
    this.untitledNo++;
    const tab = new DocTab({ title: `빈 문서 ${this.untitledNo}` });
    if (this.prefs.defaultFont !== '함초롬바탕' || this.prefs.defaultFontSize !== 10) {
      tab.editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { fontSize: this.prefs.defaultFontSize } }],
      });
      tab.editor.chain().setFontFamily(this.prefs.defaultFont).setFontSize(this.prefs.defaultFontSize).run();
      tab.markSaved();
    }
    this.addDoc(tab);
    return tab;
  }

  activate(id: string) {
    const cur = this.active;
    if (cur) cur.scrollTop = document.querySelector(`[data-doc="${cur.id}"]`)?.scrollTop || 0;
    this.activeId = id;
    this.updateTitle();
    this.emit();
    setTimeout(() => this.active?.editor.commands.focus(), 30);
  }

  updateTitle() {
    const d = this.active;
    platform.setTitle(d ? `${d.dirty ? '* ' : ''}${d.title} - Kite` : 'Kite');
  }

  async openFiles() {
    const files = await platform.openFiles(OPEN_FILTERS);
    for (const f of files) await this.openData(f.name, f.data, f.path);
  }

  async openPath(p: string) {
    const existing = this.docs.find((d) => d.path && d.path.toLowerCase() === p.toLowerCase());
    if (existing) {
      this.activate(existing.id);
      return;
    }
    try {
      const f = await platform.readPath(p);
      await this.openData(f.name, f.data, f.path);
    } catch (e: any) {
      this.toast(`파일을 열 수 없습니다: ${e?.message || e}`, 'error', 6000);
    }
  }

  async openData(name: string, data: Uint8Array, path: string | null) {
    this.set({ busy: `'${name}' 불러오는 중…` });
    // 진행 표시가 그려지도록 한 프레임 양보
    await new Promise((r) => setTimeout(r, 30));
    try {
      const loaded = await importDocument(name, data, {
        convertLegacyDoc: (d) => platform.convertDoc(d) as any,
        onProgress: (p) => this.set({ busy: `'${name}' 불러오는 중… ${Math.round(p * 100)}%` }),
      });
      const [stem] = splitExt(name);
      const cur = this.active;
      // 수정하지 않은 빈 새 문서는 교체
      const replace = cur && !cur.path && !cur.dirty && cur.editor.state.doc.textContent.length === 0 && cur.editor.state.doc.childCount <= 1;
      const tab = new DocTab({
        content: loaded.content,
        settings: loaded.settings,
        meta: loaded.meta,
        title: loaded.format === 'pdf' || loaded.format === 'doc' ? stem : name,
        path: loaded.format === 'pdf' || loaded.format === 'doc' ? null : path,
        sourceFormat: loaded.format,
        warnings: loaded.warnings,
      });
      if (loaded.format === 'pdf' || loaded.format === 'doc') tab.title = `${stem} (${loaded.format.toUpperCase()}에서 변환)`;
      if (replace && cur) this.closeTab(cur.id, true);
      this.addDoc(tab);
      if (path) this.recent = await platform.addRecent(path);
      if (loaded.warnings.length) this.toast(loaded.warnings.slice(0, 2).join(' / '), 'warn', 6000);
    } catch (e: any) {
      console.error(e);
      this.toast(`'${name}' 파일을 열 수 없습니다: ${e?.message || e}`, 'error', 7000);
    } finally {
      this.set({ busy: null });
    }
  }

  async save(tab = this.active): Promise<boolean> {
    if (!tab) return false;
    if (!tab.path || !tab.saveFormat) return this.saveAs(tab);
    return this.writeTo(tab, tab.path, tab.saveFormat);
  }

  async saveAs(tab = this.active, format?: SaveFormatId): Promise<boolean> {
    if (!tab) return false;
    const fmt = format || tab.saveFormat || this.prefs.defaultSaveFormat;
    const def = SAVE_FORMATS.find((f) => f.id === fmt) || SAVE_FORMATS[0];
    const [stem] = splitExt(tab.path ? baseName(tab.path) : tab.title.replace(/\s*\(.*에서 변환\)$/, ''));
    const dir = tab.path ? tab.path.slice(0, tab.path.length - baseName(tab.path).length) : '';
    const filters = [def, ...SAVE_FORMATS.filter((f) => f.id !== def.id && f.id !== 'pdf')].map((f) => ({ name: f.name, extensions: [f.ext] }));
    const target = await platform.chooseSavePath(dir + stem + '.' + def.ext, filters);
    if (!target) return false;
    const [, ext] = splitExt(target);
    const chosen = (SAVE_FORMATS.find((f) => f.ext === ext)?.id || fmt) as SaveFormatId;
    if (chosen === 'pdf') {
      await this.exportPdf(tab);
      return true;
    }
    const finalPath = ext ? target : `${target}.${def.ext}`;
    return this.writeTo(tab, finalPath, chosen);
  }

  private async writeTo(tab: DocTab, path: string, format: SaveFormatId): Promise<boolean> {
    this.set({ busy: '저장하는 중…' });
    try {
      const data = await exportDocument(format, tab.toKDocument(), { pageCount: tab.layout.pageCount });
      await platform.writeFile(path, data);
      if (platform.isElectron) {
        tab.path = path;
        tab.title = baseName(path);
        tab.saveFormat = format;
        this.recent = await platform.addRecent(path);
      } else {
        tab.title = baseName(path);
        tab.saveFormat = format;
      }
      tab.markSaved();
      platform.autosaveRemove(tab.id);
      this.toast(`저장했습니다: ${baseName(path)}`);
      if (format === 'md' || format === 'txt' || format === 'html') this.toast('이 형식은 일부 서식(쪽 설정, 글꼴 등)이 저장되지 않습니다.', 'warn', 5000);
      return true;
    } catch (e: any) {
      console.error(e);
      this.toast(`저장하지 못했습니다: ${e?.message || e}`, 'error', 7000);
      return false;
    } finally {
      this.set({ busy: null });
      this.updateTitle();
    }
  }

  async exportPdf(tab = this.active) {
    if (!tab) return;
    const [stem] = splitExt(tab.path ? baseName(tab.path) : tab.title);
    this.set({ busy: 'PDF 만드는 중…' });
    try {
      const out = await withPrintRoot(tab, (g) => platform.printToPdf({ widthMm: g.wMm, heightMm: g.hMm, defaultPath: stem + '.pdf' }));
      if (out) this.toast(`PDF로 저장했습니다: ${baseName(out)}`);
    } catch (e: any) {
      this.toast(`PDF 저장 실패: ${e?.message || e}`, 'error');
    } finally {
      this.set({ busy: null });
    }
  }

  async print(tab = this.active) {
    if (!tab) return;
    try {
      await withPrintRoot(tab, (g) => platform.print({ widthMm: g.wMm, heightMm: g.hMm, landscape: tab.settings.page.landscape }));
    } catch (e: any) {
      this.toast(`인쇄 실패: ${e?.message || e}`, 'error');
    }
  }

  async closeTab(id: string, force = false): Promise<boolean> {
    const tab = this.docs.find((d) => d.id === id);
    if (!tab) return true;
    if (!force && tab.dirty) {
      this.activate(id);
      const r = await this.confirm('저장 확인', `'${tab.title}' 문서의 변경 내용을 저장하시겠습니까?`, [
        { id: 'save', label: '저장', primary: true },
        { id: 'discard', label: '저장 안 함', danger: true },
        { id: 'cancel', label: '취소' },
      ]);
      if (r === 'cancel') return false;
      if (r === 'save' && !(await this.save(tab))) return false;
    }
    const idx = this.docs.indexOf(tab);
    this.docUnsubs.get(id)?.();
    this.docUnsubs.delete(id);
    this.docs = this.docs.filter((d) => d.id !== id);
    platform.autosaveRemove(tab.id);
    if (this.activeId === id) this.activeId = this.docs[Math.min(idx, this.docs.length - 1)]?.id || null;
    setTimeout(() => tab.destroy(), 0);
    this.updateTitle();
    this.emit();
    return true;
  }

  async requestQuit() {
    for (const d of [...this.docs]) {
      if (d.dirty && !(await this.closeTab(d.id))) return;
    }
    this.savePrefs();
    platform.closeConfirmed();
  }

  // ---------------- 자동 저장 / 복구 ----------------
  restartAutosave() {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    const m = this.prefs.autosaveMinutes;
    if (!m || m <= 0) return;
    this.autosaveTimer = setInterval(() => this.autosaveNow(), m * 60 * 1000);
  }

  autosaveNow() {
    for (const d of this.docs) {
      if (!d.dirty) continue;
      const json = JSON.stringify({ title: d.title, path: d.path, saveFormat: d.saveFormat, doc: d.toKDocument(), time: Date.now() });
      platform.autosaveWrite(d.id, json);
    }
  }

  private async checkRecovery() {
    const list = await platform.autosaveList();
    if (!list.length) return;
    const r = await this.confirm(
      '문서 복구',
      `비정상적으로 종료되어 저장되지 않은 문서 ${list.length}개가 있습니다. 복구하시겠습니까?`,
      [
        { id: 'yes', label: '복구', primary: true },
        { id: 'no', label: '삭제', danger: true },
      ],
    );
    for (const item of list) {
      if (r === 'yes') {
        try {
          const data = JSON.parse(item.json);
          const tab = new DocTab({
            content: data.doc.content,
            settings: data.doc.settings,
            meta: data.doc.meta,
            title: data.title + ' (복구됨)',
            path: data.path,
          });
          tab.saveFormat = data.saveFormat;
          tab.markDirty();
          this.addDoc(tab);
        } catch {
          /* 무시 */
        }
      }
      platform.autosaveRemove(item.id);
    }
  }

  // ---------------- 보기 ----------------
  setZoom(z: number, mode: AppController['zoomMode'] = 'custom') {
    const zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
    viewState.zoom = zoom;
    this.zoom = zoom;
    this.zoomMode = mode;
    this.emit();
    window.dispatchEvent(new Event('kite:relayout'));
    this.savePrefs();
  }

  toggleView(k: keyof ViewOptions) {
    this.view = { ...this.view, [k]: !this.view[k] };
    this.emit();
    this.savePrefs();
    setTimeout(() => window.dispatchEvent(new Event('kite:relayout')), 0);
  }

  fontList(): { korean: string[]; others: string[]; recent: string[] } {
    const sys = this.systemFonts;
    const isKo = (s: string) => /[가-힯]/.test(s);
    const set = new Set<string>();
    if (sys.length) {
      sys.forEach((f) => !f.startsWith('@') && set.add(f));
      set.add('함초롬바탕');
      set.add('함초롬돋움');
    } else {
      KOREAN_FONTS.forEach((f) => set.add(f));
      LATIN_FONTS.forEach((f) => set.add(f));
    }
    const all = [...set];
    return {
      recent: this.prefs.recentFonts.slice(0, 6),
      korean: all.filter(isKo).sort((a, b) => a.localeCompare(b, 'ko')),
      others: all.filter((f) => !isKo(f)).sort((a, b) => a.localeCompare(b, 'en')),
    };
  }

  rememberFont(f: string) {
    this.prefs.recentFonts = [f, ...this.prefs.recentFonts.filter((x) => x !== f)].slice(0, 8);
    this.savePrefs();
  }
}

export const app = new AppController();
