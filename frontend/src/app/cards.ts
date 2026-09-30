/* 목록 카드 — 공연·티켓 오픈·뉴스·상품·발매·아티스트·차트 */
import { esc, safeHref, safeImage, icon, img, fmtRange, fmtDateTime, fmtTime, fmtDay, until, ddayOf, ago, money, saleLabel, genreLabel, approxMoney } from './ui';
import { withUtm } from './fanclub';
import { t, getLocale } from './i18n';
import { state, isFollowing, toggleFollow } from './state';
import { keyOf } from './player';
import { likeBtn, talkBtn, trackTarget } from './social';
import type { Track } from './player';

export interface Concert {
  id: string; provider: string; providerLabel: string; title: string;
  performer?: string | null; artistId?: string | null; origin?: string;
  venue: string | null; city: string | null; country: 'KR' | 'JP';
  startDate: string | null; endDate: string | null;
  ticketOpenAt?: string | null; ticketOpenLabel?: string | null;
  openSchedule?: { at: string | null; label: string; endAt?: string | null }[];
  status: string; statusText?: string | null; poster: string | null; url: string;
  genre?: string | null; kind?: string; badges?: string[]; direction?: string; saleType?: string | null; description?: string | null;
  unconfirmed?: boolean; openTba?: boolean; posterKind?: string | null; saleSortAt?: string | null; closesAt?: string | null;
  shows?: { date: string | null; endDate?: string | null; venue: string | null; city: string | null; url: string }[]; showCount?: number; venueCount?: number; performerKo?: string | null;
  windows?: { label: string | null; opensAt: string | null; closesAt: string | null; date: string | null; venue: string | null; url: string }[]; windowCount?: number;
  alsoAt?: { provider: string; providerLabel?: string; url: string; status?: string | null }[];
  fanclub?: { name: string | null; entry: string | null; home: string | null; platform: string | null; overseas: string; fees: { annual: number | null; monthly: number | null } | null } | null;
  fcOnly?: boolean; fcFirst?: boolean; overseasOk?: boolean; noJpPhone?: boolean; condition?: string | null; lottery?: boolean; trade?: boolean;
}
export interface News { id: string; title: string; source: string | null; url: string; publishedAt: string | null; topics: string[]; artistIds: string[]; edition?: string; related?: { title: string; source: string | null; url: string; publishedAt: string | null }[] }
export interface Offer {
  id: string; store: string; storeLabel: string; title: string; artist: string | null; format: string | null; edition: string | null;
  price: number | null; listPrice?: number | null; memberPrice?: number | null; currency: string; releaseDate: string | null; image: string | null;
  availability: string; url: string; bonus?: string | null; imported?: boolean; set?: number | null; region?: string | null; releaseDatePrecision?: string | null;
}
export interface Release { id: string; tier: string; artist: string; artistKo?: string; artistId?: string; title: string; titleKo?: string; country: string; type?: string; releaseDate: string; artwork: string | null; trackCount?: number | null; offerCount?: number; upcoming?: boolean }
export interface ArtistLite { id: string; name: string; nameOriginal?: string | null; nameKo?: string | null; nameJa?: string | null; origin?: string; genre?: string | null; photo?: string | null; artwork?: string | null }

/* 화면에 그린 공연을 기억해 두고 상세 시트에서 쓴다 */
class ConcertRegistry extends Map<string, Concert> {
  override set(id: string, c: Concert) { this.delete(id); super.set(id, c); if (this.size > 5000) this.delete(this.keys().next().value!); return this; }
}
export const concertRegistry = new ConcertRegistry();

/* 예매처마다 "서울특별시" "인천시" "인천"처럼 달라서 한 가지로 */
export function cityName(city: string | null | undefined) {
  return String(city || '').trim().replace(/^(서울|부산|대구|인천|광주|대전|울산|세종)(특별자치시|특별시|광역시|시)$/, '$1');
}
export function placeOf(c: Concert) {
  const v = c.venue || '';
  if ((c.venueCount || 0) > 1) return t('c.venues', { v, n: (c.venueCount || 1) - 1 });
  const city = cityName(c.city);
  return [v, city && city !== v && !v.includes(city) ? city : ''].filter(Boolean).join(' · ');
}
export function whenOf(c: Concert) {
  const r = fmtRange(c.startDate, c.endDate);
  return (c.showCount || 0) > 1 ? `${r} · ${t('c.shows', { n: c.showCount! })}` : r;
}
function titleOf(c: Concert) {
  const ko = getLocale() === 'ko' && c.performerKo && !c.title.includes(c.performerKo) ? ` <span class="ko-name">${esc(c.performerKo)}</span>` : '';
  return esc(c.title) + ko;
}

