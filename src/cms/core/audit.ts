import 'server-only';

import { and, desc, eq, gt, or, sql, type SQL } from 'drizzle-orm';

import { getDb, schema } from '../db';
import { auditGroupFilter } from './audit-groups';
import { likeTerm } from './db/like';
import { clientIpLabel } from './rate-limit';

export interface AuditEntry {
  userId?: number | null;
  /**
   * Who acted, when it was not a person — `api-token:Product Manager`.
   *
   * `listAuditLogs` renders the actor by joining `admin_users`, so a row with a
   * null `user_id` showed a blank name. That made the log actively misleading
   * exactly where attribution matters most: "someone changed every page title
   * last Tuesday" is only actionable if the log says which token.
   */
  actorLabel?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  ua?: string | null;
}

/**
 * Write an audit-log entry. Failures are swallowed (a missing audit row must
 * never break the user-facing action) but logged. Ported from v1
 * `src/admin/lib/audit.ts`, retargeted to the CMS db binding.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.auditLogs).values({
      userId: entry.userId ?? null,
      actorLabel: entry.actorLabel ?? null,
      action: entry.action,
      subjectType: entry.subjectType ?? null,
      subjectId:
        entry.subjectId === undefined || entry.subjectId === null
          ? null
          : String(entry.subjectId),
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      ua: entry.ua ? entry.ua.slice(0, 255) : null,
    });
  } catch (err) {
    console.error('[audit] failed to write entry', { action: entry.action }, err);
  }
}

/**
 * Which pair of audit actions a lockout counts. Defaults to the password step.
 *
 * Generalised when the second factor arrived: the code prompt needs exactly the
 * same per-account budget as the password prompt, over its own pair of actions,
 * and duplicating this query would have meant two places where "count only
 * since the last success" could drift apart.
 */
export interface AuthFailureActions {
  failAction: string;
  successAction: string;
}

/**
 * Failed attempts for one email since that email last succeeded, within
 * `windowMs`.
 *
 * Login was defended by a per-IP rate limit alone, which is the one dimension
 * an attacker controls freely: ten guesses per IP, and any botnet or proxy pool
 * turns that into unlimited guesses against a single administrator's password.
 * Counting per ACCOUNT closes that, and the audit log already records every
 * attempt against `subject_type = 'email'` under an index — so this needs no
 * new table and no new write on the hot path.
 *
 * Counting only since the last SUCCESS is what keeps this from becoming a way
 * to lock a real administrator out: whoever knows the password gets straight
 * back in, and their success resets the count for everyone.
 */
export async function recentAuthFailures(
  email: string,
  windowMs: number,
  actions: AuthFailureActions = { failAction: 'auth.login.fail', successAction: 'auth.login.success' },
): Promise<number> {
  try {
    const db = getDb();
    const since = new Date(Date.now() - windowMs);
    const subject = [
      eq(schema.auditLogs.subjectType, 'email'),
      eq(schema.auditLogs.subjectId, email),
      gt(schema.auditLogs.createdAt, since),
    ];

    const [lastSuccess] = await db
      .select({ at: schema.auditLogs.createdAt })
      .from(schema.auditLogs)
      .where(and(...subject, eq(schema.auditLogs.action, actions.successAction)))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(1);

    const conds = [...subject, eq(schema.auditLogs.action, actions.failAction)];
    if (lastSuccess) conds.push(gt(schema.auditLogs.createdAt, lastSuccess.at));

    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.auditLogs)
      .where(and(...conds));
    return Number(row?.n ?? 0);
  } catch (err) {
    // The audit table is not on the critical path for authentication. If it
    // cannot be read, fall back to "no failures" — refusing every login because
    // a log query broke would be a self-inflicted outage.
    console.error('[audit] failed to count auth failures', err);
    return 0;
  }
}

/** The password step's lockout counter. Kept so existing call sites read the same. */
export function recentLoginFailures(email: string, windowMs: number): Promise<number> {
  return recentAuthFailures(email, windowMs);
}


/**
 * Best-effort client IP + UA from request headers (for audit rows).
 *
 * Delegates to `clientIpLabel` rather than re-reading the header, which is how
 * this drifted before: it used to prefer `x-forwarded-for`, so the address in
 * the forensic record was the one the request's own author chose, while the
 * rate limiter next door documented that same header as spoofable and refused
 * it. Two mechanisms in one codebase disagreeing about which header to trust is
 * worse than either choice — so now there is only one implementation, including
 * its development-only fallback.
 */
