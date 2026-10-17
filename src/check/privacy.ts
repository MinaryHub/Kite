import type { Node as PMNode } from '@tiptap/pm/model';
import { textRuns } from './checker';

/**
 * 개인정보 찾기: 주민등록번호·외국인등록번호, 전화번호, 이메일, 카드 번호, 계좌 번호(추정), 여권 번호, 운전면허 번호.
 * 찾은 것은 부분 가림(앞뒤 일부만 남김) 또는 전체 가림으로 바꾼다.
 */

export type PrivacyKind = 'rrn' | 'phone' | 'email' | 'card' | 'account' | 'passport' | 'license';

export const PRIVACY_LABEL: Record<PrivacyKind, string> = {
  rrn: '주민등록번호',
  phone: '전화번호',
  email: '이메일',
  card: '카드 번호',
  account: '계좌 번호(추정)',
  passport: '여권 번호',
  license: '운전면허 번호',
};

export interface PrivacyHit {
  kind: PrivacyKind;
  text: string;
  from: number;
  to: number;
  context: string;
}

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

/** 앞뒤가 숫자·영문이 아닌 자리에서만 찾는다 (긴 번호의 일부를 잘못 잡지 않게) */
const B = '(?<![0-9A-Za-z])';
const E = '(?![0-9A-Za-z])';

interface Pattern {
  kind: PrivacyKind;
  re: RegExp;
  ok?: (m: RegExpExecArray) => boolean;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'rrn',
    // 생년월일 6자리 + 성별 자리(1–8) + 6자리
    re: new RegExp(`${B}(\\d{2})(\\d{2})(\\d{2})\\s?[-–]\\s?([1-8])\\d{6}${E}|${B}(\\d{2})(\\d{2})(\\d{2})([1-8])\\d{6}${E}`, 'g'),
    ok: (m) => {
      const mo = +(m[2] ?? m[6]);
      const d = +(m[3] ?? m[7]);
      return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    },
  },
  {
    kind: 'card',
    re: new RegExp(`${B}\\d{4}([- ])\\d{4}\\1\\d{4}\\1\\d{4}${E}|${B}\\d{16}${E}|${B}3[47]\\d{2}([- ])\\d{6}\\2\\d{5}${E}`, 'g'),
    ok: (m) => luhn(m[0].replace(/\D/g, '')),
  },
  { kind: 'license', re: new RegExp(`${B}\\d{2}-\\d{2}-\\d{6}-\\d{2}${E}`, 'g') },
  {
    kind: 'phone',
    re: new RegExp(`${B}(?:\\+82[- ]?(?:1[016789]|2|[3-6][1-5]|70)|0(?:1[016789]|2|[3-6][1-5]|70|50\\d))[-. )]?\\d{3,4}[-. ]?\\d{4}${E}`, 'g'),
    // 하이픈·점·공백 없이 붙은 숫자는 휴대폰 번호(010…)만
    ok: (m) => /[-. )]/.test(m[0]) || /^01[016789]\d{7,8}$/.test(m[0]),
  },
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'passport', re: new RegExp(`${B}[MSRODG](?:\\d{8}|\\d{3}[A-Z]\\d{4})${E}`, 'g') },
  {
    kind: 'account',
    // 하이픈으로 더 이어지는 긴 번호(ISBN·문서 번호 등)의 일부는 잡지 않는다
    re: new RegExp(`(?<![0-9A-Za-z-])\\d{2,6}-\\d{2,6}-\\d{2,7}(?:-\\d{1,3})?(?![0-9A-Za-z]|-\\d)`, 'g'),
    ok: (m) => {
      const n = m[0].replace(/\D/g, '').length;
      // 날짜(2024-01-05)·전화번호 꼴은 빼고, 10–14자리만
      return n >= 10 && n <= 14 && !/^(19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(m[0]);
    },
  },
];

export function findPrivacy(doc: PMNode, kinds?: Set<PrivacyKind>): PrivacyHit[] {
  const out: PrivacyHit[] = [];
  for (const run of textRuns(doc)) {
    const taken: [number, number][] = [];
    for (const p of PATTERNS) {
      if (kinds && !kinds.has(p.kind)) continue;
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(run.text))) {
        const a = m.index;
        const b = a + m[0].length;
        if (!m[0] || (p.ok && !p.ok(m))) continue;
        // 앞선 종류(주민번호·카드 등)로 이미 잡은 자리는 건너뛴다
        if (taken.some(([x, y]) => a < y && b > x)) continue;
        if (m[0].includes('￼')) continue;
        taken.push([a, b]);
        const s = Math.max(0, a - 12);
        const e = Math.min(run.text.length, b + 12);
        out.push({
          kind: p.kind,
          text: m[0],
          from: run.pos[a],
          to: run.pos[b - 1] + 1,
          context: (s > 0 ? '…' : '') + run.text.slice(s, e).replace(/\n/g, ' ') + (e < run.text.length ? '…' : ''),
        });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** 가린 글자. full 이면 숫자·글자를 모두 가리고, 아니면 알아볼 만큼만 남긴다 */
export function maskText(h: Pick<PrivacyHit, 'kind' | 'text'>, full: boolean, ch = '*'): string {
  const t = h.text;
  const maskAll = (s: string) => s.replace(/[0-9A-Za-z가-힣]/g, ch);
  if (full) return maskAll(t);
  switch (h.kind) {
    case 'rrn': {
      // 900101-1****** : 생년월일과 성별 자리만
      const m = /^(\d{6}\s?[-–]?\s?\d)(.*)$/.exec(t);
      return m ? m[1] + maskAll(m[2]) : maskAll(t);
    }
    case 'phone': {
      // 010-****-5678 : 가운데 국번만
      const m = /^(.*?)(\d{3,4})([-. ]?)(\d{4})$/.exec(t);
      return m ? m[1] + maskAll(m[2]) + m[3] + m[4] : maskAll(t);
    }
    case 'email': {
      const [id, dom] = t.split('@');
      return id.slice(0, Math.min(2, Math.max(1, id.length - 1))) + ch.repeat(Math.max(1, id.length - 2)) + '@' + dom;
    }
    case 'card':
    case 'account':
    case 'license': {
      // 끝 4자리만
      let keep = 4;
      let out = '';
      for (let i = t.length - 1; i >= 0; i--) {
        if (/\d/.test(t[i]) && keep > 0) {
          out = t[i] + out;
          keep--;
        } else out = (/\d/.test(t[i]) ? ch : t[i]) + out;
      }
      return out;
    }
    case 'passport':
      return t[0] + maskAll(t.slice(1, -3)) + t.slice(-3);
  }
}
