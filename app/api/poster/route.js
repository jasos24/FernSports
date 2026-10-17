Warning: truncated output (original token count: 20091)
Total output lines: 928

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import sharp from "sharp";
import {Resvg} from "@resvg/resvg-js";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {SPORTS} from "../../sports.js";
import {parseEpgMatchup} from "../../../lib/espn-assets.js";
import {parseBoxingSchedule} from "../../../lib/boxing.js";
import {isTeamLogoUrl,removeEdgeWhiteBackground} from "../../../lib/poster-image.js";
const POSTER_FONT_PATH="/tmp/espn-poster-DejaVuSans-Bold.ttf";
if(!existsSync(POSTER_FONT_PATH))writeFileSync(POSTER_FONT_PATH,gunzipSync(readFileSync(`${process.cwd()}/app/api/poster/fonts/DejaVuSans-Bold.ttf.gz`)));
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const TENNIS_LOGO = "https://a.espncdn.com/combiner/i?img=/redesign/assets/img/icons/ESPN-icon-tennis.png";
const CRICKET_TEAM_ASSET_IDS={india:6,"westindies":4,australia:2,england:1,"newzealand":5,pakistan:7,"southafrica":3,"srilanka":8,bangladesh:25,afghanistan:40};
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[ch]));
}

function wrapLines(value,maxChars) {
  const words=String(value??"").split(/\s+/).filter(Boolean).flatMap(word=>word.length>maxChars?word.match(new RegExp(`.{1,${maxChars}}`,"g"))||[word]:[word]);
  const lines=[];let line="";
  for(const word of words){
    if(line&&`${line} ${word}`.length>maxChars){lines.push(line);line=word;}
    else line=line?`${line} ${word}`:word;
  }
  if(line)lines.push(line);
  return lines;
}
function wrappedText(value,x,y,maxChars,lineHeight,className,attrs="") {
  return `<text x="${x}" y="${y}" class="${className}" ${attrs}>${wrapLines(value,maxChars).map((part,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${esc(part)}</tspan>`).join("")}</text>`;
}
function knownValue(value) {
  const text=String(value??"").trim();
  return /^(?:tbc|tbd|unknown|n\/a|-)$/i.test(text)?"":text;
}

function dateInSydney(date) {
  const parts = new Intl.DateTimeFormat("en-AU", {timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const p = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return `${p.year}${p.month}${p.day}`;
}

function flatten(data) {
  const result = [];
  for (const event of data?.events || []) {
    const comps = (event.groupings || []).flatMap((group) => group.competitions || []);
    const matches = comps.length ? comps : (event.competitions || []);
    for (const competition of matches) result.push({event, competition});
  }
  return result;
}

function htmlText(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ");
}

function unescapeHtml(value="") {return String(value).replace(/&amp;/g,"&").replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ");}
function highResLogo(url="") {
  const value=unescapeHtml(url);
  if(!value||value.startsWith("data:image"))return "";
  // ESPN page markup often points at the same asset resized to 20–35 px.
  // Preserve its original team-logo path and ask the CDN for a poster-sized copy.
  return value.replace(/([?&])w=\d+/i,"$1w=500").replace(/([?&])h=\d+/i,"$1h=500");
}
function pageLogo(html,name,league) {
  const wanted=String(name).toLowerCase().replace(/[^a-z0-9]/g,"");
  for(const tag of html.match(/<img\b[^>]*>/gi)||[]) {
    const alt=tag.match(/\b(?:alt|title)="([^"]*)"/i)?.[1]||"";
    const normalizedAlt=alt.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(!normalizedAlt||(normalizedAlt!==wanted&&!normalizedAlt.includes(wanted)&&!wanted.includes(normalizedAlt)))continue;
    const hrefs=[...tag.matchAll(/\b(?:data-src|data-default-src|src|srcset)="([^"]+)"/gi)].map(x=>x[1].split(/\s+/)[0]);
    const href=hrefs.find(x=>x&&!x.startsWith("data:image"));
    if(href)return highResLogo(href);
  }
  if(league==="rugby") {
    for(const a of html.matchAll(/<a\b[^>]*href="\/rugby\/team\/_\/id\/(\d+)\/[^\"]*"[^>]*>([\s\S]{0,1200}?)<\/a>/gi)) {
      const linked=htmlText(a[2]).trim().toLowerCase().replace(/[^a-z0-9]/g,"");
      if(linked&&linked===wanted) {
        const img=a[2].match(/<img\b[^>]*>/i)?.[0];
        const src=img?.match(/\b(?:data-src|data-default-src|src)="([^"]+)"/i)?.[1];
        if(src&&!src.startsWith("data:image"))return highResLogo(src);
        // ESPN's rugby assets sit under the extra /teams/ directory. Without it
        // the CDN returns its blue question-mark placeholder image.
        return `https://a.espncdn.com/i/teamlogos/rugby/teams/500/${a[1]}.png`;
      }
    }
  }
  if(league==="cricket") {
    for(const a of html.matchAll(/<a\b[^>]*href="\/cricket\/team\/_\/id\/(\d+)\/[^\"]*"[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
      const linked=htmlText(a[2]).trim().toLowerCase().replace(/[^a-z0-9]/g,"");
      if(linked&&linked===wanted)return `https://a.espncdn.com/i/teamlogos/cricket/500/${a[1]}.png`;
    }
  }
  return "";
}

async function espnTeamLogos(sport) {
  try{
    const response=await fetch(`${ESPN}/${sport.path}/teams?limit=100`,{headers:{"user-agent":"Mozilla/5.0 ESPN team logo lookup"},cache:"no-store",signal:AbortSignal.timeout(3500)});
    if(!response.ok)return new Map();
    const data=await response.json();
    const teams=data?.team?[data.team]:data?.sports?.flatMap(x=>x.leagues||[]).flatMap(x=>x.teams||[]).map(x=>x.team||x)||data?.teams?.map(x=>x.team||x)||[];
    return new Map(teams.map(team=>[String(team.id),highResLogo(team?.logos?.find(x=>x.rel?.includes("full"))?.href||team?.logos?.[0]?.href||team?.logo||"")]).filter(([,logo])=>logo));
  }catch{return new Map();}
}

const espnTeamDirectoryCache=new Map();
const espnTeamSearchCache=new Map();
function normalizeTeamName(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
async function espnTeamDirectory(sport){
  if(espnTeamDirectoryCache.has(sport.path))return espnTeamDirectoryCache.get(sport.path);
  const promise=(async()=>{
    const response=await fetch(`${ESPN}/${sport.path}/teams?limit=1000`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster team images"},cache:"force-cache",signal:AbortSignal.timeout(4500)});
    if(!response.ok)return new Map();
    const data=await response.json();
    const teams=data?.sports?.flatMap(x=>x.leagues||[]).flatMap(x=>x.teams||[]).map(x=>x.team||x)||data?.teams?.map(x=>x.team||x)||[];
    const byName=new Map();
    for(const team of teams){
      const logo=highResLogo(team?.logos?.find(x=>x.rel?.includes("full"))?.href||team?.logos?.[0]?.href||team?.logo||"");
      if(!logo)continue;
      for(const alias of [team.displayName,team.name,team.shortDisplayName,team.abbreviation,team.nickname]){
        const key=normalizeTeamName(alias);if(key&&!byName.has(key))byName.set(key,logo);
      }
    }
    return byName;
  })().catch(()=>new Map());
  espnTeamDirectoryCache.set(sport.path,promise);
  return promise;
}
async function espnTeamImageByName(name,expectedSport){
  const query=normalizeTeamName(name),sportSlug=expectedSport.path.split("/")[0];
  if(!query)return "";
  const cacheKey=`${sportSlug}:${query}`;
  if(espnTeamSearchCache.has(cacheKey))return espnTeamSearchCache.get(cacheKey);
  const promise=(async()=>{
    const url=`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}`;
    const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 ESPN poster team search"},cache:"force-cache",signal:AbortSignal.timeout(4500)});
    if(!response.ok)return "";
    const data=await response.json();
    const candidates=(data?.items||[]).filter(item=>item?.type==="team"&&item?.sport===sportSlug&&(item?.league||item?.defaultLeagueSlug)&&item?.id);
    const ranked=candidates.map((team,index)=>({team,index,match:normalizeTeamName(team.displayName)===query?3:normalizeTeamName(team.displayName).endsWith(` ${query}`)?2:normalizeTeamName(team.displayName).includes(query)?1:0}))
      .filter(entry=>entry.match).sort((a,b)=>b.match-a.match||a.index-b.index).slice(0,5);
    // Search results can contain multiple teams with the same display name
    // across leagues (e.g. a women's cup team and a domestic club). Verify
    // each match against its ESPN team-details record and skip entries without
    // an official logo instead of returning a dead CDN URL.
    for(const {team} of ranked){
      const teamLeague=team.league||team.defaultLeagueSlug;
      try{
        const detail=await fetch(`${ESPN}/${team.sport}/${teamLeague}/teams/${encodeURIComponent(team.id)}`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster team details"},cache:"force-cache",signal:AbortSignal.timeout(4500)});
        if(!detail.ok)continue;
        const dataDetail=await detail.json(),record=dataDetail?.team||dataDetail;
        const logo=highResLogo(record?.logos?.find(x=>x.rel?.includes("full"))?.href||record?.logos?.find(x=>x.rel?.includes("default"))?.href||record?.logos?.[0]?.href||record?.logo||"");
        if(logo)return logo;
      }catch{}
    }
    return "";
  })().catch(()=>"");
  espnTeamSearchCache.set(cacheKey,promise);
  return promise;
}
async function enrichEpgTeamImages(item,sport){
  const competitors=item?.competition?.competitors||[];
  const teams=competitors.filter(competitor=>competitor?.team&&!participantImage(competitor));
  if(!teams.length)return item;
  const directory=await espnTeamDirectory(sport);
  await Promise.all(teams.map(async competitor=>{
    const team=competitor.team;
    const aliases=[team.displayName,team.shortDisplayName,team.name].filter(Boolean);
    let logo="";
    for(const alias of aliases){logo=directory.get(normalizeTeamName(alias))||"";if(logo)break;}
    if(!logo){
      // A soccer broadcast's EPG label often lacks its competition name, so
      // search ESPN's team index across leagues (e.g. Brazil while the add-on
      // default scoreboard is the English Premier League).
      for(const alias of aliases){logo=await espnTeamImageByName(alias,sport);if(logo)break;}
    }
    if(logo)team.logo=logo,team.logos=[{href:logo,rel:["full","default"]}];
  }));
  return item;
}

function scrapedItem(name, date, people, venue="") {
  const competitors=people.map((person,i)=>person.athlete
    ?{id:String(i+1),order:i+1,athlete:{displayName:person.name,record:person.record||"",headshot:person.image?{href:person.image}:undefined},score:person.score||""}
    :{id:String(i+1),order:i+1,homeAway:i===0?"home":"away",team:{...(person.id?{id:String(person.id)}:{}),displayName:person.name,shortDisplayName:person.name,...(person.logo?{logo:person.logo,logos:[{href:person.logo}]}:{})},score:person.score||""});
  return {event:{id:"scraped",name,images:[]},competition:{id:`scraped-${name}`,date,venue:{fullName:venue},status:{type:{state:"pre",name:"STATUS_SCHEDULED",detail:"ESPN SCHEDULE"}},competitors}};
}

async function getScrapedSchedule(sport, league, requestedDate) {
  const date=requestedDate||dateInSydney(new Date());
  let url=sport.sourcePage;
  if(league==="rugby")url+=date;
  if(league==="cricket")url+=date;
  const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 ESPN event poster"},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!response.ok) return {now:new Date(),items:[],leagueLogo:""};
  const html=await response.text();
  const plain=htmlText(html);
  let items=[];
  if(league==="rugby") {
    for(const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi)||[]) {
      const foundLinks=[...row.matchAll(/<a\b[^>]*href="\/rugby\/team\/_\/id\/(\d+)\/[^\"]*"[^>]*>([\s\S]{0,300}?)<\/a>/gi)];
      const links=[...new Map(foundLinks.map(a=>[a[1],a])).values()];
      const teams=links.map(a=>htmlText(a[2]).trim()).filter(Boolean);
      const rowText=htmlText(row),tm=rowText.match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
      if(teams.length<2||!tm)continue;
      let hour=Number(tm[1])%12;if(tm[3].toUpperCase()==="P")hour+=12;
      const venue=rowText.match(/\b(?:at|venue)\s+(.+?)(?:\s+\d{1,2}:\d{2}|$)/i)?.[1]?.trim()||"";
      const people=links.slice(0,2).map((a,i)=>({id:a[1],name:teams[i],logo:`https://a.espncdn.com/i/teamlogos/rugby/teams/500/${a[1]}.png`}));
      items.push(scrapedItem(`${teams[0]} v ${teams[1]}`,`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${String(hour).padStart(2,"0")}:${tm[2]}:00Z`,people,venue));
    }
  } else if(league==="cricket") {
    const d=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8))));
    const dateLabel=d.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"}).replace(",","");
    let cursor=0;
    while((cursor=plain.indexOf(dateLabel,cursor))>=0){const tail=plain.slice(cursor+dateLabel.length,cursor+dateLabel.length+280);const teams=tail.match(/^\s+([A-Z][A-Za-z .'-]+?)\s+([A-Z]{2,3})\s+([A-Z][A-Za-z .'-]+?)\s+([A-Z]{2,3})/);if(teams)items.push(scrapedItem("Cricket • "+tail.slice(0,Math.min(tail.indexOf(" at ")>0?tail.indexOf(" at "):45,60)).trim(),`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`,[{name:teams[1].trim()},{name:teams[3].trim()}]));cursor+=dateLabel.length;}
  } else if(league==="boxing") {
    for(const fight of parseBoxingSchedule(html,new Date())) {
      const item=scrapedItem(fight.name,fight.date,fight.fighters.map(name=>({name,athlete:true})),fight.venue);
      item.event.id=fight.id;item.competition.id=fight.id;item.competition.type={text:`${fight.rounds} ROUNDS`};
      item.competition.status.type.detail=`${fight.rounds} ROUNDS`;
      items.push(item);
    }
  }
  if(league==="rugby"||league==="cricket") {
    const teams=[...new Map(items.flatMap(item=>item.competition.competitors||[]).filter(x=>x.team).map(x=>[x.team.id||x.team.displayName.toLowerCase().replace(/[^a-z0-9]/g,""),x.team])).values()];
    const apiLogos=await espnTeamLogos(sport);
    teams.forEach(team=>{
      const normalized=team.displayName.toLowerCase().replace(/[^a-z0-9]/g,"");
      const cricketId=league==="cricket"?CRICKET_TEAM_ASSET_IDS[normalized]:null;
      const logo=apiLogos.get(String(team.id))||pageLogo(html,team.displayName,league)||(cricketId?`https://a.espncdn.com/i/teamlogos/cricket/500/${cricketId}.png`:"")||team.logo;
      if(logo)team.logo=logo,team.logos=[{href:logo}];
    });
  }
  return {now:new Date(),items,leagueLogo:""};
}

