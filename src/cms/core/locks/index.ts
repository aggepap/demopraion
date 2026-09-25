export { documentLockKey, isValidResourceKey, orderLockKey, reservationLockKey } from './keys';
export {
  decideAcquire,
  decideRelease,
  decideWrite,
  expiresAtFrom,
  holderView,
  isExpired,
  resolveTtlSeconds,
  type LockClaimant,
  type LockDecision,
  type LockRecord,
} from './policy';
export {
  clientFrame,
  LOCK_INTERNAL_HEADER,
  lockResourceTypes,
  roomKey,
  type ClientFrame,
  type LockHolder,
  type LockResourceType,
  type LockState,
} from './protocol';
export { lockInternalSecret, locksEnabled, lockTtlSeconds } from './config';
export {
  acquireLock,
  assertNotLockedByOther,
  documentLockKeyFor,
  heartbeatLocks,
  readLock,
  releaseConnection,
  releaseLock,
} from './service';
