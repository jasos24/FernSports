import {SPORTS} from "../app/sports.js";
import {epgStartTime,epgStatus,getFlixEpgSnapshot} from "./flix-epg.js";
import {parseBoxingSchedule} from "./boxing.js";

const ESPN="https://site.api.espn.com/apis/site/v2/sports";
const FLIX="https://flixnest.app/flix-streams/u/3wn3lkvmvbnq";
// Keep the in-process data snapshot shorter than the 30s catalog freshness
// window, so catalog refreshes don't routinely return stale scores.
const CACHE_MS=15_000;
const cache=new Map();
// Flix-Streams exposes sport-filtered catalogs through its Stremio `genre`
// extra. Use those filters so the 100-item default catalog cap cannot hide a
// matching event behind unrelated sports.
const FLIX_GENRE={
  atp:"Tennis",wta:"Tennis",
  nba:"Basketball",wnba:"Basketball",nbl:"Basketball",ncaam:"Basketball",ncaaw:"Basketball",
  nfl:"American Football",ncaaf:"American Football",
  football:"Soccer",menscollegesoccer:"Soccer",womenscollegesoccer:"Soccer",
  afl:"Aussie Rules",nrl:"Rugby League",rugby:"Rugby Union",
  nhl:"Ice Hockey",menscollegehockey:"Ice Hockey",womenscollegehockey:"Ice Hockey",
  mlb:"Baseball",wbc:"Baseball",collegebaseball:"Baseball",softball:"Baseball",
  cricket:"Cricket",pga:"Golf",f1:"Formula 1",nascar:"Motorsport",indycar:"Motorsport",
  ufc:"MMA",boxing:"Boxing",
};
// Flixstreams has no dependable college-sports coverage for this add-on.
// Keep ESPN's broader sport map intact for poster generation, but omit these
// leagues from Stremio catalogs and reject old/direct IDs for them.
const ADDON_EXCLUDED_LEAGUES=new Set([
  "ncaam","ncaaw","ncaaf",
  "menscollegesoccer","womenscollegesoccer",
  "menscollegehockey","womenscollegehockey",
  "collegebaseball","softball",
  "menscollegelacrosse","womenscollegelacrosse",
  "menscollegevolleyball","womenscollegevolleyball",
]);

