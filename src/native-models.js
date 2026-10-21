import { BASE_URL } from "./native-client.js";
import { WorkbuddyError } from "./native-errors.js";
const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const validInt = value => Number.isSafeInteger(value) && value > 0;
const validId = value => typeof value === "string" && value.length <= 256 && /^[\w./:-]+$/.test(value);

export function projectModels(config) {
  if (!Array.isArray(config?.models) || config.models.length > 2000) {
    throw new WorkbuddyError("catalog-shape", "Invalid WorkBuddy model catalog.");
  }
  const available = Array.isArray(config.availableModels) && config.availableModels.length ? new Set(config.availableModels) : undefined;
  const seen = new Set();
  const models = [];
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
    const contextWindow = [item.contextWindow?.defaultLength, item.maxAllowedSize, item.maxInputTokens].find(validInt) ?? 32768;
    const maxTokens = Math.min(validInt(item.maxOutputTokens) ? item.maxOutputTokens : 4096, contextWindow);
    const reasoning = item.supportsReasoning === true;
    const efforts = item.reasoning?.supportedEfforts?.filter?.(effort => LEVELS.includes(effort));
    const onlyReasoning = item.onlyReasoning === true || item.reasoning?.canDisableThinking === false;
    const thinkingLevelMap = reasoning ? {
      ...(onlyReasoning ? { off: null } : {}),
      ...(efforts?.length ? Object.fromEntries(LEVELS.map(level => [level, efforts.includes(level) ? level : null])) : {}),
    } : undefined;
    models.push({
      id: item.id, name: typeof item.name === "string" ? item.name.slice(0, 256) : item.id,
      provider: "workbuddy", api: "openai-completions", baseUrl: BASE_URL,
      reasoning, input: item.supportsImages === true && item.disabledMultimodal !== true ? ["text", "image"] : ["text"],
      cost: { ...COST }, contextWindow, maxTokens,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      samplingParams: {
        ...(Number.isFinite(item.temperature) ? { temperature: item.temperature } : {}),
        ...(Number.isFinite(item.top_p) ? { top_p: item.top_p } : {}),
      },
      // Observed in the shipped SDK: system role and max_tokens; never infer from model names.
      compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsStore: false, supportsReasoningEffort: reasoning },
    });
  }
  if (!models.length) throw new WorkbuddyError(config.models.length ? "catalog-filtered" : "catalog-empty",
    "WorkBuddy returned no supported tool-capable models. Existing catalog retained.", counts);
  return models;
}

export function fallbackModels() {
  return projectModels({ models: [{ id: "default-model", name: "WorkBuddy Default (fallback)", maxInputTokens: 32768, maxOutputTokens: 4096 }] });
}
