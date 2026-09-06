// Single reusable entry point: node tests/browser.mjs
// Starts and closes its own local server and browser. Artifacts stay in artifacts/.
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile, access, mkdtemp } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkLobby} from './browser-lobby.mjs';
import {checkPeer} from './browser-peer.mjs';
import {startTurn} from './browser-turn.mjs';
import {checkDeployment} from './browser-deployment.mjs';
await mkdir('artifacts', {recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});
await server.listen();
const base=server.resolvedUrls.local[0];
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror', error=>errors.push(String(error)));
  page.on('console', message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url,options){
        super(url,options);
        if(String(url).includes('/src/worker.ts'))this.addEventListener('message',({data})=>{
          if(data.type==='frame')window.testPracticeFrame={state:Array.from(new Int32Array(data.buffer)),computerButtons:data.computerButtons};
        });
      }
    };
    if(!sessionStorage.getItem('controls-migration-seeded')){
      localStorage.setItem('cavern-controls',JSON.stringify(['KeyW','KeyA','KeyD','Space','ArrowUp','ArrowLeft','ArrowRight','Enter','KeyT']));
      sessionStorage.setItem('controls-migration-seeded','true');
    }
    window.testSounds=0;window.testThrustSounds=0;
    const Audio=window.AudioContext;window.AudioContext=class extends Audio{createBufferSource(){window.testThrustSounds++;return super.createBufferSource();}createOscillator(){window.testSounds++;return super.createOscillator();}};
    window.testGPUDevices=[];window.testGPUUnavailable=false;
    const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter=async options=>{
      if(window.testGPUUnavailable)return null;
      const adapter=await requestAdapter(options);if(!adapter)return adapter;
      const requestDevice=adapter.requestDevice.bind(adapter);
      adapter.requestDevice=async options=>{const device=await requestDevice(options);window.testGPUDevices.push(device);return device;};
      return adapter;
    };
  });
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('FUEL'));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('unavailable')),false);
  assert.equal(await page.locator('#online-options, .home-hint, .online-description').count(),0);
  assert.equal(await page.locator('#queue-join').isVisible(),true);
  assert.equal(await page.locator('#status').isVisible(),false);
  assert.equal(await page.locator('#local-menu').isVisible(),false);
  await page.screenshot({path:'artifacts/online-home.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#queue-join').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'artifacts/online-home-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Practice offline',exact:true}).click();
  assert.equal(await page.locator('#online-panel').isVisible(),false);
  assert.equal(await page.locator('#status').isVisible(),true);
  await page.locator('#local-menu summary').click();
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  assert.equal(await page.getByLabel('Sound effects',{exact:true}).isChecked(),true);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('cavern-controls-v2'))),['KeyW','KeyA','KeyD','Space','ShiftLeft']);
  assert.equal(await page.locator('#controls-panel fieldset').count(),1);
  assert.equal(await page.getByRole('button',{name:'Restart or rematch',exact:true}).count(),0);
  await page.getByRole('button',{name:'Thrust',exact:true}).click();
  await page.keyboard.press('a');
  assert.match(await page.locator('#controls-panel output').textContent(),/already assigned/);
  await page.keyboard.press('i');
  assert.equal(await page.getByRole('button',{name:'Thrust',exact:true}).textContent(),'I');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Practice offline',exact:true}).click();
  await page.locator('#local-menu summary').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ON PAD'));
  await page.keyboard.down('w');await page.waitForTimeout(100);await page.keyboard.up('w');
  assert.match(await page.locator('#status').textContent(),/ON PAD/);
  await page.keyboard.down('i');await page.waitForTimeout(250);await page.keyboard.up('i');
  assert.match(await page.locator('#status').textContent(),/IN FLIGHT/);
  assert.ok(await page.evaluate(()=>window.testThrustSounds)>0,'thrust starts an engine sound by default');
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  await page.getByRole('button',{name:'Restore default controls',exact:true}).click();
  await page.getByLabel('Sound effects',{exact:true}).check();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Flight lab',exact:true}).click();
  await page.waitForFunction(()=>window.testPracticeFrame?.state[2]===2&&window.testPracticeFrame.state[40]===0);
  for(const players of [3,4,2]){
    await page.locator('#local-menu summary').click();
    await page.getByLabel('Practice players',{exact:true}).selectOption(String(players));
    await page.waitForFunction(count=>window.testPracticeFrame?.state[5]===count,players);
    await page.waitForFunction(count=>Array.from({length:count-1},(_,id)=>window.testPracticeFrame.state[40+id*16]).every(grounded=>grounded===0),players);
    assert.deepEqual(await page.evaluate(count=>Array.from({length:count},(_,id)=>window.testPracticeFrame.state[23+id*16]),players),Array(players).fill(3));
    await page.locator('#local-menu summary').click();
    if(players===4)await page.screenshot({path:'artifacts/four-player-practice.png'});
  }
  assert.match(await page.locator('#status').textContent(),/COMPUTER/);
  await page.waitForTimeout(100);
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(800);
  await page.keyboard.up('d');
  await page.keyboard.up('w');
  const spin=await page.locator('#status strong').nth(3).textContent();
  assert.ok(Number(spin)>0,'rotation produces angular momentum');
  const fuel=await page.locator('#status strong').nth(0).textContent();
  assert.ok(parseInt(fuel)<100,'thrust consumes fuel');
  await page.screenshot({path:'artifacts/flight.png'});
  const tickBeforeR=await page.evaluate(()=>window.testPracticeFrame.state[0]);
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>window.testPracticeFrame.state[0])>tickBeforeR,'R does not restart the simulation');
  await page.locator('#local-menu summary').click();
  await page.getByRole('button',{name:'Landing course',exact:true}).click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.testPracticeFrame.computerButtons),0);
  assert.equal(await page.evaluate(()=>window.testPracticeFrame.state[40]),1);
  assert.match(await page.locator('#status').textContent(),/ON PAD/);
  await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
  assert.match(await page.locator('#status').textContent(),/IN FLIGHT/);
  await page.screenshot({path:'artifacts/landing.png'});
  assert.equal(await page.getByRole('button',{name:'Local duel',exact:true}).count(),0);
  await page.keyboard.press('r');
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(150);await page.keyboard.up('ArrowUp');
  assert.match(await page.locator('#status').textContent(),/IN FLIGHT/);
  await page.keyboard.down('Space');await page.waitForTimeout(300);await page.keyboard.up('Space');
  assert.ok(await page.evaluate(()=>window.testSounds)>0,'firing creates sound voices after enabling audio');
  assert.equal(await page.locator('#lab-open, #lab-panel').count(),0);
  const tickBeforeLoss=await page.evaluate(()=>window.testPracticeFrame.state[0]);
  await page.evaluate(()=>window.testGPUDevices.at(-1).destroy());
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.graphicsGeneration==='2');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>window.testPracticeFrame.state[0])>tickBeforeLoss,'simulation continues during graphics recovery');
  await page.evaluate(()=>{window.testGPUUnavailable=true;window.testGPUDevices.at(-1).destroy();});
  await page.getByRole('button',{name:'Retry graphics',exact:true}).waitFor({state:'visible'});
  const tickWhileUnavailable=await page.evaluate(()=>window.testPracticeFrame.state[0]);
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>window.testPracticeFrame.state[0])>tickWhileUnavailable);
  await page.evaluate(()=>{window.testGPUUnavailable=false;});
  await page.getByRole('button',{name:'Retry graphics',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.graphicsGeneration==='3');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#graphics-status').isVisible(),false);
  await page.screenshot({path:'artifacts/graphics-recovered.png'});
  assert.deepEqual(errors,[]);
  console.log('Browser flight, WebGPU validation, keyboard input and removed restart shortcut passed. Screenshot: artifacts/flight.png');
  if(process.argv.includes('--peer'))await checkPeer(browser,base);
  if(process.argv.includes('--turn')){const turn=await startTurn();try{await checkLobby(browser,turn);await checkPeer(browser,base,turn);}finally{await turn.close();}}
  else if(process.argv.includes('--lobby'))await checkLobby(browser);
  if(process.argv.includes('--https'))await checkDeployment(browser);
  await browser.close(); browser=undefined;
  const wasm=await readFile('public/simulation.wasm');
  const {instance}=await WebAssembly.instantiate(wasm);
  const reference=instance.exports;
  const expected={};
  for(const map of [0,32768]) {
    reference.init(1024,map,0,2);
    for(let tick=0;tick<120000;tick++) {
      new Uint8Array(reference.memory.buffer,2048,2).set([(tick*7+(tick>>5))&7,(tick*3+(tick>>7))&7]);
      reference.step(2048,1);
    }
    expected[map]=reference.state_hash().toString();
  }
  const results=[];
  const engines=process.argv.includes('--all-engines')?[['chromium',chromium],['firefox',firefox],['webkit',webkit]]:[['chromium',chromium]];
  for(const [name,engine]of engines) {
    if(name!=='chromium') {
      console.log(`Checking pinned ${name} installation…`);
      const exec=promisify(execFile);
      if(process.platform==='darwin') {
        // Playwright ZIP extraction stalled under both Node 22 and 26 here.
        // Ask the pinned CLI for its official URLs; use native macOS extraction.
        const {stdout}=await exec(process.execPath,['node_modules/playwright/cli.js','install','--dry-run',name]);
        for(const block of stdout.split('\n\n')) {
          const location=block.match(/Install location:\s+([^\n]+)/)?.[1];
          const url=block.match(/Download url:\s+(https:\/\/[^\s]+)/)?.[1];
          if(!location||!url)continue;
          try{await access(join(location,'INSTALLATION_COMPLETE'));continue;}catch{}
          console.log(`Provisioning ${block.split('\n')[0]} with native extraction…`);
          const temporary=await mkdtemp(join(tmpdir(),'cavern-browser-'));
          const zip=join(temporary,'browser.zip');
          await exec('/usr/bin/curl',['--fail','--location','--retry','2','--max-time','180','--output',zip,url],{timeout:200000});
          await mkdir(location,{recursive:true});
          await exec('/usr/bin/ditto',['-x','-k',zip,location],{timeout:120000});
          await writeFile(join(location,'INSTALLATION_COMPLETE'),'');
        }
      }else await exec(process.execPath,['node_modules/playwright/cli.js','install',name],{timeout:900000});
    }
    browser=await engine.launch(name==='chromium'?{channel:'chrome',headless:true}:{headless:true});
    const replay=await browser.newPage();
    // No renderer is started: determinism works independently of WebGPU support.
    await replay.goto(new URL('build.json',base).href);
    const measurements=await replay.evaluate(async bytes=>{
      const {instance}=await WebAssembly.instantiate(new Uint8Array(bytes));
      const s=instance.exports;
      const result=[];
      for(const map of [0,32768]) for(const cadence of [30,60,144]) {
        s.init(1024,map,0,2);
        const start=performance.now();
        for(let tick=0;tick<120000;tick++) {
          new Uint8Array(s.memory.buffer,2048,2).set([(tick*7+(tick>>5))&7,(tick*3+(tick>>7))&7]);
          s.step(2048,1);
          const reads=Math.floor((tick+1)*cadence/60)-Math.floor(tick*cadence/60);
          for(let i=0;i<reads;i++)s.write_frame(81920);
        }
        result.push({map,cadence,hash:s.state_hash().toString(),averageTickMs:(performance.now()-start)/120000});
      }
      return result;
    },[...wasm]);
    for(const measurement of measurements)assert.equal(measurement.hash,expected[measurement.map],`${name} ${measurement.cadence} Hz`);
    const evidence={engine:name,wasm:createHash('sha256').update(wasm).digest('hex'),date:new Date().toISOString(),ticks:120000,measurements};
    results.push(evidence);
    await writeFile(`artifacts/determinism-${name}.json`,JSON.stringify(evidence,null,2)+'\n');
    await browser.close(); browser=undefined;
  }
  await writeFile('artifacts/determinism.json',JSON.stringify({ticks:120000,expected,results},null,2));
  console.log(`120,000-tick replay matches Node at 30/60/144 presentation reads per simulated second in: ${results.map(r=>r.engine).join(', ')}`);
} finally {
  await browser?.close();
  await server.close();
}