const PROVIDER: Record<string, [string, string]> = {
  fanclub: ['공식 팬클럽', '公式ファンクラブ'],
  nol: ['NOL 티켓(인터파크)', 'NOLチケット(インターパーク)'], melon: ['멜론티켓', 'メロンチケット'],
  eplus: ['이플러스(e+)', 'イープラス'], pia: ['티켓피아', 'チケットぴあ'],
  ticketlink: ['티켓링크', 'チケットリンク'], yes24: ['YES24 티켓', 'YES24チケット'], ltike: ['로치케(로손티켓)', 'ローチケ'],
};
export function providerName(c: Concert) {
  if (c.provider === 'fanclub') return c.fanclub?.name ? `${getLocale() === 'ja' ? '公式FC' : '공식 팬클럽'} 「${c.fanclub.name}」` : PROVIDER.fanclub[getLocale() === 'ja' ? 1 : 0];
  const m = PROVIDER[c.provider];
  return m ? m[getLocale() === 'ja' ? 1 : 0] : c.providerLabel;
}

export function fcTag(c: Concert) {
  if (c.provider !== 'fanclub') return '';
  const tags = [c.trade ? t('fc.tag.trade') : (c as Concert & { isPublic?: boolean }).isPublic ? t('fc.tag.public') : c.fcOnly ? t('fc.tag.only') : t('fc.tag.first')];
  if (c.noJpPhone) tags.push(t('fc.tag.noPhone')); else if (c.overseasOk) tags.push(t('fc.tag.overseas'));
  if ((c as Concert & { companionMember?: boolean }).companionMember) tags.push(t('fc.tag.companion'));
  return tags.map((x) => `<span class="tag tag-fc">${esc(x)}</span>`).join('');
}
export function fcHowHref(c: Concert) {
  return c.artistId ? `#/fanclub/${encodeURIComponent(c.artistId)}` : '';
}

export function dirTag(c: Concert) {
  return c.direction ? `<span class="tag tag-dir">${esc(t(`dir.${c.direction}`))}</span>` : '';
}

export function statusText(c: Concert) {
  const s = t(`st.${c.status}`);
  return s ? `<span class="st st-${esc(c.status)}">${esc(s)}</span>` : '';
}

