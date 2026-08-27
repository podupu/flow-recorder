const assert = require('assert');
const {
  classifyPointerGesture,
  classifySwipeDirection,
  moveDistance,
  LONG_PRESS_MS,
  SWIPE_THRESHOLD_PX
} = require('../../out/gestures');

describe('gestures', () => {
  it('classifies a quick stationary gesture as tap', () => {
    assert.strictEqual(classifyPointerGesture({ x: 0, y: 0 }, { x: 2, y: 1 }, 100), 'tap');
  });

  it('classifies a held stationary gesture as longPress', () => {
    assert.strictEqual(
      classifyPointerGesture({ x: 0, y: 0 }, { x: 2, y: 1 }, LONG_PRESS_MS + 100),
      'longPress'
    );
  });

  it('classifies movement as swipe even when quick', () => {
    assert.strictEqual(
      classifyPointerGesture({ x: 0, y: 0 }, { x: 0, y: SWIPE_THRESHOLD_PX + 20 }, 100),
      'swipe'
    );
  });

  it('classifies swipe direction by dominant axis', () => {
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: -100, y: 5 }), 'LEFT');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 100, y: 5 }), 'RIGHT');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 5, y: 100 }), 'DOWN');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 5, y: -100 }), 'UP');
  });

  it('computes euclidean distance', () => {
    assert.strictEqual(moveDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});
