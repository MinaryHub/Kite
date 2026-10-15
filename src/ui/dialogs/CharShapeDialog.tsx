import { useState } from 'react';
import { app } from '../../app/controller';
import { Modal, OkCancel, Fieldset, NumberInput, ColorField, FontCombo, Seg } from '../widgets';
import { currentFont, currentFontSize } from '../Toolbar';
import { TEXT_EFFECT_CSS } from '../../editor/extensions/textStyleExt';

export function CharShapeDialog({ onClose }: { onClose: () => void }) {
  const editor = app.active!.editor;
  const ts = editor.getAttributes('textStyle');
  const [s, setS] = useState({
    font: currentFont(editor),
    size: currentFontSize(editor),
    color: (ts.color as string) || '#000000',
    highlight: (editor.getAttributes('highlight').color as string) || null,
    letterSpacing: (ts.letterSpacing as number) || 0,
    fontWidth: (ts.fontWidth as number) || 100,
    effect: (ts.textEffect as string) || '',
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    script: editor.isActive('superscript') ? 'sup' : editor.isActive('subscript') ? 'sub' : 'none',
  });
  const up = (p: Partial<typeof s>) => setS({ ...s, ...p });

  const apply = () => {
    const c = editor.chain().focus();
    c.setTextStyleAttrs({
      fontFamily: s.font,
      fontSize: s.size,
      color: s.color && s.color !== '#000000' ? s.color : null,
      letterSpacing: s.letterSpacing || null,
      fontWidth: s.fontWidth !== 100 ? s.fontWidth : null,
      textEffect: s.effect || null,
    });
    s.bold ? c.setBold() : c.unsetBold();
    s.italic ? c.setItalic() : c.unsetItalic();
    s.underline ? c.setUnderline() : c.unsetUnderline();
    s.strike ? c.setStrike() : c.unsetStrike();
    c.unsetSuperscript().unsetSubscript();
    if (s.script === 'sup') c.setSuperscript();
    if (s.script === 'sub') c.setSubscript();
    if (s.highlight) c.setHighlight({ color: s.highlight });
    else c.unsetHighlight();
    c.run();
    app.rememberFont(s.font);
    onClose();
  };

  const previewStyle: React.CSSProperties = {
    fontFamily: `'${s.font}', serif`,
    fontSize: Math.min(36, s.size * 1.6) + 'px',
    color: s.color,
    background: s.highlight || undefined,
    fontWeight: s.bold ? 'bold' : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    letterSpacing: s.letterSpacing / 100 + 'em',
    fontStretch: s.fontWidth + '%',
    verticalAlign: s.script === 'sup' ? 'super' : s.script === 'sub' ? 'sub' : undefined,
  };
  const effectCss = s.effect ? TEXT_EFFECT_CSS[s.effect] : '';
  if (effectCss) for (const decl of effectCss.split(';')) {
    const [k, v] = decl.split(':').map((x) => x.trim());
    if (k && v) (previewStyle as any)[k.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()).replace(/^Webkit/, 'Webkit')] = v;
  }

  return (
    <Modal title="글자 모양" onClose={onClose} width={520} onEnter={apply} footer={<OkCancel onOk={apply} onCancel={onClose} />}>
      <Fieldset legend="기본">
        <div className="form-grid">
          <label>글꼴</label>
          <FontCombo value={s.font} fonts={app.fontList()} onChange={(f) => up({ font: f })} width={220} />
          <label>기준 크기</label>
          <NumberInput value={s.size} onChange={(v) => up({ size: v })} step={0.5} min={1} max={4096} unit="pt" />
          <label>장평</label>
          <NumberInput value={s.fontWidth} onChange={(v) => up({ fontWidth: v })} min={50} max={200} unit="%" />
          <label>자간</label>
          <NumberInput value={s.letterSpacing} onChange={(v) => up({ letterSpacing: v })} min={-50} max={50} unit="%" />
        </div>
      </Fieldset>
      <Fieldset legend="속성">
        <div className="row wrap" style={{ gap: 14, marginBottom: 10 }}>
          <label className="check">
            <input type="checkbox" checked={s.bold} onChange={(e) => up({ bold: e.target.checked })} />
            <b>진하게</b>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.italic} onChange={(e) => up({ italic: e.target.checked })} />
            <i>기울임</i>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.underline} onChange={(e) => up({ underline: e.target.checked })} />
            <u>밑줄</u>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.strike} onChange={(e) => up({ strike: e.target.checked })} />
            <s>취소선</s>
          </label>
        </div>
        <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
          <span>효과</span>
          <Seg
            value={s.effect}
            onChange={(v) => up({ effect: v })}
            options={[
              { value: '', label: '없음' },
              { value: 'outline', label: '외곽선' },
              { value: 'shadow', label: '그림자' },
              { value: 'emboss', label: '양각' },
              { value: 'engrave', label: '음각' },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span>첨자</span>
          <Seg
            value={s.script}
            onChange={(v) => up({ script: v })}
            options={[
              { value: 'none', label: '보통' },
              { value: 'sup', label: '위 첨자' },
              { value: 'sub', label: '아래 첨자' },
            ]}
          />
        </div>
      </Fieldset>
      <Fieldset legend="색">
        <div className="form-grid">
          <label>글자 색</label>
          <ColorField value={s.color} onChange={(v) => up({ color: v || '#000000' })} allowNone={false} />
          <label>음영 색</label>
          <ColorField value={s.highlight} onChange={(v) => up({ highlight: v })} />
        </div>
      </Fieldset>
      <div className="preview-box">
        <span style={previewStyle}>한글 Hangul 123 가나다</span>
      </div>
    </Modal>
  );
}
