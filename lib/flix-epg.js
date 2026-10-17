import {gunzipSync} from "node:zlib";

const EPG_SOURCES=["dream","strong","trex"];
const EPG_BASE="https://live.flixnest.app/u/3wn3lkvmvbnq";
const EPG_TTL=10*60_000;
const EPG_PARTIAL_TTL=2*60_000;
let cachedSnapshot=null;
let cachedUntil=0;
let pendingAll=null;
let pendingFirst=null;

function xmlText(value){
  return String(value||"").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity)=>{
    if(entity[0]==="#"){
      const hex=entity[1]?.toLowerCase()==="x";
      const code=Number.parseInt(entity.slice(hex?2:1),hex?16:10);
      return Number.isFinite(code)?String.fromCodePoint(code):_;
    }
    return {amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[entity.toLowerCase()]||_;
  });
}

export function parseXmltvTime(value){
  const m=String(value||"").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s+([+-])(\d{2})(\d{2})$/);
  if(!m)return null;
  const local=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]));
  const offset=(Number(m[8])*60+Number(m[9]))*(m[7]==="+"?1:-1);
  return local-offset*60_000;
}

function tagText(block,tag){
  const value=block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,`i`))?.[1];
  return value?xmlText(value.replace(/<[^>]*>/g,"")).trim():"";
}
function attributes(raw){
  return Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],xmlText(m[2])]));
}
function isEventChannelLabel(value){
  const label=xmlText(value).trim();
  if(/^next\s*\|/i.test(label))return true;
  // Provider event feeds also arrive under labels such as
  // `EL TV 007 | Team A vs Team B`, without the legacy `Next |` prefix.
  // Let recognizable fixture/tournament names through; league and event
  // validation below prevents ordinary channels from becoming catalog cards.
  return /\b(?:vs\.?|versus|v\.?)\b|@|\s[-–—]\s|\b(?:grand prix|fight night|main card|wimbledon|roland garros|australian open|shanghai masters|wuhan open|pga tour|lpga tour|liv golf|dp world tour|formula one|formula 1|nascar|indycar)\b/i.test(label);
}
export function parseEventChannels(xml){
  const byId=new Map();
  for(const match of xml.matchAll(/<channel\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi)){
    const names=[...match[2].matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/gi)].map(x=>xmlText(x[1]).trim());
    const label=names.find(isEventChannelLabel);
    if(label)byId.set(match[1],{id:match[1],label,programmes:[]});
  }
  for(const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)){
    const attrs=attributes(match[1]),channel=byId.get(attrs.channel);
    if(!channel)continue;
    const start=parseXmltvTime(attrs.start),stop=parseXmltvTime(attrs.stop);
    if(!Number.isFinite(start)||!Number.isFinite(stop)||stop<=start)continue;
    channel.programmes.push({start,stop,title:tagText(match[2],"title"),description:tagText(match[2],"desc")});
  }
  return [...byId.values()];
}

function parseWindow(xml){
  let start=Infinity,end=-Infinity;
  for(const match of xml.matchAll(/<programme\b([^>]*)>/gi)){
    const attrs=match[1];
    const from=attrs.match(/\bstart="([^"]+)"/i)?.[1];
    const to=attrs.match(/\bstop="([^"]+)"/i)?.[1];
    const a=parseXmltvTime(from),b=parseXmltvTime(to);
    if(Number.isFinite(a))start=Math.min(start,a);
    if(Number.isFinite(b))end=Math.max(end,b);
  }
  return {start:Number.isFinite(start)?start:null,end:Number.isFinite(end)?end:null};
}

