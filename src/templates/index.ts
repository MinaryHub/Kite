import type { DocSettings } from '../types';
import type { JNode } from '../formats/common';
import { defaultSettings } from '../formats/common';
import { blank, c, gap, h, item, p, table, th, today, type Cell } from './builder';

/**
 * 서식 문서 모음. 채워 넣을 자리는 옅은 노란 바탕(blank)으로 표시한다.
 * 공문은 「행정업무의 운영 및 혁신에 관한 규정」의 기안문 구성과 표기(날짜 2026. 10. 17., 시각 15:00, 붙임·끝)를 따른다.
 */

export interface DocTemplate {
  id: string;
  name: string;
  category: '공문·행정' | '보고' | '회의·일정' | '재무·구매' | '인사·개인' | '홍보·안내';
  desc: string;
  icon: string;
  build: () => { content: JNode; settings: DocSettings };
}

const BODY = '함초롬바탕';
const HEAD = '함초롬돋움';
const ACCENT = '#1F3A68';
const LINE = '#7F8CA3';

const doc = (content: JNode[]): JNode => ({ type: 'doc', content });
const settings = (page: Partial<DocSettings['page']> = {}, more: Partial<DocSettings> = {}): DocSettings => {
  const s = defaultSettings();
  return { ...s, ...more, page: { ...s.page, ...page } };
};
/** 아래쪽 가운데 쪽 번호 "- 1 -" */
const withPageNo = (s: DocSettings): DocSettings => ({ ...s, pageNumber: { pos: 'bottom-center', format: 'dash', start: 1 } });

/** 결재란: 오른쪽 정렬 작은 표 */
function approval(roles: string[], width = 18): JNode {
  return table(
    [
      [c('결\n\n재', { rows: 2, bg: '#EDEFF3', align: 'center', valign: 'middle', b: true, size: 9 }), ...roles.map((r) => th(r, { size: 9 }))],
      roles.map(() => c('', { size: 9 })),
    ],
    { widths: [8, ...roles.map(() => width)], heights: [6, 16], align: 'right' },
  );
}

/** 제목 상자 (보고서 머리) */
function titleBox(title: string, sub?: string, width = 170): JNode[] {
  return [
    table([[c([p({ t: title, b: true, size: 20, font: HEAD, color: ACCENT }, { align: 'center', before: 4, after: sub ? 2 : 4 }), ...(sub ? [p({ t: sub, size: 11, font: HEAD, color: '#555555' }, { align: 'center', after: 4 })] : [])], { valign: 'middle', border: `t:2px solid ${ACCENT};b:2px solid ${ACCENT};l:none;r:none` })]], { widths: [width] }),
    gap(8),
  ];
}

/** Ⅰ. 대제목 (보고서) */
const sec = (no: string, title: string) => p([{ t: `${no}. ${title}`, b: true, size: 14, font: HEAD, color: ACCENT }], { before: 14, after: 6 });
/** 보고서 개조식 줄 (□ ○ - ·), 본문 13pt */
const b1 = (t: Parameters<typeof item>[1]) => item('□', t, 0, { size: 13, font: BODY } as any);
const b2 = (t: Parameters<typeof item>[1]) => item('○', t, 1, { size: 13 } as any);
const b3 = (t: Parameters<typeof item>[1]) => item('-', t, 2, { size: 12 } as any);
const note = (t: string) => item('※', t, 1, { size: 11, color: '#555555' } as any);

const lbl = (t: string, o = {}) => th(t, { size: 10, ...o });
const val = (t: Parameters<typeof c>[0], o = {}) => c(t, { size: 10, valign: 'middle', ...o });

// ───────────────────────── 공문·행정 ─────────────────────────

const gianmun: DocTemplate = {
  id: 'gianmun',
  name: '기안문 (공문)',
  category: '공문·행정',
  desc: '행정기관 표준 기안문. 수신·제목·본문 항목 체계·붙임·끝, 발신 명의와 결재·연락처 칸',
  icon: 'Landmark',
  build: () => ({
    settings: settings({ marginTop: 30, marginBottom: 15, marginLeft: 20, marginRight: 20, marginHeader: 10, marginFooter: 10 }),
    content: doc([
      p([{ t: '행정기관명', b: true, size: 18, font: HEAD }], { align: 'center', after: 2 }),
      p([blank('○○시 ○○과')], { align: 'center', size: 11, after: 14 }),
      p(['수신  ', blank('수신자 참조'), '  (경유)'], { size: 12, after: 4 }),
      p([{ t: '제목  ', b: true }, blank('○○○ 추진 계획 알림', { b: true })], { size: 12, after: 10, bg: '#F4F6FA' }),
      p(['1. 관련: ', blank('○○과-1234(2026. 10. 1.)')], { size: 12, lh: 1.7 }),
      p(['2. 위 호와 관련하여 ', blank('○○○ 사업'), '을 아래와 같이 추진하고자 하오니 협조하여 주시기 바랍니다.'], { size: 12, lh: 1.7, after: 4 }),
      p(['  가. 사 업 명: ', blank('○○○')], { size: 12, lh: 1.7, indent: 12 }),
      p(['  나. 기    간: ', blank('2026. 11. 1.(일) ~ 11. 30.(월)')], { size: 12, lh: 1.7, indent: 12 }),
      p(['  다. 장    소: ', blank('○○시청 대회의실')], { size: 12, lh: 1.7, indent: 12 }),
      p(['  라. 협조 사항: ', blank('참석자 명단 제출(11. 10.까지)')], { size: 12, lh: 1.7, indent: 12, after: 10 }),
      p(['붙임  1. ', blank('○○○ 계획서 1부.')], { size: 12, lh: 1.7 }),
      p(['      2. ', blank('참석자 명단 서식 1부.'), '  끝.'], { size: 12, lh: 1.7, after: 30 }),
      p([{ t: '행정기관장', b: true, size: 20, font: HEAD, sp: 30 }], { align: 'center', after: 24 }),
      table(
        [
          [lbl('기안자'), val(blank('직위 ○○○')), lbl('검토자'), val(blank('직위 ○○○')), lbl('결재권자'), val(blank('직위 ○○○'))],
          [lbl('협조자'), val('', { span: 5 })],
          [lbl('시행'), val(blank('○○과-0000 (2026. 10. 17.)'), { span: 2 }), lbl('접수'), val('', { span: 2 })],
          [lbl('우'), val(blank('00000  ○○시 ○○구 ○○로 00'), { span: 3 }), lbl('홈페이지'), val(blank('www.○○.go.kr'))],
          [lbl('전화'), val(blank('(000) 000-0000')), lbl('전송'), val(blank('(000) 000-0000')), lbl('공개 구분'), val('공개')],
          [lbl('이메일'), val(blank('○○○@korea.kr'), { span: 5 })],
        ],
        { widths: [22, 35, 22, 35, 22, 34], rowHeight: 8 },
      ),
    ]),
  }),
};

