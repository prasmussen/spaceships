// Acceptance pilot: normal inputs only, with routing around pad platforms,
// leading shots, and refueling between kills. All opponents remain grounded.
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
export async function matchInputs(players=2,seed=0){
  const engine=await Engine.create(await readFile('public/simulation.wasm'),32768,seed,players);
  const inputs=[];let duty=0,lastTarget=0,targetID=1,phase='route',waypoints=[],waypoint=0;
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const flank=x=>x<1000?x+315:x-315;
  function steer(angle,spin,target){
    const error=Math.atan2(Math.sin(target-angle),Math.cos(target-angle));
    const desired=clamp(error*.2+Math.atan2(Math.sin(target-lastTarget),Math.cos(target-lastTarget)),-.08,.08);lastTarget=target;
    return spin<desired-.002?4:spin>desired+.002?2:0;
  }
  for(let t=0;t<45000;t++){
    const st=engine.frame();
    if(st[1]>=0){if(st[1]!==0||st[27]!==5||Array.from({length:players-1},(_,id)=>st[43+id*16]).some(score=>score!==0))throw Error('Acceptance pilot did not win cleanly');return inputs;}
    const x=st[16]/65536,y=st[17]/65536,vx=st[18]/65536,vy=st[19]/65536,angle=st[20]*Math.PI/2048,spin=st[21]*Math.PI/2048;
    if(!st[23])throw Error(`Acceptance pilot crashed: ${players} players seed ${seed}, tick ${t}, ${x},${y}, phase ${phase}, waypoint ${waypoint}`);
    if(!waypoints.length||phase==='refuel'&&st[24]&&st[22]===6000){
      targetID=Array.from({length:players-1},(_,id)=>id+1).filter(id=>st[23+id*16]>0).sort((a,b)=>Math.hypot(st[16+a*16]/65536-x,st[17+a*16]/65536-y)-Math.hypot(st[16+b*16]/65536-x,st[17+b*16]/65536-y))[0];
      const ex=st[16+targetID*16]/65536,ey=st[17+targetID*16]/65536;
      phase='route';waypoint=0;waypoints=[[x,y-187.5],[flank(x),y-187.5],[flank(x),1875],[flank(ex),1875],[flank(ex),ey-234]];
    }
    const enemyX=st[16+targetID*16]/65536,enemyY=st[17+targetID*16]/65536;
    if(phase!=='refuel'&&!st[23+targetID*16]){phase='refuel';waypoint=0;waypoints=[[x,enemyY-225],[enemyX,enemyY-225],[enemyX,enemyY+6]];}
    let bits=0;
    if(t>=2){
      if(phase==='route'||phase==='refuel'){
        let [tx,ty]=waypoints[waypoint];
        if(Math.abs(tx-x)<25&&Math.abs(ty-y)<25&&Math.abs(vx)<.3&&Math.abs(vy)<.3){
          if(waypoint<waypoints.length-1){waypoint++;[tx,ty]=waypoints[waypoint];}else if(phase==='route')phase='attack';
        }
        const limit=phase==='refuel'&&waypoint===2?.5:1.5;
        const ax=clamp((clamp((tx-x)*.025,-3,3)-vx)*.1,-.1,.1),ay=clamp((clamp((ty-y)*.025,-limit,limit)-vy)*.1,-.1,.1)-3600/65536;
        const target=Math.atan2(ax,-ay);bits=steer(angle,spin,target);duty+=Math.min(1,Math.hypot(ax,ay)/(10800/65536));
        if(duty>=1&&Math.cos(target-angle)>.9){bits|=1;duty--;}duty=Math.min(duty,2);
      }else{
        const dx=enemyX-x,dy=enemyY-y,a=vx*vx+vy*vy-144,b=-2*(dx*vx+dy*vy),c=dx*dx+dy*dy;
        const flight=(-b-Math.sqrt(b*b-4*a*c))/(2*a),target=Math.atan2(dx-vx*flight,-(dy-vy*flight));
        bits=steer(angle,spin,target);if(Math.cos(target-angle)>.9995)bits|=8;
        if(y>enemyY-54){phase='route';waypoint=waypoints.length-1;}
      }
    }
    if(phase==='refuel'&&st[24])bits=0;
    const vector=Array(players).fill(0);vector[0]=bits;inputs.push(vector);engine.step(vector);
  }
  throw Error(`Acceptance pilot did not finish: ${players} players seed ${seed}`);
}
