import { EVENT_ORDER, findEdition, panelHtml, sectionHtml } from './view';
// Ephemeral UI state only. No storage, history, document/window listeners or audio.
let selected = 'mama-2025';
const opened = new Set<string>();
const mounts = new WeakMap<HTMLElement, () => void>();
export function homeAwardsHtml(): string { return sectionHtml(selected, opened); }
export function mountHomeAwards(root: HTMLElement, signal: AbortSignal): void {
  if (signal.aborted) return;
  const section = root.id === 'homeAwards' ? root : root.querySelector<HTMLElement>('#homeAwards');
  if (!section) return;
  mounts.get(section)?.();
  const stage = section.querySelector<HTMLElement>('[data-ha-stage]');
  if (!stage) return;
  const tabs = Array.from(section.querySelectorAll<HTMLElement>('[data-ha-tab]'));
  const remember = () => {for (const d of Array.from(stage.querySelectorAll<HTMLDetailsElement>('[data-ha-detail]'))) {const key=selected+':'+d.dataset.haDetail; if(d.open)opened.add(key);else opened.delete(key);}};
  const failImage = (image: HTMLImageElement) => { image.hidden = true; const fallback=image.nextElementSibling as HTMLElement|null; if(fallback)fallback.hidden=false; image.parentElement?.classList.add('ha-image-failed'); };
  const checkImages = () => {for(const image of Array.from(stage.querySelectorAll<HTMLImageElement>('img')))if(image.complete && image.naturalWidth===0)failImage(image);};
  const choose = (id: string, focus: boolean) => {if(!EVENT_ORDER.includes(id))return;remember();selected=id;stage.innerHTML=EVENT_ORDER.map(other=>other===id?panelHtml(findEdition(id),opened):`<div id="ha-panel-${other}" role="tabpanel" aria-labelledby="ha-tab-${other}" hidden></div>`).join('');for(const tab of tabs){const active=tab.dataset.haTab===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus){tab.focus({preventScroll:true});const strip=tab.parentElement;if(strip){const left=tab.offsetLeft-strip.offsetLeft; if(left<strip.scrollLeft)strip.scrollLeft=left;else if(left+tab.offsetWidth>strip.scrollLeft+strip.clientWidth)strip.scrollLeft=left+tab.offsetWidth-strip.clientWidth;}}}checkImages();};
  const targetTab = (event: Event) => {const target=event.target as HTMLElement|null;return target?.closest<HTMLElement>('[data-ha-tab]');};
  const click = (event: Event) => {const tab=targetTab(event);if(tab&&section.contains(tab))choose(tab.dataset.haTab!,false);};
  const key = (event: Event) => {const k=event as KeyboardEvent;const tab=targetTab(event);if(!tab)return;const i=EVENT_ORDER.indexOf(tab.dataset.haTab!);let next:number;if(k.key==='ArrowRight')next=(i+1)%tabs.length;else if(k.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(k.key==='Home')next=0;else if(k.key==='End')next=tabs.length-1;else return;k.preventDefault();choose(EVENT_ORDER[next],true);};
  const error = (event: Event) => {const image=event.target as HTMLImageElement|null;if(image?.tagName==='IMG')failImage(image);};
  const toggle = () => remember();
  section.addEventListener('click',click);section.addEventListener('keydown',key);section.addEventListener('toggle',toggle,true);section.addEventListener('error',error,true);
  const cleanup=()=>{remember();section.removeEventListener('click',click);section.removeEventListener('keydown',key);section.removeEventListener('toggle',toggle,true);section.removeEventListener('error',error,true);signal.removeEventListener('abort',cleanup);mounts.delete(section);};
  mounts.set(section,cleanup);signal.addEventListener('abort',cleanup,{once:true});checkImages();
}
