import {CATALOGS,getSportsEvents,publicMeta,withCors} from "../../../../lib/stremio.js";

export const revalidate=30;
export const maxDuration=60;
export async function GET(_request,{params}){
  const {type,id}=await params;
  const catalogId=String(id||"").replace(/\.json$/i,"");
  if(type!=="tv"||!CATALOGS.some(x=>x.id===catalogId))return withCors(Response.json({metas:[]}));
  const origin="https://espn-live-sports-addon.vercel.app";
  const all=await getSportsEvents(origin);
  const state=catalogId==="espn-live-now"?"live":"upcoming";
  const events=all.filter(x=>x._state===state).sort((a,b)=>new Date(a._start||0)-new Date(b._start||0));
  return withCors(Response.json({metas:events.map(publicMeta),cacheMaxAge:30},{headers:{"Cache-Control":"public, s-maxage=30, stale-while-revalidate=120"}}));
}
export function OPTIONS(){return withCors(new Response(null,{status:204}));}
