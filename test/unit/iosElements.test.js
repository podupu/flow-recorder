const assert = require('assert');
const {
  parseIosScreenSize,
  parseIosElements,
  iosKeyboardRegion,
  iosSelector,
  isBlankHierarchy
} = require('../../out/ios/iosElements');

// Trimmed from a real `idb ui describe-all` on iPhone 17 Pro (iOS 26.5).
const SAMPLE = [
  {
    AXFrame: '{{0, 0}, {402, 874}}',
    frame: { y: 0, x: 0, width: 402, height: 874 },
    type: 'Application',
    AXLabel: ' ',
    AXUniqueId: null,
    enabled: true
  },
  {
    frame: { y: 88.00000000000001, x: 24.333333333333314, width: 168.33333333333334, height: 191.0 },
    type: 'Button',
    AXLabel: 'Maps',
    AXUniqueId: 'Maps',
    enabled: true
  },
  {
    frame: { y: 288.6666666666667, x: 26, width: 72, height: 90.66666666666669 },
    type: 'Button',
    AXLabel: 'Photos',
    AXUniqueId: 'Photos',
    enabled: true
  }
];

describe('iOS screen size', () => {
  it('takes the points size from the Application element', () => {
    // The screenshot is in pixels (1206x2622); taps and frames are in points.
    assert.deepStrictEqual(parseIosScreenSize(SAMPLE), { width: 402, height: 874 });
  });

  it('falls back to the largest frame when there is no Application element', () => {
    const noApp = SAMPLE.slice(1);
    const size = parseIosScreenSize(noApp);
    assert.ok(size.width > 0 && size.height > 0);
  });

  it('returns undefined for an empty hierarchy', () => {
    assert.strictEqual(parseIosScreenSize([]), undefined);
  });
});

describe('parsing iOS elements', () => {
  const screen = { width: 402, height: 874 };

  it('normalises frames to 0-1 fractions of the points size', () => {
    const els = parseIosElements(SAMPLE, screen);
    const maps = els.find((e) => e.text === 'Maps');
    assert.ok(Math.abs(maps.left - 24.333333333333314 / 402) < 1e-9);
    assert.ok(Math.abs(maps.top - 88.00000000000001 / 874) < 1e-9);
    assert.ok(Math.abs(maps.width - 168.33333333333334 / 402) < 1e-9);
  });

  it('keeps every element within 0..1', () => {
    for (const e of parseIosElements(SAMPLE, screen)) {
      assert.ok(e.left >= 0 && e.top >= 0, 'no negative origin');
      assert.ok(e.left + e.width <= 1.001 && e.top + e.height <= 1.001, 'stays on screen');
    }
  });

  it('assigns stable ids by index', () => {
    const els = parseIosElements(SAMPLE, screen);
    assert.deepStrictEqual(els.map((e) => e.elementId), [0, 1, 2]);
  });

  it('marks the full-screen Application element unselectable', () => {
    // Matches Android's isSelectable: a near-fullscreen node is not a useful tap target.
    const els = parseIosElements(SAMPLE, screen);
    assert.strictEqual(els[0].selectable, false);
    assert.strictEqual(els.find((e) => e.text === 'Maps').selectable, true);
  });

  it('skips entries with no usable frame instead of throwing', () => {
    const bad = [{ type: 'Button', AXLabel: 'x' }, { frame: { x: 0, y: 0, width: 0, height: 0 } }];
    assert.deepStrictEqual(parseIosElements(bad, screen), []);
  });

  it('treats a whitespace-only AXLabel as no label', () => {
    // The Application element reports AXLabel " ".
    const els = parseIosElements(SAMPLE, screen);
    assert.strictEqual(els[0].text, undefined);
  });

  it('survives a non-array input', () => {
    assert.deepStrictEqual(parseIosElements(null, screen), []);
    assert.deepStrictEqual(parseIosElements(undefined, screen), []);
  });
});

