'use client';

import { useRef, useState } from 'react';

import { passwordMessage } from '../modules/auth/password-policy';
import { ROLE_REQUIRED, newUserProblems, type NewUserProblems } from '../core/users/schema';
import { CmsApiError, cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Button, Field, InfoTip, PasswordStrength, Select, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';
import { useDialog } from './ui/use-dialog';
import { PasswordInput } from './ui/PasswordInput';

/** Said on the create form, the edit panel and the column header alike. */
const ROLE_HELP =
  'What this person can see and do in the admin. Each role is a set of permissions, set up on the Roles screen.';

interface Role {
  id: number;
  name: string;
  permissionsCount: number;
}

interface User {
  id: number;
  email: string;
  name: string;
  locale: string;
  disabled: boolean;
  /** Whether this account holds a second factor — the only thing there is to reset. */
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roleIds: number[];
  roleNames: string[];
}

interface UsersData {
  users: User[];
  roles: Role[];
  /*
   * The roles this user is allowed to hand out: every one whose permissions they
   * already hold themselves. The server refuses the rest regardless — this is so a
   * role that was never on offer is not presented as though it were, and the
   * refusal arrives before the box is ticked rather than after the save.
   */
  assignableRoleIds?: number[];
}

/**
 * A role the current user could not hand out is listed but not selectable.
 *
 * Hiding it would be worse: the list is how someone learns what roles exist, and a
 * silently shorter one reads as "there is no superadmin role" rather than "that one
 * is above your authority" — which is why the option says so in its own text.
 * `assignableRoleIds` absent means an older payload; the server is the one that
 * refuses, so the screen stays usable rather than locking everything on a missing
 * field.
 */
const canAssign = (data: UsersData, roleId: number): boolean =>
  data.assignableRoleIds === undefined || data.assignableRoleIds.includes(roleId);

/** The requirements list under the new-user password box, named so the box can point at it. */
const PASSWORD_RULES_ID = 'new-user-password-rules';

const input =
  'w-full min-w-0 rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold sm:w-auto';

export function UsersManager({
  initial,
  currentUserId,
}: {
  initial: UsersData;
  /** The signed-in account, so its own row is not offered a Delete it cannot use. */
  currentUserId?: number;
}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  /*
   * A filter over the loaded list.
   *
   * Every other long list in the admin can be narrowed — documents, media (F-080), the
   * moderation queues (F-073/F-074) — and this one, at three hundred rows and thirteen
   * thousand pixels, could not. Filtering happens here rather than on the server because
   * the endpoint returns every account in one response anyway: adding a round trip would
   * make it slower, not faster, and the whole list is already in hand.
   */
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visibleUsers = needle
    ? data.users.filter(
        (u) =>
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle) ||
          u.roleNames.some((r) => r.toLowerCase().includes(needle)),
      )
    : data.users;
  const { confirm, dialog } = useConfirm();
  const [resettingId, setResettingId] = useState<number | null>(null);

  // New-user form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<number[]>([]);
  /*
   * Kept apart from `error`, which is the whole screen's channel and sits above the
   * form: these belong to the fields that earned them and are pointed at from them,
   * so a complaint is reachable from the control it is about rather than only
   * visible to someone looking at the top of the page.
   */
  const [problems, setProblems] = useState<NewUserProblems>({});
  /** A field stops complaining as soon as it is touched, not at the next submit. */
  const clearProblem = (field: keyof NewUserProblems) =>
    setProblems((p) => (p[field] === undefined ? p : { ...p, [field]: undefined }));
  const [busy, setBusy] = useState(false);
  /*
   * A required answer this administrator cannot give — either because no role has
   * been defined yet, or because every one that exists is above their authority.
   * The two dead ends need different sentences: telling someone to go and create a
   * role is wrong advice when the problem is that they may not assign it either.
   */
  const nothingToPick = !data.roles.some((r) => canAssign(data, r.id));
  const nothingToPickHint =
    data.roles.length === 0
      ? 'No roles exist yet — create a role first.'
      : 'None of these roles are yours to assign.';

  async function refresh() {
    const res = await cmsApi.listUsers<UsersData>();
    setData(res.data);
  }

  /**
   * Check the whole draft here, against the schema the route uses, before sending.
   *
   * The form used to send whatever was typed and print whatever came back in one
   * line above itself — so "Validation failed." stood over four fields without
   * saying which, and an empty `roleIds` was not refused at all: the account was
   * created, the row showed "—" under Roles, and the person it was for was told
   * "Invalid email or password." at every attempt, because `verifyCredentials`
   * refuses an account with no roles and the login route reports that with the same
   * sentence it uses for a wrong password.
   *
   * The server is still the one that binds. Checking here as well is what keeps a
   * refusal from costing somebody the password they just typed.
   */
  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    // Both channels clear first: a stale failure from the previous attempt read as
    // this attempt's, which is how a fixed problem stays on screen looking unfixed.
    setError(null);
    const found = newUserProblems({ name, email, password, roleIds });
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await cmsApi.createUser({ email, name, password, roleIds });
      setEmail('');
      setName('');
      setPassword('');
      setRoleIds([]);
      await refresh();
    } catch (err) {
      /*
       * The one refusal that belongs to a field rather than to the form.
       *
       * A duplicate address is by far the likeliest way this fails, and the API
       * answers it with a deliberately unspecific "Already exists." — it names no
       * column, since a 409 that enumerates constraints is an enumeration oracle.
       * Only one thing on this form is unique, so the screen can say which without
       * the server having to.
       */
      if (err instanceof CmsApiError && err.status === 409) {
        setProblems({ email: 'An account with this email address already exists.' });
      } else {
        setError(apiErrorText(err, 'Could not create this user.'));
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Every write on this screen goes through here, and every one of them can be
   * refused by the server: disabling your own account, or the last enabled
   * superadmin, both come back 409. There was no catch, so the rejection left
   * the page as an unhandled promise rejection — the row simply did not change
   * and nothing said why.
   */
  /**
   * Turning an account off asks first, and says so while it works.
   *
   * The Status cell is a control that reads as a label — it shows the current state — and it
   * sits immediately beside Edit on every row of a list hundreds of rows long. One
   * mis-aimed click took away a colleague's access to the admin instantly, with no dialog
   * and no sign anything was happening. Deleting a role asks; this did not, for the same
   * kind of consequence.
   *
   * Enabling is not guarded: giving someone back their access is not a decision anyone
   * needs protecting from.
   */
  async function toggleDisabled(u: User) {
    if (!u.disabled) {
      const ok = await confirm({
        title: `Disable ${u.name}?`,
        message: `${u.email} will lose access to the admin immediately. You can enable them again afterwards.`,
        confirmLabel: 'Disable account',
      });
      if (!ok) return;
    }
    setTogglingId(u.id);
    await patchUser(u.id, { disabled: !u.disabled });
    setTogglingId(null);
  }

  /**
   * Clear somebody else's second factor.
   *
   * The last resort for a colleague who has lost their authenticator AND their
   * recovery codes. Confirmed rather than immediate because it lowers an
   * account's security and cannot be undone from here — the owner has to enrol
   * again — and because it is one row away from Edit on a table people scan
   * quickly.
   *
   * No self-guard: resetting your own is harmless (you simply enrol again), and
   * it is a legitimate escape from a half-finished enrollment.
   */
  function resetMfa(u: User) {
    void (async () => {
      const ok = await confirm({
        title: `Reset two-factor for ${u.name}?`,
        message:
          `${u.email} will be able to sign in with their password alone until they set it up again, ` +
          `and their recovery codes stop working. Only do this once you are sure who you are talking to.`,
        confirmLabel: 'Reset two-factor',
      });
      if (!ok) return;
      setResettingId(u.id);
      await patchUser(u.id, { resetMfa: true });
      setResettingId(null);
    })();
  }

  /**
   * Returns the failure, rather than only posting it above the page.
   *
   * The edit panel covers the whole screen, so a refusal written into `error` — a
   * name cleared to nothing, a password below the policy, the last superadmin being
   * disabled — was rendered behind the overlay the person was looking at. The save
   * simply appeared to do nothing. Callers that are not inside a dialog ignore the
   * return value and read the banner as before.
   */
  async function patchUser(id: number, body: Record<string, unknown>): Promise<string | null> {
    setError(null);
    try {
      await cmsApi.updateUser(id, body);
      await refresh();
      setEditing(null);
      return null;
    } catch (err) {
      // The field-level sentence when the server sent one, not "Validation failed."
      const message = apiErrorText(err, 'Could not update this user.');
      setError(message);
      return message;
    }
  }

  /**
   * Deleting says what disabling does not: this does not come back.
   *
   * The two controls sit on the same row and read as a pair, so the dialog has to
   * draw the line between them — Disable is reversible and keeps the account's
   * name on everything it wrote, Delete is neither. Every `created_by` and
   * `user_id` pointing at the row is nulled by the schema, so the person's past
   * edits stay in the database and stop being attributable to anyone. That is the
   * part nobody expects, so it is the part the message leads with.
   *
   * The server refuses two of these outright — your own account, and the last
   * enabled superadmin — and those refusals arrive as a 409 with a sentence that
   * says which, so `apiErrorText` surfaces it rather than a generic failure.
   */
  function removeUser(u: User) {
    void (async () => {
      const ok = await confirm({
        title: `Delete ${u.name}?`,
        message:
          `${u.email} is removed permanently. Anything they wrote — documents, media, audit entries — ` +
          `stays, but stops being attributed to them, and this cannot be undone. ` +
          `Disable the account instead if you only want to take their access away.`,
        confirmLabel: 'Delete account',
      });
      if (!ok) return;
      setError(null);
      setDeletingId(u.id);
      try {
        await cmsApi.deleteUser(u.id);
        await refresh();
      } catch (err) {
        setError(apiErrorText(err, 'Could not delete this user.'));
      } finally {
        setDeletingId(null);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/*
        The form beside the list it adds to, rather than above it: on a wide screen
        a one-column stack pushed three hundred accounts below the fold behind a
        panel that is only used occasionally.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        {/*
          Labels above the controls, not placeholders inside them. A placeholder is
          gone the moment you type into it — which is exactly when a field grows an
          error message and most needs to still say what it is — and it cannot carry
          the "(required)" the fields now have to say. `Field` does the label/error
          wiring (`for`, `aria-describedby`, `aria-invalid`) that four hand-rolled
          `aria-label`s did not.
        */}
        <form onSubmit={addUser} className="flex flex-col gap-4 rounded-sm border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Add a user</h2>
          <Field label="Name (required)" error={problems.name}>
            <TextInput
              autoComplete="off"
              value={name}
              onChange={(e) => {
                clearProblem('name');
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Email (required)" error={problems.email}>
            <TextInput
              type="email"
              // `off`, not `email`: this form creates OTHER people's accounts, and
              // a browser helpfully filling in the signed-in administrator's own
              // address is a wrong account waiting to be created.
              autoComplete="off"
              value={email}
              onChange={(e) => {
                clearProblem('email');
                setEmail(e.target.value);
              }}
            />
          </Field>
          <Field label="Password (required)" error={problems.password}>
            {/*
              The function form, because this field is a control plus the requirements
              below it — `Field` can only clone its ids onto a single child, and a
              second child would silently leave the label pointing at nothing.
            */}
            {(control) => (
              <>
                <PasswordInput
                  {...control}
                  aria-describedby={[control['aria-describedby'], PASSWORD_RULES_ID].filter(Boolean).join(' ')}
                  // Stops a password manager offering the administrator's own password
                  // for a new user's account.
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    clearProblem('password');
                    setPassword(e.target.value);
                  }}
                />
                <PasswordStrength id={PASSWORD_RULES_ID} value={password} showRules={!problems.password} />
              </>
            )}
          </Field>
          {/*
            One role, so one control. Checkboxes let an account be given `editor` and
            `superadmin` at once — a combination nobody meant to grant and which the
            Roles column then reported as "editor, superadmin" with no way to tell
            which one was the mistake. The table underneath is still many-to-many;
            this screen no longer offers to use it that way.
          */}
          <Field label="Role (required)" error={problems.roleIds} description={ROLE_HELP}>
            {(control) => (
              <>
                <Select
                  {...control}
                  value={roleIds[0] ?? ''}
                  onChange={(e) => {
                    clearProblem('roleIds');
                    setRoleIds(e.target.value ? [Number(e.target.value)] : []);
                  }}
                >
                  {/* Nothing preselected: a role granted because it happened to be
                      first in the list is a role nobody chose. */}
                  <option value="">Choose a role…</option>
                  {data.roles.map((r) => {
                    const allowed = canAssign(data, r.id);
                    return (
                      /* Shown but not offered — hiding it reads as "there is no
                         superadmin role" rather than "that one is above your
                         authority". */
                      <option key={r.id} value={r.id} disabled={!allowed}>
                        {r.name}
                        {allowed ? '' : ' — above your authority'}
                      </option>
                    );
                  })}
                </Select>
                {nothingToPick ? <p className="mt-1 text-xs text-neutral-600">{nothingToPickHint}</p> : null}
              </>
            )}
          </Field>
          {/*
            `self-start`: the form is a column now, and a stretched flex item turned
            "Add user" into a full-width banner reading as the page's main action.
          */}
          <Button type="submit" disabled={busy || nothingToPick} className="self-start">
            {/* Every other save button in the admin says so while it works. */}
            {busy ? 'Adding…' : 'Add user'}
          </Button>
        </form>

        {/*
          `min-w-0` on the column, not only on the scroll box inside it: a grid
          track is `min-width: auto` too, so without it the 649px table widens
          the whole track and the page scrolls sideways instead of the table.
        */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={query}
              aria-label="Filter accounts by name or email"
              placeholder="Filter by name or email…"
              onChange={(e) => setQuery(e.target.value)}
              className={`${input} max-w-xs`}
            />
            <span className="text-sm text-neutral-600">
              {query
                ? `${visibleUsers.length} of ${data.users.length} accounts`
                : `${data.users.length} account${data.users.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {/*
            `min-w-0` is what makes `overflow-x-auto` actually work here. A flex
            child defaults to `min-width: auto`, so this box refused to shrink below
            its 649px table and pushed the whole page sideways on a phone instead of
            scrolling inside itself. `tabIndex` makes that scroll reachable by
            keyboard, as on the other tables.
          */}
          <div
            tabIndex={0}
            role="group"
            aria-label="Users table, scrollable"
            className="min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
          >
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      Roles
                      <InfoTip label="About roles">{ROLE_HELP}</InfoTip>
                    </span>
                  </th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      Last login
                      <InfoTip label="About last login">
                        The day this person last signed in to the admin. A dash means they never have — worth
                        checking before an old account is left enabled.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      Status
                      <InfoTip label="About status">
                        Click “active” to disable an account: the person loses access at once, but the account and
                        everything they wrote stay. Click “disabled” to give access back.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="relative px-3 py-2 text-right">
                    <span className="sr-only">Actions</span>
                    <InfoTip label="About the actions">
                      Reset 2FA (shown only when the person uses two-factor) removes their second step, so their
                      password alone signs them in until they set it up again — for someone who lost their phone
                      and recovery codes. Delete removes the account for good; disable it instead to keep it.
                    </InfoTip>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibleUsers.map((u) => (
                  /*
                    A disabled account is marked by its own Status cell, not by
                    fading the whole row. `opacity-50` dropped the name to about
                    3.4:1 and the email and roles to about 2.3:1 against white —
                    both under the 4.5:1 minimum, so the rows an administrator most
                    needs to read carefully were the hardest ones to read. A tinted
                    background says the same thing and changes no text contrast.
                  */
                  <tr key={u.id} className={u.disabled ? 'bg-neutral-50' : 'hover:bg-neutral-50'}>
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2 text-neutral-600">{u.email}</td>
                    <td className="px-3 py-2 text-neutral-600">{u.roleNames.join(', ') || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 10) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        disabled={togglingId === u.id}
                        onClick={() => void toggleDisabled(u)}
                        className="inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center rounded-sm px-1.5 py-1 text-xs underline hover:bg-neutral-100"
                      >
                        {togglingId === u.id ? 'saving…' : u.disabled ? 'disabled' : 'active'}
                        {/*
                          The visible word is the current state, which on its own
                          reads as a label rather than a control — so the action and
                          the person are added for anyone not looking at the row.
                          Appended rather than replaced via `aria-label`, because the
                          accessible name has to contain the visible text or speech
                          input cannot address the button by what it says.
                        */}
                        <span className="sr-only"> — {u.disabled ? 'enable' : 'disable'} {u.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/*
                        Only on rows that have something to reset. Rendering it
                        always, disabled, would put a permanently dead control on
                        most rows of a table people scan fast.
                      */}
                      {u.mfaEnabled ? (
                        <button
                          disabled={resettingId === u.id}
                          onClick={() => resetMfa(u)}
                          className="mr-1 inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 hover:underline disabled:opacity-50"
                        >
                          {resettingId === u.id ? 'resetting…' : 'Reset 2FA'}
                          <span className="sr-only"> for {u.name}</span>
                        </button>
                      ) : null}
                      <button
                        onClick={() => setEditing(u)}
                        className="inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 hover:underline"
                      >
                        Edit
                        {/* Which row's Edit — same reason as the status button. */}
                        <span className="sr-only"> {u.name}</span>
                      </button>
                      {/*
                        Absent on your own row rather than disabled: a greyed-out
                        button invites a hover to find out why, and the answer here
                        ("you cannot delete yourself") is not information anyone
                        needs mid-task. Red and last, matching the roles table.
                      */}
                      {u.id === currentUserId ? null : (
                        <button
                          disabled={deletingId === u.id}
                          onClick={() => removeUser(u)}
                          className="ml-1 inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-sm px-1.5 py-1 text-xs text-red-700 hover:bg-red-50 hover:underline disabled:opacity-50"
                        >
                          {deletingId === u.id ? 'deleting…' : 'Delete'}
                          <span className="sr-only"> {u.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 ? (
                  <tr>
                    {/*
                      "No accounts match" — not the blank table that an empty list would show,
                      which on a screen about who can get in reads as something having gone
                      badly wrong.
                    */}
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-neutral-600">
                      No accounts match “{query}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {dialog}
      {editing ? (
        <EditUserPanel
          user={editing}
          roles={data.roles}
          assignable={data.assignableRoleIds}
          onClose={() => setEditing(null)}
          onSave={patchUser}
        />
      ) : null}
    </div>
  );
}

export function EditUserPanel({
  user,
  roles,
  assignable,
  onClose,
  onSave,
}: {
  user: User;
  roles: Role[];
  assignable: number[] | undefined;
  onClose: () => void;
  onSave: (id: number, body: Record<string, unknown>) => Promise<string | null>;
}) {
  const [name, setName] = useState(user.name);
  const [roleId, setRoleId] = useState<number | ''>(user.roleIds[0] ?? '');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /** Whatever the server refused, said inside the panel that asked for it. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const replacedRoles =
    user.roleIds.length > 1
      ? user.roleIds
          .filter((id) => id !== roleId)
          .map((id) => roles.find((r) => r.id === id)?.name ?? String(id))
      : [];

  // A panel that covers the page is a dialog, and was not announced or closable
  // as one: no role, no Escape, and nothing telling a screen reader that the
  // list behind it is no longer the thing in focus. The shared hook supplies
  // Escape plus the focus trap/restore this never had.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog({ open: true, onClose, panelRef });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="h-full w-full max-w-md bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="edit-user-title" className="text-lg font-semibold">
            {user.email}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-600 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <Field label="Name" className="mb-4">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Role" error={roleError} className="mb-4" description={ROLE_HELP}>
          {(control) => (
            <>
              <Select
                {...control}
                value={roleId}
                onChange={(e) => {
                  setRoleError(null);
                  setRoleId(e.target.value ? Number(e.target.value) : '');
                }}
              >
                <option value="">Choose a role…</option>
                {roles.map((r) => {
                  const allowed = assignable === undefined || assignable.includes(r.id);
                  return (
                    <option key={r.id} value={r.id} disabled={!allowed}>
                      {r.name} ({r.permissionsCount} perms)
                      {allowed ? '' : ' — above your authority'}
                    </option>
                  );
                })}
              </Select>
              {/*
                The table is many-to-many and some accounts predate this screen, so a
                dropdown showing one of two roles would quietly revoke the other on
                save. Naming it is the difference between a change and an accident.
              */}
              {replacedRoles.length > 0 ? (
                <p className="mt-1 text-xs text-amber-700">
                  This account also holds {replacedRoles.join(', ')}. Saving replaces every role it has
                  with the one selected here.
                </p>
              ) : null}
            </>
          )}
        </Field>

        {/*
          The requirements appear once there is something to measure and not before:
          this box is usually meant to be left alone, and a checklist of unmet rules
          over an empty field reads as work somebody has to do.
        */}
        <Field
          label="Reset password"
          error={passwordError}
          className="mb-4"
          description="Sets a new password for this account; leave it empty to keep the current one. No email is sent, so tell the person yourself."
        >
          {(control) => (
            <>
              <PasswordInput
                {...control}
                autoComplete="new-password"
                placeholder="leave blank to keep"
                value={password}
                onChange={(e) => {
                  setPasswordError(null);
                  setPassword(e.target.value);
                }}
              />
              {password ? <PasswordStrength value={password} /> : null}
            </>
          )}
        </Field>

        {saveError ? (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {saveError}
          </p>
        ) : null}
        <button
          disabled={saving}
          onClick={async () => {
            // The route refuses this too; catching it here keeps the typed password
            // on screen instead of trading it for a sentence above the panel.
            const weak = password ? passwordMessage(password) : null;
            setPasswordError(weak);
            // Clearing the role here would leave an account that cannot sign in — the
            // same broken state the create form refuses to produce.
            const missingRole = roleId === '' ? ROLE_REQUIRED : null;
            setRoleError(missingRole);
            if (weak || missingRole) return;
            setSaveError(null);
            setSaving(true);
            const failure = await onSave(user.id, {
              name,
              roleIds: [roleId],
              ...(password ? { password } : {}),
            });
            // On success this panel is already gone — `patchUser` closes it — so the
            // state updates are deliberately confined to the failing branch.
            if (failure) {
              setSaveError(failure);
              setSaving(false);
            }
          }}
          className="rounded-sm bg-warm-gold font-medium px-4 py-2 text-sm text-midnight-navy hover:bg-warm-gold-dark disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
