import {EventDeduper} from './events.ts';
import {HULL_FRAGMENTS} from './hull-fragments.ts';
import {FragmentInterpolation} from './presentation.ts';
interface Particle {x:number;y:number;vx:number;vy:number;born:number;life:number;player:number}
export const MAX_FRAGMENTS=256;
export const FRAGMENT_STRIDE=16;
export class Effects {
  private deduper=new EventDeduper();
  private particles:Particle[]=[];
  private state:Int32Array=new Int32Array(2096);
  private fragmentMotion=new FragmentInterpolation();
  private audio:AudioContext|undefined;
  private master:GainNode|undefined;
  private voices=0;
  private engine:{noise:AudioBufferSourceNode;rumble:OscillatorNode;filter:BiquadFilterNode;gain:GainNode;power:number}|undefined;
  private engineNoise:AudioBuffer|undefined;
  private explosionNoise:AudioBuffer|undefined;
  private settings:()=>{sound:boolean;particles:boolean};
  constructor(settings:()=>{sound:boolean;particles:boolean}){this.settings=settings;}
  clear(){this.stopThrust();this.deduper.clear();this.particles=[];this.state=new Int32Array(2096);this.fragmentMotion=new FragmentInterpolation();}
  unlock(){
    if(!this.settings().sound){this.stopThrust();if(this.master)this.master.gain.value=0;return;}
    try{if(!this.audio){this.audio=new AudioContext();this.master=this.audio.createGain();this.master.connect(this.audio.destination);}this.master!.gain.value=.12;void this.audio.resume().catch(()=>{});}catch{}
  }
  private stopThrust(){
    const engine=this.engine,audio=this.audio;if(!engine||!audio)return;
    this.engine=undefined;
    const t=audio.currentTime;
    engine.gain.gain.cancelScheduledValues(t);
    engine.gain.gain.setTargetAtTime(0,t,.025);
    engine.noise.stop(t+.15);engine.rumble.stop(t+.15);
    engine.noise.onended=()=>{engine.noise.disconnect();engine.rumble.disconnect();engine.filter.disconnect();engine.gain.disconnect();};
  }
  thrust(frame:Int32Array,buttons:readonly number[],localSlot=0){
    const audio=this.audio;
    let power=0;
    if(this.settings().sound&&audio?.state==='running'&&frame[1]<0){
      for(let p=0;p<2;p++){const o=16+p*16;if(((buttons[p]&1)||frame[o+13]>0)&&frame[o+6]>0&&frame[o+7]>0)power+=(p===localSlot?.7:.25)*(frame[o+13]>0?1.5:1);}
    }
    if(!power||!audio){this.stopThrust();return;}
    if(!this.engine){
      if(!this.engineNoise){
        this.engineNoise=audio.createBuffer(1,audio.sampleRate,audio.sampleRate);
        const samples=this.engineNoise.getChannelData(0);
        for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      }
      const noise=audio.createBufferSource(),rumble=audio.createOscillator(),filter=audio.createBiquadFilter(),gain=audio.createGain();
      noise.buffer=this.engineNoise;noise.loop=true;
      filter.type='lowpass';filter.frequency.value=550;filter.Q.value=.7;
      rumble.type='triangle';rumble.frequency.value=55;
      gain.gain.value=0;noise.connect(filter);rumble.connect(filter);filter.connect(gain);gain.connect(this.master!);
      noise.start();rumble.start();
      this.engine={noise,rumble,filter,gain,power:0};
    }
    if(this.engine.power!==power){this.engine.gain.gain.setTargetAtTime(power,audio.currentTime,.035);this.engine.power=power;}
  }
  private explode(){
    const audio=this.audio!,t=audio.currentTime,duration=.8;
    if(!this.explosionNoise){
      this.explosionNoise=audio.createBuffer(1,Math.ceil(audio.sampleRate*duration),audio.sampleRate);
      const samples=this.explosionNoise.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
    }
    const blast=audio.createBufferSource(),filter=audio.createBiquadFilter(),blastGain=audio.createGain();
    blast.buffer=this.explosionNoise;
    filter.type='lowpass';filter.Q.value=.7;
    filter.frequency.setValueAtTime(4500,t);filter.frequency.exponentialRampToValueAtTime(180,t+duration);
    blastGain.gain.setValueAtTime(.001,t);blastGain.gain.exponentialRampToValueAtTime(1.2,t+.008);blastGain.gain.exponentialRampToValueAtTime(.001,t+duration);
    blast.connect(filter);filter.connect(blastGain);blastGain.connect(this.master!);
    const boom=audio.createOscillator(),boomGain=audio.createGain();boom.type='sine';
    boom.frequency.setValueAtTime(140,t);boom.frequency.exponentialRampToValueAtTime(30,t+.5);
    boomGain.gain.setValueAtTime(.001,t);boomGain.gain.exponentialRampToValueAtTime(.9,t+.012);boomGain.gain.exponentialRampToValueAtTime(.001,t+.6);
    boom.connect(boomGain);boomGain.connect(this.master!);
    this.voices++;
    boom.onended=()=>{boom.disconnect();boomGain.disconnect();};
    blast.onended=()=>{blast.disconnect();filter.disconnect();blastGain.disconnect();this.voices--;};
    blast.start(t);blast.stop(t+duration);boom.start(t);boom.stop(t+.6);
  }
  consume(frame:Int32Array,now=performance.now()){
    this.state=frame;
    const settings=this.settings();
    if(this.master)this.master.gain.value=settings.sound ? .12 : 0;
    for(const event of this.deduper.consume(frame)){
      if(event.type===8)continue; // Winner UI comes from confirmed state.
      const explosion=event.type===4||event.type===5,count=explosion||event.type===1?0:8;
      if(settings.particles){

        for(let i=0;i<count;i++){
          const angle=((Math.imul(event.entity+1,73)+event.tick*19+i*137)%360)*Math.PI/180,speed=35+i*5;
          this.particles.push({x:event.x,y:event.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,born:now,life:.25,player:event.player});
        }
        if(this.particles.length>512)this.particles.splice(0,this.particles.length-512);
      }
      if(settings.sound&&this.audio?.state==='running'&&this.voices<(explosion?34:32)){
        if(explosion){this.explode();continue;}
        const audio=this.audio,t=audio.currentTime,duration=.09;
        const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='triangle';
        oscillator.frequency.setValueAtTime(event.type===1?650:320,t);oscillator.frequency.exponentialRampToValueAtTime(140,t+duration);
        gain.gain.setValueAtTime(.3,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
        oscillator.connect(gain);gain.connect(this.master!);this.voices++;oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.voices--;};oscillator.start(t);oscillator.stop(t+duration);
      }
    }
  }
  writeFragments(target:Float32Array,now=performance.now(),state=this.state,reset=false,revision=0){
    const motion=this.fragmentMotion.sample(state,now,reset,revision);
    let count=0;
    for(let i=0;i<256;i++){
      const o=48+i*8,meta=state[o+7],life=state[o+4];
      if(!meta||life<=0)continue;
      const shape=HULL_FRAGMENTS[meta&31];
      const visual=motion.get(state[o+6])!;
      target.set([visual.x,visual.y,visual.angle,shape.size,
        state[o+5],Math.min(1,visual.life/6),.65,shape.strip?1:0,...shape.vertices],count++*FRAGMENT_STRIDE);
    }
    return count;
  }
  write(target:Float32Array,offset:number,now=performance.now()){
    if(!this.settings().particles){this.particles=[];return 0;}
    this.particles=this.particles.filter(p=>(now-p.born)/1000<p.life);
    this.particles.forEach((p,i)=>{const age=Math.max(0,(now-p.born)/1000);target.set([p.x+p.vx*age,p.y+p.vy*age+60*age*age,p.player,1-age/p.life],offset+i*4);});
    return this.particles.length;
  }
}
