import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undo as yUndo, redo as yRedo, prosemirrorToYXmlFragment, ySyncPluginKey, defaultDeleteFilter, defaultProtectedNodes } from 'y-prosemirror';
import { keydownHandler } from '@tiptap/pm/keymap';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { history } from '@tiptap/pm/history';
import type { DocTab } from '../doc/docTab';
import { app } from '../app/controller';
import { authorHue } from '../editor/extensions/trackChanges';
import * as review from '../app/review';

/**
 * 실시간 공동 편집(실험). 문서를 Yjs 로 나눠 갖고, 주 프로세스의 중계(electron/collab.ts)로 변경을 주고받는다.
 * 메시지: [종류][내용] — 0 동기화, 1 커서·참가자, 2 문서 설정(호스트 → 참가자), 3 설정 요청
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_SETTINGS = 2;
const MSG_HELLO = 3;

export interface CollabState {
  mode: 'host' | 'guest';
  tabId: string;
  code: string;
  port: number;
  addresses: string[];
  peers: number;
  /** 참가자 이름들 (커서 정보에서) */
  names: string[];
}

const api = () => (typeof window !== 'undefined' ? window.kite : undefined);
export const collabAvailable = () => !!api()?.collabHost;

let state: CollabState | null = null;
let ydoc: Y.Doc | null = null;
let awareness: awarenessProtocol.Awareness | null = null;
let offEvent: (() => void) | null = null;
let attached: DocTab | null = null;
const PLUGIN_KEYS = ['y-sync$', 'yjs-cursor$', 'y-undo$', 'kite-collab-keys$'];

export const collabState = () => state;
export const isCollabTab = (tab: DocTab | null | undefined) => !!tab && !!state && state.tabId === tab.id && !!attached;

function sendRaw(enc: encoding.Encoder) {
  api()?.collabSend(encoding.toUint8Array(enc));
}

let undoManager: Y.UndoManager | null = null;
let destroyUndo: (() => void) | null = null;

function attach(tab: DocTab) {
  if (!ydoc || !awareness) return;
  const ed = tab.editor;
  const frag = ydoc.getXmlFragment('prosemirror');
  // 되돌리기는 내가 고친 것만 (다른 사람의 편집을 되돌리지 않게).
  // 편집기가 재구성될 때 y-prosemirror 가 관리자를 없애지 않도록 직접 만들어 넘기고, 끝낼 때 없앤다.
  undoManager = new Y.UndoManager(frag, {
    trackedOrigins: new Set([ySyncPluginKey]),
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
    captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
  });
  const um = undoManager;
  destroyUndo = um.destroy.bind(um);
  um.destroy = () => {};
  const keys = new Plugin({
    key: new PluginKey('kite-collab-keys'),
    props: { handleKeyDown: keydownHandler({ 'Mod-z': (s) => yUndo(s), 'Mod-y': (s) => yRedo(s), 'Mod-Shift-z': (s) => yRedo(s) }) },
  });
  // 한 번에 재구성 (플러그인을 하나씩 더하면 그때마다 플러그인 화면이 다시 만들어진다)
  const plugins = [keys, ...ed.state.plugins.filter((p) => !(p as any).key.startsWith('history$')), ySyncPlugin(frag), yCursorPlugin(awareness), yUndoPlugin({ undoManager: um })];
  ed.view.updateState(ed.state.reconfigure({ plugins }));
  attached = tab;
  app.emit();
}

function detach() {
  const tab = attached;
  attached = null;
  destroyUndo?.();
  destroyUndo = null;
  undoManager = null;
  if (!tab) return;
  const ed = tab.editor;
  if (ed.isDestroyed) return;
  const plugins = [...ed.state.plugins.filter((p) => !PLUGIN_KEYS.includes((p as any).key)), history()];
  ed.view.updateState(ed.state.reconfigure({ plugins }));
}

