// 설치 파일을 만들 때마다 버전의 마지막 자리를 1 올린다 (0.1.0 → 0.1.1).
// package.json 과 package-lock.json 을 함께 고친다.
//   node scripts/bump-version.mjs          → 패치 +1
//   node scripts/bump-version.mjs minor    → 0.1.5 → 0.2.0
//   node scripts/bump-version.mjs major    → 0.2.3 → 1.0.0
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const kind = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('사용법: bump-version.mjs [patch|minor|major]');
  process.exit(1);
}

const pkgPath = path.join(root, 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!m) {
  console.error(`버전 형식을 알 수 없습니다: ${pkg.version}`);
  process.exit(1);
}
let [maj, min, pat] = m.slice(1).map(Number);
if (kind === 'major') [maj, min, pat] = [maj + 1, 0, 0];
else if (kind === 'minor') [min, pat] = [min + 1, 0];
else pat += 1;
const next = `${maj}.${min}.${pat}`;

// 들여쓰기·줄바꿈 등 원래 모양을 지키도록 버전 줄만 바꾼다
const replaceVersion = (text, count) => {
  let n = 0;
  return text.replace(/("version":\s*")[^"]*(")/g, (all, a, b) => (n++ < count ? a + next + b : all));
};
fs.writeFileSync(pkgPath, replaceVersion(raw, 1));

const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = fs.readFileSync(lockPath, 'utf8');
  // 맨 위 version 과 packages[""].version (처음 두 개)
  fs.writeFileSync(lockPath, replaceVersion(lock, 2));
}
console.log(`버전: ${pkg.version} → ${next}`);
