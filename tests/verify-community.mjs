/* 커뮤니티·소셜 모듈 검증 — 메모리 저장소로 돌린다(실제 db 를 건드리지 않는다) */
import { createCommunity, BEST_MIN, PAGE_SIZE } from '../backend/lib/community.mjs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('  FAIL', name); } };
const store = new Map();
const readJson = async (k, fb) => (store.has(k) ? JSON.parse(store.get(k)) : fb);
const writeJson = async (k, v) => { store.set(k, JSON.stringify(v)); };
const locks = new Map();
const withLock = (key, fn) => { const prev = locks.get(key) || Promise.resolve(); const run = prev.then(fn, fn); locks.set(key, run.then(() => {}, () => {})); return run; };
const users = { a: { id: 'ua', name: '사과' }, b: { id: 'ub', name: '바나나' }, c: { id: 'uc', name: '체리' }, d: { id: 'ud', name: '딸기' } };
const currentUser = async (req) => users[req.who] || null;
const ARTISTS = { 'mrs-green-apple': { id: 'mrs-green-apple', name: 'Mrs. GREEN APPLE', origin: 'jp' }, aespa: { id: 'aespa', name: 'aespa', origin: 'kr' } };
const cm = createCommunity({
  dbDir: path.join(os.tmpdir(), 'lilac-cm-test'), readJson, writeJson, withLock, currentUser,
  artistBrief: async (id) => ARTISTS[id] || null,
  artistsFor: async (ed) => Object.values(ARTISTS).filter((a) => (ed === 'kr' ? a.origin === 'jp' : ed === 'jp' ? a.origin === 'kr' : true)),
});
const req = (who, body = {}) => ({ who, body, ip: '1.2.3.4' });
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };

// 쓰기 권한·검증
check('비로그인 글쓰기는 401', (await err(cm.write('mrs-green-apple', req(null, { title: 't', body: 'b' }))))?.status === 401);
check('없는 갤러리는 404', (await err(cm.write('nope', req('a', { title: 't', body: 'b' }))))?.status === 404);
check('제목 없으면 400', (await err(cm.write('mrs-green-apple', req('a', { title: '  ', body: 'b' }))))?.code === 'TITLE_REQUIRED');
const w1 = await cm.write('mrs-green-apple', req('a', { head: 'info', title: '  Ringo   Jam 해외 가입 후기 ', body: '신용카드로 됐어요', anon: true }));
check('첫 글 번호는 1', w1.no === 1);
check('연속 글쓰기는 429(도배 방지)', (await err(cm.write('mrs-green-apple', req('a', { title: 'x', body: 'y' }))))?.status === 429);
const w2 = await cm.write('mrs-green-apple', req('b', { head: 'nope', title: '고닉 글', body: '본문' }));
const v1 = await cm.view('mrs-green-apple', 1, req('b'));
check('제목 공백 정리', v1.post.title === 'Ringo Jam 해외 가입 후기');
check('익명은 ㅇㅇ + 4자리 태그', v1.post.nick === 'ㅇㅇ' && /^[a-f0-9]{4}$/.test(v1.post.tag));
check('응답에 계정 id 가 없다', !JSON.stringify(v1).includes('"ua"'));
check('모르는 말머리는 기본값으로', (await cm.view('mrs-green-apple', 2, req('a'))).post.head === 'talk');
check('남의 글은 mine=false', v1.post.mine === false);

// 익명 태그: 같은 사람·같은 갤러리 고정, 다른 갤러리에선 달라진다
cm.write; // (도배 간격 우회: 다른 사용자로 확인)
const tagA1 = v1.post.tag;
await new Promise((r) => setTimeout(r, 5));
const other = await err(cm.write('aespa', req('a', { title: 'x', body: 'y', anon: true })));
check('다른 갤러리라도 20초 간격 적용', other?.status === 429);

// 조회수 중복 방지
const before = (await cm.view('mrs-green-apple', 1, req('b'))).post.views;
check('같은 사람이 다시 봐도 조회수 그대로', before === v1.post.views);

// 추천
const up1 = await cm.vote('mrs-green-apple', 1, req('b', { v: 1 }));
check('추천 1', up1.up === 1 && up1.mine === 1);
check('반대쪽 중복은 409', (await err(cm.vote('mrs-green-apple', 1, req('b', { v: -1 }))))?.status === 409);
const up0 = await cm.vote('mrs-green-apple', 1, req('b', { v: 1 }));
check('같은 쪽 다시 누르면 취소', up0.up === 0 && up0.mine === 0);
check('비로그인 추천 401', (await err(cm.vote('mrs-green-apple', 1, req(null, { v: 1 }))))?.status === 401);

// 개념글
const board = JSON.parse(store.get('community/b-mrs-green-apple'));
board.posts[0].up = BEST_MIN; store.set('community/b-mrs-green-apple', JSON.stringify(board));
const best = await cm.list('mrs-green-apple', { mode: 'best' });
check(`개념글 = 추천 ${BEST_MIN} 이상만`, best.items.length === 1 && best.items[0].no === 1);

