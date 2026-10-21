import { discoverModels, literalApiKey, modelDefinitions, readConfig } from "./bridge.js";

/** WorkBuddy's OpenAI-compatible bridge; no desktop credential access. */
export default async function workbuddy(pi) {
  const config = readConfig();
  let ids = config.fallbackIds;
  let discoveryError;
  const register = () => pi.registerProvider("workbuddy-bridge", {
    baseUrl: config.baseUrl,
    api: "openai-completions",
    apiKey: literalApiKey(config.apiKey),
    models: modelDefinitions(ids, config),
  });
  try { ids = await discoverModels(config); }
  catch (error) { discoveryError = error.message; }
  register();

  pi.registerCommand("workbuddy", {
    description: "WorkBuddy bridge: status or refresh model catalog",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (!["status", "refresh"].includes(action)) {
        ctx.ui.notify("Usage: /workbuddy [status|refresh]", "warning");
        return;
      }
      try {
        const found = await discoverModels(config, ctx.signal);
        if (action === "refresh") {
          ids = found;
          register();
          discoveryError = undefined;
        }
        ctx.ui.notify(
          "WorkBuddy bridge reachable: " + found.length + " advertised models. " +
          (action === "refresh" ? "Catalog refreshed; select with /model." :
            ids.length + " registered. Use /workbuddy refresh to update.") +
          (discoveryError ? " Startup used fallback models." : ""),
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error.message + " Existing catalog retained.", "warning");
      }
    },
  });
}
