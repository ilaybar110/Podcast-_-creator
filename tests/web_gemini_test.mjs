// Node test for docs/js/gemini.js (run by tests/test_app.py): free-quota refunds, request timeouts,
// cancelling in-flight requests and waiting while offline, all with a fake fetch.
import assert from "node:assert/strict";
const G = await import(new URL("../docs/js/gemini.js", import.meta.url));
const { Gemini, Ledger, Cancelled, ProviderError, withRetries } = G;

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const BODY = { contents: [{ role: "user", parts: [{ text: "hello" }] }] };
const ok = (data = { candidates: [{ content: { parts: [{ text: "hi" }] } }] }) => ({ ok: true, status: 200, json: async () => data });
const fail = (status, message = "bad") => ({ ok: false, status, statusText: "x", json: async () => ({ error: { message } }) });

function client(fetchFn, opts = {}) {
  const ledger = new Ledger(memStorage());
  const g = new Gemini("test-key", { fetchFn, ledger, ...opts });
  const used = async (b = "gemini_text") => ledger.used(await g.gate.kidP, b);
  const perMinute = async (b = "gemini_text") => ledger.window(await g.gate.kidP, b).length;
  return { g, used, perMinute };
}

// refund when the request never reached Google (network error)
{
  const { g, used, perMinute } = client(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(g.generate("gemini-2.5-flash", BODY), (e) => e instanceof ProviderError && e.retryable && e.refunded);
  assert.equal(await used(), 0); assert.equal(await perMinute(), 0);
}

// refund on a 5xx answer; still retryable
{
  const { g, used } = client(async () => fail(503, "overloaded"));
  await assert.rejects(g.generate("gemini-2.5-flash", BODY), (e) => e instanceof ProviderError && e.retryable && /503/.test(e.message));
  assert.equal(await used(), 0);
}

// no refund on 200 or 400: Google counted those
{
  const { g, used } = client(async () => ok());
  await g.generate("gemini-2.5-flash", BODY);
  assert.equal(await used(), 1);
  const b = client(async () => fail(400, "bad request"));
  await assert.rejects(b.g.generate("gemini-2.5-flash", BODY), (e) => e instanceof ProviderError && !e.retryable && !e.refunded);
  assert.equal(await b.used(), 1);
}

// a hung request times out as a retryable error (refunded), and the retry succeeds
{
  let calls = 0;
  const hang = (url, init) => new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const { g, used } = client(async (url, init) => (++calls <= 2 ? hang(url, init) : ok()), { timeouts: { tts: 50, text: 50 } });
  await assert.rejects(g.generate("gemini-2.5-flash", BODY), (e) => e instanceof ProviderError && e.retryable && /did not answer/.test(e.message));
  assert.equal(await used(), 0);
  const data = await withRetries(() => g.generate("gemini-2.5-flash", BODY), 3, 10);
  assert.equal(data.candidates[0].content.parts[0].text, "hi");
  assert.equal(calls, 3); assert.equal(await used(), 1);
}

// Cancel aborts an in-flight request: Cancelled, refunded, later requests refuse to start
{
  let started = 0;
  const { g, used } = client((url, init) => { started++; return new Promise((_, reject) =>
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); });
  const p = g.generate("gemini-2.5-flash-preview-tts", BODY);
  setTimeout(() => g.abortAll(), 20);
  await assert.rejects(p, (e) => e instanceof Cancelled);
  assert.equal(await used("gemini_tts"), 0);
  await assert.rejects(g.generate("gemini-2.5-flash", BODY), (e) => e instanceof Cancelled);
  assert.equal(started, 1);
}

// an outside AbortSignal cancels too, including a retry wait
{
  const ac = new AbortController();
  const { g } = client(async () => fail(503), { signal: ac.signal });
  const t0 = Date.now();
  const p = withRetries(() => g.generate("gemini-2.5-flash", BODY), 6, 60000);
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(p, (e) => e instanceof Cancelled);
  assert.ok(Date.now() - t0 < 5000);
}

// offline: wait for the "online" event instead of spending requests, and say so through gate.onWait
{
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  const listeners = [];
  const prevAdd = globalThis.addEventListener, prevRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, fn) => type === "online" && listeners.push(fn);
  globalThis.removeEventListener = () => {};
  try {
    let calls = 0, waits = [];
    const { g, used } = client(async () => { calls++; return ok(); });
    g.gate.onWait = (s, why) => waits.push(why);
    const p = g.generate("gemini-2.5-flash", BODY);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 0); assert.equal(await used(), 0);
    assert.deepEqual(waits, ["offline"]);
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
    listeners.forEach((fn) => fn());
    await p;
    assert.equal(calls, 1); assert.equal(await used(), 1);
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav); else delete globalThis.navigator;
    globalThis.addEventListener = prevAdd; globalThis.removeEventListener = prevRemove;
  }
}

console.log("web gemini tests passed");
