import CFB from 'cfb';
import * as pako from 'pako';
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const cfb = CFB.read(buf, { type: 'buffer' });
const get = (p) => { const e = CFB.find(cfb, p); return e ? Buffer.from(e.content) : null; };
const fh = get('/FileHeader');
const attr = fh.readUInt32LE(36);
const compressed = attr & 1;
console.log('version', fh.readUInt32LE(32).toString(16), 'attr', attr.toString(2));
const dec = (b) => compressed ? Buffer.from(pako.inflateRaw(b)) : b;
function recs(b) { const out = []; let o = 0; while (o + 4 <= b.length) { const h = b.readUInt32LE(o); o += 4; const tag = h & 0x3ff, level = (h >> 10) & 0x3ff; let size = (h >>> 20) & 0xfff; if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; } out.push({ tag, level, data: b.subarray(o, o + size) }); o += size; } return out; }
const di = recs(dec(get('/DocInfo')));
const cnt = {}; di.forEach(r => cnt[r.tag] = (cnt[r.tag] || 0) + 1); console.log('docinfo tags', cnt);
const idm = di.find(r => r.tag === 17); const counts = []; for (let i = 0; i + 4 <= idm.data.length; i += 4) counts.push(idm.data.readInt32LE(i)); console.log('idmappings', counts);
const bfs = di.filter(r => r.tag === 20).slice(0, 4); bfs.forEach((r, i) => console.log('borderfill', i + 1, [...r.data.subarray(0, 44)].map(x => x.toString(16).padStart(2, '0')).join(' ')));
const nums = di.filter(r => r.tag === 23).slice(0, 2);
nums.forEach(r => { let o = 0; const lv = []; for (let l = 0; l < 7; l++) { const a = r.data.readUInt32LE(o); o += 12; const len = r.data.readUInt16LE(o); o += 2; const s = r.data.subarray(o, o + len * 2); o += len * 2; lv.push({ a: a.toString(2), fmt: (a >> 5) & 0xf, s: JSON.stringify(s.toString('utf16le')), codes: [...s.toString('utf16le')].map(c => c.charCodeAt(0)) }); } console.log('numbering', JSON.stringify(lv)); });
const bul = di.filter(r => r.tag === 24).slice(0, 2); bul.forEach(r => console.log('bullet', r.data.length, String.fromCharCode(r.data.readUInt16LE(12))));
const ps = di.filter(r => r.tag === 25);
const body = recs(dec(get('/BodyText/Section0')));
const bcnt = {}; body.forEach(r => bcnt[r.tag] = (bcnt[r.tag] || 0) + 1); console.log('body tags', bcnt);
// secd / page def
const pd = body.find(r => r.tag === 73); if (pd) console.log('pagedef', [0,4,8,12,16,20,24,28,32].map(o => pd.data.readUInt32LE(o)), 'attr', pd.data.readUInt32LE(36));
const ctrls = body.filter(r => r.tag === 71).map(r => { const v = r.data.readUInt32LE(0); return String.fromCharCode((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); });
const cc = {}; ctrls.forEach(c => cc[c] = (cc[c] || 0) + 1); console.log('ctrls', cc);
const secd = body.find(r => r.tag === 71 && r.data.readUInt32LE(0) === 0x73656364); if (secd) console.log('secd', [...secd.data.subarray(0, 30)].map(x => x.toString(16).padStart(2,'0')).join(' '));
// table + first list headers
const ti = body.findIndex(r => r.tag === 77);
if (ti >= 0) { const t = body[ti]; console.log('table rows', t.data.readUInt16LE(4), 'cols', t.data.readUInt16LE(6), 'len', t.data.length);
  body.slice(ti + 1).filter(r => r.tag === 72).slice(0, 3).forEach(r => console.log('listheader', r.level, r.data.length, [...r.data.subarray(0, 36)].map(x => x.toString(16).padStart(2, '0')).join(' '))); }
// para margins vs line seg
let n = 0;
for (let i = 0; i < body.length && n < 8; i++) { const r = body[i]; if (r.tag !== 66) continue; const psid = r.data.readUInt16LE(8); const p = ps[psid]; if (!p) continue; const left = p.data.readInt32LE(4), indent = p.data.readInt32LE(12); if (!left && !indent) continue;
  const ls = body.slice(i + 1, i + 6).find(x => x.tag === 69); if (!ls || ls.data.length < 72) continue; const hp = []; for (let o = 0; o + 36 <= ls.data.length; o += 36) hp.push(ls.data.readInt32LE(o + 24)); console.log('para left', left, 'indent', indent, 'right', p.data.readInt32LE(8), 'segs horzpos', hp.slice(0, 3)); n++; }
const pic = body.find(r => r.tag === 85); if (pic) console.log('picture binid@71', pic.data.readUInt16LE(71), 'len', pic.data.length);
const bins = di.filter(r => r.tag === 18).map(r => ({ attr: r.data.readUInt16LE(0), id: r.data.readUInt16LE(2), ext: r.data.subarray(6, 6 + r.data.readUInt16LE(4) * 2).toString('utf16le') })); console.log('bindata', bins.slice(0, 5));
console.log(cfb.FullPaths.filter(p => /BinData/i.test(p)).slice(0, 5));
