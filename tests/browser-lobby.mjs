import {checkOnlineGroups} from './browser-multiplayer.mjs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {checkFullMatch} from './browser-full-match.mjs';
// Invoked only from the approved tests/browser.mjs entry point.
export async function checkLobby(browser,turn){
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const base=`http://127.0.0.1:${port}`;
  const binary=resolve('artifacts/lobby-test-server');
  await promisify(execFile)('go',['build','-o',binary,'./cmd/server']);
  const service=spawn(binary,[],{env:{...process.env,LISTEN_ADDR:`127.0.0.1:${port}`,PUBLIC_ORIGINS:base,STATIC_DIR:resolve('dist'),REGIONS:'eu,us',TURN_URLS:turn?.urls??'',TURN_SECRET:turn?.secret??'',STUN_URLS:''},stdio:['ignore','pipe','pipe']});
  let logs='';service.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-8000)});service.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-8000)});
  let startError;service.on('error',error=>{startError=error});
  const contexts=[];
  try{
    const deadline=Date.now()+10000;
    while(true){if(startError)throw startError;if(service.exitCode!==null)throw Error(`Lobby exited: ${logs}`);try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(Date.now()>deadline)throw Error(`Lobby start timeout: ${logs}`);await new Promise(done=>setTimeout(done,40));}
    const pages=[];
    for(let player=0;player<2;player++){
      const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);await page.goto(base+'/healthz');
      const ok=await page.evaluate(async()=>{
        if((await fetch('/api/config')).status!==401)return false;
        const session=await fetch('/api/session',{method:'POST'});if(!session.ok)return false;
        const config=await(await fetch('/api/config')).json();window.lobbyMessages=[];
        const ws=new WebSocket(location.origin.replace('http','ws')+'/ws');window.lobbySocket=ws;
        ws.onmessage=e=>window.lobbyMessages.push(JSON.parse(e.data));
        await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
        ws.send(JSON.stringify({type:'hello',region:'eu',identity:config.identity}));return true;
      });assert.equal(ok,true);
      await page.waitForFunction(()=>window.lobbyMessages.some(m=>m.type==='hello'));
      const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==='cavern_guest'&&c.httpOnly&&c.sameSite==='Strict'));
    }
    const send=(page,message)=>page.evaluate(message=>window.lobbySocket.send(JSON.stringify(message)),message);
    const wait=(page,type)=>page.waitForFunction(type=>window.lobbyMessages.some(m=>m.type===type),type);
    await send(pages[0],{type:'create',players:2});await wait(pages[0],'room');const code=await pages[0].evaluate(()=>window.lobbyMessages.find(m=>m.type==='room').code);
    await send(pages[1],{type:'join',code});await wait(pages[1],'room');
    await Promise.all(pages.map(page=>send(page,{type:'ready',ready:true})));await Promise.all(pages.map(page=>wait(page,'match')));
    const matches=await Promise.all(pages.map(page=>page.evaluate(()=>window.lobbyMessages.find(m=>m.type==='match'))));
    assert.equal(matches[0].match.id,matches[1].match.id);assert.equal(matches[0].slot,0);assert.equal(matches[1].slot,1);
    const id=matches[0].match.id;
    await send(pages[0],{type:'signal',matchId:id,recipient:1,signal:{type:'offer',sdp:'browser-routing-check'}});await wait(pages[1],'signal');
    const forwarded=await pages[1].evaluate(()=>window.lobbyMessages.find(m=>m.type==='signal'));assert.equal(forwarded.sender,0);assert.equal(forwarded.signal.sdp,'browser-routing-check');
    await Promise.all(pages.map(page=>send(page,{type:'finish',matchId:id,winner:0}))); await Promise.all(pages.map(page=>wait(page,'ended')));
    const ended=await pages[1].evaluate(()=>window.lobbyMessages.find(m=>m.type==='ended'));assert.equal(ended.trust,'unverified');
    await Promise.all(pages.map(page=>page.evaluate(()=>{window.lobbyMessages=[];window.lobbySocket.send(JSON.stringify({type:'rematch'}))})));await Promise.all(pages.map(page=>wait(page,'match')));
    const rematch=await pages[0].evaluate(()=>window.lobbyMessages.find(m=>m.type==='match').match);assert.notEqual(rematch.id,id);assert.notEqual(rematch.epoch,matches[0].match.epoch);
    await send(pages[0],{type:'leave'});await wait(pages[0],'left');await wait(pages[1],'ended');
    await writeFile('artifacts/lobby-browser.json',JSON.stringify({guestCookies:true,invite:true,slots:[0,1],signaling:true,unverifiedResults:true,rematch:true,leave:true},null,2)+'\n');
    const gamePages=[];
    const sharedContext=await browser.newContext();contexts.push(sharedContext);
    for(let p=0;p<2;p++){
      const page=await sharedContext.newPage();gamePages.push(page);
      if(turn)await page.addInitScript(()=>{
        const NativeWorker=window.Worker;
        window.Worker=class extends NativeWorker{
          constructor(url,options){
            super(url,options);
            if(String(url).includes('online-worker'))this.addEventListener('message',({data})=>{if(data.type==='frame')window.onlineTestTick=data.tick;});
          }
        };
      });
      await page.goto(base);
      await page.evaluate(()=>{window.lobbyConnections=0;const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(...args){super(...args);window.activeLobbySocket=this;window.lobbyConnections++;}};});
      if(turn)await page.evaluate(()=>{window.relayPCs=[];const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(config){super({...config,iceTransportPolicy:'relay'});window.relayPCs.push(this);this.addEventListener('icecandidateerror',e=>{window.relayICEError={code:e.errorCode,text:e.errorText,url:e.url}});}};});
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('FUEL'));
      await page.getByRole('button',{name:'Find opponent',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
      await page.getByRole('button',{name:'Cancel search',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Search cancelled'));
    }
    for(const page of gamePages){
      assert.equal(await page.locator('#online-connect, #invite-create, #invite-form, #online-region, #force-relay').count(),0);
      assert.equal(await page.locator('#queue-cancel').isVisible(),false);
    }
    await gamePages[0].getByRole('button',{name:'Find opponent',exact:true}).click();
    await gamePages[0].waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
    assert.equal(await gamePages[0].locator('#queue-join').isVisible(),false);
    await gamePages[1].getByRole('button',{name:'Find opponent',exact:true}).click();
    await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000}))).catch(async error=>{if(turn)await writeFile('artifacts/relay-failure.json',JSON.stringify(await Promise.all(gamePages.map(page=>page.evaluate(async()=>({status:document.querySelector('#connection-status').textContent,error:window.relayICEError,pcs:await Promise.all(window.relayPCs.map(async pc=>({ice:pc.iceConnectionState,local:pc.localDescription,remote:pc.remoteDescription,stats:[...(await pc.getStats()).values()]})))})))),null,2));throw error;});
    if(turn)await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.endsWith('· relay'))));
    await Promise.all(gamePages.map(page=>page.keyboard.down('w')));
    await gamePages[0].keyboard.down('Space');await gamePages[1].keyboard.down('d');
    await gamePages[0].waitForTimeout(600);
    await Promise.all(gamePages.map(page=>page.keyboard.up('w')));await gamePages[0].keyboard.up('Space');await gamePages[1].keyboard.up('d');
    assert.ok(Number(await gamePages[1].locator('#status strong').nth(3).textContent())>0,'remote slot controls its own rotation');
    assert.ok(parseInt(await gamePages[0].locator('#status strong').first().textContent())<100,'online input consumes local fuel');
    if(turn)await Promise.all(gamePages.map(page=>page.waitForFunction(()=>window.onlineTestTick>=200)));
    let reconnectRequests=0;
    await gamePages[0].route('**/api/session',route=>{reconnectRequests++;return reconnectRequests===1?route.abort('failed'):route.continue();});
    await gamePages[0].evaluate(()=>window.activeLobbySocket.close());
    await gamePages[0].waitForFunction(()=>window.lobbyConnections>=2&&window.activeLobbySocket.readyState===WebSocket.OPEN);
    await gamePages[0].waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'));
    assert.ok(reconnectRequests>=2,'HTTP failure retries within reconnect grace');
    await gamePages[0].unroute('**/api/session');
    await gamePages[0].screenshot({path:'artifacts/online-match.png'});
    await gamePages[0].getByRole('button',{name:'Online duel',exact:true}).click();await gamePages[0].getByRole('button',{name:'Practice offline',exact:true}).click();
    assert.equal(await gamePages[0].locator('[data-mode]').first().getAttribute('aria-pressed'),'true');
    await gamePages[0].waitForFunction(()=>document.querySelector('#status').textContent.includes('ON PAD'));
    await gamePages[1].waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent));
    await gamePages[0].getByRole('button',{name:'Online duel',exact:true}).click();
    await gamePages[1].getByRole('button',{name:'Practice offline',exact:true}).click();
    await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('You left'))));
    await gamePages[1].getByRole('button',{name:'Online duel',exact:true}).click();
    await gamePages[0].getByRole('button',{name:'Find opponent',exact:true}).click();
    await gamePages[0].waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
    await gamePages[0].getByRole('button',{name:'Cancel search',exact:true}).click();
    await gamePages[0].waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Search cancelled'));
    for(let round=0;round<2;round++){
      await Promise.all(gamePages.map(page=>page.getByRole('button',{name:'Find opponent',exact:true}).click()));
      await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
      if(turn)await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.endsWith('· relay'))));
      await gamePages[1].keyboard.down('w');await gamePages[1].waitForTimeout(250);await gamePages[1].keyboard.up('w');
      assert.match(await gamePages[1].locator('#status').textContent(),/IN FLIGHT/);
      await gamePages[0].getByRole('button',{name:'Online duel',exact:true}).click();await gamePages[0].getByRole('button',{name:'Practice offline',exact:true}).click();
      await gamePages[1].waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent));
      await gamePages[1].getByRole('button',{name:'Practice offline',exact:true}).click();
      await Promise.all(gamePages.map(page=>page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('You left'))));
      await Promise.all(gamePages.map(page=>page.getByRole('button',{name:'Online duel',exact:true}).click()));
    }
    await writeFile(turn?'artifacts/relay-browser.json':'artifacts/online-browser.json',JSON.stringify({automaticMatchmaking:true,sharedCookieWindows:true,forcedRelay:!!turn,webRTC:true,bothControls:true,leave:true,httpReconnect:true,queueCancel:true,queueAndRequeue:true},null,2)+'\n');
    console.log('Online matchmaking UI passed through the Go service and real WebRTC: automatic start, flight controls and leave.');
    if(process.argv.includes('--multiplayer'))await checkOnlineGroups(browser,base,!!turn);
    console.log('Go service browser checks passed: guest cookies, invite, ready, signaling, finish, rematch and leave.');
    if(process.argv.includes('--full-match'))await checkFullMatch(browser,base,!!turn);
  }finally{
    await Promise.all(contexts.map(c=>c.close()));
    const stopped=service.exitCode!==null?Promise.resolve():once(service,'exit');service.kill('SIGTERM');
    const timer=setTimeout(()=>service.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);
    await writeFile('artifacts/lobby-server.log',logs);
  }
}
