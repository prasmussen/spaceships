type Pose={tick:number;x:number;y:number;angle:number;vx:number;vy:number};
type FragmentPose={x:number;y:number;angle:number;life:number};

/** Presentation-only history keyed by entity ID, so reused pool slots never blend. */
export class FragmentInterpolation {
  private frames:{tick:number;poses:Map<number,FragmentPose>}[]=[];
  private clock=0;
  private previousTime=0;
  private revision=0;
  sample(state:Int32Array,now:number,reset=false,revision=0){
    const tick=state[0],poses=new Map<number,FragmentPose>();
    for(let i=0;i<256;i++){
      const o=48+i*8;
      if(state[o+7]&&state[o+4]>0)poses.set(state[o+6],{x:state[o]/65536,y:state[o+1]/65536,angle:(state[o+7]>>>5)&4095,life:state[o+4]});
    }
    const last=this.frames.at(-1),frame={tick,poses};
    if(reset||!last||revision!==this.revision||tick<last.tick||tick-last.tick>12||now-this.previousTime>200){
      this.frames=[frame];this.clock=tick-2;
    }else{
      this.clock=Math.min(tick,this.clock+Math.max(0,now-this.previousTime)*60/1000);
      if(tick-this.clock>4)this.clock=tick-2;
      if(tick>last.tick)this.frames.push(frame);else this.frames[this.frames.length-1]=frame;
    }
    this.previousTime=now;this.revision=revision;
    while(this.frames.length>2&&this.frames[1].tick<=this.clock)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const alpha=a.tick===b.tick?1:Math.max(0,Math.min(1,(this.clock-a.tick)/(b.tick-a.tick)));
    const result=new Map<number,FragmentPose>();
    for(const [id,current]of poses){
      const from=a.poses.get(id),to=b.poses.get(id);
      if(!from||!to){result.set(id,{...current,angle:current.angle*Math.PI/2048});continue;}
      const turn=((to.angle-from.angle+6144)%4096)-2048;
      result.set(id,{x:from.x+(to.x-from.x)*alpha,y:from.y+(to.y-from.y)*alpha,
        angle:(from.angle+turn*alpha)*Math.PI/2048,life:from.life+(to.life-from.life)*alpha});
    }
    return result;
  }
}

/** Render on a continuous clock two ticks behind the worker, absorbing delivery jitter. */
export class FlightInterpolation {
  private frames:Pose[]=[];
  private clock=0;
  private previousTime=0;
  private alive=false;
  private grounded=false;
  sample(state:Int32Array,player:number,now:number,reset=false){
    const o=16+player*16,tick=state[0],alive=state[o+7]>0,grounded=!!state[o+8];
    const pose:Pose={tick,x:state[o]/65536,y:state[o+1]/65536,angle:state[o+4],vx:state[o+2]/65536,vy:state[o+3]/65536};
    const last=this.frames.at(-1);
    const discontinuity=last&&(tick<last.tick||tick-last.tick>12||alive!==this.alive||grounded!==this.grounded||
      Math.hypot(pose.x-last.x-last.vx*(tick-last.tick),pose.y-last.y-last.vy*(tick-last.tick))>32);
    if(reset||!last||discontinuity||now-this.previousTime>200){
      this.frames=[pose];this.clock=tick-2;
    }else{
      this.clock+=Math.max(0,now-this.previousTime)*60/1000;
      if(tick>last.tick)this.frames.push(pose);
      else this.frames[this.frames.length-1]=pose;
      // Stop at the newest known state during pauses; retain a small buffer on resume.
      if(this.clock>tick)this.clock=tick;
      if(tick-this.clock>4)this.clock=tick-2;
    }
    this.previousTime=now;this.alive=alive;this.grounded=grounded;
    while(this.frames.length>2&&this.frames[1].tick<=this.clock)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const alpha=b.tick===a.tick?1:Math.max(0,Math.min(1,(this.clock-a.tick)/(b.tick-a.tick)));
    const lerp=(a:number,b:number)=>a+(b-a)*alpha;
    // Angles wrap at 4096; interpolate across the shortest arc.
    const turn=((b.angle-a.angle+6144)%4096)-2048;
    return {tick:lerp(a.tick,b.tick),x:lerp(a.x,b.x),y:lerp(a.y,b.y),angle:(a.angle+turn*alpha)*Math.PI/2048,vx:lerp(a.vx,b.vx),vy:lerp(a.vy,b.vy)};
  }
}

/** Shots move at constant velocity. Rewind to the firing ship's render time,
 * including WASM's truncated half-steps, and hide shots not yet born then. */
export function projectilePose(state:Int32Array,index:number,tick:number,lifetime=120){
  const o=48+index*8,delay=Math.max(0,state[0]-tick);
  return {
    x:(state[o]-Math.trunc(state[o+2]/2)*2*delay)/65536,
    y:(state[o+1]-Math.trunc(state[o+3]/2)*2*delay)/65536,
    visible:state[o+4]>0&&state[o+7]===0&&delay<=lifetime-state[o+4],
  };
}

/** Cosmetic correction offsets only. Never writes simulation state. */
export class PositionCorrection {
  private previous:{x:number;y:number;vx:number;vy:number;tick:number;revision:number;alive:boolean;grounded:boolean}|undefined;
  private offset=[0,0];
  sample(state:Int32Array,player:number,tick:number,revision:number,dt:number,reset=false){
    const o=16+player*16,x=state[o]/65536,y=state[o+1]/65536,vx=state[o+2]/65536,vy=state[o+3]/65536;
    const alive=state[o+7]>0,grounded=!!state[o+8],previous=this.previous;
    let snap=reset||!previous||tick<previous.tick||tick-previous.tick>12||alive!==previous.alive||grounded!==previous.grounded;
    if(!snap&&previous&&revision!==previous.revision){
      const elapsed=tick-previous.tick;
      const dx=previous.x+previous.vx*elapsed-x,dy=previous.y+previous.vy*elapsed-y;
      if(Math.hypot(dx,dy)>32)snap=true;
      else{this.offset[0]+=dx;this.offset[1]+=dy;if(Math.hypot(...this.offset)>32)snap=true;}
    }
    if(snap||!alive||grounded)this.offset=[0,0];
    else{const decay=Math.exp(-Math.max(0,dt)*18);this.offset[0]*=decay;this.offset[1]*=decay;}
    this.previous={x,y,vx,vy,tick,revision,alive,grounded};
    return {x:x+this.offset[0],y:y+this.offset[1],snap};
  }
}
