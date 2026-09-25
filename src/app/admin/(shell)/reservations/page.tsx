import { notFound } from 'next/navigation';

import { ReservationsTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { listReservationExperiences, listReservations } from '@/cms/modules/booking';
import { parseReservationFilters, toListOptions } from '@/cms/modules/booking/reservation-filters';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

/**
 * Reservations — the bookings customers have made.
 *
 * Filtered and paged on the server from the URL's query string, so every
 * booking is reachable, not just the newest hundred the list used to load.
 */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isModuleEnabled(config, 'booking'))) notFound();
  const user = await requirePerm(PERMISSIONS.reservationsRead);
  // The sidebar shows this screen on `reservationsRead` alone, so a read-only
  // role reaches it — and every write control on it would be refused.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.reservationsWrite);

  const filters = parseReservationFilters(await searchParams);
  const [result, waiting, experiences] = await Promise.all([
    listReservations(toListOptions(filters)),
    // The header counts everything in "Needs action" — unanswered requests and
    // payments that could not be applied — not just what is on this page.
    listReservations({ needsAction: true, pageSize: 1 }),
    listReservationExperiences(),
  ]);
  const pending = waiting.total;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Reservations</h1>
        {pending > 0 ? (
          <p className="text-sm text-neutral-600">
            {pending} {pending === 1 ? 'booking needs' : 'bookings need'} your action
          </p>
        ) : null}
      </div>

      <ReservationsTable
        // Keyed on the query so the filter bar's own inputs (the search box)
        // start from the URL again after a navigation.
        key={JSON.stringify(filters)}
        initial={JSON.parse(
          JSON.stringify({ items: result.items, total: result.total, page: result.page, pageSize: result.pageSize }),
        )}
        filters={filters}
        experiences={experiences}
        canWrite={canWrite}
      />
    </div>
  );
}
