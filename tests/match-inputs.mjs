// Cooperative acceptance flight: one pilot traverses the cave and attacks the
// other pilot's pad. Only normal button masks are submitted to the real WASM.
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
export async function matchInputs(){
  const engine=await Engine.create(await readFile('public/simulation.wasm'));
  const inputs=[];let phase=0,duty=0,lastTarget=0;
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function steer(angle,spin,target){
    const error=Math.atan2(Math.sin(target-angle),Math.cos(target-angle));
    const desired=clamp(error*.2+Math.atan2(Math.sin(target-lastTarget),Math.cos(target-lastTarget)),-.08,.08);lastTarget=target;
    return spin<desired-.002?4:spin>desired+.002?2:0;
  }
  for(let t=0;t<6000;t++){
    const st=engine.frame();if(st[1]>=0){if(st[1]!==0||st[27]!==5||st[43]!==0)throw Error('Acceptance pilot did not win cleanly');return inputs;}
    const x=st[16]/65536,y=st[17]/65536,vx=st[18]/65536,vy=st[19]/65536,angle=st[20]*Math.PI/2048,spin=st[21]*Math.PI/2048;
    if(!st[23]){phase=0;duty=0;}
    let bits=0;
    if(t>=2){
      if(phase===0&&y<1645)phase=1;
      if(phase===1&&x>2300&&Math.abs(vx)<.2&&y<1470&&Math.abs(vy)<.3)phase=2;
      if(phase<2){
        const tx=phase===0?450:2330,ty=phase===0?1620:x>2200?1450:1650;
        const ax=clamp((clamp((tx-x)*.025,-3,3)-vx)*.1,-.1,.1),ay=clamp((clamp((ty-y)*.025,-1.5,1.5)-vy)*.1,-.1,.1)-3600/65536;
        const target=Math.atan2(ax,-ay);bits=steer(angle,spin,target);duty+=Math.min(1,Math.hypot(ax,ay)/(10800/65536));
        if(duty>=1&&Math.cos(target-angle)>.9){bits|=1;duty-=1;}duty=Math.min(duty,2);
      }else{
        const dx=2750-x,dy=1684-y,a=vx*vx+vy*vy-144,b=-2*(dx*vx+dy*vy),c=dx*dx+dy*dy;
        const flight=(-b-Math.sqrt(b*b-4*a*c))/(2*a),target=Math.atan2(dx-vx*flight,-(dy-vy*flight));
        bits=steer(angle,spin,target);if(Math.cos(target-angle)>.9995)bits|=8;if(y>1630)phase=1;
      }
    }
    const pair=[bits,0];inputs.push(pair);engine.step(pair);
  }
  throw Error('Acceptance pilot did not finish within 6000 ticks');
}
