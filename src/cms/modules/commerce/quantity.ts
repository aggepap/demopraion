/**
 * Quantity rules (addendum §6) — pure + dependency-free, so the client buy box,
 * the cart drawer and the server checkout share one authority and can't
 * disagree. No server imports here (this file is safe to bundle into a client
 * component).
 */

export interface QuantityRules {
  min: number;
  /** null = no cap. */
  max: number | null;
  step: number;
  soldIndividually: boolean;
}

/** Read a product's purchase limits into a normalized shape (safe defaults). */
export function quantityRules(data: Record<string, unknown>): QuantityRules {
  const soldIndividually = data.soldIndividually === true;
  const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
  const step = Math.max(1, Math.floor(num(data.qtyStep) ?? 1));
  const min = soldIndividually ? 1 : Math.max(1, Math.floor(num(data.minQty) ?? 1));
  const maxRaw = num(data.maxQty);
  const max = soldIndividually ? 1 : maxRaw != null ? Math.max(min, Math.floor(maxRaw)) : null;
  return { min, max, step, soldIndividually };
}

/**
 * Snap a requested quantity to a product's rules: clamp to [min, max] and round
 * to the nearest whole number of steps from `min`.
 */
export function clampQuantity(rules: QuantityRules, qty: number): number {
  if (rules.soldIndividually) return 1;
  const step = Math.max(1, rules.step);
  let q = Math.max(rules.min, Math.floor(Number.isFinite(qty) ? qty : rules.min));
  q = rules.min + Math.round((q - rules.min) / step) * step;
  if (q < rules.min) q = rules.min;
  if (rules.max != null && q > rules.max) {
    q = rules.min + Math.floor((rules.max - rules.min) / step) * step;
  }
  return q;
}
