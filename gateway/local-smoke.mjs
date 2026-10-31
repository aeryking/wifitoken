import assert from 'node:assert/strict';
const origin='http://127.0.0.1:19180';
const headers={'content-type':'application/json','x-router-control-token':'local-admin-test-only'};
async function call(path,options={}){const response=await fetch(origin+path,options);return {response,body:await response.json()};}
assert.equal((await call('/health')).response.status,200);
const card=await call('/v1/admin/cards',{method:'POST',headers,body:JSON.stringify({router_id:'test-shop-01',count:1,quota_type:'tokens',token_limit:18,ttl_hours:1})});
assert.equal(card.response.status,201);const key=card.body.cards[0].api_key;
const request={method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model:'deepseek-v4-flash',messages:[{role:'user',content:'test'}]})};
const completion=await call('/v1/chat/completions',request);assert.equal(completion.response.status,200);assert.equal(completion.body.usage.total_tokens,18);
await new Promise(resolve=>setTimeout(resolve,300));
const exhausted=await call('/v1/chat/completions',request);assert.equal(exhausted.response.status,402);assert.equal(exhausted.body.error,'quota_exhausted');
console.log('PASS: health, issue virtual key, mock upstream, usage metering and quota exhaustion');
