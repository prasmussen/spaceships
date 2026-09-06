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
