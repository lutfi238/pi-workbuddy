import { BASE_URL } from "./native-client.js";
import { WorkbuddyError } from "./native-errors.js";
import { resolveTokenLimits } from "./native-limits.js";
import { getVendorCapabilities } from "./native-capabilities.js";
const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const validId = value => typeof value === "string" && value.length <= 256 && /^[\w./:-]+$/.test(value);

const billingByModel = new WeakMap();
export const getModelBilling = model => billingByModel.get(model);

export function setModelBilling(model, { multiplier, proOnly, freeUntil } = {}) {
  const hasMultiplier = typeof multiplier === "string" && /^\d{1,6}(?:\.\d{1,6})?$/.test(multiplier) && Number(multiplier) > 0;
  if (hasMultiplier || proOnly === true || freeUntil !== undefined) {
    billingByModel.set(model, Object.freeze({
      ...(hasMultiplier ? { multiplier } : {}),
      ...(proOnly === true ? { proOnly: true } : {}),
      ...(freeUntil !== undefined ? { freeUntil } : {}),
    }));
  }
}

const zonedDate = value => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

function billingRules(config, now) {
  const pro = new Set();
  for (const tier of Array.isArray(config.modelTiers) ? config.modelTiers : []) {
    if (tier?.enabled !== true || tier.accessMode !== "paywall" || tier.requiredUserType !== "standard" ||
        (tier.badge?.labelEn ?? tier.badge?.label) !== "Pro Only" || !Array.isArray(tier.modelIds)) continue;
    for (const id of tier.modelIds) pro.add(id);
  }
  const freeUntil = new Map();
  for (const promo of Array.isArray(config.modelPromotions) ? config.modelPromotions : []) {
    if (promo?.enabled !== true || promo.kind !== "discount" || promo.discount?.factor !== 0 ||
        !Array.isArray(promo.modelIds)) continue;
    const from = zonedDate(promo.schedule?.validFrom), until = zonedDate(promo.schedule?.validUntil);
    if (!(from <= now && now < until)) continue;
    for (const id of promo.modelIds) {
      // Use the earliest end when multiple zero-credit offers overlap.
      freeUntil.set(id, Math.min(until, freeUntil.get(id) ?? Infinity));
    }
  }
  return { pro, freeUntil };
}

export function projectModels(config, now = Date.now()) {
  if (!Array.isArray(config?.models) || config.models.length > 2000) {
    throw new WorkbuddyError("catalog-shape", "Invalid WorkBuddy model catalog.");
  }
  const available = Array.isArray(config.availableModels) && config.availableModels.length ? new Set(config.availableModels) : undefined;
  const seen = new Set();
  const models = [];
  const { pro, freeUntil } = billingRules(config, now);
  const counts = { total: config.models.length, accepted: 0, invalid: 0, duplicate: 0,
    disabled: 0, toolLess: 0, endpoint: 0, unavailable: 0 };
  for (const item of config.models) {
    // Report only counts, never model URLs, API keys, remote instructions, or full catalog bodies.
    if (!validId(item?.id)) { counts.invalid++; continue; }
    if (seen.has(item.id)) { counts.duplicate++; continue; }
    if (item.disabled === true) { counts.disabled++; continue; }
    if (item.supportsToolCall === false) { counts.toolLess++; continue; }
    if (item.url || item.apiKey || item.useCustomProtocol) { counts.endpoint++; continue; }
    if (available && !available.has(item.id)) { counts.unavailable++; continue; }
    seen.add(item.id);
    const vendor = getVendorCapabilities(item.id) ?? {};
    const { contextWindow, maxTokens } = resolveTokenLimits(item, vendor);
    const reasoning = item.supportsReasoning === true || vendor.reasoning === true;
    const catalogEfforts = Array.isArray(item.reasoning?.supportedEfforts) ? item.reasoning.supportedEfforts : [];
    const efforts = [...new Set([...catalogEfforts, ...(vendor.efforts ?? [])].filter(effort => LEVELS.includes(effort)))];
    const onlyReasoning = item.onlyReasoning === true || item.reasoning?.canDisableThinking === false || vendor.onlyReasoning === true;
    const thinkingLevelMap = reasoning ? {
      ...(onlyReasoning ? { off: null } : vendor.off ? { off: vendor.off } : {}),
      ...(efforts?.length ? Object.fromEntries(LEVELS.map(level => [level, efforts.includes(level) ? level : null])) : {}),
    } : undefined;
    const name = typeof item.name === "string" ? item.name.slice(0, 256) : item.id;
    const credits = typeof item.credits === "string" ? /^x(\d{1,6}(?:\.\d{1,6})?)(?: credits)?$/i.exec(item.credits.trim())?.[1] : undefined;
    const model = {
      id: item.id, name,
      provider: "workbuddy", api: "openai-completions", baseUrl: BASE_URL,
      // Prefer availability: retain gateway image support even when the vendor is text-only,
      // and expose vendor-advertised image support even if gateway metadata omits/disables it.
      reasoning, input: item.supportsImages === true || vendor.images === true ? ["text", "image"] : ["text"],
      cost: { ...COST }, contextWindow, maxTokens,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      samplingParams: {
        ...(Number.isFinite(item.temperature) ? { temperature: item.temperature } : {}),
        ...(Number.isFinite(item.top_p) ? { top_p: item.top_p } : {}),
      },
      // Observed in the shipped SDK: system role and max_tokens; never infer from model names.
      compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsStore: false,
        supportsReasoningEffort: reasoning && (vendor.supportsReasoningEffort !== false || catalogEfforts.length > 0),
        ...(vendor.thinkingFormat ? { thinkingFormat: vendor.thinkingFormat } : {}),
      },
    };
    setModelBilling(model, { multiplier: credits, proOnly: pro.has(item.id), freeUntil: freeUntil.get(item.id) });
    models.push(model);
  }
  if (!models.length) throw new WorkbuddyError(config.models.length ? "catalog-filtered" : "catalog-empty",
    "WorkBuddy returned no supported tool-capable models. Existing catalog retained.", counts);
  return models;
}

export function fallbackModels() {
  return projectModels({ models: [{ id: "default-model", name: "WorkBuddy Default (fallback)", maxInputTokens: 32768, maxOutputTokens: 4096 }] });
}