function matchState(competition) {
  const type = competition?.status?.type || {};
  const state = String(type.state || "").toLowerCase();
  if (state === "in" || /IN_PROGRESS|LIVE/.test(type.name || "")) return "live";
  if (type.completed || state === "post" || /FINAL|COMPLETE/.test(type.name || "")) return "final";
  return "pre";
}

function playerName(competitor) {
  const athlete = competitor?.athlete || {};
  const roster = competitor?.roster || {};
  return roster.displayName || athlete.displayName || athlete.fullName || competitor?.team?.displayName || "TBD";
}

function playerImage(competitor) {
  const athlete = competitor?.athlete || {};
  const roster = competitor?.roster || {};
  const headshot = athlete.headshot?.href || athlete.images?.[0]?.href || roster.headshot?.href;
  const flag = athlete.flag?.href || roster.flag?.href;
  return headshot || flag || "";
}

function participantName(competitor) {
  const team=competitor?.team||{};
  const athlete=competitor?.athlete||{};
  return team.displayName||team.name||athlete.displayName||athlete.fullName||competitor?.displayName||"TBD";
}

function participantImage(competitor) {
  const team=competitor?.team||{};
  const athlete=competitor?.athlete||{};
  // Old tennis posters used the ESPN athlete flag when a player headshot was
  // not present. Many ESPN tennis scoreboard competitors only publish flags.
  return highResLogo(team.logos?.find?.(logo=>logo.rel?.includes("full"))?.href||team.logos?.[0]?.href||team.logo||athlete.headshot?.href||athlete.images?.[0]?.href||athlete.flag?.href||competitor?.roster?.headshot?.href||competitor?.roster?.flag?.href||"");
}

function teamAccent(competitor,fallback) {
  const raw=String(competitor?.team?.color||competitor?.team?.alternateColor||competitor?.athlete?.color||"").replace(/^#/ ,"");
  return /^[0-9a-f]{6}$/i.test(raw)&&!/^f{6}$/i.test(raw)&&!/^0{6}$/i.test(raw)?`#${raw}`:fallback;
}

function initials(name) {
  const parts=String(name||"?").replace(/[^\p{L}\p{N} ]/gu," ").trim().split(/\s+/).filter(Boolean);
  return (parts.length===1?parts[0].slice(0,2):parts.slice(0,2).map(part=>part[0]).join("")).toUpperCase()||"?";
}

function shortSydneyDate(value) {
  if(!value)return "SCHEDULE TBC";
  return new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(value)).toUpperCase().replace(",","");
}

function countdownLarge(value) {
  const ms=new Date(value).getTime()-Date.now();
  if(!Number.isFinite(ms))return "TIME TBC";
  if(ms<=0)return "STARTING NOW";
  const mins=Math.ceil(ms/60000),days=Math.floor(mins/1440),hours=Math.floor((mins%1440)/60),minutes=mins%60;
  return days?`${days}D ${String(hours).padStart(2,"0")}H ${String(minutes).padStart(2,"0")}M`:`${hours}H ${String(minutes).padStart(2,"0")}M`;
}

