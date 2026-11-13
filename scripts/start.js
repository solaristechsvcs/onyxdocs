const path=require('node:path');
const fs=require('node:fs/promises');
const {fork}=require('node:child_process');
const {options,readState,writeState,stage,activate,prune}=require('./updater');
const root=path.resolve(__dirname,'..');
const configPath=path.join(root,'config.js');
let child,active,stopping=false,busy=false,timer;
const log=message=>console.log(`[OnyxDocs updater] ${message}`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopChild(){
  const old=child;child=null;
  if(!old || old.exitCode!==null || old.signalCode!==null)return;
  await new Promise(resolve=>{const timeout=setTimeout(()=>{old.kill('SIGKILL');},15000);old.once('exit',()=>{clearTimeout(timeout);resolve();});old.kill('SIGTERM');});
}
function launch(dir,timeout){
  return new Promise((resolve,reject)=>{
    const app=fork(path.join(dir,'src','server.js'),[],{cwd:dir,env:{...process.env,ONYXDOCS_CONFIG_PATH:configPath},stdio:['inherit','inherit','inherit','ipc']});child=app;
    const timer=setTimeout(()=>finish(new Error('Application readiness timed out.')),timeout);
    const exit=(code,signal)=>finish(new Error(`Application exited before ready (${code ?? signal}).`));
    const error=err=>finish(err);
    const message=msg=>{if(msg?.type==='ready')finish();};
    function finish(err){clearTimeout(timer);app.off('exit',exit);app.off('error',error);app.off('message',message);err?reject(err):resolve(app);}
    app.once('exit',exit);app.once('error',error);app.on('message',message);
  });
}
function monitor(app,opt){
  app.once('exit',async(code,signal)=>{
    if(stopping || app!==child)return;
    child=null;log(`Application stopped (${code ?? signal}); restarting in 5 seconds.`);
    await delay(5000);if(stopping)return;
    while(busy && !stopping)await delay(250);
    if(stopping || child)return;
    try{monitor(await launch(active.dir,opt.timeout),opt);}catch(err){log(err.message);await shutdown(1);}
  });
}
async function check(opt){
  if(busy || stopping)return;busy=true;
  const previous=active;
  try{
    const next=await stage(root,opt,active.sha);
    if(!next || stopping)return;
    log(`Prepared ${next.sha.slice(0,7)}. Restarting application.`);
    const result=await activate(next,previous,{stop:stopChild,start:release=>{if(stopping)throw new Error('Supervisor stopping.');return launch(release.dir,opt.timeout);},persist:release=>writeState(root,release)});
    active=result.active;monitor(result.app,opt);
    if(result.error)log(`Update startup failed: ${result.error.message} Previous application restored.`);
    else log(`Update active: ${next.sha.slice(0,7)}.`);
    await prune(root,[active.sha,previous.sha]);
  }catch(err){log(`Update check failed: ${err.message}`);if(!child && !stopping)await shutdown(1);}
  finally{busy=false;}
}
async function shutdown(code=0){if(stopping)return;stopping=true;clearInterval(timer);await stopChild();process.exit(code);}
async function main(){
  const config=require(configPath);const opt=options(config);
  // Prevent two supervisors from writing the same release state.
  await fs.mkdir(path.join(root,'.onyx-updates'),{recursive:true});
  const lockPath=path.join(root,'.onyx-updates','supervisor.lock');
  try{const lock=await fs.open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.close();}
  catch(err){if(err.code!=='EEXIST')throw err;const pid=Number(await fs.readFile(lockPath,'utf8'));let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw new Error('Another updater is running.');await fs.unlink(lockPath);const lock=await fs.open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.close();}
  process.on('exit',()=>{try{require('node:fs').unlinkSync(lockPath);}catch{}});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown());
  const saved=await readState(root);
  active=saved && saved.repository===opt.repository && saved.branch===opt.branch?saved:{dir:root,sha:null};
  try{monitor(await launch(active.dir,opt.timeout),opt);}catch(err){await stopChild();if(active.dir===root)throw err;log('Saved release failed; falling back to installed application.');active={dir:root,sha:null};monitor(await launch(root,opt.timeout),opt);}
  if(opt.enabled){log(`Checking ${opt.branch} every ${opt.interval/1000} seconds.`);timer=setInterval(()=>check(opt),opt.interval);await check(opt);}else log('Automatic updates disabled.');
}
if(require.main===module)main().catch(async err=>{log(err.message);await shutdown(1);});
module.exports={launch,stopChild};
