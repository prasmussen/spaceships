const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value));
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));

// Standalone Flight lab only. Decisions advance with simulation ticks, never
// wall time or randomness; the opponent uses the same buttons as a human.
export class ComputerPilot {
  private phase=0;
  private duty=0;
  private lastTarget=0;
  private ticks=0;

  reset(){this.phase=0;this.duty=0;this.lastTarget=0;this.ticks=0;}

  input(state:Int32Array):number {
    if(state[2]!==2||state[1]>=0)return 0;
    if(!state[39]){this.reset();return 0;}
    if(state[40]){
      this.reset();
      return state[38]<6000?0:1;
    }
    const x=state[32]/65536,y=state[33]/65536;
    const vx=state[34]/65536,vy=state[35]/65536;
    const angle=state[36]*Math.PI/2048,spin=state[37]*Math.PI/2048;
    const targets=[[2750,1400],[1100,1400],[2750,1400],[2750,1690]];
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
