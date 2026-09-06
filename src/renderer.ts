import cave from '../sim/cave.json';
import shader from './scene.wgsl?raw';
import {FlightInterpolation,PositionCorrection,projectilePose} from './presentation';
import tuning from '../sim/tuning.json';
import {MAX_FRAGMENTS,FRAGMENT_STRIDE,type Effects} from './effects';
type FrameSource=()=>{state:Int32Array;buttons:number[];localSlot?:number;correction?:number;reducedMotion?:boolean;snap:boolean;didSnap:()=>void};
export async function render(canvas:HTMLCanvasElement,effects:Effects,get:FrameSource){
  const notice=document.createElement('section');notice.id='graphics-status';notice.hidden=true;notice.setAttribute('role','status');
  const message=document.createElement('p'),retry=document.createElement('button');retry.textContent='Retry graphics';retry.hidden=true;
  notice.append(message,retry);document.body.append(notice);
  const camera=[450,1684];
  let cleanup:undefined|(()=>void),recovering=false,generation=0;
  async function rebuild(initial=false){
    if(recovering)return;recovering=true;cleanup?.();cleanup=undefined;
    notice.hidden=initial;retry.hidden=true;message.textContent='Restoring graphics…';
    let failure:unknown;
    for(let attempt=0;attempt<(initial?1:3);attempt++){
      try{
        cleanup=await createRenderer(canvas,effects,get,camera,()=>{setTimeout(()=>void rebuild(),0);});
        canvas.dataset.graphicsGeneration=String(++generation);notice.hidden=true;recovering=false;return;
      }catch(error){failure=error;if(!initial&&attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
    }
    recovering=false;
    if(initial){notice.remove();throw failure;}
    notice.hidden=false;retry.hidden=false;message.textContent=`Graphics unavailable. ${String(failure)} Your match simulation is still running.`;
  }
  retry.onclick=()=>{void rebuild();};
  await rebuild(true);
}
async function createRenderer(canvas:HTMLCanvasElement,effects:Effects,get:FrameSource,camera:number[],onLost:()=>void){
  if (!navigator.gpu) throw Error('WebGPU is required. Open this game in a WebGPU-capable desktop browser.');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('No WebGPU adapter is available. Enable hardware acceleration and reload.');
  const device=await adapter.requestDevice();
  let lost=false,ready=false,disposed=false,animation=0;
  device.lost.then(()=>{lost=true;if(ready&&!disposed)onLost();});
  try {
  const context=canvas.getContext('webgpu')!;
  const format=navigator.gpu.getPreferredCanvasFormat();
  context.configure({device,format,alphaMode:'opaque'});
  const module=device.createShaderModule({code:shader});
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
    ...[1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage' as const}}))
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const scene=await device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]}});
  const projectiles=await device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'bullet_vs'},fragment:{module,entryPoint:'bullet_fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
  const debris=await device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'fragment_vs'},fragment:{module,entryPoint:'fragment_fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
  const buffer=(size:number,usage:number)=>device.createBuffer({size,usage:usage|GPUBufferUsage.COPY_DST});
  const uniform=buffer(32,GPUBufferUsage.UNIFORM);
  const terrainData=new Float32Array([...cave.solids.flat(),...cave.pads.flatMap(p=>[p.x-p.halfWidth,p.y,p.x+p.halfWidth,p.y])]);
  const terrain=buffer(terrainData.byteLength,GPUBufferUsage.STORAGE);
  const ships=buffer(64,GPUBufferUsage.STORAGE),bullets=buffer(12288,GPUBufferUsage.STORAGE);
  const fragments=buffer(MAX_FRAGMENTS*FRAGMENT_STRIDE*4,GPUBufferUsage.STORAGE),fragmentData=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  device.queue.writeBuffer(terrain,0,terrainData);
  const group=device.createBindGroup({layout,entries:[uniform,terrain,ships,bullets,fragments].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const shipData=new Float32Array(16),bulletData=new Float32Array(3072);
  const corrections=[new PositionCorrection(),new PositionCorrection()];
  const flight=[new FlightInterpolation(),new FlightInterpolation()];
  const shotClocks=[0,0],shotOffsets=[[0,0],[0,0]];
  const thrustPower=[0,0];
  let previous=performance.now();
  if(lost)throw Error('Graphics device was lost during initialization');
  ready=true;
  function draw(now:number){
    if(lost||disposed)return;
    try {
    const {state,buttons,localSlot=0,correction=0,reducedMotion=false,snap,didSnap}=get();
    const dt=Math.min((now-previous)/1000,.1);previous=now;
    if(canvas.width!==innerWidth || canvas.height!==innerHeight){canvas.width=innerWidth;canvas.height=innerHeight;}
    for(let p=0;p<2;p++){
      const o=16+p*16;
      const visual=corrections[p].sample(state,p,state[0],correction,dt,snap||reducedMotion);
      const motion=flight[p].sample(state,p,now,snap);
      const x=motion.x+visual.x-state[o]/65536,y=motion.y+visual.y-state[o+1]/65536;
      shotClocks[p]=motion.tick;
      shotOffsets[p]=[visual.x-state[o]/65536,visual.y-state[o+1]/65536];
      if(p===localSlot){
        if((snap||visual.snap&&!reducedMotion) && state[0]>0){camera[0]=x;camera[1]=y;}
        const damp=1-Math.exp(-dt*5);
        camera[0]+=(x+(reducedMotion?0:Math.max(-160,Math.min(160,motion.vx*12)))-camera[0])*damp;
        camera[1]+=(y+(reducedMotion?0:Math.max(-160,Math.min(160,motion.vy*12)))-camera[1])*damp;
      }
      const thrust=state[o+6]>0&&state[o+7]>0?(state[o+13]>0?2:(buttons[p]&1)?1:0):0;
      if(snap||reducedMotion||state[o+7]<=0)thrustPower[p]=thrust;
      else thrustPower[p]+=(thrust-thrustPower[p])*(1-Math.exp(-dt*24));
      shipData.set([x,y,motion.angle,state[o+7]>0?1:0,thrustPower[p],state[o+12]>0?1:0,0,0],p*8);
    }
    if(snap&&state[0]>0)didSnap();
    for(let i=0;i<256;i++){
      const o=48+i*8,owner=state[o+5],pose=projectilePose(state,i,shotClocks[owner],tuning.projectileLifetime);
      bulletData.set([pose.x+shotOffsets[owner][0],pose.y+shotOffsets[owner][1],owner,pose.visible?1:0],i*4);
    }
    const particleCount=effects.write(bulletData,1024,now);
    const fragmentCount=effects.writeFragments(fragmentData,now,state,snap,correction);
    if(fragmentCount)device.queue.writeBuffer(fragments,0,fragmentData,0,fragmentCount*FRAGMENT_STRIDE);
    device.queue.writeBuffer(ships,0,shipData);device.queue.writeBuffer(bullets,0,bulletData);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    device.queue.writeBuffer(uniform,0,new Float32Array([canvas.width,canvas.height,...camera,state[2],(now/1000)%3600,reducedMotion?0:1,0]));
    pass.setBindGroup(0,group);pass.setPipeline(scene);pass.draw(3);pass.setPipeline(projectiles);pass.draw(6,256+particleCount);pass.setPipeline(debris);pass.draw(6,fragmentCount);
    pass.end();device.queue.submit([encoder.finish()]);animation=requestAnimationFrame(draw);
    }catch{lost=true;onLost();}
  }
  animation=requestAnimationFrame(draw);
  return ()=>{disposed=true;cancelAnimationFrame(animation);for(const buffer of [uniform,terrain,ships,bullets,fragments])buffer.destroy();device.destroy();};
  }catch(error){disposed=true;device.destroy();throw error;}
}
