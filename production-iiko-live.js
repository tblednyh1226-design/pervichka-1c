/* Production draft upload to the existing, privately configured iikoServer.
   Each click sends ONE NEW unposted act. No automatic retries or document-number lookups. */
const IIKO_LIVE_ENDPOINT='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-iiko-pomogator-drafts';
const iikoLiveState={busy:false,stores:[],connected:false,receipts:[],submitted:new Set()};
function iikoLiveStatus(text,isError=false){
  const el=document.getElementById('iikoLiveStatus');
  if(el){el.textContent=text;el.style.color=isError?'#b42318':''}
}
// MAIN pairing grants access to the plan. iiko writes additionally require
// a personal Pomogator session, so guests need an explicit sign-in form.
function iikoLiveAuthMessage(message,isError=false){
  const el=document.getElementById('iikoLiveAuthMessage');
  if(el){el.textContent=message;el.style.color=isError?'#b42318':''}
}
function iikoLiveShowAuth(){
  const card=document.getElementById('iikoLiveAuthCard');
  if(card)card.hidden=false;
  iikoLiveAuthMessage('Войдите в аккаунт Помогатора. Код MAIN останется сохранённым.');
  const input=document.getElementById('iikoLiveLoginEmail');
  if(input&&typeof input.focus==='function')input.focus();
}
function iikoLiveHideAuth(){
  const card=document.getElementById('iikoLiveAuthCard');
  if(card)card.hidden=true;
  const pass=document.getElementById('iikoLiveLoginPassword');
  if(pass)pass.value='';
}
async function iikoLiveSignIn(){
  const email=String(document.getElementById('iikoLiveLoginEmail')?.value||'').trim().toLowerCase();
  const password=String(document.getElementById('iikoLiveLoginPassword')?.value||'');
  if(!email||!password){iikoLiveAuthMessage('Введите электронную почту и пароль.',true);return}
  const btn=document.getElementById('iikoLiveSignInBtn');
  if(btn)btn.disabled=true;
  iikoLiveAuthMessage('Выполняю вход в Помогатор…');
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    if(!data?.session)throw Error('Сеанс не создан. Проверьте подтверждение почты.');
    const note=document.getElementById('guestNote');if(note)note.hidden=true;
    document.body?.classList?.remove('guest-mode');
    iikoLiveHideAuth();
    iikoLiveStatus('Вход выполнен. Подключаюсь к iiko…');
    // Authentication is the only added step. Do not forget the saved MAIN token.
    await iikoLiveConnect();
  }catch(e){
    iikoLiveAuthMessage('Не удалось войти: '+String(e.message||e),true);
  }finally{if(btn)btn.disabled=false}
}
async function iikoLiveSignUp(){
  const email=String(document.getElementById('iikoLiveLoginEmail')?.value||'').trim().toLowerCase();
  const password=String(document.getElementById('iikoLiveLoginPassword')?.value||'');
  if(!email||password.length<6){iikoLiveAuthMessage('Укажите email и пароль не короче 6 символов.',true);return}
  const btn=document.getElementById('iikoLiveSignUpBtn');if(btn)btn.disabled=true;
  try{
    const {data,error}=await sb.auth.signUp({email,password});
    if(error)throw error;
    if(data?.session){
      document.getElementById('guestNote').hidden=true;
      iikoLiveHideAuth();
      await iikoLiveConnect();
    }else iikoLiveAuthMessage('Аккаунт создан. Подтвердите email по письму, затем нажмите «Войти».');
  }catch(e){iikoLiveAuthMessage('Не удалось создать аккаунт: '+String(e.message||e),true)}
  finally{if(btn)btn.disabled=false}
}
async function iikoLiveResetPassword(){
  const email=String(document.getElementById('iikoLiveLoginEmail')?.value||'').trim().toLowerCase();
  if(!email){iikoLiveAuthMessage('Сначала укажите email, на который отправить восстановление.',true);return}
  try{
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(error)throw error;
    iikoLiveAuthMessage('Если такой аккаунт существует, на почту отправлена ссылка для восстановления пароля.');
  }catch(e){iikoLiveAuthMessage('Не удалось отправить письмо: '+String(e.message||e),true)}
}
async function iikoLiveRefreshAuthHint(){
  const hint=document.getElementById('iikoLiveAuthHint');
  if(!hint)return;
  const {data,error}=await sb.auth.getSession();
  const session=!error?data?.session:null;
  hint.hidden=Boolean(session);
  if(session)iikoLiveHideAuth();
}
async function iikoLiveCall(action,extra={}){
  if(typeof sb==='undefined')throw Error('Сначала войдите в Помогатор.');
  const session=await sb.auth.getSession();
  const jwt=session?.data?.session?.access_token;
  const main=typeof planGuestStored==='function'?planGuestStored():null;
  if(!jwt){iikoLiveShowAuth();throw Error('На компьютере Иры гостевой режим. Войдите в аккаунт Помогатора через форму ниже. Код MAIN вводить повторно не нужно.');}
  if(!main?.deviceId||!main?.token)throw Error('Подключите MAIN с сохранённым 32-символьным кодом.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),90000);
  try{
    const r=await fetch(IIKO_LIVE_ENDPOINT,{method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json','authorization':'Bearer '+jwt,
        'x-device-id':main.deviceId,'x-browser-token':main.token},
      body:JSON.stringify({action,...extra}),signal:controller.signal});
    const result=await r.json().catch(()=>({ok:false,error:'Сервер iiko вернул ответ неизвестного формата'}));
    if(!r.ok||!result.ok)throw Error(result.error||'Ошибка соединения с iiko (HTTP '+r.status+')');
    return result;
  }catch(e){
    if(e?.name==='AbortError')throw Error('Неизвестен результат запроса: время ожидания истекло. Не отправляйте тот же акт повторно, пока не выясните результат в iiko.');
    throw e;
  }finally{clearTimeout(timeout)}
}
function iikoLiveSelectedStore(id){
  const el=document.getElementById(id);
  return String(el?.value||'');
}
function iikoLiveRenderStores(){
  const options=iikoLiveState.stores.map(s=>'<option value="'+iikoDraftHtml(s.id)+'">'+
    iikoDraftHtml(s.name)+(s.code?' ('+iikoDraftHtml(s.code)+')':'')+'</option>').join('');
  for(const id of ['iikoDraftBKFrom','iikoDraftBKTo','iikoDraftPKFrom','iikoDraftPKTo']){
    const field=document.getElementById(id);
    if(!field)continue;
    const previous=String(field.value||'');
    field.innerHTML='<option value="">Выберите склад iiko</option>'+options;
    if(iikoLiveState.stores.some(s=>s.id===previous))field.value=previous;
  }
}
function iikoLiveSetCatalog(catalog){
  const map=new Map(),values=[],seenIds=new Set();
  for(const p of catalog||[]){
    const name=String(p.name||'').trim(),id=String(p.id||'').trim(),article=String(p.article||'').trim();
    if(!name||(!id&&!article))continue;
    if(!/^[0-9a-f-]{36}$/i.test(id))continue;
    if(seenIds.has(id))continue;
    seenIds.add(id);
    const item={name,id,article},key=iikoDraftExact(name);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(item);values.push(item);
  }
  iikoDraftState.catalog=map;
  iikoDraftState.catalogList=values;
  iikoDraftState.catalogCount=values.length;
}
async function iikoLiveConnect(){
  if(iikoLiveState.busy)return;
  iikoLiveState.busy=true;
  const btn=document.getElementById('iikoLiveConnectBtn');
  if(btn)btn.disabled=true;
  iikoLiveStatus('Подключаюсь к iikoServer, загружаю номенклатуру и склады…');
  try{
    const result=await iikoLiveCall('catalog');
    if(!result.catalog?.length||!result.stores?.length)throw Error('iiko не вернула номенклатуру или список складов');
    iikoLiveSetCatalog(result.catalog);
    iikoLiveState.stores=result.stores;
    iikoLiveState.connected=true;
    iikoLiveRenderStores();
    iikoDraftAutoCheck();
    iikoLiveStatus('Подключение установлено. Получено '+iikoDraftState.catalogCount+
      ' позиций iiko и '+result.stores.length+' складов. Выберите склады БК и ПК. При несовпадениях подтвердите номенклатуру.');
  }catch(e){
    iikoLiveState.connected=false;
    iikoLiveStatus('Не удалось подключить iiko: '+(e.message||e),true);
  }finally{
    iikoLiveState.busy=false;
    if(btn)btn.disabled=false;
    iikoLiveRefreshButtons();
  }
}
function iikoLiveReceiptKey(doc,signature){
  return [doc.warehouseCode,doc.dateIncoming,signature].join('|');
}
function iikoLiveRefreshButtons(){
  const prepared=iikoDraftState.ready&&iikoDraftState.documents.length===2&&iikoLiveState.connected;
  for(const which of ['BK','PK']){
    const btn=document.getElementById('iikoLiveSend'+which);
    if(!btn)continue;
    const doc=iikoDraftState.documents.find(x=>x.warehouseCode===which);
    const key=doc?iikoLiveReceiptKey(doc,iikoDraftState.signature):'';
    btn.disabled=iikoLiveState.busy||!prepared||!doc||iikoLiveState.submitted.has(key);
  }
}
function iikoLiveRenderReceipts(){
  const el=document.getElementById('iikoLiveReceipts');if(!el)return;
  el.innerHTML=iikoLiveState.receipts.map(x=>
    '<div><b>'+iikoDraftHtml(x.warehouseCode)+' · '+iikoDraftHtml(x.date)+'</b> — '+
    (x.ok?'iiko приняла акт NEW':'Ошибка или результат неизвестен')+
    (x.number?', номер: '+iikoDraftHtml(x.number):'')+
    (x.error?', '+iikoDraftHtml(x.error):'')+'</div>').join('');
}
async function iikoLiveSend(which){
  if(iikoLiveState.busy)return;
  if(!iikoLiveState.connected){iikoLiveStatus('Сначала загрузите справочник и склады прямо из iiko.',true);return}
  // Always rebuild using current plan, mappings, quantities and warehouse selections.
  const result=iikoDraftCheck();
  if(!iikoDraftState.ready||result?.issues?.length||result?.mismatches?.length){
    iikoLiveStatus('Есть ошибки или неподтверждённая номенклатура. Отправка не выполнена.',true);
    return;
  }
  const doc=iikoDraftState.documents.find(x=>x.warehouseCode===which);
  if(!doc){iikoLiveStatus('Не найден акт '+which,true);return}
  const key=iikoLiveReceiptKey(doc,iikoDraftState.signature);
  if(iikoLiveState.submitted.has(key)){iikoLiveStatus('Этот вариант акта уже отправлен в текущем сеансе.',true);return}
  const warehouses=iikoLiveState.stores;
  const from=warehouses.find(s=>s.id===doc.storeFrom),to=warehouses.find(s=>s.id===doc.storeTo);
  if(!from||!to){iikoLiveStatus('Выберите склады из загруженного справочника iiko.',true);return}
  const date=doc.dateIncoming.slice(0,10);
  const message='Создать РЕАЛЬНЫЙ НЕПРОВЕДЁННЫЙ акт '+which+' в iiko за '+date+
    '?\nПозиций: '+doc.items.length+
    '.\nСписание: '+from.name+'. Выпуск: '+to.name+
    '.\nСтатус: NEW, проведение отключено. Номер не передаётся. Повторный запрос может создать дубль.';
  if(!window.confirm(message))return;
  iikoLiveState.busy=true;iikoLiveRefreshButtons();
  iikoLiveStatus('Отправляю акт '+which+' в iiko со статусом NEW, без номера и проведения…');
  try{
    const r=await iikoLiveCall('upload',{document:doc});
    iikoLiveState.submitted.add(key);
    iikoLiveState.receipts.unshift({warehouseCode:which,date,ok:true,number:r.number||'',error:''});
    iikoLiveStatus('iiko приняла акт '+which+' за '+date+' (NEW, не проведён). '+
      (r.number?'Номер: '+r.number+'.':'Номер в ответе не указан.')+
      ' Проверьте документ в iiko перед отправкой следующего.');
  }catch(e){
    const error=String(e.message||e);
    iikoLiveState.receipts.unshift({warehouseCode:which,date,ok:false,number:'',error});
    iikoLiveStatus('Акт '+which+': '+error+' Автоматическая повторная отправка отключена.',true);
  }finally{iikoLiveState.busy=false;iikoLiveRenderReceipts();iikoLiveRefreshButtons()}
}
document.addEventListener('DOMContentLoaded',()=>{
  iikoLiveRefreshButtons();
  iikoLiveRefreshAuthHint().catch(e=>console.warn('Auth state unavailable',e));
});
