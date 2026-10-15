import { load, readSample } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const f = process.argv[2];
const doc = await (f.endsWith('.hwp') ? m.readHwp : m.readHwpx)(readSample(f));
const out = [];
const walk = (n) => { if (n.type === 'image') out.push([n.attrs.width, n.attrs.height]); (n.content || []).forEach(walk); };
walk(doc.content);
out.sort((a, b) => (b[1] || 0) - (a[1] || 0));
console.log(out.length, JSON.stringify(out.slice(0, 8)), JSON.stringify(out.slice(-3)));
