import { fanclubCacheNotice } from './fanclub';
import type { FanclubCache } from './fanclub';
import { safeExternal } from './_safety';
/* 팬클럽 상품 상세 (#/fanclub/<artistId>)
 * Weverse Shop 멤버십 상품 화면 구조: 왼쪽 대표 이미지, 오른쪽 이름·가격·옵션(거주지·코스)·핵심 조건·가입 버튼,
 * 아래 고정 탭(가입 방법 · 요금·결제 · 유의사항 · 선행 접수 · 문의)과 단계별 실제 화면.
 * 값은 모두 팬클럽 가입 페이지에서 읽은 것. 모르는 값은 "가입 페이지 기준". 결제는 공식 사이트에서. */
import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, money, errorState, skeletonRows } from '../ui';
import { withUtm, approx, fcWindowRow } from '../fanclub';
import type { Fanclub, FcFacts } from '../fanclub';
import { platformOf, guideSteps, payKo, srcLinks, clubName, displayName, PLATFORM_NAME, CHECKED } from '../fcguide';
import type { Amt, Residence, GuideFacts } from '../fcguide';
import { likeBtn, shareBtn, bindSocial, avatar } from '../social';
import { cleanPays, summaryRows, summaryHtml, prepCards, prepHtml, platKey, platformNotesHtml, PLATFORM_KNOW, KNOW_CHECKED } from '../fcknow';
import type { Evidence, Verdict } from '../fcknow';
import SHOTS from '../fcshots.json';
import type { Target } from '../social';
import { ct } from '../cm-i18n';

type Facts = FcFacts & { residence?: Residence | null; overseasJoin?: string | null; image?: string | null; period?: string | null; ogTitle?: string | null; fees: FcFacts['fees'] & { free?: boolean }; evidence?: Evidence | null; verdict?: Verdict | null; evidencePages?: string[]; globalSite?: { url: string; label: string } | null };
interface Profile { id: string | null; name: string; names: string[]; origin: string; photo: { picture?: string } | null; artwork: string | null; fanclub: (Fanclub & { cache?: FanclubCache | null }) | null }

