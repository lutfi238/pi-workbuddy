import { createNativeClient, accountHeaders } from "./native-client.js";
import { catalogCacheKey } from "./native-catalog-cache.js";
import { WorkbuddyError, describeFailure } from "./native-errors.js";
import { normalizeCreditPackages } from "./native-credit-packages.js";

const MAX_PACKAGES = 2000;
function capacity(value) {
  if (typeof value === "string") {
    if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
}
function text(value) {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 128);
  return result || undefined;
}

/** Personal-account credits only; never infer a plan label, expiry, USD cost, or percentage. */
export function normalizeCredits(data, fetchedAt) {
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0 || !data || !Array.isArray(data.Packages) || data.Packages.length > MAX_PACKAGES ||
    data.Packages.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new WorkbuddyError("credits-shape", "Unsupported WorkBuddy credit summary.");
  }
  const total = field => {
    let result = 0;
    for (const item of data.Packages) {
      const value = capacity(item[field]);
      if (value === null || result + value > Number.MAX_SAFE_INTEGER) return null;
      result += value;
    }
    return result;
  };
  const planCode = text(data.SubscriptionPackageCode), planName = text(data.SubscriptionPackageName);
  return {
    creditsTotal: total("CycleTotalCapacity"),
    creditsRemaining: total("CycleRemainCapacity"),
    creditsUsed: total("CycleUsedCapacity"),
    packageCount: data.Packages.length, fetchedAt,
    ...(typeof data.IsPaidUser === "boolean" ? { isPaidUser: data.IsPaidUser } : {}),
    ...(planCode ? { planCode } : {}), ...(planName ? { planName } : {}),
  };
}

function cancelled() { return new WorkbuddyError("cancelled", "WorkBuddy credit read cancelled."); }
function safeError(error) {
  const message = describeFailure(error);
  if (error instanceof WorkbuddyError && !message.startsWith("[unknown]")) {
    const details = {};
    if (Number.isInteger(error.details.status)) details.status = error.details.status;
    if (Number.isSafeInteger(error.details.businessCode)) details.businessCode = error.details.businessCode;
    // Do not expose upstream/custom error text, causes, or arbitrary diagnostic fields.
    return new WorkbuddyError(error.diagnosticCode, message, details);
  }
  return new WorkbuddyError("credits-request", "WorkBuddy credits could not be refreshed.");
}
function permitsStale(error) {
  if (["cancelled", "credentials", "account-domain", "metadata", "endpoint", "credits-scope"].includes(error.diagnosticCode)) return false;
  if (error.diagnosticCode !== "http") return true;
  const status = error.details.status;
  return status === 408 || status === 429 || status >= 500 && status <= 599;
}

/** No timers, persistence, automatic login/refresh, or network work until read() is explicitly called. */
export function createCreditsReader({ client = createNativeClient(), ttlMs = 60000, maxEntries = 8, now = Date.now } = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128 ||
    typeof now !== "function" || typeof client?.credits !== "function") throw new Error("Invalid WorkBuddy credit-reader configuration.");
  const cache = new Map(), pending = new Map();
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("WorkBuddy credit-reader clock must return a nonnegative safe integer.");
    return value;
  };
  function keyFor(credential) {
    accountHeaders(credential);
    if (credential.enterpriseId) throw new WorkbuddyError("credits-scope", "The verified credits route supports personal accounts only.");
    const key = catalogCacheKey(credential); // Reuse only the hashed account scope, never the model store.
    if (!key) throw new WorkbuddyError("credentials", "Invalid WorkBuddy account scope.");
    return key;
  }
  function fresh(snapshot) {
    const age = timestamp() - snapshot.fetchedAt;
    return age >= 0 && age < ttlMs;
  }
  function remember(key, snapshot) {
    cache.delete(key); cache.set(key, snapshot);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  function start(key, credential) {
    if (pending.size >= maxEntries) throw new WorkbuddyError("credits-busy", "Too many WorkBuddy credit reads.");
    const job = { controller: new AbortController(), users: 0, settled: false };
    // Defer execution until the job has been registered, including synchronous client failures.
    job.promise = Promise.resolve().then(async () => {
      try {
        if (job.controller.signal.aborted) throw cancelled();
        const raw = await client.credits(credential, job.controller.signal);
        if (job.controller.signal.aborted) throw cancelled();
        const metrics = normalizeCredits(raw, timestamp());
        let packageDetails;
        if (typeof client.creditPackages === "function") {
          let details;
          try { details = await client.creditPackages(credential, job.controller.signal, raw); }
          catch { if (job.controller.signal.aborted) throw cancelled(); }
          packageDetails = normalizeCreditPackages(details, raw);
        }
        if (job.controller.signal.aborted) throw cancelled();
        // All fields share the start-of-read timestamp, rather than making older metrics look newer.
        const snapshot = Object.freeze({ ...metrics, ...(packageDetails ? { packageDetails } : {}) });
        remember(key, snapshot);
        return snapshot;
      } catch (error) {
        const failure = job.controller.signal.aborted ? cancelled() : safeError(error);
        if (!permitsStale(failure) && failure.diagnosticCode !== "cancelled") cache.delete(key);
        throw failure;
      }
    }).finally(() => {
      job.settled = true;
      if (pending.get(key) === job) pending.delete(key);
    });
    pending.set(key, job);
    return job;
  }
  function join(key, job, signal) {
    job.users++;
    return new Promise((resolve, reject) => {
      let active = true;
      const leave = () => {
        active = false;
        signal?.removeEventListener("abort", abort);
        job.controller.signal.removeEventListener("abort", abort);
        if (--job.users === 0 && !job.settled) {
          if (pending.get(key) === job) pending.delete(key);
          job.controller.abort();
        }
      };
      const abort = () => { if (active) { leave(); reject(cancelled()); } };
      signal?.addEventListener("abort", abort, { once: true });
      job.controller.signal.addEventListener("abort", abort, { once: true });
      job.promise.then(value => { if (active) { leave(); resolve(value); } }, error => { if (active) { leave(); reject(error); } });
      if (signal?.aborted || job.controller.signal.aborted) abort();
    });
  }
  return {
    async read(credential, { signal, force = false, allowNetwork = true } = {}) {
      if (typeof force !== "boolean" || typeof allowNetwork !== "boolean" || signal !== undefined &&
        (typeof signal?.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
        throw new Error("Invalid WorkBuddy credit-read options.");
      }
      if (signal?.aborted) throw cancelled();
      const key = keyFor(credential), saved = cache.get(key);
      const network = allowNetwork && process.env.PI_OFFLINE === undefined;
      if (saved && (!network || !force && fresh(saved))) {
        remember(key, saved);
        return { ...saved, source: "cache", stale: !fresh(saved) };
      }
      if (!network) throw new WorkbuddyError("credits-offline", "No cached WorkBuddy credits available offline.");
      try {
        const snapshot = await join(key, pending.get(key) ?? start(key, credential), signal);
        return { ...snapshot, source: "remote", stale: false };
      } catch (error) {
        const failure = safeError(error), previous = cache.get(key);
        if (previous && permitsStale(failure)) return { ...previous, source: "cache", stale: true, error: failure.message };
        throw failure;
      }
    },
    clear(credential) {
      const key = credential === undefined ? undefined : keyFor(credential);
      for (const [id, job] of pending) if (key === undefined || id === key) {
        pending.delete(id); job.controller.abort();
      }
      if (key === undefined) cache.clear(); else cache.delete(key);
    },
  };
}
