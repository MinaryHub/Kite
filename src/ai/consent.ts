import { app } from '../app/controller';

/**
 * 클라우드 AI 로 문서 내용을 처음 보낼 때 받는 동의 (회사별로 한 번).
 * 무엇이 어디로 가는지 알리고, 거부하면 보내지 않는다. Ollama(이 컴퓨터·지정 서버)는 묻지 않는다.
 */
const NAME: Record<string, { label: string; company: string }> = {
  claude: { label: 'Claude', company: 'Anthropic' },
  openai: { label: 'GPT', company: 'OpenAI' },
  gemini: { label: 'Gemini', company: 'Google' },
};
const KEY = (p: string) => `kite:ai:consent:${p}`;

export function hasAiConsent(provider: string): boolean {
  if (!NAME[provider]) return true;
  try {
    return localStorage.getItem(KEY(provider)) === '1';
  } catch {
    return false;
  }
}

export async function ensureAiConsent(provider: string): Promise<boolean> {
  if (hasAiConsent(provider)) return true;
  const n = NAME[provider];
  const r = await app.confirm(
    `${n.label}로 보내기 전에`,
    `AI 기능을 쓰면 요청과 함께 고른 문서 내용(선택 영역 또는 문서 전체)이 ${n.company}의 서버로 전송되어 처리됩니다.\n\n` +
      `· 전송은 사용자가 AI 기능을 실행할 때만 일어나며, Kite 개발사는 이 내용을 받거나 저장하지 않습니다.\n` +
      `· ${n.company}의 데이터 처리는 그 회사의 약관·개인정보 처리방침을 따릅니다.\n` +
      `· 개인정보·기밀이 담긴 문서는 보내기 전에 '개인정보 찾기·가림'으로 가리거나, 이 컴퓨터에서 도는 Ollama 를 쓰세요.\n` +
      `· AI 가 만든 내용은 틀릴 수 있으니 확인한 뒤 쓰세요.`,
    [
      { id: 'ok', label: '동의하고 보내기', primary: true },
      { id: 'no', label: '보내지 않음' },
    ],
  );
  if (r !== 'ok') return false;
  try {
    localStorage.setItem(KEY(provider), '1');
  } catch {
    /* 무시 */
  }
  return true;
}
