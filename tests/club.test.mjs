import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bstc-tests-'));
const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())database.exec(fs.readFileSync('drizzle/'+f,'utf8'));
function statement(sql,args=[]){return {bind(...a){return statement(sql,a)},async first(){return database.prepare(sql).get(...args)||null},async all(){return {results:database.prepare(sql).all(...args)}},async run(){const r=database.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}}
globalThis.__bstcEnv={DB:{prepare:statement,async batch(qs){database.exec('BEGIN');try{const a=[];for(const q of qs)a.push(await q.run());database.exec('COMMIT');return a}catch(e){database.exec('ROLLBACK');throw e}}}};
for(const f of ['rules','demo','server/db','server/auth','server/service','server/xlsx','server/settings','server/waivers']){let source=fs.readFileSync('lib/'+f+'.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.__bstcEnv;');source=source.replace(/(from\s+['"]|import\(['"])(\.\.?\/[^'"]+)(['"])/g,(_,a,b,c)=>a+b+'.mjs'+c);const target=path.join(dir,f+'.mjs');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
const {handle}=await import(pathToFileURL(path.join(dir,'server/service.mjs')));
const {password,session}=await import(pathToFileURL(path.join(dir,'server/auth.mjs')));
const {ageAt,validateWaiver,csvCell}=await import(pathToFileURL(path.join(dir,'rules.mjs')));
const today=new Date().toISOString().slice(0,10);
const sql=(s,...a)=>database.prepare(s).run(...a);
for(const [id,role]of [['parent','parent'],['other','parent'],['admin','admin'],['staff','staff']])sql('INSERT INTO users(id,email,name,password,verified,role,created) VALUES(?,?,?,?,?,?,?)',id,id+'@example.test','Test '+id,await password('a-secure-password-123'),1,role,today);
const cookies={};for(const id of ['parent','other','admin','staff'])cookies[id]=(await session(id)).split(';')[0];
async function call(actor,route,body,method=body?'POST':'GET'){return handle(new Request('https://club.test/api/'+route,{method,headers:{...(actor?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',origin:'https://club.test'}:{})},body:body?JSON.stringify(body):undefined}),route)}
let seasonId,playerId,rid;
test('login rejects wrong password and unverified users, accepts valid credentials',async()=>{await assert.rejects(call(null,'auth/login',{email:'parent@example.test',password:'wrong'}),/incorrect/);sql('UPDATE users SET verified=0 WHERE id=?','parent');await assert.rejects(call(null,'auth/login',{email:'parent@example.test',password:'a-secure-password-123'}),/verify/);sql('UPDATE users SET verified=1 WHERE id=?','parent');const r=await call(null,'auth/login',{email:'parent@example.test',password:'a-secure-password-123'});assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)});
test('anonymous and parent cannot manage seasons; staff cannot change roles',async()=>{await assert.rejects(call(null,'seasons',{}),/sign in/);await assert.rejects(call('parent','seasons',{}),/access is required/);await assert.rejects(call('staff','users/role',{id:'other',role:'admin'}),/Only administrators/)});
test('admin creates a season with validated capacity',async()=>{const s=await call('admin','seasons',{name:'Test Season',description:'Soccer',status:'Open',start:today,end:'2027-12-31',open:'2020-01-01',close:'2027-12-31',days:'Tuesday',time:'16:00–17:00',location:'Test field',price:45000,capacity:1,min_age:4,max_age:17,division:'U12',waiver:'Complete sample waiver',questions:'[{"label":"School","required":true}]'});seasonId=s.id;assert.ok(seasonId)});
test('parent creates player and other family cannot edit them',async()=>{const p=await call('parent','players',{name:'Test Player',dob:'2017-06-12',address:'Test address',phone:'5550000000',emergencyName:'Guardian Test',emergencyPhone:'5550000000'});playerId=p.id;await assert.rejects(call('other','players',{id:p.id,name:'Wrong',dob:'2017-06-12',address:'a',phone:'x',emergencyName:'x',emergencyPhone:'x'}),/not found/)});
const registration=()=>({seasonId,playerId,agree:true,signer:'Test Parent',relationship:'Parent',date:today,waiverVersion:1,answers:{School:'Test School'}});
test('registration rejects missing waiver and required answer',async()=>{await assert.rejects(call('parent','register',{...registration(),agree:false}),/waiver/);await assert.rejects(call('parent','register',{...registration(),answers:{}}),/School/)});
test('registration stores exact signed waiver and blocks duplicate',async()=>{const r=await call('parent','register',registration());rid=r.id;assert.equal(r.status,'Confirmed');const w=database.prepare('SELECT * FROM signed_waivers WHERE registration_id=?').get(rid);assert.equal(w.text,'Complete sample waiver');assert.equal(w.signer,'Test Parent');assert.throws(()=>sql('UPDATE signed_waivers SET text=? WHERE id=?','changed',w.id),/immutable/);await assert.rejects(call('parent','register',registration()),/already/)});
test('capacity is enforced and next player is waitlisted',async()=>{const p=await call('other','players',{name:'Second Player',dob:'2016-06-12',address:'Test',phone:'1',emergencyName:'Test Adult',emergencyPhone:'1'});const r=await call('other','register',{...registration(),playerId:p.id});assert.equal(r.status,'Waitlisted');assert.equal(database.prepare("SELECT count(*) n FROM registrations WHERE status='Confirmed'").get().n,1);await assert.rejects(call('admin','registrations/edit',{id:r.id,status:'Confirmed',answers:'{}'}),/capacity/)});
test('parents cannot read another family’s registration or export',async()=>{await assert.rejects(call('other','registrations/'+rid),/not found/);await assert.rejects(call('parent','export',{columns:['Player name']}),/access is required/);const d=await call('parent','bootstrap');assert.equal(d.registrations.length,1);assert.equal(d.users.length,0)});
test('offline payment API is disabled; signed Stripe events credit partial and final payments once',async()=>{await assert.rejects(call('admin','payments',{registrationId:rid,amount:10000,method:'Cash',requestId:'offline'}),/online-only/);await credit(rid,10000,'cs_partial');await credit(rid,10000,'cs_partial');let r=database.prepare('SELECT * FROM registrations WHERE id=?').get(rid);assert.equal(r.paid,10000);assert.equal(r.payment_status,'Partially Paid');await credit(rid,35000,'cs_final');r=database.prepare('SELECT * FROM registrations WHERE id=?').get(rid);assert.equal(r.paid,45000);assert.equal(r.payment_status,'Paid')});
test('checkout uses Stripe-hosted card collection and only server-calculated amounts',async()=>{const originalFetch=globalThis.fetch;globalThis.__bstcEnv.STRIPE_SECRET_KEY='sk_test_stub';let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.stripe.com/v1/checkout/sessions');const b=new URLSearchParams(options.body);assert.equal(b.get('ui_mode'),'hosted');assert.equal(b.get('line_items[0][price_data][unit_amount]'),String(database.prepare('SELECT amount-paid balance FROM registrations WHERE id=?').get(rid).balance));assert.ok(![...b.keys()].some(k=>/card|cvv|cvc/.test(k)));return Response.json({url:'https://checkout.stripe.com/c/pay/demo'});};try{sql('UPDATE registrations SET paid=0 WHERE id=?',rid);await assert.rejects(call('parent','checkout',{registrationId:rid,unexpected:'blocked'}),/only a registration ID/);assert.equal(calls,0);assert.deepEqual(await call('parent','checkout',{registrationId:rid}),{url:'https://checkout.stripe.com/c/pay/demo'});globalThis.fetch=async()=>Response.json({url:'https://untrusted.example/checkout'});await assert.rejects(call('parent','checkout',{registrationId:rid}),/Secure checkout is unavailable/);}finally{sql('UPDATE registrations SET paid=45000 WHERE id=?',rid);globalThis.fetch=originalFetch;}});
test('online refund calls the provider and preserves payment history',async()=>{const originalFetch=globalThis.fetch;globalThis.__bstcEnv.STRIPE_SECRET_KEY='sk_test_stub';globalThis.fetch=async(url,options)=>{if(String(url).includes('checkout/sessions/'))return Response.json({payment_intent:'pi_test'});if(String(url).endsWith('/refunds')){assert.match(options.body.toString(),/amount=5000/);return Response.json({id:'re_test',status:'succeeded'});}throw Error('Unexpected provider call');};try{await call('admin','refunds',{registrationId:rid,amount:5000,reference:'Requested by parent',requestId:'refund-one'});}finally{globalThis.fetch=originalFetch;}const r=database.prepare('SELECT * FROM registrations WHERE id=?').get(rid);assert.equal(r.paid,40000);assert.equal(database.prepare('SELECT count(*) n FROM payments WHERE registration_id=?').get(rid).n,2)});
test('internal notes are invisible to parents',async()=>{await call('admin','notes',{id:rid,text:'Private staff note'});const parent=await call('parent','registrations/'+rid);assert.equal(parent.notes,undefined);const admin=await call('admin','registrations/'+rid);assert.equal(admin.notes.length,1)});
test('CSV respects filters and excludes medical information; XLSX is a ZIP workbook',async()=>{const r=await call('admin','export',{ids:[rid],columns:['Registration ID','Player name','Medical conditions'],format:'csv'});const text=await r.text();assert.match(text,/Test Player/);assert.doesNotMatch(text,/Medical|Second Player/);const x=await call('admin','export',{ids:[rid],columns:['Player name','Amount paid'],format:'xlsx'});const bytes=new Uint8Array(await x.arrayBuffer());assert.equal(bytes[0],80);assert.equal(bytes[1],75);fs.writeFileSync('/tmp/bstc-test-export.xlsx',bytes)});
test('waiver-only signup consumes no capacity and can be completed later',async()=>{const p=await call('parent','players',{name:'Waiver Only Player',dob:'2018-06-12',address:'Test',phone:'1',emergencyName:'Test Adult',emergencyPhone:'1'});const waiver=await call('parent','register',{...registration(),playerId:p.id,waiverOnly:true});assert.equal(waiver.status,'Waiver only');assert.equal(database.prepare("SELECT count(*) n FROM registrations WHERE status='Confirmed'").get().n,1);assert.equal(database.prepare('SELECT count(*) n FROM payments WHERE registration_id=?').get(waiver.id).n,0);await assert.rejects(call('parent','checkout',{registrationId:waiver.id}),/not eligible/);await assert.rejects(call('other','complete-registration',{id:waiver.id}),/not found/);const waiting=await call('parent','complete-registration',{id:waiver.id});assert.equal(waiting.status,'Waitlisted');await call('admin','registrations/cancel',{id:rid});const complete=await call('parent','complete-registration',{id:waiver.id});assert.equal(complete.status,'Confirmed');assert.equal(database.prepare('SELECT count(*) n FROM signed_waivers WHERE registration_id=?').get(waiver.id).n,1);assert.ok(database.prepare("SELECT count(*) n FROM notifications WHERE subject='A BSTC soccer spot has opened'").get().n>0)});
test('deleting a registered season archives it and preserves signatures',async()=>{await call('admin','seasons/delete',{id:seasonId});assert.equal(database.prepare('SELECT archived FROM seasons WHERE id=?').get(seasonId).archived,1);assert.equal(database.prepare('SELECT count(*) n FROM signed_waivers').get().n,3)});
test('age cutoff, signature validation, and CSV formula-injection protection',()=>{assert.equal(ageAt('2017-09-15','2026-09-14'),8);assert.equal(ageAt('2017-09-15','2026-09-15'),9);assert.throws(()=>validateWaiver({agree:true,signer:'One',relationship:'Parent',date:today}));assert.equal(csvCell('=1+1'),'"\'=1+1"')});
let webhookSource=fs.readFileSync('app/api/stripe/webhook/route.ts','utf8').replaceAll("@/lib/server/db","./server/db.mjs").replaceAll("@/lib/server/settings","./server/settings.mjs");fs.writeFileSync(path.join(dir,'webhook.mjs'),ts.transpileModule(webhookSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {POST:webhook}=await import(pathToFileURL(path.join(dir,'webhook.mjs')));
test('Stripe webhook rejects forged signatures and credits valid events exactly once',async()=>{globalThis.__bstcEnv.STRIPE_WEBHOOK_SECRET='test-signature-secret';const raw=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_test_one',metadata:{registration_id:rid},payment_status:'paid',currency:'usd',amount_total:5000}}});const t=String(Math.floor(Date.now()/1000));const forged=await webhook(new Request('https://club.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':'t='+t+',v1=wrong'},body:raw}));assert.equal(forged.status,400);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-signature-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');const before=database.prepare('SELECT paid FROM registrations WHERE id=?').get(rid).paid;for(let i=0;i<2;i++){const r=await webhook(new Request('https://club.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw}));assert.equal(r.status,200)}assert.equal(database.prepare('SELECT paid FROM registrations WHERE id=?').get(rid).paid,before+5000)});
test('CSRF rejects cross-origin administrative writes',async()=>{await assert.rejects(handle(new Request('https://club.test/api/profile',{method:'POST',headers:{cookie:cookies.admin,origin:'https://attacker.test','Content-Type':'application/json'},body:JSON.stringify({name:'Wrong'})}),'profile'),/origin/)});

async function credit(registrationId,amount,sessionId){globalThis.__bstcEnv.STRIPE_WEBHOOK_SECRET='test-signature-secret';const raw=JSON.stringify({type:'checkout.session.completed',data:{object:{id:sessionId,metadata:{registration_id:registrationId},payment_status:'paid',currency:'usd',amount_total:amount}}});const t=String(Math.floor(Date.now()/1000));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-signature-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');const response=await webhook(new Request('https://club.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw}));assert.equal(response.status,200);}
const {settingsView,stripeConfig,charges}=await import(pathToFileURL(path.join(dir,'server/settings.mjs')));
test('Stripe settings encrypt credentials and never return plaintext secrets',async()=>{globalThis.__bstcEnv.AUTH_SECRET='a-secure-test-encryption-key-at-least-32-characters';const payload={orgName:'BSTC Test',contactEmail:'club@example.test',contactPhone:'123',processingFeePercent:2.9,processingFeeFixed:0.30,taxPercent:5,stripeSecretKey:'sk_test_keep_this_private',stripeWebhookSecret:'whsec_keep_this_private',stripePublishableKey:'pk_test_public'};await assert.rejects(call('parent','settings',payload),/access is required/);await call('admin','settings',payload);const saved=database.prepare("SELECT value FROM settings WHERE key='stripeSecretKey'").get().value;assert.ok(saved.startsWith('v1.'));assert.ok(!saved.includes('sk_test'));const v=await settingsView();assert.equal(v.stripeConfigured,true);assert.ok(!JSON.stringify(v).includes('sk_test_keep_this_private'));assert.ok(!JSON.stringify(v).includes('whsec_keep_this_private'));assert.equal((await stripeConfig()).STRIPE_SECRET_KEY,'sk_test_keep_this_private');const computed=charges(10000,1000,{processingFeePercent:2.9,processingFeeFixed:0.30,taxPercent:5});assert.deepEqual(computed,{price:10000,discount:1000,fee:291,tax:450,total:9741});assert.equal(charges(10000,10000,payload).total,0);});
test('fee waivers require an administrator and record an audit note',async()=>{await assert.rejects(call('staff','waive-fee',{id:rid,reason:'Scholarship'}),/Only administrators/);await call('admin','waive-fee',{id:rid,reason:'Scholarship'});assert.equal(database.prepare('SELECT payment_status FROM registrations WHERE id=?').get(rid).payment_status,'Waived');await assert.rejects(call('parent','checkout',{registrationId:rid}),/not eligible/)});

test('only admins can publish waivers; old signatures stay exact and stale edits fail',async()=>{const before=database.prepare('SELECT * FROM signed_waivers WHERE registration_id=?').get(rid);const season=database.prepare('SELECT * FROM seasons WHERE id=?').get(seasonId);await assert.rejects(call('parent','waivers/save',{seasonId,text:'Unauthorized edit',version:season.version}),/access is required/);await assert.rejects(call('staff','waivers/save',{seasonId,text:'Unauthorized edit',version:season.version}),/Only administrators/);const result=await call('admin','waivers/save',{seasonId,text:'New administrator-approved participation waiver text.',version:season.version});assert.equal(result.version,season.version+1);const after=database.prepare('SELECT * FROM signed_waivers WHERE registration_id=?').get(rid);assert.deepEqual(after,before);const h=await call('admin','waivers/history/'+seasonId);assert.equal(h.versions.length,2);assert.equal(h.versions[1].text,season.waiver);await assert.rejects(call('admin','waivers/save',{seasonId,text:'Stale update',version:season.version}),/updated this waiver/);});


test('failed verification delivery can be retried without replacing the account',async()=>{
 const originalFetch=globalThis.fetch;const c=globalThis.__bstcEnv;
 c.RESEND_API_KEY='test-email-provider';c.EMAIL_FROM='BSTC <club@example.test>';
 const email='retry@example.test',pass='retry-password-123';let delivered;
 try{
  globalThis.fetch=async()=>new Response('',{status:503});
  await assert.rejects(call(null,'auth/signup',{email,name:'Retry Parent',password:pass}),/account was saved/);
  const saved=database.prepare('SELECT * FROM users WHERE email=?').get(email);
  assert.equal(saved.verified,0);
  globalThis.fetch=async(_url,options)=>{delivered=JSON.parse(options.body);return Response.json({id:'email-test'});};
  await call(null,'auth/resend',{email,password:'wrong-password'});assert.equal(delivered,undefined);
  await call(null,'auth/resend',{email,password:pass});
  const token=new URL(delivered.text.match(/https:\/\/\S+/)[0]).searchParams.get('verify');
  await call(null,'auth/verify',{token});
  assert.equal(database.prepare('SELECT verified FROM users WHERE id=?').get(saved.id).verified,1);
  assert.match((await call(null,'auth/login',{email,password:pass})).headers.get('set-cookie'),/HttpOnly/);
  await assert.rejects(call(null,'auth/verify',{token}),/invalid or has expired/);
  assert.ok(!JSON.stringify(database.prepare('SELECT body FROM notifications WHERE user_id=?').all(saved.id)).includes(token));
 }finally{globalThis.fetch=originalFetch;delete c.RESEND_API_KEY;delete c.EMAIL_FROM;}
});

test('password reset invalidates previous sessions and every outstanding reset link',async()=>{
 const originalFetch=globalThis.fetch;const c=globalThis.__bstcEnv;const messages=[];
 c.RESEND_API_KEY='test-email-provider';c.EMAIL_FROM='BSTC <club@example.test>';
 try{
  globalThis.fetch=async(_url,options)=>{messages.push(JSON.parse(options.body));return Response.json({id:'email-test'});};
  for(let i=0;i<2;i++)await call(null,'auth/forgot',{email:'retry@example.test'});
  const tokens=messages.map(m=>new URL(m.text.match(/https:\/\/\S+/)[0]).searchParams.get('reset'));
  await call(null,'auth/reset',{token:tokens[1],password:'changed-password-456'});
  await assert.rejects(call(null,'auth/reset',{token:tokens[0],password:'stale-password-456'}),/invalid or has expired/);
  const uid=database.prepare('SELECT id FROM users WHERE email=?').get('retry@example.test').id;
  assert.equal(database.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(uid).n,0);
  await assert.rejects(call(null,'auth/login',{email:'retry@example.test',password:'retry-password-123'}),/incorrect/);
  assert.equal((await call(null,'auth/login',{email:'retry@example.test',password:'changed-password-456'})).status,200);
 }finally{globalThis.fetch=originalFetch;delete c.RESEND_API_KEY;delete c.EMAIL_FROM;}
});

test('reset requires a configured sender and failed delivery does not leave usable tokens',async()=>{
 const originalFetch=globalThis.fetch;const c=globalThis.__bstcEnv;c.RESEND_API_KEY='test-email-provider';
 try{
  await assert.rejects(call(null,'auth/forgot',{email:'retry@example.test'}),/not connected/);
  c.EMAIL_FROM='BSTC <club@example.test>';globalThis.fetch=async()=>new Response('',{status:503});
  const result=await call(null,'auth/forgot',{email:'retry@example.test'});
  assert.doesNotMatch(result.message,/has been sent/);
  const uid=database.prepare('SELECT id FROM users WHERE email=?').get('retry@example.test').id;
  assert.equal(database.prepare("SELECT count(*) n FROM tokens WHERE user_id=? AND kind='reset'").get(uid).n,0);
 }finally{globalThis.fetch=originalFetch;delete c.RESEND_API_KEY;delete c.EMAIL_FROM;}
});


test('administrator bootstrap requires the configured identity and preserves existing roles',async()=>{
 const {user}=await import(pathToFileURL(path.join(dir,'server/auth.mjs')));
 const c=globalThis.__bstcEnv;
 const request=email=>new Request('https://club.test',{headers:{'oai-authenticated-user-email':email}});
 try{
  delete c.ADMIN_EMAIL;assert.equal(await user(request('owner@example.test')),null);
  c.ADMIN_EMAIL='owner@example.test';assert.equal(await user(request('stranger@example.test')),null);
  const [first,second]=await Promise.all([user(request('OWNER@example.test')),user(request('owner@example.test'))]);
  assert.equal(first.role,'admin');assert.equal(first.verified,1);assert.equal(second.id,first.id);
  assert.equal(database.prepare('SELECT count(*) n FROM users WHERE email=?').get('owner@example.test').n,1);
  sql('UPDATE users SET role=? WHERE id=?','parent',first.id);
  assert.equal((await user(request('owner@example.test'))).role,'parent');
 }finally{delete c.ADMIN_EMAIL;}
});

test('role changes reject missing or unverified accounts and protect self access',async()=>{
 await assert.rejects(call('admin','users/role',{id:'missing-user',role:'admin'}),/Account not found/);
 await assert.rejects(call('admin','users/role',{id:'admin',role:'parent'}),/own role/);
 sql('UPDATE users SET verified=0 WHERE id=?','other');
 try{for(const role of ['staff','admin'])await assert.rejects(call('admin','users/role',{id:'other',role}),/verify its email/);}
 finally{sql('UPDATE users SET verified=1 WHERE id=?','other');}
 await call('admin','users/role',{id:'other',role:'staff'});
 assert.equal(database.prepare('SELECT role FROM users WHERE id=?').get('other').role,'staff');
 await call('admin','users/role',{id:'other',role:'parent'});
});

test('parent dashboard and documents isolate family data',async()=>{
 const own=await call('parent','bootstrap'),other=await call('other','bootstrap');
 assert.ok(own.players.length>0);assert.ok(own.players.every(p=>p.owner==='parent'));assert.ok(other.players.every(p=>p.owner==='other'));assert.ok(!other.registrations.some(r=>r.id===rid));
 assert.equal(own.users.length,0);assert.equal(own.logs.length,0);assert.equal(own.settings,undefined);
 for(const path of ['waiver/','receipt/'])await assert.rejects(call('other',path+rid),/not found/);
 for(const path of ['waiver/','receipt/'])assert.equal((await call('parent',path+rid)).status,200);
});

test('email readiness requires both API key and sender address',async()=>{
 const c=globalThis.__bstcEnv;c.RESEND_API_KEY='test-only-key';
 try{
  delete c.EMAIL_FROM;assert.equal((await call('admin','bootstrap')).integrations.Email,false);
  c.EMAIL_FROM='BSTC <club@example.test>';assert.equal((await call('admin','bootstrap')).integrations.Email,true);
 }finally{delete c.RESEND_API_KEY;delete c.EMAIL_FROM;}
});
