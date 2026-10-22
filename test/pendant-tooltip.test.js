import assert from "node:assert/strict";
import { test } from "node:test";
import { createTooltipAdapter, TOOLTIP_STATUS_KEY } from "../src/pendant-tooltip.js";

const wire = createTooltipAdapter();
const base = () => ({ kind: "grid", title: "DeepSeek", hint: "Right-click", rows: [{ label: "Provider", value: "workbuddy" }] });
const data = () => ({ v: 1, provider: "workbuddy", sessionId: "session-1", state: "ready", creditsTotal: 125,
  creditsRemaining: 90, creditsUsed: 35, packageCount: 2, fetchedAt: 1000, source: "remote", stale: false, planName: "Synthetic plan" });
const entries = packet => [{ key: TOOLTIP_STATUS_KEY, text: wire.encode(packet) }];
const context = () => ({ provider: "workbuddy", sessionId: "session-1", modelAvailable: true });

test("tooltip appends WorkBuddy credit semantics without replacing existing model rows", () => {
  const original = base(); const result = wire.append(original, entries(data()), context(), 1000);
  assert.equal(result.title, original.title); assert.equal(result.hint, original.hint);
  assert.equal(original.rows.length, 1);
  assert.deepEqual(result.rows.slice(0,1), original.rows);
  assert.equal(result.rows.find(row => row.label === "Credits remaining").value, "90");
  assert.equal(result.rows.find(row => row.label === "Credits used / total").value, "35 / 125");
  assert.doesNotMatch(JSON.stringify(result), /fiveHour|weekly|USD|Expires|Banked/);
});

test("tooltip payload serialization strips credentials, identities, errors and unknown fields", () => {
  const encoded = wire.encode({ ...data(), access: "PRIVATE", headers: { Authorization: "PRIVATE" }, email: "PRIVATE", error: "PRIVATE" });
  assert.doesNotMatch(encoded, /PRIVATE|Authorization|access|email|error/);
  const withoutPlan = { ...data(), planName: "\n\u202e" };
  assert.equal(JSON.parse(wire.encode(withoutPlan)).planName, undefined);
});

test("null stays unknown and real zero stays zero; dates and plans are not fabricated", () => {
  const result = wire.append(base(), entries({ ...data(), creditsTotal: null, creditsRemaining: 0, creditsUsed: null, planName: undefined }), context(), 1000);
  assert.equal(result.rows.find(row => row.label === "Credits remaining").value, "0");
  assert.equal(result.rows.find(row => row.label === "Credits used / total").value, "Unknown / Unknown");
  assert.equal(result.rows.some(row => row.label === "Plan"), false);
});

for (const change of [{ provider: "openai-codex" }, { sessionId: "other-session" }, { modelAvailable: false }]) {
  test("tooltip does not cross provider/session/availability boundary: " + JSON.stringify(change), () => {
    const original = base(); assert.equal(wire.append(original, entries(data()), { ...context(), ...change }, 1000), original);
  });
}

test("stale age, failed-refresh flags and clock rollback are visible", () => {
  for (const [packet, now] of [[data(),61000],[{ ...data(), stale: true },1000],[data(),500]]) {
    const result = wire.append(base(), entries(packet), context(), now);
    assert.equal(result.rows.at(-1).value, "Cached / stale");
    assert.equal(result.rows.at(-1).valueTone, "warning");
  }
});

test("unavailable/loading states remove previous credit values", () => {
  for (const state of ["loading", "unavailable"]) {
    const packet = { ...data(), state };
    const result = wire.append(base(), entries(packet), context());
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows.at(-1).label, "WorkBuddy credits");
    assert.doesNotMatch(JSON.stringify(result), /125|90|35/);
  }
});

test("invalid, oversized, duplicate and spoofed packets are ignored", () => {
  const original = base();
  for (const rows of [[], [{key:TOOLTIP_STATUS_KEY,text:"not JSON"}], [{key:TOOLTIP_STATUS_KEY,text:"x".repeat(4097)}],
    [...entries(data()),...entries(data())], [{key:"other",text:JSON.stringify(data())}],
    [{key:TOOLTIP_STATUS_KEY,text:JSON.stringify({...data(),creditsRemaining:-1})}]]) {
    assert.equal(wire.append(original, rows, context()), original);
  }
  for (const change of [{ v: 2 }, { sessionId: 123 }, { sessionId: "bad/path" }, { provider: "other" },
    { creditsTotal: Infinity }, { fetchedAt: 8640000000000001 }, { packageCount: -1 }, { source: "forged" }]) {
    assert.throws(() => wire.encode({ ...data(), ...change }), /Invalid/);
  }
});

for (const [remaining,total,tone] of [[100,100,"good"],[50,100,"good"],[49,100,"warning"],[15,100,"warning"],[14,100,"danger"],[0,100,"danger"],[0,0,"danger"],[0,null,"danger"],[90,null,undefined],[101,100,undefined],[null,100,undefined]]) {
  test("credit remaining tone matches native quota semantics: "+remaining+" / "+total,()=>{
    const result=wire.append(base(),entries({...data(),creditsRemaining:remaining,creditsTotal:total}),context(),1000);
    assert.equal(result.rows.find(row=>row.label==="Credits remaining").valueTone,tone);
    for(const label of ["Provider","Plan","Credits used / total","Credit packages","Updated"]){
      assert.equal(result.rows.find(row=>row.label===label)?.valueTone,undefined,label+" should stay neutral");
    }
  });
}

