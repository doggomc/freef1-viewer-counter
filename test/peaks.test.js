import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContext, contextCount, savePeak } from '../src/peaks.js';
test('context is bounded and excludes URLs', () => {
  assert.deepEqual(parseContext('{"type":"context","kind":"replay","key":"2026:race","label":"Race"}'), {kind:'replay',key:'2026:race',label:'Race'});
  assert.equal(parseContext('{"type":"context","kind":"other","key":"x","label":"https://example.com"}'), null);
  assert.equal(parseContext('{"type":"context","kind":"live","key":"x/y","label":"Race"}'), null);
});
test('counts only matching open connections and stores only new high-water marks', async () => {
  const x = {kind:'live',key:'2026:race',label:'Race'};
  const sock = (state, context) => ({readyState:state, deserializeAttachment:() => context});
  assert.equal(contextCount([sock(1,x),sock(3,x),sock(1,null)],x),1);
  const map = new Map(); let writes = 0;
  const db = {transaction:fn=>fn(db),get:async k=>structuredClone(map.get(k)),put:async(k,v)=>{writes++;map.set(k,structuredClone(v));}};
  await savePeak(db,'live',x.key,x.label,4); await savePeak(db,'live',x.key,x.label,2); await savePeak(db,'live',x.key,x.label,6);
  assert.equal(writes,2); assert.equal(map.get('peaks-v1')[0].peak,6);
});
