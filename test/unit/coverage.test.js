const assert = require('assert');
const { findAccessibilityGaps, describeGaps } = require('../../out/coverage');

/**
 * A screen region with no accessibility elements is indistinguishable, from inside the mirror,
 * from element detection being broken - both look like "nothing is highlighted here". They need
 * completely different responses: one is an app bug the developer must fix, the other is ours.
 * These bands are how the mirror tells the user which one it is looking at.
 */

/** Elements are normalised 0-1, the same shape the drivers hand to the panel. */
function el(top, height, left = 0.1, width = 0.8) {
  return { top, height, left, width };
}

describe('finding accessibility gaps', () => {
  it('reports no gaps when elements cover the screen evenly', () => {
    const elements = [];
    for (let top = 0; top < 1; top += 0.1) elements.push(el(top, 0.1));
    assert.deepStrictEqual(findAccessibilityGaps(elements), []);
  });

  it('finds a tall empty band above the first element', () => {
    // The signup-header case: nothing accessible until well down the screen.
    const gaps = findAccessibilityGaps([el(0.5, 0.1), el(0.7, 0.1), el(0.9, 0.05)]);
    assert.strictEqual(gaps.length, 1);
    assert.ok(gaps[0].top < 0.02, 'gap should start at the top of the screen');
    assert.ok(gaps[0].height > 0.45, 'gap should span the empty upper half');
  });

  it('finds a band between two groups of elements', () => {
    const gaps = findAccessibilityGaps([el(0.05, 0.05), el(0.8, 0.1)]);
    assert.strictEqual(gaps.length, 1);
    assert.ok(gaps[0].top > 0.05 && gaps[0].top < 0.15);
    assert.ok(gaps[0].height > 0.6);
  });

  it('ignores gaps too small to be worth reporting', () => {
    // A little breathing room between rows is normal layout, not a missing element.
    const gaps = findAccessibilityGaps([el(0, 0.45), el(0.5, 0.5)]);
    assert.deepStrictEqual(gaps, []);
  });

  it('ignores the full-screen application root, which would mask every gap', () => {
    const withRoot = [{ top: 0, height: 1, left: 0, width: 1 }, el(0.5, 0.1), el(0.7, 0.1)];
    const gaps = findAccessibilityGaps(withRoot);
    assert.ok(gaps.length >= 1, 'the root must not count as coverage');
  });

  it('treats a screen with no elements as one whole-screen gap', () => {
    const gaps = findAccessibilityGaps([]);
    assert.strictEqual(gaps.length, 1);
    assert.ok(gaps[0].height > 0.95);
  });

  it('matches the real signup screen this was built for', () => {
    // Logo, heading and description are absent from the tree; v1.8.7 and the fields are not.
    // Frames are the live ones from the device, normalised against a 402x874 screen.
    const screen = 874;
    const at = (y, h) => el(y / screen, h / screen);
    const gaps = findAccessibilityGaps([
      { top: 0, height: 1, left: 0, width: 1 }, // Application root
      at(134, 33), // v1.8.7
      at(430, 53), // First Name
      at(503, 53),
      at(576, 53),
      at(649, 53),
      at(722, 53),
      at(795, 53),
      at(744, 48) // Next
    ]);
    // The band between the version label and the first text field is the header the app hides.
    const header = gaps.find((g) => g.top > 0.15 && g.top < 0.25);
    assert.ok(header, 'should flag the hidden header band, got ' + JSON.stringify(gaps));
    assert.ok(header.height > 0.25, 'header band is roughly 30% of the screen');
  });
});

describe('describing gaps for the user', () => {
  it('says nothing when there are no gaps', () => {
    assert.strictEqual(describeGaps([]), undefined);
  });

  it('names the size of a single band', () => {
    const text = describeGaps([{ top: 0.19, height: 0.3 }]);
    assert.match(text, /30%/);
    assert.match(text, /accessibility/i);
  });

  it('summarises several bands together', () => {
    const text = describeGaps([{ top: 0, height: 0.15 }, { top: 0.19, height: 0.3 }]);
    assert.match(text, /2 areas/);
  });
});
