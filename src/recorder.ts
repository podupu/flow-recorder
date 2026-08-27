export interface ApiRequestPayload {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ApiResult {
  status: number;
  durationMs: number;
  bodyPreview: string;
}

/**
 * Executes a real HTTP request and captures status/timing/body.
 * This half needs no external engine - Node 18+'s global fetch is enough.
 */
export async function runApiRequest(payload: ApiRequestPayload): Promise<ApiResult> {
  const start = Date.now();
  try {
    const res = await fetch(payload.url, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body && payload.method.toUpperCase() !== 'GET' ? payload.body : undefined
    });
    const durationMs = Date.now() - start;
    const text = await res.text();
    return {
      status: res.status,
      durationMs,
      bodyPreview: text.slice(0, 500)
    };
  } catch (err: any) {
    return {
      status: 0,
      durationMs: Date.now() - start,
      bodyPreview: `error: ${err.message}`
    };
  }
}

export interface ScreenshotResult {
  path: string;
  note: string;
}

/**
 * STUB - this is the piece worth spiking before building further.
 *
 * Real Maestro Studio drives a connected device over ADB (Android) or
 * idb (iOS) to mirror the screen and capture taps. The two realistic ways
 * to get that here are:
 *   1. Shell out to `maestro studio` (spawn it as a child process) and
 *      connect to whatever local API/websocket it exposes, forwarding
 *      its screenshot + tap events into this extension instead of
 *      Maestro's own browser UI.
 *   2. Drop down to raw `adb exec-out screencap` / idb screenshot calls
 *      yourself, plus your own tap-hierarchy inspection.
 *
 * Route (1) reuses far more of Maestro's engine but depends on an
 * undocumented local protocol - confirm it's usable before committing.
 * Until that's wired up, this stub returns a placeholder block so the
 * rest of the recording pipeline (writing to flow.yaml, rendering in
 * the webview) can be built and tested end-to-end.
 */
export async function captureScreenshotStub(): Promise<ScreenshotResult> {
  return {
    path: 'assets/placeholder.png',
    note: 'Stub screenshot - wire this up to a real device bridge (Maestro CLI, ADB, or idb).'
  };
}
