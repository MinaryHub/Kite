import { useState } from 'react';
import { Modal } from '../widgets';
import { app } from '../../app/controller';

/** 도구 > 문의하기: 내용을 문의 양식 서비스로 보낸다 (개발사 메일 주소는 드러나지 않는다) */
const CATS = ['문의', '오류 신고', '기능 제안', '부적절한 AI 응답'];

export function ContactDialog({ onClose, category: initCat, message: initMsg }: { onClose: () => void; category?: string; message?: string }) {
  const [category, setCategory] = useState(CATS.includes(initCat || '') ? initCat! : '문의');
  const [message, setMessage] = useState(initMsg || '');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('kite:contact:email') || '';
    } catch {
      return '';
    }
  });
  const [withEnv, setWithEnv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setErr('');
    const r = await window.kite!.supportSend({ category, message, email: email.trim() || undefined, withEnv }).catch((e: any) => ({ ok: false, error: String(e?.message || e) }));
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || '보내지 못했습니다.');
      return;
    }
    try {
      if (email.trim()) localStorage.setItem('kite:contact:email', email.trim());
    } catch {
      /* 무시 */
    }
    app.toast(email.trim() ? '문의를 보냈습니다. 적어 주신 주소로 답장드리겠습니다.' : '문의를 보냈습니다. 고맙습니다.', 'info', 5000);
    onClose();
  };

  return (
    <Modal
      title="문의하기"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn primary" disabled={!message.trim() || busy} onClick={send}>
            {busy ? '보내는 중…' : '보내기'}
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>분류</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label>답장 받을 메일</label>
        <input type="email" value={email} placeholder="선택 — 답장이 필요하면 적어 주세요" onChange={(e) => setEmail(e.target.value)} />
      </div>
      <textarea
        className="contact-msg"
        rows={9}
        value={message}
        autoFocus
        placeholder="문의·오류·제안 내용을 적어 주세요. 오류라면 어떤 문서에서 무엇을 했을 때 생겼는지 알려 주시면 도움이 됩니다."
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <label className="check" style={{ display: 'flex', marginTop: 6 }}>
        <input type="checkbox" checked={withEnv} onChange={(e) => setWithEnv(e.target.checked)} />
        앱 버전과 운영체제 정보를 함께 보내기 (문서 내용은 보내지 않습니다)
      </label>
      {err && <div className="ai-warn">{err}</div>}
      <p className="unit" style={{ lineHeight: 1.6, marginTop: 8 }}>
        문의는 양식 전달 서비스를 거쳐 개발사에 전달됩니다. 적어 주신 내용과 메일 주소는 답변에만 씁니다.
      </p>
    </Modal>
  );
}
