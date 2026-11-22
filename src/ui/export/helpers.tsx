/** "fr, de" → ["fr", "de"]: language codes for the translation sheet's columns. */
export function languageList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter((x) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(x)),
    ),
  ];
}

export function Pass({ ok }: { ok: boolean }) {
  return <span className={`sev ${ok ? 'sev-ok' : 'sev-error'}`}>{ok ? '✓' : '●'}</span>;
}

export function previewText(content: string | Uint8Array | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content.slice(0, 20000);
  return `(audio file, ${(content.length / 1024).toFixed(1)} KB)`;
}
