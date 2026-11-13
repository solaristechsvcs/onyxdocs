const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const exec = promisify(execFile);

async function run(command,args,cwd) {
  const {stdout} = await exec(command,args,{cwd,timeout:180000,maxBuffer:4*1024*1024,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  return stdout.trim();
}
function options(config) {
  const u=config.updater || {};
  const repository=u.repository || 'https://github.com/solaristechsvcs/onyxdocs.git';
  if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(repository)) throw new Error('Updater repository must be a public HTTPS GitHub repository URL without credentials.');
  const branch=u.branch || 'main';
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..')) throw new Error('Invalid updater branch.');
  return {enabled:u.enabled!==false,repository,branch,interval:Math.max(60,Number(u.intervalSeconds)||300)*1000,timeout:Math.max(10,Number(u.startupTimeoutSeconds)||60)*1000};
}
async function readState(root) {
  try {
    const s=JSON.parse(await fs.readFile(path.join(root,'.onyx-updates','active.json'),'utf8'));
    if(!/^[a-f0-9]{40}$/.test(s.sha))return null;
    const dir=path.join(root,'.onyx-updates','releases',s.sha);
    await fs.access(path.join(dir,'src','server.js'));
    return {...s,dir};
  }catch{return null;}
}
async function writeState(root,state) {
  const dir=path.join(root,'.onyx-updates');await fs.mkdir(dir,{recursive:true});
  const temp=path.join(dir,'active.json.tmp');
  await fs.writeFile(temp,JSON.stringify({sha:state.sha,repository:state.repository,branch:state.branch},null,2));
  await fs.rename(temp,path.join(dir,'active.json'));
}
async function stage(root,opt,currentSha,execute=run) {
  const remote=await execute('git',['ls-remote','--exit-code',opt.repository,`refs/heads/${opt.branch}`],root);
  const sha=remote.split(/\s/)[0];
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('GitHub returned an invalid commit.');
  if(sha===currentSha)return null;
  const releases=path.join(root,'.onyx-updates','releases');
  await fs.mkdir(releases,{recursive:true});
  const temporary=await fs.mkdtemp(path.join(releases,'staging-'));
  try {
    await execute('git',['clone','--depth','1','--single-branch','--branch',opt.branch,'--',opt.repository,temporary],root);
    const actual=await execute('git',['rev-parse','HEAD'],temporary);
    if(actual!==sha)throw new Error('Branch changed during download; retrying on the next check.');
    const manifest=JSON.parse(await fs.readFile(path.join(temporary,'package.json'),'utf8'));
    if(manifest.name!=='onyxdocs')throw new Error('Update is not an OnyxDocs release.');
    await fs.access(path.join(temporary,'src','server.js'));
    let locked=true;try{await fs.access(path.join(temporary,'package-lock.json'));}catch{locked=false;}
    const args=locked?['ci','--omit=dev']:['install','--omit=dev','--package-lock=false'];
    // npm.cmd needs cmd.exe on Windows. Linux/Wisp runs npm directly.
    if(process.platform==='win32')await execute('cmd.exe',['/d','/s','/c',`npm ${args.join(' ')}`],temporary);
    else await execute('npm',args,temporary);
    await execute(process.execPath,['--check','src/server.js'],temporary);
    const destination=path.join(releases,sha);
    // A previously staged immutable release can be reused after revalidation.
    try{await fs.access(destination);await fs.rm(destination,{recursive:true,force:true});}catch(err){if(err.code!=='ENOENT')throw err;}
    await fs.rename(temporary,destination);
    return {sha,dir:destination,repository:opt.repository,branch:opt.branch};
  }catch(err){await fs.rm(temporary,{recursive:true,force:true});throw err;}
}
async function activate(next,previous,{stop,start,persist}) {
  await stop();
  try{const app=await start(next);await persist(next);return {active:next,app};}
  catch(error){await stop();const app=await start(previous);return {active:previous,app,error};}
}
async function prune(root,keep) {
  const releases=path.join(root,'.onyx-updates','releases');
  const entries=await fs.readdir(releases,{withFileTypes:true});
  const eligible=await Promise.all(entries.filter(e=>e.isDirectory() && /^[a-f0-9]{40}$/.test(e.name)).map(async e=>({name:e.name,time:(await fs.stat(path.join(releases,e.name))).mtimeMs})));
  eligible.sort((a,b)=>b.time-a.time);
  const retained=new Set([...keep.filter(Boolean),...eligible.slice(0,3).map(e=>e.name)]);
  for(const entry of eligible)if(!retained.has(entry.name))await fs.rm(path.join(releases,entry.name),{recursive:true,force:true});
}
module.exports={run,options,readState,writeState,stage,activate,prune};