async function loadSource(source){
  const url=`${EPG_BASE}.${source}/live/epg.xml.gz`;
  // Let Next's shared data cache serve these large, compressed schedules across
  // serverless invocations. A short timeout prevents one stalled source from
  // holding the catalogs open; the remaining feeds still provide a snapshot.
  const response=await fetch(url,{next:{revalidate:300},signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error(`${source} EPG upstream ${response.status}`);
  const compressed=Buffer.from(await response.arrayBuffer());
  const xml=gunzipSync(compressed).toString("utf8");
  return {source,channels:parseEventChannels(xml).map(channel=>({...channel,source})),...parseWindow(xml)};
}

export function mergeEpgSnapshots(snapshots){
  const valid=snapshots.filter(snapshot=>snapshot&&Array.isArray(snapshot.channels));
  const start=valid.reduce((value,snapshot)=>Number.isFinite(snapshot.start)?Math.min(value,snapshot.start):value,Infinity);
  const end=valid.reduce((value,snapshot)=>Number.isFinite(snapshot.end)?Math.max(value,snapshot.end):value,-Infinity);
  return {
    sources:valid.map(snapshot=>snapshot.source),
    channels:valid.flatMap(snapshot=>snapshot.channels),
    start:Number.isFinite(start)?start:null,
    end:Number.isFinite(end)?end:null,
  };
}

function summarizeResults(results){
  const snapshots=results.filter(result=>result.status==="fulfilled").map(result=>result.value);
  const sourceHealth=results.map((result,index)=>{
    const source=EPG_SOURCES[index];
    if(result.status==="rejected")return {source,ok:false,error:result.reason?.name||"FetchError"};
    const snapshot=result.value;
    return {source,ok:true,channels:snapshot.channels.length,programmes:snapshot.channels.reduce((sum,channel)=>sum+channel.programmes.length,0)};
  });
  return {...mergeEpgSnapshots(snapshots),sourceHealth,allSourcesFailed:snapshots.length===0};
}

function startSnapshotLoad(){
  const loads=EPG_SOURCES.map(loadSource);
  pendingFirst=Promise.any(loads).then(first=>{
    if(!cachedSnapshot?.channels?.length){
      const partial={...mergeEpgSnapshots([first]),sourceHealth:[{source:first.source,ok:true,channels:first.channels.length,programmes:first.channels.reduce((n,c)=>n+c.programmes.length,0)}],allSourcesFailed:false};
      cachedSnapshot=partial;
      cachedUntil=Date.now()+EPG_PARTIAL_TTL;
    }
    return cachedSnapshot;
  }).catch(()=>cachedSnapshot||{...mergeEpgSnapshots([]),sourceHealth:[],allSourcesFailed:true});
  pendingAll=Promise.allSettled(loads).then(results=>{
    const snapshot=summarizeResults(results);
    if(snapshot.channels.length||!cachedSnapshot)cachedSnapshot=snapshot;
    const anySource=snapshot.sourceHealth?.some(source=>source.ok);
    const everySource=snapshot.sourceHealth?.every(source=>source.ok);
    cachedUntil=Date.now()+(everySource?EPG_TTL:anySource?EPG_PARTIAL_TTL:20_000);
    return cachedSnapshot;
  }).finally(()=>{pendingAll=null;pendingFirst=null;});
}

export async function getFlixEpgSnapshot({waitForAll=false}={}){
  if(cachedSnapshot&&cachedUntil>Date.now()&&(!waitForAll||cachedSnapshot.sourceHealth?.length===EPG_SOURCES.length))return cachedSnapshot;
  if(!pendingAll)startSnapshotLoad();
  return waitForAll?pendingAll:pendingFirst;
}

const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const OFFSETS={UTC:0,GMT:0,WET:0,WEST:60,CET:60,CEST:120,EET:120,EEST:180,BST:60,
  EST:-300,EDT:-240,CST:-360,CDT:-300,MST:-420,MDT:-360,PST:-480,PDT:-420,
  JST:540,KST:540,AEST:600,AEDT:660};
function toUtc(year,month,day,hour,minute,zone){
  const offset=OFFSETS[String(zone||"").toUpperCase()];
  if(offset===undefined)return null;
  return Date.UTC(year,month,day,hour,minute)-offset*60_000;
}
function clockParts(label){
  const match=label.match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?\s*(?:\(([A-Z]{2,5})\)|\b([A-Z]{2,5})\b)/i);
  if(!match)return null;
  let hour=Number(match[1]);
  if(match[3]){hour%=12;if(match[3].toUpperCase()==="PM")hour+=12;}
  return {hour,minute:Number(match[2]),zone:(match[4]||match[5]||"").toUpperCase()};
}

// EPG event times appear in channel labels, not the repeating XMLTV programme
// blocks. Convert that wall clock to an absolute UTC instant for ESPN matching.
export function epgStartTime(label,targetStart){
  // Event-only channels may include a UTC timestamp without an explicit zone,
  // e.g. `Team A vs Team B (2026-10-17 08:30:00)`.
  const isoTime=String(label||"").match(/\b(20\d{2})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if(isoTime){
    return Date.UTC(Number(isoTime[1]),Number(isoTime[2])-1,Number(isoTime[3]),Number(isoTime[4]),Number(isoTime[5]),Number(isoTime[6]||0));
  }
  const clock=clockParts(label);
  if(!clock)return null;
  let date;
  const iso=label.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if(iso)date={year:Number(iso[1]),month:Number(iso[2])-1,day:Number(iso[3])};
  if(!date){
    const named=label.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\s+([A-Z][a-z]{2})\b/i);
    if(named){
      const month=MONTHS[named[2].toLowerCase()];
      if(month!==undefined)date={year:new Date(targetStart).getUTCFullYear(),month,day:Number(named[1])};
    }
  }
  if(date)return toUtc(date.year,date.month,date.day,clock.hour,clock.minute,clock.zone);

  // Some event labels omit the date. Choose the matching clock time nearest
  // the ESPN event date, but only after lexical event matching by the caller.
  if(!Number.isFinite(targetStart))return null;
  const base=new Date(targetStart);
  const candidates=[-1,0,1].map(delta=>{
    const d=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()+delta));
    return toUtc(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),clock.hour,clock.minute,clock.zone);
  }).filter(Number.isFinite);
  return candidates.sort((a,b)=>Math.abs(a-targetStart)-Math.abs(b-targetStart))[0]??null;
}

// XMLTV times are absolute instants. The stop boundary is exclusive, matching
// standard EPG semantics: a programme is live at start and not live at stop.
export function epgStatus(programme,now=Date.now()){
  if(!programme||!Number.isFinite(programme.start)||!Number.isFinite(programme.stop))return null;
  if(now<programme.start)return "upcoming";
  if(now<programme.stop)return "live";
  return "finished";
}
