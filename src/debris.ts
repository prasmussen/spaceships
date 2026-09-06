export interface DebrisBody {x:number;y:number;vx:number;vy:number;size:number;angle:number;spin:number}

/** Cosmetic swept collision against the cave's solid rectangles. */
export function moveDebris(p:DebrisBody,dt:number,solids:readonly (readonly number[])[]){
  const radius=p.size*1.1;
  p.vy+=190*dt;p.angle+=p.spin*dt;
  let remaining=dt;
  for(let bounce=0;bounce<6&&remaining>0;bounce++){
    let time=1,nx=0,ny=0;
    const dx=p.vx*remaining,dy=p.vy*remaining;
    for(const rect of solids){
      const left=rect[0]-radius,top=rect[1]-radius,right=rect[2]+radius,bottom=rect[3]+radius;
      // A hull chip can be born partly inside the wall at the crash point.
      if(p.x>left&&p.x<right&&p.y>top&&p.y<bottom){
        nx=0;ny=0;
        const distances=[p.x-left,right-p.x,p.y-top,bottom-p.y];
        const side=distances.indexOf(Math.min(...distances));
        if(side===0){p.x=left-.001;nx=-1;}else if(side===1){p.x=right+.001;nx=1;}
        else if(side===2){p.y=top-.001;ny=-1;}else{p.y=bottom+.001;ny=1;}
        time=0;break;
      }
      const tx0=dx===0?-Infinity:Math.min((left-p.x)/dx,(right-p.x)/dx);
      const tx1=dx===0?Infinity:Math.max((left-p.x)/dx,(right-p.x)/dx);
      const ty0=dy===0?-Infinity:Math.min((top-p.y)/dy,(bottom-p.y)/dy);
      const ty1=dy===0?Infinity:Math.max((top-p.y)/dy,(bottom-p.y)/dy);
      if((dx===0&&(p.x<left||p.x>right))||(dy===0&&(p.y<top||p.y>bottom)))continue;
      const enter=Math.max(tx0,ty0),exit=Math.min(tx1,ty1);
      if(enter<0||enter>exit||enter>time)continue;
      time=enter;nx=tx0>=ty0?-Math.sign(dx):0;ny=ty0>tx0?-Math.sign(dy):0;
    }
    p.x+=dx*time;p.y+=dy*time;
    if(nx===0&&ny===0)return;
    p.x+=nx*.001;p.y+=ny*.001;
    const normal=p.vx*nx+p.vy*ny;
    if(normal<0){p.vx-=1.5*normal*nx;p.vy-=1.5*normal*ny;}
    if(nx)p.vy*=.8;else p.vx*=.8;
    p.spin*=-.6;remaining*=1-time;
  }
}
