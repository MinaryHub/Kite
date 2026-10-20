import { app } from './app/controller';
import { platform } from './platform';
import { SPONSOR_URL, contactFormConfigured } from './appInfo';

/** 도구 > 후원하기: GitHub Sponsors 페이지를 브라우저로 연다 */
export function openSponsor() {
  platform.openExternal(SPONSOR_URL);
}

/** 문의 창을 쓸 수 있는지 (데스크톱 앱 + 양식 설정) */
export const contactAvailable = () => contactFormConfigured() && !!(typeof window !== 'undefined' && window.kite?.supportSend);

/** 도구 > 문의하기: 앱 안 문의 창 (분류·내용을 미리 채울 수 있다) */
export function openContact(prefill: { category?: string; message?: string } = {}) {
  if (!contactAvailable()) {
    app.toast('문의 양식이 아직 설정되지 않았습니다.', 'warn');
    return;
  }
  app.openDialog('contact', prefill);
}
