/** Only the NarrativeBridgeInk* files may call the Ink runtime (Inkpot, InkPlusPlus): everything else goes through FNarrativeInk. */
const BACKEND = /\/NarrativeBridgeInk[^/]*\.(h|cpp)$/;
const RUNTIME_INCLUDE = /#include\s+"(Inkpot\/|Asset\/Inkpot|Ink\/)/;
/** Lists the generated files that reach past the backend: an include of the runtime's headers, or an Ink:: name. */
export function boundaryViolations(files: { path: string; content: string | Uint8Array }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!/\.(h|cpp)$/.test(f.path) || BACKEND.test(f.path) || typeof f.content !== 'string') continue;
    if (RUNTIME_INCLUDE.test(f.content) || /\bInk::/.test(f.content)) out.push(`${f.path} calls the Ink runtime directly; move it into NarrativeBridgeInk.cpp.`);
    // The component keeps the deprecated Inkpot-typed Blueprint functions in its header only; its code never names the runtime.
    if (f.path.endsWith('NarrativeBridgeComponent.cpp') && /Inkpot/i.test(f.content)) out.push(`${f.path} still mentions Inkpot.`);
  }
  return out;
}
