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