const leave: DocTemplate = {
  id: 'leave',
  name: '휴가 신청서',
  category: '인사·개인',
  desc: '휴가 종류·기간·사유·업무 대행자와 결재란을 갖춘 신청서',
  icon: 'CalendarDays',
  build: () => ({
    settings: settings({ marginTop: 25, marginLeft: 25, marginRight: 25 }),
    content: doc([
      approval(['담당', '팀장', '부서장']),
      gap(10),
      p([{ t: '휴 가 신 청 서', b: true, size: 24, font: HEAD, sp: 20 }], { align: 'center', after: 18 }),
      table(
        [
          [lbl('소    속'), val(blank('○○팀')), lbl('직    위'), val(blank('대리'))],
          [lbl('성    명'), val(blank('홍길동')), lbl('연 락 처'), val(blank('010-0000-0000'))],
          [lbl('휴가 종류'), val('□ 연차  □ 반차  □ 병가  □ 경조  □ 공가  □ 기타(     )', { span: 3 })],
          [lbl('기    간'), val([blank('2026. 11. 3.(화)'), ' ~ ', blank('11. 5.(목)'), '  (총 ', blank('3'), '일)'], { span: 3 })],
          [lbl('사    유'), val(blank('개인 사유'), { span: 3 })],
          [lbl('업무 대행'), val(['성명: ', blank('○○○'), '   인계 사항: ', blank('○○ 업무 처리')], { span: 3 })],
          [lbl('비상 연락'), val(blank('휴가 중 연락 가능한 번호'), { span: 3 })],
        ],
        { widths: [30, 50, 30, 50], rowHeight: 11 },
      ),
      gap(24),
      p('위와 같이 휴가를 신청합니다.', { align: 'center', size: 12, after: 18 }),
      p(today('korean'), { align: 'center', size: 12, after: 18 }),
      p(['신청인  ', blank('홍길동'), '  (서명)'], { align: 'right', size: 12, after: 28 }),
      p([{ t: blank('○○주식회사').t, hl: '#FFF4C2', b: true, size: 14 }, { t: ' 대표이사 귀하', b: true, size: 14 }], { align: 'center' }),
    ]),
  }),
};

// ───────────────────────── 보고 ─────────────────────────

const report: DocTemplate = {
  id: 'report',
  name: '개조식 보고서',
  category: '보고',
  desc: '□ ○ - 기호 체계의 한 장짜리 정책·업무 보고서 (개요·현황·문제점·개선 방안·향후 계획)',
  icon: 'FileText',
  build: () => ({
    settings: withPageNo(settings({ marginTop: 20, marginBottom: 15, marginLeft: 20, marginRight: 20 })),
    content: doc([
      ...titleBox('○○○ 개선 방안 보고', `${today()}  ${'○○과'}`),
      table([[c([p([{ t: '보고 요지  ', b: true, color: ACCENT }, blank('한두 문장으로 핵심 결론과 요청 사항을 적습니다.')], { size: 12, lh: 1.6 })], { bg: '#F4F6FA', border: `l:4px solid ${ACCENT};t:none;b:none;r:none` })]], { widths: [170] }),
      sec('Ⅰ', '추진 배경'),
      b1(blank('정책·환경 변화 등 보고하게 된 계기')),
      b2(blank('관련 근거: ○○법 제00조, ○○ 계획(2026. 3.)')),
      b2(blank('현장의 요구나 지적 사항')),
      sec('Ⅱ', '현황'),
      b1(['(규모) ', blank('대상 00개 기관, 이용자 0만 명')]),
      b1(['(실적) ', blank('최근 3년 추이')]),
      table(
        [
          [th('구분'), th('2024년'), th('2025년'), th('2026년(9월)'), th('증감')],
          [c('○○ 건수', { align: 'center' }), c('0,000', { align: 'right' }), c('0,000', { align: 'right' }), c('0,000', { align: 'right' }), c('+0.0%', { align: 'right' })],
          [c('○○ 금액', { align: 'center' }), c('000', { align: 'right' }), c('000', { align: 'right' }), c('000', { align: 'right' }), c('-0.0%', { align: 'right' })],
        ],
        { widths: [38, 32, 32, 36, 32], rowHeight: 8 },
      ),
      note('출처: ○○ 통계(2026. 9.), 단위: 건, 백만 원'),
      sec('Ⅲ', '문제점'),
      b1(['(절차) ', blank('처리 단계가 많아 평균 00일 소요')]),
      b2(blank('구체적 사례나 수치')),
      b1(['(제도) ', blank('근거 규정 미비로 현장 혼선')]),
      sec('Ⅳ', '개선 방안'),
      b1(['(단기) ', blank('절차 간소화: 0단계 → 0단계')]),
      b3(blank('세부 실행 내용')),
      b1(['(중장기) ', blank('○○ 규정 개정 추진(2027. 상반기)')]),
      sec('Ⅴ', '향후 계획'),
      table(
        [
          [th('추진 과제'), th('일정'), th('담당')],
          [c(blank('관계 기관 협의')), c(blank('2026. 11.'), { align: 'center' }), c(blank('○○과'), { align: 'center' })],
          [c(blank('시범 운영')), c(blank('2026. 12.'), { align: 'center' }), c(blank('○○팀'), { align: 'center' })],
          [c(blank('결과 보고')), c(blank('2027. 1.'), { align: 'center' }), c(blank('○○과'), { align: 'center' })],
        ],
        { widths: [90, 40, 40], rowHeight: 8 },
      ),
      gap(10),
      p('붙임  ○○○ 세부 자료 1부.  끝.', { size: 12 }),
    ]),
  }),
};