function onMessage(data: Uint8Array) {
  if (!ydoc || !awareness || !state) return;
  const dec = decoding.createDecoder(data);
  const type = decoding.readVarUint(dec);
  if (type === MSG_SYNC) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    const kind = syncProtocol.readSyncMessage(dec, enc, ydoc, 'remote');
    if (encoding.length(enc) > 1) sendRaw(enc);
    // 참가자는 처음 내용을 받은 뒤에 편집기를 잇는다 (빈 문단이 섞이지 않게)
    if (state.mode === 'guest' && !attached && (kind === syncProtocol.messageYjsSyncStep2 || kind === syncProtocol.messageYjsUpdate)) {
      const tab = app.docs.find((d) => d.id === state!.tabId);
      if (tab) attach(tab);
    }
  } else if (type === MSG_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), 'remote');
  } else if (type === MSG_SETTINGS && state.mode === 'guest') {
    try {
      const { settings, title } = JSON.parse(decoding.readVarString(dec));
      const tab = app.docs.find((d) => d.id === state!.tabId);
      if (tab && settings) {
        tab.settings = { ...tab.settings, ...settings };
        if (title) tab.title = `${title} (공동 편집)`;
        tab.editor.storage.pagination?.schedule?.();
        app.emit();
      }
    } catch {
      /* 무시 */
    }
  } else if (type === MSG_HELLO && state.mode === 'host') {
    sendSettings();
    // 새 참가자에게 지금 커서들을
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]));
    sendRaw(enc);
  }
}

function sendSettings() {
  const tab = app.docs.find((d) => d.id === state?.tabId);
  if (!tab) return;
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SETTINGS);
  encoding.writeVarString(enc, JSON.stringify({ settings: tab.settings, title: tab.title }));
  sendRaw(enc);
}

function setup(mode: 'host' | 'guest', tab: DocTab) {
  ydoc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(ydoc);
  const name = review.authorName();
  awareness.setLocalStateField('user', { name, color: `hsl(${authorHue(name + ydoc.clientID)}, 70%, 45%)` });
  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    sendRaw(enc);
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (state) {
      state.names = [...awareness!.getStates().entries()].filter(([id]) => id !== ydoc!.clientID).map(([, s]: [number, any]) => s.user?.name || '?');
      app.emit();
    }
    if (origin === 'remote') return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness!, [...added, ...updated, ...removed]));
    sendRaw(enc);
  });
  offEvent = api()!.onCollabEvent((ev: any) => {
    if (ev.type === 'msg') onMessage(ev.data);
    else if (ev.type === 'peers' && state) {
      const before = state.peers;
      state.peers = ev.count;
      if (ev.count > before) app.toast('참가자가 들어왔습니다.');
      app.emit();
    } else if (ev.type === 'closed') {
      app.toast(ev.reason || '공동 편집이 끝났습니다.', 'warn', 6000);
      void stopCollab(false);
    }
  });
  void tab;
}

/** 지금 문서로 공동 편집을 연다 */
export async function hostCollab(tab: DocTab): Promise<CollabState> {
  await stopCollab();
  const info = await api()!.collabHost();
  state = { mode: 'host', tabId: tab.id, code: info.code, port: info.port, addresses: info.addresses, peers: 0, names: [] };
  setup('host', tab);
  prosemirrorToYXmlFragment(tab.editor.state.doc, ydoc!.getXmlFragment('prosemirror'));
  attach(tab);
  app.emit();
  return state;
}

/** 다른 사람이 연 공동 편집에 들어간다 (새 탭으로) */
export async function joinCollab(address: string, code: string): Promise<CollabState> {
  await stopCollab();
  const tab = app.openCopy('공동 편집 (연결 중…)', { content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  state = { mode: 'guest', tabId: tab.id, code: code.trim().toUpperCase(), port: 0, addresses: [address], peers: 1, names: [] };
  setup('guest', tab);
  try {
    await api()!.collabJoin(address, code);
  } catch (e) {
    await stopCollab(false);
    throw e;
  }
  // 문서 내용과 설정을 달라고 한다
  const s1 = encoding.createEncoder();
  encoding.writeVarUint(s1, MSG_SYNC);
  syncProtocol.writeSyncStep1(s1, ydoc!);
  sendRaw(s1);
  const hello = encoding.createEncoder();
  encoding.writeVarUint(hello, MSG_HELLO);
  sendRaw(hello);
  app.emit();
  return state;
}

export async function stopCollab(notify = true) {
  if (!state && !ydoc) return;
  if (awareness) awarenessProtocol.removeAwarenessStates(awareness, [ydoc!.clientID], 'local');
  detach();
  offEvent?.();
  offEvent = null;
  awareness?.destroy();
  ydoc?.destroy();
  awareness = null;
  ydoc = null;
  const was = state;
  state = null;
  if (notify) await api()?.collabStop();
  if (was) app.emit();
}

/** 공동 편집 중의 되돌리기 (내 편집만) */
export function collabUndo(redo = false): boolean {
  const tab = attached;
  if (!tab || tab !== app.active) return false;
  return redo ? yRedo(tab.editor.state) : yUndo(tab.editor.state);
}