/* 공연 포스터가 없을 때: 같은 아티스트 사진을 여러 장 되풀이하는 대신 날짜·도시 카드(달력처럼) */
function dateBox(c: Concert) {
  const validStart = c.startDate && fmtDay(c.startDate) ? c.startDate : null;
  const d = validStart ? new Date(`${validStart}T00:00:00+09:00`) : null;
  const ja = getLocale() === 'ja';
  const wd = d ? new Intl.DateTimeFormat(ja ? 'ja-JP' : 'ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(d) : '';
  const md = validStart ? `${Number(c.startDate.slice(5, 7))}.${Number(c.startDate.slice(8, 10))}` : (ja ? '日程未定' : '일정 미정');
  const multi = c.endDate && fmtDay(c.endDate) && c.endDate !== c.startDate ? `~ ${Number(c.endDate.slice(5, 7))}.${Number(c.endDate.slice(8, 10))}` : '';
  return `<span class="datebox" aria-hidden="true"><em>${esc(c.startDate ? c.startDate.slice(0, 4) : '')}</em><b>${esc(md)}</b><span>${esc([wd, multi].filter(Boolean).join(' '))}</span><i>${esc(cityName(c.city) || c.venue || '')}</i></span>`;
}

export function posterCard(c: Concert) {
  concertRegistry.set(c.id, c);
  const dd = ddayOf(c.startDate);
  const place = placeOf(c);
  return `<article class="pcard">
    <button class="pcard-art" data-open-concert="${esc(c.id)}" aria-label="${esc(c.title)}">${!c.poster ? dateBox(c) : img(c.poster, '', c.posterKind === 'artist' ? 'poster is-artist-photo' : 'poster', { ratio: '3/4', initial: c.performer || c.title, text: true })}</button>
    <div class="pcard-body">
      <p class="pcard-date">${whenOf(c)}${dd ? ` <span class="dday">${dd}</span>` : ''}</p>
      <h3 class="pcard-title"><button data-open-concert="${esc(c.id)}">${titleOf(c)}</button></h3>
      ${place ? `<p class="pcard-venue">${esc(place)}</p>` : ''}
      <p class="pcard-meta">${fcTag(c) || (state.edition === 'all' ? dirTag(c) : '')}<span>${esc(providerName(c))}${c.alsoAt?.length ? ` +${c.alsoAt.length}` : ''}</span>${statusText(c)}</p>
    </div>
  </article>`;
}

/* 페스티벌 카드: 포스터 · 나라 · 기간 · 장소 · 반대편 나라 아티스트 수(한국 팬에게는 J-POP, 일본 팬에게는 K-POP) */
export function festCard(f: Concert & { country?: string; lineup?: { name: string; origin: string | null }[]; lineupJp?: number; lineupKr?: number }) {
  concertRegistry.set(f.id, f);
  const ja = getLocale() === 'ja';
  const dd = ddayOf(f.startDate);
  const cn = f.country === 'JP' ? (ja ? '日本' : '일본') : (ja ? '韓国' : '한국');
  /* 한국 페스티벌에는 J-POP, 일본 페스티벌에는 K-POP 출연 수 — 건너편 음악이 서는 무대를 보여 준다 */
  const want = f.country === 'JP' ? 'kr' : 'jp';
  const n = want === 'jp' ? f.lineupJp || 0 : f.lineupKr || 0;
  const names = (f.lineup || []).filter((x) => x.origin === want).slice(0, 3).map((x) => x.name);
  const hi = n ? `<p class="fest-hi"><b>${want === 'jp' ? 'J-POP' : 'K-POP'} ${n}${ja ? '組' : '팀'}</b> ${esc(names.join(', '))}${n > names.length ? ' …' : ''}</p>` : (f.lineup?.length ? `<p class="fest-hi muted">${ja ? '出演' : '라인업'} ${f.lineup.length}${ja ? '組' : '팀'}</p>` : '');
  return `<article class="pcard fcard">
    <button class="pcard-art" data-open-concert="${esc(f.id)}" aria-label="${esc(f.title)}">${f.poster ? img(f.poster, '', f.posterKind === 'artist' ? 'poster is-artist-photo' : 'poster', { ratio: '3/4', initial: f.title, text: true }) : dateBox(f)}<span class="fest-cn">${esc(cn)}</span></button>
    <div class="pcard-body">
      <p class="pcard-date">${whenOf(f)}${dd ? ` <span class="dday">${dd}</span>` : ''}</p>
      <h3 class="pcard-title"><button data-open-concert="${esc(f.id)}">${esc(f.title)}</button></h3>
      ${f.venue ? `<p class="pcard-venue">${esc([f.venue, f.city].filter(Boolean).join(' · '))}</p>` : ''}
      ${hi}
    </div>
  </article>`;
}

export function ticketRow(c: Concert, { day = '' }: { day?: string } = {}) {
  concertRegistry.set(c.id, c);
  const now = Date.now();
  const opensAt = [c.ticketOpenAt, ...(c.openSchedule || []).map((s) => s.at)].filter((a): a is string => !!a && Date.parse(a) > now).sort()[0] || null;
  const at = opensAt || c.ticketOpenAt || null;
  const closing = !opensAt && c.closesAt && Date.parse(c.closesAt) > now ? c.closesAt : null;
  const soon = (opensAt && Date.parse(opensAt) - now < 36 * 3600e3) || (closing && Date.parse(closing) - now < 36 * 3600e3);
  // 팬클럽 접수 이름은 공식 명칭 그대로(팬클럽 사이트에서 같은 이름을 찾게), 성격은 태그로 설명
  const label = c.provider === 'fanclub' ? (c.ticketOpenLabel || c.saleType || t('c.open')) : saleLabel(c.ticketOpenLabel || c.saleType) || t('c.open');
  /* 일정표 안(그날 칸)에서는 같은 날이면 시각만, 다른 날이면 날짜까지 */
  const kstDay = (x: string) => Number.isFinite(Date.parse(x)) ? new Date(Date.parse(x) + 9 * 3600e3).toISOString().slice(0, 10) : '';
  const fmtAt = (x: string) => (day && kstDay(x) === day ? fmtTime(x) : fmtDateTime(x));
  const timeHtml = opensAt
    ? `<b>${esc(fmtAt(opensAt))}</b><span data-until="${esc(opensAt)}" data-until-k="c.soon">${esc(t('c.soon', { t: until(opensAt) }))}</span>`
    : closing
      ? `<b>~ ${esc(fmtAt(closing))}</b><span data-until="${esc(closing)}" data-until-k="c.closes">${esc(t('c.closes', { t: until(closing) }))}</span>`
      : at ? `<b>${esc(fmtAt(at))}</b><span>${esc(t('st.onsale'))}</span>` : `<b>${esc(t('c.tba'))}</b><span></span>`;
  return `<li class="trow${soon ? ' is-soon' : ''}${c.provider === 'fanclub' ? ' is-fc' : ''}" data-row-concert="${esc(c.id)}">
    <div class="trow-time">${timeHtml}</div>
    <button class="trow-art" data-open-concert="${esc(c.id)}" aria-label="${esc(c.title)}">${img(c.poster, '', 'thumb', { ratio: '3/4', initial: c.performer || c.title })}</button>
    <div class="trow-main">
      <p class="trow-label">${fcTag(c) || (state.edition === 'all' ? dirTag(c) : '')}<span>${esc(label)}</span><span class="prov"><span class="dot">·</span> ${esc(providerName(c))}</span>${(c.windowCount || 0) > 1 ? `<span class="dot">·</span><span>${esc(t('c.moreWindows', { n: c.windowCount! - 1 }))}</span>` : ''}</p>
      <h3><button data-open-concert="${esc(c.id)}">${titleOf(c)}</button></h3>
      <p class="trow-sub">${esc([placeOf(c), c.startDate ? whenOf(c) : ''].filter(Boolean).join(' · '))}</p>
    </div>
    ${c.provider === 'fanclub' ? `<div class="trow-cta"><a class="btn btn-solid sm" href="${esc(fcHowHref(c))}">${t('fc.howLink')}</a><a class="btn btn-line sm" href="${esc(safeHref(withUtm(c.url, 'fanclub_sale'), false))}" target="_blank" rel="noopener" data-fc-track="sale" data-artist="${esc(c.artistId || '')}">${t('fc.apply')}${icon('i-ext', 'ic xs')}</a></div>` : `<a class="btn btn-line sm" href="${esc(safeHref(c.url, false))}" target="_blank" rel="noopener">${t('ext.book')}${icon('i-ext', 'ic xs')}</a>`}
  </li>`;
}

const TOPIC_LABEL: Record<string, string> = { visit: 'n.visit', ticket: 'n.ticket', release: 'n.release', live: 'n.live', chart: 'n.chart' };

export function newsRow(n: News) {
  const topic = n.topics?.[0] ? t(TOPIC_LABEL[n.topics[0]] || '') : '';
  const rel = n.related || [];
  return `<li class="nrow"><a href="${esc(safeHref(n.url, false))}" target="_blank" rel="noopener">
    <span class="nrow-title">${esc(n.title)}</span>
    <span class="nrow-meta">${topic ? `<span class="tag">${esc(topic)}</span>` : ''}<span>${esc(n.source || '')}</span><span class="dot">·</span><span>${esc(ago(n.publishedAt))}</span></span>
  </a>${rel.length ? `<details class="nrow-rel"><summary>${esc(t('n.related', { n: rel.length }))}</summary><ul>${rel.map((r) => `<li><a href="${esc(safeHref(r.url, false))}" target="_blank" rel="noopener">${esc(r.title)}<span> · ${esc(r.source || '')}</span></a></li>`).join('')}</ul></details>` : ''}</li>`;
}

const AV: Record<string, string> = { preorder: 'g.preorder', instock: 'g.instock', soldout: 'g.soldout', backorder: 'g.backorder' };

/* 판매처 분류를 화면 언어로. 모르는 분류는 그대로 */
const FORMAT_L: Record<string, [string, string]> = {
  'CD': ['CD', 'CD'], 'CD Single': ['CD 싱글', 'CDシングル'], 'LP': ['LP', 'LP'], 'DVD': ['DVD', 'DVD'], 'Blu-ray': ['Blu-ray', 'Blu-ray'],
  'Cassette': ['카세트', 'カセット'], 'Book': ['도서', '書籍'], 'Goods': ['굿즈', 'グッズ'], 'Album': ['앨범', 'アルバム'], 'CD/LP': ['음반', 'CD・LP'],
  'Kit Album': ['키트 앨범', 'キットアルバム'], 'Photocards': ['포토카드', 'トレカ'], 'Card': ['카드', 'カード'], 'Badge': ['배지', 'バッジ'],
  'Bag': ['가방', 'バッグ'], 'Slogan': ['슬로건', 'スローガン'], 'Bracelet': ['팔찌', 'ブレスレット'], 'Wallet': ['지갑', '財布'], 'Hat': ['모자', '帽子'],
  'T-Shirts': ['티셔츠', 'Tシャツ'], 'Pants': ['바지', 'パンツ'], 'Toy': ['토이', 'トイ'], 'Keyring': ['키링', 'キーホルダー'], 'Plush Toys': ['인형', 'ぬいぐるみ'],
  'Magazines': ['잡지', '雑誌'], 'Season Greeting/Kit': ['시즌 그리팅', 'シーズングリーティング'], 'Snack': ['간식', 'お菓子'], 'Photobook': ['포토북', '写真集'],
  'Lightstick': ['응원봉', 'ペンライト'], 'Poster': ['포스터', 'ポスター'],
};
export function formatLabel(f: string | null | undefined) {
  if (!f) return '';
  const i = getLocale() === 'ja' ? 1 : 0;
  return f.split('+').map((p) => FORMAT_L[p.trim()]?.[i] || p.trim()).join('+');
}
const gdate = (d: string) => d.replace(/-/g, '.');

export function goodsCard(g: Offer, fx: { jpyKrw?: number } | null, buyer: string) {
  const av = AV[g.availability] ? t(AV[g.availability]) : '';
  const approx = g.currency !== buyer ? approxMoney(g.price, g.currency, buyer, fx) : '';
  const meta = [
    g.releaseDate ? `${gdate(g.releaseDate)} ${t('g.release')}` : '',
    formatLabel(g.format),
    g.set ? t('g.set', { n: g.set }) : '',
    g.region === 'JP' && state.edition !== 'jp' ? t('g.jpPress') : '',
    g.bonus === 'hmv' ? t('g.bonusHmv') : g.bonus ? t('g.bonusAny') : '',
  ].filter(Boolean);
  return `<a class="gcard" href="${esc(safeHref(g.url, false))}" target="_blank" rel="noopener">
    ${img(g.image, '', 'square', { ratio: '1/1', initial: g.artist || g.title })}
    <span class="gcard-store"><span>${esc(g.storeLabel)}</span>${av ? `<span class="gav gav-${esc(g.availability)}">${esc(av)}</span>` : ''}</span>
    <span class="gcard-title">${esc(g.title)}</span>
    <span class="gcard-price"><b>${money(g.price, g.currency)}</b>${approx ? `<span class="approx">${esc(approx)}</span>` : ''}</span>
    ${meta.length ? `<span class="gcard-meta">${meta.map(esc).join(' · ')}</span>` : ''}
  </a>`;
}

/* Apple 표기 꼬리(" - Single" " - EP")는 제목이 아니라 유형이다 */
export function releaseTitle(title: string) {
  return String(title || '').replace(/\s+-\s+(Single|EP)$/i, '').trim();
}
const REL_TYPE: Record<string, [string, string]> = { single: ['싱글', 'シングル'], ep: ['EP', 'EP'], mini: ['미니앨범', 'ミニアルバム'], album: ['앨범', 'アルバム'] };
export function releaseCard(r: Release) {
  const href = r.tier === 'curated' ? `#/release/${encodeURIComponent(r.id)}` : `#/goods?q=${encodeURIComponent(r.artist)}`;
  /* 한글 표기는 원어가 라틴 문자가 아닐 때만(米津玄師 → 요네즈 켄시). Mrs. GREEN APPLE·TWS는 다른 화면처럼 원어 그대로 */
  const artist = state.edition !== 'jp' && r.artistKo && !/^[\x20-\x7E]+$/.test(r.artist) ? r.artistKo : r.artist;
  const type = / - EP$/i.test(r.title) ? 'ep' : (r.type || '');
  const typeL = REL_TYPE[type]?.[getLocale() === 'ja' ? 1 : 0] || '';
  return `<a class="rcard" href="${href}">
    ${img(r.artwork, '', 'square', { ratio: '1/1', initial: r.artist })}
    <span class="rcard-title">${esc(releaseTitle(r.title))}</span>
    <span class="rcard-artist">${esc(artist)}</span>
    <span class="rcard-meta">${r.upcoming ? `<span class="tag tag-accent">${t('g.upcoming')}</span>` : ''}${esc([fmtDay(r.releaseDate, { year: true }), typeL].filter(Boolean).join(' · '))}${r.offerCount ? ` · ${t('g.compare')}` : ''}</span>
  </a>`;
}

/* 일본어 화면에서 한글 표기만 있는 이름은 로스터의 원어(라틴) 표기가 있으면 그것으로 */
export function artistName(a: { name: string; nameOriginal?: string | null; nameJa?: string | null }) {
  if (getLocale() === 'ja' && /[가-힣]/.test(a.name)) {
    if (a.nameOriginal && !/[가-힣]/.test(a.nameOriginal)) return a.nameOriginal;
    /* 위키백과 일본어판 제목(볼빨간사춘기 → Bolbbalgan4, 임영웅 → イム・ヨンウン) */
    if (a.nameJa && !/[가-힣]/.test(a.nameJa)) return a.nameJa;
  }
  return a.name;
}

export function artistCard(a: ArtistLite) {
  const o = a.origin === 'jp' || a.origin === 'kr' ? t(`a.origin.${a.origin}`) : '';
  return `<a class="acard" href="#/artist/${encodeURIComponent(a.id)}">
    ${img(a.photo || a.artwork, '', 'round', { ratio: '1/1', initial: a.name })}
    <span class="acard-name">${esc(artistName(a))}</span>
    <span class="acard-meta">${esc(getLocale() === 'ko' && a.nameKo && a.nameKo !== a.name ? a.nameKo : [o, genreLabel(a.genre)].filter(Boolean).join(' · '))}</span>
  </a>`;
}

export function followButton(id: string, name: string, cls = '') {
  const on = isFollowing(id);
  const style = cls.includes('lg') || cls.includes('on-dark') ? (on ? 'btn-line is-on' : 'btn-line') : on ? 'btn-line is-on' : 'btn-solid';
  return `<button class="btn ${style} ${cls}" data-follow="${esc(id)}" data-name="${esc(name)}" aria-pressed="${on}">${on ? icon('i-check', 'ic xs') + t('following') : icon('i-plus', 'ic xs') + t('follow')}</button>`;
}

export function bindFollow(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('[data-follow]:not([data-follow-bound])').forEach((b) => {
    b.dataset.followBound = '1';
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      const r = await toggleFollow(b.dataset.follow!, b.dataset.name || '').catch(() => null);
      b.disabled = false;
      if (r === null || !b.isConnected) return;
      b.outerHTML = followButton(b.dataset.follow!, b.dataset.name || '', b.className.replace(/btn-(line|solid)|is-on|btn/g, '').trim());
      bindFollow(root);
    });
  });
}

