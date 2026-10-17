import { useMemo, useState } from 'react';
import { useApp, useEditorTick } from '../../app/hooks';
import { app } from '../../app/controller';
import { Modal, Seg } from '../widgets';
import { Icon } from '../Icon';
import { findPrivacy, maskText, PRIVACY_LABEL, type PrivacyHit, type PrivacyKind } from '../../check/privacy';
import { TRACK_SKIP } from '../../editor/extensions/trackChanges';

/** 도구 > 개인정보 찾기·가림: 주민번호·전화·이메일·계좌·카드·여권 번호를 찾아 가린다 */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const appState = useApp();
  const tab = appState.active;
  const editor = tab?.editor || null;
  useEditorTick(editor);
  const [full, setFull] = useState<'part' | 'full'>('part');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [kindsOff, setKindsOff] = useState<Set<PrivacyKind>>(new Set());

  const doc = editor?.state.doc;
  const hits = useMemo(() => (doc ? findPrivacy(doc) : []), [doc]);
  // 메모 속 개인정보는 본문과 따로 알려 준다
  const commentHits = useMemo(() => {
    if (!editor || !tab?.settings.comments) return 0;
    const paras = Object.values(tab.settings.comments).flatMap((c) => [c.text, ...(c.replies || []).map((r) => r.text)]).filter((t) => t && t.trim());
    if (!paras.length) return 0;
    const d = editor.schema.nodeFromJSON({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
    return findPrivacy(d).length;
  }, [editor, tab?.settings.comments, appState]);
  if (!tab || !editor) return null;

  const key = (h: PrivacyHit) => `${h.from}:${h.text}`;
  const shown = hits.filter((h) => !kindsOff.has(h.kind));
  const chosen = shown.filter((h) => !off.has(key(h)));
  const counts = new Map<PrivacyKind, number>();
  for (const h of hits) counts.set(h.kind, (counts.get(h.kind) || 0) + 1);

  const goto = (h: PrivacyHit) => editor.chain().setTextSelection({ from: h.from, to: h.to }).scrollIntoView().run();
  const apply = () => {
    if (!chosen.length) return;
    const { state } = editor;
    const tr = state.tr;
    // 뒤에서부터 바꿔 앞쪽 위치가 흔들리지 않게
    for (const h of [...chosen].sort((a, b) => b.from - a.from)) {
      const marks = state.doc.resolve(Math.min(h.from + 1, h.to)).marks();
      tr.replaceWith(h.from, h.to, state.schema.text(maskText(h, full === 'full'), marks));
    }
    // 변경 추적 중이어도 원래 글이 '지운 글'로 남지 않게 기록하지 않는다
    tr.setMeta(TRACK_SKIP, true);
    editor.view.dispatch(tr);
    tab.markDirty();
    app.toast(`${chosen.length}곳을 가렸습니다. 되돌리기(Ctrl+Z)로 원래 글이 돌아오니, 다른 사람에게 줄 파일은 저장 후 다시 열어 확인하세요.`, 'info', 7000);
    setOff(new Set());
  };

  return (
    <Modal
      title="개인정보 찾기·가림"
      onClose={onClose}
      width={560}
      modeless
      footer={
        <>
          <button className="btn primary" disabled={!chosen.length} onClick={apply}>
            <Icon name="EyeOff" size={14} /> {chosen.length ? `${chosen.length}곳 가리기` : '가릴 것 없음'}
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </>
      }
    >
      <div className="pv-kinds">
        {(Object.keys(PRIVACY_LABEL) as PrivacyKind[]).map((k) => (
          <label key={k} className={'check' + (counts.get(k) ? '' : ' dim')}>
            <input
              type="checkbox"
              checked={!kindsOff.has(k)}
              onChange={(e) => {
                const n = new Set(kindsOff);
                if (e.target.checked) n.delete(k);
                else n.add(k);
                setKindsOff(n);
              }}
            />
            {PRIVACY_LABEL[k]} {counts.get(k) || 0}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <span className="unit">가림 방식</span>
        <Seg
          value={full}
          onChange={setFull}
          options={[
            { value: 'part', label: '부분 가림', title: '예: 900101-1******, 010-****-5678' },
            { value: 'full', label: '전체 가림', title: '예: ******-*******' },
          ]}
        />
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => setOff(new Set())}>
          모두 고르기
        </button>
        <button className="btn small" onClick={() => setOff(new Set(shown.map(key)))}>
          모두 빼기
        </button>
      </div>
      <div className="pv-list">
        {shown.length === 0 && <div className="chk-empty">{hits.length ? '고른 종류의 개인정보가 없습니다.' : '본문에서 개인정보를 찾지 못했습니다.'}</div>}
        {shown.map((h) => {
          const k = key(h);
          return (
            <div key={k} className="pv-item" onClick={() => goto(h)}>
              <input
                type="checkbox"
                checked={!off.has(k)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const n = new Set(off);
                  if (e.target.checked) n.delete(k);
                  else n.add(k);
                  setOff(n);
                }}
              />
              <span className="pv-kind">{PRIVACY_LABEL[h.kind]}</span>
              <span className="pv-text">
                <s>{h.text}</s> → <b>{maskText(h, full === 'full')}</b>
              </span>
              <span className="pv-ctx">{h.context}</span>
            </div>
          );
        })}
      </div>
      <p className="unit" style={{ marginTop: 8, lineHeight: 1.6 }}>
        본문(표·글상자 포함)만 찾습니다. 머리말·꼬리말, 그림 속 글자, 문서 정보는 따로 확인하세요.
        {commentHits > 0 && (
          <>
            <br />
            <b>메모에 개인정보로 보이는 글이 {commentHits}건 있습니다.</b> 검토 창에서 확인하세요.
          </>
        )}
      </p>
    </Modal>
  );
}
