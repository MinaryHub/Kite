// build/png/<크기>.png 들을 묶어 build/icon.ico 를 만들고, 앱에서 쓰는 PNG/SVG 를 복사한다.
// PNG 는 build/icon.svg 를 크기별로 그린 것 (Vista 이후 ICO 는 PNG 항목을 지원한다)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pngDir = path.join(root, 'build', 'png');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => ({ s, data: fs.readFileSync(path.join(pngDir, `${s}.png`)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
const dir = Buffer.alloc(16 * images.length);
let offset = 6 + dir.length;
images.forEach(({ s, data }, i) => {
  const o = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, o); // 256 은 0 으로 적는다
  dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
  dir.writeUInt8(0, o + 2); // palette
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bpp
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, dir, ...images.map((i) => i.data)]));
fs.copyFileSync(path.join(pngDir, '512.png'), path.join(root, 'build', 'icon.png'));
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.copyFileSync(path.join(pngDir, '256.png'), path.join(root, 'public', 'icon.png'));
fs.copyFileSync(path.join(root, 'build', 'icon.svg'), path.join(root, 'public', 'icon.svg'));
console.log('icon.ico', offset, 'bytes');
