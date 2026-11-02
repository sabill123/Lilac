import { getLocale } from './i18n';
import './assistance.css';

export interface AssistanceContext {
  kind: 'fanclub' | 'purchase'; artistId?: string; artistName: string;
  title: string; url: string; image?: string;
}
type Lang = 'ko' | 'ja';
interface TranslatorInstance { translate(text: string): Promise<string>; destroy(): void }
interface TranslatorFactory {
  availability(options: { sourceLanguage: Lang; targetLanguage: Lang }): Promise<string>;
  create(options: { sourceLanguage: Lang; targetLanguage: Lang; signal: AbortSignal;
    monitor: (monitor: { addEventListener(type: string, cb: (event: { loaded: number; total?: number }) => void): void }) => void;
  }): Promise<TranslatorInstance>;
}
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function assistanceUrl(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function assistanceEndpoint(ctx: AssistanceContext): string {
  const query = new URLSearchParams({ kind: ctx.kind, locale: getLocale() });
  if (ctx.kind === 'fanclub' && ctx.artistId) query.set('artistId', ctx.artistId);
  else query.set('url', ctx.url);
  return `/api/live/assistance?${query}`;
}
const localized = (ko: string, ja: string, locale = getLocale()) => locale === 'ja' ? ja : ko;
export function fieldHint(label: string, locale: Lang = getLocale()): string {
  const rules: [RegExp, string, string][] = [
    [/ふりがな|フリガナ|カナ|가나|후리가나/i, '읽는 이름의 가나 표기 항목입니다. 전각·반각 조건은 원문에서 확인하세요. 한글 이름을 임의로 음역하지 않습니다.', '名前の読み仮名欄です。全角・半角の指定は原文で確認してください。名前の読みは推測しません。'],
    [/電話|휴대|전화|tel|phone/i, '전화번호 항목입니다. 국가번호·현지 번호·문자 인증 가능 여부는 별도 확인이 필요합니다.', '電話番号欄です。国番号・現地番号・SMS認証の可否は別途確認が必要です。'],
    [/郵便|우편|postal|zip/i, '우편번호 항목입니다. 해외 주소 허용 여부는 이 항목명만으로 알 수 없습니다.', '郵便番号欄です。この項目名だけでは海外住所の利用可否は分かりません。'],
    [/住所|주소|address/i, '주소 항목입니다. 실제 거주지·배송지 조건과 해외배송 여부를 원문에서 확인하세요.', '住所欄です。居住地・配送先の条件と海外配送の可否は原文で確認してください。'],
    [/生年月日|생년월일|birth/i, '생년월일 항목입니다. 날짜 순서와 가입 연령 조건은 원문에서 확인하세요.', '生年月日欄です。日付の順序と入会年齢の条件は原文で確認してください。'],
    [/メール|이메일|e.?mail/i, '이메일 항목입니다. 사용 가능한 도메인과 인증 조건은 원문에서 확인하세요.', 'メールアドレス欄です。利用できるドメインと認証条件は原文で確認してください。'],
    [/氏名|名前|성명|이름|name/i, '이름 항목입니다. 여권 표기·문자 종류·순서는 원문 조건을 따르세요.', '氏名欄です。旅券表記・文字種・記入順序は原文の指定に従ってください。'],
  ];
  const rule = rules.find(([pattern]) => pattern.test(label));
  return rule ? localized(rule[1], rule[2], locale) : localized('항목명만으로 입력 조건을 알 수 없습니다. 원문을 확인하세요.', '項目名だけでは入力条件が分かりません。原文で確認してください。', locale);
}
/** Formatting only: does not verify a number, identity, SMS support or eligibility. */
export function normalizePhone(value: string, country: 'KR' | 'JP'): string | null {
  const text = value.normalize('NFKC').trim();
  if (!text || !/^\+?[\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  const code = country === 'KR' ? '82' : '81';
  if (text.startsWith('+')) return digits.startsWith(code) && digits.length >= 10 && digits.length <= 13 ? `+${digits}` : null;
  if (!/^0\d{8,10}$/.test(digits)) return null;
  return `+${code}${digits.slice(1)}`;
}
const halfKana = Array.from('。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜');
const halfChars = Array.from({ length: 63 }, (_, i) => String.fromCharCode(0xff61 + i));
export function formatKana(value: string, width: 'full' | 'half'): string {
  // Restrict normalization to kana; preserve unrelated text and never transliterate names.
  const full = value.replace(/[\uff61-\uff9f]+/g, run => run.normalize('NFKC'));
  if (width === 'full') return full;
  return Array.from(full).map(char => {
    if (!/[\u30a0-\u30ff]/.test(char)) return char;
    const decomposed = char.normalize('NFD');
    return Array.from(decomposed).map(c => c === '\u3099' ? 'ﾞ' : c === '\u309a' ? 'ﾟ' : halfChars[halfKana.indexOf(c)] || c).join('');
  }).join('');
}
/** Keep machine-readable literals exact. No artist/store dictionaries or guessed translations. */
export async function translatePublicText(text: string, translator: TranslatorInstance, current: () => boolean = () => true): Promise<string> {
  const literals = /((?:https?:\/\/|www\.)[^\s<>"'【】「」()（）]+|[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+|@?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>"'【】「」()（）]+)?|\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\b)/gi;
  const parts = text.split(literals), output: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!current()) throw new Error('translation superseded');
    const part = parts[i];
    if (i % 2 || !part.trim()) output.push(part);
    else output.push((part.match(/^\s*/)?.[0] || '') + await translator.translate(part.trim()) + (part.match(/\s*$/)?.[0] || ''));
  }
  return output.join('');
}
/* Generic, language-level markers only (no artist/store dictionaries). Used to order source quotes, never to create facts. */
const OVERSEAS_TEXT = /(?:海外|国外|国際|輸入|日本以外|外国|国[・/]地域|international|overseas|outside\s+japan|abroad|해외|국외)/i;
const CONDITION_TEXT = /(?:のみ|限り|限定|できません|できない|不可|保証外|必ず|未成年|親権者|税込|税抜|消費税|送料|配送料|手数料|関税|輸入税|返金|返品|キャンセル|自動継続|自動更新|有効期限|期限|only|must|cannot|not\s+available|tax|shipping|fee|duty|duties|refund|cancel|불가|필수|세금|배송비|수수료|관세|환불)/i;
/** Higher = shown earlier. Overseas/eligibility/cost conditions before navigation labels, headings and bare FAQ questions. */
export function evidencePriority(value: unknown): number {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = String(row.verbatim || row.text || '').trim();
  const topics = Array.isArray(row.topics) ? row.topics.map(String) : [String(row.category || '')];
  const condition = CONDITION_TEXT.test(text);
  let score = row.type === 'source_statement' ? 2 : row.type === 'heading' ? -3 : 0;
  if (OVERSEAS_TEXT.test(text)) score += 6;
  if (condition) score += 3;
  if (topics.includes('residence')) score += 4;
  if (topics.some(t => t === 'payment' || t === 'delivery' || t === 'address')) score += 1;
  const compact = text.replace(/\s/g, '');
  // Menu/heading-like labels (short, no sentence ending) rank below real statements unless they carry a condition.
  if (!condition && (compact.length < 12 || (compact.length < 20 && !/[。．.!！]/.test(text)))) score -= 4;
  if (/[?？]$/.test(text)) score -= 2;
  return score;
}
export const isOverseasText = (text: unknown) => OVERSEAS_TEXT.test(String(text || ''));

export interface OfferEdition { id?: string; label?: string; catalogNo?: string | null }
export interface OfferLink { kind: 'product' | 'listing' | 'home' | 'invalid'; edition: OfferEdition | null }
/** What a store link actually opens, judged only from the URL itself and the release's own catalog numbers. */
export function offerLinkInfo(url: unknown, editions: OfferEdition[] = []): OfferLink {
  const safe = assistanceUrl(url);
  if (!safe) return { kind: 'invalid', edition: null };
  const u = new URL(safe);
  const path = (u.pathname + u.search).toLowerCase().replace(/[-_]/g, '');
  const edition = editions.find(e => {
    const cat = String(e?.catalogNo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return cat.length >= 5 && new RegExp(`(^|[^a-z0-9])${cat}($|[^0-9])`).test(path);
  }) || null;
  if (edition) return { kind: 'product', edition };
  if (/^\/?$/.test(u.pathname) && !u.search) return { kind: 'home', edition: null };
  if (/\/(?:products?|goods|items?|iteminfo|dp|detail)(?:\/|\.|$)/i.test(u.pathname)) return { kind: 'product', edition: null };
  return { kind: 'listing', edition: null };
}

function sourceLink(url: unknown, label: string): string {
  const safe = assistanceUrl(url);
  return safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(label)}</a>` : '';
}
export function assistanceHtml(ctx: AssistanceContext): string {
  const l = (ko: string, ja: string) => localized(ko, ja);
  return `<section class="assistance" data-assistance aria-label="${l('가입·구매 도우미', '入会・購入サポート')}">
    <header class="assist-head"><h2>${l(ctx.kind === 'fanclub' ? '가입 조건, 원문부터 함께 읽어요' : '구매 조건, 원문부터 함께 읽어요', ctx.kind === 'fanclub' ? '入会条件を、原文から一緒に' : '購入条件を、原文から一緒に')}</h2><p>${[...new Set([ctx.artistName,ctx.title].filter(Boolean))].map(escape).join(' · ')}</p></header>
    <div class="assist-actions"><button type="button" class="assist-primary" data-a="collect">${l('현재 공개 원문 확인', '現在の公開原文を確認')}</button>${sourceLink(ctx.url, l('공식 원문 열기', '公式原文を開く'))}</div>
    <p class="assist-notice">${l('로그인 전 공개된 내용만 확인합니다. 로그인·본인 인증·결제는 공식 사이트에서 직접 진행하세요. 확인되지 않은 가입 자격이나 필수 항목은 추정하지 않습니다.', 'ログイン前の公開情報だけを確認します。ログイン・本人認証・決済は公式サイトで行ってください。未確認の入会資格や必須項目は推測しません。')}</p>
    <div class="assist-actions"><button type="button" data-a="activate" disabled>${l('기기 내 번역 시작', '端末内翻訳を開始')}</button><button type="button" data-a="cancel" disabled>${l('중지·내용 지우기', '停止・内容を消去')}</button><button type="button" data-a="translate-sources" disabled>${l('확인한 원문 번역', '確認した原文を翻訳')}</button></div>
    <p role="status" aria-live="polite" data-a="translation-status">${l('브라우저 지원 확인 중', 'ブラウザーの対応を確認中')}</p>
    <p class="assist-notice">${l('기계 번역은 배송 시점·금액·가입 자격·부정 표현을 잘못 옮길 수 있습니다. 번역문은 조건 확인 완료를 뜻하지 않습니다. 중요한 조건은 왼쪽 원문과 공식 안내를 대조하세요. URL·도메인·상품 번호는 원문 그대로 유지합니다.', '機械翻訳は配送時期・金額・入会資格・否定表現を誤訳する場合があります。翻訳文は条件の確認完了を意味しません。重要な条件は原文と公式案内を照合してください。URL・ドメイン・商品番号は原文のまま保持します。')}</p>

    <p data-a="fetch-status" role="status" aria-live="polite"></p><div data-a="sources" class="assist-sources"></div>
    <section class="assist-translate" aria-label="${l('기기 내 실시간 번역', '端末内リアルタイム翻訳')}"><div class="assist-section-head"><h3>${l('기기 내 실시간 번역', '端末内リアルタイム翻訳')}</h3><label>${l('번역 방향', '翻訳方向')}<select data-a="direction"><option value="ja" ${getLocale() === 'ko' ? 'selected' : ''}>日本語 → 한국어</option><option value="ko" ${getLocale() === 'ja' ? 'selected' : ''}>한국어 → 日本語</option></select></label></div>
    <p>${l('번역문은 기기에서 처리되며 라일락 서버나 클라우드 번역 서비스로 전송하지 않습니다. 첫 사용 시 브라우저 언어 모델 다운로드에 데이터가 사용될 수 있습니다. 번역은 참고용이며 원문이 우선입니다.', '翻訳する文章は端末内で処理され、Lilacのサーバーやクラウド翻訳サービスには送信されません。初回はブラウザーの言語モデル取得に通信が必要な場合があります。翻訳は参考であり、原文が優先されます。')}</p>
    <p class="assist-sensitive">${l('비밀번호·카드/계좌 정보·인증번호를 입력하지 마세요. 이름·주소 등 개인정보 대신 공개 안내문만 붙여 넣으세요. 내용은 저장하지 않으며 이 화면을 떠나면 지워집니다.', 'パスワード・カード/口座情報・認証コードを入力しないでください。氏名や住所などの個人情報ではなく、公開案内文だけを貼り付けてください。内容は保存せず、この画面を離れると消去されます。')}</p>
    <div class="assist-parallel"><label>${l('원문', '原文')}<textarea data-a="input" maxlength="4000" autocomplete="off" spellcheck="false" placeholder="${l('공개 안내문을 붙여 넣으세요', '公開案内文を貼り付けてください')}"></textarea></label><div><span>${l('번역문', '翻訳文')}</span><p data-a="output" class="assist-output" role="status" aria-live="polite"></p><button type="button" data-a="copy" disabled>${l('번역문 복사', '翻訳文をコピー')}</button></div></div>
    <p class="assist-secondary">${sourceLink('https://translate.google.com/', l('별도 서비스: Google 번역 열기', '別サービス：Google翻訳を開く'))} · ${l('직접 입력 시 해당 서비스의 개인정보 정책이 적용됩니다. 이 화면의 글은 전달하지 않습니다.', '直接入力すると同サービスのプライバシーポリシーが適用されます。この画面の文章は渡しません。')}</p></section>
    <details class="assist-tools"><summary>${l('입력 형식 도구 · 기기에서만 처리', '入力形式ツール・端末内で処理')}</summary><p>${l('자동 입력이나 자격 확인 기능이 아닙니다. 본인 정보를 입력할 필요는 없습니다. 공식 입력 조건과 결과를 대조하세요.', '自動入力や資格確認ではありません。個人情報の入力は不要です。公式の入力条件と照合してください。')}</p><label>${l('형식', '形式')}<select data-a="format"><option value="KR">${l('한국 전화번호 → +82', '韓国の電話番号 → +82')}</option><option value="JP">${l('일본 전화번호 → +81', '日本の電話番号 → +81')}</option><option value="full">${l('가타카나 전각', 'カタカナ全角')}</option><option value="half">${l('가타카나 반각', 'カタカナ半角')}</option></select></label><label>${l('변환할 텍스트', '変換するテキスト')}<input data-a="format-input" type="text" maxlength="120" autocomplete="off" spellcheck="false"></label><button type="button" data-a="format-run">${l('형식 변환', '形式を変換')}</button><output data-a="format-output"></output><button type="button" data-a="format-copy" disabled>${l('결과 복사', '結果をコピー')}</button></details>
  </section>`;
}

/** Public collector reason codes are never exposed as technical UI text. */
export function assistanceIssueText(value: unknown): string {
  const l = (ko: string, ja: string) => localized(ko, ja);
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const code = String(row.code || row.reason || (typeof value === 'string' ? value : ''));
  const topics: Record<string, [string, string]> = {
    email:['이메일','メールアドレス'],phone:['전화번호','電話番号'],phoneticName:['이름의 가나 표기','氏名のフリガナ'],postalCode:['우편번호','郵便番号'],residence:['거주 국가·지역','居住国・地域'],address:['주소','住所'],name:['이름','氏名'],birthDate:['생년월일','生年月日'],payment:['결제','支払い'],delivery:['배송·수령','配送・受取'],signup:['가입','入会・登録'],
  };
  if (code === 'not_observed_in_fetched_public_pages') {
    const topic = topics[String(row.topic)];
    return topic ? l(topic[0] + ' 조건은 확인한 공개 원문에서 찾지 못했습니다.',topic[1] + 'の条件は確認した公開原文では見つかりませんでした。') : l('이 조건은 공개 원문에서 확인되지 않았습니다.','この条件は公開原文では確認できませんでした。');
  }
  if (code === 'public_evidence_is_not_account_or_residence_eligibility_confirmation') return l('공개 안내만으로 계정·거주 국가에 따른 가입 자격과 실제 필수 조건을 확정할 수 없습니다.','公開案内だけではアカウント・居住国による入会資格や実際の必須条件を確定できません。');
  if (code === 'timeout') return l('원문 응답 시간이 길어 일부 페이지 확인을 마치지 못했습니다.','原文の応答に時間がかかり、一部の確認を完了できませんでした。');
  if (/^upstream_http_(?:401|403|429)$/.test(code)) return l('원문 사이트에서 접근을 허용하지 않아 내용을 확인하지 못했습니다. 공식 사이트에서 직접 확인하세요.','原文サイトがアクセスを許可せず、内容を確認できませんでした。公式サイトで直接確認してください。');
  if (typeof value === 'string' && !/^[a-z0-9_]+$/.test(value)) return value;
  return l('원문 일부를 안전하게 확인하지 못했습니다. 표시된 내용 외의 조건은 공식 사이트에서 확인하세요.','原文の一部を安全に確認できませんでした。表示されていない条件は公式サイトで確認してください。');
}
/** Only source-backed snippets/labels are rendered; a field hint is not a site requirement. */
export function assistanceSourcesHtml(payload: unknown): string {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const l = (ko: string, ja: string) => localized(ko, ja);
  const rootUrl = assistanceUrl(data.sourceUrl || data.url);
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'ko-KR', { timeZone: 'Asia/Seoul' }) : l('확인 시각 미제공', '確認時刻の提供なし');
  const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 40) : [];
  const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
  let index = 0;
  const quote = (text: string) => `<div class="assist-parallel"><blockquote data-source-text="${index}">${escape(text)}</blockquote><p data-source-translation="${index++}" class="assist-source-translation">${l('번역을 시작하면 이곳에 표시됩니다.', '翻訳を開始するとここに表示されます。')}</p></div>`;
  const provenance = (row: Record<string, unknown>) => `<small>${sourceLink(row.sourceUrl || rootUrl, l('이 내용의 출처', 'この内容の出典'))} · ${escape(date(row.fetchedAt || data.fetchedAt))}${typeof row.location === 'string' ? ` · ${escape(row.location)}` : ''}</small>`;
  const topicNames:Record<string,[string,string]>={signup:['가입·회원등록','入会・会員登録'],email:['메일·인증 절차','メール・認証の手順'],phone:['전화·문자 인증','電話・SMS認証'],residence:['거주 국가·지역','居住国・地域'],address:['주소·배송지','住所・配送先'],payment:['결제 안내','支払いの案内'],delivery:['배송·수령','配送・受取'],name:['이름 입력','氏名の入力'],birthDate:['생년월일','生年月日']};
  const status = String(data.status || '');
  const readSources = list(data.sources).length;
  if (status === 'unavailable' || (!readSources && !list(data.evidence).length && !list(data.fields).length)) {
    // Nothing was read: unknown topics are "not checked", never "not found in the source".
    const topicsNotRead = [...new Set(list(data.unknowns).map(record).map(row => topicNames[String(row.topic)] || null).filter(Boolean).map(x => l(x![0], x![1])))];
    const reasons = [...new Set(list(data.warnings).map(v => record(v).code === 'unsafe_destination' ? l('연결된 주소가 바로 읽을 수 있는 공개 원문 주소로 확인되지 않아(다른 사이트로 넘기는 주소 등) 읽지 않았습니다.', 'リンク先が直接読める公開原文のアドレスと確認できず（別サイトへ転送するアドレスなど）、読み取りませんでした。') : assistanceIssueText(v)))];
    return `<div class="assist-source-meta" data-assist-unread><strong>${l('공식 원문을 읽지 못했습니다', '公式原文を読み取れませんでした')}</strong><p>${l('시도 시각', '試行時刻')}: ${escape(date(data.fetchedAt))}${rootUrl ? ` · ${sourceLink(rootUrl, l('공식 원문 직접 열기', '公式原文を直接開く'))}` : ''}</p></div><aside class="assist-notice"><h4>${l('가입·구매 조건은 모두 미확인입니다', '入会・購入条件はすべて未確認です')}</h4>${reasons.length ? `<ul>${reasons.map(r => `<li>${escape(r)}</li>`).join('')}</ul>` : ''}<p>${l('Lilac이 원문을 읽지 못한 것이며, 조건이 없다는 뜻이 아닙니다. 거주 국가 제한·결제 수단·배송·세금은 공식 원문에서 직접 확인하세요.', 'Lilacが原文を読めなかっただけで、条件がないという意味ではありません。居住国の制限・支払い・配送・税は公式原文で直接確認してください。')}</p>${topicsNotRead.length ? `<p>${l('확인하지 못한 항목', '未確認の項目')}: ${topicsNotRead.map(escape).join(' · ')}</p>` : ''}</aside>`;
  }
  const sourceRows=(Array.isArray(data.evidence)?data.evidence.slice(0,200):[]).map(record).filter(row=>assistanceUrl(row.sourceUrl||rootUrl)&&typeof(row.verbatim||row.text)==='string');
  const seenText=new Set<string>();
  const ranked=sourceRows.filter(row=>{const text=String(row.verbatim||row.text);if(seenText.has(text))return false;seenText.add(text);return true;}).map((row,i)=>({row,i,score:evidencePriority(row)})).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.row);
  const evidenceRows=ranked.map(row=>{const text=String(row.verbatim||row.text);const topic=Array.isArray(row.topics)?String(row.topics[0]):String(row.category||'');const labels=topicNames[topic];return `<article${isOverseasText(text)?' data-overseas':''}><h4>${escape(labels?l(labels[0],labels[1]):l('확인한 원문','確認した原文'))}${isOverseasText(text)?`<span class="assist-flag">${l('해외 이용 관련 문장','海外利用に関する記載')}</span>`:''}</h4>${quote(text)}${provenance(row)}</article>`;});
  const SHOWN=8;
  const evidence=evidenceRows.slice(0,SHOWN).join('')+(evidenceRows.length>SHOWN?`<details class="assist-more"><summary>${l('원문 근거 더 보기','原文の根拠をさらに表示')} (${evidenceRows.length-SHOWN})</summary>${evidenceRows.slice(SHOWN).join('')}</details>`:'');
  const fields = list(data.fields).map(record).filter(row => typeof row.label === 'string' && assistanceUrl(row.sourceUrl || rootUrl)).map(row => `<article class="assist-field"><div class="assist-field-title"><strong>${escape(row.label)}</strong><span>${row.required === true ? l('원문상 필수', '原文で必須') : row.required === false ? l('원문상 선택', '原文で任意') : l('필수 여부 미확인', '必須かは未確認')}</span></div>${quote(String(row.verbatim || row.label))}<p class="assist-hint">${escape(fieldHint(String(row.label)))}</p>${row.type ? `<small>${l('확인한 입력 유형', '確認した入力形式')}: ${escape(row.type)}</small>` : ''}${Array.isArray(row.options || row.choices) && ((row.options || row.choices) as unknown[]).length ? `<p>${l('원문 선택지', '原文の選択肢')}: ${((row.options || row.choices) as unknown[]).filter(v => typeof v === 'string').map(escape).join(' / ')}</p>` : ''}${provenance(row)}</article>`).join('');
  const unknowns = [...list(data.unknowns), ...list(data.warnings)].map(v => `<li>${escape(assistanceIssueText(v))}</li>`).join('');
  const seenImages = new Set<string>();
  const images = list(data.images).map(value => typeof value === 'string' ? { url: value } : record(value)).filter(row => {
    const url = assistanceUrl(row.url); if (!url || !assistanceUrl(row.sourceUrl || rootUrl) || seenImages.has(url)) return false;
    seenImages.add(url); return true;
  }).slice(0, 12).map(row => {
    const kind = String(row.kind || '');
    const label = kind === 'jsonld' ? l('구조화 데이터(JSON-LD)에 등록된 이미지', '構造化データ（JSON-LD）に登録された画像') : kind === 'meta' ? l('페이지 대표 이미지（OG / Twitter）', 'ページの代表画像（OG / Twitter）') : kind === 'img' ? l('공개 페이지 본문의 이미지', '公開ページ本文の画像') : l('공개 원문에서 발견한 이미지', '公開原文で見つかった画像');
    return `<figure class="assist-image"><img data-assistance-image src="${escape(assistanceUrl(row.url))}" alt="${escape(typeof row.alt === 'string' && row.alt ? row.alt : l('공개 원문 이미지', '公開原文の画像'))}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><p data-assistance-image-error hidden>${l('이미지를 표시하지 못했습니다. 출처에서 직접 확인하세요.', '画像を表示できませんでした。出典で直接確認してください。')}</p><figcaption>${escape(label)}<small>${l('상품 사진인지·사용 권한은 미확인', '商品写真かどうか・利用権限は未確認')}</small>${provenance(row)}</figcaption></figure>`;
  }).join('');
  const links = [...list(data.links), ...list(data.guides)].map(record).map(row => sourceLink(row.url || row.sourceUrl, String(row.label || row.title || l('관련 원문', '関連する原文')))).filter(Boolean).join(' · ');
  return `<div class="assist-source-meta"><strong>${escape(typeof data.title === 'string' ? data.title : '')}</strong><p>${l('원문 확인 시각', '原文確認時刻')}: ${escape(date(data.fetchedAt))} · ${sourceLink(rootUrl, l('원문 보기', '原文を見る'))}</p></div><section class="assist-image-section"><h3>${l('원문에서 확인한 이미지', '原文で確認した画像')}</h3>${images ? `<div class="assist-image-gallery">${images}</div>` : `<p>${l('공개 원문에서 표시할 이미지를 찾지 못했습니다.', '公開原文で表示できる画像が見つかりませんでした。')}</p>`}</section><h3>${l('확인한 조건과 안내', '確認した条件と案内')}</h3>${evidence || `<p>${l('공개 원문에서 조건을 확인하지 못했습니다. 조건이 없다는 뜻은 아닙니다. 로그인 뒤에만 있는 내용은 공식 사이트에서 확인하세요.', '公開原文から条件を確認できませんでした。条件がないという意味ではありません。ログイン後の情報は公式サイトで確認してください。')}</p>`}<h3>${l('실제로 발견한 입력 항목', '実際に見つかった入力項目')}</h3><p class="assist-notice">${l('항목 해설은 일반적인 의미 안내이며 사이트의 입력 조건을 대신하지 않습니다.', '項目の説明は一般的な意味の案内であり、サイトの入力条件を代替しません。')}</p>${fields || `<p>${l('공개 페이지에서 입력 항목을 확인하지 못했습니다. 필수 항목·해외 가입 또는 배송 가능 여부는 미확인입니다.', '公開ページで入力項目を確認できませんでした。必須項目・海外入会や配送の可否は未確認です。')}</p>`}${unknowns ? `<aside class="assist-notice"><h4>${l('아직 확인이 필요한 내용', 'まだ確認が必要な情報')}</h4><ul>${unknowns}</ul></aside>` : ''}${links ? `<nav aria-label="${l('참고 원문', '参考原文')}">${links}</nav>` : ''}`;
}

export function mountAssistance(root: HTMLElement, ctx: AssistanceContext, options: { alive?: () => boolean; signal?: AbortSignal } = {}): () => void {
  const host = root.matches('[data-assistance]') ? root : root.querySelector<HTMLElement>('[data-assistance]');
  if (!host) return () => {};
  const el = <T extends HTMLElement = HTMLElement>(key: string) => host.querySelector<T>(`[data-a="${key}"]`)!;
  const l = (ko: string, ja: string) => localized(ko, ja);
  let dead = false, session = 0, revision = 0, fetching = 0, availabilityRevision = 0;
  let instance: TranslatorInstance | null = null, modelAbort: AbortController | null = null, requestAbort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let availability = 'checking';
  const listeners: [HTMLElement, string, EventListener][] = [];
  const active = () => !dead && !options.signal?.aborted && (options.alive?.() ?? true);
  const status = (text: string) => { if (active()) el('translation-status').textContent = text; };
  const on = (key: string, event: string, fn: () => void) => { const node = el(key); node.addEventListener(event, fn); listeners.push([node, event, fn]); };
  const disable = (key: string, disabled: boolean) => { (el(key) as HTMLButtonElement).disabled = disabled; };
  const clearOutput = () => { el('output').textContent = ''; disable('copy', true); };
  const stop = (clear = false) => {
    session++; revision++; clearTimeout(timer); modelAbort?.abort(); modelAbort = null;
    try { instance?.destroy(); } catch { /* An aborted translator can already be destroyed. */ }
    instance = null; disable('cancel', true); disable('translate-sources', true); clearOutput();
    if (clear) { el<HTMLTextAreaElement>('input').value = ''; el<HTMLInputElement>('format-input').value = ''; el('format-output').textContent = ''; disable('format-copy', true); }
    host.querySelectorAll<HTMLElement>('[data-source-translation]').forEach(node => { node.textContent = l('번역 대기', '翻訳待ち'); });
  };
  const pair = () => { const sourceLanguage = el<HTMLSelectElement>('direction').value as Lang; return { sourceLanguage, targetLanguage: (sourceLanguage === 'ja' ? 'ko' : 'ja') as Lang }; };
  const factory = () => (globalThis as unknown as { Translator?: TranslatorFactory }).Translator;
  async function checkAvailability() {
    const rev = ++availabilityRevision; availability = 'checking'; disable('activate', true);
    if (!factory()) { availability = 'unavailable'; status(l('이 브라우저에서는 기기 내 번역을 지원하지 않습니다. 원문 확인과 형식 도구는 계속 사용할 수 있습니다.', 'このブラウザーは端末内翻訳に対応していません。原文確認と形式ツールは利用できます。')); return; }
    try {
      const state = await factory()!.availability(pair());
      if (!active() || rev !== availabilityRevision) return;
      availability = state; disable('activate', state === 'unavailable');
      status(state === 'available' ? l('번역 준비 완료. 시작 버튼을 누르세요.', '翻訳の準備ができました。開始ボタンを押してください。') : state === 'unavailable' ? l('이 언어 조합은 기기 내 번역을 지원하지 않습니다.', 'この言語の組み合わせは端末内翻訳に対応していません。') : l('시작 버튼을 누르면 언어 모델을 다운로드합니다. 다운로드 중 취소할 수 있습니다.', '開始ボタンを押すと言語モデルを取得します。取得中にキャンセルできます。'));
    } catch { if (active() && rev === availabilityRevision) { availability = 'error'; disable('activate', false); status(l('지원 여부 확인에 실패했습니다. 시작 버튼으로 다시 시도하세요.', '対応状況を確認できませんでした。開始ボタンから再試行してください。')); } }
  }
  async function translateInput() {
    const translator = instance, gen = session, rev = revision;
    const text = el<HTMLTextAreaElement>('input').value.trim();
    if (!translator || !active()) return;
    if (!text) { clearOutput(); return; }
    const source=pair().sourceLanguage;
    if ((source==='ko' && /[ぁ-ヿ]/.test(text) && !/[가-힣]/.test(text)) || (source==='ja' && /[가-힣]/.test(text) && !/[ぁ-ヿ一-龯]/.test(text))) {
      clearOutput();status(l('선택한 원문 언어와 문장이 다릅니다. 번역 방향을 확인하세요.','選択した原文の言語と文章が異なります。翻訳方向を確認してください。'));return;
    }
    status(l('기기에서 번역 중', '端末内で翻訳中'));
    try {
      const translated = await translatePublicText(text, translator, () => active() && session === gen && revision === rev && instance === translator);
      if (!active() || session !== gen || revision !== rev || instance !== translator) return;
      el('output').textContent = translated; el('output').lang = pair().targetLanguage; disable('copy', !translated);
      status(l('번역 완료 · 원문과 대조하세요.', '翻訳完了・原文と照合してください。'));
    } catch { if (active() && session === gen && revision === rev) status(l('번역에 실패했습니다. 내용을 줄이거나 번역을 다시 시작하세요.', '翻訳できませんでした。文章を短くするか翻訳を再開してください。')); }
  }
  async function translateSources() {
    const translator = instance, gen = session, fetchGen = fetching;
    if (!translator) return;
    disable('translate-sources', true);
    try {
      const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-source-text]')).slice(0, 80);
      let completed = 0;
      for (const node of nodes) {
        if (!active() || gen !== session || fetchGen !== fetching) return;
        const id = node.dataset.sourceText;
        status(l(`기기에서 원문 번역 중 · ${completed}/${nodes.length}`, `端末内で原文を翻訳中・${completed}/${nodes.length}`));
        const result = await translatePublicText(node.textContent || '', translator, () => active() && gen === session && fetchGen === fetching && instance === translator);
        if (!active() || gen !== session || fetchGen !== fetching || instance !== translator) return;
        const target = host.querySelector<HTMLElement>(`[data-source-translation="${id}"]`);
        if (target) { target.textContent = result; target.lang = pair().targetLanguage; }
        completed++;
      }
      if (active() && gen === session && fetchGen === fetching) status(l('기계 번역 완료 · 중요 조건은 반드시 원문과 대조하세요.', '機械翻訳完了・重要な条件は必ず原文と照合してください。'));
    } catch { if (active() && gen === session) status(l('원문 번역 일부를 완료하지 못했습니다. 다시 시도할 수 있습니다.', '原文の一部を翻訳できませんでした。再試行できます。')); }
    finally { if (active() && gen === session && instance) disable('translate-sources', false); }
  }
  on('activate', 'click', () => {
    if (!active() || availability === 'unavailable' || availability === 'checking') return;
    stop(); const gen = session; modelAbort = new AbortController();
    disable('activate', true); disable('cancel', false); status(l('번역기 준비 중', '翻訳を準備中'));
    // create is called synchronously inside this click, before any await: activation is required.
    let pending: Promise<TranslatorInstance>;
    try { pending = factory()!.create({ ...pair(), signal: modelAbort.signal, monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => {
        if (!active() || gen !== session) return;
        const fraction = event.total && event.total > 0 ? event.loaded / event.total : event.loaded;
        const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
        status(l(`언어 모델 다운로드 ${percent}% · 중지 버튼으로 취소`, `言語モデル取得 ${percent}%・停止ボタンでキャンセル`));
      });
    } }); } catch { pending = Promise.reject(new Error('create failed')); }
    void pending.then(translator => {
      if (!active() || gen !== session) { translator.destroy(); return; }
      instance = translator; disable('translate-sources', false);
      status(l('실시간 번역 켜짐 · 입력하면 자동 번역합니다.', 'リアルタイム翻訳オン・入力すると自動翻訳します。'));
      void translateInput();
    }).catch(() => {
      if (!active() || gen !== session) return;
      disable('activate', false); disable('cancel', true);
      status(l('번역기를 시작하지 못했습니다. 다운로드·브라우저 권한을 확인한 뒤 시작 버튼으로 다시 시도하세요.', '翻訳を開始できませんでした。ダウンロードとブラウザーの権限を確認し、開始ボタンで再試行してください。'));
    });
  });
  on('cancel', 'click', () => { stop(true); void checkAvailability(); });
  on('direction', 'change', () => { stop(true); void checkAvailability(); });
  on('input', 'input', () => { revision++; clearTimeout(timer); clearOutput(); if (instance) timer = setTimeout(() => { void translateInput(); }, 300); });
  on('translate-sources', 'click', () => { void translateSources(); });
  async function copy(key: string) {
    const text = el(key).textContent || '';
    if (!text || !active()) return;
    try { await navigator.clipboard.writeText(text); status(l('복사했습니다.', 'コピーしました。')); }
    catch { status(l('복사 권한이 없습니다. 결과를 선택해서 직접 복사하세요.', 'コピー権限がありません。結果を選択してコピーしてください。')); }
  }
  on('copy', 'click', () => { void copy('output'); });
  on('format-copy', 'click', () => { void copy('format-output'); });
  const invalidateFormat = () => { el('format-output').textContent = ''; disable('format-copy', true); };
  on('format-input', 'input', invalidateFormat); on('format', 'change', invalidateFormat);
  on('format-run', 'click', () => {
    const mode = el<HTMLSelectElement>('format').value;
    const value = el<HTMLInputElement>('format-input').value;
    const result = mode === 'KR' || mode === 'JP' ? normalizePhone(value, mode) : formatKana(value, mode === 'full' ? 'full' : 'half');
    el('format-output').textContent = result ?? l('번호 형식을 확인하세요. 국가번호가 다르거나 형식을 판단할 수 없습니다.', '番号の形式を確認してください。国番号が異なるか、形式を判定できません。');
    disable('format-copy', !result);
  });
  on('collect', 'click', () => {
    if (!active()) return;
    const gen = ++fetching; requestAbort?.abort(); requestAbort = new AbortController();
    const controller = requestAbort;
    const timeout = setTimeout(() => controller.abort(), 25000);
    disable('collect', true); el('fetch-status').textContent = l('현재 공개 원문을 확인하고 있습니다.', '現在の公開原文を確認しています。');
    void fetch(assistanceEndpoint(ctx), { signal: controller.signal, credentials: 'omit', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('source unavailable');
      const result = await response.json();
      if (!active() || gen !== fetching) return;
      el('sources').innerHTML = assistanceSourcesHtml(result);
      host.querySelectorAll<HTMLImageElement>('[data-assistance-image]').forEach(image => {
        const failed = () => {
          if (!active() || gen !== fetching) return;
          image.hidden = true;
          const notice = image.parentElement?.querySelector<HTMLElement>('[data-assistance-image-error]');
          if (notice) notice.hidden = false;
        };
        image.addEventListener('error', failed); listeners.push([image, 'error', failed]);
        if (image.complete && !image.naturalWidth) failed();
      });
      const readNothing = result?.status === 'unavailable' || !(Array.isArray(result?.sources) && result.sources.length);
      el('fetch-status').textContent = readNothing
        ? l('공식 원문을 읽지 못했습니다. 가입·구매 조건은 미확인입니다. 공식 원문에서 직접 확인하세요.', '公式原文を読み取れませんでした。入会・購入条件は未確認です。公式原文で直接確認してください。')
        : result?.status === 'partial'
          ? l('일부 원문만 읽었습니다. 표시된 내용 외의 조건은 미확인입니다. 신청·결제 직전에 공식 원문을 다시 확인하세요.', '一部の原文だけを読み取りました。表示外の条件は未確認です。申込み・決済の直前に公式原文を再確認してください。')
          : l('확인한 공개 내용만 표시했습니다. 해외 이용·비용 조건을 먼저 보여 줍니다. 실제 신청·결제 직전에 공식 원문을 다시 확인하세요.', '確認できた公開情報だけを表示しています。海外利用・費用の条件を先に表示します。申込み・決済の直前に公式原文を再確認してください。');
    }).catch(() => { if (active() && gen === fetching) el('fetch-status').textContent = l('공개 원문을 가져오지 못했습니다. 가입·구매 조건은 미확인입니다. 공식 원문에서 확인하거나 다시 시도하세요.', '公開原文を取得できませんでした。入会・購入条件は未確認です。公式原文を確認するか再試行してください。'); })
      .finally(() => { clearTimeout(timeout); if (active() && gen === fetching) disable('collect', false); });
  });
  let removalObserver:MutationObserver|null=null;
  const cleanup = () => {
    if (dead) return;
    stop(true); dead = true; availabilityRevision++; fetching++; requestAbort?.abort();
    removalObserver?.disconnect();
    listeners.forEach(([node, event, fn]) => node.removeEventListener(event, fn));
    options.signal?.removeEventListener('abort', cleanup);
  };
  options.signal?.addEventListener('abort', cleanup, { once: true });
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
    let mounted=host.isConnected;
    removalObserver=new MutationObserver(()=>{if(host.isConnected)mounted=true;else if(mounted||!(options.alive?.()??true))cleanup();});
    removalObserver.observe(document.body,{childList:true,subtree:true});
  }
  if (options.signal?.aborted) cleanup(); else void checkAvailability();
  return cleanup;
}
