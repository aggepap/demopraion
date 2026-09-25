'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { defaultLocale } from '@/lib/i18n/config';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * GDPR cookie banner.
 *
 * The admin-managed cookie catalogue used to govern nothing a visitor ever saw: the
 * banner never fetched it, offered accept-all / reject-all and nothing else, and the
 * decision was written to `localStorage` and nowhere else (F-065). Three things
 * follow from that and all three are here now — the categories an admin declares are
 * the categories a visitor is asked about, each can be decided separately, and the
 * decision is recorded server-side so it can be shown afterwards.
 *
 * Every key carries the site's storage prefix (`src/lib/storage-keys.ts`):
 * - `<prefix>-cookie-consent` still holds "accepted" | "rejected" | "custom", so
 *   whatever is already in a returning visitor's browser keeps working.
 * - `<prefix>-cookie-categories` holds the per-category decision.
 * - `<prefix>-visitor-ref` is a random id, generated here, that ties a later change of
 *   mind to the earlier record without identifying anybody.
 * - On a choice, a `<prefix>-consent-changed` event fires so consumers react without a
 *   reload, and the decision is POSTed best-effort.
 * - `useSyncExternalStore` so SSR renders a stable "loading" snapshot and the real
 *   value is picked up after hydration without a flash.
 */

export const CONSENT_STORAGE_KEY = STORAGE_KEYS.cookieConsent;
export const CONSENT_CATEGORIES_KEY = STORAGE_KEYS.cookieCategories;
export const VISITOR_REF_KEY = STORAGE_KEYS.visitorRef;
export const CONSENT_EVENT = STORAGE_KEYS.consentEvent;
export type ConsentValue = 'accepted' | 'rejected' | 'custom';
export type ConsentSnapshot = 'loading' | 'accepted' | 'rejected' | 'custom' | 'undecided';

interface ConsentCategory {
  key: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  required: boolean;
  services: { name: string; provider: string | null; purpose: Record<string, string> | null }[];
}

function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Reading localStorage is not a safe operation. A browser set to block site
 * data — Safari in private browsing, Chrome with site data blocked, most
 * in-app webviews — does not return null from `getItem`, it THROWS. This
 * function is `useSyncExternalStore`'s getSnapshot, so a throw here happens
 * during render: the visitor who is most careful about tracking would have
 * been the one who got a page that failed to hydrate.
 *
 * Treated as "undecided", which shows the banner. Their choice cannot be
 * remembered, so they are asked again — which is the honest outcome, and the
 * one the banner already handles.
 */
/** Holds the answer when the browser will not. Lives for this page view only. */
let memoryConsent: ConsentValue | null = null;

function readConsentSnapshot(): ConsentSnapshot {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    // Blocked storage. Fall back to what was answered a moment ago, if
    // anything: without this the banner reappears the instant it is
    // dismissed, because the value it just wrote was never kept.
    raw = memoryConsent;
  }
  if (raw === 'accepted') return 'accepted';
  if (raw === 'rejected') return 'rejected';
  if (raw === 'custom') return 'custom';
  return 'undecided';
}

function serverConsentSnapshot(): ConsentSnapshot {
  return 'loading';
}

export function useConsent(): ConsentSnapshot {
  return useSyncExternalStore(subscribeConsent, readConsentSnapshot, serverConsentSnapshot);
}

const NO_CATEGORIES: Record<string, boolean> = {};

/*
 * The parsed decision, cached against the exact string it was parsed from.
 *
 * `useSyncExternalStore` compares snapshots by identity, so a getSnapshot that
 * parses JSON afresh returns a new object every render and React re-renders forever
 * — "Maximum update depth exceeded", which is precisely what a first attempt at this
 * did. Caching on the raw string means the reference only changes when the stored
 * value actually does, and no `useMemo` in a consumer could have fixed it.
 */
let cachedRaw: string | null = null;
let cachedCategories: Record<string, boolean> = NO_CATEGORIES;

/** Holds the per-category answer when the browser will not. This page view only. */
let memoryCategories: string | null = null;

/**
 * The per-category decision, or `{}` when nothing has been decided yet.
 *
 * Reads through the same try/catch as `readConsentSnapshot` and for the same
 * reason: this is also a `useSyncExternalStore` getSnapshot, so a browser that
 * throws on `getItem` (Safari private browsing, blocked site data, most in-app
 * webviews) would throw during render.
 */
function readCategories(): Record<string, boolean> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONSENT_CATEGORIES_KEY);
  } catch {
    raw = memoryCategories;
  }
  if (raw === cachedRaw) return cachedCategories;
  cachedRaw = raw;
  cachedCategories = NO_CATEGORIES;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachedCategories = parsed as Record<string, boolean>;
    }
  } catch {
    /* a corrupted value means undecided, not a crash */
  }
  return cachedCategories;
}

/**
 * Whether one category has been granted.
 *
 * A consumer with no category of its own — because the admin has not declared one —
 * falls back to the blanket flag, which is what every consumer used before. So
 * declaring a category can only tighten things, never loosen them, and a site with an
 * empty catalogue behaves exactly as it did.
 */
export function useCategoryConsent(categoryKey: string): boolean {
  const snapshot = useConsent();
  const categories = useSyncExternalStore(subscribeConsent, readCategories, () => NO_CATEGORIES);
  if (snapshot === 'loading' || snapshot === 'undecided') return false;
  if (Object.prototype.hasOwnProperty.call(categories, categoryKey)) return categories[categoryKey];
  return snapshot === 'accepted';
}

function visitorRef(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_REF_KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* blocked storage — a fresh ref below, unlinkable to any earlier one */
  }
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  try {
    window.localStorage.setItem(VISITOR_REF_KEY, fresh);
  } catch {
    /* not persisted — a change of mind simply will not tie back to this record */
  }
  return fresh;
}