function cached(key,loader){
  const item=cache.get(key);
  if(item&&item.until>Date.now())return item.value;
  const value=loader();
  cache.set(key,{value,until:Date.now()+CACHE_MS});
  return value;
}
function sydneyDate(d=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));
  return `${p.year}${p.month}${p.day}`;
}
function competitionList(data){
  const out=[];
  for(const event of data?.events||[]){
    const comps=(event.groupings||[]).flatMap(g=>g.competitions||[]);
    for(const competition of comps.length?comps:(event.competitions||[]))out.push({event,competition});
  }
  return out;
}
async function json(url,ms=15_000){
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 Stremio Sports Poster"},cache:"no-store",signal:AbortSignal.timeout(ms)});
  if(!r.ok)throw new Error(`Upstream ${r.status}`);
  return r.json();
}
async function mapLimit(values,limit,fn){
  const out=new Array(values.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(cursor<values.length){const i=cursor++;try{out[i]=await fn(values[i],i)}catch{out[i]=null}}}));
  return out;
}
function state(c){
  const t=c?.status?.type||{};
  if(t.completed||t.state==="post"||/FINAL|COMPLETE/i.test(t.name||""))return "finished";
  if(t.state==="in"||/IN_PROGRESS|LIVE/i.test(t.name||""))return "live";
  return "upcoming";
}
function eventId(event,competition){return String(competition?.id||event?.id||"");}
function posterFor(origin,league,date,id){
  // Rotate the image URL at the catalog refresh cadence so Stremio won't keep
  // a cached PNG with an old score for five minutes.
  return `${origin}/api/poster?league=${encodeURIComponent(league)}&dates=${date}&event=${encodeURIComponent(id)}&v=${Math.floor(Date.now()/30_000)}`;
}
function eventMeta(origin,league,sport,date,event,competition){
  const id=eventId(event,competition), competitors=competition?.competitors||[];
  const names=competitors.map(c=>c.team?.displayName||c.athlete?.displayName||c.athlete?.fullName).filter(Boolean);
  const start=competition?.date||event?.date;
  const eventDate=start?sydneyDate(new Date(start)):date;
  const score=competitors.length>1?competitors.map(c=>`${c.team?.shortDisplayName||c.athlete?.shortName||c.athlete?.displayName||""} ${c.score??""}`.trim()).join(" · "):"";
  const networks=[...(competition?.broadcasts||[]).flatMap(x=>x.names||[]),...(competition?.geoBroadcasts||[]).map(x=>x.media?.shortName||"")].filter(Boolean);
  const phase=competition?.status?.type?.shortDetail||competition?.status?.type?.detail||"Scheduled";
  const summary=[sport.label,phase,start?new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(start))+" AEDT":"",score,names.length?names.join(" vs "):"",networks.length?`Broadcast: ${[...new Set(networks)].join(", ")}`:""].filter(Boolean).join("\n");
  // Keep the ESPN scoreboard query date in the metadata ID. ESPN can return
  // a next-day event while its event timestamp is still the prior UTC date;
  // using a Sydney-formatted date here makes later poster/meta lookups miss.
  const stremioId=`espn:${league}:${date}:${id}`;
  const poster=posterFor(origin,league,date,id);
  return {id:stremioId,type:"tv",name:event?.name||event?.shortName||sport.label,poster,background:poster,posterShape:"poster",description:summary,genres:["Live Sports",sport.group,sport.label],behaviorHints:{defaultVideoId:stremioId},_league:league,_date:date,_eventDate:eventDate,_eventId:id,_start:start,_state:state(competition),_competition:competition,_event:event};
}
function scoreText(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();}
const STOP=new Set("a an at the of on in live now vs versus v fc cf sc ac afc cfc club team league championship tournament game match round regular season final finals official espn sports sport tv 2026 2025 2024".split(" "));
function tokens(value){return scoreText(value).split(/\s+/).filter(x=>x.length>2&&!STOP.has(x));}
function eventText(meta){return [meta.name,meta.description,...(meta.genres||[])].join(" ");}
function matchScore(event,source){
  const sourceText=scoreText(eventText(source));
  const competitors=event._competition?.competitors||[];
  const names=competitors.map(c=>{
    const team=c.team,athlete=c.athlete;
    return [team?.displayName,team?.shortDisplayName,team?.name,team?.nickname,team?.abbreviation,athlete?.displayName,athlete?.fullName,athlete?.shortName].filter(Boolean);
  }).filter(values=>values.length);
  // Leaderboard/race cards are tournaments, not head-to-head fixtures. Match
  // the ESPN event name against the Flix event/tournament title instead.
  if(TOURNAMENT_LEAGUES.has(event._league)){
    const a=new Set(tokens(event.name)),b=new Set(tokens(eventText(source)));
    const common=[...a].filter(token=>b.has(token)).length;
    const ratio=common/Math.max(1,Math.min(a.size,b.size));
    return ratio>=0.5?Math.round(ratio*120):0;
  }
  if(names.length>=2){
    const includes=(aliases)=>aliases.some(name=>{
      const n=scoreText(name),parts=tokens(name);
      return n.length>2&&(sourceText.includes(n)||parts.length>0&&parts.filter(t=>sourceText.includes(t)).length>=Math.min(2,parts.length));
    });
    const matched=names.filter(includes).length;
    if(matched>=2)return 180+matched*12;
    // Don't let a shared tournament/league name turn one broadcast into a
    // false match for every fixture in the draw.
    return 0;
  }
  const a=tokens(event.name), b=new Set(tokens(eventText(source)));
  const common=a.filter(t=>b.has(t));
  const ratio=common.length/Math.max(1,a.length);
  const genres=scoreText((source.genres||[]).join(" "));
  const family=scoreText(event.genres?.slice(1).join(" ")||"");
  const sportMatch=family&&genres.includes(family);
  return (ratio>=0.6?Math.round(ratio*100):0)+(sportMatch?12:0);
}
function sourceGenre(meta){return scoreText([...(meta.genres||[]),meta.name,meta.description].join(" "));}
function isSportsSource(meta){
  const g=sourceGenre(meta);
  return /sports|soccer|football|basketball|hockey|baseball|tennis|formula 1|motorsport|mma|boxing|wrestling|rugby|cricket|golf|ufc|nfl|nba|mlb|nhl|f1|nascar|indycar/.test(g);
}
async function fetchFlixCatalog(genre=null){
  const key=genre||"all";
  return cached(`flix-catalog:${key}`,async()=>{
    const path=genre
      ? `${FLIX}/catalog/tv/essential-live-events/genre=${encodeURIComponent(genre)}.json`
      : `${FLIX}/catalog/tv/essential-live-events.json`;
    const d=await json(path,18_000);
    return (d.metas||[]).filter(isSportsSource);
  });
}
async function catalogsForEvents(events){
  const genres=[...new Set(events.map(event=>FLIX_GENRE[event._league]).filter(Boolean))];
  const entries=await Promise.all(genres.map(async genre=>{
    try{return [genre,await fetchFlixCatalog(genre)];}catch{return [genre,[]];}
  }));
  let fallback=[];
  try{fallback=await fetchFlixCatalog();}catch{}
  return {byGenre:Object.fromEntries(entries),fallback};
}
function bestSource(event,catalogs){
  const preferred=FLIX_GENRE[event._league]?catalogs.byGenre[FLIX_GENRE[event._league]]||[]:[];
  const find=list=>list.map(meta=>({meta,score:matchScore(event,meta)})).sort((a,b)=>b.score-a.score)[0];
  let best=find(preferred);
  if(!best||best.score<70)best=find(catalogs.fallback);
  return best&&best.score>=70?best:null;
}
function bestEpgSource(event,channels,now=Date.now()){
  const sport=SPORTS[event._league];
  const eventStart=new Date(event._start||0).getTime();
  if(!sport||!Number.isFinite(eventStart))return null;
  let best=null;
  for(const channel of channels){
    const advertisedStart=epgStartTime(channel.label,eventStart);
    for(const programme of channel.programmes||[]){
      const source={name:channel.label,description:[programme.title,programme.description].filter(Boolean).join(" "),genres:["Live TV","Sports",sport.group]};
      const lexical=matchScore(event,source);
      if(lexical<55)continue;
      // NEXT channel names carry the event's local wall-clock start. XMLTV's
      // programme block describes the channel slot and supplies its stop, so
      // use the advertised start rather than the often-earlier slot start.
      const start=Number.isFinite(advertisedStart)?advertisedStart:programme.start;
      if(programme.stop<=start)continue;
      const interval={start,stop:programme.stop};
      const live=epgStatus(interval,now)==="live";
      const delta=Math.abs(start-eventStart);
      // A programme may start earlier than the ESPN fixture (coverage begins
      // before kick-off). If it is on-air now, its EPG interval is authoritative.
      if(delta>3*60*60_000&&!live)continue;
      const score=lexical+(live?60:delta<=90*60_000?20:8);
      if(!best||score>best.score)best={score,start,stop:programme.stop,status:epgStatus(interval,now),meta:{id:`flixlivetvtest:dream:${channel.id}`,name:channel.label},programme};
    }
  }
  return best;
}
function inferEpgLeague(text){
  const s=scoreText(text);
  if(/\b(?:ufc|mma|mixed martial arts)\b/.test(s))return "ufc";
  if(/\bboxing\b/.test(s))return "boxing";
  if(/\b(?:formula 1|formula one|f1)\b/.test(s))return "f1";
  if(/\bnascar\b/.test(s))return "nascar";
  if(/\bindycar\b/.test(s))return "indycar";
  if(/\bwta\b|wuhan open|mallorca womens championships|roveretopen|lisboa belem open/.test(s))return "wta";
  if(/\batp\b|\btennis\b|roland garros|wimbledon|australian open|shanghai masters|medvedev|tsitsipas|alcaraz|sinner|djokovic|swiatek|gauff|sabalenka/.test(s))return "atp";
  if(/\b(?:pga|lpga|golf|liv golf|dp world tour)\b/.test(s))return "pga";
  if(/\b(?:cricket|t20|test match|odi|world championship of legends)\b/.test(s))return "cricket";
  if(/\b(?:rugby league|nrl)\b/.test(s))return "nrl";
  if(/\b(?:rugby union|six nations|rugby championship|champions cup)\b/.test(s))return "rugby";
  if(/\b(?:nhl|ice hockey)\b/.test(s))return "nhl";
  if(/\b(?:nbl|wnba)\b/.test(s))return s.includes("wnba")?"wnba":"nbl";
  if(/\bnba\b/.test(s))return "nba";
  // A Flix channel may be tagged as generic soccer/PPV even when its event
  // title is an NBA fixture. Resolve known NBA team matchups before that tag.
  const nbaTeams=["hawks","celtics","nets","knicks","76ers","raptors","bulls","cavaliers","pistons","pacers","bucks","hornets","heat","magic","wizards","nuggets","timberwolves","thunder","trail blazers","jazz","warriors","clippers","lakers","suns","kings","mavericks","rockets","grizzlies","pelicans","spurs"];
  const hasMatchup=/\b(?:vs\.?|versus|v\.?|at)\b/i.test(String(text||""));
  if(hasMatchup&&nbaTeams.filter(team=>new RegExp(`\\b${team}\\b`).test(s)).length>=2)return "nba";
  if(/\bnfl\b|american football/.test(s))return "nfl";
  if(/\bafl\b|australian football|aussie rules/.test(s))return "afl";
  if(/\bmlb\b|baseball/.test(s))return "mlb";
  if(/\bfootball\b|soccer|premier league|uefa champions league|europa league|la liga|serie a|bundesliga/.test(s))return "football";
  return null;
}
const TOURNAMENT_LEAGUES=new Set(["atp","wta","pga","f1","nascar","indycar"]);
const EVENT_DURATION={atp:4,wta:4,pga:8,f1:6,nascar:5,indycar:5,football:3,nba:3,wnba:3,nbl:3,nfl:4,afl:4,nrl:3,rugby:3,nhl:4,mlb:4,cricket:8,ufc:6,boxing:8};
function epgLabelParts(channelLabel){
  return String(channelLabel||"").replace(/^next\s*\|/i,"").split("|").map(value=>value.trim()).filter(value=>{
    if(!value||/^20\d{2}-\d\d-\d\d$/.test(value)||/^\d{1,2}-\d{1,2}-20\d{2}$/.test(value))return false;
    if(/\b\d{1,2}:\d{2}\b/.test(value)||/\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+\d{1,2}\s+[a-z]{3}\b/i.test(value))return false;
    if(/^(?:all|arabic|english|french|german|italian|spanish|portuguese)$/i.test(value))return false;
    if(/^(?:[A-Z]{2,3}:|SE:)/i.test(value)||/\b(?:\d{1,2}k|exclusive|\d{3,4}p)\b/i.test(value))return false;
    if(/\b(?:ppv|dazn|espn\+?|fox sports|sky sports|bein sports|tnt sports|sports tv|live tv|prime(?:[- ]\w+)?)\b/i.test(value))return false;
    if(/^[A-Z]{2,3}$/.test(value))return false;
    return true;
  });
}
function epgLabelEventTitle(channelLabel){
  const parts=epgLabelParts(channelLabel);
  const matchupIndex=parts.findIndex(value=>/\b(?:vs\.?|versus)\b|\s[-–—]\s/i.test(value));
  if(matchupIndex>=0){
    const matchup=parts[matchupIndex];
    const competition=parts.slice(matchupIndex+1).find(value=>/\b(?:league|cup|championship|champions|premier|serie|bundesliga|six nations|rugby championship|open|masters|wimbledon|roland garros|grand prix|pga|lpga|atp|wta|tour)\b/i.test(value));
    return competition?`${matchup} · ${competition}`:matchup;
  }
  const tournament=parts.slice().reverse().find(value=>/\b(?:open|masters|championship|championships|grand prix|wimbledon|roland garros|pga|lpga|atp|wta|formula 1|formula one|nascar|indycar|dp world tour|liv golf)\b/i.test(value));
  if(tournament){
    if(/shanghai/i.test(tournament))return "Rolex Shanghai Masters";
    if(/wuhan/i.test(tournament))return "WTA Wuhan Open";
    return tournament.replace(/^tennis:\s*/i,"").trim();
  }
  return parts[0]||"";
}
function epgProgramTitle(channel,programme){
  const title=String(programme.title||"").replace(/^next\s*:\s*/i,"").replace(/\s*[·|•]\s*(?:all|arabic|english|french|german|italian|spanish|portuguese)\s*$/i,"").trim();
  const notUseful=/^(?:all|arabic|english|french|german|italian|spanish|portuguese|next|prime(?:[- ]\w+)?|espn(?:[- ]\w+)?|fox(?:[- ]\w+)?|sky(?:[- ]\w+)?|canal(?:[- ]\w+)?|tnt(?:[- ]\w+)?|bein(?:[- ]\w+)?|[A-Z]{2,3}:.*)$/i.test(title)||/\b(?:ppv|dazn)\b/i.test(title);
  const labelTitle=epgLabelEventTitle(channel.label);
  return labelTitle||title&&!notUseful&&title.length>3?labelTitle||title:"Sports broadcast";
}
function isEventBroadcast(league,title,channelLabel){
  const raw=`${title} ${epgLabelParts(channelLabel).join(" ")}`,s=scoreText(raw);
  if(/\b(?:news|radio|podcast|magazine|highlights|preview|review|talk|analysis|studio|locker room|daily show|morning show|social corner|fantacalcio|convocati|obiettivo sulla serie a)\b/.test(s))return false;
  if(/\b(?:vs|versus)\b|\s[-–—]\s/.test(raw))return true;
  if(["atp","wta"].includes(league))return /\b(?:open|masters|championship|championships|final|finals|round|qualifying|wimbledon|roland garros|australian open|shanghai masters|wuhan)\b/.test(s);
  if(league==="pga")return /\b(?:golf|pga|lpga|open|masters|championship|invitational|classic|tour)\b/.test(s);
  if(["f1","nascar","indycar"].includes(league))return /\b(?:grand prix|race|qualifying|practice|sprint|championship)\b/.test(s);
  if(league==="ufc")return /\b(?:ufc\s*\d+|fight night|main card)\b/.test(s);
  return false;
}
function tournamentTitle(league,title,channelLabel=""){
  const parts=String(title).split(/\s*[·|•]\s*/).map(x=>x.trim()).filter(Boolean);
  let candidate=parts.at(-1)||title;
  if(["atp","wta"].includes(league)){
    const labels=epgLabelParts(channelLabel);
    const candidates=[...parts,...labels].reverse().filter(value=>!/^prime|^espn|^fox|^sky|^canal|^tnt|^bein/i.test(value));
    const tournament=candidates.find(value=>/\b(?:open|masters|championship|championships|cup|wimbledon|roland garros|grand prix|tour)\b/i.test(value)&&!/\b(?:vs|versus)\b/i.test(value));
    if(tournament){
      if(/shanghai/i.test(tournament))return "Rolex Shanghai Masters";
      if(/wuhan/i.test(tournament))return "WTA Wuhan Open";
      return tournament.replace(/^tennis:\s*/i,"").trim();
    }
    candidate=labels.at(-1)||candidate;
    if(candidate.length>3&&!/\b(?:vs|versus)\b/i.test(candidate))return candidate;
    return title;
  }
  if(league==="pga")return title.replace(/\s*[·|•-]\s*(?:round\s*\d+|rd\.?\s*\d+|day\s*\d+|moving day|final round).*$/i,"").trim();
  if(["f1","nascar","indycar"].includes(league)){
    const grandPrix=title.match(/^.*?grand prix/i)?.[0];
    if(grandPrix)return grandPrix.trim();
    return title.replace(/\s*[·|•-]\s*(?:practice|qualifying|race|sprint|warm up).*$/i,"").trim();
  }
  return title;
}
function broadcastEventKey(league,title,start){
  const date=sydneyDate(new Date(start));
  if(TOURNAMENT_LEAGUES.has(league))return `${league}|${scoreText(tournamentTitle(league,title))}`;
  // Alternate EPG feeds often decorate the same fixture with a tournament or
  // language suffix. Group on the matchup and Sydney date so those feeds add
  // stream choices to one event card instead of creating duplicates.
  const matchup=String(title).split(/\s*[·|•]\s*/)[0].trim()
    .replace(/\s+(?:uefa|premier league|la liga|serie a|bundesliga|nrl|nba|nfl|afl|nhl|mlb)\b.*$/i,"")
    .replace(/\s+(?:vs\.?|versus|[-–—])\s+/i," vs ");
  return `${league}|${date}|${scoreText(matchup)}`;
}
function stableHash(value){let hash=2166136261;for(const char of String(value))hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(36);}
function epgEspnScore(event,league,title,start){
  if(event._league!==league)return 0;
  const sourceText=scoreText(title),eventName=scoreText(event.name);
  if(!sourceText||!eventName)return 0;
  const competitors=event._competition?.competitors||[];
  const people=competitors.map(c=>c.team?.displayName||c.athlete?.displayName||c.athlete?.fullName).filter(Boolean);
  if(people.length>=2){
    const matched=people.filter(person=>{const p=scoreText(person);return p.length>2&&sourceText.includes(p);}).length;
    if(matched===people.length)return 220;
  }
  const a=new Set(tokens(title)),b=tokens(event.name);
  const common=b.filter(token=>a.has(token)).length;
  const overlap=common/Math.max(1,Math.min(a.size,b.length));
  if(overlap<0.6)return 0;
  const delta=Math.abs(new Date(event._start||0).getTime()-start);
  return Math.round(overlap*100)+(delta<6*60*60_000?20:delta<24*60*60_000?5:0);
}
export function buildEpgEvents(origin,snapshot,espnEvents,now=Date.now()){
  const grouped=new Map();
  for(const channel of snapshot?.channels||[]){
    if(!channel.programmes?.length)continue;
    const firstProgramme=channel.programmes.find(p=>p.title)||channel.programmes[0];
    const firstTitle=epgProgramTitle(channel,firstProgramme);
    const league=inferEpgLeague(`${firstTitle} ${firstProgramme.description||""} ${epgLabelParts(channel.label).join(" ")}`);
    if(!league||ADDON_EXCLUDED_LEAGUES.has(league)||!SPORTS[league])continue;
    const advertisedStart=epgStartTime(channel.label,channel.programmes[0].start);
    const start=Number.isFinite(advertisedStart)?advertisedStart:channel.programmes[0].start;
    if(!Number.isFinite(start)||start>snapshot.end)continue;
    if(!isEventBroadcast(league,firstTitle,channel.label))continue;
    const duration=(EVENT_DURATION[league]||4)*60*60_000;
    const matchingSlots=channel.programmes.filter(p=>p.stop>start&&p.start<=start+2*60*60_000).sort((a,b)=>Math.abs(a.start-start)-Math.abs(b.start-start));
    const slot=matchingSlots[0]||channel.programmes.find(p=>p.title)||channel.programmes[0];
    // Channel labels contain the advertised match/event start. XMLTV programme
    // blocks supply a stop when they overlap that event; if a block is only a
    // generic pre-event slot, estimate the finish from the sport's usual length.
    const stop=slot.stop>start?slot.stop:start+duration;
    const programme={...slot,start,stop};
    const status=epgStatus(programme,now);
    if(!status||status==="finished")continue;
    const title=epgProgramTitle(channel,slot);
    const displayName=tournamentTitle(league,title,channel.label);
    // Tournament sports are represented by the broadcast/tournament once;
    // individual ESPN draws enrich the parent card instead of multiplying it.
    const groupKey=broadcastEventKey(league,displayName,start);
    let card=grouped.get(groupKey);
    if(!card){card={league,name:displayName,title,programmes:[],sourceIds:new Set(),sourceNames:new Set()};grouped.set(groupKey,card);}
    card.programmes.push({programme,channel,status,title});
    card.sourceIds.add(`flixlivetvtest:${channel.source||"dream"}:${channel.id}`);
    card.sourceNames.add(channel.label);
    if(title.length>card.title.length)card.title=title;
  }
  const out=[];
  for(const card of grouped.values()){
    const live=card.programmes.filter(x=>x.status==="live");
    const current=live.length?live:card.programmes.filter(x=>x.status==="upcoming");
    if(!current.length)continue;
    const start=Math.min(...current.map(x=>x.programme.start));
    let stop=Math.max(...card.programmes.map(x=>x.programme.stop));
    let state=live.length?"live":"upcoming";
    const sources=[...card.sourceIds];
    const best=espnEvents.map(event=>({event,score:epgEspnScore(event,card.league,`${card.name} ${card.title} ${card.programmes.map(x=>`${x.title} ${x.programme.description||""}`).join(" ")}`,start)})).sort((a,b)=>b.score-a.score)[0];
    const enrichment=best?.score>=65?best.event:null;
    if(state==="live"&&enrichment?._state==="finished")continue;
    const sport=SPORTS[card.league],date=sydneyDate(new Date(start));
    // Keep tournament IDs stable as a broadcast moves from upcoming to live;
    // its earliest currently-live session can differ from the advertised start.
    const idDate=TOURNAMENT_LEAGUES.has(card.league)?"00000000":date;
    const idSeed=TOURNAMENT_LEAGUES.has(card.league)?`${card.league}|${scoreText(card.name)}`:`${card.league}|${date}|${scoreText(card.name)}`;
    const routeState=Buffer.from(JSON.stringify({s:sources.slice(0,12),n:card.name,t:start,u:stop})).toString("base64url");
    const sourceId=`epg:${card.league}:${idDate}:${stableHash(idSeed)}~${routeState}`;
    const poster=enrichment
      ?posterFor(origin,card.league,enrichment._date,enrichment._eventId)+(TOURNAMENT_LEAGUES.has(card.league)?"&view=tournament":"")
      :`${origin}/api/poster?league=${encodeURIComponent(card.league)}&dates=${date}&epgTitle=${encodeURIComponent(card.name)}&epgStart=${start}&epgStop=${stop}&epgState=${state}&epgChannel=${encodeURIComponent([...card.sourceNames][0]||"")}&v=${Math.floor(now/30_000)}`;
    const channelNames=[...card.sourceNames].map(name=>name.replace(/^next\s*\|\s*/i,"")).slice(0,4);
    const espnDetails=enrichment?.description||"";
    const epgDetails=card.programmes.map(x=>x.programme.description).filter(Boolean).find(x=>x.length>20)||"";
    const matchList=[...new Set(card.programmes.map(x=>x.title).filter(title=>title&&scoreText(title)!==scoreText(card.name)))].slice(0,8);
    const fmtSydney=timestamp=>new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(timestamp));
    const description=[sport.label,`${state==="live"?"LIVE NOW":"UPCOMING"} • ${fmtSydney(start)} – ${fmtSydney(stop)} (Sydney)`,card.title,matchList.length?`Matches / sessions: ${matchList.join(" · ")}`:"",epgDetails,espnDetails,channelNames.length?`EPG channels: ${channelNames.join(" · ")}`:""].filter(Boolean).join("\n");
    out.push({id:sourceId,type:"tv",name:card.name,poster,background:poster,posterShape:"poster",description,genres:["Live Sports",sport.group,sport.label],behaviorHints:{defaultVideoId:sourceId},_league:card.league,_date:date,_eventId:enrichment?enrichment._eventId:"",_start:new Date(start).toISOString(),_epgStop:new Date(stop).toISOString(),_state:state,_sourceIds:sources,_sourceId:sources[0],_sourceName:channelNames[0]||"EPG broadcast",_sourceNames:channelNames,_competition:enrichment?._competition,_event:enrichment?._event,_matchScore:best?.score||0,_epg:true});
  }
  const unique=new Map();
  for(const event of out){
    const key=TOURNAMENT_LEAGUES.has(event._league)&&event._eventId?`${event._league}|${event._eventId}`:event.id;
    const existing=unique.get(key);
    if(!existing){unique.set(key,event);continue;}
    existing._sourceIds=[...new Set([...(existing._sourceIds||[]),...(event._sourceIds||[])])];
    existing._sourceId=existing._sourceIds[0];
    existing._sourceNames=[...new Set([...(existing._sourceNames||[]),...(event._sourceNames||[])])].slice(0,8);
  }
  return [...unique.values()].sort((a,b)=>new Date(a._start)-new Date(b._start));
}
async function fetchScoreboard(league,sport,date,origin=""){
  const data=await json(`${ESPN}/${sport.path}/scoreboard?dates=${date}&limit=300`,9_000);
  return competitionList(data).map(({event,competition})=>eventMeta(origin,league,sport,date,event,competition));
}
async function fetchBoxingSchedule(origin,now){
  const sport=SPORTS.boxing;
  const response=await fetch(sport.sourcePage,{headers:{"user-agent":"Mozilla/5.0 ESPN live sports addon"},cache:"no-store",signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error(`ESPN boxing schedule ${response.status}`);
  const events=parseBoxingSchedule(await response.text(),new Date(now));
  return events.map(item=>{
    const date=sydneyDate(new Date(item.date));
    const event={id:item.id,name:item.name,shortName:item.name,images:[]};
    const competition={id:item.id,date:item.date,name:item.name,venue:{fullName:item.venue},status:{type:{state:"pre",name:"STATUS_SCHEDULED",detail:`${item.rounds} ROUNDS`}},type:{text:`${item.rounds} ROUNDS`},competitors:item.fighters.map((name,index)=>({id:`${item.id}-${index+1}`,order:index+1,athlete:{displayName:name,fullName:name}}))};
    return eventMeta(origin,"boxing",sport,date,event,competition);
  });
}
export function selectEspnWindowEvents(events,now=Date.now()){
  const unique=new Map();
  for(const event of events){
    const start=Date.parse(event._start||"");
    if(!Number.isFinite(start)||event._state==="finished")continue;
    if(event._state==="upcoming"&&(start<now||start>now+24*60*60_000))continue;
    if(event._state!=="live"&&event._state!=="upcoming")continue;
    const competitors=event._competition?.competitors||[];
    if(competitors.length>=2){
      const named=competitors.filter(c=>{
        const name=c.team?.displayName||c.athlete?.displayName||c.athlete?.fullName||"";
        return name.trim()&&!/^(?:TBD|TBC|TO BE DETERMINED|UNKNOWN)$/i.test(name.trim());
      }).length;
      if(named<2)continue;
    }
    unique.set(event._league&&event._eventId?`${event._league}:${event._eventId}`:event.id,event);
  }
  return [...unique.values()];
}
function dateOffsets(now){
  return [-1,0,1].map(offset=>{
    const d=new Date(now+offset*86_400_000);
    return sydneyDate(d);
  });
}
async function fetchAllEspnEvents(origin,now){
  const leagues=Object.entries(SPORTS).filter(([league])=>!ADDON_EXCLUDED_LEAGUES.has(league)&&league!=="boxing");
  const jobs=leagues.flatMap(([league,sport])=>dateOffsets(now).map(date=>({league,sport,date})));
  const [results,boxing]=await Promise.all([
    mapLimit(jobs,18,job=>fetchScoreboard(job.league,job.sport,job.date,origin)),
    fetchBoxingSchedule(origin,now).catch(()=>[]),
  ]);
  return selectEspnWindowEvents([...results.flatMap(result=>result||[]),...boxing],now);
}
function epgSourcesForEvent(event,channels,now=Date.now()){
  const sport=SPORTS[event._league],eventStart=Date.parse(event._start||"");
  if(!sport||!Number.isFinite(eventStart))return [];
  const matches=[];
  for(const channel of channels){
    const source={name:channel.label,description:(channel.programmes||[]).map(p=>`${p.title} ${p.description||""}`).join(" "),genres:["Live TV","Sports",sport.group]};
    let lexical=matchScore(event,source);
    // EPG event names sometimes include the tournament but ESPN names the
    // current round/session. Allow a bounded tournament-title match.
    if(!lexical&&TOURNAMENT_LEAGUES.has(event._league)){
      const title=epgLabelEventTitle(channel.label);
      const a=new Set(tokens(event.name)),b=new Set(tokens(title));
      const overlap=[...a].filter(token=>b.has(token)).length/Math.max(1,Math.min(a.size,b.size));
      if(overlap>=0.5)lexical=Math.round(overlap*100);
    }
    if(lexical<55)continue;
    const advertised=epgStartTime(channel.label,eventStart);
    const delta=Math.abs((Number.isFinite(advertised)?advertised:eventStart)-eventStart);
    if(delta>4*60*60_000&&event._state!=="live")continue;
    const programme=(channel.programmes||[]).find(p=>p.stop>now)||channel.programmes?.[0];
    const score=lexical+(delta<90*60_000?25:delta<4*60*60_000?10:0)+(programme&&programme.stop>now?8:0);
    matches.push({score,id:`flixlivetvtest:${channel.source||"dream"}:${channel.id}`,name:channel.label});
  }
  return matches.sort((a,b)=>b.score-a.score);
}
export async function getSportsEvents(origin){
  const result=await cached("sports-events-espn-window",async()=>{
    const now=Date.now();
    const espnEvents=await fetchAllEspnEvents(origin,now);
    if(!espnEvents.length)return [];
    const catalogs=await catalogsForEvents(espnEvents);
    return espnEvents.map(event=>{
      const candidate=bestSource(event,catalogs);
      const sourceIds=candidate?[candidate.meta.id]:[];
      if(!sourceIds.length)return null;
      return {...event,_sourceIds:sourceIds,_sourceId:sourceIds[0],_sourceName:candidate.meta.name,_sourceNames:[candidate.meta.name],_matchScore:candidate.score};
    }).filter(Boolean).sort((a,b)=>Date.parse(a._start)-Date.parse(b._start));
  });
  return result;
}
export function publicMeta(event){
  const {id,type,name,poster,background,posterShape,description,genres,behaviorHints}=event;
  return {id,type,name,poster,background,posterShape,description,genres,behaviorHints};
}
export function eventFromId(id){
  const epg=String(id||"").match(/^epg:([^:]+):(\d{8}):([a-z0-9]+)(?:~([a-z0-9_-]+))?$/i);
  if(epg){let route={};try{if(epg[4])route=JSON.parse(Buffer.from(epg[4],"base64url").toString("utf8"));}catch{}return {kind:"epg",league:epg[1],date:epg[2],eventId:epg[3],sourceIds:Array.isArray(route.s)?route.s:[],name:typeof route.n==="string"?route.n:"Live Sports",start:Number(route.t)||0,stop:Number(route.u)||0};}
  const m=String(id||"").match(/^espn:([^:]+):(\d{8}):([^:]+)$/);
  return m?{kind:"espn",league:m[1],date:m[2],eventId:m[3]}:null;
}
export async function fetchFlixSourceStreams(sourceId){
  if(!/^(?:flixlivetvtest:(?:dream|strong|trex):[^:]+|essential:v2:[a-f0-9]+)$/i.test(String(sourceId||"")))return [];
  const response=await fetch(`${FLIX}/stream/tv/${encodeURIComponent(sourceId)}.json`,{headers:{"user-agent":"Mozilla/5.0 Stremio Sports Poster"},next:{revalidate:15},signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`Flix stream upstream ${response.status}`);
  const data=await response.json();
  return Array.isArray(data.streams)?data.streams:[];
}
export async function getEventById(origin,id){
  const parsed=eventFromId(id);if(!parsed)return null;
  if(parsed.kind==="epg"){
    if(parsed.sourceIds.length){const now=Date.now(),date=parsed.date;const poster=`${origin}/api/poster?league=${encodeURIComponent(parsed.league)}&dates=${date}&epgTitle=${encodeURIComponent(parsed.name)}&epgStart=${parsed.start||now}&epgStop=${parsed.stop}&epgState=${now<parsed.stop?"live":"upcoming"}&v=${Math.floor(now/30_000)}`;return {id,type:"tv",name:parsed.name,poster,background:poster,posterShape:"poster",description:`${SPORTS[parsed.league]?.label||parsed.league.toUpperCase()}\nLive event from Flix EPG`,genres:["Live Sports",SPORTS[parsed.league]?.group||"Sports",SPORTS[parsed.league]?.label||parsed.league.toUpperCase()],behaviorHints:{defaultVideoId:id}};}
    return (await getSportsEvents(origin)).find(event=>event.id===id)||null;
  }
  const sport=ADDON_EXCLUDED_LEAGUES.has(parsed.league)?null:SPORTS[parsed.league];if(!sport)return null;
  if(parsed.league==="boxing"){
    try{return (await fetchBoxingSchedule(origin,Date.now())).find(event=>event._eventId===parsed.eventId)||null;}catch{return null;}
  }
  const items=await fetchScoreboard(parsed.league,sport,parsed.date);
  const event=items.find(x=>x._eventId===parsed.eventId);
  return event?{...event,poster:posterFor(origin,parsed.league,parsed.date,parsed.eventId),background:posterFor(origin,parsed.league,parsed.date,parsed.eventId)}:null;
}
function streamLabel(stream){
  return String(stream.name||"")+" "+String(stream.title||"");
}
function isPpvStream(stream){
  return /amazon|prime video|netflix|dazn|espn\+|ppv|pay per view|apple tv|paramount\+|peacock|fubo|discovery\+|hbo max/i.test(streamLabel(stream));
}
function isTvChannel(stream){
  const label=streamLabel(stream);
  return /espn(?!\+)|fox sports|\bfox\b|\bnbc\b|\bcbs\b|\babc\b|\btnt\b|\btbs\b|usa network|sky sports|bein|sportsnet|tsn|eleven|viaplay|v sport|rogers|channel|broadcast|live tv/i.test(label);
}
function isEnglishTvChannel(stream){
  if(!isTvChannel(stream))return false;
  const label=streamLabel(stream);
  const explicitEnglish=/(?:^|[\s|,:/()[\]-])(?:english|eng|en)(?:$|[\s|,:/()[\]-])/i.test(label);
  const englishRegion=/(?:^|[\s|,:/()[\]-])(?:us|usa|uk|gb|au|aus|nz|ca|can)(?:$|[\s|,:/()[\]-])/i.test(label);
  return explicitEnglish||englishRegion;
}
function priority(stream){
  if(isPpvStream(stream))return 300;
  if(isEnglishTvChannel(stream))return 0;
  if(isTvChannel(stream))return 100;
  return 200;
}
function decorateStream(stream,meta){
  const rank=priority(stream),provider=(stream.name||"SPORTS STREAM").replace(/[▶️]/g,"").trim();
  const ppv=isPpvStream(stream);
  const tag=rank===0?"ENGLISH TV":ppv?"PPV / STREAMING NETWORK":rank===100?"BROADCAST TV":"LIVE STREAM";
  return {...stream,name:tag+" · "+provider,title:String(meta.name)+"\n"+tag+(stream.title?" · "+stream.title:""),_rank:rank};
}
function channelKey(stream){
  const raw=String(stream.title||stream.name||"").split(/\n/).pop().toLowerCase()
    .replace(/\b(?:us|usa|ca|uk|no|fi|au|en)\s*[:|•-]\s*/g," ")
    .replace(/\b(?:live|raw|hevc|4k|uhd|fhd|hd|sd|backup|bk)\b/g," ")
    .replace(/[ᴴᴰᴿᴬᵂ⁽⁾ᴷᴵᴾ⁾]/g," ").replace(/[^a-z0-9+ ]/g," ").replace(/\s+/g," ").trim();
  // Keep the primary broadcaster once (ESPN instead of ESPN 2/3, etc.).
  return raw.replace(/\s+\d+$/," ").trim()||raw;
}
export async function getEventStreams(id,origin="https://flixnest.app"){
  const parsed=eventFromId(id);if(!parsed)return [];
  if(parsed.kind==="epg"){
    const event=parsed.sourceIds.length?{name:parsed.name,_state:Date.now()<parsed.stop?"live":"finished",_sourceIds:parsed.sourceIds}:(await getSportsEvents(origin)).find(item=>item.id===id);
    if(!event||event._state==="finished")return [];
    const sources=event._sourceIds||[];
    const batches=await mapLimit(sources.slice(0,16),8,async sourceId=>{
      try{return (await fetchFlixSourceStreams(sourceId)).map(stream=>decorateStream(stream,event));}catch{return [];}
    });
    const sorted=batches.flat().sort((a,b)=>a._rank-b._rank),seen=new Set();
    return sorted.filter(stream=>{const key=channelKey(stream);if(seen.has(key))return false;seen.add(key);return true;}).map(({_rank,...stream})=>stream);
  }
  const sport=ADDON_EXCLUDED_LEAGUES.has(parsed.league)?null:SPORTS[parsed.league];if(!sport)return [];
  // Resolve through the same ESPN-first catalog pipeline so the event must
  // still be in-window/live and mapped to a real Flix stream. A final ESPN
  // result therefore disappears from Live Now and cannot return a stale stream.
  const event=(await getSportsEvents(origin)).find(x=>x._league===parsed.league&&x._date===parsed.date&&x._eventId===parsed.eventId);
  if(!event||event._state==="finished")return [];
  const batches=await mapLimit((event._sourceIds||[]).slice(0,16),8,async sourceId=>{
    try{return (await fetchFlixSourceStreams(sourceId)).map(stream=>decorateStream(stream,event));}catch{return [];}
  });
  const sorted=batches.flat().sort((a,b)=>a._rank-b._rank),seen=new Set();
  return sorted.filter(stream=>{const key=channelKey(stream);if(seen.has(key))return false;seen.add(key);return true;}).map(({_rank,...stream})=>stream);
}
export const CATALOGS=[{type:"tv",id:"espn-live-now",name:"Sports • Live Now"},{type:"tv",id:"espn-upcoming",name:"Sports • Upcoming (Next 24 Hours)"}];
export function withCors(response){
  response.headers.set("access-control-allow-origin","*");
  response.headers.set("access-control-allow-methods","GET, OPTIONS");
  response.headers.set("access-control-allow-headers","Content-Type, Accept, Origin");
  return response;
}