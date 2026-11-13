const {test}=require('node:test');
const assert=require('node:assert/strict');
const {discordSettings,beginFlow,consumeFlow,authorizationUrl,fetchIdentity}=require('../src/discord');
const settings={clientId:'123456789012345678',clientSecret:'private',redirectUri:'https://docs.example.com/auth/discord/callback'};
test('Discord is opt-in and requires valid credentials and secure callback',()=>{
  assert.equal(discordSettings({}),null);
  assert.throws(()=>discordSettings({discord:{enabled:true}}));
  assert.throws(()=>discordSettings({discord:{...settings,enabled:true,redirectUri:'http://public.example.com/callback'}}));
  assert.equal(discordSettings({discord:{...settings,enabled:true}}).redirectUri,settings.redirectUri);
});
test('authorization uses identify only and exactly configured callback',()=>{const s={};const state=beginFlow(s,'login');const u=new URL(authorizationUrl(settings,state));assert.equal(u.origin,'https://discord.com');assert.equal(u.searchParams.get('scope'),'identify');assert.equal(u.searchParams.get('redirect_uri'),settings.redirectUri);assert.equal(u.searchParams.get('state'),state);});
test('OAuth state is random, single-use, expiring, and rejects Unicode/malformed states',()=>{
  const s={};const state=beginFlow(s,'login');assert.notEqual(state,beginFlow({},'login'));assert.equal(consumeFlow(s,state).mode,'login');assert.equal(consumeFlow(s,state),null);
  const expired=beginFlow(s,'login');assert.equal(consumeFlow(s,expired,Date.now()+11*60000),null);
  beginFlow(s,'login');assert.equal(consumeFlow(s,'é'.repeat(64)),null);
  beginFlow(s,'login');assert.equal(consumeFlow(s,'0'.repeat(64)),null);
});
test('link authorization is bound to the original signed-in staff account',()=>{const s={userId:7};const state=beginFlow(s,'link');s.userId=8;assert.equal(consumeFlow(s,state),null);const correct=beginFlow(s,'link');assert.equal(consumeFlow(s,correct).userId,8);});
test('identity exchange uses form encoding and bearer header without retaining tokens',async()=>{
  const calls=[];const identity=await fetchIdentity(settings,'auth-code',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{access_token:'temporary-token',refresh_token:'unused'}:{id:'123456789012345678',email:'unused@example.com'}};});
  assert.deepEqual(identity,{id:'123456789012345678'});assert.equal(calls[0].options.body.get('redirect_uri'),settings.redirectUri);assert.equal(calls[0].options.body.get('grant_type'),'authorization_code');assert.equal(calls[0].options.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(calls[1].options.headers.Authorization,'Bearer temporary-token');
});
test('Discord errors do not expose provider response or secrets',async()=>{
  await assert.rejects(fetchIdentity(settings,'code',async()=>({ok:false})),/token exchange failed/);
  let count=0;await assert.rejects(fetchIdentity(settings,'code',async()=>({ok:true,json:async()=>++count===1?{access_token:'secret'}:{id:123}})),/identity invalid/);
});
