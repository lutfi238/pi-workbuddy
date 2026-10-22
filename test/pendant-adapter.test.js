import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { patchWebview, patchHostExtension, prepareAdapter, ORIGINAL_SHA256, HOST_EXTENSION_SHA256 } from "../integrations/pendant/prepare.mjs";
import { createTooltipAdapter, TOOLTIP_STATUS_KEY } from "../src/pendant-tooltip.js";

const sdk = process.env.PI_SDK_TEST_PATH;
const artifactRoot = process.env.PI_PENDANT_FIXTURE_PATH || (sdk ? dirname(dirname(sdk)) : undefined);
const hostTest = (name, fn) => test(name, { skip: !artifactRoot && "Set PI_PENDANT_FIXTURE_PATH or PI_SDK_TEST_PATH for the original pinned Pendant artifact" }, fn);
const hash = value => createHash("sha256").update(value).digest("hex");

test("adapter preparation rejects unknown versions/hashes without writing host files", () => {
  assert.throws(() => patchWebview("unrecognized source"), /hash/);
  assert.throws(() => patchHostExtension("unrecognized source"), /hash/);
  const dir = mkdtempSync(join(tmpdir(), "wb-adapter-invalid-"));
  try {
    writeFileSync(join(dir,"package.json"),JSON.stringify({publisher:"other",name:"vscode-pi",version:"0.41.0"}));
    assert.throws(() => prepareAdapter(dir,join(dir,"nested")),/inside/);
    assert.throws(() => prepareAdapter(dir,join(dirname(dir),"not-created-by-wb")),/Only cdervis/);
    assert.equal(existsSync(join(dir,"nested")),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

hostTest("pinned adapter prepares a syntax-checked copy without modifying the source fixture", () => {
  const root = artifactRoot, path = join(root,"dist/webview.js"), original = readFileSync(path);
  const dir = mkdtempSync(join(tmpdir(),"wb-adapter-"));
  try {
    assert.equal(hash(original),ORIGINAL_SHA256);
    const out=join(dir,"prepared"), manifest=prepareAdapter(root,out);
    assert.equal(manifest.applied,false);
    assert.equal(hash(readFileSync(join(out,"webview.js"))),manifest.preparedSha256);
    assert.equal(hash(readFileSync(join(out,"extension.js"))),manifest.brokerPreparedSha256);
    assert.equal(hash(readFileSync(join(root,"dist/extension.js"))),HOST_EXTENSION_SHA256);
    assert.equal(hash(readFileSync(path)),ORIGINAL_SHA256);
    assert.throws(()=>prepareAdapter(root,out),/EEXIST/);
    assert.equal(hash(readFileSync(path)),ORIGINAL_SHA256);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

hostTest("patched native renderer consumes scoped status rows and hides the encoded transport", () => {
  const original = readFileSync(join(artifactRoot,"dist/webview.js"),"utf8");
  const patched = patchWebview(original);
  const between=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const grid=between(original,"function s$(","function o$(");
  const model=between(patched,"renderModelTooltipFor(e){","prepareModelTooltipFor(e){");
  const status=between(patched,"setExtensionStatus(e){","setExtensionStatusSurface(e){");
  let current={sessionId:"session-1"}, refreshed=0;
  const helpers={ d:key=>key, oa:value=>String(value), Iu:model=>model.input?.includes("image"), om:()=>false,
    ls:value=>value, gm:"openrouter", xn:(models,provider,id)=>models.find(m=>m.provider===provider&&m.id===id),
    __piWorkbuddyTooltip:vm.runInNewContext(patched.slice(0,patched.indexOf("\nimport{"))+"\n__piWorkbuddyTooltip") };
  const Host=vm.runInNewContext(grid+";(class Host{"+model+status+"})",helpers);
  const host=new Host();
  const models=[{provider:"workbuddy",id:"deepseek",name:"DeepSeek",input:["text","image"],contextWindow:1000000,reasoning:true},
    {provider:"openai-codex",id:"codex",name:"Codex",input:["text"],contextWindow:500000,reasoning:true}];
  host.options={getModels:()=>models,getState:()=>current,extensionStatusInline:{},extensionStatusButton:{}};
  host.subscriptionUsage={get:()=>({value:null,loading:false})}; host.openRouterCredits={get:()=>({value:null})};
  host.getFooterStateSnapshot=()=>({chatGptUsageDisplayConfig:{enabled:false},openRouterCreditsDisplayConfig:{enabled:false}});
  host.extensionStatus={entries:[]}; host.renderExtensionStatus=()=>{}; host.renderExtensionStatusTooltip=()=>({});
  host.ui={footerTooltipController:{refresh(){},refreshActive(){refreshed++;}}};
  const packet=createTooltipAdapter().encode({v:1,provider:"workbuddy",sessionId:"session-1",state:"ready",creditsTotal:125,
    creditsRemaining:90,creditsUsed:35,packageCount:2,fetchedAt:Date.now(),source:"remote",stale:false,
    packageDetails:{state:"complete",count:2,items:[
      {kind:"base",total:100,remaining:80,used:20,expiresAt:Date.UTC(2030,4,1),expiresText:null},
      {kind:"bonus",total:25,remaining:10,used:15,expiresAt:Date.UTC(2030,5,1),expiresText:null},
    ]}});
  const codexBefore=host.renderModelTooltipFor({provider:"openai-codex",modelId:"codex"});
  host.setExtensionStatus([{key:TOOLTIP_STATUS_KEY,text:packet},{key:"other-extension",text:"Retained"}]);
  assert.equal(host.extensionStatus.entries.length,1); assert.equal(host.extensionStatus.entries[0].key,"other-extension");
  assert.equal(refreshed,1);
  const rendered=host.renderModelTooltipFor({provider:"workbuddy",modelId:"deepseek"});
  assert.equal(rendered.rows.find(r=>r.label==="Credits remaining").value,"90");
  assert.equal(rendered.rows.find(r=>r.label==="Base credits").value,"80 / 100 left");
  assert.equal(rendered.rows.find(r=>r.label==="Bonus 1").value,"10 / 25 left");
  assert.equal(rendered.rows.find(r=>r.label==="Bonus 1").valueTone,"warning");
  assert.equal(rendered.rows.filter(r=>r.label==="Expires").length,2);
  assert.equal(JSON.stringify(host.renderModelTooltipFor({provider:"openai-codex",modelId:"codex"})),JSON.stringify(codexBefore));
  current={sessionId:"other-session"};
  assert.equal(host.renderModelTooltipFor({provider:"workbuddy",modelId:"deepseek"}).rows.some(r=>r.label==="Credits remaining"),false);
  current={sessionId:"session-1"}; models.splice(0,1); // Logged-out/unavailable model must not expose cached balance.
  assert.equal(host.renderModelTooltipFor({provider:"workbuddy",modelId:"deepseek"}).rows.some(r=>r.label==="Credits remaining"),false);
  host.setExtensionStatus([]); assert.equal(host.__piWorkbuddyEntries.length,0);
});

hostTest("broker forwards reserved tooltip data when the normal status surface is off", () => {
  const source=readFileSync(join(artifactRoot,"dist/extension.js"),"utf8"), patched=patchHostExtension(source);
  const extract=text=>text.slice(text.indexOf("broadcastExtensionStatus(){"),text.indexOf("waitForSidebarWebviewReady(",text.indexOf("broadcastExtensionStatus(){")));
  const build=text=>vm.runInNewContext("(class Broker{"+extract(text)+"})",{B:target=>target.source+":"+(target.surfaceId??"")});
  const entries=[{key:TOOLTIP_STATUS_KEY,text:"private-credit-payload"},{key:"other-extension",text:"normal-status"}];
  function instantiate(Type,surface) {
    const broker=new Type(),frames=[];
    broker.extensionStatusSurface=surface;broker.view={};broker.editorSurfaces=new Map([["editor",{id:"editor"}]]);
    broker.extensionUiHost={getStatusSnapshot:()=>entries};broker.postMessage=(message,target)=>frames.push({message,target});
    return {broker,frames};
  }
  const old=instantiate(build(source),"off");old.broker.broadcastExtensionStatus();
  assert.equal(old.frames.length,0,"regression: the original broker silently drops all tooltip data by default");
  for(const surface of ["off","statusBar","panel","both"]) {
    const current=instantiate(build(patched),surface);current.broker.broadcastExtensionStatus();
    assert.equal(current.frames.length,2,"sidebar and editor owners must both receive scoped data");
    for(const {message}of current.frames) {
      assert.equal(message.type,"extension_status");
      assert.deepEqual(Array.from(message.entries,e=>e.key),surface==="off"||surface==="statusBar"?[TOOLTIP_STATUS_KEY]:[TOOLTIP_STATUS_KEY,"other-extension"]);
    }
    current.broker.extensionUiHost.getStatusSnapshot=()=>[];current.broker.broadcastExtensionStatus();
    assert.equal(current.frames.at(-1).message.entries.length,0,"clearing the relay must clear the webview even with surface off");
  }
});

hostTest("reserved tooltip transport never becomes a VS Code status-bar badge", () => {
  const source=patchHostExtension(readFileSync(join(artifactRoot,"dist/extension.js"),"utf8"));
  const start=source.indexOf("refreshStatusBar(){"),method=source.slice(start,source.indexOf("applyWidget(",start));
  const Host=vm.runInNewContext("(class Host{"+method+"})",{Dn:value=>value});
  let hidden=0,shown=0;const host=new Host();host.statusBarEnabled=true;
  host.statusBarItem={hide(){hidden++;},show(){shown++;}};
  host.getStatusSnapshot=()=>[{key:TOOLTIP_STATUS_KEY,text:"PRIVATE_TRANSPORT"}];host.refreshStatusBar();
  assert.equal(hidden,1);assert.equal(shown,0);
  host.getStatusSnapshot=()=>[{key:TOOLTIP_STATUS_KEY,text:"PRIVATE_TRANSPORT"},{key:"other",text:"Other extension"}];
  host.refreshStatusBar();assert.equal(shown,1);assert.doesNotMatch(host.statusBarItem.text,/PRIVATE/);
  assert.doesNotMatch(host.statusBarItem.tooltip,/PRIVATE/);assert.match(host.statusBarItem.text,/Other extension/);
});

hostTest("WorkBuddy credit tones match the original OpenAI remaining-quota formatter",()=>{
  const original=readFileSync(join(artifactRoot,"dist/webview.js"),"utf8");
  const start=original.indexOf("function aq("),end=original.indexOf("function am(",start);
  const nativeTone=vm.runInNewContext(original.slice(start,end)+";aq");
  const wire=createTooltipAdapter();
  for(const remaining of [100,50,49,15,14,0]){
    const text=wire.encode({v:1,provider:"workbuddy",sessionId:"color-test",state:"ready",creditsTotal:100,creditsRemaining:remaining,
      creditsUsed:100-remaining,packageCount:1,fetchedAt:1000,source:"remote",stale:false});
    const grid=wire.append({kind:"grid",rows:[]},[{key:TOOLTIP_STATUS_KEY,text}],{provider:"workbuddy",sessionId:"color-test",modelAvailable:true},1000);
    assert.equal(grid.rows.find(row=>row.label==="Credits remaining").valueTone,nativeTone({usedPercent:100-remaining}));
  }
});
