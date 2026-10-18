/**
 * 화면 곳곳(검사 창의 AI 교정, 선택 영역 AI 고치기)에서 쓰는 한 번짜리 AI 호출.
 * AI 도우미 창에서 고른 회사·모델을 그대로 쓰고, 흘러오는 응답을 끝까지 모아 돌려준다.
 */

export type AiProvider = 'claude' | 'openai' | 'gemini' | 'ollama';

import { ensureAiConsent } from './consent';

const LS = 'kite:ai:';
const lsGet = (k: string, d: string) => {
  try {
    return localStorage.getItem(LS + k) || d;
  } catch {
    return d;
  }
};

const DEFAULT_MODEL: Record<AiProvider, string> = {
  claude: 'claude-opus-5-5',
  openai: 'gpt-5.5',
  gemini: 'gemini-flash-latest',
  ollama: 'qwen3',
};

/** 지금 고른 AI (AI 도우미 창과 같은 설정) */
export function currentAi(): { provider: AiProvider; model: string } {
  const provider = (lsGet('provider', 'claude') as AiProvider) || 'claude';
  return { provider, model: lsGet('model:' + provider, DEFAULT_MODEL[provider] || '') };
}

/** AI 다리 (시험에서는 window.__kiteAiOverride 로 바꿔 끼운다) */
const bridge = (): any => (typeof window !== 'undefined' ? (window as any).__kiteAiOverride || (window as any).kite : undefined);

export const aiAvailable = () => !!bridge()?.aiChat;

/**
 * 한 번 묻고 답을 받는다.
 * @throws 키가 없거나 연결 오류일 때 (사람이 읽을 수 있는 말로)
 */
export async function aiComplete(system: string, user: string, opts: { signal?: AbortSignal; onDelta?: (soFar: string) => void } = {}): Promise<string> {
  const api = bridge();
  if (!api?.aiChat) throw new Error('AI 기능은 데스크톱 앱에서 쓸 수 있습니다.');
  const { provider, model } = currentAi();
  if (provider !== 'ollama') {
    const keys = await api.aiKeyStatus();
    if (!keys || keys[provider] === 'none') throw new Error('AI API 키가 없습니다. AI 도우미(도구 → AI 도우미)의 설정에서 키를 넣어 주세요.');
  }
  if (!(await ensureAiConsent(provider))) throw new Error('AI로 보내지 않았습니다 (동의하지 않음).');
  const id = `once-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let text = '';
  return new Promise<string>((resolve, reject) => {
    let off: (() => void) | null = null;
    const finish = (fn: () => void) => {
      off?.();
      off = null;
      fn();
    };
    off = api.onAiEvent((ev: any) => {
      if (ev.id !== id) return;
      if (ev.type === 'delta') {
        text += ev.text;
        opts.onDelta?.(text);
      } else if (ev.type === 'done') finish(() => resolve(text));
      else if (ev.type === 'error') finish(() => (text && /중지/.test(ev.message) ? resolve(text) : reject(new Error(ev.message))));
    });
    opts.signal?.addEventListener('abort', () => api.aiAbort(id));
    Promise.resolve(api.aiChat({ id, provider, model, system, messages: [{ role: 'user', content: user }], effort: 'low' })).catch((e: any) => finish(() => reject(e)));
  });
}

/** 응답에서 JSON 배열/객체만 꺼낸다 (```json 울타리나 앞뒤 말이 붙어 와도) */
export function extractJson<T = any>(text: string): T | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
