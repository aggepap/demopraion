'use client';

import { useCallback, useRef, useState } from 'react';

import type { ImportProblem, ImportedDocument } from '../core/import/parse';
import { cmsApi, CmsApiError } from './api-client';
import { Button, Drawer, Icon } from './ui';

/**
 * Import a `.md` file into the document form.
 *
 * Deliberately does not save. The server parses the file and hands back what it
 * found; this fills the form in and a person looks at it before pressing Save.
 * A file that is wrong therefore costs a message on screen, not a row somebody
 * has to notice and delete — which is the whole reason the parse endpoint writes
 * nothing.
 *
 * Lives in the form rather than on the list screen so it works on both: opening
 * an existing document, switching to the other language tab and importing there
 * is how the second locale gets written, and it reuses the form's own
 * translation-group handling instead of inventing a second one.
 */

interface ParseResponse {
  collection: string;
  document: ImportedDocument;
  errors: ImportProblem[];
  warnings: ImportProblem[];
}

/** Extensions offered in the picker. The server decides what actually parses. */
const ACCEPT = '.md,.mdx,.markdown,text/markdown,text/plain';

/**
 * Refused before the file is read, so a mis-drag costs nothing.
 *
 * The server has the authoritative cap (`512 KB` of text, the same ceiling the
 * MDX preview action uses); this only avoids reading a video into memory to be
 * told so.
 */
const MAX_BYTES = 512 * 1024;

function ProblemList({
  title,
  tone,
  problems,
}: {
  title: string;
  tone: 'red' | 'amber';
  problems: ImportProblem[];
}) {
  if (problems.length === 0) return null;
  const styles =
    tone === 'red'
      ? 'border-red-300 bg-red-50 text-red-800'
      : 'border-amber-300 bg-amber-50 text-amber-800';
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={`rounded-sm border px-3 py-2 text-sm ${styles}`}>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="flex flex-col gap-1">
        {problems.map((problem, i) => (
          <li key={`${problem.path ?? ''}-${i}`}>
            {/* The path is what turns "must be text" into something findable in a
                200-line file, so it is shown rather than only used for sorting. */}
            {problem.path ? <code className="font-mono text-xs">{problem.path}</code> : null}
            {problem.path ? ' — ' : null}
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportMarkdownDialog({
  collectionKey,
  collectionLabel,
  activeLocale,
  onApply,
  onClose,
}: {
  collectionKey: string;
  collectionLabel: string;
  /** The language tab the import will fill in. */
  activeLocale: string;
  onApply: (document: ImportedDocument) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setFailure(null);
      setResult(null);
      setFilename(file.name);
      try {
        if (file.size > MAX_BYTES) {
          throw new Error(`That file is ${Math.round(file.size / 1024)} KB. The limit is ${MAX_BYTES / 1024} KB.`);
        }
        const source = await file.text();
        const response = await cmsApi.parseImport<ParseResponse>(collectionKey, file.name, source);
        setResult(response.data);
      } catch (err) {
        setFailure(err instanceof CmsApiError || err instanceof Error ? err.message : 'That file could not be read.');
      }
      setBusy(false);
    },
    [collectionKey],
  );

  /*
   * A file whose language disagrees with the tab is refused rather than
   * redirected. Applying it anyway would write Greek copy into the English row —
   * which saves perfectly well, reads correctly in the admin list, and is only
   * discovered by a visitor on the wrong side of the site.
   */
  const localeMismatch =
    result && result.document.locale !== null && result.document.locale !== activeLocale
      ? result.document.locale
      : null;

  const blocked = Boolean(!result || result.errors.length > 0 || localeMismatch);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <Drawer title="Import a .md file" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">
          Fill in the {collectionLabel.toLowerCase()} template and drop it here. Nothing is saved —
          the form fills itself in and you check it over before pressing Save.
        </p>

        <a
          href={`/api/cms/${collectionKey}/import`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600"
        >
          <Icon name="file-text" className="h-4 w-4" />
          Download the {collectionLabel.toLowerCase()} template
        </a>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-sm border-2 border-dashed px-4 py-8 text-center ${
            dragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'
          }`}
        >
          <p className="text-sm text-neutral-600">
            {filename ? <span className="font-mono text-xs">{filename}</span> : 'Drop a .md file here'}
          </p>
          <Button type="button" variant="ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Reading…' : filename ? 'Choose a different file' : 'Choose a file'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file twice fires `change` again —
              // otherwise a re-import after fixing the file appears to do nothing.
              e.target.value = '';
              if (file) void handleFile(file);
            }}
          />
        </div>

        {failure ? (
          <div role="alert" className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {failure}
          </div>
        ) : null}

        {localeMismatch ? (
          <div role="alert" className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            This file is the <strong className="uppercase">{localeMismatch}</strong> version, but you
            are on the <strong className="uppercase">{activeLocale}</strong> tab. Switch to{' '}
            <strong className="uppercase">{localeMismatch}</strong> first, then import it there.
          </div>
        ) : null}

        {result ? <ProblemList title="Fix these before importing" tone="red" problems={result.errors} /> : null}
        {result ? <ProblemList title="Worth knowing" tone="amber" problems={result.warnings} /> : null}

        {result && !blocked ? (
          <div className="rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            <p>
              Ready to fill in the <strong className="uppercase">{activeLocale}</strong> tab
              {result.document.slug ? (
                <>
                  {' '}
                  at <code className="font-mono text-xs">{result.document.slug}</code>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={blocked || busy}
            onClick={() => {
              if (!result || blocked) return;
              onApply(result.document);
              onClose();
            }}
          >
            Fill in the form
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
