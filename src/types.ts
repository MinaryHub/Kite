import type { JSONContent } from '@tiptap/core';

/** 편집 용지 설정 (단위: mm). 한글과 동일하게 본문 시작 = 위쪽 + 머리말, 본문 끝 = 아래쪽 + 꼬리말 */
export interface PageSetup {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  marginHeader: number;
  marginFooter: number;
  gutter: number;
  landscape: boolean;
}

export type HFAlign = 'left' | 'center' | 'right';

export interface HeaderFooter {
  /** 텍스트. {{PAGE}} = 현재 쪽, {{PAGES}} = 전체 쪽 수 */
  text: string;
  align: HFAlign;
}

export type PageNumPos =
  | 'none'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PageNumFormat = 'digit' | 'dash' | 'roman' | 'ROMAN' | 'paren';

export interface PageNumbering {
  pos: PageNumPos;
  format: PageNumFormat;
  start: number;
}

export interface DocSettings {
  page: PageSetup;
  header: HeaderFooter;
  footer: HeaderFooter;
  pageNumber: PageNumbering;
}

export interface DocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  created?: string;
  modified?: string;
}

export interface KDocument {
  content: JSONContent;
  settings: DocSettings;
  meta: DocMeta;
}

export interface LoadedDoc extends KDocument {
  warnings: string[];
}

export type FormatId = 'hwpx' | 'hwp' | 'docx' | 'doc' | 'pdf' | 'md' | 'html' | 'txt';
export type SaveFormatId = 'hwpx' | 'hwp' | 'docx' | 'md' | 'html' | 'txt' | 'pdf';
