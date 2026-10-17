import { useState } from 'react';
import { useApp } from '../../app/hooks';
import { app } from '../../app/controller';
import { Modal, Seg } from '../widgets';
import { Icon } from '../Icon';
import { collabState, hostCollab, joinCollab, stopCollab } from '../../collab/session';

/** 도구 > 실시간 공동 편집 (실험): 같은 네트워크의 Kite 끼리 한 문서를 함께 고친다 */
export function CollabDialog({ onClose }: { onClose: () => void }) {
  const appState = useApp();
  const st = collabState();
  const [mode, setMode] = useState<'host' | 'join'>('host');
  const [addr, setAddr] = useState(() => localStorage.getItem('kite:collab:addr') || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  void appState;

  const host = async () => {
    if (!app.active) return;
    setBusy(true);
    setErr('');
    try {
      await hostCollab(app.active);
    } catch (e: any) {
      setErr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setErr('');
    try {
      localStorage.setItem('kite:collab:addr', addr.trim());
      await joinCollab(addr, code);
      app.toast('공동 편집에 들어갔습니다.');
      onClose();
    } catch (e: any) {
      setErr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };
  const copy = (t: string) => {
    void navigator.clipboard.writeText(t);
    app.toast('복사했습니다.');
  };

  const tabTitle = st ? app.docs.find((d) => d.id === st.tabId)?.title : '';

  return (
    <Modal
      title="실시간 공동 편집 (실험)"
      onClose={onClose}
      width={500}
      footer={
        st ? (
          <>
            <button className="btn danger" onClick={() => void stopCollab().then(() => app.toast('공동 편집을 끝냈습니다.'))}>
              공동 편집 끝내기
            </button>
            <button className="btn" onClick={onClose}>
              닫기
            </button>
          </>
        ) : (
          <>
            {mode === 'host' ? (
              <button className="btn primary" disabled={busy || !app.active} onClick={host}>
                <Icon name="Users" size={14} /> 이 문서로 공동 편집 열기
              </button>
            ) : (
              <button className="btn primary" disabled={busy || !addr.trim() || code.replace(/[^A-Za-z0-9]/g, '').length < 8} onClick={join}>
                들어가기
              </button>
            )}
            <button className="btn" onClick={onClose}>
              닫기
            </button>
          </>
        )
      }
    >
      {st ? (
        <div className="cl-live">
          <div className="cl-row">
            <span className="cl-dot" /> <b>{st.mode === 'host' ? '공동 편집을 열어 두었습니다' : '공동 편집에 들어와 있습니다'}</b>
          </div>
          <div className="unit">문서: {tabTitle}</div>
          {st.mode === 'host' && (
            <>
              <p style={{ margin: '10px 0 4px' }}>함께 고칠 사람에게 아래 주소와 코드를 알려 주세요. (도구 → 실시간 공동 편집 → 들어가기)</p>
              <div className="form-grid">
                <label>주소</label>
                <div className="cl-addrs">
                  {st.addresses.length ? (
                    st.addresses.map((a) => (
                      <button key={a} className="btn small" onClick={() => copy(`${a}:${st.port}`)} title="복사">
                        {a}:{st.port} <Icon name="Copy" size={12} />
                      </button>
                    ))
                  ) : (
                    <span className="unit">네트워크 주소를 찾지 못했습니다 (포트 {st.port})</span>
                  )}
                </div>
                <label>코드</label>
                <div>
                  <button className="btn small cl-code" onClick={() => copy(st.code)} title="복사">
                    {st.code} <Icon name="Copy" size={12} />
                  </button>
                </div>
              </div>
            </>
          )}
          <div style={{ marginTop: 10 }}>
            함께 있는 사람: {st.names.length ? st.names.join(', ') : st.mode === 'host' ? (st.peers ? `${st.peers}명` : '아직 없음') : '호스트'}
          </div>
        </div>
      ) : (
        <>
          <Seg
            value={mode}
            onChange={(m) => (setMode(m), setErr(''))}
            options={[
              { value: 'host', label: '열기 (이 문서를 함께)' },
              { value: 'join', label: '들어가기' },
            ]}
          />
          {mode === 'host' ? (
            <p className="unit" style={{ lineHeight: 1.7, marginTop: 10 }}>
              지금 보고 있는 문서를 같은 네트워크(사내망·같은 와이파이)의 다른 Kite 와 함께 고칩니다. 접속 코드를 아는 사람만 들어올 수 있습니다.
              <br />
              파일 저장은 여는 사람이 합니다. 운영체제가 네트워크 접근을 물으면 허용해야 합니다.
            </p>
          ) : (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>호스트 주소</label>
              <input value={addr} placeholder="예: 192.168.0.10:47800" onChange={(e) => setAddr(e.target.value)} autoFocus spellCheck={false} />
              <label>접속 코드</label>
              <input value={code} placeholder="예: ABCD-EFGH" onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && join()} spellCheck={false} />
            </div>
          )}
          <p className="unit" style={{ lineHeight: 1.6, marginTop: 10 }}>
            실험 기능입니다. 본문 글과 서식은 바로 함께 고쳐지지만, 메모 내용·쪽 설정 변경은 아직 나누지 않습니다. 되돌리기(Ctrl+Z)는 내가 고친 것만 되돌립니다.
          </p>
          {err && <div className="ai-warn">{err}</div>}
        </>
      )}
    </Modal>
  );
}