const weekly: DocTemplate = {
  id: 'weekly',
  name: '주간 업무 보고',
  category: '보고',
  desc: '금주 실적과 차주 계획을 나란히 적는 팀 주간 보고서, 이슈·건의 칸 포함',
  icon: 'CalendarRange',
  build: () => ({
    settings: settings({ landscape: true, width: 297, height: 210, marginTop: 15, marginBottom: 12, marginLeft: 15, marginRight: 15 }),
    content: doc([
      table(
        [[c([p([{ t: '주간 업무 보고', b: true, size: 18, font: HEAD, color: ACCENT }], { after: 2 }), p(['보고 기간: ', blank('2026. 10. 12.(월) ~ 10. 16.(금)'), '     부서: ', blank('○○팀'), '     작성: ', blank('홍길동')], { size: 10, color: '#444444' })], { border: 'l:none;r:none;t:none;b:2px solid ' + ACCENT }), c([approval(['담당', '팀장'], 16)], { border: 'l:none;r:none;t:none;b:2px solid ' + ACCENT, valign: 'middle' })]],
        { widths: [210, 57] },
      ),
      gap(8),
      table(
        [
          [th('업무 구분'), th('금주 실적'), th('진척'), th('차주 계획'), th('비고')],
          ...['핵심 과제', '일상 업무', '협업·지원'].map((k) => [
            c(k, { align: 'center', valign: 'middle', b: true, bg: '#F7F8FA' }),
            c([item('·', blank('완료한 일과 결과물'), 0, { size: 10 } as any), item('·', blank('수치나 산출물을 함께'), 0, { size: 10 } as any)]),
            c(blank('80%'), { align: 'center', valign: 'middle' }),
            c([item('·', blank('다음 주 할 일과 목표'), 0, { size: 10 } as any), item('·', blank('마감 일자'), 0, { size: 10 } as any)]),
            c('', {}),
          ]),
        ],
        { widths: [30, 90, 18, 90, 39], heights: [8, 24, 24, 24] },
      ),
      gap(8),
      table(
        [
          [th('이슈·위험'), c(blank('일정 지연 우려 등, 원인과 대응'))],
          [th('건의·요청'), c(blank('결정이 필요한 사항, 지원 요청'))],
        ],
        { widths: [30, 237], rowHeight: 11 },
      ),
    ]),
  }),
};

