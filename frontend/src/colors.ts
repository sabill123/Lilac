// 앨범 아트워크에서 대표색을 뽑아 헤더 그라디언트에 사용
// (스포티파이가 플리/아티스트 헤더에 쓰는 기법)
const cache = new Map<string, [number, number, number] | null>();

export function dominantColor(url: string): Promise<[number, number, number] | null> {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url)!);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (v: [number, number, number] | null) => { cache.set(url, v); resolve(v); };
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const S = 36;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i], G = data[i + 1], B = data[i + 2];
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
          if (lum < 0.1 || lum > 0.93) continue;   // 너무 어둡거나 흰 픽셀 제외
          const weight = 0.2 + sat * 1.8;           // 채도 높은 색에 가중
          r += R * weight; g += G * weight; b += B * weight; w += weight;
        }
        if (!w) return done(null);
        done([Math.round(r / w), Math.round(g / w), Math.round(b / w)]);
      } catch { done(null); }
    };
    img.src = url;
  });
}

/** 헤더 배경용으로 명도를 눌러 정규화한 rgb 문자열 */
export function headerTone(rgb: [number, number, number] | null, fallback = '167,139,250'): string {
  if (!rgb) return fallback;
  let [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.62) { const k = 0.62 / lum; r *= k; g *= k; b *= k; }       // 너무 밝으면 낮춤
  if (lum < 0.22) { const k = Math.min(2.2, 0.22 / Math.max(lum, 0.05)); r *= k; g *= k; b *= k; }
  return `${Math.min(255, Math.round(r))},${Math.min(255, Math.round(g))},${Math.min(255, Math.round(b))}`;
}

/** 요소에 대표색 그라디언트를 입힌다 */
export async function applyTone(el: HTMLElement | null, artworkUrl: string, cssVar = '--hdr') {
  if (!el) return;
  const tone = headerTone(await dominantColor(artworkUrl));
  el.style.setProperty(cssVar, tone);
  el.classList.add('toned');
}
