import { describeFailure } from "./native-errors.js";

function definition(model) {
  return JSON.stringify([model?.provider, model?.id, model?.name, model?.contextWindow,
    model?.maxTokens, model?.reasoning, model?.input, model?.thinkingLevelMap]);
}

export async function recoverSelectedModel(pi, provider, ctx, selected = ctx.model) {
  // Never switch away from another provider, race a user selection, or alter a running turn.
  if (!selected || selected.provider !== "workbuddy" || ctx.model !== selected || ctx.isIdle?.() === false) return;
  let previousId = selected.id;
  const placeholder = selected.name === "WorkBuddy Default (fallback)";
  if (placeholder) {
    // On resume Pi can replace a missing selection before session_start; the latest
    // model-change record still identifies it. Never scan past a newer valid choice.
    const previous = ctx.sessionManager?.getBranch?.().findLast(entry => entry.type === "model_change");
    if (previous?.provider === "workbuddy" && typeof previous.modelId === "string") previousId = previous.modelId;
  }
  const id = /^deepseek-/i.test(previousId) && /-sg$/i.test(previousId) ? previousId.slice(0, -3) : previousId;
  const replacement = provider.getModels().find(model => model.id === id) ??
    (placeholder ? provider.getModels().find(model => model.id === selected.id) : undefined);
  if (!replacement || definition(selected) === definition(replacement)) return;
  if (await pi.setModel(replacement) === false) {
    ctx.ui?.notify?.("WorkBuddy catalog is ready; select an available model with /model.", "warning");
  } else if (id !== selected.id && replacement.id === id) {
    ctx.ui?.notify?.("WorkBuddy restored the available model " + replacement.id + ". No chat request sent.", "info");
  }
}

/** Embedded hosts can re-register providers without refreshing an already-seen provider ID. */
export function registerNativeLifecycle(pi, provider) {
  pi.on("session_start", async (_event, ctx) => {
    const selected = ctx.model;
    try {
      if (!ctx.modelRegistry.hasConfiguredAuth(provider.getModels()[0])) return;
      const result = await ctx.modelRegistry.refresh({
        providers: ["workbuddy"], force: true, signal: ctx.signal,
        // Honor PI_OFFLINE; otherwise inherit the registry's default network policy.
        ...(process.env.PI_OFFLINE !== undefined ? { allowNetwork: false } : {}),
      });
      if (result.aborted) return;
      if (result.errors.has("workbuddy")) {
        ctx.ui?.notify?.("WorkBuddy catalog refresh failed: " + describeFailure(result.errors.get("workbuddy")) +
          " Cached models, if available, were retained. No chat request sent.", "warning");
      }
      await recoverSelectedModel(pi, provider, ctx, selected);
    } catch (error) {
      ctx.ui?.notify?.("WorkBuddy startup recovery failed: " + describeFailure(error) +
        " Use /workbuddy refresh to retry. No chat request sent.", "warning");
    }
  });
}
