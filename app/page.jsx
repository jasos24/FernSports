import {SPORTS,SPORT_GROUPS} from "./sports.js";

const familyName={basketball:"Quarter scoreboard",football:"Quarter scoreboard",soccer:"Match scoreboard",afl:"Quarter scoreboard",nrl:"Half scoreboard",rugby:"Half scoreboard",quarters:"Period scoreboard",hockey:"Hockey scoreboard",baseball:"Inning scoreboard",sets:"Set scoreboard",cricket:"Innings scoreboard",tennis:"Tennis match card",leaderboard:"Leaderboard",race:"Race classification",combat:"Fight card",tournament:"Tournament / event"};
const familyView={leaderboard:"leaderboard",race:"leaderboard",combat:"combat",tournament:"tournament"};
function posterHref(league,view){return `/api/poster?league=${league}${view?`&view=${view}`:""}`;}

export default function Home(){
  return <main style={{maxWidth:1120,margin:"0 auto",padding:"34px 20px 64px"}}>
    <p style={{color:"#42edbc",letterSpacing:4,fontWeight:800}}>ESPN • LIVE SPORT</p>
    <h1 style={{fontSize:"clamp(34px,7vw,66px)",margin:"12px 0"}}>Event posters</h1>
    <p style={{color:"#bac7d4",fontSize:18,lineHeight:1.6,maxWidth:850}}>One portrait style, with the score panel adapted to each sport: periods, innings, sets, leaderboards or fight cards. Poster data is requested from ESPN when the link opens.</p>
    {SPORT_GROUPS.map(group=><section key={group.name} style={{marginTop:34}}>
      <h2 style={{fontSize:22,letterSpacing:1}}>{group.name}</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginTop:14}}>{group.leagues.map((key,i)=>{
        const sport=SPORTS[key],view=group.name==="Tournament / event"?"tournament":familyView[sport.family];
        return <a key={`${key}-${i}`} href={posterHref(key,view)} style={{border:"1px solid #263c50",borderRadius:14,padding:"16px 18px",background:"#0c1b2b",color:"white",textDecoration:"none",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}><span><b style={{display:"block",letterSpacing:1}}>{sport.label}</b><small style={{display:"block",color:"#8294a6",marginTop:6}}>{familyName[sport.family]}</small></span><span style={{color:"#42edbc",fontWeight:800}}>↗</span></a>;
      })}</div>
    </section>)}
    <p style={{marginTop:32,color:"#8294a6",fontSize:13}}>Optional query parameters: <code>dates=YYYYMMDD</code> selects a date, <code>event=ESPN_ID</code> selects an event, and <code>view=tournament</code> or <code>view=leaderboard</code> selects a poster layout.</p>
  </main>;
}
