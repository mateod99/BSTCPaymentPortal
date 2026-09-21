import {handle} from '@/lib/server/service';
export const dynamic='force-dynamic';
async function route(req:Request,{params}:any){try{const {path}=await params;const result=await handle(req,path.join('/'));const response=result instanceof Response?result:Response.json(result);response.headers.set('Cache-Control','no-store');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','same-origin');return response;}catch(e:any){return Response.json({error:e.status?e.message:'Unable to complete this request. Please check your information and try again.'},{status:e.status||500,headers:{'Cache-Control':'no-store'}});}}
export const GET=route;export const POST=route;
