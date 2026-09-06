// Called only through node tests/browser.mjs --https. No host certificate installation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
export async function checkDeployment(browser){
  const directory=await mkdtemp(join(tmpdir(),'cavern-https-')),file=join(directory,'test.env'),contexts=[];
  const values={SITE_ADDRESS:'localhost',PUBLIC_ORIGIN:'https://localhost:18443',BIND_ADDRESS:'127.0.0.1',HTTP_PORT:'18080',HTTPS_PORT:'18443',TLS_CONFIG:'tls internal',METRICS_TOKEN:randomBytes(32).toString('hex'),REGIONS:'eu',TURN_URLS:'',TURN_SECRET:''};
  await writeFile(file,Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n'),{mode:0o600});
  const args=['compose','--project-name',`cavern-https-test-${process.pid}`,'--env-file',file,'-f','deploy/compose.yml'];
  const compose=(extra)=>exec('docker',[...args,...extra],{env:{...process.env,...values},timeout:180000,maxBuffer:8*1024*1024});
  try{
    await compose(['up','--build','-d']);
    const pages=[];
    for(let player=0;player<2;player++){
      const context=await browser.newContext({ignoreHTTPSErrors:true});contexts.push(context);const page=await context.newPage();pages.push(page);
      const deadline=Date.now()+20000;
      while(true){try{await page.goto(values.PUBLIC_ORIGIN);if(await page.locator('#status').count())break;}catch{}if(Date.now()>deadline)throw Error('HTTPS deployment did not become ready');await new Promise(resolve=>setTimeout(resolve,200));}
      assert.equal(await page.evaluate(()=>window.isSecureContext),true);
      // Retain the deployment's queue/cancel protocol coverage independently of Quick play.
      await page.evaluate(()=>{
        const send=WebSocket.prototype.send;
        WebSocket.prototype.send=function(raw){const m=JSON.parse(raw);return send.call(this,m.type==='quickPlay'?JSON.stringify({type:'queue',players:2}):m.type==='leave'&&!document.querySelector('#queue-cancel').hidden?JSON.stringify({type:'cancelQueue'}):raw);};
      });
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('FUEL'));
      await page.getByRole('button',{name:'Quick play',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
      await page.getByRole('button',{name:'Cancel search',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Search cancelled'));
      await page.waitForFunction(()=>!document.querySelector('#queue-join').disabled);
      const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==='cavern_guest'&&c.secure&&c.httpOnly&&c.sameSite==='Strict'));
    }
    const response=await contexts[0].request.get(values.PUBLIC_ORIGIN+'/build.json');
    assert.match(response.headers()['cache-control'],/no-cache/);
    const manifest=await response.json(),local=JSON.parse(await readFile('public/build.json','utf8'));assert.equal(manifest.wasm,local.wasm);
    const denied=await contexts[0].request.post(values.PUBLIC_ORIGIN+'/api/session',{headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status(),403);
    await Promise.all(pages.map(page=>page.getByRole('button',{name:'Quick play',exact:true}).click()));
    await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
    await pages[0].keyboard.down('w');await pages[0].waitForTimeout(300);await pages[0].keyboard.up('w');assert.match(await pages[0].locator('#status').textContent(),/IN FLIGHT/);
    await pages[0].getByRole('button',{name:'Online duel',exact:true}).click();await pages[0].getByRole('button',{name:'Practice offline',exact:true}).click();
    await pages[1].waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent));
    await writeFile('artifacts/https-browser.json',JSON.stringify({https:true,secureCookies:true,wssQueue:true,webRTC:true,originRejection:true,wasm:manifest.wasm,leave:true},null,2)+'\n');
    console.log('Container HTTPS/WSS deployment passed: secure cookies, queue, WebRTC controls, origin rejection and leave.');
  }finally{
    await Promise.all(contexts.map(context=>context.close()));
    try{const {stdout,stderr}=await compose(['logs','--no-color']);await writeFile('artifacts/https-server.log',stdout+stderr);}finally{await compose(['down','--volumes']);await rm(directory,{recursive:true,force:true});}
  }
}
