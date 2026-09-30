/* ============================================================
   릴리스 상세 — 판매처 × 사양 비교

   왜 이 화면이 필요한가 (docs/bm-store-review.md 참고)
   기존 스토어는 앨범에 지어낸 가격을 붙이고 판매처 "검색 결과"로 링크만 걸었다.
   그러면 사용자는 일본어 목록에서 자기가 살 사양을 직접 찾아야 하고,
   라일락은 아무것도 하지 않은 것과 같다.

   실제 구매 결정은 사양(5종) × 판매처(9종) 조합에서 이뤄지고,
   그 판단의 핵심 변수는 판매처별 특전이다. 이 화면은 그걸 한 표로 모은다.

   중요한 사실 하나: 일본 음반은 독점금지법 §24-2 의 재판매가격유지 예외
   대상이라 판매처가 달라도 정가가 같다. 그래서 이 표를 "가격 비교"로
   포장하면 거짓말이 된다. 가격이 같을 때는 그렇다고 먼저 말하고,
   진짜 변수(특전·직배송·캠페인)를 앞세운다.
   ============================================================ */

import { api, artUrl, esc, me } from './api';
import { toast } from './player';

interface QuoteBreakdown {
  base: number; fee: number; feeRate: number; shipping: number; total: number;
  currency: string; savedVsFree: number; feeDiscount: number;
}
interface Row {
  editionId: string; editionLabel: string; catalogNo: string | null;
  includes: string[]; exclusiveTo: string | null; editionNote: string | null;
  offerId: string; store: string; storeKo: string; storeCountry: string; url: string;
  bonus: string | null; bonusJa: string | null;
  campaignEligible: boolean | null; shipsDirect: boolean; verified: boolean;
  offerNote: string | null; listPrice: number; listCurrency: string;
  quote: QuoteBreakdown; diffFromCheapest: number;
}
interface Comparison {
  rate: number; buyerCountry: string; planTier: string;
  rows: Row[];
  byEdition: { editionId: string; label: string; min: number; max: number; spread: number; stores: number }[];
  priceFixed: boolean;
  decisiveFactors: string[];
  fx: { date?: string; source?: string };
}
interface ReleaseDetail {
  release: {
    id: string; artist: string; artistKo?: string; artistId: string;
    title: string; titleKo?: string; country: string; type: string;
    releaseDate: string; currency: string; note?: string;
    source?: { name: string; url: string; collectedAt: string };
    campaign?: {
      name: string; desc: string;
      storeOpensAt?: string; storeClosesAt?: string; onlineOpensAt?: string;
    } | null;
    editions: { id: string; label: string; listPrice: number; catalogNo?: string; includes?: string[] }[];
    tier?: string;
    searchHints?: { store: string; storeKo: string; searchUrl: string }[];
    appleUrl?: string | null;
  };
  comparison: Comparison;
}

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

function dday(iso?: string | null) {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
  return { d, txt: d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '마감' };
}

