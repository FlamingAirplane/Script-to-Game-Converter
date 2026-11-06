/** A language's own name for itself (fr → Français), or its code. */
export function languageName(code: string): string {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch {
    return code;
  }
}
