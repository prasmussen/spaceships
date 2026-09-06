import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function checkQuickPlay(browser,base,forceRelay=false){
const pages=[],errors=[];
try{
  for(let id=0;id<5;id++){
    const page=await browser.newPage();pages.push(page);
    page.on('pageerror',error=>errors.push(String(error)));
    await page.addInitScript(forceRelay=>{
      if(forceRelay){const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(config){super({...config,iceTransportPolicy:'relay'});}};}
      window.testFrames=[];window.testMatches=[];window.testSockets=[];window.testLobbyMessages=[];
      const OriginalWorker=window.Worker;
      window.Worker=class extends OriginalWorker{
        constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='frame'&&data.complete!==undefined){const state=new Int32Array(data.buffer);window.testFrames.push({tick:data.tick,players:state[5],scores:Array.from({length:state[5]},(_,i)=>state[27+i*16]),x:state[16],y:state[17],stalled:data.stalled});if(window.testFrames.length>100)window.testFrames.shift();}});}
      };
      const OriginalWebSocket=window.WebSocket;
      window.WebSocket=class extends OriginalWebSocket{
        constructor(...args){super(...args);window.testSockets.push(this);this.addEventListener('message',({data})=>{const m=JSON.parse(data);window.testLobbyMessages.push(m);if(window.testLobbyMessages.length>30)window.testLobbyMessages.shift();if(m.type==='match')window.testMatches.push(m);});}
      };
    },forceRelay);
    await page.goto(base);
    assert.equal(await page.locator('#online-players').count(),0);
    await page.getByRole('button',{name:'Quick play',exact:true}).click();
    const count=Math.min(id+1,4);
    await page.waitForFunction(players=>window.testFrames.at(-1)?.players===players&&window.testFrames.at(-1).tick>15,id===4?1:count,{timeout:25000});
    if(id<4)for(const previous of pages)await previous.waitForFunction(players=>window.testFrames.at(-1)?.players===players&&!window.testFrames.at(-1).stalled,count,{timeout:25000});
    if(id===0){
      const y=await page.evaluate(()=>window.testFrames.at(-1).y);
      await page.keyboard.down('w');await page.waitForFunction(y=>window.testFrames.at(-1).y!==y,y);await page.keyboard.up('w');
    }
    console.log(`Quick play ${id+1}: ${id===4?1:count} pilots flying`);
  }
  const ids=await Promise.all(pages.map(page=>page.evaluate(()=>window.testMatches.at(-1).match.id)));
  assert.ok(ids.slice(0,4).every(id=>id===ids[0]));assert.notEqual(ids[4],ids[0]);
  // Finish reports exercise the real lobby -> fresh mesh -> zero-score flow.
  for(const page of pages.slice(0,4))await page.evaluate(()=>{const match=window.testMatches.at(-1).match;window.testSockets.at(-1).send(JSON.stringify({type:'finish',matchId:match.id,winner:0}));});
  for(const page of pages.slice(0,4)){
    await page.waitForFunction(old=>window.testMatches.at(-1).match.id!==old,ids[0]);
    await page.waitForFunction(()=>window.testFrames.at(-1)?.tick>15&&!window.testFrames.at(-1).stalled&&window.testFrames.at(-1).scores.every(score=>score===0));
  }
  console.log('Round reset: all four pilots at zero');
  let attempts=0;
  await pages[0].route('**/api/session',route=>++attempts===1?route.abort('failed'):route.continue());
  const sockets=await pages[0].evaluate(()=>{const count=window.testSockets.length;window.testSockets.at(-1).close();return count;});
  await pages[0].waitForFunction(count=>window.testSockets.length>count&&window.testSockets.at(-1).readyState===WebSocket.OPEN,sockets);
  assert.ok(attempts>=2);await pages[0].unroute('**/api/session');
  await pages[0].waitForFunction(()=>!window.testFrames.at(-1).stalled);
  console.log('Lobby reconnect: HTTP retry preserves the room');
  // Explicit departure of the mesh coordinator must preserve the other players.
  await pages[0].getByRole('button',{name:'Open game menu'}).click();
  await pages[0].getByRole('button',{name:'Exit to lobby',exact:true}).click();
  for(const page of pages.slice(1,4))await page.waitForFunction(()=>window.testFrames.at(-1)?.players===3&&window.testFrames.at(-1).tick>15&&!window.testFrames.at(-1).stalled,null,{timeout:25000});
  console.log('Host left: three pilots continue');
  await pages[0].evaluate(()=>{window.testFrames=[];document.querySelector('#queue-join').click();});
  for(const page of pages.slice(0,4))await page.waitForFunction(()=>window.testFrames.at(-1)?.players>=2&&window.testFrames.at(-1).tick>15&&!window.testFrames.at(-1).stalled,null,{timeout:25000});
  console.log('Rejoin cooldown: requested match resumes automatically');
  // Abrupt tab closure exercises the reconnect grace period and coordinator promotion.
  const roster=await pages[1].evaluate(()=>window.testMatches.at(-1));
  const group=[];
  for(const page of pages)if(await page.evaluate(()=>window.testMatches.at(-1).match.id)===roster.match.id)group.push(page);
  const host=(await Promise.all(group.map(async page=>({page,slot:await page.evaluate(()=>window.testMatches.at(-1).slot)})))).find(entry=>entry.slot===0).page;
  const survivors=group.filter(page=>page!==host);await host.close();
  for(const page of survivors)await page.waitForFunction(players=>window.testFrames.at(-1)?.players===players&&window.testFrames.at(-1).tick>15&&!window.testFrames.at(-1).stalled,group.length-1,{timeout:30000});
  console.log('Closed host tab: surviving pilots continue after reconnect grace period');
  assert.deepEqual(errors,[]);
}catch(error){await writeFile('artifacts/quick-play-failure.json',JSON.stringify(await Promise.all(pages.filter(page=>!page.isClosed()).map(page=>page.evaluate(()=>({status:document.querySelector('#online-status')?.textContent,connection:document.querySelector('#connection-status')?.textContent,frame:window.testFrames?.at(-1),messages:window.testLobbyMessages})))),null,2));throw error;}finally{await Promise.all(pages.map(page=>page.close()));}
}
