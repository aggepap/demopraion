/**
 * Change audit trail. Ported unchanged from v1 `schema/audit.ts`.
 */
import { index, int, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    /**
     * Who acted, when it was not a person. `user_id` is null for a non-human
     * writer (an API token, a cron secret), and `listAuditLogs` renders the actor
     * by joining `admin_users` — so without this the rows that most need
     * attribution are exactly the ones that show a blank name.
     */
    actorLabel: varchar('actor_label', { length: 191 }),
    action: varchar('action', { length: 64 }).notNull(),
    subjectType: varchar('subject_type', { length: 64 }),
    subjectId: varchar('subject_id', { length: 64 }),
    before: json('before').$type<unknown>(),
    after: json('after').$type<unknown>(),
    ip: varchar('ip', { length: 64 }),
    ua: varchar('ua', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('idx_audit_subject').on(t.subjectType, t.subjectId),
    userIdx: index('idx_audit_user').on(t.userId),
    createdIdx: index('idx_audit_created').on(t.createdAt),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
