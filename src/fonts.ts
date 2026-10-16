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

const SERIF_RE = /바탕|명조|궁서|신명|Batang|Myeongjo|Gungsuh|serif|Times|Georgia|Cambria|Garamond|Mincho|Song|Ming|윤명조|한양신|본명조/i;

const SANS_RE = /고딕|돋움|굴림|헤드라인|그래픽|Gothic|Dotum|Gulim|Sans|Arial|Helvetica|Verdana|Tahoma|Segoe|Calibri|Malgun|맑은|나눔스퀘어|Pretendard|Noto Sans|Roboto|Inter/i;

/** 시스템에 설치된 글꼴 이름 (앱이 시작할 때 채워진다; 비어 있으면 모름). 글꼴 목록 UI 용 —
 * 한글이 자기 폴더 글꼴을 세션에 등록해 두면 여기 이름이 있어도 브라우저(DirectWrite)는 그리지 못하므로 사용 가능 여부는 fontUsable 로 본다 */
export const installedFonts = new Set<string>();

const usableCache = new Map<string, boolean>();
let probeCtx: CanvasRenderingContext2D | null | undefined;

/** 이 이름의 글꼴로 실제로 글자를 그릴 수 있는가 (대체 글꼴과 폭이 다르면 있는 것으로 본다) */
export function fontUsable(name: string): boolean {
  if (typeof document === 'undefined') return true;
  const n = name.trim();
  if (!n) return false;
  const hit = usableCache.get(n);
  if (hit != null) return hit;
  if (probeCtx === undefined) probeCtx = document.createElement('canvas').getContext('2d');
  if (!probeCtx) return true;
  const ctx = probeCtx;
  const text = '가나다ABCxyz·123';
  const w = (f: string) => {
    ctx.font = `24px ${f}`;
    return ctx.measureText(text).width;
  };
  const q = `'${n.replace(/['"\\]/g, '')}'`;
  const ok = w(`${q}, monospace`) !== w('monospace') || w(`${q}, serif`) !== w('serif');
  usableCache.set(n, ok);
  return ok;
}

/** 글꼴을 새로 올렸을 때 (FontFace) */
function markUsable(name: string) {
  usableCache.set(name.trim(), true);
}

/** 한컴오피스 폴더에만 있는 글꼴 이름 → 그 글꼴 파일의 이름들 (앱이 시작할 때 채워진다) */
export const privateFontNames = new Map<string, string[]>();
const privateLoaded = new Set<string>();

/** 문서의 글꼴 이름 → 같은 글꼴의 다른 이름들 (옛 한양시스템 이름, 한글이 쓰는 HY 이름, 윈도우에 영문으로 설치된 이름) */
const FONT_ALIASES: Record<string, string[]> = {
  한양중고딕: ['HY중고딕', 'HYGothic-Medium'],
  한양견고딕: ['HY견고딕', 'HYGothic-Extra'],
  한양신명조: ['HY신명조', 'HYSinMyeongJo-Medium'],
  한양견명조: ['HY견명조', 'HYMyeongJo-Extra'],
  한양그래픽: ['HY그래픽', 'HYGraphic-Medium'],
  한양궁서: ['HY궁서', 'HYGungSo-Bold'],
  한양목판: ['HY목판L', 'HYPMokGak-Bold'],
  한양엽서: ['HY엽서M', 'HYPost-Medium'],
  한양얕은샘물: ['HY얕은샘물M', 'HYShortSamul-Medium'],
  '#신명조': ['HY신명조', 'HYSinMyeongJo-Medium'],
  '#중고딕': ['HY중고딕', 'HYGothic-Medium'],
  '#견고딕': ['HY견고딕', 'HYGothic-Extra'],
  '#견명조': ['HY견명조', 'HYMyeongJo-Extra'],
  '#헤드라인': ['HY헤드라인M', 'HYHeadLine-Medium'],
  '#궁서': ['HY궁서', 'HYGungSo-Bold'],
  HY헤드라인M: ['HYHeadLine-Medium'],
  HY중고딕: ['HYGothic-Medium'],
  HY견고딕: ['HYGothic-Extra'],
  HY신명조: ['HYSinMyeongJo-Medium'],
  HY견명조: ['HYMyeongJo-Extra'],
  HY그래픽: ['HYGraphic-Medium'],
  HY궁서: ['HYGungSo-Bold'],
  HY울릉도M: ['HYwulM'],
  HY엽서M: ['HYPost-Medium'],
  HY엽서L: ['HYPost-Light'],
};

/** 한컴 폴더에서 올릴 수 있는 글꼴이면 그 파일의 이름(별칭 포함) */
export function privateFontFor(name: string): string | null {
  const n = name.trim();
  if (privateFontNames.has(n)) return n;
  for (const a of FONT_ALIASES[n] || []) if (privateFontNames.has(a)) return a;
  return null;
}

/** 그 이름으로는 못 그리지만 다른 이름으로 설치되어 있으면 그 이름 */
function usableAlias(name: string): string | null {
  for (const a of FONT_ALIASES[name.trim()] || []) if (fontUsable(a)) return a;
  return null;
}

