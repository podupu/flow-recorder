const assert = require('assert');
const { sortByReadingOrder } = require('../../out/readingOrder');

function el(id, left, top, width, height) {
  return { elementId: id, left, top, width, height };
}

describe('sorting elements into reading order', () => {
  it('orders a single column top to bottom', () => {
    const els = [el('c', 0, 0.5, 1, 0.1), el('a', 0, 0.1, 1, 0.1), el('b', 0, 0.3, 1, 0.1)];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['a', 'b', 'c']);
  });

  it('orders a single row left to right', () => {
    const els = [el('c', 0.6, 0, 0.2, 0.1), el('a', 0, 0, 0.2, 0.1), el('b', 0.3, 0, 0.2, 0.1)];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['a', 'b', 'c']);
  });

  it('reads a grid row by row, left to right within each row', () => {
    // Two rows of two buttons, like a 2x2 keypad - reading order should be TL, TR, BL, BR,
    // not sorted purely by top (which happens to already be correct here) or purely by left.
    const els = [
      el('BL', 0, 0.5, 0.4, 0.2),
      el('TR', 0.5, 0, 0.4, 0.2),
      el('TL', 0, 0, 0.4, 0.2),
      el('BR', 0.5, 0.5, 0.4, 0.2)
    ];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['TL', 'TR', 'BL', 'BR']);
  });

  it('treats near-miss tops as the same row when they clearly overlap vertically', () => {
    // A label and a button beside it are rarely pixel-aligned, but a person reading the
    // screen still sees them as one row.
    const els = [el('button', 0.6, 0.102, 0.3, 0.05), el('label', 0, 0.1, 0.3, 0.05)];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['label', 'button']);
  });

  it('treats genuinely separate rows as separate even when close together', () => {
    const els = [el('second', 0, 0.16, 1, 0.05), el('first', 0, 0.1, 1, 0.05)];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['first', 'second']);
  });

  it('does not mutate the input array', () => {
    const els = [el('b', 0, 0.5, 1, 0.1), el('a', 0, 0.1, 1, 0.1)];
    const copy = els.slice();
    sortByReadingOrder(els);
    assert.deepStrictEqual(els, copy);
  });

  it('handles an empty list', () => {
    assert.deepStrictEqual(sortByReadingOrder([]), []);
  });

  it('handles a single element', () => {
    const els = [el('only', 0.2, 0.2, 0.1, 0.1)];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), ['only']);
  });

  it('matches the reference screenshot ordering for a real welcome screen', () => {
    // Logo, version tag, hero image, heading, body text, toggle, CTA row, footer link -
    // taken from the actual screen this feature was requested against.
    const els = [
      el('footer', 0.25, 0.94, 0.5, 0.03),
      el('cta', 0.07, 0.87, 0.86, 0.05),
      el('toggle', 0.46, 0.72, 0.08, 0.02),
      el('body', 0.07, 0.65, 0.86, 0.06),
      el('heading', 0.2, 0.56, 0.6, 0.08),
      el('hero', 0.07, 0.21, 0.86, 0.32),
      el('version', 0.4, 0.17, 0.2, 0.02),
      el('logo', 0.44, 0.09, 0.12, 0.06)
    ];
    assert.deepStrictEqual(sortByReadingOrder(els).map((e) => e.elementId), [
      'logo',
      'version',
      'hero',
      'heading',
      'body',
      'toggle',
      'cta',
      'footer'
    ]);
  });
});
