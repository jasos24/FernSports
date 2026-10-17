import {getEventById,publicMeta,withCors} from "../../../../lib/stremio.js";

export const dynamic="force-dynamic";
export const maxDuration=30;
export async function GET(request,{params}){
  const {type,id}=await params;
  const event=type==="tv"?await getEventById(new URL(request.url).origin,decodeURIComponent(String(id||"").replace(/\.json$/i,""))):null;
  return withCors(event?Response.json({meta:publicMeta(event),cacheMaxAge:30}):Response.json({meta:null},{status:404}));
}
export function OPTIONS(){return withCors(new Response(null,{status:204}));}