export function renderMatchupPoster({league,sport,item,leagueLogo,error,epgStart,epgStop,epgState,epgTitle}) {
  const c=item?.competition,event=item?.event;
  const competitors=[...(c?.competitors||[])].sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  const one=competitors[0],two=competitors[1];
  const name1=participantName(one),name2=participantName(two);
  const img1=participantImage(one),img2=participantImage(two);
  const start=Number(epgStart)||new Date(c?.date||event?.date||Date.now()).getTime();
  const stop=Number(epgStop)||0,now=Date.now();
  const live=epgState==="live"||(epgStart!=null&&stop?now>=start&&now<stop:c?matchState(c)==="live":false);
  const final=c&&matchState(c)==="final";
  const eventName=epgTitle||event?.name||c?.name||sport.label;
  const header=live?`<rect x="42" y="31" width="130" height="48" rx="24" fill="#d92332"/><circle cx="66" cy="55" r="8" fill="#fff"/><text x="86" y="64" class="live">LIVE</text>`:`<text x="42" y="62" class="date">${esc(shortSydneyDate(start))}</text>`;
  const logo=highResLogo(leagueLogo||c?.league?.logos?.[0]?.href||event?.logos?.[0]?.href||"");
  const logoSvg=logo?`<image href="${esc(logo)}" x="500" y="28" width="62" height="62" preserveAspectRatio="xMidYMid meet"/>`:`<text x="530" y="65" class="mark" style="fill:#f4cc4e" text-anchor="middle">${esc(sport.label.slice(0,4))}</text>`;
  const accent1=teamAccent(one,"#ef6a44"),accent2=teamAccent(two,"#4f91ff");
  const glovePalette=["#e53935","#1687ff","#f4b400","#20a464","#a855f7","#ff6b35","#ec4899","#11a6a6"];
  const gloveFallback=(name,index,y)=>{
    const seed=`${eventName}|${name}|${index}`;let hash=2166136261;
    for(let i=0;i<seed.length;i++){hash^=seed.charCodeAt(i);hash=Math.imul(hash,16777619);}
    const color=glovePalette[(hash>>>0)%glovePalette.length];
    return `<g transform="translate(300 ${y+8})"><g transform="translate(-58 2) rotate(-18 0 65)"><path d="M-27 77h54v48h-54z" rx="8" fill="#e8e8ec" stroke="#17181d" stroke-width="7"/><path d="M-30 29c0-18 12-30 28-30h18c20 0 35 16 35 36v20c0 10-4 18-12 25l-13 13h-42c-12-10-18-23-18-38z" fill="${color}" stroke="#17181d" stroke-width="8" stroke-linejoin="round"/><path d="M22 47c-2 12-11 20-24 21l-22-2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/><path d="M-27 91h54m-54 12h54" stroke="${color}" stroke-width="5"/></g><g transform="translate(57 2) rotate(18 0 65)"><path d="M-27 77h54v48h-54z" fill="#e8e8ec" stroke="#17181d" stroke-width="7"/><path d="M-30 29c0-18 12-30 28-30h18c20 0 35 16 35 36v20c0 10-4 18-12 25l-13 13h-42c-12-10-18-23-18-38z" fill="${color}" stroke="#17181d" stroke-width="8" stroke-linejoin="round"/><path d="M22 47c-2 12-11 20-24 21l-22-2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/><path d="M-27 91h54m-54 12h54" stroke="${color}" stroke-width="5"/></g></g>`;
  };
  const card=(name,image,y,labelY,accent,index)=>`<rect x="50" y="${y}" width="500" height="200" rx="28" fill="url(#teamGradient${index})"/>${image?`<image href="${esc(image)}" x="145" y="${y+7}" width="310" height="150" preserveAspectRatio="xMidYMid meet" filter="url(#logoGlow${index})"/>`:league==="boxing"?gloveFallback(name,index,y):`<text x="300" y="${y+110}" class="initials" text-anchor="middle" fill="${accent}">${esc(initials(name))}</text>`}${wrappedText(name,300,labelY,23,29,"name","text-anchor=\"middle\"")}`;
  const score1=knownValue(one?.score),score2=knownValue(two?.score);
  const scoreVisible=(live||final)&&score1!==""&&score2!==""&&sport.family!=="combat";
  const status=c?.status||{};
  const liveDetail=sport.family==="combat"
    ?[`ROUND ${status.period||""}`,knownValue(status.displayClock)||knownValue(status.type?.shortDetail)||knownValue(status.type?.detail)].filter(Boolean).join(" • ")||"FIGHT IN PROGRESS"
    :knownValue(status.displayClock)||knownValue(status.type?.shortDetail)||knownValue(status.type?.detail)||"LIVE";
  const scoreOrVs=scoreVisible
    ?`<text x="300" y="454" class="scoreline" text-anchor="middle">${esc(score1)} <tspan class="scoreDivider">–</tspan> ${esc(score2)}</text><text x="300" y="482" class="scoreMeta" text-anchor="middle">${esc((final?"FINAL":liveDetail).toUpperCase())}</text>`
    :sport.family==="combat"&&live
      ?`<text x="300" y="467" class="scoreMeta" text-anchor="middle">${esc(liveDetail.toUpperCase())}</text>`
      :`<circle cx="300" cy="458" r="35" fill="#f4cc4e" stroke="#111" stroke-width="6"/><text x="300" y="470" class="vs" text-anchor="middle">VS</text>`;
  const countdownText=live?"LIVE NOW":final?"FINAL":countdownLarge(start);
  const timerColor=live?"#ef4c55":"#f4cc4e";
  const timerSize=countdownText.length>16?34:countdownText.length>12?40:49;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#101114"/><stop offset="1" stop-color="#050506"/></linearGradient><linearGradient id="teamGradient1" x2="1" y2="1"><stop stop-color="${accent1}" stop-opacity=".78"/><stop offset="1" stop-color="#101114"/></linearGradient><linearGradient id="teamGradient2" x2="1" y2="1"><stop stop-color="${accent2}" stop-opacity=".78"/><stop offset="1" stop-color="#101114"/></linearGradient><filter id="logoGlow1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="blur"/><feFlood flood-color="${accent1}" flood-opacity=".42"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="logoGlow2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="blur"/><feFlood flood-color="${accent2}" flood-opacity=".42"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feFilter></filter><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".06"/></pattern><style>.date{font-family:"Arial";font-size:23px;font-weight:800;fill:#fff;letter-spacing:.4px}.live{font-family:"Arial";font-size:25px;font-weight:900;fill:#fff;letter-spacing:1px}.mark{font-family:"Arial";font-size:18px;font-weight:900;fill:#20232a}.event{font-family:"Arial";font-size:27px;font-weight:900;fill:#fff;letter-spacing:.4px}.initials{font-family:"Arial";font-size:84px;font-weight:900;fill:#fff}.name{font-family:"Arial";font-size:38px;font-weight:900;fill:#fff}.vs{font-family:"Arial";font-size:34px;font-weight:900;fill:#121212;letter-spacing:2px}.scoreline{font-family:"Arial";font-size:64px;font-weight:900;fill:#fff}.scoreDivider{fill:#f4cc4e}.scoreMeta{font-family:"Arial";font-size:19px;font-weight:900;fill:#d5d6da;letter-spacing:1.4px}.caption{font-family:"Arial";font-size:19px;font-weight:900;fill:#d5d6da;letter-spacing:1.4px}.timer{font-family:"Arial";font-size:${timerSize}px;font-weight:900;fill:${timerColor};letter-spacing:.5px}.foot{font-family:"Arial";font-size:14px;font-weight:700;fill:#9a9ba1;letter-spacing:1.6px}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>${header}${logoSvg}${card(name1,img1,135,400,accent1,1)}${scoreOrVs}${card(name2,img2,515,780,accent2,2)}<text x="300" y="830" class="caption" text-anchor="middle">${live?"LIVE NOW":final?"MATCH FINISHED":"COUNTDOWN TO START"}</text><text x="300" y="884" class="timer" text-anchor="middle">${esc(countdownText)}</text>${error?`<text x="300" y="857" class="foot" text-anchor="middle">ESPN DATA DELAYED</text>`:""}</svg>`;
}

function syntheticEpgMatch(title,start,state) {
  const parts=parseEpgMatchup(title);
  if(!parts)return null;
  const live=state==="live";
  return {event:{name:title},competition:{date:new Date(start).toISOString(),status:{type:{state:live?"in":"pre",name:live?"STATUS_IN_PROGRESS":"STATUS_SCHEDULED"}},competitors:parts.map((name,index)=>({id:String(index+1),order:index+1,team:{displayName:name,shortDisplayName:name}}))}};
}

function matchEpgItem(title,start,stop,items) {
  const norm=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const tokens=value=>norm(value).split(/\s+/).filter(word=>word.length>2&&!/^(the|and|vs|versus|at|live|match|game|round|202[4-9])$/.test(word));
  const titleText=norm(title),titleTokens=tokens(title);
  const ranked=[...items].filter(({competition})=>(competition?.competitors||[]).length>=2).map(item=>{
    const c=item.competition,competitors=c.competitors||[];
    const names=competitors.map(participantName);
    const matched=names.filter(name=>{
      const normalized=norm(name);if(normalized.length>3&&titleText.includes(normalized))return true;
      const words=tokens(name);return words.length>0&&words.filter(word=>titleTokens.includes(word)).length>=Math.min(2,words.length);
    }).length;
    const eventWords=tokens(`${item.event?.name||""} ${c.name||""}`);
    const overlap=eventWords.filter(word=>titleTokens.includes(word)).length/Math.max(1,eventWords.length);
    const date=new Date(c.date||item.event?.date||0).getTime();
    const delta=Math.abs(date-start),inWindow=date>=start-2*3600000&&date<=stop+2*3600000;
    const timeScore=inWindow?40:delta<24*3600000?15:0;
    const score=(matched>=2?120:matched===1?35:0)+Math.round(overlap*70)+timeScore+(delta<3600000?20:delta<4*3600000?10:0);
    return {item,score};
  }).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score>=65?ranked[0].item:null;
}

function setText(line) {
  if (!line) return "–";
  const games = Number.isFinite(Number(line.value)) ? String(line.value) : "–";
  return line.tiebreak != null ? `${games}<tspan class="tb">(${esc(line.tiebreak)})</tspan>` : games;
}

function periodValue(line) {
  if (line == null) return null;
  if (typeof line === "number" || typeof line === "string") {
    const n=Number(line);
    return Number.isFinite(n)?n:null;
  }
  const raw=line.value??line.displayValue;
  if(raw==null)return null;
  const n=Number(raw);
  return Number.isFinite(n)?n:null;
}

function periodDisplay(line) {
  if(line==null)return "–";
  if(typeof line==="number"||typeof line==="string")return String(line);
  return line.displayValue??line.value??"–";
}

function halftimeScore(lines, family) {
  const count=["baseball","cricket","sets","hockey"].includes(family)?0:["rugby","nrl","soccer"].includes(family)?1:2;
  if(!count)return "";
  const values=lines.slice(0,count).map(periodValue);
  if(values.some(value=>value==null))return "";
  return String(values.reduce((sum,value)=>sum+value,0));
}

function fmtTime(date) {
  if (!date) return "TIME TBC";
  return new Intl.DateTimeFormat("en-AU", {timeZone:"Australia/Sydney",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}).format(new Date(date)).toUpperCase();
}

function countdown(date) {
  const ms = new Date(date).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "SCHEDULED";
  if (ms <= 0) return "STARTING NOW";
  const mins = Math.ceil(ms / 60000);
  return mins < 60 ? `STARTS IN ${mins} MIN` : `STARTS IN ${Math.floor(mins / 60)}H ${mins % 60}M`;
}

