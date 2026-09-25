import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditActionLabel, auditSubjectLabel } from '@/cms/core/audit-labels';
import { permissionLabel, splitPermissionKey } from '@/cms/modules/auth/permission-labels';
import { ALL_PERMISSIONS } from '@/cms/modules/auth';

/**
 * The words the admin uses for its own concepts.
 *
 * These look like cosmetics and are not. Twice today a screen spoke to a person in the
 * vocabulary of the database — the audit log's Subject column printed `seo_redirect #688`
 * beside a translated Action (F-083), and a permission refusal named `cms.roles.manage` to
 * someone who had been choosing from a list saying "Manage roles" (F-086). Both were fixed by
 * label maps, and a label map's failure mode is silent: add a permission or a subject type and
 * the screen quietly falls back to the raw key.
 *
 * So the test that matters most here is the last one — every permission the system can grant
 * has a human name.
 */

test('a permission key splits into its area and verb', () => {
  assert.deepEqual(splitPermissionKey('cms.content.read'), { area: 'content', verb: 'read' });
  // A nested area keeps its dots: `commerce.orders` is one area, not two.
  assert.deepEqual(splitPermissionKey('cms.commerce.orders.read'), {
    area: 'commerce.orders',
    verb: 'read',
  });
  // A single-segment key is an area with no verb, not a verb with no area.
  assert.deepEqual(splitPermissionKey('cms.access'), { area: 'access', verb: '' });
});

test('a permission reads as a sentence a person chose from', () => {
  assert.equal(permissionLabel('cms.content.read'), 'View content');
  assert.equal(permissionLabel('cms.content.publish'), 'Publish content');
  assert.equal(permissionLabel('cms.commerce.orders.read'), 'View orders');
  assert.equal(permissionLabel('cms.roles.manage'), 'Manage roles');
});

test('the wildcard is named, not printed', () => {
  // "*" in a refusal message would be the least helpful possible answer.
  assert.equal(permissionLabel('*'), 'Full access');
});

test('every permission the system can grant has a human name', () => {
  /*
   * The point of the whole file. A new permission added to `ALL_PERMISSIONS` without a label
   * does not break anything — it falls back to the raw key — so the failure shows up as a
   * screen speaking in code, months later, to whoever happens to hit it.
   */
  for (const key of ALL_PERMISSIONS) {
    const label = permissionLabel(key);
    assert.notEqual(label, key, `${key} has no label and would be shown as a code key`);
    assert.ok(/^[A-Z]/.test(label), `${key} → "${label}" should read as a phrase`);
    assert.ok(!label.includes('cms.'), `${key} → "${label}" still contains the raw key`);
  }
});

test('an audit action reads as something a person did', () => {
  assert.equal(auditActionLabel('auth.login.fail'), 'Failed sign-in attempt');
  assert.equal(auditActionLabel('document.update'), 'Edited content');
});

test('an unknown audit action is humanised rather than left as a key', () => {
  // A newly added action must be readable the day it ships, before anyone writes it a phrase.
  assert.equal(auditActionLabel('widget.frobnicate'), 'Widget frobnicate');
});

test('an audit subject names the thing, not the table', () => {
  assert.equal(auditSubjectLabel('seo_redirect'), 'Redirect');
  assert.equal(auditSubjectLabel('form_submission'), 'Form submission');
  assert.equal(auditSubjectLabel('admin_user'), 'User');
  assert.equal(auditSubjectLabel('seo_not_found'), '404 entry');
});

test('every subject type the code writes has a label', () => {
  /*
   * These are the values passed to `logAudit` across the app. Kept as a literal list rather
   * than derived, so adding a subject type and forgetting its label fails here instead of
   * showing a table name on the audit screen.
   */
  const written = [
    'admin_role',
    'admin_user',
    'booking',
    'booking_slot',
    'cookie_category',
    'cookie_service',
    'document',
    'email',
    'form_submission',
    'media_file',
    'order',
    'review',
    'seo_meta',
    'seo_not_found',
    'seo_redirect',
    'settings',
  ];
  for (const type of written) {
    const label = auditSubjectLabel(type);
    assert.notEqual(label, type, `${type} has no label and would be shown as a table name`);
    assert.ok(!label.includes('_'), `${type} → "${label}" still looks like an identifier`);
  }
});
