import 'server-only';

import { ClientSecretCredential } from '@azure/identity';

import { brandEmailHtml } from '../brand';
import { graphMailBody } from './format';

/**
 * Microsoft Graph email sender (application / client-credentials flow).
 * Ported from v1 `src/lib/email/graph.ts` and generalised: the reply-to label
 * and recipient are parameters, not hardcoded site names, so any site can use it.
 *
 * Required env (server-only — never `NEXT_PUBLIC_`):
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET — Entra app creds
 *   GRAPH_SENDER_ADDRESS    — UPN of the mailbox to send from
 *   CONTACT_RECIPIENT_EMAIL — default recipient (overridable per send)
 */
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

interface GraphEnv {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
  defaultRecipient: string;
}

function readEnv(): GraphEnv {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const sender = process.env.GRAPH_SENDER_ADDRESS;
  const defaultRecipient = process.env.CONTACT_RECIPIENT_EMAIL;

  const missing = [
    ['AZURE_TENANT_ID', tenantId],
    ['AZURE_CLIENT_ID', clientId],
    ['AZURE_CLIENT_SECRET', clientSecret],
    ['GRAPH_SENDER_ADDRESS', sender],
    ['CONTACT_RECIPIENT_EMAIL', defaultRecipient],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing email env vars: ${missing.join(', ')}`);
  }

  return {
    tenantId: tenantId!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    sender: sender!,
    defaultRecipient: defaultRecipient!,
  };
}

/**
 * Whether a send could succeed at all.
 *
 * Exists because one caller has to ask BEFORE it commits: email-based 2FA
 * enrollment must refuse up front on a deploy with no mail configured, rather
 * than let someone enrol into a second factor that can never be delivered and
 * discover it at their next sign-in. Everything else can let `readEnv` throw at
 * the point of sending.
 */
export function graphMailConfigured(): boolean {
  try {
    readEnv();
    return true;
  } catch {
    return false;
  }
}

let credential: ClientSecretCredential | null = null;
function getCredential(env: GraphEnv): ClientSecretCredential {
  if (!credential) {
    credential = new ClientSecretCredential(env.tenantId, env.clientId, env.clientSecret);
  }
  return credential;
}

export interface GraphMail {
  subject: string;
  /** Sent when non-empty. Graph takes one body, so `text` is used only without it. */
  html: string;
  text?: string;
  /** Override the default recipient inbox. */
  to?: string;
  /** Submitter address — set as Reply-To so a plain reply reaches them. */
  replyTo?: string;
  /** Submitter display name for the Reply-To field. */
  replyToName?: string;
  /** Suffix appended to the Reply-To display name, e.g. "(via Acme contact form)".
   *  Flags that the address came from a form, guarding against Reply-To spoofing. */
  replyToSuffix?: string;
}

/**
 * Send `mail` via Graph. Throws if env is incomplete or Graph rejects; callers
 * should catch and surface a generic failure (the body may contain PII).
 */
export async function sendGraphMail(mail: GraphMail): Promise<void> {
  // Before any network call: a mail with no body is a caller bug, not a send.
  const body = graphMailBody(mail);
  const env = readEnv();
  const token = await getCredential(env).getToken(GRAPH_SCOPE);
  if (!token) {
    throw new Error('Failed to acquire Microsoft Graph access token');
  }

  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.sender)}/sendMail`;

  const message: Record<string, unknown> = {
    subject: mail.subject,
    // The one place every mail passes through, so the brand is applied here:
    // colour placeholders filled from the palette, the logo on top. HTML only —
    // a text body has nowhere to put either.
    body:
      body.contentType === 'HTML'
        ? { contentType: 'HTML', content: await brandEmailHtml(body.content) }
        : body,
    toRecipients: [{ emailAddress: { address: mail.to ?? env.defaultRecipient } }],
  };
  if (mail.replyTo) {
    const suffix = mail.replyToSuffix ? ` ${mail.replyToSuffix}` : '';
    const displayName = mail.replyToName
      ? `${mail.replyToName}${suffix}`
      : (mail.replyToSuffix ?? 'Form submitter');
    message.replyTo = [{ emailAddress: { name: displayName, address: mail.replyTo } }];
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${res.status}): ${detail}`);
  }
}
