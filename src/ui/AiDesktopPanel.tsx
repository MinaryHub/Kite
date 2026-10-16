import { useEffect, useState } from 'react';
import { useApp } from '../app/hooks';
import { app } from '../app/controller';
import { platform } from '../platform';
import { Icon } from './Icon';

interface Status {
  enabled: boolean;
  confirmEdits: boolean;
  running: boolean;
  claudeRegistered: boolean;
  claudeInstalled: boolean;
}

/** Claude 데스크톱에 붙여 넣을 예시 요청 */
const EXAMPLES: { label: string; prompt: string; needsSel?: boolean }[] = [
  { label: '요약해서 끝에 붙이기', prompt: 'Kite에 열린 문서를 세 줄로 요약해서 문서 맨 끝에 "요약" 제목과 함께 붙여 줘.' },
  { label: '선택 영역 맞춤법', prompt: 'Kite에서 내가 선택한 부분의 맞춤법과 띄어쓰기를 고쳐서 선택 영역을 바꿔 줘.', needsSel: true },
  { label: '선택 영역 공문서체', prompt: 'Kite에서 내가 선택한 부분을 공문서 문체(~함, ~임)로 다듬어서 선택 영역을 바꿔 줘.', needsSel: true },
  { label: '용어 일괄 변경', prompt: "Kite 문서에서 '갑'을 '발주자'로, '을'을 '수급자'로 모두 바꿔 줘. 바꾸기 전에 몇 곳인지 먼저 알려 줘." },
  { label: '표 만들기', prompt: 'Kite 문서 끝에 회의 일정 표를 만들어 줘. 열은 날짜, 장소, 안건이고 빈 행 3개를 넣어 줘.' },
  { label: '검토 의견', prompt: 'Kite에 열린 문서를 읽고 고칠 점을 목록으로 알려 줘. 문서는 아직 고치지 마.' },
];

