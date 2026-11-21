import { createCreditsReader } from "./native-credits.js";
import { ORIGIN } from "./native-client.js";
import { createTooltipAdapter, TOOLTIP_STATUS_KEY } from "./pendant-tooltip.js";

export const CREDIT_STATUS_KEY = "workbuddy.balance";
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** Publish a plain footer balance and optionally send detail to the Pendant tooltip adapter. */
export function registerPendantTooltip(pi, { reader, enabled = false, showBalance = false } = {}) {
  const summaryReader = reader ?? createCreditsReader({ includePackageDetails: false });
  const detailReader = reader ?? createCreditsReader();
  const wire = createTooltipAdapter();
  let active = enabled, balanceEnabled = showBalance, closed = false, generation = 0, pending, lastContext;
  const published = new Set();
  let payloadState = enabled ? "waiting" : "disabled";
  const clear = (ctx, key) => {
    if (!published.delete(key)) return;
    try { ctx?.ui?.setStatus?.(key, undefined); } catch { /* Unsupported UI must not break a turn. */ }
  };
  const relay = ctx => active && ctx.mode === "rpc";
  const balance = ctx => balanceEnabled && (ctx.mode === "tui" || ctx.mode === "rpc");
  const session = ctx => ctx.sessionManager?.getSessionId?.();
  function stop(ctx) {
    generation++;
    pending?.controller.abort(); pending = undefined;
    summaryReader.clear();
    if (detailReader !== summaryReader) detailReader.clear();
    clear(ctx ?? lastContext, CREDIT_STATUS_KEY);
    clear(ctx ?? lastContext, TOOLTIP_STATUS_KEY);
    payloadState = active ? "waiting" : "disabled";
  }
  async function refresh(ctx, force = false) {
    lastContext = ctx;
    if (closed || !(relay(ctx) || balance(ctx)) || ctx.model?.provider !== "workbuddy") { stop(ctx); return; }
    const sessionId = session(ctx);
    if (typeof sessionId !== "string" || !/^[\w-]{1,128}$/.test(sessionId)) { stop(ctx); return; }
    const modelId = ctx.model.id;
    const identity = sessionId + "/" + modelId;
    if (pending?.identity === identity && !force) return pending.promise;
    generation++;
    pending?.controller.abort();
    const ticket = generation, controller = new AbortController();
    const job = { identity, controller };
    pending = job;
    const current = () => !closed && (relay(ctx) || balance(ctx)) && generation === ticket && !controller.signal.aborted &&
      session(ctx) === sessionId && ctx.model?.provider === "workbuddy" && ctx.model.id === modelId;
    const publish = (state, data = {}) => {
      if (!current()) return;
      if (balance(ctx)) {
        try {
          const remaining = data.creditsRemaining;
          const label = state === "loading" ? "loading…" : Number.isFinite(remaining) && remaining >= 0
            ? amount.format(remaining) + (data.stale ? " left (stale)" : " left") : "unavailable";
          ctx.ui.setStatus(CREDIT_STATUS_KEY, "WorkBuddy credits: " + label);
          published.add(CREDIT_STATUS_KEY);
        } catch { balanceEnabled = false; clear(ctx, CREDIT_STATUS_KEY); }
      }
      if (relay(ctx)) {
        try {
          ctx.ui.setStatus(TOOLTIP_STATUS_KEY, wire.encode({ ...data, v: 1, provider: "workbuddy", sessionId, state }));
          published.add(TOOLTIP_STATUS_KEY); payloadState = state;
        } catch { active = false; clear(ctx, TOOLTIP_STATUS_KEY); payloadState = "disabled"; }
      }
    };
    job.promise = Promise.resolve().then(async () => {
      if (balance(ctx) && process.env.PI_OFFLINE !== undefined) {
        // The host's auth resolver can refresh an expired token, so skip it offline.
        publish("unavailable");
        if (pending === job) pending = undefined;
        return;
      }
      publish("loading"); // Remove old balances while the current auth scope is being resolved.
      if (!current()) { if (pending === job) pending = undefined; return; }
      const creditReader = relay(ctx) ? detailReader : summaryReader;
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
        const data = await creditReader.read(credential, { force, signal, allowNetwork: process.env.PI_OFFLINE === undefined });
        publish("ready", data);
      } catch {
        if (current()) { creditReader.clear(); publish("unavailable"); }
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
      if (action === "off") {
        active = false; stop(ctx); ctx.ui.notify("WorkBuddy tooltip relay disabled.", "info");
        if (balance(ctx)) await refresh(ctx);
        return;
      }
      if (action === "status") {
        ctx.ui.notify("WorkBuddy tooltip relay: " + (active ? "enabled" : "disabled") + "; payload=" + payloadState +
          ". Requires the optional Pendant adapter v2 (renderer + broker). No chat request sent.", "info"); return;
      }
      if (!["on", "refresh"].includes(action)) { ctx.ui.notify("Usage: /workbuddy-tooltip [on|off|refresh|status]", "warning"); return; }
      if (ctx.mode !== "rpc") { ctx.ui.notify("The experimental tooltip relay is for Pendant/RPC, not the CLI footer.", "warning"); return; }
      if (action === "on") {
        if (!active) stop(ctx);
        active = true;
        ctx.ui.notify("Experimental WorkBuddy tooltip relay enabled. The separate Pendant adapter must already be installed; this command does not patch the host.", "info");
      }
      if (!active) { ctx.ui.notify("Enable the optional relay with /workbuddy-tooltip on first.", "warning"); return; }
      await refresh(ctx, action === "refresh");
    },
  });
  function updateStatus(ctx, force = false) {
    const result = refresh(ctx, force);
    if (!showBalance) return result;
    // The footer fetch should not hold up session startup or the next turn.
    void result.catch(() => {});
  }
  pi.on("session_start", (_event, ctx) => {
    if (closed) { closed = false; active = enabled; balanceEnabled = showBalance; }
    return updateStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("agent_end", (_event, ctx) => updateStatus(ctx, balance(ctx)));
  pi.on("session_shutdown", async (_event, ctx) => { closed = true; active = false; stop(ctx); });
  return { refresh, dispose() { closed = true; active = false; stop(lastContext); } };
}
