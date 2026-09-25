import 'server-only';

import { sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { getDb } from '../../db';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { logAudit } from '../audit';
import { notFound, unauthorized } from '../errors';
import {
  authorizeCronRequest,
  CRON_SECRET_HEADER,
  resolveCronJob,
  type CronJobDef,
  type CronJobMap,
  type CronJobResult,
} from './policy';

/** First value of the first row, whichever result shape the driver returned. */
function firstValue(result: unknown): unknown {
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row && typeof row === 'object' ? Object.values(row)[0] : undefined;
}

export type CronRunOutcome =
  | { status: 'ran'; result: CronJobResult }
  | { status: 'skipped'; reason: 'already_running' };

/**
 * Run a job under a MySQL named lock, so two overlapping scheduler calls never
 * run the same job at once.
 *
 * `GET_LOCK` belongs to a connection, and the pool would hand `RELEASE_LOCK`
 * to a different one. The transaction is only there to pin one connection for
 * the lock's lifetime; the job's own queries use the pool as usual. A crashed
 * process drops its connection, and the server releases the lock with it.
 */
export async function runCronJob(name: string, job: CronJobDef): Promise<CronRunOutcome> {
  const lockName = `cms-cron:${name}`;
  return getDb().transaction(async (tx) => {
    const got = Number(firstValue(await tx.execute(sql`SELECT GET_LOCK(${lockName}, 0) AS got`)));
    if (got !== 1) return { status: 'skipped', reason: 'already_running' } as const;
    try {
      return { status: 'ran', result: await job.run() } as const;
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
    }
  });
}

const hasCronSecret = (req: NextRequest): boolean =>
  authorizeCronRequest(req.headers.get(CRON_SECRET_HEADER), process.env.CMS_CRON_SECRET);

/**
 * `POST /api/cms/cron/[job]` — authorised only by `x-cron-secret`
 * (`CMS_CRON_SECRET`). The site's glue passes the job map and the resolved
 * module flags, since core must not import the site config.
 */
export function cronRoute(opts: {
  jobs: CronJobMap;
  moduleFlags: () => Promise<Record<string, boolean>>;
}) {
  return createRoute({
    // A scheduler is not a browser; the secret is the whole authorisation.
    sameOrigin: false,
    // Guessing budget for the secret, and a cap on how often real work can be triggered.
    // A scheduler on the same host reaches the app directly, with no X-Real-IP;
    // holding the secret is what lets it past the missing-IP refusal.
    rateLimit: { scope: 'cms-cron', max: 30, windowMs: 60_000, trustedWithoutIp: hasCronSecret },
    guard: (req: NextRequest) => {
      if (!hasCronSecret(req)) throw unauthorized();
      return { actor: 'cron' as const };
    },
    handler: async ({ params }) => {
      const name = params.job ?? '';
      const lookup = resolveCronJob(opts.jobs, name, await opts.moduleFlags());
      if (lookup.kind === 'not_found') throw notFound();
      const outcome = await runCronJob(name, lookup.job);
      if (outcome.status === 'ran') {
        await logAudit({
          actorLabel: 'cron',
          action: 'cron.run',
          subjectType: 'cron',
          subjectId: name,
        });
      }
      return ok(outcome);
    },
  });
}
