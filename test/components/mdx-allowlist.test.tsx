/**
 * `MDX_ALLOWED_COMPONENTS` is a hand-written list of strings because both
 * `site.config.ts` (which must stay free of React) and `src/cms/**` (which may
 * not import `@/mdx-components` at all) need it. That makes it a copy, and a
 * copy drifts: adding a component to the MDX map without listing it here would
 * make the guard refuse bodies that use it — and the render path answers a
 * refusal with a blank body, so the symptom is a live page quietly losing its
 * content. This test is what makes the copy safe.
 */
import './../setup/react-global';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MDX_ALLOWED_COMPONENTS } from '@/lib/cms/mdx-allowlist';
import { useMDXComponents as getMdxComponents } from '@/mdx-components';

describe('MDX allow-list', () => {
  test('matches the component map exactly', () => {
    // Lowercase keys are markdown element overrides (h2, p, ul, …). Those are
    // reached through markdown syntax, never as JSX tags, and are deliberately
    // NOT allow-listed — that is what keeps `<script>` off the list too.
    const fromMap = Object.keys(getMdxComponents({}))
      .filter((key) => /^[A-Z]/.test(key))
      .sort();

    assert.deepEqual([...MDX_ALLOWED_COMPONENTS].sort(), fromMap);
  });

  test('holds no raw HTML element names', () => {
    const lowercase = MDX_ALLOWED_COMPONENTS.filter((name) => /^[a-z]/.test(name));
    assert.deepEqual(lowercase, []);
  });
});
