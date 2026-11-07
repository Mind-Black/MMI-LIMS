import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAllById} from '../supabase/functions/_shared/pagination.js';
test('Production feed retrieves every event above both 1000 and 2000 row caps',async()=>{
 const source=Array.from({length:2501},(_,i)=>({id:i+1}));let calls=0;
 const actual=await fetchAllById(()=>{let cursor;return {gt(_field,value){cursor=value;return this;},order(){return this;},async limit(size){calls++;return {data:source.filter(r=>r.id>cursor).slice(0,Math.min(size,1000)),error:null};}};});
 assert.equal(actual.length,2501);assert.equal(new Set(actual.map(r=>r.id)).size,2501);assert.equal(calls,7);
});
test('Feed errors are surfaced rather than returning an incomplete successful calendar',async()=>{
 await assert.rejects(fetchAllById(()=>({gt(){return this;},order(){return this;},limit(){return {error:new Error('offline')};}})),/offline/);
});
