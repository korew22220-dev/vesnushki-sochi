import {validate,imagePaths,imageType,fields,editor} from './validation.mjs';
class APIError extends Error {constructor(status,message){super(message);this.status=status}}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const encoder=new TextEncoder(),decoder=new TextDecoder();
const base64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)};
const unbase64=value=>Uint8Array.from(atob(value.replace(/\s/g,'')),x=>x.charCodeAt(0));
async function limitedBody(req,limit){
 const announced=Number(req.headers.get('Content-Length'));
 if(announced>limit)throw new APIError(413,'Файл или запрос слишком большой');
 if(!req.body)return new Uint8Array();
 const reader=req.body.getReader(),chunks=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new APIError(413,'Файл или запрос слишком большой')}chunks.push(value)}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result;
}
async function inputJSON(req,limit=600000){try{return JSON.parse(decoder.decode(await limitedBody(req,limit)))}catch(ex){if(ex instanceof APIError)throw ex;throw new APIError(400,'Не удалось прочитать запрос')}}
function config(env){
 for(const key of ['GITHUB_TOKEN','SUPABASE_URL','SUPABASE_KEY','ADMIN_USER_IDS','SITE_ORIGIN'])if(!env[key])throw new APIError(503,'Сервер ещё не настроен владельцем сайта');
 const u=new URL(env.SUPABASE_URL);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co'))throw new APIError(503,'Проверьте настройки сервиса входа');
}
async function github(env,path,options={}){
 const response=await fetch('https://api.github.com/repos/korew22220-dev/vesnushki-sochi'+path,{...options,headers:{'Authorization':'Bearer '+env.GITHUB_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Vesnushki-CMS','Content-Type':'application/json'}});
 if(!response.ok){if([409,422].includes(response.status))throw new APIError(409,'Сайт уже изменился. Загрузите свежую версию перед сохранением');if(response.status===403||response.status===429)throw new APIError(503,'GitHub ограничил доступ. Проверьте срок ключа, разрешения или повторите позже');throw new APIError(502,'GitHub не выполнил запрос. Изменения не подтверждены; проверьте статус перед повтором')}
 return response.status===204?null:response.json();
}
async function auth(env,path,options={}){
 return fetch(env.SUPABASE_URL+'/auth/v1'+path,{...options,headers:{'apikey':env.SUPABASE_KEY,'Content-Type':'application/json',...(options.headers||{})}});
}
function allowed(env,user){return !!user?.id&&!user.banned_until&&(env.ADMIN_USER_IDS||'').split(',').map(x=>x.trim()).includes(user.id)}
async function identity(req,env){
 const token=req.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]{20,8000}$/.test(token))throw new APIError(401,'Войдите в панель управления');
 const response=await auth(env,'/user',{headers:{Authorization:token}});
 if(!response.ok)throw new APIError(401,'Сессия завершена. Войдите снова — ваши правки остаются открытыми');
 const user=await response.json();if(!allowed(env,user))throw new APIError(403,'Доступ к панели отозван');return user;
}
const branch=env=>env.GITHUB_BRANCH||'main';
async function head(env){return github(env,'/git/ref/heads/'+encodeURIComponent(branch(env)))}
async function document(env,sha){const result=await github(env,'/contents/content/site.json?ref='+sha);return JSON.parse(decoder.decode(unbase64(result.content)))}
const post=(body)=>({method:'POST',body:JSON.stringify(body)});
async function route(req,env){
 config(env);
 const url=new URL(req.url),path=url.pathname;
 if(path==='/auth/login'&&req.method==='POST'){
  const input=await inputJSON(req,16000);
  if(typeof input.email!=='string'||input.email.length>254||typeof input.password!=='string'||input.password.length>200)throw new APIError(400,'Введите почту и пароль');
  const response=await auth(env,'/token?grant_type=password',post({email:input.email,password:input.password}));
  if(response.status===429)throw new APIError(429,'Слишком много попыток входа. Повторите позже');
  if(!response.ok)throw new APIError(401,'Проверьте почту и пароль');
  const data=await response.json();if(!allowed(env,data.user))throw new APIError(403,'Доступ к панели не предоставлен');
  return json({accessToken:data.access_token,expiresIn:data.expires_in});
 }
 if(path==='/auth/recover'&&req.method==='POST'){
  const input=await inputJSON(req,16000);if(typeof input.email!=='string'||input.email.length>254)throw new APIError(400,'Введите электронную почту');
  const result=await auth(env,'/recover?redirect_to='+encodeURIComponent(env.SITE_ORIGIN+'/admin/'),post({email:input.email}));
  if(result.status===429)throw new APIError(429,'Слишком много запросов. Повторите позже');
  if(result.status>=500)throw new APIError(503,'Сервис восстановления временно недоступен');
  return json({message:'Если почта зарегистрирована, на неё придёт ссылка для восстановления пароля.'});
 }
 await identity(req,env);
 if(path==='/auth/logout'&&req.method==='POST'){
  const result=await auth(env,'/logout',{method:'POST',headers:{Authorization:req.headers.get('Authorization')}});
  if(!result.ok)throw new APIError(502,'Не удалось завершить серверную сессию');return json({ok:true});
 }
 if(path==='/auth/password'&&req.method==='PUT'){
  const input=await inputJSON(req,16000);
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>200)throw new APIError(400,'Новый пароль: от 12 до 200 символов');
  const response=await auth(env,'/user',{method:'PUT',headers:{Authorization:req.headers.get('Authorization')},body:JSON.stringify({password:input.password})});
  if(!response.ok)throw new APIError(400,'Не удалось изменить пароль. Войдите снова и повторите');return json({ok:true});
 }
 if(path==='/api/cms'&&req.method==='GET'){
  const current=await head(env);const content=await document(env,current.object.sha);content.links.link35??='#main';validate(content);
  return json({content,version:current.object.sha,fields,editor});
 }
 if(path==='/api/media'&&req.method==='POST'){
  const bytes=await limitedBody(req,2000000);let type;
  try{type=imageType(bytes)}catch(ex){throw new APIError(400,ex.message)}
  const file='media/'+crypto.randomUUID()+'.'+type.ext;
  const blob=await github(env,'/git/blobs',post({content:base64(bytes),encoding:'base64'}));
  // A blob is only staged. Save attaches it to the same commit as site.json.
  return json({url:'/'+file,upload:{path:file,sha:blob.sha}},201);
 }
 if(path==='/api/cms'&&req.method==='PUT'){
  const input=await inputJSON(req);let content;
  try{content=validate(input.content)}catch(ex){throw new APIError(400,ex.message)}
  const current=await head(env);
  if(input.version!==current.object.sha)throw new APIError(409,'Кто-то уже изменил сайт. Скопируйте свои правки и нажмите «Загрузить свежую версию»');
  const commit=await github(env,'/git/commits/'+current.object.sha);
  const uploads=input.uploads||[];
  if(!Array.isArray(uploads)||uploads.length>100)throw new APIError(400,'Слишком много новых фото. Сохраните их несколькими группами');
  const files=new Map();
  for(const u of uploads){if(!/^media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(u.path)||!/^[a-f0-9]{40}$/.test(u.sha)||files.has(u.path))throw new APIError(400,'Проверьте загруженные фотографии');files.set(u.path,u.sha)}
  const imageSet=new Set(imagePaths(content).map(x=>x.slice(1)));
  const existing=await github(env,'/git/trees/'+commit.tree.sha+'?recursive=1');
  if(existing.truncated)throw new APIError(503,'Слишком много файлов в репозитории. Нужна проверка разработчика');
  const existingFiles=new Set(existing.tree.filter(x=>x.type==='blob').map(x=>x.path));
  const elements=[];
  for(const path of imageSet){
   if(files.has(path)){
    const sha=files.get(path),blob=await github(env,'/git/blobs/'+sha);
    if(blob.size>2000000||blob.encoding!=='base64')throw new APIError(400,'Фото должно быть не больше 2 МБ после сжатия');
    let type;try{type=imageType(unbase64(blob.content))}catch(ex){throw new APIError(400,ex.message)}
    if(!path.endsWith('.'+type.ext))throw new APIError(400,'Неверный формат фотографии');
    elements.push({path,mode:'100644',type:'blob',sha});
   }else if(!existingFiles.has(path))throw new APIError(400,'Фотография не найдена. Загрузите её повторно');
  }
  content.revision=crypto.randomUUID();
  elements.push({path:'content/site.json',mode:'100644',type:'blob',content:JSON.stringify(content,null,2)+'\n'});
  const tree=await github(env,'/git/trees',post({base_tree:commit.tree.sha,tree:elements}));
  const saved=await github(env,'/git/commits',post({message:'CMS: обновить сайт «Веснушки»',tree:tree.sha,parents:[current.object.sha]}));
  // Non-forced ref update rejects a competing commit, including concurrent uploads.
  await github(env,'/git/refs/heads/'+encodeURIComponent(branch(env)),{method:'PATCH',body:JSON.stringify({sha:saved.sha,force:false})});
  return json({version:saved.sha,commitURL:'https://github.com/korew22220-dev/vesnushki-sochi/commit/'+saved.sha,message:'Сохранено в GitHub. Ожидаем публикацию.'});
 }
 if(path==='/api/status'&&req.method==='GET'){
  const sha=url.searchParams.get('commit');if(!/^[a-f0-9]{40}$/.test(sha||''))throw new APIError(400,'Неизвестная версия');
  const result=await github(env,'/actions/workflows/publish.yml/runs?head_sha='+sha+'&branch='+encodeURIComponent(branch(env))+'&per_page=10');
  const runs=result.workflow_runs.filter(r=>r.head_sha===sha&&r.head_branch===branch(env));
  const run=runs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  if(!run)return json({state:'pending',message:'Изменения сохранены. GitHub ещё не запустил сборку.'});
  if(run.status!=='completed')return json({state:'publishing',message:'GitHub собирает и публикует сайт…',runURL:run.html_url});
  if(run.conclusion!=='success')return json({state:'failed',message:'Изменения сохранены, но публикация не завершена. Проверьте GitHub Actions.',runURL:run.html_url});
  if(branch(env)!=='main')return json({state:'checked',message:'Проверки ветки выполнены. Публичный сайт ещё не обновлён.',runURL:run.html_url});
  const latest=await head(env);if(latest.object.sha!==sha)return json({state:'superseded',message:'После этой версии появились более новые изменения. Загрузите свежую версию сайта.',runURL:run.html_url});
  return json({state:'published',message:'Публикация GitHub Pages завершена. Обновите сайт; CDN может обновляться с задержкой.',runURL:run.html_url,siteURL:env.SITE_ORIGIN+'/'});
 }
 throw new APIError(404,'Неизвестный запрос');
}
export default {async fetch(req,env){
 const origin=req.headers.get('Origin');
 if(origin!==env.SITE_ORIGIN)return json({message:'Недопустимый источник запроса'},403);
 const cors={'Access-Control-Allow-Origin':env.SITE_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 let response;try{response=await route(req,env)}catch(ex){response=json({message:ex instanceof APIError?ex.message:'Не удалось выполнить запрос. Ваши правки остаются в редакторе'},ex instanceof APIError?ex.status:500)}
 const headers=new Headers(response.headers);for(const [k,v]of Object.entries(cors))headers.set(k,v);return new Response(response.body,{status:response.status,headers});
}};
