// Microsoft Store 제출용 MSIX 를 윈도우 도구(makeappx) 없이 만든다.
//   npm run dist:msix   (= npm run build && node scripts/pack-msix.mjs --build)
//   → release/win-unpacked 를 만든 뒤 release/Kite-<버전>-x64.msix 로 묶는다
// 스토어 제출 패키지는 서명하지 않아도 된다 (Microsoft 가 서명한다). 직접 설치해 시험하려면 서명이 필요하다.
//
// MSIX = OPC(ZIP) 꾸러미: 앱 파일 + AppxManifest.xml + AppxBlockMap.xml(파일마다 64KB 조각의 SHA-256) + [Content_Types].xml.
// 압축 파일은 64KB 조각마다 deflate 를 FULL_FLUSH 로 끊어, 조각별 압축 크기를 블록 지도에 적는다 (makeappx 와 같은 방식).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appx = pkg.build.appx;
const appDir = path.join(root, 'release', 'win-unpacked');
const assetDir = path.join(root, 'build', 'appx');
const outFile = path.join(root, 'release', `Kite-${pkg.version}-x64.msix`);
const BLOCK = 65536;

// --build: 윈도우 앱 폴더부터 만든다 (맥에서도 된다: electronDist 를 빼서 윈도우용 Electron 을 받게 한다)
if (process.argv.includes('--build')) {
  const { build, Platform, Arch } = await import('electron-builder');
  // 설정을 객체로 넘기면 package.json 의 build 와 합쳐져 electronDist 가 되살아나므로, 임시 설정 파일 경로로 넘긴다
  const config = { ...pkg.build };
  delete config.electronDist;
  const tmp = path.join(root, 'release', '.msix-builder.json');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(config));
  try {
    await build({ targets: Platform.WINDOWS.createTarget('dir', Arch.x64), config: tmp, publish: 'never' });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

if (!fs.existsSync(path.join(appDir, `${pkg.productName}.exe`))) {
  console.error('release/win-unpacked 가 없습니다. 먼저 npx electron-builder --win dir --x64 를 실행하세요.');
  process.exit(1);
}

// ---------- 매니페스트 (electron-builder 와 같은 틀·값) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const version = pkg.version.split('.').concat(['0', '0', '0']).slice(0, 3).join('.') + '.0';
const exe = `app\\${pkg.productName}.exe`;
const caps = appx.capabilities || [];
const capabilities =
  '<Capabilities>\n' + caps.map((c) => `    <Capability Name="${c}" />`).join('\n') + '\n    <rescap:Capability Name="runFullTrust" />\n  </Capabilities>';
const assoc = (pkg.build.fileAssociations || [])
  .flatMap((f) => [].concat(f.ext).map((ext) => ({ ext, name: f.name })))
  .map(
    ({ ext, name }) => `
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="${ext}">
            <uap:DisplayName>${esc(name || ext)}</uap:DisplayName>
            <uap:Logo>assets\\Square44x44Logo.png</uap:Logo>
            <uap:SupportedFileTypes>
              <uap:FileType>.${ext}</uap:FileType>
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>`,
  )
  .join('');
const custom = appx.customExtensionsPath ? fs.readFileSync(path.join(root, appx.customExtensionsPath), 'utf8') : '';
const vars = {
  identityName: appx.identityName,
  arch: 'x64',
  publisher: appx.publisher,
  version,
  displayName: esc(appx.displayName || pkg.productName),
  publisherDisplayName: esc(appx.publisherDisplayName),
  description: esc(pkg.description || appx.displayName || pkg.productName),
  logo: 'assets\\StoreLogo.png',
  resourceLanguages: (appx.languages || ['en-US']).map((l) => `<Resource Language="${l}" />`).join('\n    '),
  minVersion: '10.0.17763.0',
  maxVersionTested: '10.0.22621.0',
  capabilities,
  applicationId: appx.applicationId || pkg.productName,
  executable: exe,
  backgroundColor: appx.backgroundColor || '#464646',
  square150x150Logo: 'assets\\Square150x150Logo.png',
  square44x44Logo: 'assets\\Square44x44Logo.png',
  lockScreen: '',
  defaultTile: '<uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png" Square310x310Logo="assets\\LargeTile.png" Square71x71Logo="assets\\SmallTile.png" />',
  splashScreen: '',
  extensions: `<Extensions>${assoc}${custom}\n      </Extensions>`,
};
const tpl = fs.readFileSync(path.join(root, 'build', appx.customManifestPath), 'utf8');
const manifest = tpl.replace(/\$\{(\w+)\}/g, (m, k) => {
  if (!(k in vars)) throw new Error('매니페스트 틀의 모르는 값: ' + m);
  return vars[k];
});

// ---------- 넣을 파일 ----------
const files = [];
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else files.push({ zipName: `app/${r}`, src: p });
  }
})(appDir, '');
for (const a of ['StoreLogo', 'Square44x44Logo', 'Square150x150Logo', 'Wide310x150Logo', 'LargeTile', 'SmallTile']) {
  files.push({ zipName: `assets/${a}.png`, src: path.join(assetDir, `${a}.png`) });
}
files.push({ zipName: 'AppxManifest.xml', data: Buffer.from(manifest, 'utf8') });