const KO = {
  crumbs: '팬클럽', official: '공식 팬클럽', residence: '거주지', course: '코스', ovs: '해외 (한국 등)', jp: '일본',
  annual: '연회비', annualShip: '연회비 · 특전 우편 발송', annualNoShip: '연회비 · 특전 발송 없음', monthly: '월회비', free: '무료 회원',
  perYear: '/ 1년', perMonth: '/ 1개월', seePage: '가입 페이지 기준', period: '회원 기간', pay: '결제', renew: '자동 갱신', renewYes: '신용카드 결제는 자동 갱신',
  lang: '가입 화면', langKo: '한국어 지원(자동 번역)', langJa: '일본어', windows: '선행 접수', windowsN: '지금 {n}건 접수 중', windowsNone: '지금 열린 접수 없음',
  join: '공식 사이트에서 가입하기', joinOvs: '해외 거주자로 가입하기', note: '결제와 가입은 팬클럽 공식 사이트에서 진행됩니다. Lilac은 가입을 대신하지 않습니다.',
  tabHow: '가입 방법', tabFee: '요금·결제', tabNote: '유의사항', tabWin: '선행 접수', tabQna: '문의', tabCheck: '가입 조건', tabPrep: '준비물',
  checkH: '한국에서 가입할 수 있나요', prepH: '한국에서 가입 전 준비', prepSub: '카드·주소·이름·전화번호', platH: '{p} 공통 규칙', globalBtn: '해외 팬용 사이트',
  step: 'STEP', src: '출처', feeTable: '거주지별 요금', col: ['', '해외 거주 (한국)', '일본 거주'],
  noteH: '가입 전에 확인하세요', notFound: '이 아티스트의 공식 팬클럽을 찾지 못했습니다.',
  nLocked: '거주지 코스를 잘못 고르면 탈퇴 후 다시 가입해야 하고, 낸 회비는 돌려받지 못합니다.',
  nReal: '반드시 본인 명의로 가입합니다. 선행 신청 때 신청자와 회원 정보가 다르면 접수되지 않습니다.',
  nDebit: '체크카드·선불카드는 동작을 보장하지 않습니다. 해외 결제가 되는 신용카드를 준비하세요.',
  nRenew: '신용카드로 낸 회비는 자동 갱신됩니다. 끄는 기한은 팬클럽 마이페이지 안내를 따르세요.',
  nShip: '회원증 등 특전의 해외 발송은 "특전 우편 발송" 코스에서만 됩니다.',
  nJpOnly: '일본에 거주하고 일본 국내 우편으로 받을 수 있는 주소가 있어야 가입할 수 있습니다(회원 규약).',
  nLimits: '해외 거주 회원은 일부 서비스(굿즈 구매 등)가 제한될 수 있다고 안내되어 있습니다.',
  nCheck: '요금·조건은 팬클럽이 바꿀 수 있습니다. Lilac은 가입 페이지와 FAQ를 주기적으로 다시 읽어 바뀌면 이 화면에 반영합니다.',
  qnaH: '가입 질문과 후기', qnaGo: '팬클럽 가입 게시판', qnaAsk: '질문 쓰기', qnaEmpty: '아직 이 팬클럽에 관한 글이 없습니다.',
  imgSrc: '이미지: 공식 팬클럽 사이트', checked: '{d} 확인',
  wvPay: 'JAPAN 샵: 신용카드·일본 편의점·PayPay 등 / GLOBAL 샵: 국내 카드·간편결제 (Weverse 고객센터)',
};
const JA: typeof KO = {
  crumbs: 'ファンクラブ', official: '公式ファンクラブ', residence: 'お住まい', course: 'コース', ovs: '日本以外', jp: '日本',
  annual: '年会費', annualShip: '年会費・特典発送あり', annualNoShip: '年会費・特典発送なし', monthly: '月会費', free: '無料会員',
  perYear: '/ 1年', perMonth: '/ 1か月', seePage: '入会ページ参照', period: '会員期間', pay: '支払い', renew: '自動継続', renewYes: 'クレジットカードは自動継続',
  lang: '入会ページ', langKo: '韓国語あり', langJa: '日本語', windows: '先行受付', windowsN: '受付中 {n}件', windowsNone: '受付中なし',
  join: '公式サイトで入会', joinOvs: '海外在住で入会', note: '支払いと入会は公式サイトで行います。Lilacは入会を代行しません。',
  tabHow: '入会方法', tabFee: '会費・支払い', tabNote: '注意事項', tabWin: '先行受付', tabQna: '質問', tabCheck: '入会の条件',  tabPrep: '準備',
  checkH: '入会の条件', prepH: '入会前の準備', prepSub: '', platH: '{p} 共通ルール', globalBtn: '海外ファン向けサイト',
  step: 'STEP', src: '出典', feeTable: 'お住まい別の会費', col: ['', '海外在住', '日本在住'],
  noteH: '入会前にご確認ください', notFound: '公式ファンクラブが見つかりませんでした。',
  nLocked: '居住地コースを誤って選ぶと退会しないと変更できず、返金もありません。',
  nReal: '必ず本人名義で登録してください。先行申込時に申込者と会員情報が違うと受け付けられません。',
  nDebit: 'デビット・プリペイドカードは動作保証外です。',
  nRenew: 'クレジットカードは自動継続です。',
  nShip: '会員証など特典の海外発送は「特典発送あり」コースのみ。',
  nJpOnly: '日本国内に居住し、国内郵便で届く住所が必要です(会員規約)。',
  nLimits: '海外会員は一部サービスが異なります。',
  nCheck: '会費・条件は変更されることがあります。Lilacは入会ページとFAQを定期的に読み直し、変更があれば反映します。',
  qnaH: '入会の質問とレポ', qnaGo: 'ファンクラブ入会掲示板', qnaAsk: '質問する', qnaEmpty: 'このファンクラブについての投稿はまだありません。',
  imgSrc: '画像: 公式ファンクラブサイト', checked: '{d} 確認',
  wvPay: 'クレジットカード・コンビニ・PayPayほか(JAPANショップ、Weverseヘルプ)',
};

