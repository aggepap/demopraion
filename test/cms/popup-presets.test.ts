import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  POPUP_PRESETS,
  popupPreset,
  resolvePopupDesign,
  safeColor,
} from '@/cms/modules/popups/presets';

/**
 * Ready-made popup designs, each customisable.
 *
 * The point of a preset is that choosing one is enough: an owner who changes
 * nothing still gets a finished popup, and every field they do change simply
 * overrides that preset's own default.
 *
 * The colours are the part that needs guarding. They come from an admin form
 * and end up in a `style` attribute, so anything that is not a plain hex colour
 * is refused and the preset's default is used instead — a colour field is not a
 * way to write CSS.
 */

describe('POPUP_PRESETS', () => {
  test('there are six, each with a distinct id and a label', () => {
    assert.equal(POPUP_PRESETS.length, 6);
    assert.equal(new Set(POPUP_PRESETS.map((p) => p.id)).size, 6);
    for (const preset of POPUP_PRESETS) {
      assert.ok(preset.label.length > 0, preset.id);
      assert.match(preset.id, /^[a-z][a-z0-9-]*$/);
    }
  });

  test('every preset brings a full set of defaults', () => {
    for (const preset of POPUP_PRESETS) {
      assert.match(preset.defaults.background, /^#[0-9a-fA-F]{6}$/, preset.id);
      assert.match(preset.defaults.text, /^#[0-9a-fA-F]{6}$/, preset.id);
      assert.match(preset.defaults.buttonBackground, /^#[0-9a-fA-F]{6}$/, preset.id);
      assert.match(preset.defaults.buttonText, /^#[0-9a-fA-F]{6}$/, preset.id);
      assert.ok(['s', 'm', 'l'].includes(preset.defaults.textSize), preset.id);
    }
  });
});

describe('popupPreset', () => {
  test('finds one by id', () => {
    assert.equal(popupPreset('spotlight').id, 'spotlight');
  });

  test('an unknown or empty id falls back to the first, never to nothing', () => {
    // A popup whose preset was renamed must still render.
    assert.equal(popupPreset('nope').id, POPUP_PRESETS[0].id);
    assert.equal(popupPreset('').id, POPUP_PRESETS[0].id);
  });
});

describe('safeColor', () => {
  test('accepts the hex a colour picker produces', () => {
    assert.equal(safeColor('#ff0000', '#000000'), '#ff0000');
    assert.equal(safeColor('#FFF', '#000000'), '#FFF');
    assert.equal(safeColor('  #123abc  ', '#000000'), '#123abc');
  });

  test('refuses anything that is not a colour, and uses the fallback', () => {
    // The whole reason this function exists: these reach a style attribute.
    for (const bad of [
      'red; background-image: url(https://evil.test/x)',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      '#ff0000;}',
      'rgb(0,0,0)',
      '',
      '   ',
    ]) {
      assert.equal(safeColor(bad, '#123456'), '#123456', bad);
    }
  });

  test('a missing value is simply the fallback', () => {
    assert.equal(safeColor(undefined, '#123456'), '#123456');
    assert.equal(safeColor(null, '#123456'), '#123456');
  });
});

describe('resolvePopupDesign', () => {
  const preset = popupPreset('spotlight');

  test('a popup with nothing set looks like its preset', () => {
    const design = resolvePopupDesign({ preset: 'spotlight' });
    assert.equal(design.preset.id, 'spotlight');
    assert.equal(design.background, preset.defaults.background);
    assert.equal(design.text, preset.defaults.text);
    assert.equal(design.buttonBackground, preset.defaults.buttonBackground);
    assert.equal(design.textSize, preset.defaults.textSize);
  });

  test('each override wins over the preset', () => {
    const design = resolvePopupDesign({
      preset: 'spotlight',
      backgroundColor: '#101010',
      textColor: '#fefefe',
      buttonColor: '#00ff00',
      buttonTextColor: '#001100',
      textSize: 'l',
    });
    assert.equal(design.background, '#101010');
    assert.equal(design.text, '#fefefe');
    assert.equal(design.buttonBackground, '#00ff00');
    assert.equal(design.buttonText, '#001100');
    assert.equal(design.textSize, 'l');
  });

  test('a colour that is not a colour falls back rather than reaching the page', () => {
    const design = resolvePopupDesign({
      preset: 'spotlight',
      backgroundColor: 'red; background-image: url(https://evil.test/x)',
    });
    assert.equal(design.background, preset.defaults.background);
  });

  test('an unknown text size is the preset’s, not an arbitrary one', () => {
    const design = resolvePopupDesign({ preset: 'spotlight', textSize: '72px' });
    assert.equal(design.textSize, preset.defaults.textSize);
  });

  test('the background image becomes a media URL, with the id escaped', () => {
    const design = resolvePopupDesign({ preset: 'spotlight', backgroundImage: 'abc 123' });
    assert.equal(design.backgroundImage, '/api/cms/media/file/abc%20123');
  });

  test('no image means no image, not an empty URL', () => {
    assert.equal(resolvePopupDesign({ preset: 'spotlight' }).backgroundImage, null);
    assert.equal(
      resolvePopupDesign({ preset: 'spotlight', backgroundImage: '' }).backgroundImage,
      null
    );
  });

  test('a preset that is built around an image says so, for the editor', () => {
    // The form can then point out that this design expects one.
    assert.equal(popupPreset('takeover').usesImage, true);
    assert.equal(popupPreset('plain').usesImage, false);
  });

  test('text size maps to a class, never to a number from the form', () => {
    for (const size of ['s', 'm', 'l'] as const) {
      const design = resolvePopupDesign({ preset: 'spotlight', textSize: size });
      assert.match(design.textClass, /^text-/);
    }
  });
});
