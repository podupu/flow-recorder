export type GestureKind = 'tap' | 'longPress' | 'swipe';

export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 250;
export const SWIPE_THRESHOLD_PX = 40;
export const GESTURE_MOVE_TOLERANCE_PX = 10;
export const ERASE_MAX = 100;

export interface Point {
  x: number;
  y: number;
}

export function moveDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function classifySwipeDirection(start: Point, end: Point): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'RIGHT' : 'LEFT';
  }
  return dy > 0 ? 'DOWN' : 'UP';
}

export function classifyPointerGesture(start: Point, end: Point, durationMs: number): GestureKind {
  if (moveDistance(start, end) < GESTURE_MOVE_TOLERANCE_PX) {
    return durationMs >= LONG_PRESS_MS ? 'longPress' : 'tap';
  }
  return 'swipe';
}
