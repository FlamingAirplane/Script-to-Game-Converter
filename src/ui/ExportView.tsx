import { useEffect, useMemo, useRef, useState } from 'react';
import { pendingSuggestions } from '../core/adapt';
import { isPinnedRef, pascalCase } from '../core/export/common';
import { ADAPTERS, ExportBlockedError, unityTarball, unityTarballName, zipExport, type EngineTarget, type ExportResult } from '../core/export';
import { SEMVER, unityPackageId } from '../core/export/unityPackage';
import { referencedAudio } from '../core/audio';
import { referencedImages } from '../core/images';
import { fileBase, referencedOriginals } from '../core/isr';
import type { ProcessedStory } from '../core/pipeline';
import { collectClips } from './audioStore';
import { renderClips } from './audioRender';
import { sfx } from './sfx';
import { Badge, SeverityIcon, download } from './common';
import type { StoryProject } from '../core/isr';
import type { Update } from './projectOps';
import { UnityThemeEditor } from './UnityThemeEditor';
import { DialogueOnlySetting } from './DialogueOnlySetting';
import { ShareSection } from './export/ShareSection';
import { PackageContents } from './export/PackageContents';
import { languageList, Pass, previewText } from './export/helpers';

// `stale`: an edit is still being processed, so exports wait for it rather than packaging the previous version.
export function ExportView({
  processed,
  stale,
  onState,
  project,
  update,
  onReview,
}: {
  processed: ProcessedStory;
  stale: boolean;
  onState: (s: 'Exporting' | 'Succeeded' | 'Failed' | null) => void;
  project: StoryProject;
  update: Update;
  onReview?: () => void;
}) {
  const [engine, setEngine] = useState<EngineTarget>('unity');
  const adapter = ADAPTERS[engine];
  const defaultName = pascalCase(processed.project.project.title) || 'NarrativeProject';
  const [opts, setOpts] = useState({
    projectName: defaultName,
    engineVersion: adapter.defaultEngineVersion,
    integrationRef: adapter.integration.defaultRef,
    includeDemo: true,
    unityLayout: 'package' as 'package' | 'project',
    packageVersion: '1.0.0',
    unityAddressables: false,
  });
  const [sheetLanguages, setSheetLanguages] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const [tgz, setTgz] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpts((o) => ({ ...o, engineVersion: adapter.defaultEngineVersion, integrationRef: adapter.integration.defaultRef }));
    setResult(null);
    setZip(null);
    setTgz(null);
  }, [engine, adapter]);
  useEffect(() => {
    setResult(null);
    setZip(null);
    setTgz(null);
  }, [processed]);

  const blocking = processed.diagnostics.filter((d) => d.exportBlocked);
  const pending = processed.diagnostics.filter((d) => d.severity === 'review');
  const waiting = pendingSuggestions(processed.project);
  const requirements = adapter.requirements({ engine, ...opts });
  const pinned = isPinnedRef(opts.integrationRef);
  const asPackage = engine === 'unity' && opts.unityLayout === 'package';
  const pkgId = unityPackageId(opts.projectName, processed.project.project.title);
  const versionOk = SEMVER.test(opts.packageVersion);

  const build = async () => {
    setBusy(true);
    setError('');
    onState('Exporting');
    try {
      const audio = await renderClips(referencedAudio(processed.project));
      const images = await collectClips(referencedImages(processed.project));
      const originals = await collectClips(referencedOriginals(processed.project));
      const r = await adapter.export(processed, { engine, ...opts, audio, images, originals, translationLanguages: languageList(sheetLanguages) });
      setResult(r);
      setZip(await zipExport(r));
      setTgz(engine === 'unity' && opts.unityLayout === 'package' ? await unityTarball(r) : null);
      setPreview(r.files.find((f) => f.path.endsWith('narrative-bridge.manifest.json'))?.path ?? null);
      onState(r.report.errors.length ? 'Failed' : 'Succeeded');
      if (!r.report.errors.length) sfx.stamp();
      // The result (file list and download) is below the settings: bring it into view.
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }),
      );
    } catch (e) {
      setError(e instanceof ExportBlockedError ? `Export blocked — ${e.message}` : String(e));
      onState('Failed');
    } finally {
      setBusy(false);
    }
  };

  const tree = useMemo(() => {
    if (!result) return [];
    // Unity's .meta files (one per file and folder) are left out of the list; they're in the download.
    return result.files
      .map((f) => f.path)
      .filter((p) => !p.endsWith('.meta'))
      .sort();
  }, [result]);
  const metas = result ? result.files.length - tree.length : 0;

  return (
    <div className="view export-view">
      <section className={`card export-summary ${blocking.length ? 'blocked' : ''}`} aria-label="Before you export">
        <h2>Before you export</h2>
        <p className="small">
          {blocking.length
            ? `✗ ${blocking.length} error${blocking.length > 1 ? 's' : ''} must be fixed first (see the Diagnostics panel). Every export below waits for this.`
            : '✓ No errors: every export below is ready.'}
          {waiting > 0 && (
            <>
              {' '}
              {waiting} suggestion{waiting > 1 ? 's are' : ' is'} still waiting for your OK and will be left out of every export.{' '}
              {onReview && (
                <button className="btn tiny" onClick={onReview}>
                  Review now
                </button>
              )}
            </>
          )}
        </p>
        <DialogueOnlySetting project={project} update={update} />
      </section>
      <ShareSection processed={processed} stale={stale} project={project} update={update} />

      <h2 className="section-title">For a game engine</h2>
      <section className="engines">
        {(['unity', 'unreal'] as EngineTarget[]).map((e) => (
          <button key={e} className={`engine-card ${engine === e ? 'selected' : ''}`} onClick={() => setEngine(e)}>
            <span className="engine-name">{ADAPTERS[e].label}</span>
            <span className="muted small">via {ADAPTERS[e].integration.name}</span>
            <span className="muted small mono">{ADAPTERS[e].integration.repository.replace('https://github.com/', '').replace('.git', '')}</span>
          </button>
        ))}
      </section>

      <PackageContents engine={engine} layout={opts.unityLayout} />

      <div className="export-grid">
        <section className="card">
          <h2>Package settings</h2>
          {engine === 'unity' && (
            <fieldset className="modes layout-choice">
              <legend className="muted small">What to build</legend>
              <label className={`mode ${opts.unityLayout === 'package' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="unity-layout"
                  checked={opts.unityLayout === 'package'}
                  onChange={() => setOpts({ ...opts, unityLayout: 'package' })}
                />
                <span>
                  <strong>A package for a game you already have</strong>
                  <span className="muted small">
                    Add it to any Unity project with Package Manager (or drop it in Packages/). Nothing in the project is replaced.
                  </span>
                </span>
              </label>
              <label className={`mode ${opts.unityLayout === 'project' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="unity-layout"
                  checked={opts.unityLayout === 'project'}
                  onChange={() => setOpts({ ...opts, unityLayout: 'project' })}
                />
                <span>
                  <strong>A complete new Unity project</strong>
                  <span className="muted small">The same package inside a ready-to-open project, to try the story on its own.</span>
                </span>
              </label>
            </fieldset>
          )}
          <label className="field">
            <span className="muted small">{asPackage ? 'Story name' : 'Project name'}</span>
            <input
              className="input"
              value={opts.projectName}
              onChange={(e) => setOpts({ ...opts, projectName: e.target.value.replace(/[^\p{L}\p{N}_\- ]/gu, '') })}
            />
            {engine === 'unity' && (
              <span className="muted small">
                Package <code>{pkgId.name}</code> · C# namespace <code>{pkgId.namespace}</code>
              </span>
            )}
          </label>
          {asPackage && (
            <label className="field">
              <span className="muted small">Package version {versionOk ? null : <Badge tone="warning">use numbers like 1.2.0</Badge>}</span>
              <input
                className={`input mono ${versionOk ? '' : 'invalid'}`}
                value={opts.packageVersion}
                onChange={(e) => setOpts({ ...opts, packageVersion: e.target.value.trim() })}
              />
            </label>
          )}
          <details className="advanced">
            <summary>Advanced: versions{engine === 'unity' ? ' and loading' : ''}</summary>
            <label className="field">
              <span className="muted small">
                {asPackage ? 'Unity version you build with (the package works in 2022.3 and later)' : `${adapter.label} version`}
              </span>
              <input className="input mono" value={opts.engineVersion} onChange={(e) => setOpts({ ...opts, engineVersion: e.target.value })} />
            </label>
            <label className="field">
              <span className="muted small">
                {adapter.integration.name} ref (tag or commit){' '}
                {pinned ? <Badge tone="ok">pinned</Badge> : <Badge tone="warning">branch — not reproducible</Badge>}
              </span>
              <input className="input mono" value={opts.integrationRef} onChange={(e) => setOpts({ ...opts, integrationRef: e.target.value.trim() })} />
            </label>
            {engine === 'unity' && (
              <div className="field">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={opts.unityAddressables}
                    onChange={(e) => setOpts({ ...opts, unityAddressables: e.target.checked })}
                    aria-describedby="addressables-help"
                  />
                  Load voice clips and pictures on demand (Addressables)
                </label>
                <span className="muted small" id="addressables-help">
                  For long or heavily voiced stories: they aren’t all built into the game. The package sets up the Addressables group itself.
                </span>
              </div>
            )}
            <label className="field">
              <span className="muted small">
                Translation sheet: language columns to add (e.g. fr, de). Every export has the sheet; translators fill the columns in.
              </span>
              <input className="input mono" value={sheetLanguages} placeholder="e.g. fr, de" onChange={(e) => setSheetLanguages(e.target.value)} />
            </label>
          </details>
          {!asPackage && (
            <label className="check">
              <input type="checkbox" checked={opts.includeDemo} onChange={(e) => setOpts({ ...opts, includeDemo: e.target.checked })} />
              Include runnable demo ({engine === 'unity' ? 'auto-created scene with the story UI' : 'press Play to see the story in its story panel'})
            </label>
          )}

          <h3>Preflight</h3>
          <ul className="checklist">
            <li>
              <Pass ok={processed.compile.ok} /> Ink compiles with pinned inkjs
            </li>
            <li>
              <Pass ok={!blocking.length} /> {blocking.length ? `${blocking.length} blocking error(s)` : 'No blocking errors'}
            </li>
            <li>
              {processed.smokePending ? (
                <>
                  <span className="sev sev-info">…</span> Running automated playthroughs…
                </>
              ) : (
                <>
                  <Pass ok={!!processed.smoke && !processed.smoke.runtimeErrors.length} />{' '}
                  {processed.smoke
                    ? `${processed.smoke.completedRuns}/${processed.smoke.runs} automated playthroughs reached an ending`
                    : 'Story smoke test not run'}
                </>
              )}
            </li>
            {pending.length > 0 && (
              <li>
                <SeverityIcon severity="review" /> {pending.length} proposed change(s) not approved — they will be left out
              </li>
            )}
          </ul>
          <button
            className="btn primary big"
            disabled={busy || stale || blocking.length > 0 || !!processed.smokePending || (asPackage && !versionOk)}
            onClick={build}
          >
            {busy ? 'Building…' : engine === 'unity' ? (asPackage ? 'Build Unity package' : 'Build Unity project') : `Build ${adapter.label} package`}
          </button>
          {result && zip && !busy && (
            <p className="small built-note" role="status">
              {result.report.errors.length ? '✗ Built, but a check failed: see below.' : `✓ Built: ${tree.length} files, ${(zip.length / 1024).toFixed(1)} KB.`}{' '}
              <button className="link" onClick={() => resultRef.current?.scrollIntoView({ block: 'start' })}>
                Go to the download
              </button>
            </p>
          )}
          {blocking.length > 0 && <p className="error-text small">Fix the errors in the Diagnostics panel to enable export.</p>}
          {error && <p className="error-text">{error}</p>}
        </section>

        <details className="advanced advanced-card">
          <summary>Advanced: the look of the story window in {adapter.label} (colours, fonts, layout and more)</summary>
          <UnityThemeEditor project={project} update={update} engine={engine} />
        </details>

        <section className="card">
          <p className="for-dev small">For your developer</p>
          <h2>What their computer needs</h2>
          <p className="muted small">
            Writers can skip this. The browser can’t check a computer, so your developer can run <code>npm run cli -- doctor --engine {engine}</code> to check
            these automatically.
          </p>
          <ul className="checklist">
            {requirements.map((r) => (
              <li key={r.id}>
                <strong>{r.label}</strong>
                <span className="muted small">{r.detail}</span>
              </li>
            ))}
          </ul>
          {result && (
            <>
              <h3>Next steps</h3>
              <ol className="steps">
                {result.report.setupInstructions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      {result && (
        <section className="card result" ref={resultRef} aria-label="The built package">
          <div className="row">
            <h2>{result.rootName}</h2>
            {result.report.errors.length ? <Badge tone="error">a check failed</Badge> : <Badge tone="ok">files checked</Badge>}
            <Badge tone="muted">not yet opened in {adapter.label}</Badge>
            <span className="spacer" />
            <span className="muted small">
              {tree.length} files{metas ? ` (+ ${metas} Unity .meta)` : ''} · {zip ? `${(zip.length / 1024).toFixed(1)} KB` : ''}
            </span>
            {tgz && (
              <button
                className="btn"
                title="For Package Manager → + → Install package from tarball…"
                onClick={() => download(unityTarballName(result), tgz, 'application/gzip')}
              >
                Download .tgz
              </button>
            )}
            <button
              className="btn primary"
              disabled={!zip}
              onClick={() => zip && download(`${fileBase(processed.project)}-${engine}.zip`, zip, 'application/zip')}
            >
              Download .zip
            </button>
          </div>
          <p className="muted small">
            Checked here: every file the package needs is in it and the story compiles. It hasn’t been opened or built in {adapter.label}; that happens on your
            developer’s computer.
          </p>
          {result.report.diagnostics.length > 0 && (
            <ul className="inline-diags">
              {result.report.diagnostics.map((d, i) => (
                <li key={i}>
                  <SeverityIcon severity={d.severity} /> {d.message} {d.remediation && <span className="muted small">— {d.remediation}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="file-browser">
            <ul className="tree mono small">
              {tree.map((p) => (
                <li key={p}>
                  <button className={`link ${preview === p ? 'active' : ''}`} onClick={() => setPreview(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="file-preview mono small">{preview ? previewText(result.files.find((f) => f.path === preview)?.content) : ''}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
