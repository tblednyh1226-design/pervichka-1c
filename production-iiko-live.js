/* Production draft upload to the existing, privately configured iikoServer.
   Each click sends ONE NEW unposted act. No automatic retries or document-number lookups. */
const IIKO_LIVE_ENDPOINT='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-iiko-pomogator-drafts';
const iikoLiveState={busy:false,stores:[],connected:false,receipts:[],submitted:new Set(),guestClient:null};
function iikoLiveStatus(text,isError=false){
  const el=document.getElementById('iikoLiveStatus');
  if(el){el.textContent=text;el.style.color=isError?'#b42318':''}
}
// For production planning, the saved 32-character MAIN pairing is mandatory.
// To satisfy the existing server requirement for a valid Supabase JWT without
// an email/password prompt, create an anonymous *authenticated* session.
// This does NOT bypass the server's additional MAIN device-token verification.
async function iikoLiveCall(action,extra={}){
  if(typeof sb==='undefined')throw Error('Модуль безопасного сеанса не загружен.');
  const main=typeof planGuestStored==='function'?planGuestStored():null;
  if(!main?.deviceId||!/^[0-9a-f]{32}$/i.test(String(main.token||'')))
    throw Error('Подключите MAIN с сохранённым 32-символьным кодом.');
  // Never sign the entire bookkeeping app into an anonymous account.
  // A separate in-memory Supabase client holds the iiko-only guest session.
  const current=await sb.auth.getSession();
  if(current.error)throw Error('Не удалось проверить сеанс Помогатора: '+current.error.message);
  let session=current.data?.session;
  if(!session){
    if(!iikoLiveState.guestClient){
      if(typeof supabase==='undefined'||typeof supabase.createClient!=='function')
        throw Error('Не загружен модуль гостевого доступа.');
      iikoLiveState.guestClient=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
      });
    }
    const guestAuth=iikoLiveState.guestClient.auth;
    const cached=await guestAuth.getSession();
    session=cached?.data?.session||null;
    if(!session){
      iikoLiveStatus('Подключаю гостевой сеанс для работы с iiko без email и пароля…');
      const result=await guestAuth.signInAnonymously();
      if(result.error){
        const disabled=result.error.code==='anonymous_provider_disabled'||
          /anonymous.*(disabled|not enabled|not allowed)/i.test(result.error.message||'');
        if(disabled)throw Error('В Supabase отключён гостевой вход. Пробная отправка не выполнялась. Требуется включить безопасный гостевой режим после проверки прав доступа.');
        throw Error('Не удалось создать гостевой сеанс: '+result.error.message);
      }
      session=result.data?.session;
    }
  }
  if(!session?.access_token)throw Error('Сервер не создал действующий гостевой сеанс.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),90000);
  try{
    const r=await fetch(IIKO_LIVE_ENDPOINT,{method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json','authorization':'Bearer '+session.access_token,
        'x-device-id':main.deviceId,'x-browser-token':main.token},
      body:JSON.stringify({action,...extra}),signal:controller.signal});
    const result=await r.json().catch(()=>({ok:false,error:'Сервер iiko вернул ответ неизвестного формата'}));
    if(!r.ok||!result.ok)throw Error(result.error||'Ошибка соединения с iiko (HTTP '+r.status+')');
    return result;
  }catch(e){
    if(e?.name==='AbortError')
      throw Error('Неизвестен результат запроса: время ожидания истекло. Не отправляйте тот же акт повторно, пока не выясните результат в iiko.');
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
    const item={name,id,article,type:String(p.type||p.productType||'').toUpperCase()},key=iikoDraftExact(name);
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
document.addEventListener('DOMContentLoaded',()=>iikoLiveRefreshButtons());
