const crypto = require('node:crypto');
function discordSettings(config) {
  const d=config.discord;
  if(!d?.enabled)return null;
  if(!/^\d{17,20}$/.test(d.clientId || '') || !d.clientSecret)throw new Error('Set Discord clientId and clientSecret in config.js.');
  const uri=new URL(d.redirectUri || new URL('/auth/discord/callback',config.baseUrl).href);
  if(uri.protocol!=='https:' && !(uri.protocol==='http:' && ['localhost','127.0.0.1'].includes(uri.hostname)))throw new Error('Discord redirect URI must use HTTPS (or localhost for development).');
  return {...d,redirectUri:uri.href};
}
function beginFlow(session,mode) {
  const state=crypto.randomBytes(32).toString('hex');
  session.discordOAuth={state,mode,userId:mode==='link'?session.userId:null,expires:Date.now()+10*60*1000};
  return state;
}
function consumeFlow(session,state,now=Date.now()) {
  const flow=session.discordOAuth;delete session.discordOAuth;
  if(!flow || typeof state!=='string' || !/^[a-f0-9]{64}$/.test(state) || typeof flow.state!=='string' || !/^[a-f0-9]{64}$/.test(flow.state) || !crypto.timingSafeEqual(Buffer.from(state),Buffer.from(flow.state)) || flow.expires<now)return null;
  if(flow.mode==='link' && (!flow.userId || flow.userId!==session.userId))return null;
  return flow;
}
function authorizationUrl(settings,state) {
  const url=new URL('https://discord.com/oauth2/authorize');
  url.search=new URLSearchParams({client_id:settings.clientId,redirect_uri:settings.redirectUri,response_type:'code',scope:'identify',state,prompt:'consent'}).toString();
  return url.href;
}
async function fetchIdentity(settings,code,fetcher=fetch) {
  const response=await fetcher('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.clientId,client_secret:settings.clientSecret,grant_type:'authorization_code',code,redirect_uri:settings.redirectUri}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Discord token exchange failed.');
  const token=await response.json();if(typeof token.access_token!=='string')throw new Error('Discord token missing.');
  const result=await fetcher('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw new Error('Discord identity lookup failed.');
  const user=await result.json();if(typeof user.id!=='string' || !/^\d{17,20}$/.test(user.id))throw new Error('Discord identity invalid.');
  return {id:user.id};
}
module.exports={discordSettings,beginFlow,consumeFlow,authorizationUrl,fetchIdentity};
