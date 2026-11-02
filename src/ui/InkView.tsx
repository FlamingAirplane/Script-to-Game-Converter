import { Fragment, useMemo, useState } from 'react';
import type { ProcessedStory } from '../core/pipeline';
import { Badge, download } from './common';

function highlight(line: string) {
  const t = line.trimStart();
  if (t.startsWith('//')) return <span className="tk-comment">{line}</span>;
  if (/^={2,}/.test(t)) return <span className="tk-knot">{line}</span>;
  if (/^(VAR|CONST)\b/.test(t)) return <span className="tk-var">{line}</span>;
  if (t.startsWith('~')) return <span className="tk-logic">{line}</span>;
  if (/^->/.test(t)) return <span className="tk-divert">{line}</span>;
  // Split out choice bullets, conditions, diverts and tags.
  const parts: React.ReactNode[] = [];
  const re = /(^\s*[*+]\s*)|(\{[^}]*\})|(->\s*\w+)|(\s#[^#]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const cls = m[1] ? 'tk-bullet' : m[2] ? 'tk-cond' : m[3] ? 'tk-divert' : 'tk-tag';
    parts.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  parts.push(line.slice(last));
  return <>{parts}</>;
}

export function InkView({ processed, onOpen }: { processed: ProcessedStory; onOpen: (passageId: string) => void }) {
  const { generated, compile } = processed;
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => generated.ink.split('\n'), [generated.ink]);
  const errorLines = new Map(compile.diagnostics.map((d) => [d.details?.inkLine as number, d]));
  const passageAt = useMemo(() => new Map(generated.sourceMap.map((e) => [e.line, e.passageId])), [generated.sourceMap]);
  const name = processed.project.project.id || 'story';

  return (
    <div className="view ink-view">
      <div className="ink-toolbar">
        {compile.ok ? <Badge tone="ok">compiles · inkjs 2.4.0</Badge> : <Badge tone="error">compilation failed</Badge>}
        {processed.project.inkPassthrough !== undefined && <Badge tone="accent">passthrough — original Ink preserved</Badge>}
        <span className="muted small">
          {lines.length} lines · {(new TextEncoder().encode(generated.ink).length / 1024).toFixed(1)} KB · deterministic
        </span>
        <span className="spacer" />
        <button
          className="btn tiny"
          onClick={() => {
            navigator.clipboard.writeText(generated.ink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn tiny" onClick={() => download(`${name}.ink`, generated.ink)}>
          Download .ink
        </button>
        <button className="btn tiny" disabled={!compile.json} onClick={() => compile.json && download(`${name}.json`, compile.json, 'application/json')}>
          Download compiled .json
        </button>
      </div>
      <pre className="code mono" tabIndex={0} aria-label="Generated Ink source">
        {lines.map((l, i) => {
          const n = i + 1;
          const err = errorLines.get(n);
          const pid = passageAt.get(n);
          return (
            <Fragment key={i}>
              <span className={`code-line ${err ? `has-${err.severity}` : ''}`}>
                <span className="ln" onClick={() => pid && onOpen(pid)} title={pid ? `Open ${pid} in Review` : undefined}>
                  {n}
                </span>
                <span className="lc">{highlight(l)}</span>
                {err && <span className={`inline-err sev-${err.severity}`}>{err.message}</span>}
              </span>
              {'\n'}
            </Fragment>
          );
        })}
      </pre>
    </div>
  );
}
