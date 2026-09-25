import 'server-only';

import type { CmsConfig } from '../../config';
import { getSettings } from './index';
import { moduleSettingKey } from './schema';

/**
 * Effective module flags: the config's compile-time defaults, overridden by any
 * `module.<name>` value stored in `site_settings`. This is what lets the admin
 * Modules toggle enable/disable a module (e.g. commerce) at runtime without a
 * code change. Cached + tag-revalidated exactly like every other setting read.
 */
export async function resolveModuleFlags(config: CmsConfig): Promise<Record<string, boolean>> {
  const names = Object.keys(config.modules);
  const stored = await getSettings<boolean>(names.map(moduleSettingKey));
  const flags: Record<string, boolean> = {};
  for (const name of names) {
    const override = stored[moduleSettingKey(name)];
    flags[name] =
      typeof override === 'boolean'
        ? override
        : Boolean(config.modules[name as keyof typeof config.modules]);
  }
  return flags;
}

/** Whether a single module is enabled (config default + DB override). */
export async function isModuleEnabled(config: CmsConfig, name: string): Promise<boolean> {
  const flags = await resolveModuleFlags(config);
  return Boolean(flags[name]);
}