export interface ChartEntry { rank: number; title: string; artist: string; artwork?: string | null; appleUrl?: string | null; ranks?: Record<string, number> | null; move?: string | null; lastRank?: number | null }

export function chartRow(e: ChartEntry, i: number, { compact = false, sourceLabels = {} as Record<string, string> } = {}) {
  const tr: Track = { title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl };
  /* 소스별 순위: "Apple Music 6위"처럼. Apple 공식 피드가 Apple Music과 같은 순위면 한 번만 */
  const rk = e.ranks ? { ...e.ranks } as Record<string, number | null> : null;
  if (rk && rk.appleRss && rk.apple === rk.appleRss) delete rk.appleRss;
  const src = !compact && rk ? Object.entries(rk).filter(([, v]) => v).map(([k, v]) => `${esc(sourceLabels[k] || k)} ${esc(t('ch.rankN', { n: v as number }))}`).join(' · ') : '';
  return `<li class="crow" data-track-key="${esc(keyOf(tr))}">
    <span class="crow-rank">${esc(e.rank ?? i + 1)}</span>
    <button class="crow-art" data-play="${i}" aria-label="${esc(e.title)} ${t('ch.play')}">${img(e.artwork, '', 'square', { ratio: '1/1', initial: e.artist })}<span class="crow-play">${icon('i-play', 'ic')}</span><span class="crow-eq" aria-hidden="true"><i></i><i></i><i></i></span></button>
    <div class="crow-main"><b>${esc(e.title)}</b><a href="#/artist/name/${encodeURIComponent(e.artist)}">${esc(e.artist)}</a>${src ? `<span class="crow-src">${src}</span>` : ''}</div>
    ${compact ? '' : `<div class="crow-soc">${likeBtn(trackTarget(tr), 'is-mini')}${talkBtn(trackTarget(tr), '#/track/{key}', 'is-mini')}</div>`}
  </li>`;
}