/* 회원 기간 원문 → 한국어 */
function periodKo(p: string | null | undefined) {
  if (!p) return '';
  if (getLocale() === 'ja') return p;
  if (/入会月を含む\s*12\s*[ヵヶかカケ]月/.test(p)) return '가입한 달 포함 12개월';
  if (/入会日(?:より|から)\s*365\s*日/.test(p)) return '가입일부터 365일';
  if (/翌年同月同日まで/.test(p)) return '가입일부터 1년(다음 해 같은 날까지)';
  if (/翌年同月末日まで/.test(p)) return '다음 해 같은 달 말일까지';
  if (/入会を承認した日の翌月1日から\s*1\s*年/.test(p)) return '입회 승인 다음 달 1일부터 1년';
  if (/ご?入会月の翌年の月末まで/.test(p)) return '가입한 달의 다음 해 같은 달 말일까지';
  /* 번역 규칙이 없는 표기는 원문 그대로 두되 원문임을 알린다 */
  return `${p} (원문)`;
}

interface Opt { key: string; label: string; sub?: string; amt: Amt | null; per: 'y' | 'm'; free?: boolean }

export async function renderFanclubProduct(root: HTMLElement, alive: () => boolean, artistId: string) {
  const L = getLocale() === 'ja' ? JA : KO;
  root.innerHTML = `<div class="page fcpd"><div class="pdp">${'<div class="sk sk-block"></div>'.repeat(2)}</div></div>`;
  const [p, fx] = await Promise.all([
    api(`/api/live/artist?id=${encodeURIComponent(artistId)}&edition=${state.edition}`).catch(() => null) as Promise<Profile | null>,
    api('/api/live/fx').catch(() => null),
  ]);
  if (!alive()) return;
  if (!p?.name) {
    root.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderFanclubProduct(root, alive, artistId));
    return;
  }
  const fc = p.fanclub;
  if (!p || !fc || fc.found === false || !(fc.entry || fc.home)) {
    root.innerHTML = `<div class="page fcpd"><div class="feed-empty"><p>${esc(L.notFound)}</p>${fanclubCacheNotice(fc?.cache)}<a class="btn btn-line" href="#/fanclub">${esc(L.crumbs)}</a></div></div>`;
    return;
  }
  const f = (fc.facts || { fees: null, overseas: 'unknown', payments: [], languages: [] }) as Facts;
  const plat = platformOf(fc);
  const ja = getLocale() === 'ja';
  const res = f.residence || null;
  const pk = platKey(fc.platform || f.platform, fc.entry || fc.home || '');
  const vo = f.verdict?.overseas || null;
  const ovsState = plat === 'familyclub' ? 'no' : f.overseas === 'yes' || f.overseas === 'no' ? f.overseas : vo === 'limited' ? 'limited' : vo || (pk && PLATFORM_KNOW[pk]?.overseas?.v === 'yes' ? 'yes' : pk && PLATFORM_KNOW[pk]?.overseas?.v === 'no' ? 'no' : 'unknown');
  const saleOpen = ((fc as { saleOpen?: boolean | null }).saleOpen ?? (f as { saleOpen?: boolean | null }).saleOpen) ?? null;
  const aname = displayName(p.name, p.names || []);
  const club = clubName(fc.name || f.name) || (plat === 'weverse' ? 'Weverse Membership' : `${aname} ${L.official}`);
  const photo = p.photo?.picture || p.artwork || null;
  const image = f.image || photo;
  document.title = `${club} · ${aname} · Lilac`;

  /* 옵션: 거주지 → 코스 */
  const courses = (side: 'ovs' | 'jp'): Opt[] => {
    const c = res ? (side === 'ovs' ? res.overseas : res.jp) : null;
    if (c) {
      const out: Opt[] = [];
      if (c.annual) out.push({ key: 'a', label: c.annualShip ? L.annualNoShip : L.annual, amt: c.annual, per: 'y' });
      if (c.annualShip) out.push({ key: 'as', label: L.annualShip, sub: c.shipFee ? `+${c.shipFee.cur === 'USD' ? `${c.shipFee.v} USD` : money(c.shipFee.v, 'JPY')}` : '', amt: c.annualShip, per: 'y' });
      out.push({ key: 'm', label: L.monthly, amt: c.monthly, per: 'm' });
      return out;
    }
    const fe = f.fees;
    if (fe?.free) return [{ key: 'f', label: L.free, amt: { v: 0, cur: 'JPY' }, per: 'y', free: true }];
    const out: Opt[] = [];
    if (fe?.annual || !fe?.monthly) out.push({ key: 'a', label: L.annual, amt: fe?.annual ? { v: fe.annual, cur: 'JPY' } : null, per: 'y' });
    if (fe?.monthly) out.push({ key: 'm', label: L.monthly, amt: { v: fe.monthly, cur: 'JPY' }, per: 'm' });
    return out;
  };
  const hasRes = !!(res && res.jp);
  let side: 'ovs' | 'jp' = ja && state.edition === 'jp' && hasRes ? 'jp' : 'ovs';
  let sel = 0;
  const amtText = (a: Amt | null, free = false) => (free ? L.free : a ? (a.cur === 'USD' ? `${a.v} USD` : money(a.v, 'JPY')) : L.seePage);

  const windows = (fc.windows || []).filter((w) => !w.trade && (!w.closesAt || Date.parse(w.closesAt) > Date.now()));
  const tg: Target = { kind: 'fanclub', ref: artistId, snap: { title: club, artist: p.name, artistId, image: image || undefined, platform: PLATFORM_NAME[plat] } };
  const specs = () => {
    const pay = res ? (side === 'ovs' ? res.overseas : res.jp) : null;
    const rows: [string, string][] = [];
    if (f.period) rows.push([L.period, periodKo(f.period)]);
    const pl = pay ? pay.payments : f.payments || [];
    if (pl.length) rows.push([L.pay, `${payKo(cleanPays(pl)).join(', ')}${pay?.debitNg ? ` (${t('fc.debitNg')})` : ''}`]);
    else if (plat === 'weverse') rows.push([L.pay, L.wvPay]);
    if (res?.autoRenew) rows.push([L.renew, L.renewYes]);
    rows.push([L.lang, f.languages?.includes('한국어') ? L.langKo : L.langJa]);
    rows.push([L.windows, windows.length ? L.windowsN.replace('{n}', String(windows.length)) : L.windowsNone]);
    return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  };
  const flags = [
    ovsState === 'yes' ? `<li class="ok">${esc(t('fc.overseas.yes2'))}</li>` : ovsState === 'no' ? `<li class="ng">${esc(t('fc.overseas.no2'))}</li>` : ovsState === 'limited' ? `<li>${esc(ja ? '海外は動作保証外' : '해외 이용 보증 안 함')}</li>` : plat === 'weverse' ? `<li>${esc(t('fc.overseas.wv'))}</li>` : `<li>${esc(t('fc.overseas.unknown2'))}</li>`,
    PLATFORM_NAME[plat] ? `<li>${esc(PLATFORM_NAME[plat])}</li>` : '',
    saleOpen === false ? `<li class="ng">${esc(t('fc.saleClosed'))}</li>` : '',
    f.fees && (f.fees as { taxIncluded?: boolean | null }).taxIncluded === false ? `<li>${esc(t('fc.taxExcl'))}</li>` : '',
  ].join('');

  const steps = guideSteps(plat, { ...f, overseas: ovsState === 'limited' ? 'unknown' : ovsState } as GuideFacts, `「${club}」`, fx, { isExample: !/mrsgreenapple\.com|WS266SX9B4/.test(fc.entry || '') });
  /* 이 팬클럽 자신의 가입 페이지 캡처(다른 팬클럽 화면을 예시로 쓰지 않는다) */
  const own = (SHOTS as Record<string, { at: string; shots: Record<string, { src: string; w: number; h: number }> }>)[artistId];
  if (own) {
    const capOf = (what: string) => ja ? `${club} ${what} · ${own.at.replace(/-/g, '.')} 撮影` : `${club} ${what} · ${own.at.replace(/-/g, '.')} 캡처`;
    const put = (i: number, key: string, what: string) => { const s = own.shots[key]; if (i >= 0 && s && !steps[i].img) steps[i].img = { src: s.src, w: s.w, h: s.h, cap: capOf(what) }; };
    put(0, 'top', ja ? '入会ページ' : '가입 페이지');
    put(steps.findIndex((s) => /요금|회비|会費/.test(s.h)), 'fee', ja ? '会費の案内' : '요금 안내');
    put(steps.findIndex((s) => /신규 입회|계정|Plus member ID|アカウント|入会手続き/.test(s.h)), 'join', ja ? '入会ページ(下部)' : '가입 페이지 아래쪽');
  }
  const notes = [res?.residenceLocked ? L.nLocked : '', res?.overseasLimits ? L.nLimits : ''].filter(Boolean);
  const cell = (a: Amt | null | undefined) => (a ? `<b>${a.cur === 'USD' ? `${a.v} USD` : money(a.v, 'JPY')}</b>${a.cur === 'JPY' && approx(a.v, fx) ? `<small>${esc(approx(a.v, fx))}</small>` : ''}` : `<span class="muted">${esc(L.seePage)}</span>`);
  const feeTable = res ? `<table class="pdp-table"><thead><tr>${L.col.map((c, i) => (i === 2 && !res.jp ? '' : `<th scope="col">${esc(c)}</th>`)).join('')}</tr></thead><tbody>
      <tr><th scope="row">${esc(L.annual)}</th><td>${cell(res.overseas.annual)}${res.overseas.annualShip ? `<span class="sub">${esc(L.annualShip)} ${res.overseas.annualShip.cur === 'USD' ? `${res.overseas.annualShip.v} USD` : money(res.overseas.annualShip.v, 'JPY')}</span>` : ''}</td>${res.jp ? `<td>${cell(res.jp.annual)}</td>` : ''}</tr>
      <tr><th scope="row">${esc(L.monthly)}</th><td>${cell(res.overseas.monthly)}</td>${res.jp ? `<td>${cell(res.jp.monthly)}</td>` : ''}</tr>
      <tr><th scope="row">${esc(L.pay)}</th><td>${esc(payKo(res.overseas.payments).join(', ') || '-')}</td>${res.jp ? `<td>${esc(payKo(res.jp.payments).join(', ') || '-')}</td>` : ''}</tr>
    </tbody></table>` : `<table class="pdp-table"><tbody>${courses('ovs').map((o) => `<tr><th scope="row">${esc(o.label)}</th><td>${o.free ? `<b>${esc(L.free)}</b>` : cell(o.amt)}</td></tr>`).join('')}${f.fees?.joinFee ? `<tr><th scope="row">${esc(t('fc.joinFee'))}</th><td>${cell({ v: f.fees.joinFee, cur: 'JPY' })}</td></tr>` : ''}${f.fees?.handlingFee ? `<tr><th scope="row">${esc(t('fc.handlingFee'))}</th><td>${cell({ v: f.fees.handlingFee, cur: 'JPY' })}</td></tr>` : ''}${f.fees?.annual && f.fees?.joinFee ? `<tr><th scope="row">${esc(t('fc.firstYear'))}</th><td>${cell({ v: f.fees.annual + f.fees.joinFee + (f.fees.handlingFee || 0), cur: 'JPY' })}<span class="sub">${esc(t('fc.firstYear.sub'))}</span></td></tr>` : ''}${(f.payments || []).length ? `<tr><th scope="row">${esc(L.pay)}</th><td>${esc(payKo(f.payments).join(', '))}</td></tr>` : ''}</tbody></table>`;
  const srcUrl = f.url || fc.entry || fc.home || '';
  const rows = summaryRows({ evidence: f.evidence || null, verdict: f.verdict || null, overseas: ovsState, platform: pk, payments: (res?.overseas?.payments?.length ? res.overseas.payments : f.payments) || [], payKo, residence: res, pagesRead: f.evidencePages, club: `「${club}」`, entry: f.url || fc.entry || null });
  const feeFor = res?.overseas?.annual ? { v: res.overseas.annual.v, per: 'y' as const, cur: res.overseas.annual.cur } : f.fees?.annual ? { v: f.fees.annual, per: 'y' as const } : f.fees?.monthly ? { v: f.fees.monthly, per: 'm' as const } : null;
  const showPrep = !ja && ovsState !== 'no';
  const pkName = pk || '';
  /* 부제: og:title 에서 사이트 이름을 뺀 팬클럽 쪽 표기 ("… OFFICIAL SITE｜OFFICIAL FAN CLUB 「Ringo Jam」" → 뒤쪽) */
  const subtitle = (f.ogTitle || '').split(/[｜|]/).map((x) => x.trim()).find((x) => /FAN ?CLUB|FANCLUB|MEMBERSHIP|ファンクラブ/i.test(x) && x !== club) || `${aname} ${L.official}`;

  root.innerHTML = `<div class="page fcpd">
    <nav class="crumbs" aria-label="breadcrumb"><a href="#/fanclub">${esc(L.crumbs)}</a>${icon('i-chev-r', 'ic xs')}<a href="#/artist/${encodeURIComponent(artistId)}">${esc(aname)}</a></nav>
    <section class="pdp">
      <div class="pdp-media">
        <div class="pdp-img">${f.image ? img(f.image, club, 'is-natural', { initial: club }) : img(photo, club, '', { ratio: '1/1', initial: club })}</div>
        ${f.image ? `<p class="pdp-imgsrc">${esc(L.imgSrc)}</p>` : ''}
      </div>
      <div class="pdp-info">
        <a class="pdp-artist" href="#/artist/${encodeURIComponent(artistId)}">${img(photo, '', 'round', { ratio: '1/1', initial: p.name })}<span>${esc(aname)}</span>${icon('i-chev-r', 'ic xs')}</a>
        <h1 class="pdp-title">${esc(club)}</h1>
        <p class="pdp-sub">${esc(subtitle)}</p>
        ${fanclubCacheNotice(fc.cache)}
        <div class="pdp-price"><b id="pdpPrice"></b><span id="pdpPer"></span><small id="pdpKrw"></small></div>
        <ul class="pdp-flags">${flags}</ul>
        <div class="pdp-opts">
          ${hasRes ? `<div class="pdp-opt"><p class="pdp-opt-h">${esc(L.residence)}</p><div class="pdp-seg" role="radiogroup">${(['ovs', 'jp'] as const).map((s) => `<button type="button" role="radio" data-side="${s}" aria-checked="${s === side}">${esc(s === 'ovs' ? L.ovs : L.jp)}</button>`).join('')}</div></div>` : ''}
          <div class="pdp-opt"><p class="pdp-opt-h">${esc(L.course)}</p><div class="pdp-courses" id="pdpCourses" role="radiogroup"></div></div>
        </div>
        <dl class="pdp-spec" id="pdpSpec">${specs()}</dl>
        <div class="pdp-cta">
          ${likeBtn(tg, 'is-box')}
          ${shareBtn(null, `#/fanclub/${encodeURIComponent(artistId)}`, `${club} · ${p.name}`, 'is-box icon-only')}
          <a class="btn btn-solid lg pdp-join" id="pdpJoin" target="_blank" rel="noopener" data-fc-track="join" data-artist="${esc(artistId)}"></a>
        </div>
        <p class="pdp-note">${esc(L.note)}</p>
      </div>
    </section>
    <nav class="pdp-tabs" id="pdpTabs"><a href="#pdpCheck" class="on">${esc(L.tabCheck)}</a><a href="#pdpHow">${esc(L.tabHow)}</a><a href="#pdpFee">${esc(L.tabFee)}</a>${showPrep ? `<a href="#pdpPrep">${esc(L.tabPrep)}</a>` : ''}<a href="#pdpWin">${esc(L.tabWin)}${windows.length ? ` <em>${windows.length}</em>` : ''}</a><a href="#pdpQna">${esc(L.tabQna)}</a></nav>
    <div class="pdp-detail">
      <section class="pdp-sec" id="pdpCheck">
        <h2>${esc(L.checkH)}<span>${esc(L.checked.replace('{d}', KNOW_CHECKED.replace(/-/g, '.')))}</span></h2>
        ${summaryHtml(rows)}
        ${notes.length ? `<ul class="pdp-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${f.globalSite ? `<p class="fck-global"><a class="btn btn-line" href="${esc(safeExternal(f.globalSite.url))}" target="_blank" rel="noopener">${esc(L.globalBtn)}${icon('i-ext', 'ic xs')}</a></p>` : ''}
        ${pk && PLATFORM_KNOW[pk] ? `<h3 class="fck-h3">${esc(L.platH.replace('{p}', pkName))}</h3>${platformNotesHtml(pk)}` : ''}
      </section>
      <section class="pdp-sec" id="pdpHow">
        <h2>${esc(L.tabHow)}${PLATFORM_NAME[plat] ? `<span>${esc(PLATFORM_NAME[plat])} · ${esc(L.checked.replace('{d}', CHECKED.replace(/-/g, '.')))}</span>` : ''}</h2>
        <ol class="psteps">${steps.map((s, i) => `<li class="pstep">
          <div class="pstep-t"><span class="pstep-n">${L.step} ${i + 1}</span><h3>${esc(s.h)}</h3>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}${s.warn ? `<p class="pstep-warn">${icon('i-info', 'ic xs')}${esc(s.warn)}</p>` : ''}${s.src?.length || s.links?.length ? `<p class="pstep-src">${esc(L.src)} ${[...(s.links || []), ...srcLinks(s.src)].map((x) => `<a href="${esc(safeExternal(x.url))}" target="_blank" rel="noopener">${esc(x.label)}${icon('i-ext', 'ic xs')}</a>`).join('')}</p>` : ''}</div>
          ${s.img ? `<figure class="pstep-img"><a href="${esc(s.img.src)}" target="_blank" rel="noopener"><img src="${esc(s.img.src)}" alt="${esc(s.h)}" width="${s.img.w}" height="${s.img.h}" loading="lazy" decoding="async"></a><figcaption>${esc(s.img.cap)}</figcaption></figure>` : ''}
        </li>`).join('')}</ol>
      </section>
      <section class="pdp-sec" id="pdpFee"><h2>${esc(L.tabFee)}</h2>${feeTable}<p class="src-note">${esc(t('fc.source'))} <a href="${esc(safeExternal(srcUrl))}" target="_blank" rel="noopener">${esc(srcUrl.replace(/^https?:\/\//, '').slice(0, 60))}</a>${!ja && fx?.jpyKrw ? ` · ${esc(t('fcp.fx', { v: (fx.jpyKrw * 100).toFixed(0) }))}` : ''}</p></section>
      ${showPrep ? `<section class="pdp-sec" id="pdpPrep"><h2>${esc(L.prepH)}<span>${esc(L.prepSub)}</span></h2>${prepHtml(prepCards(feeFor, fx))}</section>` : ''}
      <p class="pdp-change">${esc(L.nCheck)}</p>
      <section class="pdp-sec" id="pdpWin"><h2>${esc(L.tabWin)}</h2>${windows.length ? `<ul class="tlist">${windows.map((w) => fcWindowRow(w, { id: artistId, name: p.name })).join('')}</ul>` : `<p class="side-empty">${esc(t('fc.noWindows'))}</p>`}</section>
      <section class="pdp-sec" id="pdpQna"><h2>${esc(L.qnaH)}</h2><div id="pdpQnaList">${skeletonRows(2, 'sk-line')}</div>
        <p class="pdp-qna-act"><a class="btn btn-line" href="#/community/fanclub?q=${encodeURIComponent(club)}">${esc(L.qnaGo)}</a><a class="btn btn-solid" href="#/community/fanclub/write">${esc(L.qnaAsk)}</a></p></section>
    </div>
    <div class="pdp-bar">${likeBtn(tg, 'is-box')}<a class="btn btn-solid lg" id="pdpJoin2" target="_blank" rel="noopener" data-fc-track="join" data-artist="${esc(artistId)}"></a></div>
  </div>`;

  const paint = () => {
    const list = courses(side);
    if (sel >= list.length) sel = 0;
    const o = list[sel];
    root.querySelector('#pdpCourses')!.innerHTML = list.map((x, i) => `<button type="button" role="radio" class="pdp-course" data-i="${i}" aria-checked="${i === sel}"><span><b>${esc(x.label)}</b>${x.sub ? `<em>${esc(x.sub)}</em>` : ''}</span><strong>${esc(x.free ? L.free : amtText(x.amt))}${x.amt && !x.free ? `<small>${esc(x.per === 'y' ? L.perYear : L.perMonth)}</small>` : ''}</strong></button>`).join('');
    root.querySelector('#pdpPrice')!.textContent = o ? (o.free ? L.free : amtText(o.amt)) : L.seePage;
    root.querySelector('#pdpPer')!.textContent = o?.amt && !o.free ? (o.per === 'y' ? L.perYear : L.perMonth) : '';
    const krw = o?.amt && o.amt.cur === 'JPY' && !o.free ? approx(o.amt.v, fx) : '';
    root.querySelector('#pdpKrw')!.textContent = krw;
    root.querySelector('#pdpSpec')!.innerHTML = specs();
    /* Weverse 는 멤버십 상품 화면으로 바로 */
    const base = plat === 'weverse' && /shop\.weverse\.io\/.*\/sales\//.test(f.url || '') ? f.url : fc.entry || fc.home;
    const url = side === 'ovs' && f.overseasJoin ? withUtm(f.overseasJoin, 'fanclub_join_overseas') : withUtm(base, 'fanclub_join');
    const label = `${side === 'ovs' && f.overseasJoin && !ja ? L.joinOvs : L.join}`;
    for (const id of ['#pdpJoin', '#pdpJoin2']) {
      const a = root.querySelector<HTMLAnchorElement>(id)!;
      const href = safeExternal(url);
      if (href) a.href = href; else a.removeAttribute('href');
      a.setAttribute('aria-disabled', String(!href));
      a.innerHTML = `${esc(label)}${icon('i-ext', 'ic xs')}`;
    }
    root.querySelectorAll<HTMLButtonElement>('.pdp-course').forEach((b) => b.addEventListener('click', () => { sel = Number(b.dataset.i); paint(); }));
  };
  paint();
  root.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.addEventListener('click', () => {
    side = b.dataset.side as 'ovs' | 'jp';
    sel = 0;
    root.querySelectorAll('[data-side]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    paint();
  }));
  /* 탭: 스크롤 위치에 맞춰 표시 */
  const tabs = Array.from(root.querySelectorAll<HTMLAnchorElement>('#pdpTabs a'));
  tabs.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); root.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) tabs.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`)); }), { rootMargin: '-45% 0px -50% 0px' });
    const sections = Array.from(root.querySelectorAll('.pdp-sec'));
    sections.forEach((s) => io.observe(s));
    let mounted = sections.some((s) => s.isConnected);
    const cleanup = new MutationObserver(() => {
      if (sections.some((s) => s.isConnected)) mounted = true;
      else if (mounted || !alive()) { io.disconnect(); cleanup.disconnect(); }
    });
    cleanup.observe(document.body, { childList: true, subtree: true });
  }
  void bindSocial(root);

  /* 문의: 팬클럽 가입 게시판에서 이 팬클럽 이름이 들어간 글 */
  api(`/api/community/b/fanclub?${new URLSearchParams({ page: '1', q: club, field: 'all' })}`).then((r: { items: { no: number; title: string; nick: string; anon: boolean; tag: string | null; at: string; cmt: number; up: number }[] }) => {
    if (!alive()) return;
    const box = root.querySelector('#pdpQnaList');
    if (!box) return;
    const rows = (r.items || []).slice(0, 5);
    box.innerHTML = rows.length ? `<ul class="qna-list">${rows.map((x) => `<li><a href="#/community/fanclub/${x.no}">${avatar(x.nick, x.anon, 32)}<span><b>${esc(x.title)}</b><small>${esc(x.nick)} · ${x.cmt ? `${ct('post.cmt')} ${x.cmt}` : ''}</small></span></a></li>`).join('')}</ul>` : `<p class="side-empty">${esc(L.qnaEmpty)}</p>`;
  }).catch(() => { if (alive()) { const box = root.querySelector('#pdpQnaList'); if (box) box.innerHTML = `<p class="side-empty">${esc(t('err.generic'))}</p>`; } });
}
