/** 기본 제공 글꼴 목록 (시스템 글꼴 목록을 얻지 못한 경우에도 사용) */
export const KOREAN_FONTS = [
  '함초롬바탕',
  '함초롬돋움',
  '한컴바탕',
  '한컴돋움',
  '맑은 고딕',
  '바탕',
  '바탕체',
  '돋움',
  '돋움체',
  '굴림',
  '굴림체',
  '궁서',
  '궁서체',
  '나눔고딕',
  '나눔명조',
  '나눔바른고딕',
  '나눔스퀘어',
  '휴먼명조',
  '휴먼고딕',
  'HY헤드라인M',
  'HY견고딕',
  'HY중고딕',
  'HY신명조',
  'HY견명조',
  '한양신명조',
  '한양중고딕',
  'Noto Sans KR',
  'Noto Serif KR',
  '본고딕',
  '본명조',
];

export const LATIN_FONTS = [
  'Arial',
  'Times New Roman',
  'Calibri',
  'Cambria',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Georgia',
  'Consolas',
  'Courier New',
  'D2Coding',
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 54, 60, 72];

export function cssFontFamily(name: string): string {
  return `'${name.replace(/'/g, "\\'")}', '함초롬바탕', serif`;
}
