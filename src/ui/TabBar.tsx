import { useApp } from '../app/hooks';
import { Icon } from './Icon';

export function TabBar() {
  const app = useApp();
  return (
    <div className="tabbar">
      {app.docs.map((d) => (
        <div
          key={d.id}
          className={'doc-tab' + (d.id === app.activeId ? ' active' : '')}
          title={d.path || d.title}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              app.closeTab(d.id);
            } else app.activate(d.id);
          }}
        >
          <Icon name="FileText" size={13} color={d.sourceFormat === 'docx' || d.sourceFormat === 'doc' ? '#2b579a' : d.sourceFormat === 'pdf' ? '#c62828' : '#2f6fd6'} />
          <span className="dt-title">{d.title}</span>
          {d.dirty && <span className="dt-dirty">*</span>}
          <button
            className="dt-close"
            title="문서 닫기"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              app.closeTab(d.id);
            }}
          >
            <Icon name="X" size={12} />
          </button>
        </div>
      ))}
      <button className="tab-add" title="새 문서 (Alt+N)" onClick={() => app.newDoc()}>
        <Icon name="Plus" size={15} />
      </button>
    </div>
  );
}
