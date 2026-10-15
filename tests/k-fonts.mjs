import { load, readSample } from './harness.mjs';
const m = await load('tests/formats.entry.ts');
const doc = await m.readHwp(readSample(process.argv[2]));
const out = [];
const walk = (n) => { if (n.type === 'text' && out.length < 25) out.push((n.marks || []).map(x => x.type + (x.attrs ? JSON.stringify(x.attrs) : '')).join(',') + ' :: ' + n.text.slice(0, 30)); (n.content || []).forEach(walk); };
walk(doc.content);
console.log(out.join('\n'));
