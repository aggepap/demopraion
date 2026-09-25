'use client';

import { useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { Badge, Button, Checkbox, Field, Section, Table, Tbody, Td, Th, Thead, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * Connecting Product Manager.
 *
 * The screen is an **import** form, not a generator. Product Manager mints the
 * credential and shows it once; this pastes it in. That is why there is no
 * "copy this now" state here and no secret anywhere in this component — praion
 * never receives one back from its own API, so there is nothing to be careful
 * about displaying.
 */

interface ApiToken {
  id: number;
  name: string;
  keyId: string;
  scopes: string[];
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Least privilege is expressible, so it should be the default the form nudges
 * toward: read and write are ticked, the payload and media channels are not.
 */
const SCOPES: { value: string; label: string; description: string }[] = [
  { value: 'pm:read', label: 'Read content', description: 'List and fetch pages and products.' },
  { value: 'pm:write', label: 'Write SEO fields', description: 'Push titles, descriptions and slugs.' },
  {
    value: 'pm:payload',
    label: 'Write compiled head payloads',
    description: 'Store the structured data Product Manager compiles.',
  },
  { value: 'pm:media', label: 'Write image alt text', description: 'Update alt text on gallery images.' },
];

const DEFAULT_SCOPES = ['pm:read', 'pm:write'];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Expired and revoked look the same to a caller; they should not to an operator. */
function statusOf(token: ApiToken): { label: string; tone: 'green' | 'amber' | 'red' } {
  if (token.revokedAt) return { label: 'Revoked', tone: 'red' };
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return { label: 'Expired', tone: 'amber' };
  }
  return { label: 'Active', tone: 'green' };
}

/** Loaded on the server and passed in, the way `RolesManager` is — so the first
 *  paint has the list rather than fetching it from an effect. */
export function ApiTokensManager({ initial }: { initial: ApiToken[] }) {
  const [tokens, setTokens] = useState<ApiToken[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const [credential, setCredential] = useState('');
  const [name, setName] = useState('Product Manager');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const { confirm, dialog } = useConfirm();

  /** Refresh after a mutation, so the row reflects what the server now holds. */
  async function reload() {
    try {
      const res = await cmsApi.listApiTokens<ApiToken[]>();
      setTokens(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not load API tokens.');
    }
  }

  function toggleScope(value: string) {
    setScopes((current) =>
      current.includes(value) ? current.filter((s) => s !== value) : [...current, value],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await cmsApi.importApiToken({
        credential: credential.trim(),
        name: name.trim(),
        scopes,
        // A date input gives a local calendar day; store the end of it so a
        // token does not expire at midnight of the morning it was chosen.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      });
      setCredential('');
      setExpiresAt('');
      setScopes(DEFAULT_SCOPES);
      await reload();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not connect that key.');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(token: ApiToken) {
    const okToGo = await confirm({
      title: `Revoke "${token.name}"?`,
      message:
        'Product Manager will lose access immediately and any sync in progress will fail. ' +
        'To reconnect, generate a new key in Product Manager and paste it here.',
      confirmLabel: 'Revoke',
    });
    if (!okToGo) return;
    try {
      await cmsApi.revokeApiToken(token.id);
      await reload();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not revoke that token.');
    }
  }

  return (
    <div className="space-y-6">
      {dialog}
      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <Section title="Connect Product Manager" collapsible={false}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Create the connection in Product Manager first, then paste the setup string it shows
            you. It is displayed only once — if you have lost it, generate a new key there.
          </p>

          <Field
            label="Setup string"
            required
            description="The value Product Manager shows after you add this site. A full key starting with “pmk_” also works."
          >
            <TextInput
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="eyJrZXlfaWQiOiJhN2Yz…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          <Field label="Name" required description="How this connection appears in the list below.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={191} required />
          </Field>

          <Field
            label="Permissions"
            composite
            description="Grant only what this connection needs. A key that cannot write cannot damage a page."
          >
            <div className="space-y-2">
              {SCOPES.map((scope) => (
                <Checkbox
                  key={scope.value}
                  checked={scopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                  label={scope.label}
                  info={scope.description}
                />
              ))}
            </div>
          </Field>

          <Field
            label="Expires"
            description="Optional, and worth setting. A credential nobody remembers issuing is the one still working two years later."
          >
            <TextInput type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>

          <Button type="submit" disabled={saving || scopes.length === 0 || !credential.trim()}>
            {saving ? 'Connecting…' : 'Connect'}
          </Button>
        </form>
      </Section>

      <Section title="Connected keys" collapsible={false}>
        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500">
            No keys yet. Product Manager cannot reach this site until one is connected.
          </p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Name</Th>
                <Th info="The public part of the key, to tell connections apart. The secret part is never shown here.">
                  Key id
                </Th>
                <Th>Permissions</Th>
                <Th>Last used</Th>
                <Th>Expires</Th>
                <Th info="Active keys work. Expired and revoked keys are refused; a revoked key cannot be switched back on.">
                  Status
                </Th>
                <Th> </Th>
              </tr>
            </Thead>
            <Tbody>
              {tokens.map((token) => {
                const status = statusOf(token);
                return (
                  <tr key={token.id}>
                    <Td>{token.name}</Td>
                    <Td>
                      <code className="text-xs">{token.keyId}</code>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.map((scope) => (
                          <Badge key={scope}>{scope}</Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {formatDate(token.lastUsedAt)}
                      {token.lastUsedIp ? (
                        <span className="block text-xs text-slate-500">{token.lastUsedIp}</span>
                      ) : null}
                    </Td>
                    <Td>{formatDate(token.expiresAt)}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td>
                      {token.revokedAt ? null : (
                        <Button variant="danger" onClick={() => void revoke(token)}>
                          Revoke
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
