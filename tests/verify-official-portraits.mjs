// Network-free verification of the generic official-profile portrait collector.
import assert from 'node:assert/strict';
import { collectOfficialPortrait, normalizeName } from '../backend/lib/live/official-portraits.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); console.log('PASS', ++passed, name); };
const now = () => new Date('2026-10-25T03:00:00Z');
const B = 'https://band.example.com';
function site(pages) {
  const reads = [];
  const read = async (url) => {
    reads.push(url);
    const p = pages[url];
    if (p == null) throw Object.assign(new Error('not_found'), { code: 'upstream_http_404' });
    const page = typeof p === 'string' ? { html: p, url } : p;
    return { html: page.html, url: page.url ?? url, bytes: page.bytes ?? Buffer.byteLength(page.html) };
  };
  return { reads, deps: { read, now } };
}
// Generic MGA-shaped fixture: homepage with nav link + og:image, profile page with
// random-named upimg main portrait, dummy.gif overlay, member list and footer logos.
const home = (group, link = `${B}/feature/profile`) => `<!doctype html><html><head><title>${group} OFFICIAL SITE｜OFFICIAL FAN CLUB</title>
<meta property="og:image" content="${B}/og_image_2026.png"><link rel="stylesheet" href="/static/css/service.css"></head><body>
<header><h1 class="logo"><a href="${B}/"><svg><use href="#logo"></use></svg></a></h1>
<nav><ul><li><a href="${B}/news">News</a></li><li><a href="${link}">Profile</a></li><li><a href="${B}/discography">Discography</a></li></ul></nav></header>
<main class="content--main" role="main"><section class="kv"><img src="/static/top/hero_tour_2026.jpg" alt="${group} TOUR 2026"></section>
<div class="top-banner"><img src="/static/bnr/a1.jpg" alt="banner"></div></main>
<footer><img src="/static/common/logo--label.png" alt="label"></footer></body></html>`;
const profile = (group, members = ['大森元貴', '若井滉斗', '藤澤涼架'], img = '/static/x/contents/upimg/ec9b2a6f501eac62d7701405d30f8f6e.jpeg') => `<!doctype html><html><head>
<title>\t\tPROFILE -\n\t${group} OFFICIAL SITE｜OFFICIAL FAN CLUB</title><meta property="og:image" content="${B}/og_image_2026.png"></head><body>
<header><h1 class="block--nav-logo"><a href="${B}/"><svg viewBox="0 0 10 10"><use href="#l"></use></svg></a></h1></header>
<main class="content--main" role="main"><script>var x='<img src="/evil.jpg" alt="${group}">';</script><style>.thumb img.dummy{position:absolute;}</style>
<section class="section--detail page--profile"><div class="section--inner"><div class="artist-photo"><figure class="thumb">
<img src="${img}" alt="${group} OFFICIAL SITE｜OFFICIAL FAN CLUB">
<img src="/static/common/global-image/dummy.gif" alt="${group}" class="dummy"></figure></div>
<div class="artist--detail"><p class="artist--detail__name font-en_bold">${group}</p><ul class="list--member">
${members.map((m, i) => `<li class="member_item m${i}"><div class="block--name"><p class="name">${m}<span>(Vo)</span></p></div><img src="/static/member/m${i}.jpg" alt="${m}"></li>`).join('\n')}
</ul><div class="artist--detail__txt"><p class="txt">3人組バンド。2013年結成。</p></div></div></div></section></main>
<footer><img src="/static/mga/common/logo--pmga.png" alt="Project"><img src="/static/mga/common/logo--universal.png" alt="universal music"></footer></body></html>`;
const MGA_IMG = `${B}/static/x/contents/upimg/ec9b2a6f501eac62d7701405d30f8f6e.jpeg`;
const unavailable = (r, reason) => { assert.equal(r.status, 'unavailable'); assert.equal(r.imageUrl, null); assert.equal(r.sourceUrl, null); if (reason) assert.equal(r.reason, reason, JSON.stringify(r.evidence.pages)); };

