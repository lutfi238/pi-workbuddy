import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeClient, ORIGIN } from "../src/native-client.js";
import { createCreditsReader, normalizeCredits } from "../src/native-credits.js";
import { WorkbuddyError, describeFailure } from "../src/native-errors.js";
import { USER_AGENT } from "../src/client-identity.js";

const credential = (userId = "mock-user") => ({ type: "oauth", origin: ORIGIN, userId,
  access: "SYNTHETIC_ACCESS", refresh: "SYNTHETIC_REFRESH", expires: Date.now() + 3600000 });
const packageOf = (total = 100, remaining = 80, used = 20) => ({ CycleTotalCapacity: total, CycleRemainCapacity: remaining, CycleUsedCapacity: used });
const summary = () => ({ Packages: [packageOf(), packageOf("25", "10", "15")],
  SubscriptionPackageCode: "test-plan", SubscriptionPackageName: "Synthetic plan", IsPaidUser: false });
const json = (data, code = 0, status = 200) => new Response(JSON.stringify({ code, data }), { status });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const hasCode = code => error => error instanceof WorkbuddyError && error.diagnosticCode === code;

function setup({ ttlMs = 60000, maxEntries = 8 } = {}) {
  let time = 1000, calls = 0, next = async () => summary();
  const reader = createCreditsReader({ ttlMs, maxEntries, now: () => time,
    client: { async credits(...args) { calls++; return next(...args); } } });
  return { reader, get calls() { return calls; }, set time(value) { time = value; }, set next(value) { next = value; } };
}

test("credits parser sums separate fields and emits only normalized metadata", () => {
  const result = normalizeCredits({ ...summary(), email: "PRIVATE", token: "PRIVATE", expireAt: 123, other: "PRIVATE" }, 1000);
  assert.deepEqual(result, { creditsTotal: 125, creditsRemaining: 90, creditsUsed: 35, packageCount: 2,
    fetchedAt: 1000, planCode: "test-plan", planName: "Synthetic plan", isPaidUser: false });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|expireAt|percent/);
  assert.equal(normalizeCredits({ Packages: [] }, 1000).creditsTotal, 0);
  assert.equal(normalizeCredits({ Packages: [] }, 1000).creditsRemaining, 0);
});

for (const value of [undefined, null, "", " ", -1, Infinity, NaN, true, {}, "0x20", "1e3", "PRIVATE", Number.MAX_SAFE_INTEGER + 1]) {
  test("credits parser preserves unknown numbers: " + String(value), () => {
    const result = normalizeCredits({ Packages: [packageOf(value, 10, 2), { ...packageOf(), CycleTotalCapacity: value }] }, 1000);
    assert.equal(result.creditsTotal, null);
    assert.equal(result.creditsRemaining, 90);
    assert.equal(result.creditsUsed, 22);
  });
}

test("credits parser handles decimal and zero balances without inventing percentages", () => {
  const result = normalizeCredits({ Packages: [packageOf("1.5", "0", 1.5)], IsPaidUser: "false",
    SubscriptionPackageCode: "\n test \0", SubscriptionPackageName: "x".repeat(200) }, 1000);
  assert.equal(result.creditsTotal, 1.5); assert.equal(result.creditsRemaining, 0);
  assert.equal(result.planCode, "test"); assert.equal(result.planName.length, 128);
  assert.equal(result.isPaidUser, undefined);
  assert.equal(normalizeCredits({ Packages: [packageOf(Number.MAX_SAFE_INTEGER), packageOf(1)] }, 1000).creditsTotal, null);
});

test("credits parser rejects invalid envelopes, oversized arrays and invalid timestamps", () => {
  for (const value of [undefined, {}, { Packages: "wrong" }, { Packages: [null] }, { Packages: [[]] }, { Packages: Array(2001).fill({}) }]) {
    assert.throws(() => normalizeCredits(value, 1000), hasCode("credits-shape"));
  }
  assert.throws(() => normalizeCredits(summary(), NaN), hasCode("credits-shape"));
});

