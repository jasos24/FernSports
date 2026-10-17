import {buildEpgEvents,fetchFlixSourceStreams,withCors} from "../../../lib/stremio.js";
import {getFlixEpgSnapshot} from "../../../lib/flix-epg.js";

export const dynamic="force-dynamic";
export const maxDuration=60;

export async function GET(request){
  const origin=new URL(request.url).origin;
  try{
    const snapshot=await getFlixEpgSnapshot({waitForAll:true});
    const events=buildEpgEvents(origin,snapshot,[],Date.now());
    const counts={live:0,upcoming:0};
    const byLeague={};
    for(const event of events){
      counts[event._state]=(counts[event._state]||0)+1;
      byLeague[event._league]=(byLeague[event._league]||0)+1;
    }
    const samples=new Map();
    for(const event of events){
      for(const id of event._sourceIds||[]){
        const provider=id.match(/^flixlivetvtest:(dream|strong|trex):/i)?.[1]?.toLowerCase();
        if(provider&&!samples.has(provider))samples.set(provider,{provider,event:event.name,id});
      }
    }
    const streams=await Promise.all([...samples.values()].map(async sample=>{
      try{
        const resolved=await fetchFlixSourceStreams(sample.id);
        return {provider:sample.provider,event:sample.event,ok:true,streamCount:resolved.length,streamNames:resolved.slice(0,5).map(stream=>stream.name||stream.title||"Unnamed stream")};
      }catch(error){
        return {provider:sample.provider,event:sample.event,ok:false,error:error?.name||"StreamLookupError"};
      }
    }));
    const sources=snapshot.sourceHealth||[];
    const healthy=sources.filter(source=>source.ok).length;
    return withCors(Response.json({
      checkedAt:new Date().toISOString(),timeZone:"Australia/Sydney",
      status:healthy?"ok":"upstream_unavailable",
      sourceSummary:{healthy,total:sources.length},sources,
      events:{total:events.length,...counts,byLeague},
      streamChecks:streams,
    },{headers:{"Cache-Control":"no-store"}}));
  }catch(error){
    return withCors(Response.json({status:"error",checkedAt:new Date().toISOString(),error:error?.name||"EPGCheckError"},{status:502,headers:{"Cache-Control":"no-store"}}));
  }
}

export function OPTIONS(){return withCors(new Response(null,{status:204}));}
