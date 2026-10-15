// 포맷 변환기 테스트 하네스: esbuild로 번들 후 jsdom 환경에서 실행
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.navigator ??= dom.window.navigator;

export async function load(entry) {
  const out = path.resolve('tests/.build', path.basename(entry).replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
    external: ['pdfjs-dist'] });
  return import(pathToFileURL(out).href + '?t=' + Date.now());
}

export const SAMPLES = process.env.SAMPLES;
export const readSample = (n) => new Uint8Array(fs.readFileSync(path.join(SAMPLES, n)));
