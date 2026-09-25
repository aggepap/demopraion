/**
 * Variant-gallery resolution ("photo per colour", addendum §2).
 *
 * Pure so both the client showcase and unit tests use it. Given the current
 * attribute selection, returns the gallery of the first selected attribute
 * value that carries one, falling back to the product's base gallery when no
 * selected value has variant images. Keyed by attribute *value* (e.g. the
 * "Blue" colour), not by the full variation combination — selecting a colour
 * swaps the gallery regardless of the size chosen.
 */
export function resolveActiveGallery<T>(
  attributes: { id: string; values: { id: string; gallery?: T[] }[] }[],
  selected: Record<string, string>,
  base: T[],
): T[] {
  for (const attr of attributes) {
    const valueId = selected[attr.id];
    if (!valueId) continue;
    const value = attr.values.find((v) => v.id === valueId);
    if (value?.gallery && value.gallery.length > 0) return value.gallery;
  }
  return base;
}
