import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ALL_PERMISSIONS, hasAnyPerm, hasPerm, PERMISSIONS } from '@/cms/modules/auth/permissions';

describe('hasPerm', () => {
  test('empty grants never match', () => {
    assert.equal(hasPerm([], 'cms.access'), false);
    assert.equal(hasPerm(undefined as unknown as string[], 'cms.access'), false);
  });

  test('superadmin "*" grants everything', () => {
    assert.equal(hasPerm(['*'], 'cms.anything.at.all'), true);
  });

  test('exact match', () => {
    assert.equal(hasPerm(['cms.seo.read'], 'cms.seo.read'), true);
    assert.equal(hasPerm(['cms.seo.read'], 'cms.seo.write'), false);
  });

  test('prefix wildcard keeps the trailing dot (no false prefix matches)', () => {
    assert.equal(hasPerm(['cms.seo.*'], 'cms.seo.read'), true);
    assert.equal(hasPerm(['cms.commerce.*'], 'cms.commerce.orders.read'), true);
    assert.equal(hasPerm(['cms.seo.*'], 'cms.seo'), false); // no trailing dot
    assert.equal(hasPerm(['cms.seo.*'], 'cms.seoextra'), false); // must not leak past the dot
  });
});

describe('hasAnyPerm', () => {
  test('true when any required key is granted', () => {
    assert.equal(hasAnyPerm(['cms.seo.read'], ['cms.seo.write', 'cms.seo.read']), true);
    assert.equal(hasAnyPerm(['cms.a'], ['cms.b', 'cms.c']), false);
    assert.equal(hasAnyPerm(['*'], ['cms.x', 'cms.y']), true);
  });
});

describe('ALL_PERMISSIONS', () => {
  test('mirrors the PERMISSIONS map', () => {
    assert.deepEqual(ALL_PERMISSIONS, Object.values(PERMISSIONS));
    assert.ok(ALL_PERMISSIONS.includes('cms.access'));
    assert.ok(ALL_PERMISSIONS.includes('cms.commerce.orders.write'));
  });
});
