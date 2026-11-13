const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {options,readState,writeState,stage,activate}=require('../scripts/updater');
const {launch,stopChild}=require('../scripts/start');
const SHA='a'.repeat(40);
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'onyx-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'config.js'),'private configuration');await fs.writeFile(path.join(dir,'local-notes.txt'),'keep me');return dir;}
function fakeRunner(calls,{failInstall=false,changed=false}={}){return async(command,args,cwd)=>{
  calls.push({command,args,cwd});
  if(args[0]==='ls-remote')return SHA+'\trefs/heads/main';
  if(args[0]==='clone'){await fs.mkdir(path.join(args.at(-1),'src'));await fs.writeFile(path.join(args.at(-1),'src/server.js'),'console.log("ready");');await fs.writeFile(path.join(args.at(-1),'package.json'),'{"name":"onyxdocs"}');return '';}
  if(args[0]==='rev-parse')return changed?'b'.repeat(40):SHA;
  if(command==='npm' || command==='cmd.exe'){if(failInstall)throw new Error('Registry unavailable');return '';}
  return '';
};}
test('updater rejects credential URLs and unsafe branches and bounds polling',()=>{
  assert.throws(()=>options({updater:{repository:'https://token@github.com/org/repo.git'}}));
  assert.throws(()=>options({updater:{branch:'--upload-pack=bad'}}));
  assert.equal(options({updater:{intervalSeconds:1}}).interval,60000);
  assert.equal(options({updater:{enabled:false}}).enabled,false);
});
test('unchanged remote skips downloads and installation',async(t)=>{const root=await fixture(t);const calls=[];assert.equal(await stage(root,options({}),SHA,fakeRunner(calls)),null);assert.equal(calls.length,1);});
test('staging isolates config and local edits and activates only via explicit state write',async(t)=>{
  const root=await fixture(t);const calls=[];const next=await stage(root,options({}),null,fakeRunner(calls));
  assert.equal(next.sha,SHA);assert.equal(await readState(root),null);
  assert.equal(await fs.readFile(path.join(root,'config.js'),'utf8'),'private configuration');
  assert.equal(await fs.readFile(path.join(root,'local-notes.txt'),'utf8'),'keep me');
  assert.ok(calls.some(c=>c.args.includes('--package-lock=false') || c.args.some(a=>a.includes('--package-lock=false'))));
  await writeState(root,next);assert.equal((await readState(root)).sha,SHA);
});
test('failed dependency installation leaves active state and original files untouched',async(t)=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'.onyx-updates'),{recursive:true});const state='{"sha":"previous"}';await fs.writeFile(path.join(root,'.onyx-updates/active.json'),state);
  await assert.rejects(stage(root,options({}),null,fakeRunner([],{failInstall:true})),/Registry unavailable/);
  assert.equal(await fs.readFile(path.join(root,'.onyx-updates/active.json'),'utf8'),state);
  assert.deepEqual(await fs.readdir(path.join(root,'.onyx-updates/releases')),[]);
});
test('branch changes during staging are rejected',async(t)=>{const root=await fixture(t);await assert.rejects(stage(root,options({}),null,fakeRunner([],{changed:true})),/Branch changed/);assert.equal(await readState(root),null);});
test('saved release state cannot escape the release directory',async(t)=>{const root=await fixture(t);await fs.mkdir(path.join(root,'.onyx-updates'),{recursive:true});await fs.writeFile(path.join(root,'.onyx-updates/active.json'),'{"sha":"../../outside"}');assert.equal(await readState(root),null);});
test('failed application activation restarts previous release without changing saved state',async()=>{
  const next={sha:'new'},previous={sha:'old'},calls=[];
  const result=await activate(next,previous,{stop:async()=>calls.push('stop'),start:async r=>{calls.push('start:'+r.sha);if(r===next)throw new Error('Database unavailable');return 'previous-app';},persist:async()=>calls.push('persist')});
  assert.equal(result.active,previous);assert.equal(result.app,'previous-app');assert.match(result.error.message,/Database unavailable/);assert.deepEqual(calls,['stop','start:new','stop','start:old']);
});
test('successful application activation persists new release only after readiness',async()=>{
  const calls=[],next={sha:'new'};const result=await activate(next,{sha:'old'},{stop:async()=>calls.push('stop'),start:async()=>{calls.push('ready');return 'new-app';},persist:async()=>calls.push('persist')});assert.equal(result.active,next);assert.deepEqual(calls,['stop','ready','persist']);
});
test('launcher waits for readiness and rejects failed application startup',async(t)=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'src'));const entry=path.join(root,'src/server.js');
  await fs.writeFile(entry,"process.send({type:'ready'});setInterval(()=>{},1000);");
  try{const app=await launch(root,3000);assert.equal(app.exitCode,null);}finally{await stopChild();}
  await fs.writeFile(entry,'process.exit(1);');
  try{await assert.rejects(launch(root,3000),/exited before ready/);}finally{await stopChild();}
});
