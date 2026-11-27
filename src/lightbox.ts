// A photo full screen, with its credit, and the others of the set one arrow key away. A native modal <dialog>:
// Escape closes it, focus stays inside, the page behind is inert.
import { h } from './dom';
import { t } from './i18n';

export interface Shot { src: string[]; credit: string; href?: string; alt: string }

let dlg: HTMLDialogElement | null = null;

export function openLightbox(shots: Shot[], start = 0) {
  if (!shots.length) return;
  dlg?.remove();
  let i = Math.max(0, Math.min(start, shots.length - 1));
  const img = h('img', { attrs: { alt: '' } }) as HTMLImageElement;
  const cap = h('p', { class: 'lb-cap' });
  const count = h('span', { class: 'lb-count' });
  const prev = h('button', { class: 'lb-nav prev', attrs: { 'aria-label': t('Previous photo') }, text: '‹' });
  const next = h('button', { class: 'lb-nav next', attrs: { 'aria-label': t('Next photo') }, text: '›' });
  const close = h('button', { class: 'lb-close', attrs: { 'aria-label': t('Close') }, text: '×' });
  const show = () => {
    const s = shots[i];
    let k = 0;
    img.onerror = () => { if (++k < s.src.length) img.src = s.src[k]; };
    img.src = s.src[0];
    img.alt = s.alt;
    cap.replaceChildren(s.href ? h('a', { text: s.credit, attrs: { href: s.href, target: '_blank', rel: 'noopener' } }) : s.credit);
    count.textContent = shots.length > 1 ? `${i + 1} / ${shots.length}` : '';
    prev.hidden = next.hidden = shots.length < 2;
  };
  const go = (d: number) => { i = (i + d + shots.length) % shots.length; show(); };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  close.addEventListener('click', () => dlg?.close());
  dlg = h('dialog', { class: 'lightbox', attrs: { 'aria-label': t('Photo') } }, close, prev, h('figure', {}, img, h('figcaption', {}, cap, count)), next) as HTMLDialogElement;
  // Escape closes only this (the dialog's own cancel); it must not reach the page, which would close the panel too
  dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); if (e.key === 'Escape') e.stopPropagation(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); }); // a click on the dark backdrop
  dlg.addEventListener('close', () => { dlg?.remove(); dlg = null; });
  document.body.append(dlg);
  show();
  dlg.showModal();
}
