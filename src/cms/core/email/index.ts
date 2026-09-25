export { sendGraphMail, graphMailConfigured } from './graph';
export { escapeHtml, formatMoney, formatDate } from './format';
export { applyEmailBrand, emailColor } from './brand';
export type { EmailBrand } from './brand';
export type { GraphMail } from './graph';
// Unsubscribe + suppression. Any sender of unsolicited mail must consult
// `isSuppressed`/`suppressedAmong` before sending, and put `unsubscribeUrl` in the
// body — see `email/suppression.ts` for why both halves matter.
export { isSuppressed, suppressEmail, suppressedAmong } from './suppression';
export {
  normalizeEmail,
  unsubscribeSignature,
  unsubscribeSignatureMatches,
  unsubscribeUrl,
} from './unsubscribe';
