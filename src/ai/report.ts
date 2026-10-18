import { app } from '../app/controller';
import { platform } from '../platform';
import { SUPPORT_EMAIL } from '../appInfo';

/**
 * AI 응답 신고: 부적절하거나 해로운 응답을 개발사에 알린다.
 * 문서 내용이 함께 나가지 않도록 신고 글에는 AI 응답과 회사·모델 이름만 담고, 보내기 전에 사용자가 고칠 수 있게 메일 프로그램으로 연다.
 */
/** 클립보드에 쓴다 (권한·포커스 문제로 실패하면 예전 방식으로) */
async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function reportAiResponse(info: { provider?: string; model?: string; text: string }) {
  const r = await app.confirm('부적절한 AI 응답 신고', '이 응답을 개발사에 신고할까요?\n신고에는 AI 응답 글과 회사·모델 이름만 담깁니다 (문서 내용은 담지 않습니다). 보내기 전에 내용을 확인·수정할 수 있습니다.', [
    { id: 'harm', label: '해롭거나 부적절함', primary: true },
    { id: 'wrong', label: '사실과 다름' },
    { id: 'no', label: '취소' },
  ]);
  if (r !== 'harm' && r !== 'wrong') return;
  const reason = r === 'harm' ? '해롭거나 부적절한 응답' : '사실과 다른 응답';
  const body = `[신고 사유] ${reason}\n[AI] ${info.provider || ''} ${info.model || ''}\n[시각] ${new Date().toISOString()}\n\n[응답]\n${info.text.slice(0, 4000)}\n\n[추가 설명]\n`;
  if (SUPPORT_EMAIL) {
    // 외부 주소는 2048자까지만 열리므로 메일 본문은 줄이고, 전체 내용은 클립보드에도 둔다
    await copyText(body);
    const subject = encodeURIComponent('[Kite] AI 응답 신고: ' + reason);
    let short = body;
    let url = '';
    for (;;) {
      url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(short)}`;
      if (url.length < 1900 || short.length < 200) break;
      short = short.slice(0, Math.floor(short.length * 0.8)) + '\n…(전체 내용은 클립보드에 있습니다)';
    }
    platform.openExternal(url);
    app.toast('메일 프로그램을 열었습니다. 내용을 확인하고 보내 주세요.');
  } else {
    if (await copyText(body)) app.toast('신고 내용을 클립보드에 복사했습니다. 개발사 문의처로 보내 주세요.', 'info', 6000);
    else app.toast('신고 내용을 복사하지 못했습니다.', 'error');
  }
}
