/**
 * The body preview's state machine, and the types the site injects its renderer
 * through.
 *
 * Split out and kept pure for one reason: **stale replies**. The preview is
 * driven by a Server Action, and Server Actions dispatch through the app
 * router's serial queue — there is no `AbortController` for them, so a reply
 * for text the author has already moved past *will* arrive. Dropping it is the
 * difference between a preview an editor trusts and one they learn to ignore,
 * and a reducer is the only shape of that logic that can be tested without a
 * browser (`test/cms/mdx-preview-state.test.ts`).
 */
import type { ReactNode } from 'react';

export type MdxPreviewResult =
  | { status: 'ok'; node: ReactNode }
  | { status: 'empty' }
  | { status: 'invalid'; messages: string[] }
  | { status: 'throttled' }
  | { status: 'denied' };

/**
 * Supplied by the site (a Server Action). `src/cms/**` only ever sees this
 * signature — never the renderer — which is what keeps the ESLint boundary
 * intact while the preview still renders with the real site components.
 */
export type RenderMdxPreview = (source: string, locale: string) => Promise<MdxPreviewResult>;

export interface PreviewState {
  /** The last tree that rendered. Held through failures on purpose — see below. */
  node: ReactNode;
  messages: string[];
  phase: 'idle' | 'pending' | 'ready' | 'invalid' | 'error';
  /** The `previewKey` the visible `node` came from; suppresses no-op requests. */
  renderedKey: string | null;
  /** Newest request id. A reply carrying anything older is discarded. */
  seq: number;
}

export type PreviewEvent =
  | { type: 'request'; seq: number }
  | { type: 'reply'; seq: number; key: string; result: MdxPreviewResult }
  | { type: 'failed'; seq: number; message: string }
  | { type: 'reset' };

export const INITIAL_PREVIEW: PreviewState = {
  node: null,
  messages: [],
  phase: 'idle',
  renderedKey: null,
  seq: 0,
};

/**
 * The key a source+locale pair renders under.
 *
 * The separator is a newline rather than nothing: locales are short and a bare
 * concatenation would make `el` + `X` collide with `e` + `lX` if a locale code
 * ever gains a variant.
 */
export const previewKey = (source: string, locale: string): string => `${locale}\n${source}`;

export function previewReducer(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case 'reset':
      // A locale switch is a different document, not a newer version of this
      // one — keeping the old tree would show EL content under an EN tab.
      return { ...INITIAL_PREVIEW, seq: state.seq };

    case 'request':
      return { ...state, seq: event.seq, phase: 'pending' };

    case 'failed':
      if (event.seq !== state.seq) return state;
      return { ...state, phase: 'error', messages: [event.message] };

    case 'reply': {
      if (event.seq !== state.seq) return state;
      const { result } = event;
      switch (result.status) {
        case 'ok':
          return {
            ...state,
            node: result.node,
            messages: [],
            phase: 'ready',
            renderedKey: event.key,
          };
        case 'empty':
          return { ...state, node: null, messages: [], phase: 'ready', renderedKey: event.key };
        case 'invalid':
          // The last good tree stays on screen underneath the message list.
          // Blanking the pane the moment someone types `<` mid-tag is the
          // failure mode that makes a live preview unusable.
          return { ...state, messages: result.messages, phase: 'invalid' };
        case 'throttled':
          return { ...state, phase: 'error', messages: ['Preview is catching up…'] };
        case 'denied':
          return { ...state, phase: 'error', messages: ['You cannot preview this document.'] };
      }
    }
  }
}

/** Only an `f.mdx` field opts in; every other `code` field keeps its textarea. */
export function isMdxPreviewField(field: {
  kind: string;
  language?: string;
  allowedComponents?: readonly string[];
}): boolean {
  return field.kind === 'code' && field.language === 'mdx' && Boolean(field.allowedComponents);
}
