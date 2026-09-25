'use client';

import { useState } from 'react';

import { Button } from './ui';

/**
 * "Copy shortcode" — on a module's settings screen, next to what it configures.
 *
 * The point is that an administrator never has to remember the syntax: they
 * configure reviews, copy the line, and paste it where they want it.
 */
export function CopyShortcodeButton({ shortcode }: { shortcode: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-sm bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-700">
        {shortcode}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          navigator.clipboard
            ?.writeText(shortcode)
            .then(() => setCopied(true))
            // Clipboard access can be refused; the code is on screen to select.
            .catch(() => setCopied(false));
        }}
      >
        {copied ? 'Copied' : 'Copy shortcode'}
      </Button>
    </div>
  );
}
