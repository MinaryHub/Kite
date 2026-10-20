/**
 * Kite 문의 중계: 앱의 문의 창이 보낸 내용을 Brevo 로 개발사 메일에 전달한다.
 * Brevo API 키와 받는 주소는 이 서버의 환경 변수에만 있다 (앱에는 이 함수 주소만 들어간다).
 *
 * 환경 변수 (Vercel → Project → Settings → Environment Variables)
 *   BREVO_API_KEY   Brevo → SMTP & API → API Keys 에서 만든 키
 *   CONTACT_TO      문의를 받을 주소
 *   CONTACT_SENDER  Brevo 에서 확인(verify)한 보내는 주소 (Senders & IP → Senders)
 *
 * 받을 때: POST JSON { category, message, email?, subject? }  →  { ok: true } | { ok: false, error }
 */
const BREVO_URL = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
const CATEGORIES = new Set(['문의', '오류 신고', '기능 제안', '부적절한 AI 응답']);
const LIMIT = { windowMs: 10 * 60 * 1000, max: 5 }; // 주소(IP)마다 10분에 5건
const hits = new Map();

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < LIMIT.windowMs);
  if (list.length >= LIMIT.max) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function POST(request) {
  // 붙여 넣을 때 섞인 앞뒤 공백·줄바꿈·따옴표는 지운다
  const clean = (v) => (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
  const BREVO_API_KEY = clean(process.env.BREVO_API_KEY);
  const CONTACT_TO = clean(process.env.CONTACT_TO);
  const CONTACT_SENDER = clean(process.env.CONTACT_SENDER);
  if (!BREVO_API_KEY || !CONTACT_TO || !CONTACT_SENDER) return json({ ok: false, error: '문의 서버 설정이 끝나지 않았습니다.' }, 503);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ ok: false, error: '형식이 올바르지 않습니다.' }, 415);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return json({ ok: false, error: '잠시 후 다시 보내 주세요.' }, 429);

  let p;
  try {
    const text = await request.text();
    if (text.length > 20000) return json({ ok: false, error: '내용이 너무 깁니다.' }, 413);
    p = JSON.parse(text);
  } catch {
    return json({ ok: false, error: '형식이 올바르지 않습니다.' }, 400);
  }
  const category = CATEGORIES.has(p?.category) ? p.category : '문의';
  const message = typeof p?.message === 'string' ? p.message.trim() : '';
  const email = typeof p?.email === 'string' ? p.email.trim() : '';
  if (!message) return json({ ok: false, error: '내용을 적어 주세요.' }, 400);
  if (message.length > 9000) return json({ ok: false, error: '내용이 너무 깁니다.' }, 413);
  const validEmail = email && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (email && !validEmail) return json({ ok: false, error: '답장 받을 메일 주소 형식이 올바르지 않습니다.' }, 400);

  const subject = `[Kite] ${category}`;
  const body = {
    sender: { email: CONTACT_SENDER, name: 'Kite 문의' },
    to: [{ email: CONTACT_TO }],
    subject,
    textContent: `${message}\n\n---\n분류: ${category}\n답장: ${validEmail ? email : '(없음)'}\n`,
    htmlContent: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(message)}</pre><hr><p>분류: ${esc(category)}<br>답장: ${validEmail ? esc(email) : '(없음)'}</p>`,
  };
  // 받는 사람은 고정: 사용자가 적은 주소로는 보내지 않고 '답장 주소'로만 쓴다 (스팸 중계 방지)
  if (validEmail) body.replyTo = { email };
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error('brevo', res.status, (await res.text()).slice(0, 300));
      return json({ ok: false, error: '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('brevo', e);
    return json({ ok: false, error: '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
  }
}

export function GET() {
  return json({ ok: true, service: 'kite-contact-relay' });
}
