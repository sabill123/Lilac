/* 공연 대표 이미지 — 예매처·팬클럽 공연 페이지의 og:image
 *
 * 왜: e+·팬클럽 투어 목록에는 이미지가 없어 아티스트 사진이나 빈 날짜 카드로 보였다.
 *     상세 페이지의 og:image는 공연마다 다른 키 비주얼이다(e+ /s/image/<공연코드>, 팬클럽 투어 특설 페이지 OGP).
 * 규칙
 *   - 사이트 첫 화면과 같은 og:image(사이트 공통 이미지)는 공연 이미지가 아니다
 *   - 로고·noimage·기본 OGP 이름은 버린다
 *   - 받기 실패는 "이미지 없음"으로 저장하지 않는다(다음에 다시 시도). 이미지가 없다고 확인된 페이지만 하루 동안 다시 묻지 않는다 */
import { fetchText } from './http.mjs';

const GENERIC = /noimage|no_image|no-image|no_thumb|daitai|webclip|dummy|default|placeholder|logo|favicon|apple-touch|common\/(?:img\/)?ogp|\/ogp?\.(?:png|jpe?g)$/i;

/* 사이트 템플릿이 주소와 경로 사이의 '/'를 빠뜨린 OGP가 실제로 있다.
   운영 2026-10-22 CANDY TUNE 팬클럽: content="https://candytune.asobisystem.comstatic2/prod/…jpeg"
   (그대로 쓰면 없는 호스트라 화면이 글자 자리표시로 남는다. '/'를 넣은 주소는 200 image/jpeg).
   고치는 조건은 좁게 둔다: 페이지 호스트 바로 뒤에 글자가 붙었고, 붙은 마지막 라벨이 TLD일 수 없을 때
   (숫자·밑줄 포함 — 실제 TLD는 글자만이다). foo.co 페이지의 foo.com 이미지 같은 정상 주소는 건드리지 않는다. */
export function repairJoinedOrigin(raw, base) {
  const m = String(raw || '').match(/^(https?:)\/\/([^/?#]+)(.*)$/i);
  if (!m) return raw;
  let bh;
  try { bh = new URL(base).host.toLowerCase(); } catch { return raw; }
  const host = m[2].toLowerCase();
  if (host === bh || !host.startsWith(bh)) return raw;
  const rest = m[2].slice(bh.length);
  if (!/^[A-Za-z0-9_-]+$/.test(rest) || !/[\d_]/.test(rest)) return raw;
  return `${m[1]}//${m[2].slice(0, bh.length)}/${rest}${m[3]}`;
}

/* 저장된 포스터 판정을 다시 확인할 때인가. 이미지가 있으면 7일, "이미지 없음"이 확인됐으면 하루 뒤에 다시 묻는다.
   예전 호출부는 이미지가 있으면 이 판단 전에 돌아가 버려, 한 번 받은 이미지(깨진 주소 포함)를 영영 다시 보지 않았다. */
export const POSTER_RECHECK_MS = { img: 7 * 24 * 3600e3, none: 24 * 3600e3 };
export function posterNeedsCheck(v, now = Date.now()) {
  if (!v) return true;
  return now - (Number(v.at) || 0) > (v.none ? POSTER_RECHECK_MS.none : POSTER_RECHECK_MS.img);
}

export function ogImage(html, base) {
  const h = String(html || '');
  const raw = (h.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i)
    || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    || h.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i) || [])[1];
  if (!raw) return null;
  try {
    const u = new URL(repairJoinedOrigin(raw.replace(/&amp;/g, '&').trim(), base), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

function bodyImage(html, url) {
  const body = String(html).replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) {
    if (/icon|badge|btn|button|bnr|banner|sns|arrow|logo|spacer|loading|qr|goods|seat/i.test(m[1]) || GENERIC.test(m[1])) continue;
    /* 공지·안내 이미지(추첨회 안내문 등)를 포스터로 쓰지 않도록, 대표 이미지 이름(kv·main·visual·hero·mv·artist·photo·jacket)만 */
    if (!/(?:^|[/_.-])(?:kv|key_?visual|keyvisual|main|visual|hero|mv|artist|photo|jacket|ogp)(?:[/_.\-\d]|$)/i.test(m[1])) continue;
    try { return new URL(m[1].replace(/&amp;/g, '&'), url).href.replace(/^http:/, 'https:'); } catch { /* 다음 */ }
  }
  return null;
}

/** 상세 페이지 URL → { img } | { none: true } | null(실패, 저장하지 않음) */
export async function eventPoster(url, { read = (u) => fetchText(u, { timeout: 10000, retries: 0, headers: { 'Accept-Language': 'ja,ko;q=0.8' } }), siteImage, body = true } = {}) {
  let html;
  try { html = await read(url); } catch { return null; }
  let img = ogImage(html, url);
  const pathOf = (x) => { try { return new URL(x).pathname; } catch { return ''; } };
  /* 사이트 공통 OGP(/ogp.jpg, 로고)거나 사이트 첫 화면과 같은 이미지면 공연 이미지가 아니다 */
  if (img && GENERIC.test(pathOf(img)) && !/\/(?:feature|event|tour|live|detail|image)\//i.test(pathOf(img))) img = null;
  if (img && siteImage) { const site = await siteImage(new URL(url).origin).catch(() => undefined); if (site && site === img) img = null; }
  /* OGP가 없거나 공통 이미지인 투어 특설 페이지(INI): 본문 첫 대표 이미지 */
  if (!img && body) img = bodyImage(html, url);
  return img ? { img } : { none: true };
}