const trip: DocTemplate = {
  id: 'trip',
  name: '출장 결과 보고서',
  category: '보고',
  desc: '출장 개요 표, 주요 활동·성과, 시사점과 후속 조치, 경비 정산',
  icon: 'Plane',
  build: () => ({
    settings: withPageNo(settings({ marginTop: 20, marginLeft: 22, marginRight: 22 })),
    content: doc([
      approval(['담당', '팀장', '부서장']),
      gap(6),
      ...titleBox('출장 결과 보고', undefined, 166),
      sec('1', '출장 개요'),
      table(
        [
          [lbl('목    적'), val(blank('○○ 협력 방안 협의'), { span: 3 })],
          [lbl('기    간'), val(blank('2026. 10. 13.(화) ~ 10. 15.(목), 2박 3일')), lbl('장    소'), val(blank('부산 ○○센터'))],
          [lbl('출 장 자'), val(blank('○○팀 홍길동 대리 외 1명'), { span: 3 })],
          [lbl('방문 기관'), val(blank('○○기관(담당: ○○○ 과장)'), { span: 3 })],
        ],
        { widths: [26, 60, 26, 54], rowHeight: 9 },
      ),
      sec('2', '주요 활동'),
      table(
        [
          [th('일자'), th('시간'), th('활동 내용')],
          [c(blank('10. 13.(화)'), { align: 'center' }), c(blank('14:00~17:00'), { align: 'center' }), c(blank('○○ 현장 방문 및 현황 청취'))],
          [c(blank('10. 14.(수)'), { align: 'center' }), c(blank('10:00~12:00'), { align: 'center' }), c(blank('실무 협의(참석: ○○○ 외 3명)'))],
          [c(blank('10. 15.(목)'), { align: 'center' }), c(blank('09:30~11:00'), { align: 'center' }), c(blank('결과 정리 및 복귀'))],
        ],
        { widths: [30, 30, 106], rowHeight: 8 },
      ),
      sec('3', '성과 및 시사점'),
      b1(['(성과) ', blank('○○ 공동 추진에 합의, 실무 협의체 구성')]),
      b1(['(시사점) ', blank('우리 기관에 적용할 점')]),
      sec('4', '후속 조치'),
      b2([blank('협약안 작성'), ' (', blank('11. 5.까지'), ', ', blank('○○팀'), ')']),
      b2([blank('결과 공유 회의'), ' (', blank('11. 10.'), ')']),
      sec('5', '경비 정산'),
      table(
        [
          [th('항목'), th('금액(원)'), th('비고')],
          [c('교통비', { align: 'center' }), c(blank('000,000'), { align: 'right' }), c(blank('KTX 왕복'))],
          [c('숙박비', { align: 'center' }), c(blank('000,000'), { align: 'right' }), c(blank('2박'))],
          [c('일비·식비', { align: 'center' }), c(blank('000,000'), { align: 'right' }), c('')],
          [th('합계'), c(blank('000,000'), { align: 'right', b: true }), c('')],
        ],
        { widths: [40, 50, 76], rowHeight: 8 },
      ),
      gap(6),
      p('붙임  1. 회의 자료 1부.  2. 영수증 사본 1부.  끝.', { size: 11 }),
    ]),
  }),
};

// ───────────────────────── 회의·일정 ─────────────────────────

const minutes: DocTemplate = {
  id: 'minutes',
  name: '회의록',
  category: '회의·일정',
  desc: '회의 개요, 안건별 논의·결정 사항, 실행 과제(담당·기한) 표와 다음 회의',
  icon: 'Users',
  build: () => ({
    settings: withPageNo(settings({ marginTop: 20, marginLeft: 20, marginRight: 20 })),
    content: doc([
      p([{ t: '회 의 록', b: true, size: 24, font: HEAD, sp: 30, color: ACCENT }], { align: 'center', after: 14 }),
      table(
        [
          [lbl('회 의 명'), val(blank('2026년 4분기 ○○ 추진 회의'), { span: 3 })],
          [lbl('일    시'), val(blank('2026. 10. 20.(화) 14:00~15:30')), lbl('장    소'), val(blank('본관 3층 회의실'))],
          [lbl('주    관'), val(blank('○○팀')), lbl('작 성 자'), val(blank('홍길동'))],
          [lbl('참 석 자'), val(blank('김○○ 팀장, 이○○ 과장, 박○○ 대리 (총 0명)'), { span: 3 })],
          [lbl('불 참 자'), val(blank('최○○ (출장)'), { span: 3 })],
        ],
        { widths: [26, 60, 26, 58], rowHeight: 9 },
      ),
      gap(6),
      p([{ t: '■ 안건', b: true, size: 12, color: ACCENT }], { before: 8, after: 4 }),
      p(['1. ', blank('○○ 사업 진행 상황 점검')], { size: 11, indent: 8, lh: 1.6 }),
      p(['2. ', blank('예산 집행 계획 조정')], { size: 11, indent: 8, lh: 1.6 }),
      p([{ t: '■ 논의 내용', b: true, size: 12, color: ACCENT }], { before: 10, after: 4 }),
      table(
        [
          [th('안건'), th('주요 논의')],
          [c('1', { align: 'center', valign: 'middle' }), c([item('-', [blank('김 팀장'), ': ', blank('일정이 2주 늦어져 원인 확인 필요')], 0, { size: 10 } as any), item('-', [blank('이 과장'), ': ', blank('외부 업체 납품 지연이 원인, 대체 업체 검토 중')], 0, { size: 10 } as any)])],
          [c('2', { align: 'center', valign: 'middle' }), c([item('-', blank('남은 예산 0,000만 원 중 일부를 홍보비로 전환하는 안 논의'), 0, { size: 10 } as any)])],
        ],
        { widths: [16, 154], heights: [8, 24, 18] },
      ),
      p([{ t: '■ 결정 사항', b: true, size: 12, color: ACCENT }], { before: 10, after: 4 }),
      p(['✔ ', blank('대체 업체 견적을 받아 다음 회의에서 확정')], { size: 11, indent: 8, lh: 1.6, bg: '#F2F8F3' }),
      p(['✔ ', blank('홍보비 전환은 부서장 결재 후 시행')], { size: 11, indent: 8, lh: 1.6, bg: '#F2F8F3' }),
      p([{ t: '■ 실행 과제', b: true, size: 12, color: ACCENT }], { before: 10, after: 4 }),
      table(
        [
          [th('번호'), th('할 일'), th('담당'), th('기한'), th('상태')],
          [c('1', { align: 'center' }), c(blank('대체 업체 견적 3곳 요청')), c(blank('이○○'), { align: 'center' }), c(blank('10. 27.'), { align: 'center' }), c('진행 전', { align: 'center' })],
          [c('2', { align: 'center' }), c(blank('예산 전환 품의')), c(blank('박○○'), { align: 'center' }), c(blank('10. 23.'), { align: 'center' }), c('진행 전', { align: 'center' })],
          [c('3', { align: 'center' }), c(''), c('', { align: 'center' }), c('', { align: 'center' }), c('', { align: 'center' })],
        ],
        { widths: [14, 88, 24, 22, 22], rowHeight: 8 },
      ),
      gap(6),
      p([{ t: '■ 다음 회의  ', b: true, size: 11, color: ACCENT }, blank('2026. 10. 27.(화) 14:00, 같은 장소')], { size: 11 }),
    ]),
  }),
};

