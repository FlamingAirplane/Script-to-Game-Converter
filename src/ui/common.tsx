import type { ReactNode } from 'react';
import type { Severity } from '../core/diagnostics';
import type { Provenance } from '../core/isr';

export function Badge({ tone = 'muted', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const PROV_LABEL: Record<Provenance, string> = { source: 'source', transformed: 'transformed', generated: 'generated', user_authored: 'edited' };
const PROV_HELP: Record<Provenance, string> = {
  source: 'Directly extracted from the original document',
  transformed: 'Reformatted or normalised from source content',
  generated: 'Newly proposed interactive content — needs review',
  user_authored: 'Added or edited in Narrative Bridge',
};

export function ProvenanceBadge({ origin }: { origin: Provenance }) {
  return (
    <Badge tone={`prov-${origin}`} title={PROV_HELP[origin]}>
      {PROV_LABEL[origin]}
    </Badge>
  );
}

export function SeverityIcon({ severity }: { severity: Severity }) {
  const glyph = { error: '●', warning: '▲', review: '◆', info: '○' }[severity];
  return (
    <span className={`sev sev-${severity}`} aria-label={severity}>
      {glyph}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function download(name: string, data: string | Uint8Array, type = 'text/plain') {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
