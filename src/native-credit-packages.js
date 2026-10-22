import { WorkbuddyError } from "./native-errors.js";

const MAX_PACKAGES = 2000, PAGE_SIZE = 200, MAX_PAGES = 10;
// Public product codes reviewed in WorkBuddy 5.8.4; unknown summary codes are queried on both read routes.
const products = {
  TCACA_code_001_PqouKr6QWV: ["free", "daily"],
  TCACA_code_002_AkiJS3ZHF5: ["paid", "base"],
  TCACA_code_005_maRGyrHhw1: ["paid", "base"],
  TCACA_code_003_FAnt7lcmRT: ["paid", "base"],
  TCACA_code_006_DbXS0lrypC: ["free", "bonus"],
  TCACA_code_007_nzdH5h4Nl0: ["free", "bonus"],
  TCACA_code_008_cfWoLwvjU4: ["free", "base"],
  TCACA_code_009_0XmEQc2xOf: ["paid", "topup"],
  TCACA_code_023_4xbGhMrE6q: ["paid", "base"],
  TCACA_code_026_BaESVICNoi: ["paid", "base"],
  TCACA_code_027_0FCGVA6vSa: ["paid", "base"],
  TCACA_code_028_NtpWi0jzXs: ["free", "bonus"],
  TCACA_code_029_6wCGEWquYy: ["free", "bonus"],
  TCACA_code_030_BjSt89qTvr: ["free", "bonus"],
  TCACA_code_035_ArVxJcGDsm: ["free", "base"],
  TCACA_code_036_lupO5WgNdG: ["paid", "topup"],
  TCACA_code_037_WxOD3MpI2o: ["free", "bonus"],
  TCACA_code_038_OhvqZtiPKr: ["paid", "topup"],
  TCACA_code_039_KRcQj7wUat: ["free", "base"],
  TCACA_code_040_mi9rCYg46x: ["free", "base"],
};
const codeOf = value => typeof value === "string" && /^[\w-]{1,128}$/.test(value) ? value : undefined;
const cancelled = () => new WorkbuddyError("cancelled", "WorkBuddy credit read cancelled.");

/** Bounded, read-only detail discovery. Never claims rewards or changes renewal/purchases. */
export async function readCreditPackages({ summary, fetchPage, signal }) {
  if (!Array.isArray(summary?.Packages) || summary.Packages.length > MAX_PACKAGES ||
    summary.Packages.some(item => !item || typeof item !== "object" || Array.isArray(item))) return { accounts: [], state: "unavailable" };
  const codes = [...new Set((summary?.Packages ?? []).map(item => codeOf(item?.PackageCode)).filter(Boolean))];
  if (!codes.length) return { accounts: [], state: summary?.Packages?.length === 0 ? "complete" : "unavailable" };
  const missingCode = summary.Packages.some(item => !codeOf(item?.PackageCode));
  const groups = await Promise.allSettled(["paid", "free"].map(async group => {
    const selected = codes.filter(code => !Object.hasOwn(products, code) || products[code][0] === group);
    if (!selected.length) return { accounts: [], complete: true };
    const accounts = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (signal?.aborted) throw cancelled();
      let data;
      try {
        data = await fetchPage(group, { PageNumber: page, PageSize: PAGE_SIZE, PackageCodes: selected,
          Status: [0, 3], OnlyValidPeriod: true, IsDisplayTotalInfo: true });
      } catch {
        if (signal?.aborted) throw cancelled();
        return { accounts, complete: false };
      }
      if (!Array.isArray(data?.Accounts) || data.Accounts.length > PAGE_SIZE ||
        !Number.isSafeInteger(data.TotalCount) || data.TotalCount < 0 ||
        data.Accounts.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        return { accounts, complete: false };
      }
      // Some servers return unrelated products; never project them as matching this summary.
      const matching = data.Accounts.filter(item => selected.includes(item.PackageCode));
      accounts.push(...matching);
      if (matching.length !== data.Accounts.length) return { accounts, complete: false };
      if (accounts.length >= data.TotalCount) return { accounts, complete: accounts.length === data.TotalCount };
      if (!data.Accounts.length) return { accounts, complete: false };
    }
    return { accounts, complete: false };
  }));
  if (signal?.aborted) throw cancelled();
  const accounts = [], seen = new Set(); let complete = !missingCode;
  for (const result of groups) {
    if (result.status !== "fulfilled") { complete = false; continue; }
    complete &&= result.value.complete;
    for (const item of result.value.accounts) {
      const id = typeof item.ResourceId === "string" && item.ResourceId || Number.isSafeInteger(item.ResourceId) && String(item.ResourceId);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (accounts.length < MAX_PACKAGES) accounts.push(item); else complete = false;
    }
  }
  const returnedCodes = new Set(accounts.map(item => item.PackageCode));
  if (codes.some(code => !returnedCodes.has(code))) complete = false;
  return { accounts, state: complete ? "complete" : accounts.length ? "partial" : "unavailable" };
}

function capacity(value) {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
}
function date(value) {
  // The verified numeric field is Unix milliseconds; do not guess seconds or a timezone for wall-clock strings.
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && wallClock(value.slice(0, 19))) value = Date.parse(value);
  return Number.isSafeInteger(value) && value >= Date.UTC(2000, 0, 1) && value <= 8640000000000000 ? value : null;
}
function wallClock(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(value)) return null;
  const normalized = value.replace(" ", "T"), stamp = Date.parse(normalized + "Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 19) === normalized ? normalized.replace("T", " ") : null;
}

/** Whitelist only display metrics and expiry. No account/resource/order IDs or upstream names leave this module. */
export function normalizeCreditPackages(details, summary) {
  if (!details || !["complete", "partial"].includes(details.state) || !Array.isArray(details.accounts) || details.accounts.length > MAX_PACKAGES ||
    details.accounts.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    return Object.freeze({ state: "unavailable", count: 0, items: Object.freeze([]) });
  }
  const items = details.accounts.map(item => {
    const code = codeOf(item.PackageCode), kind = code && code === summary.SubscriptionPackageCode ? "base" :
      code && Object.hasOwn(products, code) ? products[code][1] : "other";
    const slice = Number(item.CapacityType) === 4 ? item.SlicePeriodUsageDetails?.[0] : undefined;
    const total = capacity(slice ? slice.SlicePeriodCapacitySizePrecise : item.CycleCapacitySizePrecise);
    const remaining = capacity(slice ? slice.SlicePeriodCapacityRemainPrecise : item.CycleCapacityRemainPrecise);
    const used = total !== null && remaining !== null && total >= remaining ? total - remaining : null;
    const candidates = kind === "daily" ? [item.CycleEndTime] : [item.DeductionEndTime, item.ExpiredTime];
    const expiresAt = candidates.map(date).find(value => value !== null) ?? null;
    const expiresText = expiresAt === null ? candidates.map(wallClock).find(Boolean) ?? null : null;
    return Object.freeze({ kind, total, remaining, used, expiresAt, expiresText });
  });
  return Object.freeze({ state: details.state, count: items.length, items: Object.freeze(items) });
}