export async function pageRelease(id: string) {
  const root = $('#page');
  root.innerHTML = `<div class="rel-skel"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div>`;

  let data: ReleaseDetail;
  try {
    data = (await api(`/api/store/releases/${encodeURIComponent(id)}`)) as ReleaseDetail;
  } catch {
    root.innerHTML = `<div class="page-section"><h2>릴리스를 찾을 수 없습니다</h2>
      <p class="muted">주소를 확인해 주세요. <a href="#/store">스토어로 돌아가기</a></p></div>`;
    return;
  }

  const { release: r, comparison: c } = data;
  const campaignDday = dday(r.campaign?.storeClosesAt);
  // 비교행이 없으면 byEdition 도 비는데, 릴리스 자체에는 사양이 있다.
  const editions = c.byEdition.length
    ? c.byEdition
    : r.editions.map((e) => ({ editionId: e.id, label: e.label, min: 0, max: 0, spread: 0, stores: 0 }));
  let activeEd = editions[0]?.editionId ?? '';

  root.innerHTML = `
  <section class="rel-head toned">
    <div class="rel-head-in">
      <p class="rel-kicker">${esc(r.artistKo || r.artist)} · ${r.country === 'jp' ? '일본반' : '한국반'} · ${esc(r.releaseDate)} 발매</p>
      <h1 class="rel-title">${esc(r.titleKo || r.title)}</h1>
      ${r.note ? `<p class="rel-note">${esc(r.note)}</p>` : ''}

      <div class="rel-facts">
        ${r.tier === 'discovered'
          ? '<span class="rel-fact warn">특전 확인 중</span>'
          : '<span class="rel-fact pass">특전 확인됨</span>'}
        <span class="rel-fact"><b>${r.editions.length}</b> 사양</span>
        ${c.rows.length ? `
          <span class="rel-fact"><b>${new Set(c.rows.map((x) => x.offerId)).size}</b> 판매처</span>
          <span class="rel-fact"><b>${c.rows.length}</b> 조합</span>` : ''}
        ${c.planTier !== 'free' ? '<span class="rel-fact pass">Pass 수수료 할인 적용</span>' : ''}
      </div>

      ${
        c.priceFixed
          ? `<div class="rel-callout">
               <b>판매처가 달라도 가격은 같습니다.</b>
               일본 음반은 독점금지법 제24조의2에 따라 저작물 재판매가격유지 예외 대상이라
               정가 판매가 원칙입니다. 그래서 여기서 실제로 갈리는 것은
               <b>${c.decisiveFactors.map(esc).join(' · ')}</b>입니다.
             </div>`
          : ''
      }

      ${
        r.campaign
          ? `<div class="rel-campaign">
               <div class="rel-campaign-h">
                 <span class="rel-campaign-name">${esc(r.campaign.name)}</span>
                 ${campaignDday ? `<span class="rel-dday ${campaignDday.d <= 7 ? 'urgent' : ''}">${campaignDday.txt}</span>` : ''}
               </div>
               <p>${esc(r.campaign.desc)}</p>
               ${r.campaign.storeClosesAt ? `<p class="rel-campaign-when">점포 예약 마감 ${esc(r.campaign.storeClosesAt)}</p>` : ''}
             </div>`
          : ''
      }
    </div>
  </section>

  <section class="page-section rel-body">
    <div class="rel-edtabs" id="relEdTabs">
      ${editions
        .map(
          (e) => `<button class="rel-edtab ${e.editionId === activeEd ? 'on' : ''}" data-ed="${esc(e.editionId)}">
            <b>${esc(e.label)}</b>${e.stores ? `<i>${won(e.min)}</i>` : ''}</button>`,
        )
        .join('')}
    </div>

    <div id="relTable"></div>

    <div class="rel-meta">
      ${
        r.source
          ? `<p>출처: <a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source.name)}</a> · 수집 ${esc(r.source.collectedAt)}</p>`
          : ''
      }
      <p>환율 1엔 = ${c.rate === 1 ? '—' : c.rate.toFixed(4) + '원'}${c.fx?.date ? ` (${esc(c.fx.date)} 기준)` : ''} ·
         표시 금액은 정가 + 중개 수수료 + 배송비 합산입니다. 관세 등 수취 국가 공과금은 포함되지 않습니다.</p>
      <p class="rel-disclaim">전매·양도 중개는 취급하지 않습니다. 공동 <b>구매</b>만 다룹니다.</p>
    </div>
  </section>`;

  const paint = () => {
    const rows = c.rows.filter((x) => x.editionId === activeEd);
    const ed = r.editions.find((e) => e.id === activeEd);
    $('#relTable').innerHTML = `
      ${
        ed
          ? `<p class="rel-edinfo">
               ${ed.catalogNo ? `<span class="rel-cat">${esc(ed.catalogNo)}</span>` : ''}
               정가 ${r.currency === 'JPY' ? '¥' : '₩'}${ed.listPrice.toLocaleString()}
               ${ed.includes?.length ? ` · 구성 ${ed.includes.map(esc).join(' + ')}` : ''}
             </p>`
          : ''
      }
      ${rows.length === 0 ? `
        <div class="rel-empty">
          <b>판매처와 특전이 아직 확인되지 않았습니다.</b>
          <p>발매 정보만 자동으로 수집된 상태입니다. 사양과 판매처별 특전은
             레이블 특설 사이트를 확인해야 알 수 있어 자동화하지 않았습니다 —
             확인되지 않은 값을 넣느니 비워 두는 편이 낫다고 판단했습니다.</p>
          ${r.searchHints?.length ? `
            <div class="rel-hints">
              <span class="rel-hints-l">판매처에서 직접 찾아보기</span>
              ${r.searchHints.map((h) => `<a href="${esc(h.searchUrl)}" target="_blank" rel="noopener noreferrer">${esc(h.storeKo)} 검색</a>`).join('')}
            </div>` : ''}
          ${r.appleUrl ? `<p class="rel-hints-apple"><a href="${esc(r.appleUrl)}" target="_blank" rel="noopener noreferrer">Apple Music에서 보기</a></p>` : ''}
        </div>` : `
      <div class="rel-table-wrap" role="region" aria-label="판매처 비교표" tabindex="0">
        <table class="rel-table" aria-label="${esc(ed?.label || '')} 판매처별 특전, 배송 및 최종가 비교">
          <thead>
            <tr>
              <th scope="col">판매처</th><th scope="col">특전</th><th scope="col">배송</th>
              ${r.campaign ? `<th scope="col">${esc(r.campaign.name)}</th>` : ''}
              <th scope="col" class="num">최종가</th><th scope="col" aria-label="판매처 방문 및 알림"></th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (x) => `
            <tr${x.shipsDirect ? ' class="direct"' : ''}>
              <td data-label="판매처">
                <b>${esc(x.storeKo)}</b>
                ${x.verified ? '' : '<span class="rel-badge est">추정</span>'}
                ${x.offerNote ? `<i class="rel-sub">${esc(x.offerNote)}</i>` : ''}
              </td>
              <td data-label="특전">${x.bonus ? esc(x.bonus) : '<span class="muted">—</span>'}
                  ${x.bonusJa ? `<i class="rel-sub">${esc(x.bonusJa)}</i>` : ''}</td>
              <td data-label="배송">${x.shipsDirect ? '<span class="rel-ok">직배송</span>' : '<span class="rel-warn">대행 필요</span>'}</td>
              ${r.campaign ? `<td data-label="${esc(r.campaign.name)}">${x.campaignEligible ? '<span class="rel-ok">대상</span>' : '<span class="muted">비대상</span>'}</td>` : ''}
              <td class="num" data-label="최종가">
                <b>${won(x.quote.total)}</b>
                ${x.diffFromCheapest > 0 ? `<i class="rel-sub">+${won(x.diffFromCheapest)}</i>` : ''}
                ${x.quote.savedVsFree > 0 ? `<i class="rel-sub pass">Pass −${won(x.quote.savedVsFree)}</i>` : ''}
              </td>
              <td class="acts">
                <a class="rel-go" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">판매처</a>
                <button class="rel-watch" data-offer="${esc(x.offerId)}" data-ed="${esc(x.editionId)}" title="예약 마감 알림">알림</button>
              </td>
            </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>`}
      ${
        rows.some((x) => x.exclusiveTo)
          ? `<p class="rel-excl">이 사양은 특정 판매처 전용이라 다른 곳에서 구매할 수 없습니다.</p>`
          : ''
      }`;

    $('#relTable').querySelectorAll<HTMLButtonElement>('.rel-watch').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!me) { toast('알림은 로그인 후 사용할 수 있습니다'); return; }
        try {
          const list = await api('/api/watches', {
            method: 'POST',
            body: JSON.stringify({ releaseId: r.id, offerId: b.dataset.offer, editionId: b.dataset.ed }),
          });
          toast(Array.isArray(list) && list.some((w: { offerId: string }) => w.offerId === b.dataset.offer)
            ? '알림을 켰습니다' : '알림을 껐습니다');
        } catch (e) { toast((e as Error).message); }
      }),
    );
  };

  $('#relEdTabs').querySelectorAll<HTMLButtonElement>('.rel-edtab').forEach((t) =>
    t.addEventListener('click', () => {
      activeEd = t.dataset.ed!;
      $('#relEdTabs').querySelectorAll('.rel-edtab').forEach((x) => x.classList.toggle('on', x === t));
      paint();
    }),
  );
  paint();
}

interface ListItem {
  id: string; artist: string; artistKo?: string; title: string; titleKo?: string;
  country: string; releaseDate: string; tier: string; artwork?: string | null;
  artworkStatus?: string | null; appleReleaseDate?: string | null;
  editionCount: number; offerCount: number; hasCampaign: boolean;
}
interface SyncState {
  lastAt: string | null;
  lastResult?: { curated: number; discovered: number; artistsQueried: number; changes: number } | null;
}

const relCard = (x: ListItem) => {
  /* 사실 줄은 아는 것만 적는다.
     예전엔 무조건 "판매처 N" 을 찍어서, 아직 수집 안 된 릴리스가
     "판매처 0" 으로 나왔다. 0곳이라는 뜻이 아니라 아직 모른다는 뜻이라
     그대로 쓰면 거짓말이 된다. */
  /* 저장된 발매일이 애플과 다르면 확정으로 쓰지 않는다.
     사람이 확인해 넣은 값을 자동 수집이 덮어쓰지도 않았으므로,
     화면에서도 하나로 단정하지 않고 확인이 필요함을 드러낸다. */
  const dateLabel = x.appleReleaseDate && x.appleReleaseDate !== x.releaseDate
    ? `${esc(x.releaseDate)} <span class="rel-card-warn" title="애플 카탈로그는 ${esc(x.appleReleaseDate)}로 표기합니다">확인 필요</span>`
    : esc(x.releaseDate);
  const facts = [dateLabel];
  if (x.offerCount > 0) facts.push(`판매처 ${x.offerCount}곳`);
  if (x.hasCampaign) facts.push('예약특전');

  /* 음반 스토어인데 카드에 커버가 없었다. 131건 중 128건은 아트워크가
     있는데도 렌더링하지 않아 글자만 늘어서 있었다. */
  /* 커버가 없는 이유를 구분한다.
     레이블이 아직 공개하지 않은 것(MGA 6집은 공식 사이트가 「タイトル未発表」)과
     단순히 못 받은 것은 다르다. 앞의 경우는 그렇다고 적는다. */
  const art = x.artwork
    ? `<img src="${esc(artUrl({ artwork: x.artwork }, 320))}" alt="" loading="lazy" decoding="async"/>`
    : x.artworkStatus === 'unavailable'
      ? `<span class="rel-card-noart">커버<br/>미공개</span>`
      : `<span class="rel-card-noart" aria-hidden="true">${esc((x.artistKo || x.artist || '?').slice(0, 2))}</span>`;

  return `
  <a class="rel-card${x.tier === 'discovered' ? ' plain' : ''}" href="#/release/${esc(x.id)}">
    <span class="rel-card-art">${art}</span>
    <span class="rel-card-body">
      <span class="rel-card-top">
        <span class="rel-card-tag">${x.country === 'jp' ? '일본반' : '한국반'}</span>
        ${x.tier === 'curated'
          ? '<span class="rel-card-tier ok">특전 확인됨</span>'
          : '<span class="rel-card-tier">특전 확인 중</span>'}
      </span>
      <b>${esc(x.titleKo || x.title)}</b>
      <i>${esc(x.artistKo || x.artist)}</i>
      <span class="rel-card-facts">${facts.join(' · ')}</span>
    </span>
  </a>`;
};

/** 스토어 상단에 붙는 "판매처 비교" 진입 영역 */
export async function releaseCards(): Promise<string> {
  try {
    const [curatedRes, recentRes, sync] = await Promise.all([
      api('/api/store/releases?tier=curated&limit=6') as Promise<{ releases: ListItem[]; total: number }>,
      api('/api/store/releases?limit=8') as Promise<{ releases: ListItem[]; total: number }>,
      api('/api/store/sync').catch(() => null) as Promise<SyncState | null>,
    ]);
    if (!curatedRes?.releases?.length && !recentRes?.releases?.length) return '';

    const synced = sync?.lastAt
      ? `${new Date(sync.lastAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준`
      : '';
    const covered = sync?.lastResult
      ? `아티스트 ${sync.lastResult.artistsQueried}팀 · 릴리스 ${recentRes.total}건`
      : `릴리스 ${recentRes.total}건`;

    // curated 를 앞에, 나머지는 최신순으로 채운다 — 특전까지 확인된 것이 먼저 보여야 한다
    const seen = new Set(curatedRes.releases.map((r) => r.id));
    const rest = recentRes.releases.filter((r) => !seen.has(r.id)).slice(0, 6);

    return `
    <div class="rel-strip">
      <div class="rel-strip-h">
        <h2>판매처 비교</h2>
        <p>같은 앨범이라도 어디서 사느냐에 따라 특전이 다릅니다. 사양 × 판매처를 한 표로 모았습니다.</p>
        <p class="rel-sync">${esc(covered)}${synced ? ` · <span class="rel-sync-dot"></span>${esc(synced)} 자동 동기화` : ''}</p>
      </div>
      <div class="rel-strip-cards">
        ${[...curatedRes.releases, ...rest].slice(0, 3).map(relCard).join('')}
      </div>
      <p class="rel-strip-more"><a class="btn-sec" href="#/releases">전체 ${recentRes.total}건 보기</a></p>
    </div>`;
  } catch {
    return '';
  }
}

/** 릴리스 전체 목록 — 등급·국가 필터 */
export async function pageReleases() {
  const root = $('#page');
  root.innerHTML = `<div class="rel-skel"><span class="sk"></span><span class="sk"></span></div>`;

  let tier = '';
  let country = '';
  let offset = 0;
  const LIMIT = 24;
  let items: ListItem[] = [];
  let total = 0;

  const load = async (reset: boolean) => {
    if (reset) { offset = 0; items = []; }
    const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (tier) qs.set('tier', tier);
    if (country) qs.set('country', country);
    const r = (await api(`/api/store/releases?${qs}`)) as { releases: ListItem[]; total: number; hasMore: boolean };
    items = [...items, ...r.releases];
    total = r.total;
    return r.hasMore;
  };

  const paint = (hasMore: boolean) => {
    root.innerHTML = `
    <section class="page-section rel-list-page">
      <h1 class="rel-list-title">판매처 비교</h1>
      <p class="rel-list-sub">발매를 자동으로 훑고, 특전이 확인된 건은 판매처별로 비교합니다.</p>
      <div class="rel-filters">
        ${[['', '전체'], ['curated', '특전 확인됨'], ['discovered', '확인 중']]
          .map(([v, l]) => `<button class="rel-filter ${tier === v ? 'on' : ''}" data-tier="${v}">${l}</button>`).join('')}
        <span class="rel-filter-sep"></span>
        ${[['', '양국'], ['jp', '일본반'], ['kr', '한국반']]
          .map(([v, l]) => `<button class="rel-filter ${country === v ? 'on' : ''}" data-country="${v}">${l}</button>`).join('')}
      </div>
      <p class="rel-list-count">${total}건</p>
      <div class="rel-strip-cards">${items.map(relCard).join('')}</div>
      ${hasMore ? '<div class="rel-more-wrap"><button class="rel-more" id="relMore">더 보기</button></div>' : ''}
    </section>`;

    root.querySelectorAll<HTMLButtonElement>('.rel-filter').forEach((b) =>
      b.addEventListener('click', async () => {
        if (b.dataset.tier !== undefined) tier = b.dataset.tier;
        if (b.dataset.country !== undefined) country = b.dataset.country;
        paint(await load(true));
      }),
    );
    document.getElementById('relMore')?.addEventListener('click', async () => {
      offset += LIMIT;
      paint(await load(false));
    });
  };

  try { paint(await load(true)); }
  catch { root.innerHTML = `<div class="page-section"><h2>목록을 불러오지 못했습니다</h2></div>`; }
}
