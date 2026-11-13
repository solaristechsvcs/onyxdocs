const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const {rateLimit} = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');
const sanitize = require('sanitize-html');
const {pool, config, migrate} = require('./db');
const {escape: e, slug, categoryTree, validParent} = require('./helpers');
const {discordSettings,beginFlow,consumeFlow,authorizationUrl,fetchIdentity}=require('./discord');
const discord=discordSettings(config);
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'data:','https:','http:']}}}));
app.use(express.urlencoded({extended:false, limit:'1mb'}));
app.use(express.static(path.join(__dirname, '../public')));
class MySQLStore extends session.Store {
  get(sid, cb) { pool.execute('SELECT data FROM sessions WHERE sid=? AND expires>?',[sid,Date.now()]).then(([r]) => cb(null,r[0] ? JSON.parse(r[0].data) : null)).catch(cb); }
  set(sid,data,cb) { pool.execute('REPLACE INTO sessions(sid,data,expires) VALUES(?,?,?)',[sid,JSON.stringify(data),Date.now()+86400000]).then(()=>cb?.()).catch(cb); }
  destroy(sid,cb) { pool.execute('DELETE FROM sessions WHERE sid=?',[sid]).then(()=>cb?.()).catch(cb); }
  touch(sid,data,cb) { this.set(sid,data,cb); }
}
app.use(session({store:new MySQLStore(), secret:config.sessionSecret, resave:false, saveUninitialized:false, name:'onyx.sid', cookie:{httpOnly:true, sameSite:'lax', secure:!!config.secureCookies, maxAge:86400000}}));
app.use(async(req,res,next)=>{
  req.session.csrf ||= crypto.randomBytes(32).toString('hex');
  if (req.method === 'POST' && req.body.csrf !== req.session.csrf) return res.status(403).send('Session expired. Reload the page and try again.');
  try {
    if (req.session.userId) { const [rows] = await pool.execute('SELECT id,name,email,role FROM users WHERE id=?',[req.session.userId]); req.user=rows[0]; }
    next();
  } catch(err) { next(err); }
});
const field=(name,label,value='',type='text')=>`<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}" required></label>`;
const csrf=req=>`<input type="hidden" name="csrf" value="${e(req.session.csrf)}">`;
const form=(req,action,body,label='Save')=>`<form method="post" action="${action}">${csrf(req)}${body}<button>${label}</button></form>`;
const guard=(roles=['owner','admin','editor'])=>(req,res,next)=>req.user && roles.includes(req.user.role) ? next() : res.redirect('/login');
async function layout(req,res,title,body,status=200) {
  const [cats]=await pool.query('SELECT * FROM categories ORDER BY position,name');
  const [articles]=await pool.query('SELECT id,title,slug,category_id FROM articles WHERE published=1 ORDER BY position,title');
  const [settings]=await pool.query('SELECT * FROM settings');
  const settingsMap=Object.fromEntries(settings.map(s=>[s.setting_key,s.value]));
  const site=settingsMap.siteName || config.siteName || 'OnyxDocs';
  const tree=nodes=>nodes.map(c=>`<details open><summary>${e(c.name)}</summary>${articles.filter(a=>a.category_id===c.id).map(a=>`<a class="${req.path===`/docs/${a.slug}`?'active':''}" href="/docs/${e(a.slug)}">${e(a.title)}</a>`).join('')}${tree(c.children)}</details>`).join('');
  const externalLink=(url,label)=>{try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?`<a href="${e(u.href)}">${label}</a>`:'';}catch{return '';}};
  res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(site)}</title><meta name="description" content="${e(settingsMap.description || 'Guides, answers, and documentation in one place.')} "><meta property="og:title" content="${e(title)} · ${e(site)}"><meta property="og:description" content="${e(settingsMap.description || 'Explore our documentation and guides.')} "><meta property="og:type" content="website"><link rel="stylesheet" href="/style.css"></head><body><header><a class="brand" href="/"><span class="logo">O</span>${e(site)}<small>DOCUMENTATION</small></a><nav>${externalLink(config.mainSiteUrl,"Main Site")}${externalLink(config.discordUrl,"Discord")}<button type="button" id="theme-toggle" aria-label="Toggle light or dark theme">◐</button><a href="/">Explore docs</a>${req.user?`<a href="/admin">Dashboard</a>${form(req,'/logout','','Sign out')}`:'<a href="/login">Staff login ↗</a>'}</nav></header><div class="shell"><aside><form action="/search" class="search"><input name="q" aria-label="Search documentation" placeholder="Search documentation…" value="${e(req.query.q || '')}"><button>⌕</button></form><a class="overview" href="/">⌂ &nbsp; Overview</a><p class="eyebrow">DOCUMENTATION</p>${tree(categoryTree(cats))}${articles.filter(a=>!a.category_id).map(a=>`<a href="/docs/${e(a.slug)}">${e(a.title)}</a>`).join('')}<div class="sidebar-footer">Powered by OnyxDocs</div></aside><main>${body}</main></div><footer>${e(site)} · A little clarity goes a long way.</footer><script src="/app.js" defer></script></body></html>`);
}
app.get('/health', async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});});
app.get('/',async(req,res)=>{
  const [cats]=await pool.query('SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id=c.id AND a.published=1) AS total FROM categories c ORDER BY position,name');
  const [recent]=await pool.query('SELECT title,slug,summary FROM articles WHERE published=1 ORDER BY updated_at DESC LIMIT 6');
  await layout(req,res,'Welcome',`<section class="hero"><p class="eyebrow">YOUR KNOWLEDGE, CONNECTED</p><h1>${e(config.welcomeTitle || "Welcome to OnyxDocs")}</h1><p>${e(config.welcomeDescription || "Documentation, guides, and answers for our community.")}</p><form action="/search" class="hero-search"><input name="q" aria-label="Search documentation" placeholder="What can we help you find?"><button>Search →</button></form><a class="button" href="${recent[0]?'/docs/'+e(recent[0].slug):'/search'}">Explore the documentation →</a></section><div class="section-title"><h2>Browse documentation</h2><span>${cats.length} categories</span></div><div class="cards">${cats.map(c=>`<a class="card" href="/category/${c.id}">${c.image_url?`<img class="category-image" src="${e(c.image_url)}" alt="" loading="lazy">`:`<span class="icon">▤</span>`}<h3>${e(c.name)}</h3><p>${e(c.description || 'Explore guides and reference material.')}</p><small>${c.total} articles <b>→</b></small></a>`).join('') || '<div class="empty">Your documentation starts here. Sign in as staff to create your first category and article.</div>'}</div><h2>Recently updated</h2><div class="article-list">${recent.map(a=>`<a href="/docs/${e(a.slug)}"><strong>${e(a.title)}</strong><p>${e(a.summary)}</p><span>Read guide →</span></a>`).join('') || '<p>No published articles yet.</p>'}</div>`);
});
app.get('/category/:id',async(req,res)=>{
  const [[c]]=await pool.execute('SELECT * FROM categories WHERE id=?',[req.params.id]);
  if(!c)return layout(req,res,'Not found','<h1>Category not found</h1>',404);
  const [rows]=await pool.execute('SELECT title,slug,summary FROM articles WHERE category_id=? AND published=1 ORDER BY position,title',[c.id]);
  const [children]=await pool.execute('SELECT * FROM categories WHERE parent_id=? ORDER BY position,name',[c.id]);
  await layout(req,res,c.name,`<p class="eyebrow">DOCUMENTATION</p><h1>${e(c.name)}</h1><p>${e(c.description)}</p><div class="cards">${children.map(c=>`<a class="card" href="/category/${c.id}"><h3>${e(c.name)} →</h3><p>${e(c.description)}</p></a>`).join('')}</div>${rows.map(a=>`<a class="result" href="/docs/${e(a.slug)}"><h3>${e(a.title)}</h3><p>${e(a.summary)}</p></a>`).join('') || '<p>No published articles in this category yet.</p>'}`);
});
app.get('/search',async(req,res)=>{
  const q=String(req.query.q || '').slice(0,200);
  const [rows]=q ? await pool.execute('SELECT title,slug,summary FROM articles WHERE published=1 AND (title LIKE ? OR summary LIKE ? OR content LIKE ?) ORDER BY title LIMIT 100',Array(3).fill('%'+q+'%')) : [[]];
  await layout(req,res,'Search',`<p class="eyebrow">FIND YOUR ANSWER</p><h1>Search documentation</h1><p>${rows.length} results for “${e(q)}”</p>${rows.map(a=>`<a class="result" href="/docs/${e(a.slug)}"><h3>${e(a.title)}</h3><p>${e(a.summary)}</p></a>`).join('') || '<p>Try a title, feature name, or keyword.</p>'}`);
});
app.get('/docs/:slug',async(req,res)=>{
  const [[a]]=await pool.execute('SELECT a.*,c.name AS category FROM articles a LEFT JOIN categories c ON c.id=a.category_id WHERE a.slug=? AND a.published=1',[req.params.slug]);
  if(!a)return layout(req,res,'Not found','<h1>Article not found</h1><p>This page may have moved or is not published.</p>',404);
  const {marked}=await import('marked');
  const html=sanitize(marked.parse(a.content),{allowedTags:sanitize.defaults.allowedTags.concat(['img','details','summary']),allowedAttributes:{...sanitize.defaults.allowedAttributes,img:['src','alt','title','width','height']}});
  await layout(req,res,a.title,`<div class="doc-top"><p class="eyebrow">${e(a.category || 'DOCUMENTATION')}</p>${req.user?`<a href="/admin/articles/${a.id}">Edit article ↗</a>`:''}</div><h1>${e(a.title)}</h1><p class="lead">${e(a.summary)}</p><div class="doc-layout"><article class="prose">${html}</article><nav id="toc" aria-label="On this page"><strong>ON THIS PAGE</strong></nav></div><p class="updated">Updated ${e(new Date(a.updated_at).toLocaleDateString('en-US'))}</p>`);
});
const authLimit=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-8',legacyHeaders:false});
app.get('/setup',async(req,res)=>{const [[row]]=await pool.query('SELECT COUNT(*) AS n FROM users');if(row.n)return res.redirect('/login');await layout(req,res,'Create owner',`<h1>Welcome to OnyxDocs</h1><p>Create the first owner using the setup key from config.js.</p>${form(req,'/setup',field('key','Setup key','','password')+field('name','Name')+field('email','Email','','email')+field('password','Password (12+ characters)','','password'),'Create owner')}`);});
app.post('/setup',authLimit,async(req,res)=>{
  if(!config.setupKey || config.setupKey.startsWith('REPLACE') || req.body.key!==config.setupKey || String(req.body.password).length<12 || !req.body.email || !req.body.name) return res.status(400).send('Check setup key and account details. Password must have 12+ characters.');
  const db=await pool.getConnection();
  try {const [[lock]]=await db.query("SELECT GET_LOCK('onyxdocs_owner_setup',10) AS acquired");if(!lock.acquired)throw new Error('Setup busy');const [[row]]=await db.query('SELECT COUNT(*) AS n FROM users');if(row.n)return res.redirect('/login');await db.execute('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',[req.body.name.slice(0,100),req.body.email.trim().toLowerCase().slice(0,190),await bcrypt.hash(req.body.password,12),'owner']);res.redirect('/login');}
  finally {await db.query("SELECT RELEASE_LOCK('onyxdocs_owner_setup')");db.release();}
});
app.get('/login',(req,res)=>layout(req,res,'Staff login',`<p class="eyebrow">STAFF WORKSPACE</p><h1>Welcome back.</h1>${discord?'<p><a class="button" href="/auth/discord">Sign in with Discord</a></p>':''}${req.query.error?'<p class="notice">Email or password is incorrect.</p>':''}${form(req,'/login',field('email','Email','','email')+field('password','Password','','password'),'Sign in')}<p>First installation? <a href="/setup">Create your owner account</a>.</p>`));
app.post('/login',authLimit,async(req,res,next)=>{const [[u]]=await pool.execute('SELECT * FROM users WHERE email=?',[String(req.body.email || '').trim().toLowerCase()]);if(!u || !await bcrypt.compare(req.body.password || '',u.password))return res.redirect('/login?error=1');req.session.regenerate(err=>{if(err)return next(err);req.session.userId=u.id;req.session.save(err=>err?next(err):res.redirect('/admin'));});});
app.post('/logout',(req,res,next)=>req.session.destroy(err=>err?next(err):res.redirect('/')));
const saveSession=req=>new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
app.get('/auth/discord',authLimit,async(req,res)=>{
  if(!discord)return res.status(404).send('Discord login is disabled.');
  const state=beginFlow(req.session,'login');await saveSession(req);
  res.redirect(authorizationUrl(discord,state));
});
app.get('/auth/discord/callback',authLimit,async(req,res,next)=>{
  if(!discord)return res.sendStatus(404);
  const flow=consumeFlow(req.session,req.query.state);await saveSession(req);
  if(!flow || req.query.error || typeof req.query.code!=='string' || (req.query.iss && req.query.iss!=='https://discord.com'))return res.status(400).send('Discord authorization expired or was cancelled. Return to /login and try again.');
  let identity;
  try{identity=await fetchIdentity(discord,req.query.code);}catch{return res.status(502).send('Discord login could not be completed. Return to /login and try again.');}
  if(flow.mode==='link'){
    if(!req.user || req.user.id!==flow.userId)return res.sendStatus(403);
    try{await pool.execute('UPDATE users SET discord_id=? WHERE id=?',[identity.id,req.user.id]);}
    catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).send('This Discord account is already linked to another staff account.');throw err;}
    return res.redirect('/admin/account');
  }
  const [[user]]=await pool.execute('SELECT id FROM users WHERE discord_id=?',[identity.id]);
  if(!user)return layout(req,res,'Account not linked','<h1>Discord account not linked</h1><p>Sign in with your staff email and password, then open My account to link Discord.</p><a href="/login">Return to staff login</a>',403);
  req.session.regenerate(err=>{if(err)return next(err);req.session.userId=user.id;req.session.save(err=>err?next(err):res.redirect('/admin'));});
});
app.use('/admin',guard());
app.get('/admin/account',async(req,res)=>{
  const [[user]]=await pool.execute('SELECT discord_id FROM users WHERE id=?',[req.user.id]);
  await layout(req,res,'My account',`<a href="/admin">Back to dashboard</a><h1>My account</h1><p>${e(req.user.name)} · ${e(req.user.email)}</p><h2>Discord login</h2>${discord?`<p>${user.discord_id?'Linked Discord user ID: '+e(user.discord_id):'Link your Discord account to sign in with Discord. Your staff role stays the same.'}</p>${form(req,'/admin/account/discord/link',field('password','Confirm your staff password','','password'),user.discord_id?'Change linked Discord account':'Link Discord')}${user.discord_id?form(req,'/admin/account/discord/unlink',field('password','Confirm your staff password','','password'),'Unlink Discord'):''}`:'<p>Discord login is disabled. Configure the discord block in config.js and restart to enable it.</p>'}`);
});
app.post('/admin/account/discord/:action',authLimit,async(req,res)=>{
  if(!discord || !['link','unlink'].includes(req.params.action))return res.sendStatus(404);
  const [[user]]=await pool.execute('SELECT password FROM users WHERE id=?',[req.user.id]);
  if(!user || !await bcrypt.compare(req.body.password || '',user.password))return res.status(403).send('Staff password is incorrect. Return to My account and try again.');
  if(req.params.action==='unlink'){
    await pool.execute('UPDATE users SET discord_id=NULL WHERE id=?',[req.user.id]);
    await pool.execute("DELETE FROM sessions WHERE JSON_EXTRACT(data,'$.userId')=? AND sid<>?",[req.user.id,req.sessionID]);
    return res.redirect('/admin/account');
  }
  const state=beginFlow(req.session,'link');await saveSession(req);res.redirect(authorizationUrl(discord,state));
});
app.get('/admin',async(req,res)=>{
  const [rows]=await pool.query('SELECT a.*,c.name AS category FROM articles a LEFT JOIN categories c ON c.id=a.category_id ORDER BY a.updated_at DESC');
  await layout(req,res,'Dashboard',`<p class="eyebrow">STAFF WORKSPACE · ${e(req.user.role)}</p><h1>Documentation dashboard</h1><div class="actions"><a class="button" href="/admin/articles/new">+ New article</a><a href="/admin/categories">Categories</a><a href="/admin/account">My account</a>${req.user.role!=='editor'?'<a href="/admin/users">Staff accounts</a><a href="/admin/settings">Site settings</a>':''}</div><div class="table-wrap"><table><thead><tr><th>Article</th><th>Category</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(a=>`<tr><td>${e(a.title)}</td><td>${e(a.category || 'Uncategorized')}</td><td><span class="badge">${a.published?'Published':'Draft'}</span></td><td><a href="/admin/articles/${a.id}">Edit →</a></td></tr>`).join('')}</tbody></table></div>`);
});
app.get('/admin/articles/:id',async(req,res)=>{
  let a={title:'',slug:'',summary:'',content:'',position:0,published:0};let revisions=[];
  if(req.params.id!=='new'){const [[row]]=await pool.execute('SELECT * FROM articles WHERE id=?',[req.params.id]);if(!row)return res.sendStatus(404);a=row;[revisions]=await pool.execute('SELECT r.id,r.title,r.created_at,u.name FROM revisions r LEFT JOIN users u ON u.id=r.author_id WHERE article_id=? ORDER BY r.id DESC LIMIT 30',[a.id]);}
  const [cats]=await pool.query('SELECT * FROM categories ORDER BY name');
  await layout(req,res,'Article editor',`<a href="/admin">← Dashboard</a><h1>${a.id?'Edit article':'New article'}</h1>${form(req,req.path,field('title','Title',a.title)+field('slug','URL slug',a.slug)+`<label>Category<select name="category_id"><option value="">Uncategorized</option>${cats.map(c=>`<option value="${c.id}" ${c.id===a.category_id?'selected':''}>${e(c.name)}</option>`).join('')}</select></label><label>Summary<input name="summary" maxlength="500" value="${e(a.summary)}"></label><label>Markdown content<textarea name="content" rows="22" required>${e(a.content)}</textarea></label><p>Supports headings, lists, tables, links, images, and fenced code blocks. HTML is sanitized.</p>`+field('position','Sort position',a.position,'number')+`<label class="check"><input type="checkbox" name="published" value="1" ${a.published?'checked':''}> Published (visible to everyone)</label>`,'Save article')}${a.id?`<h2>Revision history</h2><p>Restore copies the saved title, summary, and content into the current article.</p>${revisions.map(r=>`<div class="revision"><span>${e(r.title)} · ${e(r.name)} · ${e(new Date(r.created_at).toLocaleString('en-US'))}</span>${form(req,`/admin/articles/${a.id}/restore/${r.id}`,'','Restore')}</div>`).join('')}<hr>${form(req,`/admin/articles/${a.id}/delete`,'<label class="check"><input type="checkbox" required> Permanently delete this article and its revisions</label>','Delete article')}`:''}`);
});
app.post('/admin/articles/:id',async(req,res)=>{
  const b=req.body;const articleSlug=slug(b.slug || b.title);if(!b.title?.trim() || !articleSlug || !b.content?.trim())return res.status(400).send('Title, slug and content are required.');
  const db=await pool.getConnection();
  try {await db.beginTransaction();let id=req.params.id;
    if(id!=='new'){const [[old]]=await db.execute('SELECT * FROM articles WHERE id=? FOR UPDATE',[id]);if(!old){await db.rollback();return res.sendStatus(404);}await db.execute('INSERT INTO revisions(article_id,title,summary,content,author_id) VALUES(?,?,?,?,?)',[old.id,old.title,old.summary,old.content,req.user.id]);}
    const values=[b.title.trim().slice(0,200),articleSlug,String(b.summary || '').slice(0,500),b.content,b.category_id || null,b.published==='1'?1:0,Number(b.position)||0,req.user.id];
    if(id==='new'){const [r]=await db.execute('INSERT INTO articles(title,slug,summary,content,category_id,published,position,author_id) VALUES(?,?,?,?,?,?,?,?)',values);id=r.insertId;}else await db.execute('UPDATE articles SET title=?,slug=?,summary=?,content=?,category_id=?,published=?,position=?,author_id=? WHERE id=?',[...values,id]);
    await db.commit();res.redirect('/admin/articles/'+id);
  }catch(err){await db.rollback();throw err;}finally{db.release();}
});
app.post('/admin/articles/:id/restore/:revision',async(req,res)=>{
  const db=await pool.getConnection();try{await db.beginTransaction();const [[a]]=await db.execute('SELECT * FROM articles WHERE id=? FOR UPDATE',[req.params.id]);const [[r]]=await db.execute('SELECT * FROM revisions WHERE id=? AND article_id=?',[req.params.revision,req.params.id]);if(!a || !r){await db.rollback();return res.sendStatus(404);}await db.execute('INSERT INTO revisions(article_id,title,summary,content,author_id) VALUES(?,?,?,?,?)',[a.id,a.title,a.summary,a.content,req.user.id]);await db.execute('UPDATE articles SET title=?,summary=?,content=?,author_id=? WHERE id=?',[r.title,r.summary,r.content,req.user.id,a.id]);await db.commit();res.redirect('/admin/articles/'+a.id);}catch(err){await db.rollback();throw err;}finally{db.release();}
});
app.post('/admin/articles/:id/delete',async(req,res)=>{await pool.execute('DELETE FROM articles WHERE id=?',[req.params.id]);res.redirect('/admin');});
app.get('/admin/categories',async(req,res)=>{const [cats]=await pool.query('SELECT * FROM categories ORDER BY position,name');const editor=c=>form(req,'/admin/categories/'+(c.id || 'new'),field('name','Category name',c.name || '')+`<label>Description<input name="description" value="${e(c.description)}"></label><label>Image URL (optional)<input name="image_url" type="url" value="${e(c.image_url)}"></label><label>Parent<select name="parent_id"><option value="">Top level</option>${cats.filter(p=>p.id!==c.id).map(p=>`<option value="${p.id}" ${p.id===c.parent_id?'selected':''}>${e(p.name)}</option>`).join('')}</select></label>`+field('position','Sort position',c.position || 0,'number'));await layout(req,res,'Categories',`<a href="/admin">← Dashboard</a><h1>Categories</h1><h2>Add category</h2>${editor({})}${cats.map(c=>`<details class="panel"><summary>${e(c.name)}</summary>${editor(c)}${form(req,`/admin/categories/${c.id}/delete`,'<p>Move or delete child categories first. Articles become uncategorized.</p>','Delete category')}</details>`).join('')}`);});
app.post('/admin/categories/:id',async(req,res)=>{const b=req.body;const [cats]=await pool.query('SELECT * FROM categories');if(!b.name?.trim() || !validParent(cats,req.params.id,b.parent_id))return res.status(400).send('Invalid name or circular parent category.');let image=String(b.image_url || "").slice(0,2000);if(image && !/^https?:\/\//i.test(image))return res.status(400).send("Image URL must use HTTP or HTTPS.");const vals=[image,b.name.trim().slice(0,150),String(b.description || '').slice(0,2000),b.parent_id || null,Number(b.position)||0];if(req.params.id==='new')await pool.execute('INSERT INTO categories(image_url,name,description,parent_id,position) VALUES(?,?,?,?,?)',vals);else await pool.execute('UPDATE categories SET image_url=?,name=?,description=?,parent_id=?,position=? WHERE id=?',[...vals,req.params.id]);res.redirect('/admin/categories');});
app.post('/admin/categories/:id/delete',async(req,res)=>{await pool.execute('DELETE FROM categories WHERE id=?',[req.params.id]);res.redirect('/admin/categories');});
app.use('/admin/users',guard(['owner','admin']));
app.get('/admin/users',async(req,res)=>{const [users]=await pool.query('SELECT id,name,email,role FROM users ORDER BY name');await layout(req,res,'Staff accounts',`<a href="/admin">← Dashboard</a><h1>Staff accounts</h1><p>Editors manage documentation. Admins also manage editors and site settings. Owners manage all staff.</p>${form(req,'/admin/users',field('name','Name')+field('email','Email','','email')+field('password','Password (12+ characters)','','password')+`<label>Role<select name="role"><option>editor</option>${req.user.role==='owner'?'<option>admin</option><option>owner</option>':''}</select></label>`,'Create account')}<h2>Manage staff</h2>${users.map(u=>`<div class="panel"><h3>${e(u.name)} · ${e(u.role)}</h3><p>${e(u.email)}</p>${(req.user.role==='owner' || u.role==='editor' || u.id===req.user.id)?form(req,`/admin/users/${u.id}`,`<label>New password (leave blank to keep)<input name="password" type="password" minlength="12"></label>${req.user.role==='owner' && u.id!==req.user.id?`<label>Role<select name="role">${['editor','admin','owner'].map(r=>`<option ${r===u.role?'selected':''}>${r}</option>`).join('')}</select></label>`:''}`,'Update account'):''}</div>`).join('')}`);});
app.post('/admin/users',async(req,res)=>{const b=req.body;const allowed=req.user.role==='owner'?['editor','admin','owner']:['editor'];if(!allowed.includes(b.role) || !b.name || !b.email || String(b.password || '').length<12)return res.status(400).send('Invalid account details.');await pool.execute('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)',[b.name.slice(0,100),b.email.trim().toLowerCase().slice(0,190),await bcrypt.hash(b.password,12),b.role]);res.redirect('/admin/users');});
app.post('/admin/users/:id',async(req,res)=>{const [[u]]=await pool.execute('SELECT * FROM users WHERE id=?',[req.params.id]);if(!u)return res.sendStatus(404);if(req.user.role!=='owner' && u.role!=='editor' && u.id!==req.user.id)return res.sendStatus(403);if(req.body.password){if(req.body.password.length<12)return res.status(400).send('Password must have 12+ characters.');await pool.execute('UPDATE users SET password=? WHERE id=?',[await bcrypt.hash(req.body.password,12),u.id]);await pool.query('DELETE FROM sessions WHERE JSON_EXTRACT(data,\'$.userId\')=?',[u.id]);}if(req.user.role==='owner' && u.id!==req.user.id && ['editor','admin','owner'].includes(req.body.role))await pool.execute('UPDATE users SET role=? WHERE id=?',[req.body.role,u.id]);res.redirect('/admin/users');});
app.get('/admin/settings',guard(['owner','admin']),async(req,res)=>{const [rows]=await pool.query('SELECT * FROM settings');const s=Object.fromEntries(rows.map(r=>[r.setting_key,r.value]));await layout(req,res,'Settings',`<a href="/admin">← Dashboard</a><h1>Site settings</h1>${form(req,'/admin/settings',field('siteName','Site name',s.siteName || config.siteName)+field('description','Site description',s.description || 'Guides, answers, and documentation in one place.'))}`);});
app.post('/admin/settings',guard(['owner','admin']),async(req,res)=>{for(const key of ['siteName','description'])await pool.execute('REPLACE INTO settings(setting_key,value) VALUES(?,?)',[key,String(req.body[key] || '').slice(0,500)]);res.redirect('/admin/settings');});
app.use((req,res)=>layout(req,res,'Not found','<h1>Page not found</h1><a href="/">Back to documentation</a>',404));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);const message=err.code==='ER_DUP_ENTRY'?'That slug or email is already in use.':err.code==='ER_ROW_IS_REFERENCED_2'?'Move or delete child categories first.':err.code==='ER_NO_REFERENCED_ROW_2'?'The selected category no longer exists.':'The request could not be completed. Please try again.';res.status(err.code?.startsWith('ER_')?400:500).send(`<h1>${e(message)}</h1><a href="/admin">Return to dashboard</a>`);});
async function start(){await migrate();await pool.execute('DELETE FROM sessions WHERE expires<?',[Date.now()]);const server=app.listen(config.port || 3000,config.host || '0.0.0.0',()=>{console.log(`OnyxDocs listening on ${config.host || '0.0.0.0'}:${config.port || 3000}`);if(process.send)process.send({type:'ready'});});const cleanup=setInterval(()=>pool.execute('DELETE FROM sessions WHERE expires<?',[Date.now()]).catch(console.error),3600000);cleanup.unref();for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(cleanup);server.close(()=>pool.end().then(()=>process.exit(0)));});}
if(require.main===module)start().catch(err=>{console.error('OnyxDocs startup failed:',err.message);process.exitCode=1;pool.end();});
module.exports={app};
