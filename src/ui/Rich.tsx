import type { ReactNode } from 'react';
import { emphasisSpans } from '../core/emphasis';

/** Story text with its emphasis (<i>, <b>, <u>; see emphasis.ts) shown as italics, bold and underline. */
export function Rich({ text }: { text: string }) {
  if (!/<\/?[ibu]>/.test(text)) return <>{text}</>;
  return (
    <>
      {emphasisSpans(text).map((s, k) => {
        let el: ReactNode = s.text;
        if (s.u) el = <u>{el}</u>;
        if (s.b) el = <strong>{el}</strong>;
        if (s.i) el = <em>{el}</em>;
        return <span key={k}>{el}</span>;
      })}
    </>
  );
}
