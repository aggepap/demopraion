'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { MdxComponentSpec } from '../../config';
import { Button, Textarea } from '../ui';
import { cn } from '../ui/cn';
import { applyEdit } from './mdx/apply-edit';
import { InsertComponentDialog } from './mdx/InsertComponentDialog';
import { applyAction, applyLink, continueList, type MdAction } from './mdx/markdown-actions';
import {
  INITIAL_PREVIEW,
  previewKey,
  previewReducer,
  type RenderMdxPreview,
} from './mdx/preview-state';

export interface MdxBodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** The locale being edited — the preview needs it for internal links. */
  locale: string;
  /** The security list, straight off the field. Palette entries outside it are dropped. */
  allowedComponents?: readonly string[];
  /** UI metadata for the insert dialog. Absent means no Insert button. */
  palette?: readonly MdxComponentSpec[];
  /** Injected by the site. Absent means no preview pane — the core cannot render MDX itself. */
  renderPreview?: RenderMdxPreview;
  rows?: number;
  placeholder?: string;
  /** From `Field`; must land on the real <textarea>, not on the wrapper. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

type Mode = 'edit' | 'split' | 'preview';

/** Below this the two panes stop being writable surfaces and Split is hidden. */
const SPLIT_MIN_WIDTH = 880;
const DEBOUNCE_MS = 500;

