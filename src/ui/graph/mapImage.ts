// Presentation properties copied onto every element of an exported map, so it looks the same
// outside the app (stylesheets and theme variables don't travel with the file).
const MAP_STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'text-anchor', 'paint-order', 'stroke-linejoin', 'stroke-linecap'];

/** The whole map (not just the part in view) as a standalone SVG document with a title and the page colour. */
export function mapSvg(live: SVGSVGElement, title: string): { svg: string; width: number; height: number } {
  const content = live.querySelector<SVGGElement>(':scope > g')!;
  const box = content.getBBox(); // story coordinates, before pan and zoom
  const pad = 40;
  const head = 56;
  const width = Math.ceil(box.width + pad * 2);
  const height = Math.ceil(box.height + pad * 2 + head);
  const out = live.cloneNode(true) as SVGSVGElement;
  // Inline the computed styles by walking the live and cloned trees side by side.
  const src = [live, ...live.querySelectorAll('*')];
  const dst = [out, ...out.querySelectorAll('*')];
  const hitAreas: Element[] = [];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i] as SVGElement;
    if (el.classList.contains('edge-hit')) hitAreas.push(target);
    target.setAttribute('style', MAP_STYLE_PROPS.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';'));
    target.removeAttribute('class');
    for (const a of ['tabindex', 'role', 'aria-description', 'data-id']) target.removeAttribute(a);
  });
  hitAreas.forEach((el) => el.remove()); // wide invisible strokes for hovering
  const g = out.querySelector(':scope > g')!;
  g.setAttribute('transform', `translate(${pad - box.x},${pad + head - box.y})`);
  out.removeAttribute('style');
  out.removeAttribute('aria-label');
  out.setAttribute('role', 'img');
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rootStyle = getComputedStyle(document.documentElement);
  const paper = rootStyle.getPropertyValue('--paper').trim() || '#fefae0';
  const ink = rootStyle.getPropertyValue('--ink').trim() || '#283618';
  const NS = 'http://www.w3.org/2000/svg';
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', paper);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(width / 2));
  t.setAttribute('y', String(pad + 8));
  t.setAttribute('style', `fill:${ink};font-family:'IM Fell English SC','EB Garamond',Georgia,serif;font-size:26px;text-anchor:middle;letter-spacing:0.04em`);
  t.textContent = `A Map of ${title}`;
  const label = document.createElementNS(NS, 'title');
  label.textContent = `Story map of ${title}`;
  out.prepend(label, bg, t);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}`, width, height };
}

/** Renders the exported SVG to a PNG at twice its size (sharp on high-density screens and in print). */
export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, 16000 / Math.max(width, height)); // browsers cap canvas size
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('The map is too large to save as a picture. Save it as SVG instead.');
  return new Uint8Array(await blob.arrayBuffer());
}
