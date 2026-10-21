import { createNativeClient, accountHeaders, BASE_URL } from "./native-client.js";
import { fallbackModels, projectModels } from "./native-models.js";
import { createChatFetch } from "./native-transport.js";
import { describeFailure } from "./native-errors.js";
import { resolveOutputLimit, capPayloadOutput } from "./native-limits.js";

export function createWorkbuddyProvider({ api, client = createNativeClient(), fetch: fetchImpl, gzip = true } = {}) {
  if (!api?.stream || !api?.streamSimple) throw new Error("Pi OpenAI streaming API is required.");
  let models = fallbackModels();
  let catalogSource = "fallback";
  let lastCatalogError;
  function prepareRequest(model, options = {}) {
    let outputLimit = resolveOutputLimit(model, options.maxTokens);
    const modelSampling = model.samplingParams ? { ...model.samplingParams } : undefined;
    const requestSampling = options.samplingParams ? { ...options.samplingParams } : undefined;
    for (const params of [modelSampling, requestSampling]) {
      if (!params) continue;
      for (const key of ["max_tokens", "max_completion_tokens"]) {
        if (params[key] !== undefined) outputLimit = resolveOutputLimit({ ...model, maxTokens: outputLimit }, params[key]);
        delete params[key];
      }
    }
    return {
      model: { ...model, baseUrl: BASE_URL, samplingParams: modelSampling },
      options: {
        ...options, maxTokens: outputLimit, samplingParams: requestSampling,
        maxRetries: options.maxRetries ?? 0, timeoutMs: options.timeoutMs ?? 120000,
        fetch: createChatFetch({ fetch: options.fetch ?? fetchImpl, gzip, sessionId: options.sessionId }),
        async onPayload(payload, wireModel) {
          // Preserve Pi streamSimple's remaining-context clamp before invoking caller hooks.
          const bounded = capPayloadOutput(payload, outputLimit);
          const ceiling = bounded.max_tokens;
          const replacement = await options.onPayload?.(bounded, wireModel);
          return capPayloadOutput(replacement === undefined ? bounded : replacement, ceiling);
        },
      },
    };
  }
  return {
    id: "workbuddy", name: "WorkBuddy AI (experimental native)", baseUrl: BASE_URL,
    auth: {
      oauth: {
        name: "WorkBuddy AI", loginLabel: "Sign in with your WorkBuddy account", isSubscription: true,
        login: interaction => client.login(interaction),
        refresh: (credential, signal) => client.refresh(credential, signal),
        toAuth: async credential => ({
          apiKey: credential.access, headers: accountHeaders(credential), baseUrl: BASE_URL,
        }),
      },
    },
    getModels: () => models,
    getCatalogStatus: () => ({ source: catalogSource, lastError: lastCatalogError }),
    async refreshModels(context) {
      if (!context.allowNetwork || context.credential?.type !== "oauth") return;
      try {
        const next = projectModels(await client.catalog(context.credential, context.signal));
        // Generation-checked publication owned by Pi. No auth or remote instructions persisted.
        await context.publish({ update: () => {
          models = next; catalogSource = "remote"; lastCatalogError = undefined;
        } });
      } catch (error) {
        lastCatalogError = describeFailure(error);
        throw error;
      }
    },
    stream(model, context, options) {
      const request = prepareRequest(model, options);
      return api.stream(request.model, context, request.options);
    },
    streamSimple(model, context, options) {
      const request = prepareRequest(model, options);
      return api.streamSimple(request.model, context, request.options);
    },
  };
}

export function registerNativeCommands(pi, provider) {
  pi.registerCommand("workbuddy", {
    description: "Native WorkBuddy provider: status/doctor (local) or refresh model catalog",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "status" || action === "doctor") {
        const ready = ctx.modelRegistry.hasConfiguredAuth(provider.getModels()[0]);
        const catalog = provider.getCatalogStatus?.();
        const active = ctx.model ? ctx.model.provider + "/" + ctx.model.id : "unknown";
        ctx.ui.notify("WorkBuddy native (experimental): " + (ready ? "account configured" : "not logged in; use /login") +
          ". " + provider.getModels().length + " known models; catalog=" + (catalog?.source ?? "unknown") +
          ". Active model: " + active + "." + (catalog?.lastError ? " Last catalog failure: " + catalog.lastError : "") +
          " No chat request sent.", "info");
      } else if (action === "refresh") {
        try {
          if (!ctx.modelRegistry.hasConfiguredAuth(provider.getModels()[0])) {
            ctx.ui.notify("Sign in to WorkBuddy using /login first.", "warning"); return;
          }
          const result = await ctx.modelRegistry.refresh({ providers: ["workbuddy"], allowNetwork: true, force: true, signal: ctx.signal });
          if (result.aborted) {
            ctx.ui.notify("[cancelled] WorkBuddy catalog refresh cancelled. Existing catalog retained. No chat request sent.", "warning");
            return;
          }
          if (result.errors.has("workbuddy")) {
            ctx.ui.notify("WorkBuddy catalog refresh failed: " + describeFailure(result.errors.get("workbuddy")) +
              " Existing catalog retained. No chat request sent.", "warning");
            return;
          }
          ctx.ui.notify("WorkBuddy catalog refreshed: " + provider.getModels().length + " models. Select with /model.", "info");
        } catch (error) {
          ctx.ui.notify("WorkBuddy catalog refresh failed: " +
            (ctx.signal?.aborted ? "[cancelled] Operation cancelled." : describeFailure(error)) +
            " Existing catalog retained. No chat request sent.", "warning");
        }
      } else ctx.ui.notify("Usage: /workbuddy [status|doctor|refresh]. Sign in using /login.", "warning");
    },
  });
}
