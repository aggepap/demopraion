/**
 * Integration secrets — what may be stored, and what the admin may see.
 *
 * Until now every third-party credential lived in the environment. Integrations
 * that the site owner connects themselves (a Google Business Profile refresh
 * token, a Places API key, courier credentials) cannot: they are entered in the
 * admin and change without a deploy. They are stored encrypted in
 * `integration_secrets` with the same AES-GCM helper as the PM bridge tokens.
 *
 * This file is the client-safe half. A module declares its keys as
 * `SecretKeyDef`s; only declared keys are writable, and the admin receives a
 * summary that says whether each is set and shows at most its last four
 * characters. The value itself never leaves the server.
 */

export interface SecretKeyDef {
  /** Dotted name, e.g. `google.places.apiKey`. */
  key: string;
  label: string;
  /** The module whose settings screen shows it. */
  module?: string;
  description?: string;
}

export interface StoredSecretMeta {
  key: string;
  hint: string;
  updatedAt: Date;
}

export interface SecretSummary {
  key: string;
  label: string;
  module: string | null;
  set: boolean;
  masked: string | null;
  updatedAt: string | null;
}

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

export function isValidSecretKey(key: string): boolean {
  return key.length <= 128 && KEY_PATTERN.test(key);
}

/** Below this length a secret shows nothing of itself — four characters of a
 *  short value is too large a share of it. */
const HINT_MIN_LENGTH = 12;

/** The part of a secret the admin may see again: its last four characters. */
export function secretHint(plaintext: string): string {
  const value = plaintext.trim();
  return value.length >= HINT_MIN_LENGTH ? value.slice(-4) : '';
}

export function maskSecret(hint: string): string {
  return `••••${hint}`;
}

/** One row per declared key, in declaration order. Undeclared rows are hidden. */
export function summariseSecrets(
  defs: readonly SecretKeyDef[],
  stored: readonly StoredSecretMeta[]
): SecretSummary[] {
  const byKey = new Map(stored.map((row) => [row.key, row]));
  return defs.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      module: def.module ?? null,
      set: Boolean(row),
      masked: row ? maskSecret(row.hint) : null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
}