async function getSchedule(sport, league, requestedDate, eventId = "") {
  if(sport.sourcePage) {
    const result=await getScrapedSchedule(sport,league,requestedDate);
    if(!result.leagueLogo){
      try{
        const response=await fetch(`${ESPN}/${sport.path}/scoreboard?limit=1`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster"},cache:"force-cache",signal:AbortSignal.timeout(3500)});
        if(response.ok){const data=await response.json();result.leagueLogo=data?.leagues?.[0]?.logos?.[0]?.href||"";}
      }catch{}
    }
    return result;
  }
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const dates = requestedDate ? [requestedDate] : [dateInSydney(now), dateInSydney(tomorrow)];
  const urls = dates.map((date) => `${ESPN}/${sport.path}/scoreboard?dates=${date}&limit=300${eventId?`&event=${encodeURIComponent(eventId)}`:""}`);
  const responses = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, {headers:{"user-agent":"Mozilla/5.0 ESPN poster"}, cache:"no-store", signal:AbortSignal.timeout(9000)});
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }));
  let all = responses.filter(Boolean).flatMap(flatten);
  let fallbackData = null;
  if (!all.length && !requestedDate) {
    const response = await fetch(`${ESPN}/${sport.path}/scoreboard?limit=300${eventId?`&event=${encodeURIComponent(eventId)}`:""}`, {headers:{"user-agent":"Mozilla/5.0 ESPN poster"}, cache:"no-store", signal:AbortSignal.timeout(9000)});
    if (response.ok) {
      fallbackData = await response.json();
      all = flatten(fallbackData);
    }
  }
  // Golf's scoreboard only returns the next scheduled tournament between events,
  // and that event has no leaderboard competitors yet. Use ESPN's own season
  // calendar to find the latest completed event and load its real leaderboard.
  if (league === "pga" && !all.some(({competition}) => (competition?.competitors?.length || 0) > 0) && !requestedDate) {
    try {
      const calendarData = fallbackData || (responses.find(Boolean)) || await (async()=>{
        const response=await fetch(`${ESPN}/${sport.path}/scoreboard?limit=300`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster"},cache:"no-store",signal:AbortSignal.timeout(9000)});
        return response.ok?response.json():null;
      })();
      const calendar=calendarData?.leagues?.[0]?.calendar||[];
      const target=eventId
        ? calendar.find(entry=>String(entry.id)===String(eventId))
        : [...calendar].filter(entry=>new Date(entry.endDate||entry.startDate).getTime()<now.getTime()).sort((a,b)=>new Date(b.endDate||b.startDate)-new Date(a.endDate||a.startDate))[0];
      if(target){
        const date=String(target.startDate||"").slice(0,10).replace(/-/g,"");
        if(date){
          const response=await fetch(`${ESPN}/${sport.path}/scoreboard?dates=${date}&limit=300`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster"},cache:"no-store",signal:AbortSignal.timeout(9000)});
          if(response.ok){const eventItems=flatten(await response.json());if(eventId)all=eventItems.filter(({event,competition})=>String(event?.id)===String(eventId)||String(competition?.id)===String(eventId));else all=eventItems;}
        }
      }
    } catch {}
  }
  let unique = [...new Map(all.map((item) => [item.competition.id, item])).values()];
  if(sport.family==="race") {
    const byEvent=new Map();
    for(const item of unique){const key=item.event?.id||item.competition.id;if(!byEvent.has(key))byEvent.set(key,[]);byEvent.get(key).push(item);}
    unique=[...byEvent.values()].flatMap(group=>{
      const race=group.filter(({competition:c})=>/\brace\b|grand prix/i.test(`${c?.type?.abbreviation||""} ${c?.type?.text||""} ${c?.type?.name||""} ${c?.name||""}`));
      if(race.length)return race;
      const completed=group.filter(({competition:c})=>c?.status?.type?.completed);
      return completed.length?completed.slice(-1):group.slice(-1);
    });
  }
  return {now, items:unique, leagueLogo:responses.find((data)=>data?.leagues?.[0]?.logos?.[0]?.href)?.leagues?.[0]?.logos?.[0]?.href || ""};
}

const epgScheduleCache=new Map();
async function getEpgSchedule(sport,league,date){
  const key=`${league}:${date}`,cached=epgScheduleCache.get(key);
  if(cached&&cached.until>Date.now())return cached.promise;
  const promise=getSchedule(sport,league,date);
  epgScheduleCache.set(key,{promise,until:Date.now()+45_000});
  try{return await promise}catch(error){epgScheduleCache.delete(key);throw error;}
}

const soccerLeagueLogoCache=new Map();
const SOCCER_LEAGUE_SLUGS=[
  [/\b(?:uefa\s+)?champions league\b/i,"uefa.champions"],
  [/\b(?:uefa\s+)?europa league\b/i,"uefa.europa"],
  [/\b(?:uefa\s+)?conference league\b/i,"uefa.europa.conf"],
  [/\bpremier league\b/i,"eng.1"],[/\bla liga\b/i,"esp.1"],
  [/\bserie a\b/i,"ita.1"],[/\bbundesliga\b/i,"ger.1"],
  [/\bligue 1\b/i,"fra.1"],[/\beredivisie\b/i,"ned.1"],
  [/\bprimeira liga\b/i,"por.1"],[/\bmls\b|\bmajor league soccer\b/i,"usa.1"],
];
async function epgLeagueLogo(sport,league,title,channel=""){
  if(sport.family==="tennis")return TENNIS_LOGO;
  if(sport.family!=="soccer")return "";
  const text=`${title||""} ${channel||""}`;
  const slug=SOCCER_LEAGUE_SLUGS.find(([pattern])=>pattern.test(text))?.[1];
  if(!slug)return "";
  if(soccerLeagueLogoCache.has(slug))return soccerLeagueLogoCache.get(slug);
  const promise=(async()=>{
    try{
      const response=await fetch(`${ESPN}/soccer/${slug}/scoreboard?limit=1`,{headers:{"user-agent":"Mozilla/5.0 ESPN poster league logo"},cache:"force-cache",signal:AbortSignal.timeout(4000)});
      if(!response.ok)return "";
      const data=await response.json();
      return highResLogo(data?.leagues?.[0]?.logos?.find(x=>x.rel?.includes("default"))?.href||data?.leagues?.[0]?.logos?.[0]?.href||"");
    }catch{return "";}
  })();
  soccerLeagueLogoCache.set(slug,promise);
  return promise;
}

function renderPoster({league, item, leagueLogo, error}) {
  const c = item?.competition;
  const event = item?.event;
  const competitors = [...(c?.competitors || [])].sort((a,b)=>(a.order||0)-(b.order||0));
  const one = competitors[0];
  const two = competitors[1];
  const state = c ? matchState(c) : "pre";
  const live = state === "live";
  const upcoming = state === "pre";
  const period = Number(c?.status?.period || 0);
  const lines1 = one?.linescores || [];
  const lines2 = two?.linescores || [];
  const maxSets = Math.max(lines1.length, lines2.length, Number(c?.format?.regulation?.periods) || 3);
  const currentSet = live && period > 0 ? `SET ${period}` : (upcoming ? "NEXT MATCH" : "MATCH COMPLETE");
  const start = c?.date;
  const eventName = event?.name || (league === "atp" ? "ATP TOUR" : "WTA TOUR");
  const headerOffset=wrapLines(eventName,27).length>1?16:0;
  const round = c?.round?.displayName || c?.type?.text || "TOURNAMENT MATCH";
  const venue = c?.venue?.court || c?.venue?.fullName || "COURT TBC";
  const statusText = live ? `LIVE • ${currentSet}` : upcoming ? countdown(start) : "FINAL";
  const p1 = playerName(one);
  const p2 = playerName(two);
  const initial = !item ? "NO LIVE OR UPCOMING MATCH" : error ? "ESPN DATA UNAVAILABLE" : statusText;
  const columns = Array.from({length:Math.min(maxSets,5)},(_,i)=>i+1).map((n,i)=>`<text x="${300+i*42}" y="604" class="col ${live&&n===period?"current":""}">S${n}</text>`).join("");
  const scoreRows = [one,two].map((player,row)=>{
    const y = row===0?650:694;
    const lines = player?.linescores || [];
    const points = player?.score ?? (player?.statistics||[]).find(x=>/point|game/i.test(x.name||""))?.displayValue;
    const livePoint = live && points != null ? `<text x="540" y="${y}" class="point" text-anchor="end">${esc(points)}</text>` : "";
    const sets = Array.from({length:Math.min(maxSets,5)},(_,i)=>`<text x="${300+i*42}" y="${y}" class="score ${live&&period===i+1?"current":""}">${setText(lines[i])}</text>`).join("");
    return wrappedText(playerName(player),72,y,24,20,"player")+sets+livePoint;
  }).join("");
  const roundLabel = `ROUND • ${esc(round.toUpperCase())}`;
  const sourceError = error ? `<text x="50" y="817" class="foot">ESPN SCOREBOARD TEMPORARILY UNAVAILABLE</text>` : "";
  const eventImg = event?.images?.[0]?.url || event?.images?.[0]?.href || c?.images?.[0]?.url || leagueLogo;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><linearGradient id="photo" x2="0" y2="1"><stop stop-color="#282828"/><stop offset="1" stop-color="#151515"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:28px;font-weight:800;fill:#fff;letter-spacing:.3px}.title{font-family:"Arial";font-size:37px;font-weight:900;fill:#fff;letter-spacing:-1px}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.player{font-family:"Arial";font-size:17px;font-weight:800;fill:#fff}.vs{font-family:"Arial";font-size:23px;font-weight:900;letter-spacing:2px;text-anchor:middle;fill:#111}.col{font-family:"Arial";font-size:12px;font-weight:700;fill:#888}.score{font-family:"Arial";font-size:23px;font-weight:900;fill:#fff}.current{fill:#f1c94b!important}.point{font-family:"Arial";font-size:23px;font-weight:900;fill:#f1c94b}.tb{font-family:"Arial";font-size:9px;font-weight:600;fill:#aaa}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs>
<rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>
<rect x="468" y="30" width="86" height="86" rx="12" fill="#f2f3f5"/><image href="${esc(eventImg)}" x="472" y="34" width="78" height="78" opacity=".92" preserveAspectRatio="xMidYMid meet"/>
<text x="50" y="57" class="tiny">ESPN TENNIS  /  ${league.toUpperCase()}</text>${wrappedText(eventName,50,91,27,31,"event")}<text x="50" y="${134+headerOffset}" class="tiny">${roundLabel}</text>
<rect x="50" y="${157+headerOffset}" width="500" height="2" fill="#363636"/><rect x="50" y="${178+headerOffset}" width="${Math.min(300, Math.max(130, initial.length * 8 + 48))}" height="31" rx="15" fill="${live?"#d83939":"#f1c94b"}"/><circle cx="68" cy="${193.5+headerOffset}" r="4" fill="${live?"#fff":"#111"}"/><text x="82" y="${198+headerOffset}" class="badge">${esc(initial)}</text>
<rect x="50" y="234" width="228" height="276" rx="16" fill="url(#photo)" stroke="#333"/><rect x="322" y="234" width="228" height="276" rx="16" fill="url(#photo)" stroke="#333"/>
<image href="${esc(playerImage(one))}" x="50" y="234" width="228" height="220" preserveAspectRatio="xMidYMid slice"/><image href="${esc(playerImage(two))}" x="322" y="234" width="228" height="220" preserveAspectRatio="xMidYMid slice"/>
<rect x="50" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/><rect x="322" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/>${wrappedText(p1,66,464,18,20,"player")}${wrappedText(p2,338,464,18,20,"player")}
<circle cx="300" cy="372" r…91 tokens truncated…ext x="530" y="604" class="col">${live?"PTS":""}</text>${scoreRows}
<rect x="50" y="755" width="500" height="1" fill="#333"/><text x="50" y="792" class="tiny">${esc(fmtTime(start))}</text><text x="50" y="824" class="foot">${esc(venue.toUpperCase())}  •  ${esc(round.toUpperCase())}</text><text x="50" y="863" class="foot">${esc(eventName.toUpperCase())}  /  ESPN SCOREBOARD</text>${sourceError}<rect x="504" y="780" width="48" height="48" rx="9" fill="#f2f3f5"/><image href="${esc(leagueLogo)}" x="508" y="784" width="40" height="40" preserveAspectRatio="xMidYMid meet" opacity=".9"/>
</svg>`;
  return svg;
}

function renderTeamPoster({league, sport, item, leagueLogo, error}) {
  const c=item?.competition, event=item?.event;
  const teams=[...(c?.competitors||[])].sort((a,b)=>(a.order||0)-(b.order||0));
  const home=teams.find(t=>t.homeAway==="home")||teams[0], away=teams.find(t=>t.homeAway==="away")||teams[1];
  const live=c&&matchState(c)==="live", upcoming=!c||matchState(c)==="pre";
  const status=c?.status||{}, clock=status.displayClock||status.type?.shortDetail||status.type?.detail||"";
  const statusLabel=live?`LIVE${clock?` • ${clock}`:""}`:upcoming?countdown(c?.date):"FINAL";
  const eventName=event?.name||`${away?.team?.displayName||"Away"} at ${home?.team?.displayName||"Home"}`;
  const headerOffset=wrapLines(eventName,27).length>1?16:0;
  const venue=knownValue(c?.venue?.fullName)||knownValue(c?.venue?.address?.city);
  const round=c?.season?.type?.name||c?.week?.text||c?.week?.number&&`WEEK ${c.week.number}`||"REGULAR SEASON";
  const teamName=t=>t?.team?.displayName||t?.team?.name||"TBD";
  const teamLogo=t=>highResLogo(t?.team?.logos?.[0]?.href||t?.team?.logo||"");
  const awayLogo=teamLogo(away),homeLogo=teamLogo(home);
  const eventLogo=highResLogo(event?.images?.[0]?.url||event?.images?.[0]?.href||leagueLogo);
  const rawPeriodCount=Math.max(home?.linescores?.length||0,away?.linescores?.length||0);
  const family=sport.family;
  let periodSlots, scoreIndex, colStart=332, colGap=32;
  if(family==="baseball"){
    const innings=Math.max(9,rawPeriodCount);
    periodSlots=[...Array.from({length:Math.min(innings,10)},(_,i)=>i===9?"EX":String(i+1))];
    scoreIndex=periodSlots.map((_,i)=>i);
    colStart=235; colGap=25;
  } else if(family==="cricket"){
    periodSlots=["1ST INN","2ND INN",...(rawPeriodCount>2?["3RD","4TH"]:[])];
    scoreIndex=periodSlots.map((_,i)=>i);
    colStart=365; colGap=70;
  } else if(family==="sets"){
    const setCount=Math.max(5,rawPeriodCount);
    periodSlots=Array.from({length:Math.min(setCount,5)},(_,i)=>`S${i+1}`);
    scoreIndex=periodSlots.map((_,i)=>i);
    colStart=365; colGap=42;
  } else if(family==="hockey"){
    periodSlots=["1P","2P","INT","3P",...(rawPeriodCount>3?["OT",...(rawPeriodCount>4?["SO"]:[])]:[])];
    scoreIndex=[0,1,null,2,...(rawPeriodCount>3?[3,...(rawPeriodCount>4?[4]:[])]:[])];
    colStart=332; colGap=34;
  } else if(family==="nrl"||family==="rugby"||family==="soccer"){
    periodSlots=["1H","HT","2H",...(rawPeriodCount>2?[family==="nrl"?"GP":"ET",...(rawPeriodCount>3?["PK"]:[])]:[])];
    scoreIndex=[0,null,1,...(rawPeriodCount>2?[2,...(rawPeriodCount>3?[3]:[])]:[])];
    colStart=365; colGap=42;
  } else {
    // Basketball, American football, AFL and lacrosse.
    periodSlots=["Q1","Q2","HT","Q3","Q4",...(rawPeriodCount>4?["OT",...(rawPeriodCount>5?Array.from({length:rawPeriodCount-5},(_,i)=>`${i+2}OT`):[])]:[])];
    scoreIndex=[0,1,null,2,3,...(rawPeriodCount>4?[4,...(rawPeriodCount>5?Array.from({length:rawPeriodCount-5},(_,i)=>i+5):[])]:[])];
  }
  const labels=periodSlots.map((label,i)=>`<text x="${colStart+i*colGap}" y="606" class="col" text-anchor="middle">${label}</text>`).join("");
  const rows=[away,home].map((t,i)=>{
    const y=i===0?651:694, parts=t?.linescores||[];
    const scores=periodSlots.map((_,n)=>{
      const sourceIndex=scoreIndex[n];
      const value=sourceIndex==null?(periodSlots[n]==="HT"?halftimeScore(parts,family):""):periodDisplay(parts[sourceIndex]);
      return value===""?"":`<text x="${colStart+n*colGap}" y="${y}" class="score" text-anchor="middle">${esc(value)}</text>`;
    }).join("");
    return wrappedText(t?.team?.shortDisplayName||teamName(t),72,y,18,19,"player small")+scores+`<text x="525" y="${y}" class="point">${esc(t?.score??"–")}</text>`;
  }).join("");
  const metaLine=[knownValue(String(round)),venue].filter(Boolean).join(" • ");
  const badgeWidth=Math.min(500,Math.max(190,statusLabel.length*10+52));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><linearGradient id="panel" x2="0" y2="1"><stop stop-color="#282828"/><stop offset="1" stop-color="#151515"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:28px;font-weight:800;fill:#fff;letter-spacing:.3px}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.player{font-family:"Arial";font-size:20px;font-weight:900;fill:#fff}.vs{font-family:"Arial";font-size:23px;font-weight:900;letter-spacing:2px;text-anchor:middle;fill:#111}.col{font-family:"Arial";font-size:15px;font-weight:800;fill:#aaa}.score{font-family:"Arial";font-size:23px;font-weight:900;fill:#fff;text-anchor:middle}.point{font-family:"Arial";font-size:30px;font-weight:900;fill:#f1c94b;text-anchor:middle}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs>
<rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>${eventLogo?`<rect x="468" y="30" width="86" height="86" rx="12" fill="#f2f3f5"/><image href="${esc(eventLogo)}" x="472" y="34" width="78" height="78" opacity=".92" preserveAspectRatio="xMidYMid meet"/>`:""}
<text x="50" y="57" class="tiny">ESPN SCOREBOARD  /  ${sport.label}</text>${wrappedText(eventName,50,91,27,31,"event")}${metaLine?`<text x="50" y="${134+headerOffset}" class="tiny">${esc(metaLine.toUpperCase())}</text>`:""}<rect x="50" y="${157+headerOffset}" width="500" height="2" fill="#363636"/>
<rect x="50" y="${178+headerOffset}" width="${badgeWidth}" height="31" rx="15" fill="${live?"#d83939":"#f1c94b"}"/><circle cx="68" cy="${193.5+headerOffset}" r="4" fill="${live?"#fff":"#111"}"/><text x="82" y="${198+headerOffset}" class="badge">${esc(statusLabel)}</text>
<rect x="50" y="234" width="228" height="276" rx="16" fill="url(#panel)" stroke="#333"/><rect x="322" y="234" width="228" height="276" rx="16" fill="url(#panel)" stroke="#333"/>
${awayLogo?`<rect x="75" y="262" width="178" height="178" rx="18" fill="#f2f3f5"/><image href="${esc(awayLogo)}" x="83" y="270" width="162" height="162" preserveAspectRatio="xMidYMid meet"/>`:""}${homeLogo?`<rect x="347" y="262" width="178" height="178" rx="18" fill="#f2f3f5"/><image href="${esc(homeLogo)}" x="355" y="270" width="162" height="162" preserveAspectRatio="xMidYMid meet"/>`:""}
<rect x="50" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/><rect x="322" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/>${wrappedText(away?.team?.shortDisplayName||teamName(away),66,464,18,20,"player")}${wrappedText(home?.team?.shortDisplayName||teamName(home),338,464,18,20,"player")}<circle cx="300" cy="372" r="34" fill="#f1c94b" stroke="#111" stroke-width="6"/><text x="300" y="380" class="vs">VS</text>
<rect x="50" y="538" width="500" height="190" rx="15" fill="#171717" stroke="#343434"/><text x="72" y="574" class="tiny">${live?`LIVE SCORE${clock?` • ${esc(clock)}`:""}`:upcoming?"MATCH SCORECARD":"FINAL SCORE"}</text><text x="72" y="606" class="col">TEAM</text>${labels}<text x="525" y="606" class="col" text-anchor="middle">PTS</text>${rows}
<rect x="50" y="755" width="500" height="1" fill="#333"/><text x="50" y="792" class="tiny">${esc(fmtTime(c?.date))}</text>${metaLine?`<text x="50" y="824" class="foot">${esc(metaLine.toUpperCase())}</text>`:""}<text x="50" y="863" class="foot">${sport.label}  /  ESPN SCOREBOARD</text>${eventLogo?`<rect x="504" y="780" width="48" height="48" rx="9" fill="#f2f3f5"/><image href="${esc(eventLogo)}" x="508" y="784" width="40" height="40" preserveAspectRatio="xMidYMid meet" opacity=".9"/>`:""}${error?`<text x="50" y="884" class="foot">ESPN DATA TEMPORARILY UNAVAILABLE</text>`:""}</svg>`;
}

function competitorStat(competitor, pattern) {
  const stat=(competitor?.statistics||[]).find((x)=>pattern.test(`${x.name||""} ${x.abbreviation||""} ${x.displayName||""}`));
  return stat?.displayValue||stat?.value||"";
}

function statsFromCore(data) {
  return (data?.splits?.categories||[]).flatMap(category=>category.stats||[]);
}

async function enrichRaceTimes(league,item) {
  const competition=item?.competition,event=item?.event;
  const competitors=competition?.competitors||[];
  if(!competition?.id||!event?.id||!competitors.length)return item;
  const slug=encodeURIComponent(league);
  const enriched=await Promise.all(competitors.slice(0,8).map(async competitor=>{
    if(competitor.statistics?.some(stat=>/fastest.?lap|best.?lap|total.?time/i.test(`${stat.name} ${stat.displayName}`)))return competitor;
    try{
      const url=`https://sports.core.api.espn.com/v2/sports/racing/leagues/${slug}/events/${encodeURIComponent(event.id)}/competitions/${encodeURIComponent(competition.id)}/competitors/${encodeURIComponent(competitor.id)}/statistics?lang=en&region=us`;
      const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 ESPN poster"},cache:"no-store",signal:AbortSignal.timeout(11000)});
      if(!response.ok)return competitor;
      const data=await response.json();
      const statistics=statsFromCore(data);
      return {...competitor,statistics};
    }catch{return competitor;}
  }));
  return {...item,competition:{...competition,competitors:competitors.map((competitor,index)=>index<enriched.length?enriched[index]:competitor)}};
}

function raceResult(competitor) {
  const stats=competitor?.statistics||[];
  const find=pattern=>stats.find(stat=>pattern.test(`${stat.name||""} ${stat.displayName||""} ${stat.shortDisplayName||""} ${stat.abbreviation||""}`));
  const total=find(/total.?time|race.?time/i);
  if(total?.displayValue||total?.value)return total.displayValue||total.value;
  const lap=find(/fastest.?lap|best.?lap|lap.?time/i);
  if(lap?.displayValue||lap?.value)return lap.displayValue||lap.value;
  const gap=find(/behind.?time|time.?behind|gap/i);
  if(gap?.displayValue||gap?.value)return gap.displayValue||gap.value;
  return "—";
}

const RACE_COUNTRY_CODES={
  australia:"aus",australian:"aus",britain:"gbr",british:"gbr",unitedkingdom:"gbr",england:"gbr",
  netherlands:"ned",dutch:"ned",italy:"ita",italian:"ita",france:"fra",french:"fra",
  spain:"esp",spanish:"esp",monaco:"mon",monegasque:"mon",canada:"can",canadian:"can",
  japan:"jpn",japanese:"jpn",unitedstates:"usa",american:"usa",mexico:"mex",mexican:"mex",
  germany:"ger",german:"ger",thailand:"tha",thai:"tha",newzealand:"nzl",danish:"den",
  china:"chn",chinese:"chn",finland:"fin",finnish:"fin",brazil:"bra",brazilian:"bra",
};
function raceFlagImage(competitor){
  const athlete=competitor?.athlete||{};
  const direct=athlete.flag?.href||athlete.images?.find(image=>/flag|country/i.test(`${image?.name||""} ${image?.rel||[]}`))?.href;
  if(direct)return highResLogo(direct);
  const country=athlete.country||athlete.nationality||athlete.citizenship||"";
  const raw=typeof country==="string"?country:country.abbreviation||country.code||country.name||country.displayName||"";
  const normalized=String(raw).toLowerCase().replace(/[^a-z]/g,"");
  const code=RACE_COUNTRY_CODES[normalized]||(normalized.length===3?normalized:"");
  return code?`https://a.espncdn.com/i/teamlogos/countries/500/${code}.png`:"";
}

async function fightCenterAthleteHeadshot(athlete, fallbackId) {
  const id = athlete?.id || fallbackId;
  if (!id) return "";
  try {
    const response = await fetch(`${ESPN}/mma/ufc/athletes/${encodeURIComponent(id)}`, {headers:{"user-agent":"Mozilla/5.0 ESPN poster"}, cache:"no-store", signal:AbortSignal.timeout(5000)});
    if (response.ok) {
      const data = await response.json();
      const profile = data?.athlete || data;
      const image = profile?.headshot?.href || profile?.images?.[0]?.href;
      if (image) return image;
    }
  } catch {}
  // FightCenter's scoreboard uses ESPN athlete IDs; its headshot CDN follows this ID pattern.
  return `https://a.espncdn.com/i/headshots/mma/players/full/${encodeURIComponent(id)}.png`;
}

async function enrichFightCenterImages(item){
  const competitors=item?.competition?.competitors||[];
  if(!competitors.length)return item;
  const enriched=await Promise.all(competitors.map(async fighter=>{
    const athlete=fighter.athlete||{};
    if(athlete.headshot?.href||athlete.images?.[0]?.href)return fighter;
    const headshot=await fightCenterAthleteHeadshot(athlete,fighter.id);
    return {...fighter,athlete:{...athlete,...(headshot?{headshot:{href:headshot}}:{})}};
  }));
  return {...item,competition:{...item.competition,competitors:enriched}};
}

export function renderLeaderboardPoster({league,sport,item,items,leagueLogo,error,epgStart,epgStop,epgState}){
  const event=item?.event, competition=item?.competition;
  const participants=[...(competition?.competitors||[])].sort((a,b)=>(Number(a.order)||999)-(Number(b.order)||999)).slice(0,sport.family==="race"?3:5);
  const now=Date.now(),from=Number(epgStart),to=Number(epgStop);
  const epgLive=Number.isFinite(from)&&Number.isFinite(to)&&from>0&&to>from&&now>=from&&now<to;
  const live=epgLive||epgState==="live"||competition&&matchState(competition)==="live";
  const status=competition?.status||{};
  const phase=status.type?.shortDetail||status.type?.detail||competition?.type?.text||competition?.type?.abbreviation||status.displayClock||"EVENT LEADERBOARD";
  const title=event?.name||sport.label;
  const headerOffset=wrapLines(title,27).length>1?16:0;
  const place=knownValue(competition?.venue?.fullName)||knownValue(competition?.venue?.address?.city);
  const header=league==="pga"?"GOLF LEADERBOARD":"LIVE TIMING / CLASSIFICATION";
  const rows=participants.map((p,i)=>{
    const y=580+i*(sport.family==="race"?58:37);
    const position=p.order??i+1;
    const name=playerName(p);
    const result=sport.family==="race"?"":(p.score??competitorStat(p,/score|time|gap|points|strokes|lap|to.?par/i))||"—";
    const detail=sport.family==="race"?"":competitorStat(p,/through|hole|round|lap|status/i);
    const line=detail?`<text x="512" y="${y+14}" class="sub" text-anchor="end">${esc(detail)}</text>`:"";
    const portrait=sport.family==="race"?raceFlagImage(p):sport.family==="leaderboard"?participantImage(p):"";
    const portraitSvg=portrait?`<image href="${esc(portrait)}" x="110" y="${y-22}" width="30" height="22" preserveAspectRatio="xMidYMid meet"/>`:"";
    return `<text x="74" y="${y}" class="rank">${esc(position)}</text>${portraitSvg}${wrappedText(name,portrait?152:128, y,23,17,"rowname")}${sport.family==="race"?"":`<text x="512" y="${y}" class="result" text-anchor="end">${esc(result)}</text>${line}`}`;
  }).join("");
  const eventLogo=event?.images?.[0]?.url||event?.images?.[0]?.href||leagueLogo;
  const logoSvg=eventLogo?`<image href="${esc(eventLogo)}" x="476" y="38" width="70" height="70" preserveAspectRatio="xMidYMid meet"/>`:"";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:28px;font-weight:800;fill:#fff}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.rank{font-family:"Arial";font-size:20px;font-weight:900;fill:#f1c94b}.rowname{font-family:"Arial";font-size:16px;font-weight:700;fill:#fff}.result{font-family:"Arial";font-size:16px;font-weight:900;fill:#f1c94b}.sub{font-family:"Arial";font-size:9px;font-weight:700;letter-spacing:1px;fill:#888}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>${logoSvg}<text x="50" y="57" class="tiny">ESPN ${esc(sport.label)} / ${header}</text>${wrappedText(title,50,91,27,31,"event")}<text x="50" y="136" class="tiny">${esc(String(competition?.type?.text||competition?.round?.displayName||phase).toUpperCase())}</text><rect x="50" y="${157+headerOffset}" width="500" height="2" fill="#363636"/><rect x="50" y="${178+headerOffset}" width="${live?132:Math.min(500,Math.max(190,phase.length*10+52))}" height="31" rx="15" fill="${live?"#d83939":"#f1c94b"}"/><circle cx="68" cy="${193+headerOffset}" r="4" fill="${live?"#fff":"#111"}"/><text x="82" y="${198+headerOffset}" class="badge">${esc(live?`LIVE • ${phase}`:phase)}</text><rect x="50" y="234" width="500" height="250" rx="16" fill="#171717" stroke="#343434"/><text x="76" y="279" class="tiny">${esc(sport.family==="race"?"RACE ORDER":"LEADERBOARD")}</text>${wrappedText(title,76,309,30,27,"event")}${place?`<text x="76" y="354" class="tiny">${esc(place.toUpperCase())}</text>`:""}<rect x="50" y="500" width="500" height="268" rx="15" fill="#171717" stroke="#343434"/><text x="74" y="540" class="tiny">CLASSIFICATION</text>${rows||`<text x="76" y="610" class="rowname">Leaderboard not posted yet</text>`}<text x="50" y="814" class="tiny">${esc(fmtTime(competition?.date||event?.date))}</text><text x="50" y="856" class="foot">${place?`${esc(place.toUpperCase())} • `:""}ESPN ${esc(sport.label)}</text>${error?`<text x="50" y="884" class="foot">ESPN DATA TEMPORARILY UNAVAILABLE</text>`:""}</svg>`;
  return svg;
}

function renderCombatPoster({league,sport,item,leagueLogo,error}){
  const c=item?.competition,event=item?.event;
  const fighters=[...(c?.competitors||[])].sort((a,b)=>(a.order||0)-(b.order||0));
  const a=fighters[0],b=fighters[1];
  const live=c&&matchState(c)==="live", pre=!c||matchState(c)==="pre";
  const status=c?.status||{};
  const clock=status.displayClock||status.type?.shortDetail||status.type?.detail||"";
  const label=live?`ROUND ${status.period||"LIVE"}${clock?` • ${clock}`:""}`:pre?countdown(c?.date):(status.type?.detail||"FINAL");
  const title=event?.name||`${playerName(a)} vs ${playerName(b)}`;
  const headerOffset=wrapLines(title,27).length>1?16:0;
  const meta=c?.type?.text||c?.format?.regulation?.rounds&&`${c.format.regulation.rounds} ROUNDS`||"MAIN CARD";
  const img=x=>x?.athlete?.headshot?.href||x?.athlete?.images?.[0]?.href||x?.athlete?.flag?.href||"";
  const record=x=>x?.athlete?.record||x?.records?.find?.(r=>/overall|total/i.test(`${r.name||""} ${r.abbreviation||""}`))?.summary||x?.records?.overall?.summary||"";
  const monogram=x=>playerName(x).split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase();
  const image=(x,left)=>img(x)?`<image href="${esc(img(x))}" x="${left}" y="234" width="228" height="220" preserveAspectRatio="xMidYMid slice"/>`:`<circle cx="${left+114}" cy="340" r="61" fill="#101010" stroke="#f1c94b" stroke-width="3"/><text x="${left+114}" y="354" text-anchor="middle" style="font-family:"Arial";font-size:42px;font-weight:900;fill:#f1c94b">${esc(monogram(x))}</text>`;
  const recordA=record(a),recordB=record(b);
  const eventImage=event?.images?.[0]?.url||event?.images?.[0]?.href||leagueLogo;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><linearGradient id="panel" x2="0" y2="1"><stop stop-color="#282828"/><stop offset="1" stop-color="#151515"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:24px;font-weight:800;fill:#fff}.fighter{font-family:"Arial";font-size:19px;font-weight:900;fill:#fff}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.vs{font-family:"Arial";font-size:22px;font-weight:900;letter-spacing:2px;text-anchor:middle;fill:#111}.result{font-family:"Arial";font-size:18px;font-weight:800;fill:#f1c94b}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>${eventImage?`<rect x="468" y="30" width="86" height="86" rx="12" fill="#f2f3f5"/><image href="${esc(eventImage)}" x="472" y="34" width="78" height="78" preserveAspectRatio="xMidYMid meet"/>`:""}<text x="50" y="57" class="tiny">ESPN COMBAT • ${esc(sport.label)}</text>${wrappedText(title,50,91,27,31,"event")}<text x="50" y="136" class="tiny">${esc(String(meta).toUpperCase())}</text><rect x="50" y="${157+headerOffset}" width="500" height="2" fill="#363636"/><rect x="50" y="${178+headerOffset}" width="${Math.min(500,Math.max(180,label.length*10+52))}" height="31" rx="15" fill="${live?"#d83939":"#f1c94b"}"/><circle cx="68" cy="${193+headerOffset}" r="4" fill="${live?"#fff":"#111"}"/><text x="82" y="${198+headerOffset}" class="badge">${esc(label)}</text><rect x="50" y="234" width="228" height="276" rx="16" fill="url(#panel)" stroke="#333"/><rect x="322" y="234" width="228" height="276" rx="16" fill="url(#panel)" stroke="#333"/>${image(a,50)}${image(b,322)}<rect x="50" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/><rect x="322" y="428" width="228" height="82" fill="#000" fill-opacity=".72"/>${wrappedText(playerName(a),66,462,18,21,"fighter")}${wrappedText(playerName(b),338,462,18,21,"fighter")}<circle cx="300" cy="372" r="34" fill="#f1c94b" stroke="#111" stroke-width="6"/><text x="300" y="380" class="vs">VS</text><rect x="50" y="538" width="500" height="190" rx="15" fill="#171717" stroke="#343434"/><text x="72" y="574" class="tiny">${live?"LIVE FIGHT":"FIGHT DETAILS"}</text>${recordA?`<text x="72" y="624" class="fighter">${esc(recordA)}</text>`:""}${recordA?`<text x="72" y="655" class="tiny">RECORD</text>`:""}${recordB?`<text x="338" y="624" class="fighter">${esc(recordB)}</text>`:""}${recordB?`<text x="338" y="655" class="tiny">RECORD</text>`:""}<text x="72" y="700" class="result">${esc(c?.status?.type?.detail||c?.status?.type?.shortDetail||meta)}</text><rect x="50" y="755" width="500" height="1" fill="#333"/><text x="50" y="792" class="tiny">${esc(fmtTime(c?.date||event?.date))}</text>${knownValue(c?.venue?.fullName)?`<text x="50" y="832" class="foot">${esc(c.venue.fullName.toUpperCase())}</text>`:""}<text x="50" y="863" class="foot">ESPN EVENT DATA • ${esc(sport.label)}</text>${error?`<text x="50" y="884" class="foot">ESPN DATA TEMPORARILY UNAVAILABLE</text>`:""}</svg>`;
}

function renderTournamentPoster({league,sport,items,item,leagueLogo,error}){
  const event=item?.event;
  const matches=(items||[]).filter(x=>!event||x.event?.id===event.id).slice(0,5);
  const title=event?.name||sport.label;
  const headerOffset=wrapLines(title,27).length>1?16:0;
  const status=item?.competition?.status?.type?.shortDetail||item?.competition?.status?.type?.detail||"TOURNAMENT DRAW";
  const cards=matches.map(({competition:c},i)=>{
    const teams=[...(c?.competitors||[])].sort((a,b)=>(a.order||0)-(b.order||0));
    const y=385+i*73;
    const names=teams.slice(0,2).map(playerName);
    const scores=teams.slice(0,2).map(x=>x.score??"");
    const phase=c?.round?.displayName||c?.type?.text||c?.status?.type?.shortDetail||`MATCH ${i+1}`;
    return `<rect x="72" y="${y-34}" width="456" height="63" rx="10" fill="#202020" stroke="#333"/><text x="90" y="${y-10}" class="sub">${esc(String(phase).toUpperCase())}</text>${wrappedText(`${names[0]||"TBD"}  ${scores[0]}`,90,y+8,40,17,"match")}${wrappedText(`${names[1]||"TBD"}  ${scores[1]}`,90,y+25,40,17,"match")}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:28px;font-weight:800;fill:#fff}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.sub{font-family:"Arial";font-size:10px;font-weight:700;letter-spacing:1.5px;fill:#f1c94b}.match{font-family:"Arial";font-size:14px;font-weight:700;fill:#fff}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/><rect x="468" y="30" width="86" height="86" rx="12" fill="#f2f3f5"/><image href="${esc(event?.images?.[0]?.url||event?.images?.[0]?.href||leagueLogo)}" x="472" y="34" width="78" height="78" preserveAspectRatio="xMidYMid meet"/><text x="50" y="57" class="tiny">ESPN TOURNAMENT • ${esc(sport.label)}</text>${wrappedText(title,50,91,27,31,"event")}<text x="50" y="136" class="tiny">${esc(String(item?.competition?.round?.displayName||"EVENT DRAW").toUpperCase())}</text><rect x="50" y="${157+headerOffset}" width="500" height="2" fill="#363636"/><rect x="50" y="${178+headerOffset}" width="${Math.min(500,Math.max(190,status.length*10+52))}" height="31" rx="15" fill="#f1c94b"/><circle cx="68" cy="${193+headerOffset}" r="4" fill="#111"/><text x="82" y="${198+headerOffset}" class="badge">${esc(status)}</text><text x="72" y="302" class="tiny">${league==="olympics"?"FEATURED EVENTS":"MATCHES • ROUND PROGRESSION"}</text><rect x="50" y="330" width="500" height="438" rx="15" fill="#171717" stroke="#343434"/>${cards||`<text x="90" y="420" class="match">Draw or bracket data is not available yet.</text>`}<text x="50" y="814" class="tiny">${esc(fmtTime(item?.competition?.date||event?.date))}</text><text x="50" y="856" class="foot">${esc((item?.competition?.venue?.fullName||"ESPN EVENT DATA").toUpperCase())}</text>${error?`<text x="50" y="884" class="foot">ESPN DATA TEMPORARILY UNAVAILABLE</text>`:""}</svg>`;
}

function renderUnavailablePoster({sport,league,error,eventId}){
  const heading=error?"ESPN FEED UNAVAILABLE":"NO CURRENT EVENT DATA";
  const mode={leaderboard:"LEADERBOARD",race:"RACE CLASSIFICATION",combat:"FIGHT CARD",tournament:"TOURNAMENT / EVENT",tennis:"MATCH SCOREBOARD"}[sport.family]||"SCOREBOARD";
  const note=eventId?`CHECK EVENT ${eventId}`:"ESPN HAS NOT RETURNED A SCHEDULED EVENT FOR THIS LEAGUE";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#111"/><stop offset="1" stop-color="#050505"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".07"/></pattern><style>.tiny{font-family:"Arial";font-size:14px;font-weight:700;letter-spacing:1.8px;fill:#aaa}.event{font-family:"Arial";font-size:34px;font-weight:900;fill:#fff}.badge{font-family:"Arial";font-size:19px;font-weight:900;letter-spacing:.2px;fill:#111}.foot{font-family:"Arial";font-size:13px;font-weight:700;letter-spacing:1.3px;fill:#999}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/><text x="50" y="57" class="tiny">ESPN EVENT POSTER • ${esc(sport.label)}</text><rect x="50" y="157" width="500" height="2" fill="#363636"/><rect x="50" y="178" width="${Math.min(400,Math.max(180,heading.length*9))}" height="32" rx="16" fill="#f1c94b"/><text x="72" y="199" class="badge">${heading}</text><rect x="50" y="258" width="500" height="400" rx="20" fill="#171717" stroke="#343434"/><text x="300" y="426" class="event" text-anchor="middle">${esc(sport.label)}</text><text x="300" y="470" class="tiny" text-anchor="middle">${esc(mode)}</text><text x="300" y="534" class="tiny" text-anchor="middle">${esc(note)}</text><text x="50" y="814" class="tiny">LIVE POSTER • ESPN SCOREBOARD DATA</text><text x="50" y="856" class="foot">LEAGUE: ${esc(league.toUpperCase())}</text></svg>`;
}

function renderEpgPoster({sport,title,start,stop,channel,leagueLogo,state}){
  const now=Date.now(),from=Number(start),to=Number(stop);
  const live=Number.isFinite(from)&&Number.isFinite(to)&&now>=from&&now<to||state==="live";
  const channelText=String(channel||"").replace(/^next\s*\|\s*/i,"");
  const logo=highResLogo(leagueLogo||"");
  const logoSvg=logo?`<rect x="492" y="22" width="76" height="76" rx="14" fill="#f5f6f8"/><image href="${esc(logo)}" x="499" y="29" width="62" height="62" preserveAspectRatio="xMidYMid meet"/>`:`<rect x="492" y="22" width="76" height="76" rx="14" fill="#252525" stroke="#484848"/><text x="530" y="69" class="mark" text-anchor="middle">${esc(sport.label.slice(0,4))}</text>`;
  const topLeft=live?`<rect x="42" y="31" width="130" height="48" rx="24" fill="#d92332"/><circle cx="66" cy="55" r="8" fill="#fff"/><text x="86" y="64" class="live">LIVE</text>`:`<text x="42" y="62" class="date">${esc(shortSydneyDate(from))}</text>`;
  const lines=wrapLines(title,20).slice(0,5);
  const titleSvg=lines.map((line,i)=>`<text x="300" y="${250+i*65}" class="title" text-anchor="middle">${esc(line)}</text>`).join("");
  const hero=logo?`<rect x="214" y="468" width="172" height="172" rx="25" fill="#f5f6f8"/><image href="${esc(logo)}" x="226" y="480" width="148" height="148" preserveAspectRatio="xMidYMid meet"/>`:`<circle cx="300" cy="554" r="74" fill="#202226" stroke="#4a4d54" stroke-width="3"/><text x="300" y="576" class="eyebrow" text-anchor="middle">${esc(sport.label.slice(0,5))}</text>`;
  const timer=live?"LIVE NOW":countdownLarge(from);
  const channelLine=channelText?`<text x="300" y="700" class="channel" text-anchor="middle">${esc(channelText.toUpperCase().slice(0,42))}</text>`:"";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#101114"/><stop offset="1" stop-color="#050506"/></linearGradient><pattern id="grain" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7" fill="#fff" opacity=".06"/></pattern><style>.date{font-family:"Arial";font-size:25px;font-weight:700;fill:#fff;letter-spacing:.4px}.live{font-family:"Arial";font-size:25px;font-weight:900;fill:#fff;letter-spacing:1px}.mark{font-family:"Arial";font-size:18px;font-weight:900;fill:#20232a}.eyebrow{font-family:"Arial";font-size:20px;font-weight:800;fill:#b8bac1;letter-spacing:2px}.title{font-family:"Arial";font-size:48px;font-weight:900;fill:#fff}.channel{font-family:"Arial";font-size:20px;font-weight:800;fill:#b8bac1;letter-spacing:1px}.caption{font-family:"Arial";font-size:22px;font-weight:800;fill:#a7a8ad;letter-spacing:2px}.timer{font-family:"Arial";font-size:58px;font-weight:900;fill:#f4cc4e;letter-spacing:1px}</style></defs><rect width="600" height="900" fill="url(#bg)"/><rect width="600" height="900" fill="url(#grain)"/>${topLeft}${logoSvg}<text x="300" y="176" class="eyebrow" text-anchor="middle">${esc(sport.label)} • LIVE EVENT</text>${titleSvg}${hero}<text x="300" y="677" class="caption" text-anchor="middle">${live?"ON AIR":"STARTS IN"}</text><text x="300" y="765" class="timer" text-anchor="middle">${esc(timer)}</text>${channelLine}<text x="300" y="850" class="eyebrow" text-anchor="middle">EVENT POSTER • ESPN + FLIX EPG</text></svg>`;
}

const posterImageCache=new Map();
async function inlinePosterImages(svg){
  const urls=[...new Set([...svg.matchAll(/<image\b[^>]*\bhref="([^\"]+)"/g)].map(match=>unescapeHtml(match[1])).filter(url=>/^https?:\/\//i.test(url)))];
  await Promise.all(urls.map(async url=>{
    try{
      const cached=posterImageCache.get(url);
      let dataUri=cached&&cached.until>Date.now()?cached.dataUri:"";
      if(!dataUri){
        // ESPN's CDN can take 10–16s to answer from a cold serverless region.
        // The previous 4.5s timeout made valid logos disappear from otherwise
        // successful posters. Fetch all requested assets concurrently below.
        const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 ESPN Poster Image"},cache:"force-cache",signal:AbortSignal.timeout(18_000)});
        if(!response.ok)return;
        const length=Number(response.headers.get("content-length")||0);if(length>4_000_000)return;
        const source=Buffer.from(await response.arrayBuffer());if(source.length>4_000_000)return;
        const pipeline=sharp(source,{limitInputPixels:40_000_000}).resize({width:800,height:800,fit:"inside",withoutEnlargement:true}).ensureAlpha();
        let png;
        if(isTeamLogoUrl(url)){
          const {data,info}=await pipeline.raw().toBuffer({resolveWithObject:true});
          const transparent=removeEdgeWhiteBackground(data,info.width,info.height);
          png=await sharp(transparent,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
        }else png=await pipeline.png().toBuffer();
        dataUri=`data:image/png;base64,${png.toString("base64")}`;
        posterImageCache.set(url,{dataUri,until:Date.now()+6*60*60_000});
      }
      svg=svg.split(esc(url)).join(dataUri).split(url).join(dataUri);
    }catch(error){console.warn("Unable to inline ESPN poster image",url,error?.message||error);}
  }));
  return svg;
}

async function pngResponse(svg){
  // librsvg (sharp) silently substitutes missing fonts in some serverless
  // deployments, producing tofu boxes. Resvg loads the bundled font explicitly
  // and renders the poster text to the PNG on the server.
  const withImages=await inlinePosterImages(svg);
  const rendered=withImages.replace(/Arial/g,"DejaVu Sans").replaceAll("</feFilter></filter>","</feMerge></filter>");
  const png=new Resvg(rendered,{font:{fontFiles:[POSTER_FONT_PATH],loadSystemFonts:false,defaultFontFamily:"DejaVu Sans"}}).render().asPng();
  // Keep poster pixels in step with the 30-second catalog URL revision. A
  // longer image TTL made new scores wait on stale PNGs even after a catalog
  // refresh had returned updated metadata.
  return new Response(png,{status:200,headers:{"content-type":"image/png","cache-control":"public, max-age=30, s-maxage=30, stale-while-revalidate=60","access-control-allow-origin":"*"}});
}

export async function GET(request) {
  const {searchParams}=new URL(request.url);
  const league=(searchParams.get("league")||"atp").toLowerCase();
  const sport=SPORTS[league];
  if(!sport)return new Response(JSON.stringify({error:"Unknown league",supported:Object.keys(SPORTS)}),{status:400,headers:{"content-type":"application/json"}});
  const epgTitle=searchParams.get("epgTitle");
  if(epgTitle){
    const start=Number(searchParams.get("epgStart"))||Date.now(),stop=Number(searchParams.get("epgStop"))||0;
    const requestedDate=searchParams.get("dates")||dateInSydney(new Date(start));
    const epgChannel=searchParams.get("epgChannel")||"";
    let item=null,leagueLogo="",schedule={items:[]};
    try{
      schedule=await getEpgSchedule(sport,league,requestedDate);
      leagueLogo=await epgLeagueLogo(sport,league,epgTitle,epgChannel)||schedule.leagueLogo||"";
      item=matchEpgItem(epgTitle,start,stop,schedule.items);
    }catch{}
    const epgState=searchParams.get("epgState");
    if(sport.family==="combat"&&league==="ufc"&&item)item=await enrichFightCenterImages(item);
    const matchup=["leaderboard","race"].includes(sport.family)?item:item||syntheticEpgMatch(epgTitle,start,epgState);
    if(matchup&&["basketball","soccer","football","afl","nrl","rugby","hockey","baseball","cricket"].includes(sport.family))await enrichEpgTeamImages(matchup,sport);
    const body=matchup&&["leaderboard","race"].includes(sport.family)
      ?renderLeaderboardPoster({league,sport,item:matchup,items:schedule.items,leagueLogo,epgStart:start,epgStop:stop,epgState})
      :matchup?renderMatchupPoster({league,sport,item:matchup,leagueLogo,epgStart:start,epgStop:stop,epgState,epgTitle})
      :renderEpgPoster({sport,title:epgTitle,start,stop,channel:epgChannel,leagueLogo,state:epgState});
    return pngResponse(body);
  }
  let item=null,leagueLogo="",error=false,items=[],now=new Date();
  try{
    const requestedDate=searchParams.get("dates")||"";
    const eventId=searchParams.get("event")||"";
    if(requestedDate&&!/^\d{8}$/.test(requestedDate))return new Response(JSON.stringify({error:"dates must use YYYYMMDD"}),{status:400,headers:{"content-type":"application/json"}});
    const result=await getSchedule(sport,league,requestedDate,eventId);
    now=result.now; items=result.items; leagueLogo=result.leagueLogo;
    if(eventId)items=items.filter(({event,competition})=>event?.id===eventId||competition?.id===eventId||competition?.uid?.includes(`~e:${eventId}~`));
    const family=sport.family;
    const usesRanking=["leaderboard","race"].includes(family);
    const candidates=items.filter(({competition:c})=>{
      const competitors=c?.competitors||[];
      return usesRanking?competitors.length>0:competitors.length>=2;
    });
    const live=candidates.filter(({competition:c})=>matchState(c)==="live").sort((a,b)=>new Date(a.competition.date||a.event?.date)-new Date(b.competition.date||b.event?.date));
    const upcoming=candidates.filter(({competition:c})=>{
      const start=new Date(c.date||0).getTime();
      return matchState(c)==="pre"&&start>=now.getTime()-2*60*60*1000;
    }).sort((a,b)=>new Date(a.competition.date||a.event?.date)-new Date(b.competition.date||b.event?.date));
    const finals=candidates.filter(({competition:c})=>matchState(c)==="final").sort((a,b)=>new Date(b.competition.date||b.event?.date)-new Date(a.competition.date||a.event?.date));
    item=live[0]||upcoming[0]||finals[0]||candidates[0]||null;
    if(usesRanking){
      const ranked=[...candidates].sort((a,b)=>(b.competition.competitors?.length||0)-(a.competition.competitors?.length||0));
      item=live[0]||ranked[0]||upcoming[0]||finals[0]||null;
    }
  }catch{error=true;}
  const view=(searchParams.get("view")||"").toLowerCase();
  const eventId=searchParams.get("event")||"";
  const minimum=sport.family==="leaderboard"||sport.family==="race"?1:sport.family==="tournament"?1:2;
  const hasRequiredData=(item?.competition?.competitors?.length||0)>=minimum;
  let body;
  if(!hasRequiredData)body=renderUnavailablePoster({sport,league,error,eventId});
  else if(view==="tournament"||sport.family==="tournament")body=(item?.competition?.competitors?.length||0)>=2?renderMatchupPoster({league,sport,item,leagueLogo,error}):renderTournamentPoster({league,sport,items,item,leagueLogo,error});
  else if(view==="combat"||sport.family==="combat"){
    if(league==="ufc"&&item?.competition?.competitors){
      item=await enrichFightCenterImages(item);
    }
    body=renderMatchupPoster({league,sport,item,leagueLogo,error});
  }
  else if(view==="leaderboard"||["leaderboard","race"].includes(sport.family))body=renderLeaderboardPoster({league,sport,item,items,leagueLogo,error});
  else body=renderMatchupPoster({league,sport,item,leagueLogo,error});
  return pngResponse(body);
}
