import { MIN_REQUEST_INTERVAL_MS, USER_AGENT } from "./config.js";

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polite fetch: requests are serialised (concurrency 1), spaced by
 * MIN_REQUEST_INTERVAL_MS, identify themselves via User-Agent and back off on
 * 429/5xx honouring Retry-After.
 */
export function politeFetch(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  const run = async (): Promise<Response> => {
    for (let i = 0; ; i++) {
      const wait = last + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init.headers ?? {}) },
      });
      if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
        const ra = Number(res.headers.get("retry-after"));
        await res.body?.cancel();
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** i);
        continue;
      }
      return res;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
