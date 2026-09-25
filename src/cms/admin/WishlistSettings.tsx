'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Checkbox, Field, Section, TextInput } from './ui';

/**
 * Settings → Ecommerce → Wishlist.
 *
 * Three questions and no more: is it on, how much may one list hold, and does
 * the shop want the anonymous "added to wishlist" count. The last is opt-in
 * because it writes a row per product per day, and a shop that never looks at
 * the number should not be collecting it.
 */

const WISHLIST_KEY = 'ecommerce.wishlist';

export interface WishlistConfigView {
  enabled: boolean;
  maxItems: number;
  trackStats: boolean;
}

export function WishlistSettings({ initial }: { initial: WishlistConfigView }) {
  const [config, setConfig] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await cmsApi.updateSiteSettings({ [WISHLIST_KEY]: config });
      setSaved(true);
    } catch (err) {
      setError(apiErrorText(err, 'Could not save the wishlist settings.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Wishlist">
      <div className="flex max-w-lg flex-col gap-4">
        <Checkbox
          label="Let shoppers save products to a wishlist"
          info="Adds a heart to product cards and the product page, a link in the header, and the /wishlist page."
          hint="Switching it off hides all of them and the /wishlist page answers 404."
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        <Field
          label="Maximum products in one wishlist"
          description="Between 1 and 200. A guest's list lives in their own browser, so this also bounds what the browser has to carry."
        >
          <TextInput
            type="number"
            min={1}
            max={200}
            value={String(config.maxItems)}
            onChange={(e) => setConfig({ ...config, maxItems: Number(e.target.value) })}
          />
        </Field>
        <Checkbox
          label="Count how often each product is saved"
          info="An anonymous daily total per product, shown on the product list. No visitor is identified and nothing is stored about who saved what."
          checked={config.trackStats}
          onChange={(e) => setConfig({ ...config, trackStats: e.target.checked })}
        />
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-green-700">
            Saved.
          </p>
        ) : null}
        <Button type="button" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
      </div>
    </Section>
  );
}
