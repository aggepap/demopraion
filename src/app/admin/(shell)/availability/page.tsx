import { notFound } from 'next/navigation';

import { AvailabilityCalendar } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

/**
 * Booking availability — per-date capacity, blackout dates and price overrides.
 *
 * Each experience declares its own season, weekdays, capacity and cut-off in
 * its editor; that is the rule, and this screen never touches it. This is where
 * the EXCEPTIONS live: closing one date, changing what it can take, pricing it
 * differently.
 */
export default async function AvailabilityPage() {
  if (!(await isModuleEnabled(config, 'booking'))) notFound();
  const user = await requirePerm(PERMISSIONS.scheduleRead);
  // The sidebar shows this screen on `scheduleRead` alone, so a read-only role
  // reaches it — and every write control on it would be refused by the API.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.scheduleWrite);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Availability</h1>
        <p className="text-sm text-neutral-600">
          Season, weekdays and default capacity are set on each experience. This is for the exceptions.
        </p>
      </div>

      <AvailabilityCalendar canWrite={canWrite} />
    </div>
  );
}