describe('reading text fields whose placeholder has no AXLabel', () => {
  const screen = { width: 402, height: 874 };

  // Real data from a live signup form: UIKit puts the placeholder into AXValue, not AXLabel,
  // when no accessibility label is set - so "First Name", "Email Address" etc. were invisible
  // in the mirror even though the field is clearly visible on screen.
  const FIELDS = [
    { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application', AXLabel: ' ' },
    {
      frame: { x: 36, y: 430.67, width: 289, height: 53 },
      type: 'TextField',
      AXLabel: null,
      AXValue: 'First Name'
    },
    {
      frame: { x: 36, y: 576.67, width: 289, height: 53 },
      type: 'SecureTextField',
      AXLabel: null,
      AXValue: 'Password'
    }
  ];

  it('falls back to AXValue for a TextField with no label', () => {
    const els = parseIosElements(FIELDS, screen);
    const first = els.find((e) => e.className === 'TextField');
    assert.strictEqual(first.text, 'First Name');
  });

  it('applies the same fallback to a SecureTextField', () => {
    const els = parseIosElements(FIELDS, screen);
    const pw = els.find((e) => e.className === 'SecureTextField');
    assert.strictEqual(pw.text, 'Password');
  });

  it('makes the field selectable, since it now has a usable label', () => {
    const els = parseIosElements(FIELDS, screen);
    assert.ok(els.find((e) => e.className === 'TextField').selectable);
  });

  it('still prefers a real AXLabel over the value when both are present', () => {
    const labelled = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 0, y: 10, width: 100, height: 40 }, type: 'TextField', AXLabel: 'Search', AXValue: 'pizza' }
    ];
    const field = parseIosElements(labelled, screen).find((e) => e.className === 'TextField');
    assert.strictEqual(field.text, 'Search');
  });

  it('does not apply the fallback to value-is-state controls', () => {
    // A slider's value ("50%") or a switch's ("1") is not a name - using it as the label
    // would be misleading rather than helpful. Asserted on the control itself, not on
    // element 0: element 0 is the Application root, whose text is always undefined, so
    // indexing it would pass no matter what the parser did.
    const controls = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 0, y: 10, width: 100, height: 40 }, type: 'Slider', AXLabel: null, AXValue: '50%' },
      { frame: { x: 0, y: 60, width: 51, height: 31 }, type: 'Switch', AXLabel: null, AXValue: '1' }
    ];
    const els = parseIosElements(controls, screen);
    assert.strictEqual(els.find((e) => e.className === 'Slider').text, undefined);
    assert.strictEqual(els.find((e) => e.className === 'Switch').text, undefined);
  });

  it('reads body copy from a StaticText that has no AXLabel', () => {
    // The case that made a whole portal-style app look textless: nearly all of its visible
    // copy is StaticText, and UIKit leaves AXLabel null unless the app sets one explicitly.
    const copy = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      {
        frame: { x: 68, y: 200, width: 257, height: 16 },
        type: 'StaticText',
        AXLabel: null,
        AXValue: 'I acknowledge that I have read and agree'
      }
    ];
    const text = parseIosElements(copy, screen).find((e) => e.className === 'StaticText');
    assert.strictEqual(text.text, 'I acknowledge that I have read and agree');
    assert.ok(text.selectable, 'StaticText with recovered copy must become selectable');
  });

  it('reads a Link with no AXLabel', () => {
    const link = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 68, y: 230, width: 120, height: 16 }, type: 'Link', AXLabel: null, AXValue: 'Terms of Use' }
    ];
    assert.strictEqual(parseIosElements(link, screen).find((e) => e.className === 'Link').text, 'Terms of Use');
  });

  it('builds a text selector from recovered StaticText copy, not a point', () => {
    // The point of recovering the text at all: the resulting step must be readable and
    // resilient, not `point: 48%,25%`.
    const copy = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 68, y: 200, width: 257, height: 16 }, type: 'StaticText', AXLabel: null, AXValue: 'Continue' }
    ];
    const el = parseIosElements(copy, screen).find((e) => e.className === 'StaticText');
    assert.deepStrictEqual(el.selector, { text: 'Continue' });
  });

  it('leaves a genuinely empty field without a fabricated label', () => {
    const empty = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 0, y: 10, width: 100, height: 40 }, type: 'TextField', AXLabel: null, AXValue: '' }
    ];
    assert.strictEqual(parseIosElements(empty, screen)[0].text, undefined);
  });
});

describe('iOS selector precedence', () => {
  const screen = { width: 402, height: 874 };

  it('prefers the accessibility label', () => {
    assert.deepStrictEqual(iosSelector({ text: 'Login', resourceId: 'btn' }, 10, 20, screen), {
      text: 'Login'
    });
  });

  it('falls back to the unique id', () => {
    assert.deepStrictEqual(iosSelector({ resourceId: 'btn_login' }, 10, 20, screen), {
      id: 'btn_login'
    });
  });

  it('falls back to a percentage point', () => {
    assert.deepStrictEqual(iosSelector({}, 201, 437, screen), { point: '50%,50%' });
  });
});

