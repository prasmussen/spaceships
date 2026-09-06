import test from 'node:test';
import assert from 'node:assert/strict';
import {migratePreferences} from '../src/preferences.ts';
function storage(entries){const values=new Map(entries);return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('pre-rename controls, sound and motion migrate without changing their values',()=>{
 const settings={'controls-v3':'["KeyW","KeyA","KeyD","Space","ShiftLeft","KeyF"]','controls-v2':'[]','controls':'[]','sound':'false','reduced-motion':'true'};
 const saved=storage(Object.entries(settings).map(([key,value])=>[`cavern-${key}`,value]));
 migratePreferences(saved);
 for(const [key,value]of Object.entries(settings)){assert.equal(saved.getItem(`spaceships-${key}`),value);assert.equal(saved.getItem(`cavern-${key}`),null);}
 const migrated=[...saved.values];migratePreferences(saved);assert.deepEqual([...saved.values],migrated);
});
test('new preferences win and unsuccessful migration preserves the original',()=>{
 const saved=storage([['cavern-sound','true'],['spaceships-sound','false']]);migratePreferences(saved);assert.equal(saved.getItem('spaceships-sound'),'false');
 const unavailable=storage([['cavern-controls-v3','saved']]);unavailable.setItem=()=>{throw Error('Storage unavailable');};
 assert.throws(()=>migratePreferences(unavailable));assert.equal(unavailable.getItem('cavern-controls-v3'),'saved');
});