function writeConsent(
  value: ConsentValue,
  categories: Record<string, boolean>,
  policyVersion: string | null,
) {
  // Recorded in memory first: writing can fail for the same reasons reading
  // can, plus a full quota. That means the answer is honoured for this visit
  // whatever storage does, and only its survival to the next visit is at stake
  // — without it the banner reappears the instant it is dismissed.
  memoryConsent = value;
  memoryCategories = JSON.stringify(categories);
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
    window.localStorage.setItem(CONSENT_CATEGORIES_KEY, memoryCategories);
  } catch {
    /* choice not persisted — they will be asked again next visit */
  }
  window.dispatchEvent(new CustomEvent<ConsentValue>(CONSENT_EVENT, { detail: value }));

  /*
   * Stored locally first, then reported. The visitor's choice has to take effect even
   * with no network — what is best-effort here is the record, not the behaviour, which
   * is the right way round.
   */
  void fetch('/api/cookies/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorRef: visitorRef(),
      decision: value,
      categories,
      policyVersion,
      locale: document.documentElement.lang || null,
    }),
    keepalive: true,
  }).catch(() => {
    /* the choice already applies */
  });
}

export function CookieBanner() {
  const t = useTranslations('cookies');
  const snapshot = useConsent();
  const [options, setOptions] = useState<{
    policyVersion: string | null;
    categories: ConsentCategory[];
  }>({ policyVersion: null, categories: [] });
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [detailed, setDetailed] = useState(false);

  const undecided = snapshot === 'undecided';

  useEffect(() => {
    // Only when there is a decision to make — no request on a page a returning
    // visitor loads.
    if (!undecided) return;
    let alive = true;
    fetch('/api/cookies/consent')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (alive && json?.data) setOptions(json.data);
      })
      .catch(() => {
        /* accept-all / reject-all work regardless */
      });
    return () => {
      alive = false;
    };
  }, [undecided]);

  const optional = options.categories.filter((c) => !c.required);

  const localeName = useCallback((map: Record<string, string> | null) => {
    if (!map) return '';
    const lang = typeof document === 'undefined' ? defaultLocale : document.documentElement.lang || defaultLocale;
    return map[lang] ?? Object.values(map)[0] ?? '';
  }, []);

  const decideAll = (value: boolean) => {
    const all: Record<string, boolean> = {};
    for (const c of options.categories) all[c.key] = c.required ? true : value;
    writeConsent(value ? 'accepted' : 'rejected', all, options.policyVersion);
  };

  const saveChoices = () => {
    const chosen: Record<string, boolean> = {};
    for (const c of options.categories) chosen[c.key] = c.required ? true : granted[c.key] === true;
    const allOptional = optional.every((c) => chosen[c.key]);
    const noOptional = optional.every((c) => !chosen[c.key]);
    // Named for what it is, so the stored record is not misleading.
    writeConsent(
      allOptional ? 'accepted' : noOptional ? 'rejected' : 'custom',
      chosen,
      options.policyVersion,
    );
  };

  // Nothing during SSR + initial hydration, and nothing once a choice is recorded.
  if (!undecided) return null;

  return (
    <div
      role="region"
      aria-label={t('ariaLabel')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-soft bg-soft-pearl text-midnight-navy"
    >
      <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
          <p className="font-body text-sm md:text-base leading-relaxed text-text-primary max-w-3xl">
            <span className="font-display font-medium mr-2">{t('title')}.</span>
            {t('body')}
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 shrink-0">
            <Button variant="primary" size="sm" onClick={() => decideAll(true)}>
              {t('acceptAll')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => decideAll(false)}>
              {t('rejectAll')}
            </Button>
            {optional.length > 0 ? (
              /*
                A real control rather than a link away. "Preferences" used to navigate
                to a read-only cookie statement with no input on it at all, so someone
                willing to accept one thing and not another had nowhere to say so.
              */
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={detailed}
                onClick={() => {
                  setGranted((current) => {
                    const next = { ...current };
                    for (const c of optional) if (!(c.key in next)) next[c.key] = false;
                    return next;
                  });
                  setDetailed((v) => !v);
                }}
              >
                {t('preferences')}
              </Button>
            ) : (
              <ButtonLink href="/legal/cookies" variant="ghost" size="sm">
                {t('preferences')}
              </ButtonLink>
            )}
          </div>
        </div>

        {detailed && optional.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border-soft pt-4">
            {options.categories
              .filter((c) => c.required)
              .map((c) => (
                <p key={c.key} className="font-body text-xs text-text-secondary">
                  <strong className="font-medium">{localeName(c.name)}</strong> — {t('alwaysOn')}
                </p>
              ))}
            {optional.map((c) => (
              <label key={c.key} className="flex items-start gap-3 font-body text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={granted[c.key] === true}
                  onChange={(e) => setGranted((cur) => ({ ...cur, [c.key]: e.target.checked }))}
                />
                <span>
                  <span className="font-medium">{localeName(c.name)}</span>
                  {localeName(c.description) ? (
                    <span className="block text-xs text-text-secondary">
                      {localeName(c.description)}
                    </span>
                  ) : null}
                  {c.services.length > 0 ? (
                    <span className="block text-xs text-text-secondary">
                      {c.services.map((s) => s.provider ?? s.name).join(', ')}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
            <div className="flex gap-3">
              <Button variant="primary" size="sm" onClick={saveChoices}>
                {t('savePreferences')}
              </Button>
              <ButtonLink href="/legal/cookies" variant="ghost" size="sm">
                {t('readPolicy')}
              </ButtonLink>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
