'use client';

import { useState } from 'react';

import {
  ACCESS_PERMISSION as ACCESS,
  AREA_LABELS,
  FULL_ACCESS,
  permissionDescription,
  permissionLabel,
  splitPermissionKey as splitKey,
} from '../modules/auth/permission-labels';
import { cmsApi, CmsApiError } from './api-client';
import { Badge, Button, Field, FieldTip, Section, Table, Tbody, Td, Th, Thead, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

interface Role {
  id: number;
  name: string;
  permissions: string[];
  userCount: number;
}

interface RolesData {
  roles: Role[];
  assignable: string[];
  /** What the signed-in user holds, so the picker can stop offering more than that. */
  grantable?: string[];
}

/**
 * State after a refresh. `grantable` survives a payload that lacks it: the server
 * sends it now, but it once did not, and losing it silently re-enabled every box
 * in the picker after the first save.
 */
export function mergeRolesData(prev: RolesData, next: RolesData): RolesData {
  return { ...next, grantable: next.grantable ?? prev.grantable };
}

function groupPermissions(keys: string[]): { area: string; label: string; keys: string[] }[] {
  const order = Object.keys(AREA_LABELS);
  const byArea = new Map<string, string[]>();
  for (const key of keys) {
    if (key === FULL_ACCESS) continue;
    const { area } = splitKey(key);
    (byArea.get(area) ?? byArea.set(area, []).get(area)!).push(key);
  }
  return [...byArea.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([area, ks]) => ({ area, label: AREA_LABELS[area] ?? area, keys: ks }));
}

/** The permission checkboxes, shared by the create form and the edit panel. */
/**
 * Shown but not offered, when the actor could not grant it.
 *
 * The equivalent list on the Users screen already works this way (F-058): a role carrying
 * something you do not hold is disabled with the reason, before you tick it. This picker
 * offered everything and let the server refuse at save — so a delegated role manager could
 * fill in a whole form and only then be told. Hiding the rows instead would be worse: the
 * list is how someone learns which permissions exist, and a silently shorter one reads as
 * "there is no such permission".
 */
const OUT_OF_REACH = 'You do not hold this permission yourself, so you cannot grant it.';

export function PermissionPicker({
  assignable,
  grantable,
  selected,
  onChange,
  idPrefix,
}: {
  assignable: string[];
  /** What the current user holds. `undefined` means unknown — nothing is disabled. */
  grantable?: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  const canGrant = (key: string) =>
    grantable === undefined || grantable.includes(FULL_ACCESS) || grantable.includes(key);
  const full = selected.includes(FULL_ACCESS);
  const toggle = (key: string, on: boolean) =>
    onChange(on ? [...selected.filter((k) => k !== key), key] : selected.filter((k) => k !== key));

  return (
    <div className="flex flex-col gap-3">
      {/*
        Full access is not one checkbox among many — it supersedes every other
        one. Showing it in the same list, at the same weight, invites someone to
        tick it alongside a careful selection and never notice that the careful
        part stopped meaning anything.
      */}
      <div className="group/field relative flex items-start gap-1 rounded-sm border border-warm-gold/40 bg-warm-gold/5 px-3 py-2">
        <label
          title={canGrant(FULL_ACCESS) ? undefined : OUT_OF_REACH}
          className={`flex min-h-5 items-start gap-2 ${
            canGrant(FULL_ACCESS) ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
          }`}
        >
          <input
            type="checkbox"
            /*
              24px of tappable area around a 16px box. WCAG 2.5.8 asks for 24; these are the
              controls someone builds a role out of, and on a phone they were 16.
            */
            className="mt-0.5 h-4 w-4 shrink-0 accent-warm-gold-deep"
            disabled={!canGrant(FULL_ACCESS)}
            checked={full}
            aria-describedby={`${idPrefix}-full-tip`}
            onChange={(e) => onChange(e.target.checked ? [FULL_ACCESS] : [ACCESS])}
          />
          <span className="text-sm text-neutral-800">
            <strong>Full access</strong> — everything, including anything added later.
            <span className="mt-0.5 block text-xs text-neutral-600">
              Overrides every choice below.
            </span>
          </span>
        </label>
        <span className="mt-0.5">
          <FieldTip id={`${idPrefix}-full-tip`}>{permissionDescription(FULL_ACCESS)}</FieldTip>
        </span>
      </div>

      {full ? null : (
        <>
          {!selected.includes(ACCESS) ? (
            <p className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Without <strong>Access</strong> this role cannot open the admin at all — every screen
              will refuse it.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {groupPermissions(assignable).map((group) => (
              <fieldset key={group.area} className="rounded-sm border border-neutral-200 p-2">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  {group.label}
                </legend>
                <div className="flex flex-col">
                  {group.keys.map((key) => {
                    const tip = permissionDescription(key);
                    const tipId = `${idPrefix}-${key}-tip`;
                    /*
                      The "i" sits beside the label, not inside it. Inside, the tip text
                      would become part of the checkbox's name — "View content Open the
                      content lists…" — and the icon is not a tab stop either way: the
                      checkbox already carries the text through `aria-describedby`.
                    */
                    return (
                      <div key={key} className="group/field relative flex items-center gap-1">
                        <label
                          htmlFor={`${idPrefix}-${key}`}
                          title={canGrant(key) ? undefined : OUT_OF_REACH}
                          className={`flex min-h-9 items-center gap-2 rounded-sm px-1 py-0.5 text-sm ${
                            canGrant(key)
                              ? 'cursor-pointer text-neutral-700 hover:bg-neutral-50'
                              : 'cursor-not-allowed text-neutral-500'
                          }`}
                        >
                          <input
                            id={`${idPrefix}-${key}`}
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-warm-gold-deep"
                            disabled={!canGrant(key)}
                            checked={selected.includes(key)}
                            aria-describedby={tip ? tipId : undefined}
                            onChange={(e) => toggle(key, e.target.checked)}
                          />
                          {permissionLabel(key)}
                          {canGrant(key) ? null : (
                            <span className="text-xs text-neutral-500">— above your authority</span>
                          )}
                        </label>
                        {tip ? <FieldTip id={tipId}>{tip}</FieldTip> : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Roles screen.
 *
 * Roles used to be creatable only by editing `db/seeds/roles.ts` and re-running
 * `npm run db:seed-roles`, so every site had exactly the two that file defines
 * and an agency could not give a client a role of its own. The table, the join
 * table and the permission checker were all already there.
 */
export function RolesManager({ initial }: { initial: RolesData }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  // Create form. A new role starts with `cms.access` because a role that cannot
  // open the admin is never what someone means to build.
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>([ACCESS]);

  // Edit panel.
  const [editing, setEditing] = useState<Role | null>(null);
  const [editName, setEditName] = useState('');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);

  async function refresh() {
    const res = await cmsApi.listRoles<RolesData>();
    setData((prev) => mergeRolesData(prev, res.data));
  }

  /** Every write goes through here so no path can drop a refusal on the floor. */
  async function run(fn: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const addRole = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await cmsApi.createRole({ name, permissions });
      setName('');
      setPermissions([ACCESS]);
    }, 'Could not create this role.');
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setEditName(role.name);
    setEditPermissions(role.permissions);
    setError(null);
  };

  const saveEdit = () =>
    void run(async () => {
      await cmsApi.updateRole(editing!.id, { name: editName, permissions: editPermissions });
      setEditing(null);
    }, 'Could not save this role.');

  const removeRole = (role: Role) =>
    void (async () => {
      const ok = await confirm({
        title: `Delete the role "${role.name}"?`,
        message:
          role.userCount > 0
            ? `${role.userCount} ${role.userCount === 1 ? 'account holds' : 'accounts hold'} this role — the server will refuse until they are moved.`
            : 'No account holds this role, so nothing loses access.',
        confirmLabel: 'Delete role',
      });
      if (!ok) return;
      await run(async () => {
        await cmsApi.deleteRole(role.id);
      }, 'Could not delete this role.');
    })();

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Section
        /*
          Collapsed. The daily reason to open this screen is to check what an existing role
          allows, and an expanded create form — fifteen checkboxes in two columns — pushed
          the roles table entirely below the fold, worse on a phone where it is one column.
        */
        defaultOpen={false}
        title="Add a role">
        <form onSubmit={addRole} className="flex flex-col gap-4">
          <Field label="Role name" required description="What it is called in the list and on a user.">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Writer"
              maxLength={64}
              required
            />
          </Field>
          <Field label="Permissions" composite>
            <PermissionPicker
              assignable={data.assignable}
              grantable={data.grantable}
              selected={permissions}
              onChange={setPermissions}
              idPrefix="new-role"
            />
          </Field>
          <div>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Add role'}
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Roles" collapsible={false}>
        <div
          tabIndex={0}
          aria-label="Roles table, scrollable"
          className="min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          <Table>
            <Thead>
              <tr>
                <Th>Name</Th>
                <Th>Permissions</Th>
                <Th>Accounts</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </Thead>
            <Tbody>
              {data.roles.map((role) => {
                const full = role.permissions.includes(FULL_ACCESS);
                return (
                  <tr key={role.id}>
                    <Td>
                      <span className="font-medium text-neutral-800">{role.name}</span>
                    </Td>
                    <Td>
                      {full ? (
                        <Badge tone="amber">Full access</Badge>
                      ) : (
                        /*
                          Which permissions, not just how many.
                          "Work out what a given role allows" was the question this screen
                          exists to answer, and the only way to answer it was to open Edit
                          on every role in turn. A count is not an answer.
                        */
                        <details className="text-neutral-700">
                          <summary className="cursor-pointer">
                            {role.permissions.length}{' '}
                            {role.permissions.length === 1 ? 'permission' : 'permissions'}
                          </summary>
                          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
                            {role.permissions.map((p) => (
                              <li key={p} title={p}>
                                {permissionLabel(p)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </Td>
                    <Td>{role.userCount}</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(role)}
                        className="inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 hover:underline"
                      >
                        Edit
                        <span className="sr-only"> {role.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRole(role)}
                        className="ml-1 inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 py-1 text-xs text-red-700 hover:bg-red-50 hover:underline"
                      >
                        Delete
                        <span className="sr-only"> {role.name}</span>
                      </button>
                    </Td>
                  </tr>
                );
              })}
              {data.roles.length === 0 ? (
                <tr>
                  <Td colSpan={4}>
                    <span className="text-neutral-600">No roles yet.</span>
                  </Td>
                </tr>
              ) : null}
            </Tbody>
          </Table>
        </div>
      </Section>

      {editing ? (
        <Section title={`Edit "${editing.name}"`} collapsible={false}>
          <div className="flex flex-col gap-4">
            <Field label="Role name" required>
              <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={64} />
            </Field>
            <Field label="Permissions" composite>
              <PermissionPicker
                assignable={data.assignable}
                grantable={data.grantable}
                selected={editPermissions}
                onChange={setEditPermissions}
                idPrefix={`role-${editing.id}`}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="button" onClick={saveEdit} disabled={busy || !editName.trim()}>
                {busy ? 'Saving…' : 'Save role'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      {dialog}
    </div>
  );
}
