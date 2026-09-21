import {env} from 'cloudflare:workers';
export const config=()=>env as any;
export const db=()=>{const d=config().DB;if(!d)throw Error('Database is unavailable. Please try again shortly.');return d;};
export const q=(sql:string,...args:any[])=>db().prepare(sql).bind(...args);
export const all=async(sql:string,...args:any[])=>(await q(sql,...args).all()).results as any[];
export const one=async(sql:string,...args:any[])=>await q(sql,...args).first() as any;
export const run=async(sql:string,...args:any[])=>await q(sql,...args).run();
export const id=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export const log=async(actor:string,action:string,target:string)=>run('INSERT INTO audit_logs VALUES(?,?,?,?,?)',id(),actor,action,target,now());
export async function mail(user:any,subject:string,body:string){const c=config();let status='Queued';if(c.RESEND_API_KEY&&c.EMAIL_FROM){try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${c.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:c.EMAIL_FROM,to:[user.email],subject,text:body})});status=r.ok?'Sent':'Failed';}catch{status='Failed';}}await run('INSERT INTO notifications VALUES(?,?,?,?,?,?)',id(),user.id,subject,body.replace(/([?&](?:verify|reset)=)[^\s]+/g,'$1[redacted]'),status,now());return status;}
