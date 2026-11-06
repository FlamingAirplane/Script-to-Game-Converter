import { saveFile } from './platform';
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
  source: 'Source: taken word for word from your script',
  transformed: 'Transformed: from your script, but reshaped to fit a game (for example a scene split into a passage)',
  generated: 'Generated: suggested by Narrative Bridge, not in your script. Approve or reject it',
  user_authored: 'Edited: you added or changed this here',
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

/** Saves an export: into a folder the writer picks where the browser allows it, otherwise as a download (see platform.ts). */
export function download(name: string, data: string | Uint8Array, type = 'text/plain') {
  void saveFile(name, data, type);
}
