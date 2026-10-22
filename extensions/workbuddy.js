import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import bridge from "../src/bridge-extension.js";
import { createWorkbuddyProvider, registerNativeCommands } from "../src/native-provider.js";
import { registerNativeLifecycle } from "../src/native-lifecycle.js";

export default async function workbuddy(pi) {
  const mode = process.env.WORKBUDDY_MODE || "native";
  if (mode === "bridge") return bridge(pi);
  if (mode !== "native") throw new Error("WORKBUDDY_MODE must be native or bridge.");
  if (process.env.WORKBUDDY_GZIP && !["0", "1"].includes(process.env.WORKBUDDY_GZIP)) {
    throw new Error("WORKBUDDY_GZIP must be 0 or 1.");
  }
  const provider = createWorkbuddyProvider({ api: openAICompletionsApi(), gzip: process.env.WORKBUDDY_GZIP !== "0" });
  pi.registerProvider(provider);
  registerNativeCommands(pi, provider);
  registerNativeLifecycle(pi, provider);
}
