/**
 * The account's Addresses panel posts to `/api/cms/customer/addresses` and
 * `/api/cms/customer/addresses/[id]`, and `customers/routes.ts` has had the
 * handlers for both — but the two folders under `src/app/api` were empty, so
 * nothing was mounted and every save or delete got Next's 404.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const route = (path: string) => new URL(`../../src/app/api/cms/customer/${path}/route.ts`, import.meta.url);

describe('customer address routes are mounted', () => {
  test('the collection route lists and adds, behind the customers module gate', () => {
    const file = route('addresses');
    assert.ok(existsSync(file), 'addresses/route.ts is missing');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /customerAddressesRoute\(\)/);
    assert.match(text, /isModuleEnabled\(config, 'customers'\)/);
    assert.match(text, /export async function GET\(/);
    assert.match(text, /export async function POST\(/);
  });

  test('the item route edits and deletes one address, passing the id through', () => {
    const file = route('addresses/[id]');
    assert.ok(existsSync(file), 'addresses/[id]/route.ts is missing');
    const text = readFileSync(file, 'utf8');
    assert.match(text, /customerAddressRoute\(\)/);
    assert.match(text, /isModuleEnabled\(config, 'customers'\)/);
    assert.match(text, /export async function PATCH\(req: NextRequest, ctx/);
    assert.match(text, /export async function DELETE\(req: NextRequest, ctx/);
    assert.match(text, /handlers\.PATCH\(req, ctx\)/);
    assert.match(text, /handlers\.DELETE\(req, ctx\)/);
  });
});