const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** AI 도우미 패널: Claude 데스크톱(구독 계정)으로 쓰기 */
export function AiDesktopPanel() {
  const state = useApp();
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reload = () => platform.mcp.status().then((s: Status | null) => setSt(s));
  useEffect(() => {
    reload();
    // 설치/등록 상태가 바뀌었을 수 있으므로 패널이 열려 있는 동안 가끔 다시 확인
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);

  if (!platform.mcp.available()) {
    return <div className="ai-empty">Claude 데스크톱 연결은 데스크톱 앱(Kite)에서만 쓸 수 있습니다.</div>;
  }
  if (!st) return null;

  const set = async (patch: Partial<Status>) => {
    await platform.mcp.set(patch);
    await reload();
  };
  const ready = st.claudeInstalled && st.enabled && st.running && st.claudeRegistered;
  const hasSel = !!state.active && !state.active.editor.state.selection.empty;

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => app.toast('요청을 복사했습니다. Claude 데스크톱 대화창에 붙여 넣으세요.'),
      () => app.toast('복사하지 못했습니다.', 'error'),
    );

  const Step = ({ done, n, title, children }: { done: boolean; n: number; title: string; children?: React.ReactNode }) => (
    <div className={'ai-step' + (done ? ' done' : '')}>
      <span className="ai-step-mark">{done ? <Icon name="Check" size={12} /> : n}</span>
      <div className="ai-step-body">
        <div className="ai-step-title">{title}</div>
        {children}
      </div>
    </div>
  );

  return (
    <div className="ai-desk">
      <div className={'ai-desk-status' + (ready ? ' ok' : '')}>
        {ready ? '준비됨 — Claude 데스크톱에서 대화하면 결과가 이 문서에 바로 들어갑니다.' : '아래 순서대로 한 번만 설정하면 됩니다.'}
      </div>

      <div className="ai-desk-sec">
        <Step done={st.claudeInstalled} n={1} title="Claude 데스크톱 설치·로그인">
          {st.claudeInstalled ? (
            <div className="unit">설치되어 있습니다. Claude 계정(무료·Pro·Max)으로 로그인해 두세요.</div>
          ) : (
            <button className="btn small" onClick={() => platform.openExternal('https://claude.ai/download')}>
              다운로드 페이지 열기
            </button>
          )}
        </Step>
        <Step done={st.enabled && st.running} n={2} title="Kite 연결 켜기">
          <label className="check" style={{ display: 'flex' }}>
            <input type="checkbox" checked={st.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            AI 앱이 Kite 문서를 읽고 고치도록 허용
          </label>
        </Step>
        <Step done={st.claudeRegistered} n={3} title="Claude 데스크톱에 Kite 등록">
          <button
            className="btn small"
            disabled={!st.claudeInstalled}
            onClick={async () => {
              const r = await platform.mcp.registerClaude();
              setMsg({ ok: r.ok, text: r.message });
              if (r.ok && !st.enabled) await set({ enabled: true });
              else reload();
            }}
          >
            {st.claudeRegistered ? '다시 등록' : '등록하기'}
          </button>
          {msg && <div className={'ai-desk-msg' + (msg.ok ? '' : ' err')}>{msg.text}</div>}
        </Step>
        <Step done={false} n={4} title="Claude 데스크톱 열기">
          <div className="unit">
            등록한 뒤 처음 한 번, 그리고 Kite 를 새 버전으로 설치한 뒤에는 Claude 데스크톱을 완전히 끝냈다가(트레이 아이콘 → 끝내기) 다시 여세요. Claude 설정에
            'Server disconnected' 가 보일 때도 같습니다.
          </div>
          <button
            className="btn small"
            disabled={!st.claudeInstalled}
            onClick={async () => {
              if (!(await platform.mcp.openClaude())) app.toast('Claude 데스크톱을 열지 못했습니다. 시작 메뉴에서 직접 여세요.', 'warn');
            }}
          >
            Claude 데스크톱 열기
          </button>
        </Step>
      </div>

      <div className="ai-desk-sec">
        <div className="ai-desk-h">예시 요청 — 누르면 복사</div>
        <div className="ai-quick" style={{ border: 0, padding: 0 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              className="btn small"
              title={ex.prompt + (ex.needsSel && !hasSel ? '\n(먼저 문서에서 바꿀 부분을 선택하세요)' : '')}
              onClick={() => copy(ex.prompt)}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="unit" style={{ marginTop: 4 }}>
          요청에 'Kite'를 넣으면 Claude 가 Kite 도구를 씁니다. 선택 영역 요청은 먼저 문서에서 선택해 두세요.
        </div>
      </div>

      <div className="ai-desk-sec">
        <label className="check" style={{ display: 'flex' }}>
          <input type="checkbox" checked={st.confirmEdits} onChange={(e) => set({ confirmEdits: e.target.checked })} />
          AI 가 문서를 고칠 때마다 확인받기
        </label>
        <div className="unit">끄면 바로 고치고, Ctrl+Z 로 되돌릴 수 있습니다.</div>
      </div>

      <div className="ai-desk-sec grow">
        <div className="ai-desk-h">
          AI 작업 기록
          {state.mcpLog.length > 0 && (
            <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => app.set({ mcpLog: [] })}>
              지우기
            </button>
          )}
        </div>
        {state.mcpLog.length === 0 && <div className="unit">아직 없습니다.</div>}
        {state.mcpLog.map((l, i) => (
          <div key={l.time + ':' + i} className={'ai-log' + (l.ok ? '' : ' err') + (l.edits ? ' edit' : '')} title={l.detail}>
            <span className="ai-log-time">{fmtTime(l.time)}</span>
            <span className="ai-log-what">
              {l.client} · {l.title}
              {!l.ok && ' (실패)'}
            </span>
            <div className="ai-log-detail">{l.detail}</div>
          </div>
        ))}
      </div>

      <div className="unit ai-desk-foot">
        문서 내용은 Claude 서비스로 전송됩니다. 출처를 모르는 문서를 열었을 때는 연결을 꺼 두세요. 자세한 설정: 도구 → AI 앱 연결
      </div>
    </div>
  );
}
