/** Deployment capability, never an authorization boundary. The server enforces the allowlist. */
export let publicPreview = false;
/** Discover capabilities before the app client may inspect saved identity.
 * Browser-managed same-origin cookies still reach the deployment gateway. */
export async function probeDeploymentHealth(): Promise<{ readOnly?: boolean } | null> {
  const response = await fetch('/api/health', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
let originalDisclosure: { element: Element; text: string | null } | null = null;
export const PREVIEW_NOTICE = '읽기 전용 미리보기에서는 계정 저장·주문·접수 기능을 사용할 수 없습니다.';
export function configurePublicPreview(health: { readOnly?: boolean } | null) {
  publicPreview = health?.readOnly === true;
  document.body.toggleAttribute('data-public-preview', publicPreview);
  const disclosure = document.querySelector('.footer-disclosure');
  if (publicPreview && disclosure) {
    if (originalDisclosure?.element !== disclosure) originalDisclosure = { element: disclosure, text: disclosure.textContent };
    disclosure.textContent = '읽기 전용 미리보기 · 검색·차트·카탈로그 30초 미리듣기를 제공합니다. 계정 저장·주문·결제·문의 접수·자동 수집은 연결되어 있지 않습니다. 차트는 표시된 수집 시점의 스냅샷입니다.';
  } else if (disclosure && originalDisclosure?.element === disclosure) {
    disclosure.textContent = originalDisclosure.text; originalDisclosure = null;
  }
}
export function previewBlocksRequest(path: string, method = 'GET') {
  if (!publicPreview) return false;
  const verb=method.toUpperCase();
  return !['GET','HEAD'].includes(verb) && !(verb==='POST' && path.split('?')[0]==='/api/catalog/batch');
}
export function previewAccountPage(seg: string) {
  return publicPreview && ['login','signup','account','orders','library','playlist'].includes(seg);
}
export function previewNoticeHtml() {
  return `<section class="empty-state" style="padding:72px 24px;max-width:720px;margin:auto"><h1>읽기 전용 미리보기</h1><p style="margin:24px 0;line-height:1.8">음악 검색과 차트, 카탈로그 미리듣기를 둘러볼 수 있습니다.<br>계정·보관함 저장·주문은 연결되어 있지 않습니다.</p><a class="btn-pill" href="#/">음악 둘러보기</a></section>`;
}
