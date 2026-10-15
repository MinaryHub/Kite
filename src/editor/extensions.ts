import { getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { fontStack } from '../fonts';
import Highlight from '@tiptap/extension-highlight';
import { normColor } from '../formats/common';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CharacterCount from '@tiptap/extension-character-count';
import type { Schema } from '@tiptap/pm/model';
import { ParagraphFormat } from './extensions/paragraphFormat';
import { TextStyleExt } from './extensions/textStyleExt';
import {
  KImage,
  PageBreak,
  Footnote,
  KBulletList,
  KOrderedList,
  KTable,
  KTableCell, KTableRow,
  KTableHeader,
  KeyboardExtras,
  CellNoWrap,
} from './extensions/nodes';
import { Search } from './extensions/search';
import { Pagination } from './extensions/pagination';
import { TableResize } from './extensions/tableResize';

/** 문서 스키마를 구성하는 확장 (편집기 없이 변환에도 사용) */
export function getExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      bulletList: false,
      orderedList: false,
      history: { depth: 1000, newGroupDelay: 600 },
      dropcursor: { color: '#2f6fd6', width: 2 },
    }),
    Underline,
    TextStyle,
    Color,
    // 글꼴 이름은 그대로 저장하고, 화면에는 대체 글꼴 목록을 붙여 그린다
    FontFamily.extend({
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              fontFamily: {
                default: null,
                parseHTML: (el: HTMLElement) => el.style.fontFamily?.split(',')[0].replace(/['"]/g, '').trim() || null,
                renderHTML: (a: Record<string, any>) => (a.fontFamily ? { style: `font-family: ${fontStack(a.fontFamily)}` } : {}),
              },
            },
          },
        ];
      },
    }),
    // 형광펜 색도 색 값만 받는다
    Highlight.extend({
      addAttributes() {
        return {
          color: {
            default: null,
            parseHTML: (el: HTMLElement) => normColor(el.getAttribute('data-color') || el.style.backgroundColor),
            renderHTML: (a: Record<string, any>) => {
              const c = normColor(a.color);
              return c ? { 'data-color': c, style: `background-color: ${c}; color: inherit` } : {};
            },
          },
        };
      },
    }).configure({ multicolor: true }),
    Subscript,
    Superscript,
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: null, target: null } }),
    KImage,
    KTable,
    KTableRow,
    KTableHeader,
    KTableCell,
    KBulletList,
    KOrderedList,
    TaskList,
    TaskItem.configure({ nested: true }),
    ParagraphFormat,
    TextStyleExt,
    PageBreak,
    Footnote,
  ];
}

/** 편집 화면용 확장 (스키마 + 편집 기능) */
export function getEditorExtensions(): AnyExtension[] {
  return [...getExtensions(), KeyboardExtras, CellNoWrap, Search, CharacterCount, Pagination, TableResize];
}

let cachedSchema: Schema | null = null;
export function getDocSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(getExtensions());
  return cachedSchema;
}
