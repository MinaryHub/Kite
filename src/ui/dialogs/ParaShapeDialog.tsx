import { useState } from 'react';
import { app } from '../../app/controller';
import { Modal, OkCancel, Fieldset, NumberInput, ColorField, Seg } from '../widgets';
import { Icon } from '../Icon';

export function ParaShapeDialog({ onClose }: { onClose: () => void }) {
  const editor = app.active!.editor;
  const a = editor.state.selection.$from.parent.attrs || {};
  const ti = a.textIndent || 0;
  const lhRaw: string | null = a.lineHeight || null;
  const [s, setS] = useState({
    align: (a.textAlign as string) || 'justify',
    left: a.indentLeft || 0,
    right: a.indentRight || 0,
    firstMode: ti > 0 ? 'indent' : ti < 0 ? 'hang' : 'normal',
    firstVal: Math.abs(ti) || 10,
    lhType: lhRaw && /pt$/.test(lhRaw) ? 'fixed' : 'percent',
    lhVal: lhRaw ? (/pt$/.test(lhRaw) ? parseFloat(lhRaw) : Math.round(parseFloat(lhRaw) * 100)) : 160,
    before: a.spaceBefore || 0,
    after: a.spaceAfter || 0,
    bg: (a.paraBg as string) || null,
  });
  const up = (p: Partial<typeof s>) => setS({ ...s, ...p });

  const apply = () => {
    const textIndent = s.firstMode === 'normal' ? null : s.firstMode === 'indent' ? s.firstVal : -s.firstVal;
    const lineHeight = s.lhType === 'fixed' ? `${s.lhVal}pt` : s.lhVal === 160 ? null : String(s.lhVal / 100);
    editor
      .chain()
      .focus()
      .setParagraphAttrs({
        textAlign: s.align === 'justify' ? null : s.align,
        indentLeft: s.left || null,
        indentRight: s.right || null,
        textIndent,
        lineHeight,
        spaceBefore: s.before || null,
        spaceAfter: s.after || null,
        paraBg: s.bg,
      })
      .run();
    onClose();
  };

  // 미리 보기
  const pv: React.CSSProperties = {
    textAlign: s.align === 'distribute' ? 'justify' : (s.align as any),
    textAlignLast: s.align === 'distribute' ? 'justify' : undefined,
    marginLeft: (s.left + (s.firstMode === 'hang' ? s.firstVal : 0)) * 0.5,
    marginRight: s.right * 0.5,
    textIndent: s.firstMode === 'normal' ? 0 : (s.firstMode === 'indent' ? s.firstVal : -s.firstVal) * 0.5,
    lineHeight: s.lhType === 'fixed' ? `${s.lhVal * 0.6}px` : s.lhVal / 100,
    paddingTop: s.before * 0.5,
    paddingBottom: s.after * 0.5,
    background: s.bg || undefined,
  };
  const filler = '앞 문단 '.repeat(24);
  const sample = '현재 문단의 모양을 미리 보여 줍니다. '.repeat(5);

  return (
    <Modal title="문단 모양" onClose={onClose} width={560} onEnter={apply} footer={<OkCancel onOk={apply} onCancel={onClose} />}>
      <Fieldset legend="정렬 방식">
        <Seg
          value={s.align}
          onChange={(v) => up({ align: v })}
          options={[
            { value: 'justify', label: <><Icon name="AlignJustify" size={14} /> 양쪽</> },
            { value: 'left', label: <><Icon name="AlignLeft" size={14} /> 왼쪽</> },
            { value: 'center', label: <><Icon name="AlignCenter" size={14} /> 가운데</> },
            { value: 'right', label: <><Icon name="AlignRight" size={14} /> 오른쪽</> },
            { value: 'distribute', label: <><Icon name="AlignHorizontalSpaceAround" size={14} /> 배분</> },
          ]}
        />
      </Fieldset>
      <div className="row" style={{ alignItems: 'stretch', gap: 12 }}>
        <Fieldset legend="여백" style={{ flex: 1 }}>
          <div className="form-grid">
            <label>왼쪽</label>
            <NumberInput value={s.left} onChange={(v) => up({ left: v })} min={0} step={0.5} unit="pt" />
            <label>오른쪽</label>
            <NumberInput value={s.right} onChange={(v) => up({ right: v })} min={0} step={0.5} unit="pt" />
          </div>
        </Fieldset>
        <Fieldset legend="첫 줄" style={{ flex: 1.3 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Seg
              value={s.firstMode}
              onChange={(v) => up({ firstMode: v })}
              options={[
                { value: 'normal', label: '보통' },
                { value: 'indent', label: '들여쓰기' },
                { value: 'hang', label: '내어쓰기' },
              ]}
            />
          </div>
          <NumberInput value={s.firstVal} onChange={(v) => up({ firstVal: v })} min={0} step={0.5} unit="pt" disabled={s.firstMode === 'normal'} />
        </Fieldset>
      </div>
      <Fieldset legend="간격">
        <div className="form-grid">
          <label>줄 간격</label>
          <div className="row">
            <select value={s.lhType} onChange={(e) => up({ lhType: e.target.value, lhVal: e.target.value === 'fixed' ? 16 : 160 })}>
              <option value="percent">글자에 따라</option>
              <option value="fixed">고정 값</option>
            </select>
            <NumberInput value={s.lhVal} onChange={(v) => up({ lhVal: v })} min={s.lhType === 'fixed' ? 1 : 50} max={s.lhType === 'fixed' ? 500 : 500} step={s.lhType === 'fixed' ? 0.5 : 5} unit={s.lhType === 'fixed' ? 'pt' : '%'} />
          </div>
          <label>문단 위</label>
          <NumberInput value={s.before} onChange={(v) => up({ before: v })} min={0} step={0.5} unit="pt" />
          <label>문단 아래</label>
          <NumberInput value={s.after} onChange={(v) => up({ after: v })} min={0} step={0.5} unit="pt" />
          <label>문단 배경</label>
          <ColorField value={s.bg} onChange={(v) => up({ bg: v })} />
        </div>
      </Fieldset>
      <div className="preview-box para">
        <div>{filler}</div>
        <div className="pv-cur" style={pv}>
          {sample}
        </div>
        <div>{'뒤 문단 '.repeat(24)}</div>
      </div>
    </Modal>
  );
}
