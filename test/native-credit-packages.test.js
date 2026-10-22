import assert from "node:assert/strict";
import { test } from "node:test";
import { readCreditPackages, normalizeCreditPackages } from "../src/native-credit-packages.js";
import { createNativeClient, ORIGIN } from "../src/native-client.js";
import { createCreditsReader } from "../src/native-credits.js";

const base = "TCACA_code_035_ArVxJcGDsm", bonus = "TCACA_code_037_WxOD3MpI2o", topup = "TCACA_code_036_lupO5WgNdG";
const expiry = Date.UTC(2030, 4, 12, 8, 30);
const summary = (codes = [base, bonus]) => ({ Packages: codes.map(PackageCode => ({ PackageCode, CycleTotalCapacity: 80, CycleRemainCapacity: 60, CycleUsedCapacity: 20 })), SubscriptionPackageCode: base });
const account = (PackageCode = bonus, ResourceId = "SYNTHETIC_RESOURCE") => ({ PackageCode, ResourceId,
  CycleCapacitySizePrecise: "80", CycleCapacityRemainPrecise: "60", DeductionEndTime: expiry,
  CycleEndTime: "2030-06-01 00:00:00", AccountId: "PRIVATE", DealName: "PRIVATE", Uin: "PRIVATE" });
const credential = () => ({ type: "oauth", origin: ORIGIN, userId: "SYNTHETIC_USER", access: "SYNTHETIC_ACCESS", expires: Date.now() + 3600000 });
const page = Accounts => ({ Accounts, TotalCount: Accounts.length });

test("detail reads route summary product codes and retain separate resources of the same product", async () => {
  const calls = [];
  const result = await readCreditPackages({ summary: summary([base, bonus, topup]), fetchPage: async (group, body) => {
    calls.push({ group, body });
    return page(group === "paid" ? [account(topup, "topup")] : [account(base, "base"), account(bonus, "bonus-a"), account(bonus, "bonus-b")]);
  } });
  assert.equal(result.state, "complete"); assert.equal(result.accounts.length, 4);
  assert.deepEqual(calls.find(c => c.group === "paid").body.PackageCodes, [topup]);
  assert.deepEqual(calls.find(c => c.group === "free").body.PackageCodes, [base, bonus]);
  for (const { body } of calls) {
    assert.equal(body.OnlyValidPeriod, true); assert.equal(body.IsDisplayTotalInfo, true);
    assert.deepEqual(body.Status, [0,3]); assert.equal(body.PageSize, 200);
    assert.equal(body.PageNumber, 1);
  }
});

test("future product codes are queried on both routes and resource IDs only deduplicate transport records", async () => {
  let calls = 0;
  const result = await readCreditPackages({ summary: summary(["future-product"]), fetchPage: async () => {
    calls++; return page([account("future-product", "same-resource")]);
  } });
  assert.equal(calls, 2); assert.equal(result.accounts.length, 1); assert.equal(result.state, "complete");
  const projected = normalizeCreditPackages(result, summary(["future-product"]));
  assert.equal(projected.items[0].kind, "other");
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|SYNTHETIC_RESOURCE|same-resource|future-product|AccountId|DealName|Uin/);
});

test("pagination retains earlier valid pages on failure and never silently claims completeness", async () => {
  const result = await readCreditPackages({ summary: summary([bonus]), fetchPage: async (_group, body) => {
    if (body.PageNumber === 2) throw Error("PRIVATE_FAILURE");
    return { Accounts: [account()], TotalCount: 2 };
  } });
  assert.equal(result.state, "partial"); assert.equal(result.accounts.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FAILURE/);
});

test("pagination and record budgets are bounded at ten pages and 2000 resources", async () => {
  let calls = 0;
  const result = await readCreditPackages({ summary: summary([bonus]), fetchPage: async (_group, body) => {
    calls++; return { Accounts: Array.from({ length: 200 }, (_, index) => account(bonus, `${body.PageNumber}-${index}`)), TotalCount: 3000 };
  } });
  assert.equal(calls, 10); assert.equal(result.accounts.length, 2000); assert.equal(result.state, "partial");
});

