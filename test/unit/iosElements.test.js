const assert = require('assert');
const {
  parseIosScreenSize,
  parseIosElements,
  iosKeyboardRegion,
  iosSelector
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
