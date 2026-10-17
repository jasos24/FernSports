import {CATALOGS,withCors} from "../../lib/stremio.js";

export const dynamic="force-dynamic";
export const maxDuration=60;
export function GET(){
  return withCors(Response.json({
    id:"com.jasonsavino.espn-live-sports",
    version:"1.0.0",
    name:"ESPN Live Sports",
    description:"ESPN schedules and live scores matched to available Flix sports broadcasts.",
    logo:"https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-sports.png",
    types:["tv"],
    idPrefixes:["epg:","espn:"],
    resources:["catalog","meta","stream"],
    catalogs:CATALOGS,
    behaviorHints:{adult:false,p2p:false}
  }));
}
export function OPTIONS(){return withCors(new Response(null,{status:204}));}
