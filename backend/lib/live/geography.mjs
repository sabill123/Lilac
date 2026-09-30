/* Ticket vendor country and performer origin are not venue geography.
 * Location fields only: never infer a venue country from a genre, artist bio,
 * title saying JAPAN TOUR, or a Japanese seller. Legacy JP caches contained
 * country:'JP' defaults (and 海外 -> KR); ignore those unsupported defaults.
 */
const JP_VENDOR = /^(pia|eplus)$/i;
const codeOf = value => {
  const s = String(value?.name || value || '').trim().toUpperCase();
  if (/^(JP|JPN|JAPAN|日本|일본)$/.test(s)) return 'JP';
  if (/^(KR|KOR|SOUTH KOREA|REPUBLIC OF KOREA|韓国|대한민국|한국)$/.test(s)) return 'KR';
  return /^[A-Z]{2}$/.test(s) ? s : null;
};
const CLUES = [
  ['KR', /韓国|韓國|大韓民国|대한민국|한국|ソウル|仁川|釜山|서울|인천|부산|고양|수원|大邱|パラダイスシティ|\b(?:south korea|republic of korea|seoul|incheon|busan|daegu|goyang|suwon)\b/i],
  ['JP', /日本|일본|北海道|東京都|京都府|大阪府|[一-龯]{2,4}県|東京|大阪|横浜|名古屋|福岡|札幌|도쿄|오사카|요코하마|후쿠오카|\b(?:japan|tokyo|osaka|yokohama|nagoya|fukuoka|sapporo)\b/i],
  ['TW', /台湾|臺灣|台灣|台北|臺北|高雄|\b(?:taiwan|taipei|kaohsiung)\b/i],
  ['HK', /香港|\bhong kong\b/i],
  ['SG', /シンガポール|新加坡|\bsingapore\b/i],
  ['TH', /タイ王国|バンコク|\b(?:thailand|bangkok)\b/i],
];
export function eventGeography(event) {
  const explicit = codeOf(event.sourceCountry || event.venueCountry || event.address?.addressCountry || (event.countryEvidence === 'source' ? event.country : null));
  const location = [event.venue, event.city, event.address?.addressLocality, event.address?.addressRegion].filter(Boolean).join(' ').normalize('NFKC');
  const clues = [...new Set(CLUES.filter(([, re]) => re.test(location)).map(([c]) => c))];
  const overseas = /海外|国外|overseas|abroad/i.test(location);
  if (clues.length > 1 || (explicit && clues.length && !clues.includes(explicit))) return { country: null, countryEvidence: 'conflict' };
  if (explicit) return { country: explicit, countryEvidence: 'source' };
  if (clues.length === 1) {
    if (overseas && JP_VENDOR.test(event.provider || '') && clues[0] === 'JP') return { country: null, countryEvidence: 'conflict' };
    return { country: clues[0], countryEvidence: 'venue' };
  }
  if (overseas) return { country: null, countryEvidence: 'unknown-overseas' };
  if (!JP_VENDOR.test(event.provider || '')) {
    const country = codeOf(event.country);
    if (country) return { country, countryEvidence: 'source' };
  }
  return { country: null, countryEvidence: 'unknown' };
}
export const withEventGeography = event => ({ ...event, ...eventGeography(event) });
export const concertsInCountry = (events, country) => events.map(withEventGeography).filter(e => e.country === country);
