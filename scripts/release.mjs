// GitHub 릴리스를 낸다: 버전을 올려 커밋하고 v<버전> 태그를 붙여 올린다.
// 태그가 올라가면 .github/workflows/release.yml 이 설치 파일을 만들어 릴리스에 붙인다.
//   npm run release          → 패치 +1 (1.0.2 → 1.0.3)
//   npm run release:minor    → 1.0.3 → 1.1.0
//   npm run release:major    → 1.1.0 → 2.0.0
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const kind = process.argv[2] || 'patch';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 치운 뒤 다시 실행하세요.');
  process.exit(1);
}
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

execFileSync(process.execPath, [path.join(root, 'scripts', 'bump-version.mjs'), kind], { cwd: root, stdio: 'inherit' });
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

git('add', 'package.json', 'package-lock.json');
git('commit', '-m', `chore: release ${tag}`);
git('tag', '-a', tag, '-m', tag);
git('push', 'origin', branch);
git('push', 'origin', tag);
console.log(`${tag} 태그를 ${branch} 에서 올렸습니다. GitHub Actions 가 설치 파일을 만들어 릴리스에 붙입니다.`);