test("stale balances are not painted as current healthy or depleted quota",()=>{
  for(const [packet,now] of [[data(),61000],[{...data(),stale:true},1000],[{...data(),creditsRemaining:0},61000],[data(),NaN]]){
    const result=wire.append(base(),entries(packet),context(),now);
    assert.equal(result.rows.find(row=>row.label==="Credits remaining").valueTone,undefined);
    assert.equal(result.rows.at(-1).valueTone,"warning");
  }
  const unavailable=wire.append(base(),entries({...data(),state:"unavailable"}),context(),1000);
  assert.equal(unavailable.rows.at(-1).valueTone,"warning");
});

const detail = (kind="bonus",remaining=60,expiresAt=Date.UTC(2030,4,12)) => ({kind,total:80,remaining,used:80-remaining,expiresAt,expiresText:null});
test("per-resource tooltip displays base and separate bonus grants with each expiry",()=>{
  const packet={...data(),packageDetails:{state:"complete",count:3,items:[detail("bonus",40,Date.UTC(2030,5,1)),detail("base"),detail("bonus",70,Date.UTC(2030,4,1))]}};
  const result=wire.append(base(),entries(packet),context(),1000);
  assert.deepEqual(result.rows.filter(row=>/Base credits|Bonus/.test(row.label)).map(row=>row.label),["Base credits","Bonus 1","Bonus 2"]);
  assert.equal(result.rows.find(row=>row.label==="Bonus 1").value,"70 / 80 left");
  assert.equal(result.rows.find(row=>row.label==="Bonus 2").value,"40 / 80 left");
  assert.equal(result.rows.filter(row=>row.label==="Expires").length,3);
  assert.equal(result.rows.some(row=>row.label==="Credit packages"||row.label==="Credits used / total"),false);
  assert.equal(result.rows.find(row=>row.label==="Bonus 1").valueTone,"good");
});

test("wire projects bounded earliest-expiry details without leaking resource/account fields",()=>{
  const items=Array.from({length:40},(_,i)=>({...detail("bonus",60,Date.UTC(2030,4,i+1)),ResourceId:"PRIVATE",account:"PRIVATE",token:"PRIVATE"}));
  items.push(detail("base"));
  const packet={...data(),packageDetails:{state:"complete",count:41,items}};
  const encoded=wire.encode(packet),projected=JSON.parse(encoded);
  assert.ok(encoded.length<4096); assert.equal(projected.packageDetails.items.length,4);
  assert.equal(projected.packageDetails.items[0].kind,"base");
  assert.doesNotMatch(encoded,/PRIVATE|ResourceId|account|token/);
  assert.equal(packet.packageDetails.items.length,41,"encoding must not mutate cached details");
  const result=wire.append(base(),[{key:TOOLTIP_STATUS_KEY,text:encoded}],context(),1000);
  assert.equal(result.rows.find(row=>row.label==="More packages").value,"37 not shown");
});

test("unknown expiry, offset-less server time, partial and unavailable details are explicit",()=>{
  const packet={...data(),packageDetails:{state:"partial",count:2,items:[{...detail(),expiresAt:null,expiresText:"2030-05-12 08:30:00"},{...detail(),expiresAt:null}]}};
  const result=wire.append(base(),entries(packet),context(),1000);
  assert.equal(result.rows.find(row=>row.label==="Expires (server time)").value,"2030-05-12 08:30:00");
  assert.equal(result.rows.find(row=>row.label==="Expires").value,"Unknown");
  assert.equal(result.rows.find(row=>row.label==="Package details").value,"Partial");
  const unavailable=wire.append(base(),entries({...data(),packageDetails:{state:"unavailable",count:0,items:[]}}),context(),1000);
  assert.equal(unavailable.rows.find(row=>row.label==="Package details").value,"Unavailable");
  assert.equal(unavailable.rows.find(row=>row.label==="Credits used / total").value,"35 / 125");
});

test("per-package unknown and stale balances never get invented health coloring",()=>{
  const packet={...data(),packageDetails:{state:"complete",count:1,items:[detail("bonus",0)]}};
  const fresh=wire.append(base(),entries(packet),context(),1000);
  assert.equal(fresh.rows.find(row=>row.label==="Bonus 1").valueTone,"danger");
  const stale=wire.append(base(),entries({...packet,stale:true}),context(),1000);
  assert.equal(stale.rows.find(row=>row.label==="Bonus 1").valueTone,undefined);
});

test("invalid per-package payloads and unbounded decoder arrays are rejected",()=>{
  for(const change of [{kind:"PRIVATE"},{remaining:-1},{expiresAt:Infinity},{expiresText:"PRIVATE"},{expiresText:"2030-02-30 10:00:00"},{expiresText:"2030-05-12 08:30:00"}]){
    assert.throws(()=>wire.encode({...data(),packageDetails:{state:"complete",count:1,items:[{...detail(),...change}]}}),/Invalid/);
  }
  const original=base();
  const packet={...data(),packageDetails:{state:"complete",count:5,items:Array.from({length:5},()=>detail())}};
  assert.equal(wire.append(original,[{key:TOOLTIP_STATUS_KEY,text:JSON.stringify(packet)}],context(),1000),original);
});
