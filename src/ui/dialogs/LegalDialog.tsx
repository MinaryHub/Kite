import { useEffect, useState } from 'react';
import { Modal } from '../widgets';
import { platform } from '../../platform';
import { renderMarkdown } from '../aiMarkdown';
import { PRIVACY_URL } from '../../appInfo';

/** 도구 > 개인정보 처리방침 / 오픈소스 라이선스 */
export function LegalDialog({ onClose, kind }: { onClose: () => void; kind: 'privacy' | 'licenses' }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    // 필요할 때만 불러온다 (라이선스 고지는 크다)
    const load = kind === 'privacy' ? import('../../../PRIVACY.md?raw') : import('../../legal/THIRD_PARTY_NOTICES.txt?raw');
    load.then((m) => setText(m.default)).catch(() => setText('불러오지 못했습니다.'));
  }, [kind]);
  return (
    <Modal
      title={kind === 'privacy' ? '개인정보 처리방침' : '오픈소스 라이선스'}
      onClose={onClose}
      width={720}
      footer={
        <>
          {kind === 'privacy' && PRIVACY_URL && (
            <button className="btn" onClick={() => platform.openExternal(PRIVACY_URL)}>
              웹에서 보기
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      {text == null ? (
        <div className="unit">불러오는 중…</div>
      ) : kind === 'privacy' ? (
        <div className="legal-md md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <pre className="legal-txt">{text}</pre>
      )}
    </Modal>
  );
}