/* 티켓 오픈 카드 — 예매처 앱의 오픈 예정 카드처럼: 흐린 포스터 배경 위에 포스터, 아래에 오픈 시각을 가장 먼저 */
export function openLabel(iso: string | null | undefined) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const k = new Date(ms + 9 * 3600e3);
  const day = k.toISOString().slice(0, 10);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 33 * 3600e3).toISOString().slice(0, 10);
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  if (day === today) return `${t('c.today')} ${hm}`;
  if (day === tomorrow) return `${t('c.tomorrow')} ${hm}`;
  return fmtDateTime(iso);
}
export function openCard(c: Concert) {
  concertRegistry.set(c.id, c);
  const now = Date.now();
  const opensAt = [c.ticketOpenAt, ...(c.openSchedule || []).map((x) => x.at)].filter((a): a is string => !!a && Date.parse(a) > now).sort()[0] || null;
  const closing = !opensAt && c.closesAt && Date.parse(c.closesAt) > now ? c.closesAt : null;
  const time = opensAt ? openLabel(opensAt) : closing ? t('c.closesAt', { t: openLabel(closing) }) : c.openTba ? t('c.tba') : t('st.onsale');
  const kind = c.provider === 'fanclub' ? ((c as Concert & { isPublic?: boolean }).isPublic ? t('fc.tag.public') : c.fcOnly ? t('fc.tag.only') : t('fc.tag.first')) : saleLabel(c.ticketOpenLabel || c.saleType) || '';
  const poster = safeImage(c.poster);
  const bg = poster ? ` style="background-image:url(${esc(JSON.stringify(poster))})"` : '';
  return `<li class="ocard${opensAt ? '' : ' is-live'}">
    <button class="ocard-art" data-open-concert="${esc(c.id)}" aria-label="${esc(c.title)}"><span class="ocard-bg"${bg}></span>${img(c.poster, '', 'poster', { ratio: '3/4', initial: c.performer || c.title, text: true })}</button>
    <p class="ocard-time">${esc(time)}</p>
    <h3 class="ocard-title"><button data-open-concert="${esc(c.id)}">${esc(c.title)}</button></h3>
    <p class="ocard-meta">${kind ? `<b class="${c.provider === 'fanclub' ? 'lbl-fc' : 'lbl'}">${esc(kind)}</b>` : ''}<span>${esc(providerName(c))}</span></p>
  </li>`;
}

/* 공연 상세 — 티켓링크 상품 페이지처럼 전체 페이지(#/concert/<id>)로 연다.
   새로고침·공유해도 열리게 공연 정보를 세션에 남긴다 */
export function openConcert(id: string, { replace = false } = {}) {
  const c = concertRegistry.get(id);
  if (!c) return;
  try { sessionStorage.setItem('lilac.concert.' + id, JSON.stringify(c)); } catch { /* 저장 공간 부족 — 상세에서 목록을 다시 찾는다 */ }
  const href = '#/concert/' + encodeURIComponent(id);
  if (replace) location.replace(href); else location.hash = href;
}
