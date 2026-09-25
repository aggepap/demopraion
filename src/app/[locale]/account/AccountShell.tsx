import type { ReactNode } from 'react';

import { Eyebrow } from '@/components/ui/Eyebrow';

/** The frame every account screen sits in: eyebrow, title, and the content. */
export function AccountShell({
  eyebrow,
  title,
  intro,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-soft-pearl pt-20 pb-24 md:pt-28">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Eyebrow className="mb-4">{eyebrow}</Eyebrow>
            <h1 className="font-display text-midnight-navy text-3xl leading-[1.1] font-semibold tracking-tight md:text-4xl">
              {title}
            </h1>
            {intro ? <p className="font-body text-text-muted mt-3 text-base">{intro}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}