const plan: DocTemplate = {
  id: 'plan',
  name: '사업(행사) 추진 계획서',
  category: '회의·일정',
  desc: '목적·개요·세부 추진 내용·월별 추진 일정표·소요 예산·기대 효과를 갖춘 계획서',
  icon: 'ClipboardList',
  build: () => {
    const months = ['10월', '11월', '12월', '1월', '2월', '3월'];
    const bar = (on: boolean[]) => on.map((v) => c('', { bg: v ? '#4A6FA5' : undefined }));
    return {
      settings: withPageNo(settings({ marginTop: 20, marginLeft: 20, marginRight: 20 })),
      content: doc([
        ...titleBox('○○○ 추진 계획', `${today()}  ○○과`),
        sec('Ⅰ', '목적'),
        b1(blank('이 사업을 왜 하는지, 해결하려는 문제를 한두 줄로')),
        sec('Ⅱ', '사업 개요'),
        table(
          [
            [lbl('사 업 명'), val(blank('○○○ 지원 사업'), { span: 3 })],
            [lbl('기    간'), val(blank('2026. 10. ~ 2027. 3.(6개월)')), lbl('대    상'), val(blank('○○ 00명'))],
            [lbl('예    산'), val(blank('00,000천 원(국비 50%, 시비 50%)')), lbl('주    관'), val(blank('○○과'))],
            [lbl('주요 내용'), val(blank('교육 0회, 컨설팅 0건, 성과 공유회 1회'), { span: 3 })],
          ],
          { widths: [26, 60, 26, 58], rowHeight: 9 },
        ),
        sec('Ⅲ', '세부 추진 내용'),
        b1(['(교육) ', blank('분야별 실무 교육 0회 운영')]),
        b2(blank('교육 방식, 강사, 장소')),
        b1(['(컨설팅) ', blank('전문가 현장 방문 컨설팅 0건')]),
        b1(['(홍보) ', blank('누리집·누리소통망 안내, 보도자료 배포')]),
        sec('Ⅳ', '추진 일정'),
        table(
          [
            [th('추진 과제'), ...months.map((m) => th(m))],
            [c(blank('계획 수립·공고')), ...bar([true, false, false, false, false, false])],
            [c(blank('대상자 선정')), ...bar([true, true, false, false, false, false])],
            [c(blank('교육·컨설팅 운영')), ...bar([false, true, true, true, true, false])],
            [c(blank('성과 공유·평가')), ...bar([false, false, false, false, true, true])],
          ],
          { widths: [56, 19, 19, 19, 19, 19, 19], rowHeight: 8 },
        ),
        sec('Ⅴ', '소요 예산'),
        table(
          [
            [th('구분'), th('산출 근거'), th('금액(천 원)')],
            [c('교육비', { align: 'center' }), c(blank('강사료 000천 원 × 0회')), c(blank('0,000'), { align: 'right' })],
            [c('컨설팅비', { align: 'center' }), c(blank('000천 원 × 0건')), c(blank('0,000'), { align: 'right' })],
            [c('홍보비', { align: 'center' }), c(blank('인쇄·광고')), c(blank('000'), { align: 'right' })],
            [th('합계'), c(''), c(blank('00,000'), { align: 'right', b: true })],
          ],
          { widths: [32, 98, 40], rowHeight: 8 },
        ),
        sec('Ⅵ', '기대 효과'),
        b1(blank('정량 효과: 참여자 만족도 00점 이상, ○○ 00% 향상')),
        b1(blank('정성 효과: 기관 간 협력 체계 마련')),
        gap(10),
        p('붙임  세부 운영 계획 1부.  끝.', { size: 12 }),
      ]),
    };
  },
};

// ───────────────────────── 재무·구매 ─────────────────────────

