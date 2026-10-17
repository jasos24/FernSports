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
