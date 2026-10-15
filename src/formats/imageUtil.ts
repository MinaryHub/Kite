import { dataUrlToBytes, extFromMime } from './common';

/** PNG/JPEG/GIF/BMP 헤더에서 픽셀 크기 읽기 */
export function sniffImageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }
    if (b[0] === 0x42 && b[1] === 0x4d) {
      return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) {
          o++;
          continue;
        }
        const marker = b[o + 1];
        const len = dv.getUint16(o + 2);
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5) };
        }
        o += 2 + len;
      }
    }
  } catch {
    /* 무시 */
  }
  return null;
}

export interface PreparedImage {
  bytes: Uint8Array;
  ext: string;
  mime: string;
  width: number;
  height: number;
}

/** 한글/워드에 넣을 수 있는 형태(PNG/JPG/GIF/BMP)로 준비 */
export async function prepareImage(src: string): Promise<PreparedImage | null> {
  let parsed = dataUrlToBytes(src);
  if (!parsed) {
    try {
      const res = await fetch(src);
      const buf = new Uint8Array(await res.arrayBuffer());
      parsed = { mime: res.headers.get('content-type') || 'image/png', bytes: buf };
    } catch {
      return null;
    }
  }
  let { mime, bytes } = parsed;
  if (!/image\/(png|jpe?g|gif|bmp)/.test(mime)) {
    const png = await rasterize(src);
    if (!png) return null;
    bytes = png;
    mime = 'image/png';
  }
  const size = sniffImageSize(bytes) || { width: 100, height: 100 };
  return { bytes, mime, ext: extFromMime(mime), width: size.width, height: size.height };
}

/** 브라우저 캔버스로 PNG 변환 (SVG, WebP 등) */
export async function rasterize(src: string): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 200;
        c.height = img.naturalHeight || 100;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        c.toBlob(async (blob) => {
          if (!blob) return resolve(null);
          resolve(new Uint8Array(await blob.arrayBuffer()));
        }, 'image/png');
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