// OPC 이름: ASCII 영숫자와 몇몇 기호만 그대로, 나머지는 %XX
const opcName = (n) => n === '[Content_Types].xml' ? n : n.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

// ---------- ZIP 쓰기 ----------
const out = fs.openSync(outFile + '.tmp', 'w');
let offset = 0;
const central = [];
const write = (buf) => {
  fs.writeSync(out, buf);
  offset += buf.length;
};
const dosTime = (() => {
  const d = new Date();
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
})();

/** 64KB 조각마다 FULL_FLUSH 로 끊어 압축: 조각별 압축 크기도 돌려준다 */
async function deflateBlocks(data) {
  const z = zlib.createDeflateRaw({ level: 6 });
  const chunks = [];
  z.on('data', (c) => chunks.push(c));
  const sizes = [];
  let produced = 0;
  const outLen = () => chunks.reduce((a, c) => a + c.length, 0);
  for (let i = 0; i < data.length; i += BLOCK) {
    z.write(data.subarray(i, i + BLOCK));
    await new Promise((r) => z.flush(zlib.constants.Z_FULL_FLUSH, r));
    const now = outLen();
    sizes.push(now - produced);
    produced = now;
  }
  await new Promise((r) => z.end(r));
  await new Promise((r) => (z.writableFinished && z.readableEnded ? r() : z.on('end', r)));
  const total = outLen();
  // 마지막 빈 블록(끝 표시)은 마지막 조각에 붙인다
  if (sizes.length) sizes[sizes.length - 1] += total - produced;
  return { buf: Buffer.concat(chunks), sizes };
}

