// Scene pictures: an image attached to a passage, shown when the passage begins. Like voice clips, the
// bytes live outside the ISR (the browser's IndexedDB, or base64 in a saved project file); the ISR keeps
// only this reference. Pictures are stored as PNG or JPEG, which every engine target loads.

export interface ImageRef {
  id: string; // stable id, also the exported file's base name
  name: string; // original file name, for display
  mime: 'image/png' | 'image/jpeg';
  width?: number;
  height?: number;
  /** A short description, read out by screen readers. */
  alt?: string;
}

export function imageFileName(ref: Pick<ImageRef, 'id' | 'mime'>): string {
  return `${ref.id}.${ref.mime === 'image/jpeg' ? 'jpg' : 'png'}`;
}

export function newImageId(seed: string): string {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `img_${seed.replace(/[^a-z0-9_]/gi, '_').slice(0, 32)}_${rand}`;
}

/** Every picture the project refers to: scene pictures and character portraits. */
export function referencedImages(project: { passages: { image?: ImageRef }[]; characters?: { portrait?: ImageRef }[] }): ImageRef[] {
  const out = new Map<string, ImageRef>();
  for (const p of project.passages) if (p.image) out.set(p.image.id, p.image);
  for (const c of project.characters ?? []) if (c.portrait) out.set(c.portrait.id, c.portrait);
  return [...out.values()];
}

/** Speaker id (the #speaker tag) → that character's portrait file name, for characters that have one. */
export function portraitFiles(project: { characters: { id: string; portrait?: ImageRef }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of project.characters) if (c.portrait) out[c.id] = imageFileName(c.portrait);
  return out;
}
