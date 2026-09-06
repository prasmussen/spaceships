import cave from '../sim/cave.json';
import shader from './scene.wgsl?raw';
import {PositionCorrection} from './presentation';
import type {Effects} from './effects';
type FrameSource=()=>{state:Int32Array;buttons:number[];mode:number;localSlot?:number;correction?:number;reducedMotion?:boolean;snap:boolean;didSnap:()=>void};
export async function render(canvas:HTMLCanvasElement,effects:Effects,get:FrameSource){
  const notice=document.createElement('section');notice.id='graphics-status';notice.hidden=true;notice.setAttribute('role','status');
  const message=document.createElement('p'),retry=document.createElement('button');retry.textContent='Retry graphics';retry.hidden=true;
  notice.append(message,retry);document.body.append(notice);
  const cameras=[[450,1684],[2750,1684]];
  let cleanup:undefined|(()=>void),recovering=false,generation=0;
  async function rebuild(initial=false){
    if(recovering)return;recovering=true;cleanup?.();cleanup=undefined;
    notice.hidden=initial;retry.hidden=true;message.textContent='Restoring graphics…';
    let failure:unknown;
    for(let attempt=0;attempt<(initial?1:3);attempt++){
      try{
        cleanup=await createRenderer(canvas,effects,get,cameras,()=>{setTimeout(()=>void rebuild(),0);});
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
async function createRenderer(canvas:HTMLCanvasElement,effects:Effects,get:FrameSource,cameras:number[][],onLost:()=>void){
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
    ...[1,2,3].map(binding=>({binding,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage' as const}}))
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const scene=await device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]}});
  const projectiles=await device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'bullet_vs'},fragment:{module,entryPoint:'bullet_fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
  const buffer=(size:number,usage:number)=>device.createBuffer({size,usage:usage|GPUBufferUsage.COPY_DST});
  const uniforms=[buffer(32,GPUBufferUsage.UNIFORM),buffer(32,GPUBufferUsage.UNIFORM)];
  const terrainData=new Float32Array([...cave.solids.flat(),...cave.pads.flatMap(p=>[p.x-p.halfWidth,p.y,p.x+p.halfWidth,p.y])]);
  const terrain=buffer(terrainData.byteLength,GPUBufferUsage.STORAGE);
  const ships=buffer(64,GPUBufferUsage.STORAGE),bullets=buffer(12288,GPUBufferUsage.STORAGE);
  device.queue.writeBuffer(terrain,0,terrainData);
  const groups=uniforms.map(uniform=>device.createBindGroup({layout,entries:[uniform,terrain,ships,bullets].map((buffer,binding)=>({binding,resource:{buffer}}))}));
  const shipData=new Float32Array(16),bulletData=new Float32Array(3072);
  const corrections=[new PositionCorrection(),new PositionCorrection()];
  let previous=performance.now();
  if(lost)throw Error('Graphics device was lost during initialization');
  ready=true;
  function draw(now:number){
    if(lost||disposed)return;
    try {
    const {state,buttons,mode,localSlot=0,correction=0,reducedMotion=false,snap,didSnap}=get();
    const dt=Math.min((now-previous)/1000,.1);previous=now;
    const count=mode===2?2:1;
    if(canvas.width!==innerWidth || canvas.height!==innerHeight){canvas.width=innerWidth;canvas.height=innerHeight;}
    for(let p=0;p<2;p++){
      const o=16+p*16;
      const visual=corrections[p].sample(state,p,state[0],correction,dt,snap||reducedMotion);
      const {x,y}=visual;
      if((snap||visual.snap&&!reducedMotion) && state[0]>0)cameras[p]=[x,y];
      const damp=1-Math.exp(-dt*5);
      cameras[p][0]+=(x+(reducedMotion?0:Math.max(-160,Math.min(160,state[o+2]/65536*12)))-cameras[p][0])*damp;
      cameras[p][1]+=(y+(reducedMotion?0:Math.max(-160,Math.min(160,state[o+3]/65536*12)))-cameras[p][1])*damp;
      shipData.set([x,y,state[o+4]*Math.PI/2048,state[o+7]>0?1:0,(buttons[p]&1)&&state[o+6]>0?1:0,state[o+12]>0?1:0,0,0],p*8);
    }
    if(snap&&state[0]>0)didSnap();
    for(let i=0;i<256;i++){const o=48+i*8;bulletData.set([state[o]/65536,state[o+1]/65536,state[o+5],state[o+4]>0?1:0],i*4);}
    const particleCount=effects.write(bulletData,1024,now);
    device.queue.writeBuffer(ships,0,shipData);device.queue.writeBuffer(bullets,0,bulletData);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    for(let p=0;p<count;p++){
      const left=p?Math.floor(canvas.width/2):0,width=count===1?canvas.width:p?canvas.width-left:Math.floor(canvas.width/2);
      device.queue.writeBuffer(uniforms[p],0,new Float32Array([width,canvas.height,left,0,...cameras[count===1?localSlot:p],state[2],0]));
      pass.setViewport(left,0,width,canvas.height,0,1);pass.setScissorRect(left,0,width,canvas.height);
      pass.setBindGroup(0,groups[p]);pass.setPipeline(scene);pass.draw(3);pass.setPipeline(projectiles);pass.draw(6,256+particleCount);
    }
    pass.end();device.queue.submit([encoder.finish()]);animation=requestAnimationFrame(draw);
    }catch{lost=true;onLost();}
  }
  animation=requestAnimationFrame(draw);
  return ()=>{disposed=true;cancelAnimationFrame(animation);for(const buffer of [...uniforms,terrain,ships,bullets])buffer.destroy();device.destroy();};
  }catch(error){disposed=true;device.destroy();throw error;}
}
