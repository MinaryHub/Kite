import { useEffect, useReducer } from 'react';
import type { Editor } from '@tiptap/react';
import { app } from './controller';

/** 앱 상태 변경 시 다시 그리기 */
export function useApp() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => app.subscribe(force), []);
  return app;
}

/** 편집기 트랜잭션마다(프레임당 1회) 다시 그리기 */
export function useEditorTick(editor: Editor | null | undefined) {
  const [tick, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    let raf = 0;
    const h = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        force();
      });
    };
    editor.on('transaction', h);
    editor.on('focus', h);
    return () => {
      editor.off('transaction', h);
      editor.off('focus', h);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor]);
  return tick;
}
