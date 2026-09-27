import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { affectedAdvisories, advisoryExitCode, advisoryMessages, checkUpdates, publishedReleases, selectRelease, type PublishedRelease, type UpdateCheck } from "../update-check.ts";
const release = (version: string): PublishedRelease => ({version,tag:"v"+version,url:"https://github.com/owner/repo/releases/tag/v"+version,publishedAt:"2026-09-26T00:00:00Z"});
const advisory = (severity="high", affected=">=2.0.0 <2.1.0") => ({id:"fixture",severity,affected,fixed:"2.1.0",summary:"Fixture advisory"});
const manifest = (advisories: unknown[]) => JSON.stringify({schemaVersion:1,advisories});
const row = (tag_name: string, fields={}) => ({tag_name,draft:false,prerelease:false,published_at:"2026-09-26T00:00:00Z",...fields});
test("semantic version policy selects patches/minors; majors always require review",()=>{
 const releases=["2.1.0","2.0.2","2.0.10","2.10.0","2.9.0","3.0.0"].map(release);
 assert.equal(selectRelease("2.0.0",releases,"patch").target?.version,"2.0.10");
 for(const policy of ["minor","major"] as const){const result=selectRelease("2.0.0",releases,policy);assert.equal(result.target?.version,"2.10.0");assert.equal(result.major?.version,"3.0.0");}
 assert.equal(selectRelease("2.10.0",releases,"major").outcome,"major-available");
 assert.equal(selectRelease("2.0.0",releases,"minor","v3.0.0").target,undefined);
 assert.throws(()=>selectRelease("2.1.0",releases,"minor","2.0.2"),/downgrade/);
 assert.throws(()=>selectRelease("2.0.0",releases,"patch","2.1.0"),/patch policy/);
 assert.throws(()=>selectRelease("2.0.0",releases,"minor","9.0.0"),/not been published/);
});
test("release discovery paginates and ignores drafts, prereleases and non-semver tags",async()=>{
 const urls:string[]=[];const first=Array.from({length:100},(_,i)=>row("v2.0."+i));
 const releases=await publishedReleases("owner/repo",async url=>{urls.push(url);return JSON.stringify(url.endsWith("page=1")?first:[row("v2.1.0"),row("v3.0.0",{draft:true}),row("v4.0.0-rc.1",{prerelease:true}),row("deploy/staging/1")]);});
 assert.equal(releases.length,101);assert.equal(releases.at(-1)?.version,"2.1.0");assert.equal(urls.length,2);
 await assert.rejects(()=>publishedReleases("owner/repo/escape",async()=>"[]"),/Invalid GitHub/);
 await assert.rejects(()=>publishedReleases("owner/repo",async()=>JSON.stringify([row("v2.0.0",{published_at:null})])),/publication timestamp/);
});
test("high and critical affected versions fail; lower severities warn; fixed versions pass",()=>{
 for(const severity of ["low","medium","high","critical"]){
  const affected=affectedAdvisories("2.0.0",manifest([advisory(severity)]));
  const result:UpdateCheck={schemaVersion:1,source:"owner/repo",policy:"minor",installed:"2.0.0",outcome:"current",...affected};
  assert.equal(advisoryExitCode(result),["high","critical"].includes(severity)?1:0);
  assert.match(advisoryMessages(result)[0],new RegExp("^::"+(["high","critical"].includes(severity)?"error":"warning")));
  assert.equal(affectedAdvisories("2.1.0",manifest([advisory(severity)])).severity,"none");
 }
 assert.throws(()=>affectedAdvisories("2.0.0",manifest([advisory("high",">=2.0.0")])),/still affected/);
 assert.throws(()=>affectedAdvisories("2.0.0",manifest([advisory("high","nonsense")])),/Unsupported/);
});
test("advisory annotations cannot inject new workflow commands",()=>{
 const result:UpdateCheck={schemaVersion:1,source:"owner/repo",policy:"minor",installed:"2.0.0",outcome:"current",severity:"high",advisories:[{...advisory(),severity:"high",summary:"line\n::notice::injected%"}]};
 const [message]=advisoryMessages(result);assert.ok(!message.includes("\n"));assert.match(message,/%0A/);assert.match(message,/%25/);
});
test("installed baseline is read-only; newest publication supplies cumulative advisories even for an LTS release",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"update-check-"));const file=path.join(root,".platform-base.json"),before=JSON.stringify({version:"2.0.0",commit:"a".repeat(40),patches:[]});fs.writeFileSync(file,before);
 const urls:string[]=[];
 try {
  const result=await checkUpdates({root,repo:"owner/repo",read:async url=>{urls.push(url);return new URL(url).hostname === "api.github.com"?JSON.stringify([row("v3.0.0",{published_at:"2026-09-25T00:00:00Z"}),row("v2.1.0")]):manifest([advisory()]);}});
  assert.equal(result.latest?.version,"3.0.0");assert.equal(result.advisoryRelease?.version,"2.1.0");assert.equal(result.target?.version,"2.1.0");assert.equal(result.severity,"high");assert.match(urls[1],/\/v2\.1\.0\/advisories.json$/);
  assert.equal(fs.readFileSync(file,"utf8"),before);assert.deepEqual(fs.readdirSync(root),[".platform-base.json"]);
  await assert.rejects(()=>checkUpdates({root,read:async url=>new URL(url).hostname === "api.github.com"?JSON.stringify([row("v2.1.0")]):"bad JSON"}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("unadopted product checkouts need no network; missing release data is explicit",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"update-check-"));try {
  assert.equal((await checkUpdates({root,read:async()=>{throw Error("must not fetch");}})).outcome,"not-adopted");
  fs.writeFileSync(path.join(root,".platform-base.json"),JSON.stringify({version:"2.0.0",commit:"a".repeat(40)}));
  const unavailable=await checkUpdates({root,read:async()=>"[]"});assert.equal(unavailable.outcome,"no-releases");assert.equal(advisoryExitCode(unavailable),1);
  await assert.rejects(()=>checkUpdates({root,to:"2.1.0",read:async()=>"[]"}),/not been published/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("network reads keep tokens off downloads, reject foreign hosts, and hide error bodies",async()=>{
 const { readURL } = await import("../update-check.ts"), original=globalThis.fetch, before=process.env.GH_TOKEN;
 const calls:{url:string;headers:Record<string,string>}[]=[];process.env.GH_TOKEN="fixture-read-token";
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),headers:init?.headers as Record<string,string>});return new Response("[]");};
 try {
  await readURL("https://api.github.com/repos/owner/repo/releases");await readURL("https://github.com/owner/repo/releases/download/v2.0.0/advisories.json");
  assert.equal(calls[0].headers.Authorization,"Bearer fixture-read-token");assert.equal(calls[1].headers.Authorization,undefined);
  await assert.rejects(()=>readURL("https://example.com/private"),/Unexpected release host/);assert.equal(calls.length,2);
  globalThis.fetch=async()=>new Response("private error body",{status:403});
  await assert.rejects(()=>readURL("https://api.github.com/repos/owner/repo/releases"),error=>error instanceof Error && error.message.includes("HTTP 403") && !error.message.includes("private error body"));
 }finally{globalThis.fetch=original;if(before===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=before;}
});
test("the actual contracts command exits nonzero for high and zero with a medium warning",async()=>{
 const {spawnSync}=await import("node:child_process"),{fileURLToPath}=await import("node:url");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"advisory-cli-"));
 try{
  fs.writeFileSync(path.join(root,".platform-base.json"),JSON.stringify({version:"2.0.0",commit:"a".repeat(40)}));
  const stub=path.join(root,"fetch.mjs");
  fs.writeFileSync(stub,`globalThis.fetch = async url => new Response(JSON.stringify(new URL(String(url)).hostname === "api.github.com" ? ${JSON.stringify([row("v2.1.0")])} : {schemaVersion:1,advisories:[{...${JSON.stringify(advisory())},severity:process.env.FIXTURE_SEVERITY}]}));`);
  for(const severity of ["high","medium"]){
   const result=spawnSync(process.execPath,["--import",stub,fileURLToPath(new URL("../update-check.ts",import.meta.url)),"--root",root,"--advisories"],{encoding:"utf8",env:{...process.env,FIXTURE_SEVERITY:severity}});
   assert.equal(result.status,severity==="high"?1:0,result.stderr);assert.match(result.stderr,new RegExp(severity==="high"?"::error::":"::warning::"));
   assert.equal(JSON.parse(result.stdout).severity,severity);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