export function MdxBodyEditor({
  value,
  onChange,
  locale,
  allowedComponents,
  palette,
  renderPreview,
  rows,
  placeholder,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: MdxBodyEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [wide, setWide] = useState(false);
  // The selection is captured when the dialog opens, not read during render:
  // opening the dialog moves focus, so by render time the textarea's own
  // selection is already gone.
  const [dialogSelection, setDialogSelection] = useState<string | null>(null);
  const [state, dispatch] = useReducer(previewReducer, INITIAL_PREVIEW);
  const seqRef = useRef(0);

  /*
   * A palette entry naming something outside `allowedComponents` is dropped
   * rather than offered: the allow-list is what the server enforces, so an
   * offered-but-refused component would produce a body that saves as nothing.
   * A config mistake degrades to a missing button.
   */
  const offered = useMemo(() => {
    if (!palette) return [];
    if (!allowedComponents) return palette;
    const allowed = new Set(allowedComponents);
    return palette.filter(
      (spec) => allowed.has(spec.name) && (!spec.repeat || allowed.has(spec.repeat.child)),
    );
  }, [palette, allowedComponents]);

  // Split is gated on the editor's *own* width, not the viewport: the constraint
  // is the form's left column next to the sticky settings rail, which a media
  // query cannot see.
  const [canSplit, setCanSplit] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) =>
      setCanSplit(entry.contentRect.width >= SPLIT_MIN_WIDTH),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Derived, not corrected in an effect: if the column is too narrow for two
  // panes, Split silently reads as Edit until there is room again — and the
  // author's chosen mode is still there when they widen the window.
  const effectiveMode: Mode = mode === 'split' && !canSplit ? 'edit' : mode;

  // A locale switch is a different document, not a newer version of this one.
  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [locale]);

  const showPreview =
    Boolean(renderPreview) && (effectiveMode === 'preview' || effectiveMode === 'split');

  useEffect(() => {
    if (!renderPreview || !showPreview) return;
    const key = previewKey(value, locale);
    if (key === state.renderedKey) return;

    // First paint is immediate so an existing body shows up at once; edits wait
    // out the debounce.
    const delay = state.renderedKey === null ? 0 : DEBOUNCE_MS;
    const timer = setTimeout(() => {
      const seq = ++seqRef.current;
      dispatch({ type: 'request', seq });
      renderPreview(value, locale).then(
        (result) => dispatch({ type: 'reply', seq, key, result }),
        (err: unknown) =>
          dispatch({
            type: 'failed',
            seq,
            message: err instanceof Error ? err.message : 'Preview unavailable.',
          }),
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [value, locale, renderPreview, showPreview, state.renderedKey]);

  const selection = useCallback(() => {
    const el = areaRef.current;
    return {
      value: el?.value ?? value,
      start: el?.selectionStart ?? 0,
      end: el?.selectionEnd ?? 0,
    };
  }, [value]);

  const run = useCallback(
    (action: MdAction) => {
      const el = areaRef.current;
      if (!el) return;
      applyEdit(el, applyAction(action, selection()), onChange);
    },
    [onChange, selection],
  );

  const insertLink = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    const sel = selection();
    const text = sel.value.slice(sel.start, sel.end) || 'link text';
    const href = window.prompt('Link URL', '/');
    if (!href) return;
    applyEdit(el, applyLink(sel, text, href), onChange);
  }, [onChange, selection]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const el = areaRef.current;
      if (!el) return;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && !event.altKey) {
        const key = event.key.toLowerCase();
        const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : null;
        if (action) {
          event.preventDefault();
          run(action);
          return;
        }
        if (key === 'k') {
          event.preventDefault();
          insertLink();
          return;
        }
      }

      if (event.key === 'Enter' && !mod) {
        const edit = continueList(selection());
        if (edit) {
          event.preventDefault();
          applyEdit(el, edit, onChange);
        }
        return;
      }

      /*
       * Tab indents only when the selection spans lines. A collapsed caret must
       * always move focus — a textarea that swallows Tab is a keyboard trap
       * (WCAG 2.1.2), and this field sits in the middle of a long form.
       */
      if (event.key === 'Tab') {
        const sel = selection();
        if (sel.start === sel.end || !sel.value.slice(sel.start, sel.end).includes('\n')) return;
        event.preventDefault();
        applyEdit(el, applyAction(event.shiftKey ? 'outdent' : 'indent', sel), onChange);
      }
    },
    [insertLink, onChange, run, selection],
  );

  const editor = (
    <div className="flex min-w-0 flex-1 flex-col">
      <Textarea
        ref={areaRef}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cn(
          'min-h-[22rem] flex-1 rounded-none border-0 font-mono text-xs leading-relaxed focus:ring-0',
          wide && 'min-h-0',
        )}
        rows={rows ?? 20}
        // Spellcheck on: a body is prose with the occasional tag, and a writer
        // typing a few thousand words was getting no help with typos that then
        // went to the public site.
        spellCheck
        placeholder={placeholder ?? 'mdx source'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );

  const preview = (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden border-neutral-200 lg:border-l"
      aria-live="polite"
    >
      {state.messages.length > 0 ? (
        <div
          role="alert"
          className={cn(
            'border-b px-3 py-2 text-xs',
            state.phase === 'invalid'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-amber-300 bg-amber-50 text-amber-900',
          )}
        >
          <p className="mb-1 font-semibold">
            {state.phase === 'invalid'
              ? `${state.messages.length} problem${state.messages.length === 1 ? '' : 's'} — this body will not render`
              : 'Preview'}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {state.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className={cn(
          'min-h-[22rem] flex-1 overflow-auto transition-opacity',
          // The last good tree stays visible, dimmed, while the current source
          // is broken — blanking the pane the moment someone types `<` mid-tag
          // is what makes a live preview unusable.
          state.phase === 'invalid' && 'opacity-40',
          state.phase === 'pending' && 'opacity-70',
        )}
      >
        {state.node ?? (
          <p className="p-6 text-center text-sm text-neutral-400">
            {state.phase === 'pending' ? 'Rendering…' : 'Nothing to preview yet.'}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        'flex flex-col overflow-hidden rounded-sm border border-neutral-300 bg-white',
        // `fixed` is safe here only because no ancestor of the admin `<main>`
        // is transformed; a `transition-transform` added there later would
        // re-parent this and break full-screen silently.
        wide && 'fixed inset-0 z-40 rounded-none',
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 bg-neutral-50 p-1.5">
        <ToolButton label="Bold" onClick={() => run('bold')}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label="Italic" onClick={() => run('italic')}>
          <em>I</em>
        </ToolButton>
        <Divider />
        <ToolButton label="Heading 2" onClick={() => run('h2')}>
          H2
        </ToolButton>
        <ToolButton label="Heading 3" onClick={() => run('h3')}>
          H3
        </ToolButton>
        <Divider />
        <ToolButton label="Bulleted list" onClick={() => run('bullet')}>
          •
        </ToolButton>
        <ToolButton label="Numbered list" onClick={() => run('ordered')}>
          1.
        </ToolButton>
        <ToolButton label="Quote" onClick={() => run('quote')}>
          ❝
        </ToolButton>
        <Divider />
        <ToolButton label="Link" onClick={insertLink}>
          Link
        </ToolButton>
        <ToolButton label="Code" onClick={() => run('code')}>
          {'</>'}
        </ToolButton>

        {offered.length > 0 ? (
          <>
            <Divider />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const sel = selection();
                setDialogSelection(sel.value.slice(sel.start, sel.end));
              }}
            >
              + Insert component
            </Button>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {renderPreview ? (
            <div className="flex rounded-sm border border-neutral-300 bg-white p-0.5">
              {(['edit', ...(canSplit ? (['split'] as const) : []), 'preview'] as Mode[]).map(
                (m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold',
                      mode === m
                        ? 'bg-neutral-800 text-white'
                        : 'text-neutral-600 hover:bg-neutral-100',
                    )}
                  >
                    {m}
                  </button>
                ),
              )}
            </div>
          ) : null}
          <ToolButton label={wide ? 'Exit full screen' : 'Full screen'} onClick={() => setWide((w) => !w)}>
            {wide ? '↙' : '↗'}
          </ToolButton>
        </div>
      </div>

      <div className={cn('flex min-h-0 flex-1', effectiveMode === 'split' ? 'flex-row' : 'flex-col')}>
        {effectiveMode !== 'preview' ? editor : null}
        {showPreview ? preview : null}
      </div>

      {dialogSelection !== null ? (
        <InsertComponentDialog
          palette={offered}
          selection={dialogSelection}
          onClose={() => setDialogSelection(null)}
          onInsert={(text, caret) => {
            setDialogSelection(null);
            const el = areaRef.current;
            if (!el) return;
            const sel = selection();

            /*
             * A flow-level JSX element must own its line, framed by a blank line
             * on each side — otherwise MDX folds it into the neighbouring
             * paragraph and the component silently stops rendering.
             *
             * Only the whitespace immediately around the insertion point is
             * rewritten, not the whole body: replacing the entire value would
             * make one undo step swallow the document and would re-render a
             * few-thousand-word textarea on every insert.
             */
            const before = sel.value.slice(0, sel.start);
            const after = sel.value.slice(sel.end);
            const keptBefore = before.replace(/\n*$/, '');
            const trimmedAfter = after.replace(/^\n*/, '');

            const from = keptBefore.length;
            const to = sel.value.length - trimmedAfter.length;
            const lead = keptBefore === '' ? '' : '\n\n';
            const tail = trimmedAfter === '' ? '\n' : '\n\n';
            const caretAt = from + lead.length + caret;

            applyEdit(
              el,
              {
                from,
                to,
                text: `${lead}${text}${tail}`,
                selStart: caretAt,
                selEnd: caretAt,
              },
              onChange,
            );
          }}
        />
      ) : null}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-neutral-300" />;
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="min-h-7 min-w-7 rounded-sm px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
    >
      {children}
    </button>
  );
}
