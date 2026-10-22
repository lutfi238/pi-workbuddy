import assert from "node:assert/strict";
import { test } from "node:test";
import { registerPendantTooltip } from "../src/native-tooltip-controller.js";
import { TOOLTIP_STATUS_KEY } from "../src/pendant-tooltip.js";

const snapshot = () => ({ creditsTotal: 125, creditsRemaining: 90, creditsUsed: 35, packageCount: 2, fetchedAt: 1000, source: "remote", stale: false });
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ enabled = false } = {}) {
  const handlers = new Map(), statuses = [], notices = [], reads = []; let command, authCalls = 0;
  let read = async () => snapshot();
  const reader = { read(...args) { reads.push(args); return read(...args); }, clear() {} };
  const ctx = { mode: "rpc", model: { provider: "workbuddy", id: "deepseek-v4.1-flash" },
    sessionManager: { getSessionId: () => "session-1" },
    ui: { setStatus: (key,text) => { assert.equal(key,TOOLTIP_STATUS_KEY); statuses.push(text === undefined ? undefined : JSON.parse(text)); }, notify: text => notices.push(text) },
    modelRegistry: { async getApiKeyAndHeaders(model) { authCalls++; assert.equal(model.provider,"workbuddy"); return { ok: true, apiKey:"SYNTHETIC_ACCESS", baseUrl:"https://www.workbuddy.ai/v2", headers:{"X-User-Id":"mock-user","X-Domain":"www.workbuddy.ai"} }; } },
  };
  const pi = { on(name,fn) { handlers.set(name,fn); }, registerCommand(name,config) { assert.equal(name,"workbuddy-tooltip"); command = config.handler; } };
  const controller = registerPendantTooltip(pi,{reader,enabled});
  return { ctx, controller, statuses, notices, reads, set read(fn) {read=fn;}, get authCalls(){return authCalls;},
    event: name => handlers.get(name)({},ctx), command: action => command(action,ctx) };
}

test("tooltip relay is silent and does no auth/network work until explicitly enabled", async () => {
  const s=setup(); await s.event("session_start"); await s.event("agent_end");
  assert.equal(s.reads.length,0); assert.equal(s.authCalls,0); assert.deepEqual(s.statuses,[]);
  await s.command("on"); assert.equal(s.reads.length,1); assert.equal(s.statuses.at(-1).state,"ready");
  assert.doesNotMatch(JSON.stringify(s.statuses),/SYNTHETIC|mock-user|Authorization/);
});

test("relay uses Pi's resolved account headers without reading auth.json or inventing identity", async () => {
  const s=setup({enabled:true}); await s.event("session_start");
  const [credential,options]=s.reads[0];
  assert.equal(credential.userId,"mock-user"); assert.equal(credential.access,"SYNTHETIC_ACCESS");
  assert.equal(credential.origin,"https://www.workbuddy.ai"); assert.equal(credential.refresh,undefined);
  assert.equal(options.force,false); assert.ok(options.signal); assert.equal(s.statuses.at(-1).sessionId,"session-1");
  await s.command("refresh"); assert.equal(s.reads.at(-1)[1].force,true);
});

test("RPC-only opt-in does not dump encoded status in the normal CLI footer", async () => {
  const s=setup(); s.ctx.mode="tui"; await s.command("on");
  assert.equal(s.reads.length,0); assert.deepEqual(s.statuses,[]); assert.match(s.notices[0],/RPC/);
});

test("switching provider or disposing cancels pending work and cannot republish old data", async () => {
  const s=setup({enabled:true}); let release;
  s.read=()=>new Promise(resolve=>{release=resolve;});
  const pending=s.event("session_start"); await tick();
  const signal=s.reads[0][1].signal;
  s.ctx.model={provider:"other",id:"selected"}; await s.event("model_select");
  assert.equal(signal.aborted,true); assert.equal(s.statuses.at(-1),undefined);
  release(snapshot()); await pending; assert.equal(s.statuses.at(-1),undefined);
  s.controller.dispose();
});

test("late auth completions cannot publish into another session", async () => {
  const s=setup({enabled:true}); let release;
  s.ctx.modelRegistry.getApiKeyAndHeaders=()=>new Promise(resolve=>{release=resolve;});
  const pending=s.event("session_start"); await tick();
  s.ctx.sessionManager.getSessionId=()=>"other-session";
  release({ok:true,apiKey:"PRIVATE",headers:{"X-User-Id":"PRIVATE"}}); await pending;
  assert.equal(s.reads.length,0); assert.equal(s.statuses.some(p=>p?.state==="ready"),false);
});

test("auth failures and malformed/foreign auth are unavailable, without exposing raw errors", async () => {
  for(const auth of [{ok:false,error:"PRIVATE"},{ok:true,baseUrl:"https://evil.example",apiKey:"PRIVATE"}]) {
    const s=setup({enabled:true}); s.ctx.modelRegistry.getApiKeyAndHeaders=async()=>auth;
    await s.event("session_start"); assert.equal(s.statuses.at(-1).state,"unavailable");
    assert.equal(s.reads.length,0); assert.doesNotMatch(JSON.stringify(s.statuses),/PRIVATE|evil/);
  }
  const s=setup({enabled:true}); s.read=async()=>{throw new Error("PRIVATE");};
  await s.event("session_start"); assert.equal(s.statuses.at(-1).state,"unavailable");
  assert.doesNotMatch(JSON.stringify(s.statuses),/PRIVATE/);
});

test("offline policy reaches the reader and shutdown disables further reads", async () => {
  const s=setup({enabled:true}), original=process.env.PI_OFFLINE; process.env.PI_OFFLINE="1";
  try { await s.event("session_start"); assert.equal(s.reads[0][1].allowNetwork,false); }
  finally { if(original===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=original; }
  await s.event("session_shutdown"); assert.equal(s.statuses.at(-1),undefined);
  await s.event("agent_end"); assert.equal(s.reads.length,1);
});

test("concurrent events deduplicate reads; disabling prevents late publication", async () => {
  const s=setup({enabled:true}); let release;
  s.read=()=>new Promise(resolve=>{release=resolve;});
  const a=s.event("session_start"), b=s.event("agent_end"); await tick(); assert.equal(s.reads.length,1);
  await s.command("off"); release(snapshot()); await Promise.all([a,b]);
  assert.equal(s.statuses.at(-1),undefined);
});

test("unsupported status surfaces disable the opt-in relay without breaking the host", async () => {
  const s=setup({enabled:true});s.ctx.ui.setStatus=()=>{throw new Error("PRIVATE");};
  await s.event("session_start");assert.equal(s.authCalls,0);assert.equal(s.reads.length,0);
  await s.event("agent_end");assert.equal(s.authCalls,0);
});

test("status reports relay payload state without querying credits or exposing account data", async () => {
  const s=setup();await s.command("on");const reads=s.reads.length;
  await s.command("status");assert.match(s.notices.at(-1),/payload=ready/);assert.equal(s.reads.length,reads);
  assert.doesNotMatch(s.notices.at(-1),/SYNTHETIC|mock-user|90|125/);
  await s.command("off");await s.command("status");assert.match(s.notices.at(-1),/payload=disabled/);
});
