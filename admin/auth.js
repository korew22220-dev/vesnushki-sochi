(() => {
  const config=window.VESNUSHKI_ADMIN_CONFIG||{},pending=new Map();
  let accessToken='',initialized=false;
  const authPanel=document.querySelector('#auth-panel'),loginForm=document.querySelector('#login-form');
  const message=text=>document.querySelector('#auth-message').textContent=text;
  function loginScreen(text=''){
    accessToken='';authPanel.hidden=false;
    document.querySelector('#admin-main').hidden=true;document.querySelector('.sidebar').hidden=true;
    message(text);document.querySelector('#login-email').focus();
  }
  async function call(path,options={}){
    let base;try{base=new URL(config.apiURL);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error()}catch{throw Error('Панель ещё не подключена. Владельцу нужно указать адрес серверного API в admin/config.js.')}
    const headers=new Headers(options.headers);if(accessToken)headers.set('Authorization','Bearer '+accessToken);
    let body=options.body;
    if(path==='/api/media'){
      const file=body.get('file');body=file;headers.set('Content-Type',file.type);
    }
    if(path==='/api/cms'&&options.method==='PUT'){
      const value=JSON.parse(body);value.uploads=[...pending.values()].map(p=>p.upload);body=JSON.stringify(value);
    }
    let res;try{res=await fetch(base.origin+path,{...options,headers,body,credentials:'omit',cache:'no-store'})}catch{throw Error('Нет связи с сервером. Правки остаются открытыми; проверьте подключение перед повтором.')}
    let data;try{data=await res.json()}catch{throw Error('Сервер вернул неизвестный ответ')}
    if(!res.ok){if(res.status===401&&path!=='/auth/login')loginScreen(data.message);const ex=Error(data.message||'Не удалось выполнить запрос');ex.status=res.status;throw ex}
    if(path==='/api/media'){
      const file=options.body.get('file');pending.set(data.url,{upload:data.upload,objectURL:URL.createObjectURL(file)});
    }
    return data;
  }
  window.adminRequest=async (path,options)=>{
    if(path==='/admin/preview-template'){
      const res=await fetch('/admin/preview-template.html',{cache:'no-store'});
      if(!res.ok)throw Error('Предпросмотр не найден');return {html:await res.text()};
    }
    return call(path,options);
  };
  window.previewPhoto=path=>pending.get(path)?.objectURL||path;
  window.clearStagedPhotos=()=>{for(const p of pending.values())URL.revokeObjectURL(p.objectURL);pending.clear()};
  loginForm.onsubmit=async event=>{
    event.preventDefault();const button=loginForm.querySelector('button');button.disabled=true;message('Входим…');
    const password=document.querySelector('#login-password');
    try{
      const data=await call('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#login-email').value.trim(),password:password.value})});
      accessToken=data.accessToken;password.value='';authPanel.hidden=true;document.querySelector('#admin-main').hidden=false;document.querySelector('.sidebar').hidden=false;
      if(!initialized){await window.adminBoot();initialized=true}
    }catch(ex){message(ex.message)}finally{password.value='';button.disabled=false}
  };
  document.querySelector('.exit').onclick=async event=>{
    event.preventDefault();if(window.hasUnsavedEdits?.()&&!confirm('Выйти и отменить несохранённые правки?'))return;
    try{await call('/auth/logout',{method:'POST'})}catch{}finally{accessToken='';window.clearStagedPhotos();location.reload()}
  };
  document.querySelector('#password-form').onsubmit=async event=>{
    event.preventDefault();const input=document.querySelector('#new-password'),status=document.querySelector('#password-status'),button=event.target.querySelector('button');button.disabled=true;
    try{await call('/auth/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});status.textContent='Пароль изменён'}catch(ex){status.textContent=ex.message}finally{input.value='';button.disabled=false}
  };
  document.querySelector('#recover-password').onclick=async()=>{
    const email=document.querySelector('#login-email');if(!email.reportValidity())return;
    const button=document.querySelector('#recover-password');button.disabled=true;
    try{const data=await call('/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim()})});message(data.message)}catch(ex){message(ex.message)}finally{button.disabled=false}
  };
  const callback=new URLSearchParams(location.hash.slice(1)),callbackToken=callback.get('access_token');
  if(callbackToken){
    // Invitation and recovery links: remove credentials from the URL immediately.
    history.replaceState(null,'',location.pathname+location.search);
    accessToken=callbackToken;
    document.addEventListener('DOMContentLoaded',async()=>{
      try{
        await call('/api/cms');authPanel.hidden=true;document.querySelector('#admin-main').hidden=false;document.querySelector('.sidebar').hidden=false;
        await window.adminBoot();initialized=true;document.querySelector('.password-settings').open=true;document.querySelector('#new-password').focus();
        document.querySelector('#password-status').textContent='Установите новый пароль для следующих входов.';
      }catch(ex){loginScreen(ex.message)}
    },{once:true});
  }
  window.hasAdminSession=()=>!!accessToken;
})();