test("malformed/missing detail responses cannot become a fabricated empty complete list", async () => {
  for (const data of [{}, { Accounts: [], TotalCount: "0" }, page([]), page([null]), page([account("unrelated")])]) {
    const result = await readCreditPackages({ summary: summary([bonus]), fetchPage: async () => data });
    assert.equal(result.state, "unavailable"); assert.equal(result.accounts.length, 0);
  }
  let calls = 0;
  assert.equal((await readCreditPackages({ summary: summary([]), fetchPage: async () => { calls++; } })).state, "complete");
  assert.equal((await readCreditPackages({ summary: { Packages: [{}] }, fetchPage: async () => { calls++; } })).state, "unavailable");
  assert.equal(calls, 0);
});

test("detail cancellation cannot publish a partial superseded account snapshot", async () => {
  const abort = new AbortController();
  await assert.rejects(readCreditPackages({ summary: summary([bonus]), signal: abort.signal, fetchPage: async () => {
    abort.abort("PRIVATE"); return page([account()]);
  } }), error => error.diagnosticCode === "cancelled" && !error.message.includes("PRIVATE"));
});

test("package normalization whitelists precise credit metrics, verified milliseconds and product kind", () => {
  const result = normalizeCreditPackages({ state: "complete", accounts: [account(base), account(bonus), account(topup)] }, summary());
  assert.equal(result.count, 3); assert.deepEqual(result.items.map(item => item.kind), ["base", "bonus", "topup"]);
  assert.deepEqual(result.items[1], { kind: "bonus", total: 80, remaining: 60, used: 20, expiresAt: expiry, expiresText: null });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ResourceId|PackageCode|AccountId|DealName|CycleEndTime/);
  assert.equal(Object.isFrozen(result.items), true); assert.equal(Object.isFrozen(result.items[0]), true);
});

test("expiry parsing never assumes seconds, a timezone, a renewal date or never-expiring status", () => {
  for (const value of [0, null, undefined, -1, Infinity, NaN, expiry / 1000, "", "PRIVATE", "2030-02-30T10:00:00Z"]) {
    const result = normalizeCreditPackages({ state: "complete", accounts: [{ ...account(), DeductionEndTime: value }] }, summary());
    assert.equal(result.items[0].expiresAt, null); assert.equal(result.items[0].expiresText, null);
  }
  const normalize = values => normalizeCreditPackages({ state: "complete", accounts: [{ ...account(), ...values }] }, summary()).items[0];
  assert.equal(normalize({ DeductionEndTime: String(expiry) }).expiresAt, expiry);
  assert.equal(normalize({ DeductionEndTime: "2030-05-12T08:30:00Z" }).expiresAt, expiry);
  assert.equal(normalize({ DeductionEndTime: "2030-05-12 08:30:00" }).expiresAt, null);
  assert.equal(normalize({ DeductionEndTime: "2030-05-12 08:30:00" }).expiresText, "2030-05-12 08:30:00");
  assert.equal(normalize({ DeductionEndTime: 0, ExpiredTime: "2030-05-12T08:30:00Z" }).expiresAt, expiry);
});

test("daily expiry may use the documented cycle end; ordinary renewal is not an expiry fallback", () => {
  const raw = { ...account("TCACA_code_001_PqouKr6QWV"), DeductionEndTime: 0, CycleEndTime: "2030-05-12 08:30:00" };
  const daily = normalizeCreditPackages({ state: "complete", accounts: [raw] }, summary()).items[0];
  assert.equal(daily.kind, "daily"); assert.equal(daily.expiresAt, null); assert.equal(daily.expiresText, raw.CycleEndTime);
  const other = normalizeCreditPackages({ state: "complete", accounts: [{ ...raw, PackageCode: bonus }] }, summary()).items[0];
  assert.equal(other.expiresAt, null); assert.equal(other.expiresText, null);
});

test("slice capacities, unknown numbers and invalid detail envelopes remain honest", () => {
  const raw = { ...account(), CapacityType: 4, SlicePeriodUsageDetails: [{ SlicePeriodCapacitySizePrecise: "12.5", SlicePeriodCapacityRemainPrecise: "4.5" }] };
  const result = normalizeCreditPackages({ state: "complete", accounts: [raw] }, summary());
  assert.equal(result.items[0].total, 12.5); assert.equal(result.items[0].remaining, 4.5); assert.equal(result.items[0].used, 8);
  const invalid = normalizeCreditPackages({ state: "partial", accounts: [{ ...account(), CycleCapacitySizePrecise: "PRIVATE" }] }, summary());
  assert.equal(invalid.items[0].total, null); assert.equal(invalid.items[0].used, null);
  for (const details of [undefined, {}, { state: "complete", accounts: [null] }, { state: "unavailable", accounts: [account()] }]) {
    assert.deepEqual(normalizeCreditPackages(details, summary()), { state: "unavailable", count: 0, items: [] });
  }
});

