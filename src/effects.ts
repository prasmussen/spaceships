import {EventDeduper} from './events.ts';
interface Particle {x:number;y:number;vx:number;vy:number;born:number;life:number;player:number}
export class Effects {
  private deduper=new EventDeduper();
  private particles:Particle[]=[];
  private audio:AudioContext|undefined;
  private master:GainNode|undefined;
  private voices=0;
  private settings:()=>{sound:boolean;particles:boolean};
  constructor(settings:()=>{sound:boolean;particles:boolean}){this.settings=settings;}
  clear(){this.deduper.clear();this.particles=[];}
  unlock(){
    if(!this.settings().sound){if(this.master)this.master.gain.value=0;return;}
    try{if(!this.audio){this.audio=new AudioContext();this.master=this.audio.createGain();this.master.connect(this.audio.destination);}this.master!.gain.value=.12;void this.audio.resume().catch(()=>{});}catch{}
  }
  consume(frame:Int32Array,now=performance.now()){
    const settings=this.settings();
    if(this.master)this.master.gain.value=settings.sound ? .12 : 0;
    for(const event of this.deduper.consume(frame)){
      if(event.type===8)continue; // Winner UI comes from confirmed state.
      const explosion=event.type===4||event.type===5,count=explosion?24:event.type===1?5:8;
      if(settings.particles){
        for(let i=0;i<count;i++){
          const angle=((Math.imul(event.entity+1,73)+event.tick*19+i*137)%360)*Math.PI/180,speed=explosion?90+i*4:35+i*5;
          this.particles.push({x:event.x,y:event.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,born:now,life:explosion ? .65 : .25,player:event.player});
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
  }
  write(target:Float32Array,offset:number,now=performance.now()){
    if(!this.settings().particles){this.particles=[];return 0;}
    this.particles=this.particles.filter(p=>(now-p.born)/1000<p.life);
    this.particles.forEach((p,i)=>{const age=Math.max(0,(now-p.born)/1000);target.set([p.x+p.vx*age,p.y+p.vy*age+60*age*age,p.player,1-age/p.life],offset+i*4);});
    return this.particles.length;
  }
}
