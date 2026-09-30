/* 커뮤니티(갤러리) + 소셜(좋아요·댓글·공유)

   갤러리는 디시인사이드 마이너 갤러리 구조를 따른다.
   · 아티스트마다 갤러리가 자동으로 있다(로스터에 있는 아티스트 = 갤러리). 만들 필요가 없다.
   · 종합 갤러리 3개(free·ticket·fanclub)는 에디션과 무관하게 항상 있다.
   · 글: 번호·말머리·제목·글쓴이·작성일·조회·추천, 개념글 = 추천 BEST_MIN 이상.
   · 글쓴이: 로그인 닉네임(고닉) 또는 익명 'ㅇㅇ'. 익명은 계정·갤러리별로 고정된 짧은 식별 태그를 붙인다
     (디시의 IP 앞자리 역할 — 같은 사람이 같은 갤러리에서 쓴 글을 알아볼 수 있게, 계정은 드러나지 않게).
   · 쓰기·추천·댓글은 로그인 필수(도배·어뷰징 방지). 읽기는 누구나.

   소셜은 공연·앨범·곡에 붙는다. 대상은 (kind, ref)로 식별하고,
   처음 좋아요·댓글·공유가 일어날 때 화면에 보이던 정보를 스냅샷으로 저장한다 → 공유 링크가 그 스냅샷으로 열린다.

   저장: db/community/*.json, db/social/*.json (JSON 파일 DB, 같은 키는 withLock 으로 직렬화) */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const GENERAL_BOARDS = ['free', 'ticket', 'fanclub'];
export const HEADS = {
  artist: ['talk', 'info', 'review', 'ask', 'pic', 'trans'],
  general: ['talk', 'info', 'ask', 'review'],
};
export const BEST_MIN = 3;
export const PAGE_SIZE = 30;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const POST_GAP_MS = 20_000;
const CMT_GAP_MS = 4_000;
const BOARD_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_-]{0,79}$/u;
const IMG_RE = /^[a-f0-9]{16}\.(jpg|png|webp|gif)$/;
const SOCIAL_KINDS = { concert: 'c', release: 'r', track: 't', fanclub: 'f' };
const SNAP_FIELDS = {
  concert: ['title', 'performer', 'performerKo', 'artistId', 'origin', 'poster', 'url', 'provider', 'providerLabel', 'startDate', 'endDate', 'venue', 'city', 'country', 'direction', 'kind', 'genre', 'status', 'statusText', 'ticketOpenAt', 'ticketOpenLabel', 'closesAt', 'saleType', 'fcOnly', 'fcFirst', 'overseasOk', 'noJpPhone', 'condition', 'isPublic', 'id'],
  release: ['title', 'artist', 'artistId', 'artwork', 'releaseDate', 'type', 'country', 'id'],
  track: ['title', 'artist', 'artistId', 'artwork', 'preview', 'appleUrl', 'album', 'country'],
  fanclub: ['title', 'artist', 'artistId', 'image', 'platform'],
};