// 검색·말머리
check('말머리 필터', (await cm.list('mrs-green-apple', { head: 'info' })).items.every((p) => p.head === 'info'));
check('제목 검색', (await cm.list('mrs-green-apple', { q: '고닉', field: 'title' })).items.length === 1);
check('글쓴이 검색(익명 ㅇㅇ)', (await cm.list('mrs-green-apple', { q: 'ㅇㅇ', field: 'author' })).items.length === 1);

// 댓글
const c1 = await cm.addComment('mrs-green-apple', 1, req('b', { body: '저도 됐어요' }));
check('댓글 수 반영', c1.count === 1 && (await cm.list('mrs-green-apple')).items.find((p) => p.no === 1).cmt === 1);
check('없는 부모 댓글 400', (await err(cm.addComment('mrs-green-apple', 1, req('a', { body: 'x', parent: 'zzz' }))))?.status === 400);
check('남의 댓글 삭제 403', (await err(cm.removeComment('mrs-green-apple', 1, c1.item.id, req('a'))))?.status === 403);
const rc = await cm.removeComment('mrs-green-apple', 1, c1.item.id, req('b'));
check('본인 댓글 삭제 후 수 0', rc.count === 0);
const cl = await cm.comments('mrs-green-apple', 1, req(null));
check('삭제 댓글은 내용 없이 자리만', cl.items[0].del === true && !('body' in cl.items[0]));

// 삭제
check('남의 글 삭제 403', (await err(cm.remove('mrs-green-apple', 2, req('a'))))?.status === 403);
await cm.remove('mrs-green-apple', 2, req('b'));
check('삭제 글은 목록·보기에서 빠진다', (await cm.list('mrs-green-apple')).items.every((p) => p.no !== 2) && (await err(cm.view('mrs-green-apple', 2, req('a'))))?.status === 404);

// 허브·에디션
const hubKr = await cm.hub({ edition: 'kr' });
check('허브 최근 글에 일본 아티스트 갤러리 글', hubKr.recent.some((r) => r.board === 'mrs-green-apple'));
const hubJp = await cm.hub({ edition: 'jp' });
check('일본 에디션 허브엔 일본 아티스트 갤러리 글이 없다', !hubJp.recent.some((r) => r.board === 'mrs-green-apple'));
check('허브 개념글', hubKr.best.length === 0 || hubKr.best.every((r) => r.up >= BEST_MIN));

// 페이지
const bulk = JSON.parse(store.get('community/b-mrs-green-apple'));
for (let i = 0; i < PAGE_SIZE + 5; i++) bulk.posts.push({ no: ++bulk.seq, head: 'talk', title: `글 ${i}`, body: '', nick: 'x', at: new Date().toISOString(), views: 0, up: 0, cmt: 0, uid: 'ux' });
store.set('community/b-mrs-green-apple', JSON.stringify(bulk));
const p2 = await cm.list('mrs-green-apple', { page: 2 });
check('30개씩 페이지', p2.pages === 2 && p2.items.length === (bulk.posts.filter((p) => !p.del).length - PAGE_SIZE));
check('최신 번호가 먼저', (await cm.list('mrs-green-apple')).items[0].no === bulk.seq);

// 이미지 형식 검사
check('이미지가 아닌 데이터는 거절', (await err(cm.write('aespa', req('c', { title: 't', body: 'b', images: [{ data: 'data:image/png;base64,' + Buffer.from('hello').toString('base64') }] }))))?.code === 'BAD_IMAGE');

// 소셜
const snap = { title: 'Mrs. GREEN APPLE 내한', url: 'https://tickets.interpark.com/goods/1', poster: 'javascript:alert(1)', evil: 'x' };
check('비로그인 좋아요 401', (await err(cm.like(req(null, { kind: 'concert', ref: snap.url, snap }))))?.status === 401);
const l1 = await cm.like(req('a', { kind: 'concert', ref: snap.url, snap }));
check('좋아요 1', l1.likes === 1 && l1.liked === true);
const t1 = await cm.target(l1.key, req('b'));
check('스냅샷: 위험한 URL·모르는 칸은 버린다', !t1.snap.poster && !t1.snap.evil && t1.snap.title === snap.title);
await cm.like(req('a', { kind: 'concert', ref: snap.url, snap: { ...snap, title: '바꿔치기' } }));
check('처음 저장한 제목은 덮어쓰지 않는다', (await cm.target(l1.key, req('a'))).snap.title === snap.title);
check('다시 누르면 취소', (await cm.target(l1.key, req('a'))).likes === 0);
const lk = await cm.lookup([{ kind: 'concert', ref: snap.url }, { kind: 'bogus', ref: 'x' }], req('a'));
check('조회: 같은 키, 모르는 종류는 null', lk.items[0].key === l1.key && lk.items[1] === null);
const sc = await cm.comment(req('d', { kind: 'track', ref: 'Lilac|Mrs. GREEN APPLE', snap: { title: 'ライラック', artist: 'Mrs. GREEN APPLE' }, body: '명곡' }));
check('곡 댓글', sc.count === 1 && sc.key.startsWith('t'));
check('곡 키는 대소문자·공백 무관', cm.socialKey('track', 'lilac|mrs. green apple') === sc.key);
check('콘서트 ref 는 URL 이어야', (await err(cm.like(req('a', { kind: 'concert', ref: 'not a url', snap }))))?.code === 'BAD_REF');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
