const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function plainText(html="") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&")
    .replace(/&#x27;|&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"')
    .replace(/\s+/g," ").trim();
}

/** ESPN's boxing scoreboard API is unavailable; parse its maintained schedule article. */
export function parseBoxingSchedule(html, referenceDate=new Date()) {
  const text=plainText(html);
  const yearMatch=text.match(/(?:\d{4}\s+)?boxing schedule|boxing schedule[^\d]*(20\d{2})/i);
  const pageYear=Number(yearMatch?.[1])||referenceDate.getUTCFullYear();
  const re=/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}):\s*([^;]{2,150}?)\s*(?:—|–|--|\u2014)\s*Title fight:\s*([^,;]+?)\s+vs\.?\s+([^,;]+?),\s*(\d+)\s+rounds/gi;
  const found=[];
  for(const match of text.matchAll(re)) {
    const month=MONTHS[match[1].slice(0,3).toLowerCase()],day=Number(match[2]);
    let year=pageYear;
    const candidate=new Date(Date.UTC(year,month,day,23));
    // When an article's schedule spans New Year, roll dates more than 180 days
    // behind the reference date into the following year.
    if(candidate.getTime()<referenceDate.getTime()-180*86_400_000)year++;
    const start=new Date(Date.UTC(year,month,day,23,0));
    const venue=match[3].trim().replace(/\s*\([^)]*\)\s*$/," ").trim();
    const fighter1=match[4].trim(),fighter2=match[5].trim();
    const id=`boxing-${start.toISOString().slice(0,10).replace(/-/g,"")}-${`${fighter1}-${fighter2}`.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}`;
    found.push({id,name:`${fighter1} vs ${fighter2}`,date:start.toISOString(),venue,fighters:[fighter1,fighter2],rounds:Number(match[6])});
  }
  return [...new Map(found.map(event=>[event.id,event])).values()];
}