const pumui: DocTemplate = {
  id: 'pumui',
  name: '품의서 (지출 결의)',
  category: '재무·구매',
  desc: '결재란, 건명·금액(한글 금액 병기)·지출 내역 표·지급 방법·첨부를 갖춘 품의서',
  icon: 'Receipt',
  build: () => ({
    settings: settings({ marginTop: 20, marginLeft: 22, marginRight: 22 }),
    content: doc([
      approval(['담당', '팀장', '부서장', '대표']),
      gap(8),
      p([{ t: '품  의  서', b: true, size: 24, font: HEAD, sp: 20 }], { align: 'center', after: 14 }),
      table(
        [
          [lbl('문서 번호'), val(blank('○○-2026-000')), lbl('작 성 일'), val(today())],
          [lbl('기안 부서'), val(blank('○○팀')), lbl('기 안 자'), val(blank('홍길동'))],
          [lbl('건    명'), val(blank('○○ 장비 구입'), { span: 3, b: true })],
          [lbl('금    액'), val(['금 ', blank('일백일십만'), '원정 (₩', blank('1,100,000'), ', 부가세 포함)'], { span: 3 })],
          [lbl('예산 과목'), val(blank('○○비 / 사무용품비')), lbl('집행 잔액'), val(blank('0,000,000원'))],
        ],
        { widths: [26, 58, 26, 56], rowHeight: 9 },
      ),
      gap(10),
      p([{ t: '1. 목적', b: true }], { size: 12, after: 4 }),
      p(blank('노후 장비 교체로 업무 효율을 높이고자 아래와 같이 구입하고자 합니다.'), { size: 11, indent: 12, lh: 1.6, after: 8 }),
      p([{ t: '2. 지출 내역', b: true }], { size: 12, after: 4 }),
      table(
        [
          [th('번호'), th('품명'), th('규격'), th('수량'), th('단가'), th('금액')],
          [c('1', { align: 'center' }), c(blank('노트북')), c(blank('15형, 16GB')), c(blank('1'), { align: 'center' }), c(blank('1,000,000'), { align: 'right' }), c(blank('1,000,000'), { align: 'right' })],
          [c('2', { align: 'center' }), c(''), c(''), c('', { align: 'center' }), c('', { align: 'right' }), c('', { align: 'right' })],
          [th('공급가액', { span: 5 }), c(blank('1,000,000'), { align: 'right' })],
          [th('부가세', { span: 5 }), c(blank('100,000'), { align: 'right' })],
          [th('합계', { span: 5 }), c(blank('1,100,000'), { align: 'right', b: true })],
        ],
        { widths: [13, 45, 36, 16, 28, 28], rowHeight: 8 },
      ),
      gap(8),
      p([{ t: '3. 거래처 및 지급 방법', b: true }], { size: 12, after: 4 }),
      p(['- 거래처: ', blank('(주)○○ (사업자등록번호 000-00-00000)')], { size: 11, indent: 12, lh: 1.6 }),
      p(['- 지급: ', blank('납품 확인 후 계좌 이체 (○○은행 000-000-000000)')], { size: 11, indent: 12, lh: 1.6, after: 8 }),
      p([{ t: '4. 첨부', b: true }], { size: 12, after: 4 }),
      p(blank('견적서 2부(비교 견적), 제품 사양서 1부.'), { size: 11, indent: 12, lh: 1.6, after: 18 }),
      p('위와 같이 품의하오니 재가하여 주시기 바랍니다.', { align: 'center', size: 12 }),
    ]),
  }),
};

const quote: DocTemplate = {
  id: 'quote',
  name: '견적서',
  category: '재무·구매',
  desc: '공급자 정보(등록번호·상호·대표·업태), 품목 표, 공급가액·세액·합계와 거래 조건',
  icon: 'Calculator',
  build: () => {
    const row = (n: number): (Cell | string)[] => [c(String(n), { align: 'center' }), c(n === 1 ? blank('품목명') : ''), c(n === 1 ? blank('규격') : ''), c(n === 1 ? blank('1') : '', { align: 'center' }), c(n === 1 ? blank('0') : '', { align: 'right' }), c(n === 1 ? blank('0') : '', { align: 'right' }), c('')];
    return {
      settings: settings({ marginTop: 18, marginBottom: 15, marginLeft: 18, marginRight: 18 }),
      content: doc([
        p([{ t: '견  적  서', b: true, size: 26, font: HEAD, sp: 30, color: ACCENT }], { align: 'center', after: 12 }),
        table(
          [
            [
              c([p(['견적일: ', today()], { size: 10, after: 6 }), p([blank('○○주식회사', { b: true, size: 14 }), { t: '  귀하', size: 12 }], { after: 8 }), p('아래와 같이 견적합니다.', { size: 10, after: 6 }), p([{ t: '합계 금액  ', b: true, size: 11 }, blank('₩ 0,000,000', { b: true, size: 14 }), { t: ' (부가세 포함)', size: 9 }])], { valign: 'middle', border: 'l:none;t:none;b:none;r:none' }),
              c(
                [
                  table(
                    [
                      [c('공\n\n급\n\n자', { rows: 4, bg: '#EDEFF3', align: 'center', valign: 'middle', b: true, size: 9 }), lbl('등록번호', { size: 9 }), val(blank('000-00-00000'), { span: 3, size: 9 })],
                      [lbl('상    호', { size: 9 }), val(blank('(주)○○'), { size: 9 }), lbl('대표', { size: 9 }), val([blank('○○○'), ' (인)'], { size: 9 })],
                      [lbl('주    소', { size: 9 }), val(blank('○○시 ○○구 ○○로 00'), { span: 3, size: 9 })],
                      [lbl('연 락 처', { size: 9 }), val(blank('02-000-0000'), { span: 3, size: 9 })],
                    ],
                    { widths: [7, 18, 26, 12, 27], rowHeight: 7 },
                  ),
                ],
                { border: 'l:none;t:none;b:none;r:none' },
              ),
            ],
          ],
          { widths: [88, 92] },
        ),
        gap(10),
        table(
          [
            [th('No'), th('품명'), th('규격'), th('수량'), th('단가'), th('공급가액'), th('비고')],
            ...[1, 2, 3, 4, 5, 6, 7, 8].map(row),
            [th('공급가액 합계', { span: 5 }), c(blank('0'), { align: 'right' }), c('')],
            [th('세액 (10%)', { span: 5 }), c(blank('0'), { align: 'right' }), c('')],
            [th('총    액', { span: 5, bg: '#DCE3EE' }), c(blank('0'), { align: 'right', b: true, bg: '#DCE3EE' }), c('', { bg: '#DCE3EE' })],
          ],
          { widths: [10, 50, 32, 14, 24, 28, 22], rowHeight: 7.5 },
        ),
        gap(10),
        p([{ t: '거래 조건', b: true, color: ACCENT }], { size: 11, after: 4 }),
        p(['· 유효 기간: 견적일로부터 ', blank('30일')], { size: 10, lh: 1.6, indent: 6 }),
        p(['· 납기: 발주 후 ', blank('14일 이내')], { size: 10, lh: 1.6, indent: 6 }),
        p(['· 결제: ', blank('납품 후 30일 이내 현금')], { size: 10, lh: 1.6, indent: 6 }),
        p(['· 입금 계좌: ', blank('○○은행 000-000-000000 (예금주: (주)○○)')], { size: 10, lh: 1.6, indent: 6 }),
      ]),
    };
  },
};

