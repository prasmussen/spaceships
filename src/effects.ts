import {EventDeduper} from './events.ts';
import {moveDebris} from './debris.ts';
import {HULL_FRAGMENTS} from './hull-fragments.ts';
interface Particle {x:number;y:number;vx:number;vy:number;born:number;life:number;player:number}
interface Fragment extends Particle {angle:number;spin:number;size:number;shade:number;elapsed:number;cave:boolean;vertices:number[];strip:boolean}
export const MAX_FRAGMENTS=512;
export const FRAGMENT_STRIDE=16;
export class Effects {
  private deduper=new EventDeduper();
  private particles:Particle[]=[];
  private fragments:Fragment[]=[];
  private velocity=[[0,0],[0,0]];
  private audio:AudioContext|undefined;
  private master:GainNode|undefined;
  private voices=0;
  private settings:()=>{sound:boolean;particles:boolean};
  private solids:readonly (readonly number[])[];
  constructor(settings:()=>{sound:boolean;particles:boolean},solids:readonly (readonly number[])[]=[]){this.settings=settings;this.solids=solids;}
  clear(){this.deduper.clear();this.particles=[];this.fragments=[];this.velocity=[[0,0],[0,0]];}
  private shatter(frame:Int32Array,event:{x:number;y:number;player:number;tick:number;entity:number},now:number){
    let seed=(Math.imul(event.tick+1,1597334677)^Math.imul(event.entity+1,3812015801))>>>0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const angle=frame[16+event.player*16+4]*Math.PI/2048,c=Math.cos(angle),s=Math.sin(angle);
    const [vx,vy]=this.velocity[event.player];
    for(const shape of HULL_FRAGMENTS){
      const lx=shape.x,ly=shape.y;
      const x=c*lx-s*ly,y=s*lx+c*ly;
      const direction=Math.atan2(y,x)+(random()-.5)*.8,speed=(shape.strip?45:25)+random()*(shape.strip?100:65);
      this.fragments.push({x:event.x+x,y:event.y+y,vx:vx+Math.cos(direction)*speed,vy:vy+Math.sin(direction)*speed,
        born:now,life:3.1,player:event.player,angle,spin:(random()-.5)*(shape.strip?14:7),
        size:shape.size,shade:random(),elapsed:0,cave:frame[2]!==0,vertices:shape.vertices,strip:shape.strip});
    }
    if(this.fragments.length>MAX_FRAGMENTS)this.fragments.splice(0,this.fragments.length-MAX_FRAGMENTS);
  }
  unlock(){
    if(!this.settings().sound){if(this.master)this.master.gain.value=0;return;}
    try{if(!this.audio){this.audio=new AudioContext();this.master=this.audio.createGain();this.master.connect(this.audio.destination);}this.master!.gain.value=.12;void this.audio.resume().catch(()=>{});}catch{}
  }
  consume(frame:Int32Array,now=performance.now()){
    const settings=this.settings();
    if(this.master)this.master.gain.value=settings.sound ? .12 : 0;
    for(const event of this.deduper.consume(frame)){
      if(event.type===8)continue; // Winner UI comes from confirmed state.
      const explosion=event.type===4||event.type===5,count=explosion?0:event.type===1?5:8;
      if(settings.particles){
        if(explosion)this.shatter(frame,event,now);
        for(let i=0;i<count;i++){
          const angle=((Math.imul(event.entity+1,73)+event.tick*19+i*137)%360)*Math.PI/180,speed=35+i*5;
          this.particles.push({x:event.x,y:event.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,born:now,life:.25,player:event.player});
        }
        if(this.particles.length>512)this.particles.splice(0,this.particles.length-512);
      }
      if(settings.sound&&this.audio?.state==='running'&&this.voices<32){
        const audio=this.audio,t=audio.currentTime,duration=explosion ? .28 : .09;
        const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type=explosion?'sawtooth':'triangle';
        oscillator.frequency.setValueAtTime(explosion?100:event.type===1?650:320,t);oscillator.frequency.exponentialRampToValueAtTime(explosion?25:140,t+duration);
        gain.gain.setValueAtTime(.3,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
        oscillator.connect(gain);gain.connect(this.master!);this.voices++;oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices--;};oscillator.start(t);oscillator.stop(t+duration);
      }
    }
    for(let player=0;player<2;player++){
      const o=16+player*16;
      if(frame[o+7]>0)this.velocity[player]=[frame[o+2]/65536*60,frame[o+3]/65536*60];
    }
  }
  writeFragments(target:Float32Array,now=performance.now()){
    if(!this.settings().particles){this.fragments=[];return 0;}
    this.fragments=this.fragments.filter(p=>(now-p.born)/1000<p.life);
    this.fragments.forEach((p,i)=>{
      const age=Math.max(0,(now-p.born)/1000);
      // Fixed substeps keep gravity and bounces consistent at different display rates.
      while(p.elapsed+1/120<=age){moveDebris(p,1/120,p.cave?this.solids:[]);p.elapsed+=1/120;}
      target.set([p.x,p.y,p.angle,p.size,
        p.player,Math.min(1,(p.life-age)/.1),p.shade,p.strip?1:0,...p.vertices],i*FRAGMENT_STRIDE);
    });
    return this.fragments.length;
  }
  write(target:Float32Array,offset:number,now=performance.now()){
    if(!this.settings().particles){this.particles=[];return 0;}
    this.particles=this.particles.filter(p=>(now-p.born)/1000<p.life);
    this.particles.forEach((p,i)=>{const age=Math.max(0,(now-p.born)/1000);target.set([p.x+p.vx*age,p.y+p.vy*age+60*age*age,p.player,1-age/p.life],offset+i*4);});
    return this.particles.length;
  }
}
