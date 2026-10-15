import { useEffect, useState } from 'react';
import { Modal, Fieldset } from '../widgets';
import { platform } from '../../platform';
import { app } from '../../app/controller';
import { MCP_TOOLS } from '../../mcp/tools';

interface Status {
  enabled: boolean;
  confirmEdits: boolean;
  allowed: string[];
  running: boolean;
  command: { command: string; args: string[] };
  claudeConfig: string;
  claudeRegistered: boolean;
}

/** 도구 > AI 앱 연결 (MCP) */
export function McpDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reload = () => platform.mcp.status().then((s: Status | null) => setSt(s));
  useEffect(() => {
    reload();
  }, []);

  if (!platform.mcp.available()) {
    return (
      <Modal title="AI 앱 연결 (MCP)" onClose={onClose} width={460} footer={<button className="btn primary" onClick={onClose}>닫기</button>}>
        <p>AI 앱 연결은 데스크톱 앱(Kite)에서만 쓸 수 있습니다.</p>
      </Modal>
    );
  }
  if (!st) return null;

  const set = async (patch: Partial<Status>) => {
    await platform.mcp.set(patch);
    await reload();
  };
  const otherConfig = JSON.stringify({ mcpServers: { kite: st.command } }, null, 2);

  return (
    <Modal title="AI 앱 연결 (MCP)" onClose={onClose} width={560} footer={<button className="btn primary" onClick={onClose}>닫기</button>}>
      <p style={{ lineHeight: 1.6, marginTop: 0 }}>
        Claude 데스크톱 같은 AI 앱이 Kite 에 열린 문서를 읽고 고칠 수 있게 합니다. API 키 없이 그 앱의 구독 계정으로 쓰며, 대화는 AI 앱에서 하고 결과는 Kite 문서에
        바로 들어갑니다.
      </p>
      <label className="check" style={{ display: 'flex', marginBottom: 4 }}>
        <input type="checkbox" checked={st.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        AI 앱 연결 켜기 {st.enabled && <span className="unit">({st.running ? '대기 중' : '시작하지 못함'})</span>}
      </label>
      <label className="check" style={{ display: 'flex', marginBottom: 4 }}>
        <input type="checkbox" checked={st.confirmEdits} onChange={(e) => set({ confirmEdits: e.target.checked })} />
        AI 가 문서를 고칠 때마다 확인받기
      </label>
      <div className="unit" style={{ margin: '4px 0 12px 24px', lineHeight: 1.5 }}>
        끄면 확인 없이 고치고, 고친 내용은 Ctrl+Z 로 되돌릴 수 있습니다. 처음 연결하는 앱은 항상 허용 여부를 묻습니다.
      </div>

      <Fieldset legend="Claude 데스크톱">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn"
            onClick={async () => {
              const r = await platform.mcp.registerClaude();
              setMsg({ ok: r.ok, text: r.message });
              if (r.ok && !st.enabled) await set({ enabled: true });
              else reload();
            }}
          >
            {st.claudeRegistered ? '다시 등록' : 'Claude 데스크톱에 등록'}
          </button>
          <span className="unit">{st.claudeRegistered ? '등록되어 있습니다.' : '아직 등록되지 않았습니다.'}</span>
        </div>
        {msg && <div style={{ marginTop: 6, color: msg.ok ? 'var(--c-accent)' : '#c0392b', lineHeight: 1.5 }}>{msg.text}</div>}
        <div className="unit" style={{ marginTop: 6, lineHeight: 1.5 }}>
          등록 후 Claude 데스크톱을 다시 실행하면 대화창의 도구 목록에 'kite' 가 나타납니다. 예: "Kite 에 열린 문서를 3줄로 요약해서 맨 끝에 붙여 줘"
        </div>
      </Fieldset>

      <Fieldset legend="다른 AI 앱 (Claude Code, Gemini CLI, Codex CLI 등)">
        <div className="unit" style={{ marginBottom: 6 }}>그 앱의 MCP 설정에 아래 내용을 넣으세요.</div>
        <textarea readOnly value={otherConfig} rows={7} style={{ width: '100%', fontFamily: 'Consolas, monospace', fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn"
          style={{ marginTop: 4 }}
          onClick={() => {
            navigator.clipboard.writeText(otherConfig).then(() => app.toast('설정을 복사했습니다.'));
          }}
        >
          복사
        </button>
      </Fieldset>

      <Fieldset legend="항상 허용한 앱">
        {st.allowed.length === 0 && <div className="unit">없음</div>}
        {st.allowed.map((name) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ flex: 1 }}>{name}</span>
            <button className="btn" onClick={() => set({ allowed: st.allowed.filter((x) => x !== name) })}>
              허용 취소
            </button>
          </div>
        ))}
      </Fieldset>

      <details style={{ marginTop: 8 }}>
        <summary className="unit" style={{ cursor: 'pointer' }}>
          AI 앱이 쓸 수 있는 기능 ({MCP_TOOLS.length}가지)
        </summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
          {MCP_TOOLS.map((t) => (
            <li key={t.name}>
              {t.title}
              {t.edits ? ' (수정)' : ''}
            </li>
          ))}
        </ul>
        <div className="unit" style={{ marginTop: 6, lineHeight: 1.5 }}>
          파일 열기·저장·삭제 등 디스크에는 접근하지 못합니다. 문서 내용은 연결한 AI 앱의 서비스로 전송되며, 문서 안에 숨겨진 지시문이 AI 의 동작에 영향을 줄 수
          있으니 출처를 모르는 문서에서는 연결을 꺼 두세요.
        </div>
      </details>
    </Modal>
  );
}
