import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../backend/worker.mjs';
import {validate} from '../backend/validation.mjs';
const initial=JSON.parse(await readFile(new URL('../content/site.json',import.meta.url)));
const origin='https://vesnushki-sochi23.ru';
const env={SITE_ORIGIN:origin,SUPABASE_URL:'https://test.supabase.co',SUPABASE_KEY:'test-public-key',ADMIN_USER_IDS:'client-id',GITHUB_TOKEN:'server-test-token'};
const originalFetch=globalThis.fetch;
let headSHA,store,commits,trees,calls,run,conflictOnUpdate;
const response=(obj,status=200)=>new Response(JSON.stringify(obj),{status});
const sha=n=>n.toString(16).padStart(40,'0');
const token='Bearer '+ 'a'.repeat(30);
const toBase64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64');
beforeEach(()=>{
 headSHA=sha(1);store=new Map();commits=new Map([[headSHA,{tree:{sha:sha(2)},content:structuredClone(initial)}]]);trees=new Map();calls=[];run=null;conflictOnUpdate=false;
 globalThis.fetch=async (input,options={})=>{
  const u=new URL(input),path=u.pathname;calls.push({url:input,options});
  if(u.hostname==='test.supabase.co'){
   if(path.endsWith('/token'))return response({access_token:'a'.repeat(30),expires_in:3600,user:{id:'client-id'}});
   if(path.endsWith('/user'))return options.headers.Authorization===token?response({id:'client-id'}):response({},401);
   if(path.endsWith('/logout'))return new Response(null,{status:204});
  }
  assert.equal(options.headers.Authorization,'Bearer server-test-token');
  const body=options.body?JSON.parse(options.body):null;
  if(path.includes('/git/ref/heads/'))return response({object:{sha:headSHA}});
  if(path.endsWith('/contents/content/site.json'))return response({content:toBase64(commits.get(u.searchParams.get('ref')).content)});
  if(/\/git\/commits\/[a-f0-9]+$/.test(path))return response(commits.get(path.split('/').at(-1)));
  if(/\/git\/trees\/[a-f0-9]+$/.test(path))return response({truncated:false,tree:[...new Set([...Object.values(initial.photos),...initial.gallery,...initial.teachers].map(x=>x.url.slice(1)))].map(path=>({path,type:'blob'})).concat([{path:'app.js',type:'blob'}])});
  if(path.endsWith('/git/blobs')){const id=sha(store.size+100);store.set(id,body.content);return response({sha:id})}
  if(path.includes('/git/blobs/')){const content=store.get(path.split('/').at(-1));return response({content,encoding:'base64',size:Buffer.from(content,'base64').length})}
  if(path.endsWith('/git/trees')){const id=sha(trees.size+500);trees.set(id,body);return response({sha:id})}
  if(path.endsWith('/git/commits')){const id=sha(commits.size+1000);commits.set(id,{tree:{sha:body.tree},parents:body.parents,content:JSON.parse(trees.get(body.tree).tree.find(x=>x.path==='content/site.json').content)});return response({sha:id})}
  if(path.includes('/git/refs/heads/')){const c=commits.get(body.sha);if(conflictOnUpdate||c.parents[0]!==headSHA)return response({},422);assert.equal(body.force,false);headSHA=body.sha;return response({object:{sha:headSHA}})}
  if(path.endsWith('/actions/workflows/publish.yml/runs'))return response({workflow_runs:run?[run]:[]});
  throw Error('Unexpected mock URL: '+input);
 };
});
afterEach(()=>{globalThis.fetch=originalFetch});
function request(path,method='GET',body=null,extra={}){
 return worker.fetch(new Request('https://api.example.workers.dev'+path,{method,headers:{Origin:origin,Authorization:token,...(body&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...extra},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined}),env);
}
test('GET reads current GitHub content and Unicode without leaking server credentials',async()=>{const result=await request('/api/cms');assert.equal(result.status,200);const data=await result.json();assert.equal(data.version,sha(1));assert.equal(data.content.contacts.address,initial.contacts.address);assert.ok(!JSON.stringify(data).includes(env.GITHUB_TOKEN))});
test('unauthenticated, forged and wrong-origin writes are denied before GitHub access',async()=>{
 for(const headers of [{Authorization:''},{Authorization:'Bearer '+'b'.repeat(30)},{Origin:'https://evil.test'}]){const result=await request('/api/cms','PUT',{content:initial,version:sha(1)},headers);assert.ok([401,403].includes(result.status))}
 assert.equal(calls.filter(x=>x.url.startsWith('https://api.github.com')).length,0);
});
test('allowlist removal immediately revokes access',async()=>{const result=await worker.fetch(new Request('https://api.example/api/cms',{headers:{Origin:origin,Authorization:token}}),{...env,ADMIN_USER_IDS:'different-id'});assert.equal(result.status,403)});
test('login returns only memory session token and password change is protected',async()=>{const result=await request('/auth/login','POST',{email:'client@example.com',password:'private-password'});const data=await result.json();assert.equal(result.status,200);assert.equal(data.accessToken,'a'.repeat(30));assert.equal(data.refresh_token,undefined);assert.equal((await request('/auth/password','PUT',{password:'short'})).status,400)});
test('save commits headline, description and price atomically, preserving base tree',async()=>{
 const c=structuredClone(initial);c.texts['hero.title1']='Новый заголовок';c.texts['hero.description']='Новое описание';c.prices.half=25000;
 const result=await request('/api/cms','PUT',{content:c,version:headSHA});assert.equal(result.status,200);
 assert.equal(commits.get(headSHA).content.texts['hero.title1'],'Новый заголовок');assert.equal(commits.get(headSHA).content.prices.half,25000);
 const tree=trees.get(commits.get(headSHA).tree.sha);assert.equal(tree.base_tree,sha(2));assert.deepEqual(tree.tree.map(x=>x.path),['content/site.json']);
});
test('stale and racing saves never overwrite newer commits',async()=>{
 assert.equal((await request('/api/cms','PUT',{content:initial,version:sha(999)})).status,409);
 conflictOnUpdate=true;assert.equal((await request('/api/cms','PUT',{content:initial,version:headSHA})).status,409);assert.equal(headSHA,sha(1));
});
test('upload stages binary image; Save attaches image and content in the same tree',async()=>{
 const bytes=Uint8Array.from(Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=','base64'));
 const staged=await request('/api/media','POST',bytes);assert.equal(staged.status,201);const upload=await staged.json();assert.equal(headSHA,sha(1));
 const c=structuredClone(initial);c.photos.image1.url=upload.url;
 const result=await request('/api/cms','PUT',{content:c,version:headSHA,uploads:[upload.upload]});assert.equal(result.status,200);
 const tree=trees.get(commits.get(headSHA).tree.sha).tree;assert.equal(tree.length,2);assert.ok(tree.some(x=>x.path===upload.upload.path));
});
test('missing, forged, oversized and SVG uploads are rejected',async()=>{
 assert.equal((await request('/api/media','POST',new TextEncoder().encode('<svg><script/></svg>'))).status,400);
 assert.equal((await request('/api/media','POST',new Uint8Array(2000001))).status,413);
 const c=structuredClone(initial);c.photos.image1.url='/media/'+crypto.randomUUID()+'.webp';assert.equal((await request('/api/cms','PUT',{content:c,version:headSHA})).status,400);
 assert.equal((await request('/api/cms','PUT',{content:initial,version:headSHA,uploads:[{path:'../../app.js',sha:sha(22)}]})).status,400);
});
test('schema rejects invalid dates, links, phone, hours, price and excessive cards',()=>{
 for(const modify of [c=>c.promotion.endDate='2026-02-31',c=>c.links.link0='javascript:alert(1)',c=>c.contacts.phone='123',c=>c.contacts.hours='88:00–99:00',c=>c.prices.half=-1,c=>c.teachers=Array(31).fill(c.teachers[0])]){const c=structuredClone(initial);modify(c);assert.throws(()=>validate(c))}
});
test('publication stays pending until Actions explicitly reports success',async()=>{
 assert.equal((await (await request('/api/status?commit='+headSHA)).json()).state,'pending');
 run={head_sha:headSHA,head_branch:'main',created_at:new Date().toISOString(),status:'completed',conclusion:'failure',html_url:'https://github.com/run'};
 assert.equal((await (await request('/api/status?commit='+headSHA)).json()).state,'failed');
 run.conclusion='success';assert.equal((await (await request('/api/status?commit='+headSHA)).json()).state,'published');
});

test('validation preserves all existing data and restores the legacy footer link',()=>{
 const expected=structuredClone(initial);delete expected.revision;expected.links.link35??='#main';
 assert.deepEqual(validate(initial),expected);
 const c=structuredClone(initial);delete c.links.link35;assert.equal(validate(c).links.link35,'#main');
 c.links.link35='https://example.com/';assert.equal(validate(c).links.link35,c.links.link35);
});
