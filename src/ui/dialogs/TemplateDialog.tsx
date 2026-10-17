import { useEffect, useMemo, useRef, useState } from 'react';
import { DOMSerializer, Node as PMNode } from '@tiptap/pm/model';
import { app } from '../../app/controller';
import { Modal } from '../widgets';
import { Icon } from '../Icon';
import { getDocSchema } from '../../editor/extensions';
import { CATEGORY_ORDER, TEMPLATES, type DocTemplate } from '../../templates';

/** 파일 > 서식 문서로 새로 만들기: 자주 쓰는 업무 서식을 골라 새 문서로 연다 */
export function TemplateDialog({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<'all' | DocTemplate['category']>('all');
  const [sel, setSel] = useState<string>(TEMPLATES[0].id);
  const prevRef = useRef<HTMLDivElement>(null);
  const list = TEMPLATES.filter((t) => cat === 'all' || t.category === cat);
  const cur = TEMPLATES.find((t) => t.id === sel) || TEMPLATES[0];
  const built = useMemo(() => cur.build(), [cur]);

  // 미리 보기: 실제 편집 화면과 같은 스타일로 그린 뒤 줄여 보인다
  useEffect(() => {
    const host = prevRef.current;
    if (!host) return;
    host.innerHTML = '';
    try {
      const schema = getDocSchema();
      const node = PMNode.fromJSON(schema, built.content);
      const pg = built.settings.page;
      const w = pg.landscape ? Math.max(pg.width, pg.height) : pg.width;
      const hgt = pg.landscape ? Math.min(pg.width, pg.height) : pg.height;
      const pxPerMm = 96 / 25.4;
      const paper = document.createElement('div');
      paper.className = 'tpl-paper';
      paper.style.width = `${w * pxPerMm}px`;
      paper.style.height = `${hgt * pxPerMm}px`;
      paper.style.padding = `${pg.marginTop * pxPerMm}px ${pg.marginRight * pxPerMm}px 0 ${pg.marginLeft * pxPerMm}px`;
      const content = document.createElement('div');
      content.className = 'kdoc-content ProseMirror';
      content.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content));
      paper.appendChild(content);
      const box = host.getBoundingClientRect();
      const scale = Math.min((box.width - 16) / (w * pxPerMm), (box.height - 16) / (hgt * pxPerMm));
      paper.style.transform = `scale(${scale})`;
      host.appendChild(paper);
    } catch (e) {
      host.textContent = '미리 보기를 만들지 못했습니다.';
      console.warn(e);
    }
  }, [built]);

  const create = (t: DocTemplate = cur) => {
    const b = t.build();
    app.openCopy(t.name, b);
    onClose();
    app.toast('서식 문서를 열었습니다. 노란 바탕 글자를 고쳐 쓰세요.', 'info', 5000);
  };

  return (
    <Modal
      title="서식 문서로 새로 만들기"
      onClose={onClose}
      width={900}
      onEnter={() => create()}
      footer={
        <>
          <button className="btn primary" onClick={() => create()}>
            <Icon name="FilePlus" size={14} /> 이 서식으로 만들기
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
        </>
      }
    >
      <div className="tpl-wrap">
        <div className="tpl-side">
          <div className="tpl-cats">
            {(['all', ...CATEGORY_ORDER] as const).map((k) => (
              <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>
                {k === 'all' ? '전체' : k}
              </button>
            ))}
          </div>
          <div className="tpl-list">
            {list.map((t) => (
              <button key={t.id} className={'tpl-card' + (t.id === cur.id ? ' sel' : '')} onClick={() => setSel(t.id)} onDoubleClick={() => create(t)}>
                <span className="tpl-ico">
                  <Icon name={t.icon} size={20} />
                </span>
                <span className="tpl-txt">
                  <b>{t.name}</b>
                  <span>{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="tpl-preview" ref={prevRef} />
      </div>
    </Modal>
  );
}
