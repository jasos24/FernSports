import {SPORTS,SPORT_GROUPS} from "../../sports.js";

export function GET(request){
  const {origin}=new URL(request.url);
  return Response.json({sports:Object.entries(SPORTS).map(([league,sport])=>({league,...sport,poster:`${origin}/api/poster?league=${league}`})),groups:SPORT_GROUPS});
}
