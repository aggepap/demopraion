import { Eyebrow } from '@/components/ui/Eyebrow';

/** The heading block at the top of a page: optional kicker, title, optional intro. */
export function PageIntro({ eyebrow, title, intro }: { eyebrow?: string; title: string; intro?: string }) {
  return (
    <header className="max-w-3xl">
      {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
      <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] text-midnight-navy">
        {title}
      </h1>
      {intro ? <p className="mt-6 text-lg leading-relaxed text-text-muted">{intro}</p> : null}
    </header>
  );
}
