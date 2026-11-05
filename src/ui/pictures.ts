import { useEffect, useState } from 'react';
import { imageFileName, type ImageRef } from '../core/images';
import { clipUrl, getClip } from './audioStore';

/**
 * Object URLs for scene pictures stored in this browser, keyed by the file name in #image tags. URLs are
 * released when the set of pictures changes or the component goes away.
 */
export function usePictures(refs: ImageRef[]): Map<string, { url: string; alt: string }> {
  const key = refs.map((r) => `${r.id}:${r.alt ?? ''}`).join('|');
  const [map, setMap] = useState(new Map<string, { url: string; alt: string }>());
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const next = new Map<string, { url: string; alt: string }>();
      for (const r of refs) {
        const clip = await getClip(r.id);
        if (!clip) continue;
        const url = clipUrl(clip);
        urls.push(url);
        next.set(imageFileName(r), { url, alt: r.alt ?? '' });
      }
      if (live) setMap(next);
      else urls.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

/** An object URL for one stored picture (for thumbnails), or null while loading or if it's missing. */
export function usePicture(ref: ImageRef | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref) return setUrl(null);
    let live = true;
    let made: string | null = null;
    void getClip(ref.id).then((clip) => {
      if (!live || !clip) return;
      made = clipUrl(clip);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ref?.id]);
  return url;
}
