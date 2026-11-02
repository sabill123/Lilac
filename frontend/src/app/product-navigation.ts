/** Product navigation: native modal owns focus containment; the controller owns its lifecycle. */
export type ProductDestination = { r: string; href: string; label: string };
export function productNavigationHtml(destinations: ProductDestination[], ja = false) {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return `<button class="product-menu-toggle" id="productMenuToggle" type="button" aria-haspopup="dialog" aria-controls="productMenu" aria-expanded="false"><span class="product-menu-icon" aria-hidden="true"><i></i><i></i></span><span>${ja ? 'メニュー' : '메뉴'}</span></button>
    <dialog class="product-menu" id="productMenu" aria-labelledby="productMenuTitle"><div class="product-menu-head"><h2 id="productMenuTitle">${ja ? 'すべてのメニュー' : '전체 메뉴'}</h2><button type="button" data-menu-close autofocus>${ja ? '閉じる' : '닫기'} <svg class="ic sm" aria-hidden="true"><use href="#i-close"/></svg></button></div>
    <form class="product-menu-search" role="search"><label for="menuQuery">${ja ? 'アーティスト・公演を検索' : '아티스트·공연 검색'}</label><div><input id="menuQuery" name="q" type="search" maxlength="160" autocomplete="off"><button type="submit">${ja ? '検索' : '검색'}</button></div></form>
    <nav class="product-menu-links" aria-label="${ja ? 'すべてのメニュー' : '전체 메뉴'}">${destinations.map((n, i) => `<a href="${esc(n.href)}" data-r="${esc(n.r)}" style="--menu-delay:${Math.min(i * 24, 96)}ms">${esc(n.label)}<svg class="ic sm" aria-hidden="true"><use href="#i-chev-r"/></svg></a>`).join('')}</nav></dialog>`;
}
export function mountProductNavigation(root: HTMLElement) {
  const toggle = root.querySelector<HTMLButtonElement>('#productMenuToggle');
  const dialog = root.querySelector<HTMLDialogElement>('#productMenu');
  if (!toggle || !dialog) return () => {};
  const body = root.ownerDocument.body;
  let oldOverflow = '', oldPadding = '', locked = false, disposed = false;
  const unlock = () => {
    if (!locked) return;
    body.style.overflow = oldOverflow;
    body.style.paddingRight = oldPadding;
    locked = false;
  };
  const close = (restoreFocus = true) => {
    if (dialog.open) dialog.close();
    unlock();
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && toggle.isConnected) toggle.focus();
  };
  const open = () => {
    if (disposed || dialog.open) return;
    oldOverflow = body.style.overflow;
    oldPadding = body.style.paddingRight;
    const scrollbar = Math.max(0, window.innerWidth - root.ownerDocument.documentElement.clientWidth);
    if (scrollbar) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
    body.style.overflow = 'hidden';
    locked = true;
    try { dialog.showModal(); toggle.setAttribute('aria-expanded', 'true'); }
    catch (error) { unlock(); throw error; }
  };
  const onToggle = () => dialog.open ? close() : open();
  const onCancel = (e: Event) => { e.preventDefault(); close(); };
  const onClose = () => { unlock(); toggle.setAttribute('aria-expanded', 'false'); };
  const onClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-menu-close], a[href]')) close();
  };
  const form = dialog.querySelector<HTMLFormElement>('form');
  const onSubmit = (e: Event) => {
    e.preventDefault();
    const q = dialog.querySelector<HTMLInputElement>('input')!.value.trim();
    close();
    location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
  };
  // Keep the end of the menu in the dialog instead of tabbing into browser chrome.
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog.open) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(el => !el.hidden && el.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1], active = root.ownerDocument.activeElement;
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  const onRoute = () => close();
  toggle.addEventListener('click', onToggle);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('keydown', onKeydown);
  form?.addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', onRoute);
  return () => {
    disposed = true;
    close(false);
    toggle.removeEventListener('click', onToggle);
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', onClose);
    dialog.removeEventListener('click', onClick);
    dialog.removeEventListener('keydown', onKeydown);
    form?.removeEventListener('submit', onSubmit);
    window.removeEventListener('hashchange', onRoute);
  };
}