describe('iOS keyboard region', () => {
  const screen = { width: 402, height: 874 };

  it('derives the region from keyboard keys', () => {
    const els = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 0, y: 600, width: 40, height: 40 }, type: 'Key', AXLabel: 'q' },
      { frame: { x: 350, y: 800, width: 40, height: 40 }, type: 'Key', AXLabel: 'm' }
    ];
    const region = iosKeyboardRegion(els, screen);
    assert.ok(region, 'expected a region');
    assert.ok(region.top > 0.6 && region.top < 0.75, `top ${region.top}`);
    assert.ok(region.top + region.height <= 1.001);
  });

  it('returns null when no keyboard is present', () => {
    assert.strictEqual(iosKeyboardRegion(SAMPLE, screen), null);
  });

  it('uses an explicit Keyboard container when present', () => {
    const els = [
      { frame: { x: 0, y: 500, width: 402, height: 374 }, type: 'Keyboard' },
      { frame: { x: 0, y: 600, width: 40, height: 40 }, type: 'Key', AXLabel: 'q' }
    ];
    const region = iosKeyboardRegion(els, screen);
    assert.ok(Math.abs(region.top - 500 / 874) < 1e-9, 'container wins over key bounds');
  });
});

describe('elements extending beyond the screen', () => {
  const screen = { width: 402, height: 874 };

  // Real data: a partially-scrolled widget reports y=860 h=168 on an 874pt screen, so its
  // bottom is 1028. Android's uiautomator pre-clips bounds; iOS does not.
  const OVERFLOWING = [
    { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application', AXLabel: ' ' },
    { frame: { x: 24, y: 860, width: 353.67, height: 168.33 }, type: 'Button', AXLabel: 'Maps' }
  ];

  it('clamps a partially off-screen element to the screen', () => {
    const maps = parseIosElements(OVERFLOWING, screen).find((e) => e.text === 'Maps');
    assert.ok(maps, 'element should survive clamping');
    assert.ok(maps.top + maps.height <= 1.0001, `bottom ${maps.top + maps.height} must not exceed 1`);
    assert.ok(maps.left >= 0 && maps.left + maps.width <= 1.0001);
  });

  it('keeps the visible portion rather than shrinking to nothing', () => {
    const maps = parseIosElements(OVERFLOWING, screen).find((e) => e.text === 'Maps');
    // 860 -> 874 is 14pt of 874 visible.
    assert.ok(maps.height > 0.01 && maps.height < 0.02, `height ${maps.height}`);
  });

  it('drops an element entirely off-screen', () => {
    const off = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: 0, y: 2000, width: 100, height: 100 }, type: 'Button', AXLabel: 'Offscreen' }
    ];
    assert.strictEqual(parseIosElements(off, screen).find((e) => e.text === 'Offscreen'), undefined);
  });

  it('drops an element with a negative origin fully outside', () => {
    const off = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: -500, y: 10, width: 100, height: 100 }, type: 'Button', AXLabel: 'Left' }
    ];
    assert.strictEqual(parseIosElements(off, screen).find((e) => e.text === 'Left'), undefined);
  });

  it('clamps a negative origin that is partly visible', () => {
    const partial = [
      { frame: { x: 0, y: 0, width: 402, height: 874 }, type: 'Application' },
      { frame: { x: -20, y: 10, width: 100, height: 100 }, type: 'Button', AXLabel: 'Partial' }
    ];
    const el = parseIosElements(partial, screen).find((e) => e.text === 'Partial');
    assert.ok(el && el.left === 0, 'left clamped to 0');
    assert.ok(Math.abs(el.width - 80 / 402) < 1e-9, 'width is the visible 80pt');
  });

  it('keeps every element within 0..1 for a real overflowing hierarchy', () => {
    for (const e of parseIosElements(OVERFLOWING, screen)) {
      assert.ok(e.left >= 0 && e.top >= 0, 'no negative origin');
      assert.ok(e.left + e.width <= 1.0001 && e.top + e.height <= 1.0001, 'stays on screen');
    }
  });
});

describe('detecting a locked or sleeping screen', () => {
  // Real output from a locked iPhone 17 Pro: one Application element sized 0x0.
  const ASLEEP = [
    {
      AXFrame: '{{0, 0}, {0, 0}}',
      frame: { y: 0, x: 0, width: 0, height: 0 },
      type: 'Application',
      AXLabel: null
    }
  ];

  it('recognises the zero-size signature', () => {
    assert.strictEqual(isBlankHierarchy(ASLEEP), true);
  });

  it('does not flag a healthy screen', () => {
    assert.strictEqual(isBlankHierarchy(SAMPLE), false);
  });

  it('treats an empty hierarchy as blank too', () => {
    assert.strictEqual(isBlankHierarchy([]), true);
    assert.strictEqual(isBlankHierarchy(null), true);
  });

  it('yields no screen size, which is what triggers the wake retry', () => {
    assert.strictEqual(parseIosScreenSize(ASLEEP), undefined);
  });
});