const clean = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const oneLine = (s, max) => clean(s, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
const nowIso = () => new Date().toISOString();

export function createCommunity({ dbDir, readJson, writeJson, withLock, currentUser, artistBrief, artistsFor, onActivity = () => {} }) {
  const imgDir = path.join(dbDir, 'community', 'img');
  let secret = null;
  async function getSecret() {
    if (secret) return secret;
    const s = await readJson('community/secret', null);
    if (s?.v) return (secret = s.v);
    secret = randomBytes(16).toString('hex');
    await writeJson('community/secret', { v: secret });
    return secret;
  }
  const anonTag = async (uid, board) => createHash('sha256').update(`${await getSecret()}|${uid}|${board}`).digest('hex').slice(0, 4);

  /* ---------- 갤러리 판별 ---------- */
  async function boardInfo(id) {
    if (!BOARD_RE.test(id || '')) return null;
    if (GENERAL_BOARDS.includes(id)) return { id, kind: 'general', heads: HEADS.general };
    const a = await artistBrief(id);
    if (!a) return null;
    return { id, kind: 'artist', heads: HEADS.artist, artist: a };
  }

  const safeBoard = (b) => {
    if (typeof b !== 'string' || !BOARD_RE.test(b)) throw fail(400, 'BAD_BOARD', '갤러리 주소가 올바르지 않습니다');
    return b;
  };
  const safeNo = (no) => {
    const n = Number(no);
    if (!Number.isSafeInteger(n) || n < 1) throw fail(400, 'BAD_POST', '글 번호가 올바르지 않습니다');
    return n;
  };
  const boardKey = (b) => 'community/b-' + safeBoard(b);
  const cmtKey = (b, no) => 'community/c-' + safeBoard(b) + '-' + safeNo(no);
  const voteKey = (b) => 'community/v-' + safeBoard(b);
  const loadBoard = async (b) => (await readJson(boardKey(b), null)) || { id: b, seq: 0, posts: [] };

  /* ---------- 색인(허브용): 갤러리별 글 수·최근 글·7일 글 시각, 전체 최근 글 300개 ---------- */
  async function touchIndex(fn) {
    return withLock('cm:index', async () => {
      const idx = (await readJson('community/index', null)) || { boards: {}, recent: [] };
      fn(idx);
      const weekAgo = Date.now() - 7 * 864e5;
      for (const v of Object.values(idx.boards)) v.week = (v.week || []).filter((t) => t > weekAgo);
      idx.recent = idx.recent.slice(0, 300);
      await writeJson('community/index', idx);
      return idx;
    });
  }
  /* 피드 카드용: 본문 앞부분(사진 자리 표시 제거)과 사진 두 장까지 */
  const excerptOf = (body) => String(body || '').replace(/\[(?:사진|写真|img) ?\d{1,2}\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  const listItem = (b, p) => ({
    board: b, no: p.no, head: p.head, title: p.title, nick: p.nick, anon: !!p.anon, tag: p.tag || null,
    at: p.at, views: p.views || 0, up: p.up || 0, cmt: p.cmt || 0, img: (p.images || []).length > 0,
    excerpt: excerptOf(p.body), thumbs: (p.images || []).slice(0, 4).map((x) => ({ src: `/api/community/img/${x.f}`, w: x.w, h: x.h })), imgCount: (p.images || []).length,
  });
  const syncRecent = (idx, b, p) => {
    const i = idx.recent.findIndex((r) => r.board === b && r.no === p.no);
    if (p.del) { if (i >= 0) idx.recent.splice(i, 1); return; }
    const row = listItem(b, p);
    if (i >= 0) idx.recent[i] = row; else idx.recent.unshift(row);
  };

  /* ---------- 공개 형태 ---------- */
  const publicPost = (b, p, uid) => ({
    ...listItem(b, p), body: p.body, images: (p.images || []).map((x) => ({ src: `/api/community/img/${x.f}`, w: x.w, h: x.h })),
    down: p.down || 0, edited: p.edited || null, mine: !!uid && p.uid === uid,
  });
  const publicCmt = (c, uid) => (c.del
    ? { id: c.id, parent: c.parent || null, del: true, at: c.at }
    : { id: c.id, parent: c.parent || null, body: c.body, nick: c.nick, anon: !!c.anon, tag: c.tag || null, at: c.at, mine: !!uid && c.uid === uid });

  /* ---------- 이미지 ---------- */
  function sniff(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    if (buf.slice(0, 4).toString() === 'GIF8') return 'gif';
    return null;
  }
  async function saveImages(list) {
    const out = [];
    for (const it of (Array.isArray(list) ? list : []).slice(0, MAX_IMAGES)) {
      const m = String(it?.data || '').match(/^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw Object.assign(new Error('이미지 형식이 올바르지 않습니다'), { status: 400, code: 'BAD_IMAGE' });
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('이미지는 한 장에 3MB까지 올릴 수 있습니다'), { status: 400, code: 'IMAGE_TOO_LARGE' });
      const ext = sniff(buf);
      if (!ext) throw Object.assign(new Error('지원하지 않는 이미지입니다'), { status: 400, code: 'BAD_IMAGE' });
      const f = `${createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
      await mkdir(imgDir, { recursive: true });
      await writeFile(path.join(imgDir, f), buf);
      const w = Math.max(1, Math.min(8000, Math.round(Number(it.w) || 0))) || null;
      const h = Math.max(1, Math.min(8000, Math.round(Number(it.h) || 0))) || null;
      out.push({ f, w, h });
    }
    return out;
  }

  /* ---------- 도배 방지 · 조회수 중복 방지 ---------- */
  const lastPost = new Map();
  const lastCmt = new Map();
  const seenViews = new Map();
  function countView(key) {
    const t = seenViews.get(key);
    if (t && Date.now() - t < 3600e3) return false;
    if (seenViews.size > 20000) seenViews.clear();
    seenViews.set(key, Date.now());
    return true;
  }
  const viewerOf = (req, user) => user ? `u:${user.id}` : `ip:${createHash('sha1').update(String(req.ip || '')).digest('hex').slice(0, 12)}`;

  const fail = (status, code, error) => Object.assign(new Error(error), { status, code });
  async function authorOf(user, board, anon) {
    if (anon) return { uid: user.id, nick: 'ㅇㅇ', anon: true, tag: await anonTag(user.id, board) };
    return { uid: user.id, nick: oneLine(user.name || 'fan', 20) || 'fan', anon: false, tag: null };
  }

  /* ---------- 갤러리 ---------- */
  async function list(boardId, { page = 1, head = '', mode = 'all', q = '', field = 'all' } = {}) {
    const info = await boardInfo(boardId);
    if (!info) throw fail(404, 'NO_BOARD', '없는 갤러리입니다');
    const b = await loadBoard(boardId);
    let rows = b.posts.filter((p) => !p.del && !p.hidden);
    const total = rows.length;
    if (head && info.heads.includes(head)) rows = rows.filter((p) => p.head === head);
    if (mode === 'best') rows = rows.filter((p) => (p.up || 0) >= BEST_MIN);
    const needle = oneLine(q, 40).toLowerCase();
    if (needle) {
      rows = rows.filter((p) => {
        const hay = field === 'title' ? p.title : field === 'body' ? p.body : field === 'author' ? p.nick : `${p.title}\n${p.body}`;
        return String(hay || '').toLowerCase().includes(needle);
      });
    }
    rows = rows.slice().sort((a, b2) => b2.no - a.no);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pg = Math.min(pages, Math.max(1, Number(page) || 1));
    return {
      board: { ...info, posts: total, bestMin: BEST_MIN },
      items: rows.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE).map((p) => listItem(boardId, p)),
      page: pg, pages, count: rows.length,
    };
  }

  async function view(boardId, no, req) {
    const info = await boardInfo(boardId);
    if (!info) throw fail(404, 'NO_BOARD', '없는 갤러리입니다');
    const user = await currentUser(req);
    const n = Number(no);
    let post = null;
    const counted = countView(`${boardId}:${n}:${viewerOf(req, user)}`);
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      const p = b.posts.find((x) => x.no === n);
      if (!p || p.del || p.hidden) return;
      if (counted) { p.views = (p.views || 0) + 1; await writeJson(boardKey(boardId), b); }
      post = p;
    });
    if (!post) throw fail(404, 'NO_POST', '삭제되었거나 없는 글입니다');
    const votes = (await readJson(voteKey(boardId), {}))?.[n] || {};
    return { board: { ...info, bestMin: BEST_MIN }, post: publicPost(boardId, post, user?.id), myVote: user ? votes[user.id] || 0 : 0 };
  }

  async function write(boardId, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const info = await boardInfo(boardId);
    if (!info) throw fail(404, 'NO_BOARD', '없는 갤러리입니다');
    const { head, title, body, images, anon } = req.body || {};
    const t = oneLine(title, 60);
    const txt = clean(body, 8000).trim();
    if (!t) throw fail(400, 'TITLE_REQUIRED', '제목을 입력해 주세요');
    if (!txt && !(images || []).length) throw fail(400, 'BODY_REQUIRED', '내용을 입력해 주세요');
    const last = lastPost.get(user.id) || 0;
    if (Date.now() - last < POST_GAP_MS) throw fail(429, 'TOO_FAST', '글은 20초에 한 번 쓸 수 있습니다');
    const imgs = await saveImages(images);
    const who = await authorOf(user, boardId, !!anon);
    let created = null;
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      b.seq = (b.seq || 0) + 1;
      created = { no: b.seq, head: info.heads.includes(head) ? head : info.heads[0], title: t, body: txt, images: imgs, ...who, at: nowIso(), views: 0, up: 0, down: 0, cmt: 0 };
      b.posts.push(created);
      await writeJson(boardKey(boardId), b);
    });
    lastPost.set(user.id, Date.now());
    await touchIndex((idx) => {
      const s = idx.boards[boardId] || (idx.boards[boardId] = { posts: 0, week: [] });
      s.posts += 1; s.last = created.at; s.week.push(Date.now());
      syncRecent(idx, boardId, created);
    });
    return { no: created.no };
  }

  async function remove(boardId, no, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const n = Number(no);
    let removed = null;
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      const p = b.posts.find((x) => x.no === n && !x.del);
      if (!p) throw fail(404, 'NO_POST', '없는 글입니다');
      if (p.uid !== user.id) throw fail(403, 'FORBIDDEN', '본인 글만 삭제할 수 있습니다');
      p.del = true; p.delAt = nowIso();
      await writeJson(boardKey(boardId), b);
      removed = p;
    });
    await touchIndex((idx) => {
      const s = idx.boards[boardId];
      if (s) s.posts = Math.max(0, s.posts - 1);
      syncRecent(idx, boardId, removed);
    });
    return { ok: true };
  }

  async function vote(boardId, no, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const v = Number(req.body?.v) === -1 ? -1 : 1;
    const n = Number(no);
    let out = null;
    let snapshot = null;
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      const p = b.posts.find((x) => x.no === n && !x.del);
      if (!p) throw fail(404, 'NO_POST', '없는 글입니다');
      const votes = (await readJson(voteKey(boardId), {})) || {};
      const mine = votes[n] || (votes[n] = {});
      /* 디시처럼 한 글에 한 번만. 이미 누른 쪽을 다시 누르면 취소 */
      if (mine[user.id] === v) delete mine[user.id];
      else if (mine[user.id]) throw fail(409, 'ALREADY_VOTED', '이미 반대쪽을 눌렀습니다. 먼저 취소해 주세요');
      else mine[user.id] = v;
      const vals = Object.values(mine);
      p.up = vals.filter((x) => x === 1).length;
      p.down = vals.filter((x) => x === -1).length;
      await writeJson(voteKey(boardId), votes);
      await writeJson(boardKey(boardId), b);
      out = { up: p.up, down: p.down, mine: mine[user.id] || 0, best: p.up >= BEST_MIN };
      snapshot = p;
    });
    await touchIndex((idx) => syncRecent(idx, boardId, snapshot));
    return out;
  }

  async function comments(boardId, no, req) {
    const user = await currentUser(req);
    const b = await loadBoard(boardId);
    if (!b.posts.some((p) => p.no === safeNo(no) && !p.del && !p.hidden)) throw fail(404, 'NO_POST', '없는 글입니다');
    const list = (await readJson(cmtKey(boardId, Number(no)), [])) || [];
    return { items: list.map((c) => publicCmt(c, user?.id)) };
  }

  async function addComment(boardId, no, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const n = Number(no);
    const body = clean(req.body?.body, 400).trim();
    if (!body) throw fail(400, 'BODY_REQUIRED', '댓글을 입력해 주세요');
    const last = lastCmt.get(user.id) || 0;
    if (Date.now() - last < CMT_GAP_MS) throw fail(429, 'TOO_FAST', '댓글을 너무 빨리 쓰고 있습니다');
    const who = await authorOf(user, boardId, !!req.body?.anon);
    let snapshot = null;
    let created = null;
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      const p = b.posts.find((x) => x.no === n && !x.del);
      if (!p) throw fail(404, 'NO_POST', '없는 글입니다');
      const list = (await readJson(cmtKey(boardId, n), [])) || [];
      const parent = req.body?.parent ? String(req.body.parent) : null;
      if (parent && !list.some((c) => c.id === parent && !c.parent)) throw fail(400, 'NO_PARENT', '답글을 달 댓글이 없습니다');
      created = { id: randomBytes(6).toString('hex'), parent, body, ...who, at: nowIso() };
      list.push(created);
      p.cmt = list.filter((c) => !c.del).length;
      await writeJson(cmtKey(boardId, n), list);
      await writeJson(boardKey(boardId), b);
      snapshot = p;
    });
    lastCmt.set(user.id, Date.now());
    await touchIndex((idx) => syncRecent(idx, boardId, snapshot));
    return { item: publicCmt(created, user.id), count: snapshot.cmt };
  }

  async function removeComment(boardId, no, id, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const n = Number(no);
    let snapshot = null;
    await withLock(`cm:${boardId}`, async () => {
      const b = await loadBoard(boardId);
      const p = b.posts.find((x) => x.no === n);
      const list = (await readJson(cmtKey(boardId, n), [])) || [];
      const c = list.find((x) => x.id === id && !x.del);
      if (!c) throw fail(404, 'NO_COMMENT', '없는 댓글입니다');
      if (c.uid !== user.id) throw fail(403, 'FORBIDDEN', '본인 댓글만 삭제할 수 있습니다');
      c.del = true;
      if (p) p.cmt = list.filter((x) => !x.del).length;
      await writeJson(cmtKey(boardId, n), list);
      if (p) await writeJson(boardKey(boardId), b);
      snapshot = p;
    });
    if (snapshot) await touchIndex((idx) => syncRecent(idx, boardId, snapshot));
    return { ok: true, count: snapshot?.cmt ?? 0 };
  }

  async function report(boardId, no, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const reason = oneLine(req.body?.reason, 100);
    await withLock('cm:reports', async () => {
      const list = (await readJson('community/reports', [])) || [];
      if (!list.some((r) => r.board === boardId && r.no === Number(no) && r.uid === user.id)) {
        list.push({ board: boardId, no: Number(no), uid: user.id, reason, at: nowIso() });
        await writeJson('community/reports', list.slice(-5000));
      }
    });
    return { ok: true };
  }

  /* ---------- 허브(종합 커뮤니티) ---------- */
  async function hub({ edition = 'kr' } = {}) {
    const idx = (await readJson('community/index', null)) || { boards: {}, recent: [] };
    const want = edition === 'kr' ? ['jp'] : edition === 'jp' ? ['kr'] : ['jp', 'kr'];
    const briefs = new Map();
    const brief = async (id) => {
      if (GENERAL_BOARDS.includes(id)) return { id, kind: 'general' };
      if (!briefs.has(id)) briefs.set(id, await artistBrief(id));
      const a = briefs.get(id);
      return a ? { id, kind: 'artist', artist: a } : null;
    };
    const inEdition = async (id) => {
      const b = await brief(id);
      return b && (b.kind === 'general' || want.includes(b.artist.origin));
    };
    const weekAgo = Date.now() - 7 * 864e5;
    const recent = [];
    for (const r of idx.recent) if (await inEdition(r.board)) recent.push({ ...r, gallery: await brief(r.board) });
    const best = recent.filter((r) => r.up >= BEST_MIN && Date.parse(r.at) > weekAgo).sort((a, b) => b.up - a.up || b.cmt - a.cmt).slice(0, 15);
    const ranked = [];
    for (const [id, s] of Object.entries(idx.boards)) {
      if (GENERAL_BOARDS.includes(id) || !s.posts || !(await inEdition(id))) continue;
      ranked.push({ ...(await brief(id)), posts: s.posts, week: (s.week || []).length, last: s.last || null });
    }
    ranked.sort((a, b) => b.week - a.week || b.posts - a.posts);
    const general = GENERAL_BOARDS.map((id) => ({ id, kind: 'general', posts: idx.boards[id]?.posts || 0, week: (idx.boards[id]?.week || []).length, last: idx.boards[id]?.last || null }));
    return { general, ranked: ranked.slice(0, 20), best, recent: recent.slice(0, 30), bestMin: BEST_MIN };
  }

  async function galleries({ edition = 'kr' } = {}) {
    const idx = (await readJson('community/index', null)) || { boards: {} };
    const list = await artistsFor(edition);
    return {
      items: list.map((a) => ({ id: a.id, artist: a, posts: idx.boards[a.id]?.posts || 0, week: (idx.boards[a.id]?.week || []).length, last: idx.boards[a.id]?.last || null }))
        .sort((a, b) => b.week - a.week || b.posts - a.posts || (b.artist.chartHits || 0) - (a.artist.chartHits || 0)),
    };
  }

  /* ================= 소셜 ================= */
  const socialKey = (kind, ref) => `${SOCIAL_KINDS[kind]}${createHash('sha1').update(`${kind}|${ref}`).digest('hex').slice(0, 15)}`;
  const tKey = (key) => `social/t-${key}`;
  const okKey = (k) => /^[crtf][a-f0-9]{15}$/.test(String(k || ''));
  const normRef = (kind, ref) => {
    const r = String(ref || '').trim().slice(0, 500);
    if (!r) return null;
    if (kind === 'concert' && !/^https?:\/\//.test(r)) return null;
    return kind === 'track' ? r.toLowerCase().replace(/\s+/g, ' ') : r;
  };
  function cleanSnap(kind, snap) {
    const out = {};
    for (const f of SNAP_FIELDS[kind] || []) {
      const v = snap?.[f];
      if (v == null) continue;
      if (typeof v === 'boolean' || typeof v === 'number') { out[f] = v; continue; }
      if (typeof v !== 'string') continue;
      const s = oneLine(v, 300);
      if (/^(poster|url|artwork|preview|appleUrl|image)$/.test(f) && !/^https?:\/\//.test(s) && !s.startsWith('/api/')) continue;
      out[f] = s;
    }
    return out;
  }
  async function ensureTarget(kind, ref, snap) {
    if (!Object.hasOwn(SOCIAL_KINDS, kind)) throw fail(400, 'BAD_KIND', '알 수 없는 대상입니다');
    const r = normRef(kind, ref);
    if (!r) throw fail(400, 'BAD_REF', '대상 식별자가 올바르지 않습니다');
    const key = socialKey(kind, r);
    await withLock(`so:${key}`, async () => {
      const t = await readJson(tKey(key), null);
      const s = cleanSnap(kind, snap);
      if (!t) {
        if (!s.title) throw fail(400, 'SNAP_REQUIRED', '대상 정보가 필요합니다');
        await writeJson(tKey(key), { key, kind, ref: r, snap: s, at: nowIso(), likes: [], comments: [] });
      } else {
        /* 처음 저장한 값은 덮어쓰지 않는다. 빠진 칸만 채운다 */
        let changed = false;
        for (const [k, v] of Object.entries(s)) if (t.snap[k] == null) { t.snap[k] = v; changed = true; }
        if (changed) await writeJson(tKey(key), t);
      }
    });
    return key;
  }
  async function socialIndex(fn) {
    return withLock('so:index', async () => {
      const idx = (await readJson('social/index', null)) || {};
      fn(idx);
      await writeJson('social/index', idx);
    });
  }
  async function lookup(items, req) {
    const user = await currentUser(req);
    const idx = (await readJson('social/index', null)) || {};
    const out = [];
    for (const it of (Array.isArray(items) ? items : []).slice(0, 120)) {
      const r = Object.hasOwn(SOCIAL_KINDS, it?.kind) ? normRef(it.kind, it.ref) : null;
      if (!r) { out.push(null); continue; }
      const key = socialKey(it.kind, r);
      const s = idx[key];
      let liked = false;
      if (user && s?.likes) liked = ((await readJson(tKey(key), null))?.likes || []).includes(user.id);
      out.push({ key, likes: s?.likes || 0, cmt: s?.cmt || 0, liked });
    }
    return { items: out };
  }
  async function target(key, req) {
    if (!okKey(key)) throw fail(404, 'NO_TARGET', '없는 항목입니다');
    const t = await readJson(tKey(key), null);
    if (!t) throw fail(404, 'NO_TARGET', '없는 항목입니다');
    const user = await currentUser(req);
    return { key, kind: t.kind, ref: t.ref, snap: t.snap, likes: t.likes.length, liked: !!user && t.likes.includes(user.id), cmt: t.comments.filter((c) => !c.del).length };
  }
  async function like(req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const { kind, ref, snap } = req.body || {};
    const key = await ensureTarget(kind, ref, snap);
    let out = null;
    let title = '';
    await withLock(`so:${key}`, async () => {
      const t = await readJson(tKey(key), null);
      const i = t.likes.indexOf(user.id);
      if (i >= 0) t.likes.splice(i, 1); else t.likes.push(user.id);
      await writeJson(tKey(key), t);
      out = { key, likes: t.likes.length, liked: i < 0 };
      title = t.snap.title;
    });
    await socialIndex((idx) => { const s = idx[key] || (idx[key] = { kind, cmt: 0 }); s.likes = out.likes; s.title = title; s.at = nowIso(); });
    /* 내 좋아요 목록(마이페이지) */
    await withLock(`user:${user.id}:social`, async () => {
      const k = `user/${user.id}/social-likes`;
      const list = (await readJson(k, [])) || [];
      const j = list.findIndex((x) => x.key === key);
      if (out.liked && j < 0) list.unshift({ key, kind, at: nowIso() });
      if (!out.liked && j >= 0) list.splice(j, 1);
      await writeJson(k, list.slice(0, 500));
    });
    return out;
  }
  async function targetComments(key, req) {
    if (!okKey(key)) return { items: [] };
    const user = await currentUser(req);
    const t = await readJson(tKey(key), null);
    return { items: (t?.comments || []).map((c) => publicCmt(c, user?.id)) };
  }
  async function comment(req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const { kind, ref, snap, body: raw, parent: par } = req.body || {};
    const body = clean(raw, 400).trim();
    if (!body) throw fail(400, 'BODY_REQUIRED', '댓글을 입력해 주세요');
    const last = lastCmt.get(user.id) || 0;
    if (Date.now() - last < CMT_GAP_MS) throw fail(429, 'TOO_FAST', '댓글을 너무 빨리 쓰고 있습니다');
    const key = await ensureTarget(kind, ref, snap);
    let created = null;
    let count = 0;
    let title = '';
    await withLock(`so:${key}`, async () => {
      const t = await readJson(tKey(key), null);
      const parent = par ? String(par) : null;
      if (parent && !t.comments.some((c) => c.id === parent && !c.parent)) throw fail(400, 'NO_PARENT', '답글을 달 댓글이 없습니다');
      created = { id: randomBytes(6).toString('hex'), parent, body, uid: user.id, nick: oneLine(user.name || 'fan', 20), anon: false, at: nowIso() };
      t.comments.push(created);
      count = t.comments.filter((c) => !c.del).length;
      title = t.snap.title;
      await writeJson(tKey(key), t);
    });
    lastCmt.set(user.id, Date.now());
    await socialIndex((idx) => { const s = idx[key] || (idx[key] = { kind, likes: 0 }); s.cmt = count; s.title = title; s.at = nowIso(); });
    return { key, item: publicCmt(created, user.id), count };
  }
  async function removeTargetComment(key, id, req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    if (!okKey(key)) throw fail(404, 'NO_TARGET', '없는 항목입니다');
    let count = 0;
    await withLock(`so:${key}`, async () => {
      const t = await readJson(tKey(key), null);
      const c = t?.comments.find((x) => x.id === id && !x.del);
      if (!c) throw fail(404, 'NO_COMMENT', '없는 댓글입니다');
      if (c.uid !== user.id) throw fail(403, 'FORBIDDEN', '본인 댓글만 삭제할 수 있습니다');
      c.del = true;
      count = t.comments.filter((x) => !x.del).length;
      await writeJson(tKey(key), t);
    });
    await socialIndex((idx) => { if (idx[key]) idx[key].cmt = count; });
    return { ok: true, count };
  }
  async function myLikes(req) {
    const user = await currentUser(req);
    if (!user) throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
    const list = (await readJson(`user/${user.id}/social-likes`, [])) || [];
    const out = [];
    for (const x of list.slice(0, 60)) {
      const t = await readJson(tKey(x.key), null);
      if (t) out.push({ key: x.key, kind: t.kind, ref: t.ref, snap: t.snap, likes: t.likes.length, at: x.at });
    }
    return { items: out };
  }

  /* ---------- 라우트 ---------- */
  function register(app) {
    const wrap = (fn) => async (req, res) => {
      try {
        if (req.params.board != null) safeBoard(req.params.board);
        if (req.params.no != null) safeNo(req.params.no);
        const run = async () => res.json(await fn(req));
        // Serialize writes per user so concurrent requests cannot bypass the posting gap.
        if (['POST', 'DELETE'].includes(req.method)) {
          const user = await currentUser(req);
          if (!user && req.path !== '/api/social/lookup') throw fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다');
          if (user) return await withLock('community:writer:' + user.id, run);
        }
        await run();
      }
      catch (e) {
        if (!e.status) console.error('[community]', e);
        res.status(e.status || 500).json({ error: e.status ? e.message : '서버 오류', code: e.status ? (e.code || 'INVALID_INPUT') : 'INTERNAL' });
      }
    };
    const ed = (v) => (['kr', 'jp', 'all'].includes(v) ? v : 'kr');
    app.get('/api/community/hub', wrap((req) => hub({ edition: ed(req.query.edition) })));
    app.get('/api/community/galleries', wrap((req) => galleries({ edition: ed(req.query.edition) })));
    app.get('/api/community/b/:board', wrap((req) => list(req.params.board, { page: req.query.page, head: String(req.query.head || ''), mode: String(req.query.mode || 'all'), q: String(req.query.q || ''), field: String(req.query.field || 'all') })));
    const tap = (kind, fn) => async (req) => { const r = await fn(req); try { onActivity({ key: `${kind}:${req.params.board}`, board: req.params.board, kind }); } catch { /* 알림 실패는 무시 */ } return r; };
    app.post('/api/community/b/:board', wrap(tap('post', (req) => write(req.params.board, req))));
    app.get('/api/community/b/:board/:no', wrap((req) => view(req.params.board, req.params.no, req)));
    app.delete('/api/community/b/:board/:no', wrap((req) => remove(req.params.board, req.params.no, req)));
    app.post('/api/community/b/:board/:no/vote', wrap((req) => vote(req.params.board, req.params.no, req)));
    app.post('/api/community/b/:board/:no/report', wrap((req) => report(req.params.board, req.params.no, req)));
    app.get('/api/community/b/:board/:no/comments', wrap((req) => comments(req.params.board, req.params.no, req)));
    app.post('/api/community/b/:board/:no/comments', wrap(tap('comment', (req) => addComment(req.params.board, req.params.no, req))));
    app.delete('/api/community/b/:board/:no/comments/:id', wrap((req) => removeComment(req.params.board, req.params.no, req.params.id, req)));
    app.get('/api/community/img/:f', async (req, res) => {
      const f = String(req.params.f || '');
      if (!IMG_RE.test(f)) return res.status(404).end();
      try {
        const buf = await readFile(path.join(imgDir, f));
        const ext = f.split('.').pop();
        res.set('Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(buf);
      } catch { res.status(404).end(); }
    });

    app.post('/api/social/lookup', wrap((req) => lookup(req.body?.items, req)));
    app.post('/api/social/target', wrap(async (req) => ({ key: await ensureTarget(req.body?.kind, req.body?.ref, req.body?.snap) })));
    app.get('/api/social/t/:key', wrap((req) => target(req.params.key, req)));
    app.get('/api/social/t/:key/comments', wrap((req) => targetComments(req.params.key, req)));
    app.delete('/api/social/t/:key/comments/:id', wrap((req) => removeTargetComment(req.params.key, req.params.id, req)));
    app.post('/api/social/like', wrap((req) => like(req)));
    app.post('/api/social/comment', wrap((req) => comment(req)));
    app.get('/api/social/mine', wrap((req) => myLikes(req)));
  }

  return { register, hub, galleries, list, view, write, remove, vote, comments, addComment, removeComment, lookup, like, comment, target, socialKey };
}
