/**
 * Scheduled jobs — the decisions, without the request or the database.
 *
 * The CMS runs nothing on a timer itself. An external scheduler (cron, a
 * hosting panel, a systemd timer) calls `POST /api/cms/cron/<job>` with the
 * `x-cron-secret` header, and that header is the only thing that authorises a
 * run: jobs send email, cancel orders and call paid APIs, so every
 * misconfiguration resolves to "refuse".
 *
 * Jobs are handed to the route as a plain map by the site's glue file, not
 * registered by import side effect — the list of what can run is then one
 * readable object, and a module that is compiled out cannot leave a job behind.
 */
import { timingSafeEquals } from '../tokens/crypto';

/** The shortest `CMS_CRON_SECRET` accepted; matches the other shared secrets. */
export const CRON_SECRET_MIN_LENGTH = 32;

/** The header an external scheduler sends. */
export const CRON_SECRET_HEADER = 'x-cron-secret';

export interface CronJobResult {
  [key: string]: unknown;
}

export interface CronJobDef {
  /** The module that must be switched on for the job to exist. */
  module?: string;
  run: () => Promise<CronJobResult>;
}

export type CronJobMap = Record<string, CronJobDef>;

/**
 * Whether a request may run a job. A missing or short configured secret refuses
 * everything, so an empty header can never match an empty secret.
 */
export function authorizeCronRequest(
  header: string | null | undefined,
  secret: string | undefined
): boolean {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) return false;
  return timingSafeEquals(header, secret);
}

const JOB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidCronJobName(name: string): boolean {
  return name.length <= 64 && JOB_NAME.test(name);
}

export type CronJobLookup = { kind: 'ok'; job: CronJobDef } | { kind: 'not_found' };

/**
 * Find a job by name. An unknown job and a job whose module is off get the same
 * answer — the same 404 every other module-gated endpoint gives.
 */
export function resolveCronJob(
  jobs: CronJobMap,
  name: string,
  moduleFlags: Readonly<Record<string, boolean>>
): CronJobLookup {
  if (!isValidCronJobName(name) || !Object.hasOwn(jobs, name)) return { kind: 'not_found' };
  const job = jobs[name];
  if (job.module && moduleFlags[job.module] !== true) return { kind: 'not_found' };
  return { kind: 'ok', job };
}
