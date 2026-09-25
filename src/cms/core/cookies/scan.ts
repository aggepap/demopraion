/**
 * The declaration against what the site actually stores.
 *
 * The catalogue is typed by hand and the code that sets cookies moves
 * independently, so the two drift the moment somebody forgets. A cookie policy
 * that is merely out of date is the one state this table must not be in, and
 * nothing until now could tell you it had happened.
 *
 * Pure, over data the callers supply: the detection reads a setting, the
 * comparison reads the declaration, and neither reaches for a database here.
 */
import type { CategoryWithServices } from './declaration';
import {
  alwaysPresent,
  gaContainerId,
  GOOGLE_ANALYTICS_REGISTRY,
  type RegisteredService,
} from './registry';

export type DetectedService = RegisteredService;

/** Where a matched service was declared — a row an admin wrote, or the
 *  automatic entry the declaration layer adds when analytics is configured. */
export type DeclaredBy = 'stored' | 'automatic';

export interface MatchedService extends DetectedService {
  declaredBy: DeclaredBy;
  /** The category it is declared under, which may differ from the suggestion. */
  declaredUnder: string;
}

export interface DeclaredOnlyService {
  name: string;
  provider: string | null;
  categoryKey: string;
  enabled: boolean;
}

export interface CookieScan {
  /** Stored or auto-declared, and actually used. Nothing to do. */
  matched: MatchedService[];
  /** Used, and the visitor is not told. This is the list that matters. */
  undeclared: DetectedService[];
  /** Declared, but not something this scanner knows how to detect. Could be a
   *  service added by hand and perfectly real — informational, never an error. */
  unknownToScanner: DeclaredOnlyService[];
}

/** Same rule the GA auto-declaration uses, so the two agree about what a name is. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * What this install stores, given how it is configured.
 *
 * Analytics is the only conditional part today: no measurement ID means gtag is
 * never injected, so those cookies genuinely do not exist and must not be
 * listed. Any non-empty ID counts, matching what `AnalyticsLoader` will load —
 * but a value that is not a real ID yields no `_ga_<container>` key, because
 * that container name was never issued.
 */
export function detectServices(config: { gaId: string; storagePrefix: string }): DetectedService[] {
  const services: DetectedService[] = alwaysPresent(config.storagePrefix);

  const gaId = config.gaId.trim();
  if (gaId) {
    const container = gaContainerId(gaId);
    services.push({
      ...GOOGLE_ANALYTICS_REGISTRY,
      keys: container
        ? [...GOOGLE_ANALYTICS_REGISTRY.keys, { name: `_ga_${container}`, kind: 'cookie' }]
        : [...GOOGLE_ANALYTICS_REGISTRY.keys],
    });
  }

  return services;
}

/**
 * Compared against the *effective* declaration — stored rows plus the automatic
 * analytics entry — because that is what a visitor is actually shown. Comparing
 * against the raw table would report GA as missing while `/legal/cookies` was
 * already publishing it, and ask an admin to duplicate a row for no reason.
 *
 * A disabled row still counts as declared: switching one off is a deliberate
 * act, and re-proposing it would overrule the person who did it.
 */
export function compareToDeclaration(
  detected: DetectedService[],
  declaration: CategoryWithServices[],
): CookieScan {
  const declaredByName = new Map<string, { category: CategoryWithServices; service: CategoryWithServices['services'][number] }>();
  for (const category of declaration) {
    for (const service of category.services) {
      declaredByName.set(normalizeName(service.name), { category, service });
    }
  }

  const matched: MatchedService[] = [];
  const undeclared: DetectedService[] = [];
  const seen = new Set<string>();

  for (const service of detected) {
    const key = normalizeName(service.name);
    const hit = declaredByName.get(key);
    if (!hit) {
      undeclared.push(service);
      continue;
    }
    seen.add(key);
    matched.push({
      ...service,
      // A negative id is the sentinel the declaration layer uses for the rows it
      // synthesises; anything else came out of the database.
      declaredBy: hit.service.id < 0 ? 'automatic' : 'stored',
      declaredUnder: hit.category.key,
    });
  }

  const unknownToScanner: DeclaredOnlyService[] = [];
  for (const category of declaration) {
    for (const service of category.services) {
      const key = normalizeName(service.name);
      if (seen.has(key)) continue;
      unknownToScanner.push({
        name: service.name,
        provider: service.provider,
        categoryKey: category.key,
        enabled: service.enabled,
      });
    }
  }

  return { matched, undeclared, unknownToScanner };
}