// ───────────────────────── 인사·개인 ─────────────────────────

const resume: DocTemplate = {
  id: 'resume',
  name: '이력서',
  category: '인사·개인',
  desc: '사진 칸과 인적 사항, 학력·경력·자격·수상 표, 자기소개를 담은 국문 이력서',
  icon: 'IdCard',
  build: () => {
    const hist = (heads: string[], widths: number[], n: number, sample: string[]) =>
      table([heads.map((x) => th(x, { size: 10 })), ...Array.from({ length: n }, (_, i) => heads.map((_h, k) => c(i === 0 ? blank(sample[k]) : '', { size: 10, align: k === heads.length - 1 ? 'left' : 'center' })))], { widths, rowHeight: 8 });
    const part = (t: string) => p([{ t, b: true, size: 12, color: ACCENT, font: HEAD }], { before: 12, after: 4 });
    return {
      settings: settings({ marginTop: 18, marginBottom: 15, marginLeft: 20, marginRight: 20 }),
      content: doc([
        p([{ t: '이  력  서', b: true, size: 26, font: HEAD, sp: 30 }], { align: 'center', after: 14 }),
        table(
          [
            [c([p('사진', { align: 'center', color: '#999999', size: 10 }), p('(3×4cm)', { align: 'center', color: '#999999', size: 9 })], { rows: 4, valign: 'middle' }), lbl('성    명'), val(blank('홍길동')), lbl('생년월일'), val(blank('1995. 3. 15.'))],
            [lbl('영    문'), val(blank('HONG GIL DONG')), lbl('휴 대 폰'), val(blank('010-0000-0000'))],
            [lbl('이 메 일'), val(blank('name@example.com'), { span: 3 })],
            [lbl('주    소'), val(blank('○○시 ○○구 ○○로 00, 000동 000호'), { span: 3 })],
          ],
          { widths: [32, 24, 46, 24, 44], heights: [11, 11, 11, 11] },
        ),
        part('학력 사항'),
        hist(['기간', '학교명', '전공', '구분'], [42, 56, 46, 26], 3, ['2014. 3. ~ 2020. 2.', '○○대학교', '○○학과', '졸업']),
        part('경력 사항'),
        hist(['기간', '회사명', '부서·직위', '담당 업무'], [42, 42, 34, 52], 3, ['2020. 3. ~ 현재', '(주)○○', '○○팀 대리', '○○ 기획·운영']),
        part('자격·어학'),
        hist(['취득일', '자격·시험명', '등급·점수', '발행처'], [32, 62, 34, 42], 3, ['2021. 6.', '정보처리기사', '합격', '한국산업인력공단']),
        part('수상·활동'),
        hist(['기간', '내용', '기관'], [42, 86, 42], 2, ['2019. 11.', '○○ 공모전 최우수상', '○○협회']),
        part('자기소개'),
        table([[c([p(blank('지원 동기, 강점과 경험(구체적 성과·수치), 입사 후 포부를 순서대로 적습니다.'), { size: 10, lh: 1.7 }), p(''), p(''), p('')])]], { widths: [170], heights: [60] }),
        gap(14),
        p('위의 기재 사항은 사실과 다름이 없습니다.', { align: 'center', size: 11, after: 10 }),
        p(today('korean'), { align: 'center', size: 11, after: 10 }),
        p(['작성자  ', blank('홍길동'), '  (서명)'], { align: 'right', size: 11 }),
      ]),
    };
  },
};

// ───────────────────────── 홍보·안내 ─────────────────────────

