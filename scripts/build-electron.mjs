import { build } from 'esbuild';

export async function buildElectron(dev = false) {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    logLevel: 'warning',
  };
  await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' });
  await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' });
}

if (process.argv[1] && process.argv[1].endsWith('build-electron.mjs')) {
  buildElectron(false).then(() => console.log('electron built'));
}
