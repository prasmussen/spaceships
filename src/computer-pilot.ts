const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value));
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));

// Standalone Flight lab only. Decisions advance with simulation ticks, never
// wall time or randomness; the opponent uses the same buttons as a human.
export class ComputerPilot {
  private phase=0;
  private duty=0;
  private lastTarget=0;
  private ticks=0;
  private homeX=2750;
  private homeY=1700;

  readonly slot:number;
  constructor(slot=1){this.slot=slot;}

  reset(){this.phase=0;this.duty=0;this.lastTarget=0;this.ticks=0;}

  input(state:Int32Array):number {
    const o=16+this.slot*16;
    if(state[2]!==2||state[1]>=0)return 0;
    if(!state[o+7]){this.reset();return 0;}
    if(state[o+8]){
      this.reset();this.homeX=state[o+0]/65536;this.homeY=state[o+1]/65536+16+1/65536;
      return state[o+6]<6000?0:1;
    }
    const x=state[o+0]/65536,y=state[o+1]/65536;
    const vx=state[o+2]/65536,vy=state[o+3]/65536;
    const angle=state[o+4]*Math.PI/2048,spin=state[o+5]*Math.PI/2048;
    const turnX=this.homeX<1600?this.homeX+400:this.homeX-400;
    const targets=[[this.homeX,this.homeY-300],[turnX,this.homeY-300],[this.homeX,this.homeY-300],[this.homeX,this.homeY-10]];
    let [tx,ty]=targets[this.phase];
    if(this.phase<3&&Math.abs(tx-x)<20&&Math.abs(ty-y)<20&&Math.abs(vx)<.3&&Math.abs(vy)<.3){
      this.phase++;[tx,ty]=targets[this.phase];
    }
    // Velocity feedback counters momentum, including pushes from the player.
    const ax=clamp((clamp((tx-x)*.025,3)-vx)*.1,.1);
    const ay=clamp((clamp((ty-y)*.025,this.phase===3?.5:1.5)-vy)*.1,.1)-3600/65536;
    const target=Math.atan2(ax,-ay);
    const desired=clamp(wrap(target-angle)*.2+wrap(target-this.lastTarget),.08);
    this.lastTarget=target;
    let buttons=spin<desired-.002?4:spin>desired+.002?2:0;
    this.duty+=Math.min(1,Math.hypot(ax,ay)/(10800/65536));
    if(this.duty>=1&&Math.cos(target-angle)>.9){buttons|=1;this.duty--;}
    this.duty=Math.min(this.duty,2);
    if((this.phase===1||this.phase===2)&&this.ticks%180<24)buttons|=8;
    this.ticks++;
    return buttons;
  }
}