test("native credits transport uses only the verified read route and existing auth", async () => {
  let calls = 0;
  const client = createNativeClient({ fetch: async (url, options) => {
    calls++; assert.equal(String(url), ORIGIN + "/billing/meter/get-user-resource-summary");
    assert.equal(options.method, "POST"); assert.equal(options.body, "{}"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer SYNTHETIC_ACCESS");
    assert.equal(options.headers["User-Agent"], USER_AGENT); assert.ok(options.signal);
    return json(summary());
  } });
  assert.deepEqual(await client.credits(credential()), summary()); assert.equal(calls, 1);
  await assert.rejects(client.credits({ ...credential(), enterpriseId: "tenant" }), hasCode("credits-scope"));
  await assert.rejects(client.credits({ ...credential(), origin: "https://evil.example" }), hasCode("credentials"));
  assert.equal(calls, 1, "rejected credentials/scopes must not reach the network");
});

test("reader does no work until requested; TTL and forced refresh are explicit", async () => {
  const s = setup(); assert.equal(s.calls, 0);
  assert.equal((await s.reader.read(credential())).source, "remote");
  assert.equal((await s.reader.read(credential())).source, "cache"); assert.equal(s.calls, 1);
  s.time = 61000;
  assert.equal((await s.reader.read(credential())).source, "remote"); assert.equal(s.calls, 2);
  await s.reader.read(credential(), { force: true }); assert.equal(s.calls, 3);
  const zero = setup({ ttlMs: 0 }); await zero.reader.read(credential()); await zero.reader.read(credential()); assert.equal(zero.calls, 2);
});

test("account/domain scopes are isolated; token rotation retains the same account cache", async () => {
  const s = setup();
  await s.reader.read(credential());
  await s.reader.read({ ...credential(), access: "ROTATED", refresh: "ROTATED_REFRESH" }); assert.equal(s.calls, 1);
  await s.reader.read(credential("other-user"));
  await s.reader.read({ ...credential(), domain: "workbuddy.ai" }); assert.equal(s.calls, 3);
  await assert.rejects(s.reader.read({ ...credential(), enterpriseId: "tenant" }), hasCode("credits-scope"));
  assert.equal(s.calls, 3);
});

test("cache snapshots cannot be poisoned by a consumer and expose no credentials", async () => {
  const s = setup(); const first = await s.reader.read(credential()); first.creditsRemaining = -999;
  const next = await s.reader.read(credential()); assert.equal(next.creditsRemaining, 90);
  assert.doesNotMatch(JSON.stringify(next), /SYNTHETIC|mock-user|Authorization|access|refresh/);
});

test("offline reads never fetch and explicitly mark aged snapshots stale", async () => {
  const s = setup();
  await assert.rejects(s.reader.read(credential(), { allowNetwork: false }), hasCode("credits-offline"));
  assert.equal(s.calls, 0);
  await s.reader.read(credential()); s.time = 100000;
  const cached = await s.reader.read(credential(), { allowNetwork: false, force: true });
  assert.equal(cached.source, "cache"); assert.equal(cached.stale, true); assert.equal(cached.fetchedAt, 1000);
  const original = process.env.PI_OFFLINE; process.env.PI_OFFLINE = "1";
  try { assert.equal((await s.reader.read(credential(), { force: true })).source, "cache"); }
  finally { if (original === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = original; }
  assert.equal(s.calls, 1);
});

test("clock rollback does not make an old cache indefinitely fresh", async () => {
  const s = setup(); await s.reader.read(credential()); s.time = 500;
  assert.equal((await s.reader.read(credential())).source, "remote"); assert.equal(s.calls, 2);
});

test("simultaneous reads share one request; cancelling one subscriber does not cancel another", async () => {
  const s = setup(), hold = deferred(), abort = new AbortController(); let transportSignal;
  s.next = async (_credential, signal) => { transportSignal = signal; return hold.promise; };
  const a = s.reader.read(credential(), { signal: abort.signal }), b = s.reader.read(credential());
  const rejected = assert.rejects(a, hasCode("cancelled")); await tick(); abort.abort("PRIVATE");
  await rejected; assert.equal(transportSignal.aborted, false); hold.resolve(summary());
  assert.equal((await b).creditsRemaining, 90); assert.equal(s.calls, 1);
});

test("last-subscriber cancellation cannot publish an obsolete response", async () => {
  const s = setup(), hold = deferred(), abort = new AbortController(); let transportSignal;
  s.next = async (_credential, signal) => { transportSignal = signal; return hold.promise; };
  const pending = s.reader.read(credential(), { signal: abort.signal });
  const rejected = assert.rejects(pending, hasCode("cancelled")); await tick(); abort.abort(); await rejected;
  assert.equal(transportSignal.aborted, true);
  s.next = async () => ({ Packages: [packageOf(10, 5, 5)] });
  assert.equal((await s.reader.read(credential())).creditsRemaining, 5);
  hold.resolve(summary()); await tick();
  assert.equal((await s.reader.read(credential(), { allowNetwork: false })).creditsRemaining, 5);
});

test("logout/clear cancels readers, removes private balances and preserves other account scopes", async () => {
  const s = setup(); await s.reader.read(credential()); await s.reader.read(credential("other-user"));
  s.reader.clear(credential());
  await assert.rejects(s.reader.read(credential(), { allowNetwork: false }), hasCode("credits-offline"));
  assert.equal((await s.reader.read(credential("other-user"), { allowNetwork: false })).creditsRemaining, 90);
  const hold = deferred(); s.next = async () => hold.promise;
  const pending = s.reader.read(credential()); const rejected = assert.rejects(pending, hasCode("cancelled"));
  await tick(); s.reader.clear(); await rejected; hold.resolve(summary()); await tick();
  await assert.rejects(s.reader.read(credential("other-user"), { allowNetwork: false }), hasCode("credits-offline"));
  await assert.rejects(s.reader.read(credential(), { allowNetwork: false }), hasCode("credits-offline"));
});

test("transient failures return clearly stale last-good data and sanitized diagnostics", async () => {
  for (const error of [new Error("PRIVATE_TOKEN"), new WorkbuddyError("network", "PRIVATE"),
    new WorkbuddyError("http", "PRIVATE", { status: 429 }), new WorkbuddyError("http", "PRIVATE", { status: 503 })]) {
    const s = setup(); await s.reader.read(credential()); s.next = async () => { throw error; };
    const result = await s.reader.read(credential(), { force: true });
    assert.equal(result.stale, true); assert.equal(result.source, "cache"); assert.equal(result.creditsRemaining, 90);
    assert.equal(result.fetchedAt, 1000); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("authentication/business denials discard cached balances instead of returning stale data", async () => {
  for (const status of [200, 401, 403, 404]) {
    const s = setup(); await s.reader.read(credential());
    s.next = async () => { throw new WorkbuddyError("http", "PRIVATE", { status, businessCode: 123 }); };
    await assert.rejects(s.reader.read(credential(), { force: true }), error => {
      assert.equal(error.diagnosticCode, "http"); assert.doesNotMatch(error.message, /PRIVATE/); return true;
    });
    await assert.rejects(s.reader.read(credential(), { allowNetwork: false }), hasCode("credits-offline"));
  }
});

test("synchronous failures and malformed responses never poison pending requests or cache", async () => {
  const s = setup(); s.next = () => { throw new Error("PRIVATE"); };
  await assert.rejects(s.reader.read(credential()), hasCode("credits-request"));
  s.next = () => ({ Packages: "PRIVATE" }); await assert.rejects(s.reader.read(credential()), hasCode("credits-shape"));
  s.next = () => summary(); assert.equal((await s.reader.read(credential())).creditsRemaining, 90);
  s.next = () => ({ Packages: "PRIVATE" }); const stale = await s.reader.read(credential(), { force: true });
  assert.equal(stale.stale, true); assert.doesNotMatch(stale.error, /PRIVATE/);
});

test("LRU cache and concurrent request budgets are bounded", async () => {
  const s = setup({ maxEntries: 2 });
  await s.reader.read(credential("a")); await s.reader.read(credential("b")); await s.reader.read(credential("a")); await s.reader.read(credential("c"));
  await assert.rejects(s.reader.read(credential("b"), { allowNetwork: false }), hasCode("credits-offline"));
  const hold = deferred(); s.next = async () => hold.promise;
  const a = s.reader.read(credential("x")), b = s.reader.read(credential("y"));
  await assert.rejects(s.reader.read(credential("z")), hasCode("credits-busy"));
  hold.resolve(summary()); await Promise.all([a,b]);
});

test("abort and timeout remain sanitized through the actual native transport", async () => {
  const client = createNativeClient({ requestTimeoutMs: 10, fetch: async (_url, options) => new Promise((_yes, reject) => {
    if (options.signal.aborted) reject(new Error("PRIVATE"));
    else options.signal.addEventListener("abort", () => reject(new Error("PRIVATE")), { once: true });
  }) });
  const reader = createCreditsReader({ client });
  await assert.rejects(reader.read(credential()), error => error.diagnosticCode === "request-timeout" && !error.message.includes("PRIVATE"));
  const abort = new AbortController(), pending = reader.read(credential(), { signal: abort.signal });
  const rejected = assert.rejects(pending, hasCode("cancelled")); abort.abort(); await rejected;
});

test("invalid options/configuration and pre-aborted calls never start requests", async () => {
  for (const options of [{ ttlMs: -1 }, { maxEntries: 0 }, { maxEntries: 129 }, { now: 5 }, { client: {} }]) {
    assert.throws(() => createCreditsReader(options), /configuration/);
  }
  const s = setup();
  await assert.rejects(s.reader.read(credential(), { signal: AbortSignal.abort() }), hasCode("cancelled"));
  await assert.rejects(s.reader.read(credential(), { force: "yes" }), /options/);
  await assert.rejects(s.reader.read(credential(), { signal: {} }), /options/);
  await assert.rejects(s.reader.read({ ...credential(), origin: "https://evil.example" }), hasCode("credentials"));
  assert.equal(s.calls, 0);
  const invalidClock = createCreditsReader({ client: { credits: async () => summary() }, now: () => NaN });
  await assert.rejects(invalidClock.read(credential()), hasCode("credits-request"));
  assert.doesNotMatch(describeFailure(new WorkbuddyError("credits-shape", "PRIVATE")), /PRIVATE/);
});
