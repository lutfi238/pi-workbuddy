export function readConfig(env = process.env) {
  const url = new URL(env.WORKBUDDY_BASE_URL || "http://127.0.0.1:8787/v1");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("WORKBUDDY_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  const positiveInt = (name, fallback) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + " must be a positive integer.");
    return value;
  };
  const contextWindow = positiveInt("WORKBUDDY_CONTEXT_WINDOW", 32768);
  const maxTokens = positiveInt("WORKBUDDY_MAX_TOKENS", 4096);
  if (maxTokens > contextWindow) throw new Error("WORKBUDDY_MAX_TOKENS must not exceed WORKBUDDY_CONTEXT_WINDOW.");
  const fallbackIds = [...new Set((env.WORKBUDDY_MODELS || "auto").split(",").map(s => s.trim()).filter(Boolean))];
  if (!fallbackIds.length) throw new Error("WORKBUDDY_MODELS must contain at least one model ID.");
  return {
    baseUrl: url.href.replace(/\/+$/, ""),
    apiKey: env.WORKBUDDY_API_KEY || "workbuddy-local",
    timeoutMs: positiveInt("WORKBUDDY_TIMEOUT_MS", 3000),
    fallbackIds, contextWindow, maxTokens,
  };
}

// ProviderConfig interprets $, ! prefixes. Escape literal bridge credentials.
export function literalApiKey(key) {
  const escaped = key.replaceAll("$", () => "$$");
  return escaped.startsWith("!") ? "$!" + escaped.slice(1) : escaped;
}

export function modelDefinitions(ids, config) {
  return ids.map(id => ({
    id, name: "WorkBuddy · " + id,
    reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow, maxTokens: config.maxTokens,
  }));
}

export async function discoverModels(config, signal) {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  let response;
  try {
    response = await fetch(config.baseUrl + "/models", {
      headers: { Authorization: "Bearer " + config.apiKey },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
    });
  } catch {
    throw new Error("Bridge unreachable or request cancelled/timed out. Check its process, URL, and timeout.");
  }
  if (!response.ok) {
    // Never echo upstream bodies: they can contain tokens or account details.
    await response.body?.cancel();
    throw new Error("Bridge model discovery failed (HTTP " + response.status + ").");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new Error("Bridge returned invalid JSON."); }
  if (!Array.isArray(body?.data)) throw new Error("Bridge must return an OpenAI model list: { data: [{ id }] }.");
  const ids = [...new Set(body.data.map(item => item?.id).filter(id => typeof id === "string" && id.trim()))];
  if (!ids.length) throw new Error("Bridge returned no usable model IDs.");
  return ids;
}