export function extractRequestMeta(req: Request): { ip: string | null; ua: string | null } {
  const ua = req.headers.get('user-agent');
  const label = clientIpLabel(req);
  return { ip: label === 'unknown' ? null : label, ua };
}

export interface AuditLogRow {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: Date;
  /**
   * Forensic detail. Stored since the log existed and never once shown — the
   * screen answered "who changed what" but not "from where", which is the
   * question that actually matters when the answer to the first one is
   * surprising.
   */
  ip: string | null;
  ua: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditQuery {
  /** Substring of the action key or the actor's name. */
  search?: string;
  /** Exact subject type, e.g. `article` or `media_file`. */
  subjectType?: string;
  /** An `AUDIT_ACTION_GROUPS` key — filters by what happened, not what it happened to. */
  group?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  items: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Every `subject_type` present in the log, for the filter dropdown. */
  subjectTypes: string[];
}

const AUDIT_PAGE_SIZE = 50;

/**
 * A page of audit entries, newest first, with the actor's name joined in.
 *
 * This used to return the newest 200 rows and nothing else — no filter, no
 * search, no way to reach row 201. The audit log is the screen someone opens to
 * answer one question ("who changed this, and when?"), and the only way to
 * answer it was to scroll a table several thousand pixels tall and use the
 * browser's own find. Worse, the answer might not be on the page at all: after
 * 200 entries the older ones were simply unreachable, and nothing said so.
 *
 * Filtering happens in SQL rather than in the browser, because the rows that
 * matter are usually the ones that were never sent.
 */
export async function listAuditLogs(query: AuditQuery = {}): Promise<AuditPage> {
  const db = getDb();
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? AUDIT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(query.page ?? 1));

  const conds: SQL[] = [];
  const search = query.search?.trim();
  if (search) {
    const like = likeTerm(search);
    conds.push(
      or(
        sql`${schema.auditLogs.action} like ${like}`,
        sql`${schema.adminUsers.name} like ${like}`,
        sql`${schema.auditLogs.subjectId} like ${like}`,
      )!,
    );
  }
  const subjectType = query.subjectType?.trim();
  if (subjectType) conds.push(eq(schema.auditLogs.subjectType, subjectType));

  /*
   * The group filter, as an OR of prefix matches. An unknown key yields no
   * patterns and is ignored rather than matching nothing — a stale bookmark
   * should show the unfiltered log, not an empty table that looks like the
   * audit trail has been wiped.
   */
  const group = query.group?.trim();
  if (group) {
    const { include, exclude } = auditGroupFilter(group);
    if (include.length) {
      conds.push(or(...include.map((p) => sql`${schema.auditLogs.action} like ${p}`))!);
      // See `auditGroupFilter`: SQL has no "first match wins", so a later group
      // has to actively disown what an earlier one claimed.
      for (const p of exclude) conds.push(sql`${schema.auditLogs.action} not like ${p}`);
    }
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      userId: schema.auditLogs.userId,
      // Falls back to the non-human actor label, so a bridge write reads as
      // "api-token: Product Manager" rather than as a blank cell.
      userName: sql<string | null>`coalesce(${schema.adminUsers.name}, ${schema.auditLogs.actorLabel})`,
      action: schema.auditLogs.action,
      subjectType: schema.auditLogs.subjectType,
      subjectId: schema.auditLogs.subjectId,
      createdAt: schema.auditLogs.createdAt,
      ip: schema.auditLogs.ip,
      ua: schema.auditLogs.ua,
      before: schema.auditLogs.before,
      after: schema.auditLogs.after,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.adminUsers, eq(schema.auditLogs.userId, schema.adminUsers.id))
    .where(where)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .leftJoin(schema.adminUsers, eq(schema.auditLogs.userId, schema.adminUsers.id))
    .where(where);

  const typeRows = await db
    .selectDistinct({ subjectType: schema.auditLogs.subjectType })
    .from(schema.auditLogs);

  return {
    items: rows,
    total: Number(countRow?.n ?? 0),
    page,
    pageSize,
    subjectTypes: typeRows
      .map((r) => r.subjectType)
      .filter((t): t is string => !!t)
      .sort(),
  };
}
