import {signatureJSON,signatureSVG} from '../signature';
import {all,one,run,id,now,log} from './db';
import {ageAt,canManage,validateWaiver} from '../rules';
const fail=(message:string,status=400):never=>{throw Object.assign(Error(message),{status})};
const escape=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function clubWaiverState(u:any){return {clubWaiver:await one('SELECT * FROM club_waiver_versions ORDER BY version DESC LIMIT 1'),clubWaivers:await all('SELECT id,player_id,owner,player_name,version,signer,relationship,signed,date FROM player_waivers'+(canManage(u.role)?'':' WHERE owner=?')+' ORDER BY signed DESC',...(canManage(u.role)?[]:[u.id]))};}
export async function clubWaiverRoute(u:any,path:string,method:string,b:any){
 if(path==='club-waivers/publish'&&method==='POST'){
  if(u.role!=='admin')fail('Only administrators can publish club waivers.',403);
  const text=typeof b.text==='string'?b.text.trim():'';
  if(!text||text.length>50000||!Number.isSafeInteger(b.version)||b.version<0)fail('Enter the complete waiver text and current version.');
  const next=b.version+1;
  const result=await run('INSERT INTO club_waiver_versions(version,text,author,created) SELECT ?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM club_waiver_versions),0)=?',next,text,u.id,now(),b.version);
  if(!result.meta.changes)fail('Someone updated this waiver. Refresh and review the latest version.',409);
  await log(u.id,'Published club waiver',String(next));return {version:next};
 }
 if(path==='club-waivers/history'&&method==='GET'){
  if(!canManage(u.role))fail('Administrator or staff access is required.',403);
  return {versions:await all('SELECT * FROM club_waiver_versions ORDER BY version DESC')};
 }
 if(path==='club-waivers/sign'&&method==='POST'){
  if(!u.verified)fail('Verify your email before signing.',403);
  validateWaiver(b);if(b.agree!==true)fail('Please agree to the waiver.');
  const player=await one('SELECT * FROM players WHERE id=? AND owner=?',b.playerId,u.id);
  if(!player)fail('Player not found.',404);
  const today=now().slice(0,10);
  if(b.date!==today)fail('Confirm today’s date (UTC) for your electronic signature.');
  if(b.relationship==='Adult player'&&ageAt(player.dob,today)<18)fail('A parent or guardian must sign for a minor.');
  const template=await one('SELECT * FROM club_waiver_versions ORDER BY version DESC LIMIT 1');
  if(!template)fail('The club has not published a club waiver yet.');
  if(b.version!==template.version)fail('The waiver has changed. Refresh and review the latest version.',409);
  const signature=signatureJSON(b.signature);
  const wid=id();
  await run(`INSERT INTO player_waivers(id,player_id,owner,player_name,dob,text,version,signer,relationship,signed,date,signature) SELECT ?,?,?,?,?,text,version,?,?,?,?,? FROM club_waiver_versions WHERE version=? AND version=(SELECT MAX(version) FROM club_waiver_versions) ON CONFLICT(player_id,version) DO NOTHING`,wid,player.id,u.id,player.name,player.dob,b.signer.trim(),b.relationship,now(),b.date,signature,template.version);
  const saved=await one('SELECT id FROM player_waivers WHERE player_id=? AND version=?',player.id,template.version);
  if(!saved)fail('The waiver has changed. Refresh and review the latest version.',409);
  if(saved.id===wid)await log(u.id,'Signed club waiver',wid);
  return saved;
 }
 if(path.startsWith('club-waivers/document/')&&method==='GET'){
  const w=await one('SELECT * FROM player_waivers WHERE id=?'+(canManage(u.role)?'':' AND owner=?'),path.split('/')[2],...(canManage(u.role)?[]:[u.id]));
  if(!w)fail('Signed waiver not found.',404);
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>BSTC · Signed club waiver</title><style>body{font:16px/1.7 Arial;max-width:750px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;font:inherit}@media print{button{display:none}}</style></head><body><h1>BSTC · Signed club waiver</h1><p>Player: ${escape(w.player_name)}<br>Date of birth: ${escape(w.dob)}</p><pre>${escape(w.text)}</pre><hr>${signatureSVG(w.signature)}<p>Electronic signature: <b>${escape(w.signer)}</b><br>Relationship: ${escape(w.relationship)}<br>Confirmed date: ${escape(w.date)}<br>Recorded at (UTC): ${escape(w.signed)}<br>Version: ${w.version}<br>Record: ${escape(w.id)}</p><p>This club waiver does not create a registration or reserve a roster spot.</p><button onclick="window.print()">Print / save as PDF</button></body></html>`,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 fail('Not found.',404);
}
