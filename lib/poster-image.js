// Remove only near-white pixels connected to the image edge, so white marks
// inside a logo remain intact instead of being punched out.
export function removeEdgeWhiteBackground(raw,width,height,{threshold=232,spread=24}={}) {
  const pixels=width*height,seen=new Uint8Array(pixels),queue=new Int32Array(pixels);
  const isBackground=index=>{
    const i=index*4,r=raw[i],g=raw[i+1],b=raw[i+2];
    return r>=threshold&&g>=threshold&&b>=threshold&&Math.max(r,g,b)-Math.min(r,g,b)<=spread;
  };
  let head=0,tail=0;
  const add=index=>{if(index>=0&&index<pixels&&!seen[index]&&isBackground(index)){seen[index]=1;queue[tail++]=index;}};
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=1;y<height-1;y++){add(y*width);add(y*width+width-1);}
  while(head<tail){
    const index=queue[head++],x=index%width;
    if(x)add(index-1);if(x<width-1)add(index+1);
    if(index>=width)add(index-width);if(index<pixels-width)add(index+width);
  }
  for(let i=0;i<tail;i++)raw[queue[i]*4+3]=0;
  return raw;
}

export function isTeamLogoUrl(url="") {
  return /(?:teamlogos|\/logos?\/|\/logo\b|img=\/teamlogos|\/combiner\/i\?img=.*\blogos?\b)/i.test(String(url));
}

// Put the image on a vivid complementary card color. Force a useful
// saturation/lightness so dark team colors (for example Tampa Bay blue) do
// not produce another dark, nearly identical background.
export function complementaryPosterColor(hex="4f91ff") {
  const value=String(hex).replace(/^#/ ,"");
  if(!/^[0-9a-f]{6}$/i.test(value))return "#d9823b";
  const r=parseInt(value.slice(0,2),16)/255,g=parseInt(value.slice(2,4),16)/255,b=parseInt(value.slice(4,6),16)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let hue=0;
  if(delta){
    if(max===r)hue=60*(((g-b)/delta)%6);
    else if(max===g)hue=60*((b-r)/delta+2);
    else hue=60*((r-g)/delta+4);
  }
  hue=(hue+180+360)%360;
  const saturation=.68,lightness=.44,chroma=(1-Math.abs(2*lightness-1))*saturation,x=chroma*(1-Math.abs((hue/60)%2-1)),m=lightness-chroma/2;
  const [rr,gg,bb]=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]:hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
  return `#${[rr,gg,bb].map(channel=>Math.round((channel+m)*255).toString(16).padStart(2,"0")).join("")}`;
}
