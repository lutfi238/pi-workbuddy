import { createCreditsReader } from "./native-credits.js";
import { ORIGIN } from "./native-client.js";
import { createTooltipAdapter, TOOLTIP_STATUS_KEY } from "./pendant-tooltip.js";

/** Opt-in status transport for the optional Pendant adapter, not a native Pi usage hook. */
export function registerPendantTooltip(pi, { reader = createCreditsReader(), enabled = false } = {}) {
  const wire = createTooltipAdapter();
  let active = enabled, generation = 0, pending, lastContext, published = false;
  let payloadState = enabled ? "waiting" : "disabled";
  const clear = ctx => {
    try { if (published) ctx?.ui?.setStatus?.(TOOLTIP_STATUS_KEY, undefined); } catch { /* Unsupported UI must not break a turn. */ }
    published = false;
  };
  const session = ctx => ctx.sessionManager?.getSessionId?.();
  function stop(ctx) {
    generation++;
    pending?.controller.abort(); pending = undefined;
    reader.clear(); clear(ctx ?? lastContext);
    payloadState = active ? "waiting" : "disabled";
  }
  async function refresh(ctx, force = false) {
    lastContext = ctx;
    if (!active || ctx.mode !== "rpc" || ctx.model?.provider !== "workbuddy") { stop(ctx); return; }
    const sessionId = session(ctx);
    if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) { stop(ctx); return; }
    const identity = sessionId + "/" + ctx.model.id;
    if (pending?.identity === identity && !force) return pending.promise;
    generation++;
    pending?.controller.abort();
    const ticket = generation, controller = new AbortController();
    const job = { identity, controller };
    pending = job;
    const current = () => active && generation === ticket && !controller.signal.aborted && session(ctx) === sessionId && ctx.model?.provider === "workbuddy";
    const publish = (state, data = {}) => {
      if (current()) {
        try {
          ctx.ui.setStatus(TOOLTIP_STATUS_KEY, wire.encode({ ...data, v: 1, provider: "workbuddy", sessionId, state }));
          published = true; payloadState = state;
        } catch { active = false; stop(ctx); }
      }
    };
    job.promise = Promise.resolve().then(async () => {
      publish("loading"); // Remove old balances while the current auth scope is being resolved.
      if (!current()) { if (pending === job) pending = undefined; return; }
      try {
        const model = ctx.model;
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!current()) return;
        if (!auth?.ok) throw new Error("Account unavailable");
        if (auth.baseUrl && new URL(auth.baseUrl).origin !== ORIGIN) throw new Error("Untrusted account origin");
        const headers = new Headers(auth.headers);
        const access = auth.apiKey || headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
        const credential = { type: "oauth", origin: ORIGIN, access, userId: headers.get("X-User-Id"),
          domain: headers.get("X-Domain") || "www.workbuddy.ai",
          ...(headers.get("X-Enterprise-Id") ? { enterpriseId: headers.get("X-Enterprise-Id") } : {}),
        };
        const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
        const data = await reader.read(credential, { force, signal, allowNetwork: process.env.PI_OFFLINE === undefined });
        publish("ready", data);
      } catch {
        if (current()) { reader.clear(); publish("unavailable"); }
      } finally {
        if (pending === job) pending = undefined;
      }
    });
    return job.promise;
  }
  pi.registerCommand("workbuddy-tooltip", {
    description: "Experimental Pendant tooltip relay: on/off/refresh/status (requires the optional host adapter)",
    async handler(args, ctx) {
      const action = args.trim() || "status";
      if (action === "off") { active = false; stop(ctx); ctx.ui.notify("WorkBuddy tooltip relay disabled.", "info"); return; }
      if (action === "status") {
        ctx.ui.notify("WorkBuddy tooltip relay: " + (active ? "enabled" : "disabled") + "; payload=" + payloadState +
          ". Requires the optional Pendant adapter v2 (renderer + broker). No chat request sent.", "info"); return;
      }
      if (!["on", "refresh"].includes(action)) { ctx.ui.notify("Usage: /workbuddy-tooltip [on|off|refresh|status]", "warning"); return; }
      if (ctx.mode !== "rpc") { ctx.ui.notify("The experimental tooltip relay is for Pendant/RPC, not the CLI footer.", "warning"); return; }
      if (action === "on") {
        active = true;
        ctx.ui.notify("Experimental WorkBuddy tooltip relay enabled. The separate Pendant adapter must already be installed; this command does not patch the host.", "info");
      }
      if (!active) { ctx.ui.notify("Enable the optional relay with /workbuddy-tooltip on first.", "warning"); return; }
      await refresh(ctx, action === "refresh");
    },
  });
  for (const event of ["session_start", "model_select", "agent_end"]) pi.on(event, async (_event, ctx) => { await refresh(ctx); });
  pi.on("session_shutdown", async (_event, ctx) => { active = false; stop(ctx); });
  return { refresh, dispose() { active = false; stop(lastContext); } };
}
