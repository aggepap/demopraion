import { createElement, type ReactNode } from 'react';

import {
  shortcodeFromParagraph,
  unescapeShortcode,
  type ParsedShortcode,
} from '@/cms/core/shortcodes/parse';
import { safeHref } from '@/components/ui/Button';
import { Shortcode } from '@/components/cms/Shortcode';

/**
 * Minimal server-side renderer for the CMS rich-text field (TipTap JSON —
 * `{ type: 'doc', content: [...] }`). Products author their description with
 * the admin StarterKit editor; there is no other public TipTap consumer and
 * `@tiptap/html` isn't installed, so we walk the node tree ourselves. Unknown
 * nodes fall back to rendering their children, so content never disappears.
 */

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

function isDoc(value: unknown): value is TipTapNode {
  return !!value && typeof value === 'object' && (value as TipTapNode).type === 'doc';
}

function applyMarks(text: string, marks?: TipTapMark[]): ReactNode {
  if (!marks?.length) return text;
  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>;
      case 'italic':
        return <em>{acc}</em>;
      case 'strike':
        return <s>{acc}</s>;
      case 'code':
        return <code className="rounded-sm bg-neutral-100 px-1 py-0.5 font-mono text-sm">{acc}</code>;
      case 'link': {
        /*
         * A link mark's href is whatever the editor typed, so it gets the same
         * allow-list as a CTA href rather than being trusted for being inside a
         * structured document. The TipTap JSON is validated as a `doc` node but
         * its attrs are not, so this is the only place the scheme is checked.
         */
        const raw = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#';
        const href = safeHref(raw);
        const external = /^https?:\/\//.test(href);
        return (
          <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-warm-gold-deep underline underline-offset-2 hover:text-midnight-navy"
          >
            {acc}
          </a>
        );
      }
      default:
        return acc;
    }
  }, text);
}

/**
 * Whether this paragraph IS a shortcode (rather than prose that mentions one).
 *
 * Exported so the decision can be tested directly: the component it produces is
 * an async server component, which a static render cannot execute.
 */
export function paragraphShortcode(node: {
  content?: { type?: string; text?: string; marks?: unknown[] }[];
}): ParsedShortcode | null {
  const text = plainText(node as TipTapNode);
  return text ? shortcodeFromParagraph(text) : null;
}

/** A node's text, when it is nothing but text — used to spot a shortcode. */
function plainText(node: TipTapNode): string | null {
  const children = node.content ?? [];
  if (children.length === 0) return null;
  if (!children.every((child) => child.type === 'text' && !child.marks?.length)) return null;
  return children.map((child) => child.text ?? '').join('');
}

function renderChildren(nodes?: TipTapNode[]): ReactNode[] {
  return (nodes ?? []).map((node, i) => <NodeView key={i} node={node} />);
}

function NodeView({ node }: { node: TipTapNode }): ReactNode {
  switch (node.type) {
    case 'text':
      return <>{applyMarks(node.text ?? '', node.marks)}</>;
    case 'paragraph': {
      /*
       * A paragraph that is ENTIRELY one shortcode becomes that component.
       * Anything else — a sentence that merely contains brackets — stays the
       * words the author typed, and `[[name]]` renders as a literal `[name]`.
       */
      const text = plainText(node);
      const parsed = paragraphShortcode(node);
      if (parsed) return <Shortcode parsed={parsed} />;
      if (text && text.trim().startsWith('[[')) return <p>{unescapeShortcode(text)}</p>;
      return <p>{renderChildren(node.content)}</p>;
    }
    case 'shortcode': {
      // The editor's own node (a chip in the admin), stored structured.
      const name = typeof node.attrs?.name === 'string' ? node.attrs.name : '';
      const attrs =
        node.attrs?.attrs && typeof node.attrs.attrs === 'object'
          ? (node.attrs.attrs as Record<string, string>)
          : {};
      return name ? <Shortcode parsed={{ name, attrs }} /> : null;
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4);
      const cls =
        level === 2
          ? 'font-display text-2xl font-semibold text-midnight-navy mt-6'
          : 'font-display text-xl font-semibold text-midnight-navy mt-4';
      return createElement(`h${level}`, { className: cls }, renderChildren(node.content));
    }
    case 'bulletList':
      return <ul className="flex list-disc flex-col gap-1 pl-6">{renderChildren(node.content)}</ul>;
    case 'orderedList':
      return <ol className="flex list-decimal flex-col gap-1 pl-6">{renderChildren(node.content)}</ol>;
    case 'listItem':
      return <li>{renderChildren(node.content)}</li>;
    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-warm-gold pl-4 italic text-text-muted">
          {renderChildren(node.content)}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre className="overflow-x-auto rounded-sm bg-neutral-100 p-3 font-mono text-sm">
          <code>{renderChildren(node.content)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr className="border-border-soft" />;
    case 'hardBreak':
      return <br />;
    default:
      // Unknown block — render its children so nothing is lost.
      return <>{renderChildren(node.content)}</>;
  }
}

/** Render a TipTap rich-text document. Returns null for empty/invalid input. */
export function RichText({ value, className }: { value: unknown; className?: string }) {
  if (!isDoc(value) || !value.content?.length) return null;
  return <div className={className}>{renderChildren(value.content)}</div>;
}
