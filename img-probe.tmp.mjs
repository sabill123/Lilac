import { fetchText } from './backend/lib/live/http.mjs';
for (const u of process.argv.slice(2)) {
  try { const h = await fetchText(u, { timeout: 12000, retries: 0, headers: { 'Accept-Language': 'ja' } });
    const og = (h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i) || [])[1];
    const imgs = [...h.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]).filter(s=>/\.(jpe?g|png|webp)/i.test(s) && !/logo|icon|banner|btn|spacer|common/i.test(s)).slice(0,6);
    console.log('\n##', u, '\n og:', og, '\n imgs:', imgs.join('\n       '));
  } catch (e) { console.log('ERR', u, e.message); }
}
