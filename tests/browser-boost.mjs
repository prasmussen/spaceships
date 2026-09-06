import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'Practice offline',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('READY'));
 await page.keyboard.down('ShiftLeft');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ACTIVE'));await page.screenshot({path:'artifacts/boost.png'});await page.keyboard.up('ShiftLeft');
 await page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('ACTIVE'));
 await page.locator('#local-menu summary').click();await page.getByRole('button',{name:'Controls',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Boost',exact:true}).textContent(),'Left Shift');
 await page.getByRole('button',{name:'Boost',exact:true}).click();await page.keyboard.press('b');assert.equal(await page.getByRole('button',{name:'Boost',exact:true}).textContent(),'B');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Practice offline',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('READY'));await page.keyboard.down('b');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ACTIVE'));await page.keyboard.up('b');
 assert.equal(await page.locator('body.unavailable').count(),0);assert.deepEqual(errors,[]);console.log('Boost keyboard, HUD, rebind persistence and WebGPU smoke test passed');
}finally{await browser?.close();await server.close();}