test("native package transport uses only authenticated read routes and bounded scope", async () => {
  const calls = [];
  const client = createNativeClient({ fetch: async (url, options) => {
    calls.push(String(url)); const body = JSON.parse(options.body);
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer SYNTHETIC_ACCESS"); assert.equal(body.OnlyValidPeriod, true);
    return new Response(JSON.stringify({ code: 0, data: page([account(body.PackageCodes[0], String(url))]) }));
  } });
  assert.equal((await client.creditPackages(credential(), undefined, summary([base, topup]))).state, "complete");
  assert.deepEqual(calls.sort(), [ORIGIN + "/billing/meter/get-user-resource-free-packages", ORIGIN + "/billing/meter/get-user-resource-paid-packages"]);
  await assert.rejects(client.creditPackages({ ...credential(), enterpriseId: "tenant" }, undefined, summary()), /personal accounts/);
  await assert.rejects(client.creditPackages({ ...credential(), origin: "https://evil.example" }, undefined, summary()), /credentials/);
  assert.equal(calls.length, 2);
});

test("reader caches immutable per-resource details and never merges same-product bonus grants", async () => {
  let calls = 0;
  const reader = createCreditsReader({ now: () => 1000, client: { credits: async () => summary(), creditPackages: async () => {
    calls++; return { state: "complete", accounts: [account(base), account(bonus, "grant-a"), account(bonus, "grant-b")] };
  } } });
  const first = await reader.read(credential());
  assert.equal(first.packageDetails.count, 3); assert.throws(() => { first.packageDetails.items[0].remaining = -99; });
  const next = await reader.read(credential()); assert.equal(next.packageDetails.items[0].remaining, 60); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(next), /PRIVATE|grant-a|grant-b|SYNTHETIC/);
});

test("detail failure keeps fresh legitimate aggregates, but never repaints old details as fresh", async () => {
  let fail = false;
  const reader = createCreditsReader({ now: () => 1000, client: { credits: async () => summary(), creditPackages: async () => {
    if (fail) throw Error("PRIVATE"); return { state: "complete", accounts: [account()] };
  } } });
  await reader.read(credential()); fail = true;
  const result = await reader.read(credential(), { force: true });
  assert.equal(result.creditsRemaining, 120); assert.equal(result.packageDetails.state, "unavailable");
  assert.equal(result.packageDetails.items.length, 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test("native detail deadlines and caller cancellation remain bounded and sanitized", async () => {
  const client=createNativeClient({requestTimeoutMs:10,fetch:async(_url,options)=>new Promise((_resolve,reject)=>{
    if(options.signal.aborted)reject(Error("PRIVATE"));else options.signal.addEventListener("abort",()=>reject(Error("PRIVATE")),{once:true});
  })});
  const keepAlive=setTimeout(()=>{},1000);
  try{
    const result=await client.creditPackages(credential(),undefined,summary());
    assert.equal(result.state,"unavailable");assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
    await assert.rejects(client.creditPackages(credential(),AbortSignal.abort("PRIVATE"),summary()),error=>error.diagnosticCode==="cancelled"&&!error.message.includes("PRIVATE"));
  }finally{clearTimeout(keepAlive);}
});

test("last-subscriber cancellation during details cannot cache late private package data", async () => {
  let release,signal;
  const reader=createCreditsReader({now:()=>1000,client:{credits:async()=>summary(),creditPackages:async(_credential,active)=>{
    signal=active;return new Promise(resolve=>{release=resolve;});
  }}});
  const abort=new AbortController(),pending=reader.read(credential(),{signal:abort.signal});
  const rejected=assert.rejects(pending,error=>error.diagnosticCode==="cancelled");
  await new Promise(resolve=>setImmediate(resolve));abort.abort();await rejected;assert.equal(signal.aborted,true);
  release({state:"complete",accounts:[account()]});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(reader.read(credential(),{allowNetwork:false}),error=>error.diagnosticCode==="credits-offline");
});
