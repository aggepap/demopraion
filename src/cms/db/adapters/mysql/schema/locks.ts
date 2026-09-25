/**
 * Who is currently editing what.
 *
 * ## One row per resource, and the database is the truth
 *
 * The WebSocket relay that pushes these around is deliberately amnesiac — it
 * holds a room registry and nothing else — so a relay restart mid-edit must not
 * lose anybody's lock, and a second app process must not see a different
 * picture. Everything durable lives here; `uniq_editing_locks_resource` is what
 * makes two simultaneous first-acquires resolve to one winner rather than two.
 *
 * ## Why `connection_id` exists as well as `session_id`
 *
 * `session_id` identifies a browser TAB and is kept in `sessionStorage`, so a
 * refresh keeps its own lock instead of locking the editor out of the document
 * they are sitting in. That is exactly what makes releasing on close dangerous:
 * on F5 the NEW socket re-acquires BEFORE the OLD socket's close event arrives,
 * and a release keyed on the session would delete the lock just granted.
 * `connection_id` is per SOCKET, and a release only fires when it matches.
 *
 * ## Why the holder's name is copied in
 *
 * A lock change is broadcast to every socket watching the resource, on a path
 * that should not be doing joins. The copy goes stale if someone is renamed
 * mid-edit, which is acceptable for a row that lives at most a minute.
 */
import { index, int, mysqlTable, timestamp, unique, varchar } from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const editingLocks = mysqlTable(
  'editing_locks',
  {
    id: int('id').autoincrement().primaryKey(),
    /** `document` | `order` | `reservation` — see `core/locks/protocol.ts`. */
    resourceType: varchar('resource_type', { length: 32 }).notNull(),
    /** Translation group for documents, numeric id otherwise; `core/locks/keys.ts`. */
    resourceKey: varchar('resource_key', { length: 64 }).notNull(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    /** Denormalised for the broadcast — see the header. */
    userName: varchar('user_name', { length: 191 }).notNull(),
    /** Per browser tab. */
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    /** Per socket; the release credential. */
    connectionId: varchar('connection_id', { length: 36 }).notNull(),
    acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
    heartbeatAt: timestamp('heartbeat_at').notNull().defaultNow(),
    /** The backstop for a holder who vanished. The normal release is the socket
     *  closing; this only covers a crashed relay or a severed network. */
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => ({
    resourceUniq: unique('uniq_editing_locks_resource').on(t.resourceType, t.resourceKey),
    expiresIdx: index('idx_editing_locks_expires_at').on(t.expiresAt),
    connectionIdx: index('idx_editing_locks_connection').on(t.connectionId),
  }),
);

export type EditingLockRow = typeof editingLocks.$inferSelect;
export type NewEditingLockRow = typeof editingLocks.$inferInsert;
