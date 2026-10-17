import {getEventStreams,withCors} from "../../../../lib/stremio.js";

export const revalidate=15;
export const maxDuration=60;
export async function GET(_request,{params}){
  const {type,id}=await params;
  const streams=type==="tv"?await getEventStreams(decodeURIComponent(String(id||"").replace(/\.json$/i,""))):[];
  return withCors(Response.json({streams,cacheMaxAge:15},{headers:{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=30"}}));
}
export function OPTIONS(){return withCors(new Response(null,{status:204}));}