/**
 * 문서가 쓰는 글꼴 가운데 시스템에는 없지만 한컴오피스 폴더에 있는 것을 FontFace 로 올린다.
 * (HY헤드라인M, 한컴 윤고딕 등은 한글이 자기 폴더에만 설치하므로 브라우저는 모른다)
 * 올라오면 document.fonts 의 loadingdone 으로 쪽 나누기가 다시 돈다.
 */
/** 자가 점검용 기록 (어떤 글꼴을 요청했고 무엇이 올라왔는지) */
export const privateFontLog: { requested: string[]; loaded: string[]; failed: string[]; known: number; seen: string[] } = { requested: [], loaded: [], failed: [], known: 0, seen: [] };
if (typeof window !== 'undefined') (window as any).__kiteFontLog = privateFontLog;

export async function ensurePrivateFonts(names: Iterable<string>, read: (name: string) => Promise<{ names: string[]; data: Uint8Array } | null>): Promise<void> {
  const jobs: Promise<void>[] = [];
  privateFontLog.known = privateFontNames.size;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    privateFontLog.seen.push(`${name}${fontUsable(name) ? '(사용가능)' : ''}${privateLoaded.has(name) ? '(이미)' : ''}${privateFontFor(name) ? '(한컴:' + privateFontFor(name) + ')' : ''}`);
    if (privateLoaded.has(name) || fontUsable(name) || usableAlias(name)) continue;
    const source = privateFontFor(name);
    if (!source) continue;
    privateLoaded.add(name);
    privateFontLog.requested.push(name);
    jobs.push(
      (async () => {
        try {
          const f = await read(source);
          if (!f) return;
          const buf = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer;
          // 파일에 적힌 이름이 여럿이면(한국어·영어) 각각 등록해 어느 이름으로 참조해도 맞게 한다
          const aliases = new Set<string>([name, ...f.names]);
          for (const alias of aliases) {
            if (alias !== name && fontUsable(alias)) continue;
            const face = new FontFace(alias, buf);
            await face.load();
            document.fonts.add(face);
            privateLoaded.add(alias);
            markUsable(alias);
            privateFontLog.loaded.push(alias);
          }
        } catch (e) {
          privateFontLog.failed.push(`${name}: ${String((e as any)?.message || e)}`);
          console.warn('글꼴을 올리지 못했습니다:', name, e);
        }
      })(),
    );
  }
  await Promise.all(jobs);
}

/** 문서 JSON 에서 쓰인 글꼴 이름들 */
export function collectFontNames(doc: any): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    for (const m of n.marks || []) if (m?.type === 'textStyle' && typeof m.attrs?.fontFamily === 'string') out.add(m.attrs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
    for (const c of n.content || []) walk(c);
  };
  walk(doc);
  return out;
}

/** 이름만으로 굵은 제목용 글꼴임을 알 수 있는 것들 (설치되어 있지 않으면 대체 글꼴을 굵게 보여 준다) */
const HEAVY_RE = /헤드라인|견고딕|견명조|태고딕|태명조|굵은|Headline|Black|Heavy|ExtraBold|Bold|\bB$/i;

/** 설치되지 않은 제목용 글꼴이면 굵게 */
export function fontWeightFallback(name: string): string | null {
  if (!HEAVY_RE.test(name)) return null;
  const n = name.trim();
  if (fontUsable(n) || usableAlias(n)) return null;
  // 한컴 폴더에서 실제 글꼴을 올릴 수 있으면 굵기를 흉내 내지 않는다
  if (privateFontFor(n)) return null;
  return '700';
}

/** 설치되지 않은 글꼴을 위한 대체 글꼴 목록 (한글처럼 명조/고딕 계열 유지) */
export function fontStack(name: string): string {
  // 문서에서 온 글꼴 이름이므로 CSS 구문을 바꿀 수 있는 문자는 모두 제거
  const safe = name.replace(/[\u0000-\u001f\u007f'"\\;:{}()<>@[\]]/g, '').trim().slice(0, 80) || '함초롬바탕';
  // 그 이름으로는 못 그리지만 다른 이름(영문 이름·HY 이름)으로 설치되어 있으면 그 이름을 먼저 둔다
  const alias = fontUsable(safe) ? null : usableAlias(safe);
  const q = alias ? `'${alias}', '${safe}'` : `'${safe}'`;
  if (/D2Coding|Consolas|Courier|Mono|코딩/i.test(name)) return `${q}, D2Coding, Consolas, monospace`;
  // kite-sym: 가운뎃점(·) 등 몇몇 기호만 맡는 글꼴(editor.css 의 @font-face, unicode-range).
  // 휴먼명조·HY 계열 글꼴은 이 기호를 전각으로 그리지만 한글은 기호 글꼴로 반각으로 보여 주므로 그에 맞춘다.
  // 한글은 설치되지 않은 글꼴을 기본 글꼴(함초롬바탕)로 보여 준다. 이름이 분명히 고딕 계열일 때만 고딕으로 대신한다
  return SANS_RE.test(name) && !SERIF_RE.test(name)
    ? `'kite-sym', ${q}, '함초롬돋움', 'HCR Dotum', '맑은 고딕', 'Malgun Gothic', sans-serif, 'Segoe UI Symbol', Wingdings`
    : `'kite-sym', ${q}, '함초롬바탕', 'HCR Batang', '휴먼명조', '바탕', Batang, serif, 'Segoe UI Symbol', Wingdings`;
}

export function cssFontFamily(name: string): string {
  return fontStack(name);
}
