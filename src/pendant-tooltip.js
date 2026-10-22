export const TOOLTIP_STATUS_KEY = "workbuddy.credits.v1";

/** Self-contained so the optional host adapter can embed exactly the same validator/renderer. */
export function createTooltipAdapter(statusKey = "workbuddy.credits.v1") {
  const number = value => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 128) : "";
  const instant = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
  const wallClock = value => value === null || typeof value === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value.replace(" ", "T") + "Z")) && new Date(value.replace(" ", "T") + "Z").toISOString().slice(0, 19) === value.replace(" ", "T");
  const tone = (remaining, total, stale) => {
    if (stale || remaining === null) return undefined;
    if (remaining === 0) return "danger";
    if (total > 0 && remaining <= total) {
      const percent = remaining / total * 100;
      return percent < 15 ? "danger" : percent < 50 ? "warning" : "good";
    }
  };
  function validate(input, maxItems = 4) {
    if (!input || input.v !== 1 || input.provider !== "workbuddy" || typeof input.sessionId !== "string" || !/^[\w-]{1,128}$/.test(input.sessionId) ||
      !["loading", "ready", "unavailable"].includes(input.state)) return undefined;
    const packet = { v: 1, provider: "workbuddy", sessionId: input.sessionId, state: input.state };
    if (input.state !== "ready") return packet;
    if (![input.creditsTotal, input.creditsRemaining, input.creditsUsed].every(number) ||
      !Number.isSafeInteger(input.packageCount) || input.packageCount < 0 || input.packageCount > 2000 ||
      !Number.isSafeInteger(input.fetchedAt) || input.fetchedAt < 0 || input.fetchedAt > 8640000000000000 ||
      !["cache", "remote"].includes(input.source) || typeof input.stale !== "boolean") return undefined;
    Object.assign(packet, { creditsTotal: input.creditsTotal, creditsRemaining: input.creditsRemaining,
      creditsUsed: input.creditsUsed, packageCount: input.packageCount, fetchedAt: input.fetchedAt,
      source: input.source, stale: input.stale });
    if (input.packageDetails !== undefined) {
      const details = input.packageDetails;
      if (!details || !["complete", "partial", "unavailable"].includes(details.state) ||
        !Number.isSafeInteger(details.count) || details.count < 0 || details.count > 2000 || !Array.isArray(details.items) ||
        details.items.length > maxItems || details.items.length > details.count ||
        details.state === "unavailable" && (details.count !== 0 || details.items.length !== 0)) return undefined;
      const items = [];
      for (const item of details.items) {
        if (!item || !["base", "bonus", "topup", "daily", "other"].includes(item.kind) ||
          ![item.total, item.remaining, item.used].every(number) || !instant(item.expiresAt) || !wallClock(item.expiresText) ||
          item.expiresAt !== null && item.expiresText !== null) return undefined;
        items.push({ kind: item.kind, total: item.total, remaining: item.remaining, used: item.used,
          expiresAt: item.expiresAt, expiresText: item.expiresText });
      }
      packet.packageDetails = { state: details.state, count: details.count, items };
    }
    const name = text(input.planName);
    if (name) packet.planName = name;
    return packet;
  }
  return {
    encode(input) {
      const packet = validate(input, 2000);
      if (!packet) throw new Error("Invalid WorkBuddy tooltip payload.");
      if (packet.packageDetails) {
        const priority = item => item.kind === "base" ? 0 : item.kind === "daily" ? 1 : 2;
        packet.packageDetails.items.sort((a, b) => priority(a) - priority(b) || (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
        packet.packageDetails.items = packet.packageDetails.items.slice(0, 4);
      }
      return JSON.stringify(packet);
    },
    append(base, entries, context, now = Date.now()) {
      if (base?.kind !== "grid" || !Array.isArray(base.rows) || context?.provider !== "workbuddy" ||
        context.modelAvailable !== true || !context.sessionId || !Array.isArray(entries)) return base;
      const candidates = entries.filter(entry => entry?.key === statusKey);
      if (candidates.length !== 1 || typeof candidates[0].text !== "string" || candidates[0].text.length > 4096) return base;
      let packet;
      try { packet = validate(JSON.parse(candidates[0].text)); } catch { return base; }
      if (!packet || packet.sessionId !== context.sessionId) return base;
      const rows = [];
      if (packet.state !== "ready") rows.push({ label: "WorkBuddy credits", value: packet.state === "loading" ? "Loading…" : "Unavailable",
        ...(packet.state === "unavailable" ? { valueTone: "warning" } : {}) });
      else {
        const format = value => value === null ? "Unknown" : value.toLocaleString(undefined, { maximumFractionDigits: 6 });
        const stale = packet.stale || !Number.isFinite(now) || now < packet.fetchedAt || now - packet.fetchedAt >= 60000;
        const remainingTone = tone(packet.creditsRemaining, packet.creditsTotal, stale);
        if (packet.planName) rows.push({ label: "Plan", value: packet.planName });
        rows.push({ label: "Credits remaining", value: format(packet.creditsRemaining), ...(remainingTone ? { valueTone: remainingTone } : {}) });
        const details = packet.packageDetails;
        if (details?.items.length) {
          const counts = {}, names = { base: "Base credits", daily: "Daily credits", bonus: "Bonus", topup: "Top-up", other: "Credit pack" };
          for (const item of details.items) {
            counts[item.kind] = (counts[item.kind] ?? 0) + 1;
            const indexed = !["base", "daily"].includes(item.kind) || details.items.filter(other => other.kind === item.kind).length > 1;
            const valueTone = tone(item.remaining, item.total, stale);
            rows.push({ label: names[item.kind] + (indexed ? " " + counts[item.kind] : ""),
              value: format(item.remaining) + " / " + format(item.total) + " left", ...(valueTone ? { valueTone } : {}) });
            rows.push({ label: item.expiresText ? "Expires (server time)" : "Expires", value: item.expiresAt !== null ?
              new Date(item.expiresAt).toLocaleString() : item.expiresText ?? "Unknown" });
          }
          if (details.count > details.items.length) rows.push({ label: "More packages", value: String(details.count - details.items.length) + " not shown" });
        } else {
          rows.push({ label: "Credits used / total", value: format(packet.creditsUsed) + " / " + format(packet.creditsTotal) });
          rows.push({ label: "Credit groups", value: String(packet.packageCount) });
        }
        if (details && details.state !== "complete") rows.push({ label: "Package details",
          value: details.state === "partial" ? "Partial" : "Unavailable", valueTone: "warning" });
        rows.push({ label: "Updated", value: new Date(packet.fetchedAt).toLocaleString() });
        if (stale) {
          rows.push({ label: "Credit data", value: "Cached / stale", valueTone: "warning" });
        }
      }
      return { ...base, rows: [...base.rows, ...rows] };
    },
  };
}