const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('unexpected network'); };
try {
  await test('MGA-shaped site: observed nav link -> profile main portrait, source-bound, no publication claim', async () => {
    const s = site({ [`${B}/`]: home('Mrs. GREEN APPLE'), [`${B}/feature/profile`]: profile('Mrs. GREEN APPLE') });
    const r = await collectOfficialPortrait({ artistId: 'a1', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason);
    assert.equal(r.imageUrl, MGA_IMG);
    assert.equal(r.sourceUrl, `${B}/feature/profile`);
    assert.equal(r.method, 'official-profile');
    assert.equal(r.checkedAt, '2026-10-25T03:00:00.000Z');
    assert.equal(r.publication, null); // checkedAt is never a publication date
    assert.equal(r.reason, null);
    assert.deepEqual(s.reads, [`${B}/`, `${B}/feature/profile`]);
    const img = r.evidence.image;
    assert.equal(img.sourceUrl, r.sourceUrl); assert.equal(img.imageUrl, r.imageUrl); assert.equal(img.kind, 'main-img');
    assert.equal(img.container.tag, 'figure'); assert.match(img.section.class, /page--profile/);
    assert.equal(img.binding.sectionName.text, 'Mrs. GREEN APPLE'); assert.equal(img.downloaded, false);
    assert.ok(r.evidence.identity.some(x => x.kind === 'title' && x.sourceUrl === r.sourceUrl));
    assert.ok(!JSON.stringify(r).includes('og_image_2026'));
    assert.ok(!JSON.stringify(r).includes('evil.jpg'));
    assert.ok(r.evidence.rejections.some(x => /dummy\.gif/.test(x.imageUrl)));
    assert.equal(r.evidence.pages[0].outcome, 'not_profile_page');
  });

  await test('artist names are generic inputs: same structure works for a different artist with no code change', async () => {
    const s = site({ [`${B}/`]: home('Blue Harbor'), [`${B}/feature/profile`]: profile('Blue Harbor', ['Aki', 'Ren']) });
    const r = await collectOfficialPortrait({ artistId: 'a2', officialUrl: `${B}/`, names: ['BLUE HARBOR'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, MGA_IMG);
  });

  await test('title says only PROFILE: identity from main-content name element; alt-less figure portrait', async () => {
    const html = `<title> PROFILE </title><header><img src="/c/logo.svg" alt="髭バンドオフィシャル"></header><main class="content--main" role="main"><section class="section--detail page--profile"><h2 class="section-tit">PROFILE</h2>
      <div class="block--ph"><figure class="ph"><img src="/c/upimg/artist-photo_2507_abc.jpg\n\t "></figure></div><div class="block--txt"><p class="name">Official髭バンド <span>(オフィシャルヒゲバンド)</span></p><p>2012年結成。</p></div></section></main>`;
    const s = site({ [`${B}/`]: `<title>top</title><nav><a href="/feature/profile_of">PROFILE</a></nav>`, [`${B}/feature/profile_of`]: html });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Official髭バンド'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/c/upimg/artist-photo_2507_abc.jpg`);
    assert.ok(r.evidence.identity.some(x => x.kind === 'name-element'));
    assert.equal(r.evidence.pages[1].profileSignal, 'path');
    // Without any name element, a bare PROFILE page is not identity-verified.
    const s2 = site({ [`${B}/profile`]: html.replace(/<p class="name">[\s\S]*?<\/p>/, '') });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Official髭バンド'] }, s2.deps), 'identity_not_verified');
  });

  await test('generic homepage og:image alone is rejected (no profile link -> unavailable)', async () => {
    const s = site({ [`${B}/`]: `<title>Mrs. GREEN APPLE OFFICIAL</title><meta property="og:image" content="/og.jpg"><main><h1>Mrs. GREEN APPLE</h1><img src="/hero.jpg" alt="Mrs. GREEN APPLE"></main>` });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'no_profile_link'); assert.deepEqual(s.reads, [`${B}/`]);
  });

  await test('profile page with only og:image is not a portrait', async () => {
    const s = site({ [`${B}/profile`]: `<title>PROFILE | Mrs. GREEN APPLE</title><meta property="og:image" content="/og.jpg"><main><h1>Mrs. GREEN APPLE</h1><p>bio</p></main>` });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'no_bound_portrait');
  });

  await test('identity: wrong artist page, latin token boundaries, JSON-LD group conflict', async () => {
    let s = site({ [`${B}/`]: home('Other Band'), [`${B}/feature/profile`]: profile('Other Band') });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps), 'identity_not_verified');
    s = site({ [`${B}/profile`]: profile('LIVE NATION') });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['IVE'] }, s.deps), 'identity_not_verified');
    s = site({ [`${B}/profile`]: profile('GREEN APPLE JUICE') });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps), 'identity_not_verified');
    const ld = `<script type="application/ld+json">{"@type":"MusicGroup","name":"Someone Else","image":"/se.jpg"}</script>`;
    s = site({ [`${B}/profile`]: profile('Mrs. GREEN APPLE').replace('</head>', `${ld}</head>`) });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'identity_conflict'); assert.ok(!JSON.stringify(r).includes('se.jpg"'));
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: [] }, s.deps), 'no_artist_names');
  });

  await test('section heading naming another artist does not bind a portrait', async () => {
    const html = `<title>PROFILE - Label Site Mrs. GREEN APPLE</title><main><section class="profile"><h2>Other Artist</h2><figure class="artist-photo"><img src="/a.jpg"></figure></section></main>`;
    const s = site({ [`${B}/profile`]: html });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps), 'section_identity_conflict');
  });

  await test('exact artist JSON-LD image wins; member Person nodes ignored; explicit image date is publication', async () => {
    const ld = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'Person', name: 'Member One', image: '/m1.jpg', memberOf: { '@id': '#g' } },
      { '@type': 'MusicGroup', '@id': '#g', name: 'Mrs. GREEN APPLE', logo: '/logo.png', image: { '@type': 'ImageObject', contentUrl: 'https://cdn.example.net/artist/group-2026.jpg', datePublished: '2026-01-01' } },
    ] };
    const html = `<title>Biography</title><script type="application/ld+json">${JSON.stringify(ld)}</script><main><h1>Biography</h1></main>`;
    const s = site({ [`${B}/biography`]: html });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/biography`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason);
    assert.equal(r.imageUrl, 'https://cdn.example.net/artist/group-2026.jpg');
    assert.equal(r.evidence.image.kind, 'json-ld'); assert.equal(r.evidence.image.imageOrigin, 'cross-origin');
    assert.deepEqual(r.publication, { date: '2026-01-01T00:00:00.000Z', source: 'json-ld-image', field: 'datePublished' });
  });

  await test('same-origin navigation only: cross-origin/credential/private/query links ignored, no guessed /profile', async () => {
    const html = `<title>Mrs. GREEN APPLE</title><nav>
      <a href="https://evil.example.org/profile">Profile</a>
      <a href="https://user:pw@band.example.com/profile">Profile</a>
      <a href="${B}/mypage/profile">Profile</a>
      <a href="${B}/profile?token=abc">Profile</a>
      <a href="http://band.example.com/profile">Profile</a>
      <a href="${B}/news">News</a></nav><main><h1>Mrs. GREEN APPLE</h1></main>`;
    const s = site({ [`${B}/`]: html, [`${B}/profile`]: profile('Mrs. GREEN APPLE') });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'no_profile_link'); assert.deepEqual(s.reads, [`${B}/`]);
  });

  await test('redirect leaving origin is rejected even from a trusted transport', async () => {
    const s = site({ [`${B}/`]: home('Mrs. GREEN APPLE'), [`${B}/feature/profile`]: { html: profile('Mrs. GREEN APPLE'), url: 'https://other.example.org/feature/profile' } });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'profile_page_unavailable');
    assert.equal(r.evidence.pages[1].code, 'cross_origin');
  });

  await test('untrusted officialUrl never reaches transport', async () => {
    for (const u of ['http://band.example.com/', 'https://u:p@band.example.com/', 'https://localhost/profile', 'https://10.0.0.1/profile', 'https://band.example.com:8443/', 'https://band.example.com/account/profile', 'javascript:alert(1)', '', null]) {
      const s = site({});
      unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: u, names: ['X Band'] }, s.deps), 'invalid_official_url');
      assert.equal(s.reads.length, 0, String(u));
    }
  });

  await test('bounds: at most 2 followed links / 3 pages, oversized page, total timeout', async () => {
    const links = ['profile', 'about', 'biography', 'bio', 'profile/members'].map(p => `<a href="${B}/${p}">${p}</a>`).join('');
    const s = site({ [`${B}/`]: `<title>Mrs. GREEN APPLE</title><nav>${links}</nav>`, [`${B}/profile`]: '<title>PROFILE Mrs. GREEN APPLE</title><main><p>no image</p></main>', [`${B}/about`]: '<title>about</title>', [`${B}/biography`]: profile('Mrs. GREEN APPLE') });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    assert.ok(s.reads.length <= 3); assert.equal(s.reads.filter(u => u !== `${B}/`).length, 2);
    unavailable(r);
    const big = site({ [`${B}/profile`]: { html: profile('Mrs. GREEN APPLE'), bytes: 5 * 1024 * 1024 } });
    const r2 = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, big.deps);
    unavailable(r2, 'official_page_unavailable'); assert.equal(r2.evidence.pages[0].code, 'page_too_large');
    const t0 = Date.now();
    const r3 = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, { now, timeoutMs: 50, read: () => new Promise(() => {}) });
    unavailable(r3, 'timeout'); assert.ok(Date.now() - t0 < 2000);
  });

  await test('ambiguous: two bound portraits -> unavailable', async () => {
    const html = `<title>PROFILE - Mrs. GREEN APPLE</title><main><section class="profile"><h1>Mrs. GREEN APPLE</h1>
      <figure class="artist-photo"><img src="/a/2026a.jpg" alt="Mrs. GREEN APPLE"></figure><div class="kv"><img src="/a/2026b.jpg" alt="Mrs. GREEN APPLE"></div></section></main>`;
    const s = site({ [`${B}/profile`]: html });
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps), 'ambiguous_portrait');
    // Same-class repeated siblings (gallery/slider/member grid) are never a single portrait.
    const grid = html.replace('<div class="kv"><img src="/a/2026b.jpg" alt="Mrs. GREEN APPLE"></div>', '<figure class="artist-photo"><img src="/a/2026b.jpg" alt="Mrs. GREEN APPLE"></figure>');
    const r2 = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, site({ [`${B}/profile`]: grid }).deps);
    unavailable(r2); assert.ok(r2.evidence.rejections.some(x => x.reason === 'repeated_list_item'));
  });

  await test('member-only, logo, banner, jacket/album, goods, tour, poster, tiny and svg images are all rejected', async () => {
    const html = `<title>PROFILE - Mrs. GREEN APPLE</title><main><section class="profile"><h1>Mrs. GREEN APPLE</h1>
      <ul class="members"><li><figure class="photo"><img src="/m/ohmori.jpg" alt="大森元貴"></figure></li></ul>
      <figure class="photo"><img src="/m/solo.jpg" alt="大森元貴"></figure>
      <img class="logo" src="/img/mga.png" alt="Mrs. GREEN APPLE"><div class="banner"><img src="/b/x.jpg" alt="Mrs. GREEN APPLE"></div>
      <figure class="photo"><img src="/disc/jacket_antenna.jpg" alt="Mrs. GREEN APPLE"></figure><figure class="photo"><img src="/x/1.jpg" alt="Mrs. GREEN APPLE アルバム"></figure>
      <figure class="goods"><img src="/g/1.jpg" alt="Mrs. GREEN APPLE"></figure><figure class="photo"><img src="/t/poster.jpg" alt="Mrs. GREEN APPLE"></figure>
      <figure class="photo"><img src="/p/a.jpg" width="80" height="80" alt="Mrs. GREEN APPLE"></figure><figure class="photo"><img src="/p/wide.jpg" width="1600" height="300" alt="Mrs. GREEN APPLE"></figure>
      <figure class="photo"><img src="/p/a.svg" alt="Mrs. GREEN APPLE"></figure></section></main>`;
    const s = site({ [`${B}/profile`]: html });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'no_bound_portrait');
    const reasons = new Set(r.evidence.rejections.map(x => x.reason));
    for (const k of ['member_only_context', 'alt_not_artist', 'excluded_logo', 'excluded_banner', 'excluded_jacket', 'excluded_label', 'excluded_goods', 'excluded_poster', 'too_small', 'banner_aspect', 'non_photo_format']) assert.ok(reasons.has(k), k + ' ' + [...reasons]);
  });

  await test('inline style portrait accepted; linked-CSS-only portrait reported unavailable', async () => {
    const inline = `<title>PROFILE | Mrs. GREEN APPLE</title><main><section><h2 class="artist-name">Mrs. GREEN APPLE</h2><div class="artist-photo" style="background-image:url('/img/a/main.webp')"></div></section></main>`;
    let s = site({ [`${B}/profile`]: inline });
    let r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/img/a/main.webp`); assert.equal(r.evidence.image.kind, 'inline-style');
    const linked = `<head><title>PROFILE | Mrs. GREEN APPLE</title><link rel="stylesheet" href="/css/p.css"></head><main><section><h2>Mrs. GREEN APPLE</h2><div class="artist-photo"></div></section></main>`;
    s = site({ [`${B}/profile`]: linked });
    r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Mrs. GREEN APPLE'] }, s.deps);
    unavailable(r, 'portrait_in_linked_css_not_fetched'); assert.deepEqual(s.reads, [`${B}/profile`]);
  });

  await test('ko / ja / latin name variants (full-width, kana, spacing, diacritics)', async () => {
    assert.equal(normalizeName('ミセス'), normalizeName('みせす'));
    const cases = [
      ['미세스 그린 애플', '미세스그린애플'],
      ['ミセス・グリーン・アップル', 'ミセスグリーンアップル'],
      ['みせすぐりーんあっぷる', 'ミセスグリーンアップル'],
      ['MrsGreenApple', 'Ｍｒｓ．ＧＲＥＥＮ　ＡＰＰＬＥ'],
      ['Beyonce', 'Beyoncé'],
    ];
    for (const [name, onPage] of cases) {
      const s = site({ [`${B}/`]: home(onPage), [`${B}/feature/profile`]: profile(onPage) });
      const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Unrelated', name] }, s.deps);
      assert.equal(r.status, 'verified', `${name} vs ${onPage}: ${r.reason}`);
    }
    const kr = `<title>프로필 | 블루하버 공식 사이트</title><main><section class="artist"><h2 class="title">블루하버</h2><figure class="thumb"><img src="/u/9f0a.jpg" alt="블루하버 공식 사이트"></figure></section></main>`;
    const s = site({ [`${B}/`]: `<title>블루하버</title><nav><a href="/intro">프로필</a></nav>`, [`${B}/intro`]: kr });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['BLUE HARBOR', '블루하버'] }, s.deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/u/9f0a.jpg`);
  });

  await test('default transport is assistance.readPublicHtml (pinned DNS, manual redirect, no cookies)', async () => {
    const calls = [];
    const pages = { [`${B}/`]: home('Mrs. GREEN APPLE'), [`${B}/feature/profile`]: profile('Mrs. GREEN APPLE') };
    const deps = { now, lookup: async () => [{ address: '8.8.8.8', family: 4 }], fetchImpl: async (url, o) => {
      calls.push(url);
      assert.equal(o.redirect, 'manual'); assert.equal(o.credentials, 'omit'); assert.equal(o.headers.cookie, undefined); assert.equal(o.address.address, '8.8.8.8');
      return new Response(pages[url] ?? 'nf', { status: pages[url] ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    } };
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, deps);
    assert.equal(r.status, 'verified', r.reason); assert.deepEqual(calls, [`${B}/`, `${B}/feature/profile`]);
    const priv = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['Mrs. GREEN APPLE'] }, { ...deps, lookup: async () => [{ address: '192.168.0.2', family: 4 }] });
    unavailable(priv, 'official_page_unavailable'); assert.equal(priv.evidence.pages[0].code, 'private_dns');
  });

  // ---- v2 generic rules (fixtures shaped after real inspected pages; no artist/URL tables in code) ----
  await test('homepage with a PROFILE section heading and linked teaser image is never a profile portrait (INI-shaped)', async () => {
    const html = `<title>INI OFFICIAL SITE</title><main><section class="profile"><h2>PROFILE</h2><p>INI</p></section>
      <section class="section--topcontents"><h2 class="section-tit">Latest Contents</h2><ul><li><a href="/blog/detail/684/"><div class="thumb"><figure><img src="/static/cover_contents.png" alt="INIの控え室 vol.2"></figure></div></a></li></ul></section></main>`;
    const s = site({ [`${B}/`]: html });
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/`, names: ['INI'] }, s.deps);
    unavailable(r); assert.equal(r.evidence.pages[0].outcome, 'not_profile_page');
    // Even on a real profile page, an image linking to another page is a teaser.
    const s2 = site({ [`${B}/profile`]: html.replace('<title>INI OFFICIAL SITE</title>', '<title>PROFILE | INI</title>') });
    const r2 = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['INI'] }, s2.deps);
    unavailable(r2); assert.ok(r2.evidence.rejections.some(x => x.reason === 'linked_teaser'));
  });

  const label = (artist, { active = true, mention = true, visuals = 1 } = {}) => `<title>LABEL ENTERTAINMENT</title><body>
    <div id="header"><ul class="nav"><li><a href="/about/index">ABOUT</a></li><li class="${active ? 'on' : ''}"><a href="/artist/profile/${encodeURIComponent(artist)}">${artist}</a></li><li><a href="/artist/profile/OTHER">OTHER</a></li></ul></div>
    <div id="container" class="profile"><main class="artist"><div class="profileHead"><div class="visual">
      <img src="https://cdn.label.example.net/main/v1-pc.jpg" alt="(ENG) Alt Tag" class="isPc"><img src="https://cdn.label.example.net/main/v1-mo.jpg" alt="(ENG) Alt Tag" class="isMobile">
      ${visuals > 1 ? '<div class="visual2"><img src="https://cdn.label.example.net/main/v2.jpg" alt=""></div>' : ''}</div>
      <h1><img src="https://cdn.label.example.net/artist/wordmark.png" alt=""></h1>
      <div class="info"><p class="tit">MEMBER</p><div class="cont">A, B</div><div class="intro">${mention ? artist + ' is a group under LABEL.' : 'A group under LABEL.'}</div></div></div>
      <div class="profileList"><ul><li class="focus"><a href="#"><img src="https://cdn.label.example.net/main/m1.jpg" alt="${artist}_A"></a><p class="name"><strong>A</strong></p></li>
      <li class="focus"><a href="#"><img src="https://cdn.label.example.net/main/m2.jpg" alt="${artist}_B"></a><p class="name"><strong>B</strong></p></li></ul></div></main></div></body>`;
  await test('multi-artist label page: active nav + content mention verifies; responsive pair collapses; member grid/wordmark excluded', async () => {
    const url = `${B}/artist/profile/LE%20SSERAFIM`;
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['LE SSERAFIM'] }, site({ [url]: label('LE SSERAFIM') }).deps);
    assert.equal(r.status, 'verified', r.reason + JSON.stringify(r.evidence.rejections));
    assert.equal(r.imageUrl, 'https://cdn.label.example.net/main/v1-pc.jpg');
    assert.equal(r.evidence.identity[0].kind, 'active-nav'); assert.ok(r.evidence.image.binding.profileSection);
    const reasons = r.evidence.rejections.map(x => x.reason);
    assert.ok(reasons.includes('heading_wordmark') && reasons.includes('repeated_list_item'));
    // Negative controls: URL alone (no active marker / no content mention) never verifies identity; two visuals are ambiguous.
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['LE SSERAFIM'] }, site({ [url]: label('LE SSERAFIM', { active: false }) }).deps), 'identity_not_verified');
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['LE SSERAFIM'] }, site({ [url]: label('LE SSERAFIM', { mention: false }) }).deps), 'identity_not_verified');
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['LE SSERAFIM'] }, site({ [url]: label('LE SSERAFIM', { visuals: 2 }) }).deps), 'ambiguous_portrait');
    // Page about another artist on the same label template.
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['ILLIT'] }, site({ [url]: label('LE SSERAFIM') }).deps), 'identity_not_verified');
    // Member photos whose alt starts with the group name never become the group portrait.
    const noVisual = label('ENHYPEN').replace(/<div class="visual">[\s\S]*?<\/div>\s*<h1>/, '<h1>');
    const u2 = `${B}/artist/profile/ENHYPEN`;
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: u2, names: ['ENHYPEN'] }, site({ [u2]: noVisual }).deps));
  });

  await test('profile-section fallback: one alt-less photo under a PROFILE heading; bg/logo excluded; second photo -> ambiguous (King Gnu-shaped)', async () => {
    const page = (extra = '') => `<head><title>PROFILE | KING GNU</title></head><body><div id="bg"><img src="../10th/img/bg.jpg" alt=""></div>
      <div id="top-logo"><a href="../"><img src="../10th/img/logo.png" alt="King Gnu" width="1200" height="814"></a></div>
      <div id="main"><h1>PROFILE</h1><p><img class="m-auto" src="img/2025-12.jpg" alt=""></p>${extra}<div id="profile-load"></div></div></body>`;
    const url = `${B}/about/`;
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['King Gnu'] }, site({ [url]: page() }).deps);
    assert.equal(r.status, 'verified', r.reason + JSON.stringify(r.evidence.rejections));
    assert.equal(r.imageUrl, `${B}/about/img/2025-12.jpg`);
    assert.deepEqual(r.evidence.image.binding.profileSection, { heading: 'PROFILE', tag: 'h1' });
    assert.ok(r.evidence.rejections.some(x => x.reason === 'excluded_background'));
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['King Gnu'] }, site({ [url]: page('<p><img src="img/other.jpg"></p>') }).deps), 'ambiguous_portrait');
    // No dedicated profile heading/container -> not bound.
    const plain = page().replace('<h1>PROFILE</h1>', '<h1>NEWS</h1>');
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['King Gnu'] }, site({ [url]: plain }).deps));
    // Page identity still required for the fallback.
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: url, names: ['Other Band'] }, site({ [url]: page() }).deps), 'identity_not_verified');
  });

  await test('header h1 site brand identity + biography mainvisual (Vaundy-shaped); lazy/inline-background image sources', async () => {
    const vaundy = `<title> BIOGRAPHY｜ </title><header><h1><a href="/" class="icon logo">VAUNDY</a></h1></header>
      <div id="biography-mainvisual"><img src="/static/v/contents/upimg/814a.jpeg"></div><h2 class="ttl">BIOGRAPHY</h2><p>bio</p>`;
    const u = `${B}/feature/biography`;
    let r = await collectOfficialPortrait({ artistId: 'a', officialUrl: u, names: ['Vaundy'] }, site({ [u]: vaundy }).deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/static/v/contents/upimg/814a.jpeg`);
    assert.ok(r.evidence.identity.some(x => x.kind === 'site-brand'));
    const imase = `<title>Profile</title><header><h1 class="logo"><a href="/"><span class="sr-only">imase</span></a></h1></header><main><section class="section--detail page--profile">
      <figure class="thumb"><img src="/static/common/global-image/dummy.gif" style="background-image:url(/static/imase/contents/upimg/703d.jpeg)" alt="imase"></figure></section></main>`;
    const u2 = `${B}/feature/profile`;
    r = await collectOfficialPortrait({ artistId: 'a', officialUrl: u2, names: ['imase'] }, site({ [u2]: imase }).deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/static/imase/contents/upimg/703d.jpeg`); assert.equal(r.evidence.image.kind, 'img-inline-style');
    const lazy = `<title>PROFILE | Blue Harbor</title><main><section><h2 class="artist-name">Blue Harbor</h2><figure class="artist-photo"><img src="/img/lazyload.png" data-src="/img/upimg/9f.jpg?1789712661789" alt="Blue Harbor"></figure></section></main>`;
    r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Blue Harbor'] }, site({ [`${B}/profile`]: lazy }).deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, `${B}/img/upimg/9f.jpg?1789712661789`);
    r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${B}/profile`, names: ['Blue Harbor'] }, site({ [`${B}/profile`]: lazy.replace('?1789712661789', '?token=abc') }).deps);
    unavailable(r); assert.ok(r.evidence.rejections.some(x => x.reason === 'unsafe_image_query'));
  });

  await test('logo-sized box (w-[120px]) with artist alt does not make a real photo ambiguous (CORTIS-shaped)', async () => {
    const html = `<title>PROFILE | CORTIS JAPAN OFFICIAL SITE</title><main><div class="subpage"><h2 class="subtitle">PROFILE</h2><div id="profile_default">
      <img class="h-auto max-w-full" src="https://image.example.net/profile/3/16e2.jpg" alt="CORTIS"><div class="mx-auto w-[120px] md:w-[160px]"><img src="https://image.example.net/profile/3/13ff.png" class="w-full" alt="CORTIS"></div>
      <p>CORTIS (MARTIN、JAMES) ...</p></div><ul><li><img class="profile__image" src="https://image.example.net/m1.jpg" alt="MARTIN"><h3 class="profile__name">MARTIN</h3></li></ul></div></main>`;
    const u = `${B}/profile`;
    const r = await collectOfficialPortrait({ artistId: 'a', officialUrl: u, names: ['코르티스', 'CORTIS'] }, site({ [u]: html }).deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(r.imageUrl, 'https://image.example.net/profile/3/16e2.jpg');
    assert.ok(r.evidence.rejections.some(x => x.reason === 'too_small'));
    // Without a Latin/Japanese name that the page actually uses, identity is not inferred.
    unavailable(await collectOfficialPortrait({ artistId: 'a', officialUrl: u, names: ['코르티스'] }, site({ [u]: html }).deps), 'identity_not_verified');
  });

  await test('same-site redirect restart only from transport-reported Location (www<->apex, http->https), once', async () => {
    const W = 'https://www.band.example.com';
    const pages = { [`${B}/`]: home('Mrs. GREEN APPLE'), [`${B}/feature/profile`]: profile('Mrs. GREEN APPLE') };
    const mk = (location) => { const reads = []; return { reads, deps: { now, read: async (u) => { reads.push(u); if (u.startsWith(W)) throw Object.assign(new Error('unsafe_destination'), { code: 'unsafe_destination', location }); const h = pages[u]; if (!h) throw Object.assign(new Error('nf'), { code: 'upstream_http_404' }); return { html: h, url: u, bytes: h.length }; } } }; };
    let m = mk(`${B}/`);
    let r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${W}/`, names: ['Mrs. GREEN APPLE'] }, m.deps);
    assert.equal(r.status, 'verified', r.reason); assert.deepEqual(m.reads, [`${W}/`, `${B}/`, `${B}/feature/profile`]);
    assert.ok(r.evidence.warnings.some(w => w.code === 'same_site_redirect_restart'));
    m = mk('http://band.example.com/');
    r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${W}/`, names: ['Mrs. GREEN APPLE'] }, m.deps);
    assert.equal(r.status, 'verified', r.reason); assert.equal(m.reads[1], `${B}/`);
    for (const bad of ['https://maxwin-casino.example.org/', 'https://band.example.com.evil.example.org/', 'https://band.example.com:8443/']) {
      m = mk(bad);
      r = await collectOfficialPortrait({ artistId: 'a', officialUrl: `${W}/`, names: ['Mrs. GREEN APPLE'] }, m.deps);
      unavailable(r, 'official_page_unavailable'); assert.deepEqual(m.reads, [`${W}/`], bad);
    }
  });
} finally { globalThis.fetch = oldFetch; }
console.log(`official portraits: ${passed} passed`);