function localHeader(nameBuf, method, crc, csize, usize) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6); // UTF-8 이름
  h.writeUInt16LE(method, 8);
  h.writeUInt16LE(dosTime.time, 10);
  h.writeUInt16LE(dosTime.date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(csize, 18);
  h.writeUInt32LE(usize, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return h;
}

async function addEntry(zipName, data, { compress = true, blockmap = true } = {}) {
  const nameBuf = Buffer.from(opcName(zipName), 'utf8');
  const crc = zlib.crc32(data) >>> 0;
  let body = data;
  let method = 0;
  let blockSizes = null;
  if (compress && data.length > 0) {
    const r = await deflateBlocks(data);
    if (r.buf.length < data.length) {
      body = r.buf;
      method = 8;
      blockSizes = r.sizes;
    }
  }
  const lfh = localHeader(nameBuf, method, crc, body.length, data.length);
  const at = offset;
  write(Buffer.concat([lfh, nameBuf]));
  write(body);
  central.push({ nameBuf, method, crc, csize: body.length, usize: data.length, at });
  if (!blockmap) return null;
  const blocks = [];
  for (let i = 0, k = 0; i < data.length; i += BLOCK, k++) {
    const hash = crypto.createHash('sha256').update(data.subarray(i, i + BLOCK)).digest('base64');
    blocks.push(blockSizes ? `<Block Hash="${hash}" Size="${blockSizes[k]}"/>` : `<Block Hash="${hash}"/>`);
  }
  const winName = zipName.replace(/\//g, '\\');
  return `<File Name="${esc(winName)}" Size="${data.length}" LfhSize="${lfh.length + nameBuf.length}">${blocks.join('')}</File>`;
}

const STORED_EXT = /\.(png|jpe?g|gif|zip|7z|gz|msix|appx)$/i; // 이미 압축된 것은 그대로
const blockEntries = [];
const exts = new Map();
const noExt = [];
const CT = { exe: 'application/x-msdownload', dll: 'application/x-msdownload', png: 'image/png', html: 'text/html', json: 'application/json', txt: 'text/plain', xml: 'text/xml', dat: 'application/octet-stream', pak: 'application/octet-stream', bin: 'application/octet-stream', asar: 'application/octet-stream' };
let n = 0;
for (const f of files) {
  const data = f.data || fs.readFileSync(f.src);
  blockEntries.push(await addEntry(f.zipName, data, { compress: !STORED_EXT.test(f.zipName) }));
  const base = f.zipName.split('/').pop();
  const m = /\.([^.]+)$/.exec(base);
  if (f.zipName === 'AppxManifest.xml') {
    /* Override 로 */
  } else if (m) exts.set(m[1].toLowerCase(), CT[m[1].toLowerCase()] || 'application/octet-stream');
  else noExt.push(f.zipName);
  if (++n % 10 === 0) process.stdout.write(`  ${n}/${files.length}\r`);
}

const blockMap =
  '<?xml version="1.0" encoding="UTF-8"?>\n<BlockMap xmlns="http://schemas.microsoft.com/appx/2010/blockmap" HashMethod="http://www.w3.org/2001/04/xmlenc#sha256">' +
  blockEntries.join('') +
  '</BlockMap>';
await addEntry('AppxBlockMap.xml', Buffer.from(blockMap, 'utf8'), { blockmap: false });

const contentTypes =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  [...exts].map(([e, t]) => `<Default Extension="${esc(e)}" ContentType="${t}"/>`).join('') +
  noExt.map((z) => `<Override PartName="/${esc(opcName(z))}" ContentType="application/octet-stream"/>`).join('') +
  '<Override PartName="/AppxManifest.xml" ContentType="application/vnd.ms-appx.manifest+xml"/>' +
  '<Override PartName="/AppxBlockMap.xml" ContentType="application/vnd.ms-appx.blockmap+xml"/>' +
  '</Types>';
await addEntry('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'), { blockmap: false });

// 중앙 디렉터리
const cdStart = offset;
for (const e of central) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(e.method, 10);
  h.writeUInt16LE(dosTime.time, 12);
  h.writeUInt16LE(dosTime.date, 14);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.csize, 20);
  h.writeUInt32LE(e.usize, 24);
  h.writeUInt16LE(e.nameBuf.length, 28);
  h.writeUInt32LE(e.at, 42);
  write(Buffer.concat([h, e.nameBuf]));
}
const cdSize = offset - cdStart;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length, 8);
end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(cdStart, 16);
write(end);
fs.closeSync(out);
fs.renameSync(outFile + '.tmp', outFile);
console.log(`\n${path.relative(root, outFile)}  ${(offset / 1048576).toFixed(1)}MB  파일 ${files.length}개  버전 ${version}  ${appx.identityName}`);