const press: DocTemplate = {
  id: 'press',
  name: '보도자료',
  category: '홍보·안내',
  desc: '보도 시점·배포일·담당 연락처 머리 표, 제목·부제, 핵심 요약과 본문, 사진 설명',
  icon: 'Newspaper',
  build: () => ({
    settings: withPageNo(settings({ marginTop: 15, marginBottom: 15, marginLeft: 20, marginRight: 20 })),
    content: doc([
      table(
        [
          [c([p([{ t: '보 도 자 료', b: true, size: 22, font: HEAD, color: '#FFFFFF', sp: 20 }], { align: 'center' })], { bg: ACCENT, rows: 5, valign: 'middle' }), lbl('보도 일시'), val([blank('2026. 10. 20.(화) 조간'), ' (온라인 10. 19. 12:00)'])],
          [lbl('배포 일시'), val(blank('2026. 10. 18.(일) 09:00'))],
          [lbl('담당 부서'), val(blank('○○과'))],
          [lbl('책 임 자'), val([blank('과장 ○○○'), ' (', blank('02-000-0000'), ')'])],
          [lbl('담 당 자'), val([blank('주무관 ○○○'), ' (', blank('02-000-0000'), ')'])],
        ],
        { widths: [48, 26, 96], rowHeight: 8 },
      ),
      gap(14),
      p([{ t: blank('○○시, 청년 창업 지원 2배로 늘린다').t, b: true, size: 20, font: HEAD, hl: '#FFF4C2' }], { align: 'center', after: 6 }),
      p([{ t: '- ', size: 13, color: '#444444' }, blank('2027년부터 지원 규모 200억 원… 사무 공간·멘토링 함께 제공', { size: 13, color: '#444444' }), { t: ' -', size: 13, color: '#444444' }], { align: 'center', after: 14 }),
      table(
        [[c([item('▲', blank('핵심 내용 1 (무엇을, 얼마나)'), 0, { size: 11 } as any), item('▲', blank('핵심 내용 2 (언제부터, 누구에게)'), 0, { size: 11 } as any), item('▲', blank('핵심 내용 3 (기대 효과)'), 0, { size: 11 } as any)], { bg: '#F4F6FA', border: `l:4px solid ${ACCENT};t:none;b:none;r:none` })]],
        { widths: [170] },
      ),
      gap(10),
      p(['□ ', blank('○○시(시장 ○○○)는 ... 라고 밝혔다. (첫 문단에 누가·언제·어디서·무엇을·어떻게·왜를 모두 담습니다)')], { size: 12, lh: 1.8, indent: 14, first: -14, after: 8 }),
      p(['□ ', blank('세부 내용과 배경, 수치 근거')], { size: 12, lh: 1.8, indent: 14, first: -14, after: 4 }),
      p(['  ○ ', blank('하위 설명')], { size: 12, lh: 1.8, indent: 28, first: -14, after: 8 }),
      p(['□ ', blank('○○○ 시장은 “...”라고 말했다. (인용은 한두 문장)')], { size: 12, lh: 1.8, indent: 14, first: -14, after: 8 }),
      p(['□ ', blank('신청 방법과 문의처: ○○과(02-000-0000), 누리집 www.○○.go.kr')], { size: 12, lh: 1.8, indent: 14, first: -14, after: 14 }),
      p([{ t: '[사진 설명] ', b: true }, blank('사진 속 장면과 인물(왼쪽부터)')], { size: 10, color: '#555555', after: 4 }),
      p('붙임  1. 사업 개요 1부.  2. 관련 사진 2매.  끝.', { size: 11 }),
    ]),
  }),
};

const notice: DocTemplate = {
  id: 'notice',
  name: '안내문 (공지)',
  category: '홍보·안내',
  desc: '게시판·배포용 한 장 안내문: 큰 제목, 일시·장소·대상 표, 유의 사항, 문의처',
  icon: 'Megaphone',
  build: () => ({
    settings: settings({ marginTop: 22, marginBottom: 18, marginLeft: 22, marginRight: 22 }),
    content: doc([
      p([{ t: '안  내', size: 12, color: '#FFFFFF', b: true, sp: 40 }], { align: 'center', bg: ACCENT, before: 4, after: 4 }),
      gap(10),
      p([{ t: blank('건물 정기 소독 실시 안내').t, b: true, size: 26, font: HEAD, color: ACCENT, hl: '#FFF4C2' }], { align: 'center', after: 10 }),
      p(blank('쾌적한 환경을 위해 아래와 같이 정기 소독을 실시하오니 협조하여 주시기 바랍니다.'), { align: 'center', size: 12, lh: 1.7, after: 16 }),
      table(
        [
          [th('일    시', { size: 12 }), c(blank('2026. 10. 24.(토) 10:00 ~ 16:00'), { size: 12, valign: 'middle' })],
          [th('장    소', { size: 12 }), c(blank('본관 전 층 및 지하 주차장'), { size: 12, valign: 'middle' })],
          [th('대    상', { size: 12 }), c(blank('입주 사무실 전체'), { size: 12, valign: 'middle' })],
          [th('내    용', { size: 12 }), c(blank('방역·해충 방제 소독'), { size: 12, valign: 'middle' })],
        ],
        { widths: [36, 130], rowHeight: 12 },
      ),
      gap(14),
      p([{ t: '유의 사항', b: true, size: 13, color: ACCENT }], { after: 6 }),
      item('①', blank('소독 시간에는 출입을 삼가 주십시오.'), 0, { size: 12 } as any),
      item('②', blank('음식물과 개인 물품은 서랍 안에 보관해 주십시오.'), 0, { size: 12 } as any),
      item('③', blank('소독 후 30분 이상 환기해 주십시오.'), 0, { size: 12 } as any),
      gap(24),
      p(today('korean'), { align: 'center', size: 13, after: 10 }),
      p([{ t: blank('○○빌딩 관리사무소').t, b: true, size: 16, hl: '#FFF4C2' }], { align: 'center', after: 18 }),
      table([[c([p([{ t: '문의  ', b: true }, blank('관리사무소 02-000-0000 (평일 09:00~18:00)')], { align: 'center', size: 11 })], { bg: '#F4F6FA', border: 'l:none;r:none;t:1px solid ' + LINE + ';b:1px solid ' + LINE })]], { widths: [166] }),
    ]),
  }),
};

export const TEMPLATES: DocTemplate[] = [gianmun, report, minutes, plan, weekly, trip, pumui, quote, leave, resume, press, notice];

export const CATEGORY_ORDER: DocTemplate['category'][] = ['공문·행정', '보고', '회의·일정', '재무·구매', '인사·개인', '홍보·안내'];
