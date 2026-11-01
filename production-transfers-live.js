/* Transfer-only UI and iikoServer NEW internal transfer submission.
   Cooking acts, their data and their API remain untouched. */
const TRANSFER_ENDPOINT='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-iiko-pomogator-transfers';
const transferLive={connected:false,busy:false,stores:[],catalog:[],catalogById:new Map(),catalogByName:new Map(),
 mapped:new Map(),warehouse:new Map(),sending:new Set(),locks:new Set(),receipts:new Map(),sig:''};
const transferEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const transferNorm=v=>String(v??'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const transferPrefix=v=>String(v??'').split(/[（(]/,1)[0].trim();
const transferUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function transferStatus(message,bad=false){
 const e=document.getElementById('prodLiveStatus');
 if(e){e.textContent=message;e.style.color=bad?'#b42318':''}
}
function transferSignature(){
 const origin=typeof productionFileName!=='undefined'?productionFileName:'';
 const sheet=typeof productionSheetName!=='undefined'?productionSheetName:'';
 const docs=typeof productionDocuments!=='undefined'?productionDocuments:[];
 const text=JSON.stringify({origin,sheet,docs});
 let hash=2166136261;
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
 return (hash>>>0).toString(16);
}
function transferLockKey(doc,i){
 const device=typeof planGuestStored==='function'?planGuestStored().deviceId:'';
 return 'pomogator-transfer-once:'+device+':'+transferLive.sig+':'+i+':'+doc.source+':'+doc.target;
}
function transferDate(){
 const input=document.getElementById('prodDocDate');
 const value=String(input?.value||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Выберите дату перемещений');
 const day=typeof productionSheetISO==='function'?productionSheetISO(productionSheetName,value):'';
 if(day!==value)throw Error('Дата документа и день Excel должны совпадать. Выберите день заново.');
 return value+'T16:00:00';
}
function transferAllItems(doc){
 return (doc?.items||[]).filter(x=>Number(x.quantity)>0);
}
function transferFindProduct(item,di,li){
 if(typeof iikoDraftResolveProduct!=='function')return null;
 const result=iikoDraftResolveProduct(item);
 const id=String(result.product?.id||'');
 return id?transferLive.catalogById.get(id)||null:null;
}
function transferMatchCandidates(query){
 const source=typeof iikoDraftState!=='undefined'?iikoDraftState.catalogList:[];
 const score=typeof iikoDraftChoiceScore==='function'?iikoDraftChoiceScore:()=>0;
 return source.filter(p=>!p.type||['DISH','PREPARED'].includes(String(p.type).toUpperCase()))
   .map(p=>({p,rank:score(p,query)})).filter(x=>x.rank>0)
   .sort((a,b)=>b.rank-a.rank||a.p.name.localeCompare(b.p.name,'ru'))
   .slice(0,30).map(x=>x.p);
}
function transferStoreOptions(routeName,selectedId){
 const options=transferLive.stores.map(s=>'<option value="'+transferEscape(s.id)+'"'+
   (s.id===selectedId?' selected':'')+'>'+transferEscape(s.name)+'</option>').join('');
 return '<option value="">'+(transferLive.connected?'Выберите склад iiko':'Сначала загрузите склады iiko')+'</option>'+options;
}
function transferExactStore(name){
 const matches=transferLive.stores.filter(s=>transferNorm(s.name)===transferNorm(name));
 return matches.length===1?matches[0].id:'';
}
function transferStore(di,kind){
 const doc=productionDocuments?.[di];if(!doc)return '';
 const k=di+':'+kind,stored=transferLive.warehouse.get(k);
 const name=kind==='from'?doc.source:doc.target;
 return transferLive.stores.some(s=>s.id===stored)?stored:transferExactStore(name);
}
function transferRememberStore(di,kind,value){
 transferLive.warehouse.set(di+':'+kind,String(value||''));
 transferRefreshSendButtons();
}
// Date alignment belongs to productionSelectSheet/productionSelectDate.
function transferRowDate(){
 if(typeof productionSyncTransferDate==='function')productionSyncTransferDate();
}
function transferProductControls(di,li,item,selected){
 const options=transferMatchCandidates(transferPrefix(item.name));
 if(selected&&!options.some(x=>x.id===selected.id))options.unshift(selected);
 const choices='<option value="">Выберите блюдо iiko</option>'+
   options.map(p=>'<option value="'+transferEscape(p.id)+'"'+
     (selected?.id===p.id?' selected':'')+'>'+transferEscape(p.name)+
     (p.article?' · '+transferEscape(p.article):'')+'</option>').join('');
 return '<div class="transfer-product-controls" id="transferMapBox-'+di+'-'+li+'"'+(selected?' hidden':'')+'>'+
   '<input type="search" id="transferSearch-'+di+'-'+li+'" value="'+transferEscape(transferPrefix(item.name))+
   '" placeholder="Название блюда или артикул" oninput="transferFilterProduct('+di+','+li+',this.value)">'+
   '<select id="transferProduct-'+di+'-'+li+'" onchange="transferChooseProduct('+di+','+li+',this.value)">'+
   choices+'</select></div>';
}
function transferDetailItems(doc,di){
 return '<div class="tablewrap"><table class="nomtable"><thead><tr>'+
   '<th>Блюдо из Excel</th><th>Количество</th><th>Позиция iiko</th></tr></thead><tbody>'+
   transferAllItems(doc).map((item,li)=>{
     const product=transferFindProduct(item,di,li);
     return '<tr><td>'+transferEscape(item.name)+'</td><td class="numeric">'+
       transferEscape(item.quantity)+'</td><td>'+
       '<span id="transferMatchLabel-'+di+'-'+li+'">'+
       (product?transferEscape(product.name):'Не сопоставлено')+'</span> '+
       '<button class="transfer-map-button" type="button" onclick="transferToggleMapping('+di+','+li+')">'+
       (product?'Изменить':'Выбрать блюдо')+'</button>'+
       transferProductControls(di,li,item,product)+'</td></tr>';
   }).join('')+'</tbody></table></div>';
}
function transferRender(){
 const area=document.getElementById('prodresult');
 if(!area||typeof productionDocuments==='undefined'||!productionDocuments.length)return;
 const nextSig=transferSignature();
 if(nextSig!==transferLive.sig){
   transferLive.sig=nextSig;transferLive.mapped.clear();transferLive.warehouse.clear();
 }
 const docs=productionDocuments;
 const totalQty=doc=>transferAllItems(doc).reduce((n,x)=>n+Number(x.quantity),0);
 const items=docs.map((doc,i)=>{
  const lock=transferLockKey(doc,i);
  const isLocked=transferLive.locks.has(lock)||Boolean(localStorage.getItem(lock));
  const res=transferLive.receipts.get(lock);
  const persisted=String(localStorage.getItem(lock)||'');
  const from=transferStore(i,'from'),to=transferStore(i,'to');
  const disabled=!transferLive.connected||isLocked||transferLive.busy||!from||!to||
    transferAllItems(doc).some((item,j)=>!transferFindProduct(item,i,j));
  return '<article class="transfer-document" data-index="'+i+'">'+
   '<div class="transfer-summary-row">'+
    '<div><span class="transfer-label">Отправитель</span><strong>'+transferEscape(doc.source)+'</strong></div>'+
    '<div><span class="transfer-label">Получатель</span><strong>'+transferEscape(doc.target)+'</strong></div>'+
    '<div><span class="transfer-label">Количество</span><strong>'+totalQty(doc).toLocaleString('ru-RU')+'</strong></div>'+
    '<div><span class="transfer-label">Сумма, ₽</span><strong title="Себестоимость пока не загружена">—</strong></div>'+
    '<div><button type="button" class="primary transfer-send" id="transferSend-'+i+'"'+(disabled?' disabled':'')+
      ' onclick="transferSend('+i+')">'+(res?.ok||persisted.startsWith('confirmed:')?'Отправлено':isLocked?'Проверьте в iiko':'Отправить в iiko')+'</button></div>'+
   '</div>'+
   '<details class="transfer-detail" id="transferDetail-'+i+'"><summary>Проверить блюда и количество ('+
     doc.items.length+' поз.)</summary>'+
     '<div class="transfer-warehouse"><label>Склад-отправитель iiko'+
       '<select id="transferFrom-'+i+'" onchange="transferRememberStore('+i+',\'from\',this.value)">'+
       transferStoreOptions(doc.source,from)+'</select></label>'+
     '<label>Склад-получатель iiko'+
       '<select id="transferTo-'+i+'" onchange="transferRememberStore('+i+',\'to\',this.value)">'+
       transferStoreOptions(doc.target,to)+'</select></label></div>'+
      transferDetailItems(doc,i)+
      '<p class="muted">Сумма появится после подключения достоверной себестоимости. Ноль не подставляется.</p>'+
   '</details>'+
   (res?'<p class="transfer-receipt">'+(res.ok?'iiko приняла документ NEW'+(res.number?', № '+transferEscape(res.number):''):
     'Результат неизвестен — проверьте документ в iiko перед повтором')+'</p>':'')+
   (persisted==='pending'?'<button type="button" class="transfer-map-button" onclick="transferUnlock('+i+')">'+
      'Я проверила в iiko: документа нет — разрешить повтор</button>':'')+
  '</article>';
 }).join('');
 area.hidden=false;
 area.innerHTML='<h3>Шаг 2. Документы перемещений — '+transferEscape(productionSheetName)+'</h3>'+
 '<p class="muted">Непроведённые документы NEW. Сумма пока не рассчитана: данных о себестоимости нет. '+
 'Перед отправкой откройте документ и проверьте склад и номенклатуру.</p>'+
 '<p class="muted">Если название склада iiko отличается от названия в плане, выберите его внутри документа.</p>'+
 items;
 transferRefreshSendButtons();
}
function transferUpstreamReady(index){
 if(index===0)return true;
 const first=productionDocuments?.[0];
 if(!first||first.source!=='Правда кухня'||first.target!=='Бухара кухня')return true;
 const key=transferLockKey(first,0);
 return String(localStorage.getItem(key)||'').startsWith('confirmed:');
}
function transferUnlock(index){
 const doc=productionDocuments?.[index];if(!doc)return;
 const key=transferLockKey(doc,index);
 if(localStorage.getItem(key)!=='pending')return;
 if(!window.confirm('Вы лично проверили журнал внутренних перемещений iiko и убедились, что этого документа там НЕТ? Разрешить одну новую попытку?'))return;
 localStorage.removeItem(key);
 transferLive.locks.delete(key);
 transferLive.receipts.delete(key);
 transferRender();
 transferStatus('Повтор разрешён после ручной проверки iiko. Перед отправкой ещё раз сверьте позиции.');
}
function transferRefreshSendButtons(){
 if(typeof productionDocuments==='undefined')return;
 for(let i=0;i<productionDocuments.length;i++){
  const doc=productionDocuments[i],btn=document.getElementById('transferSend-'+i);
  if(!btn)continue;
  const key=transferLockKey(doc,i);
  const ready=transferLive.connected&&transferStore(i,'from')&&transferStore(i,'to')&&
   transferStore(i,'from')!==transferStore(i,'to')&&
   transferAllItems(doc).every((x,j)=>transferFindProduct(x,i,j))&&transferUpstreamReady(i);
  const locked=transferLive.locks.has(key)||Boolean(localStorage.getItem(key));
  btn.disabled=transferLive.busy||!ready||locked;
  btn.textContent=transferLive.receipts.get(key)?.ok||
    String(localStorage.getItem(key)||'').startsWith('confirmed:')?'Отправлено':
    locked?'Проверьте в iiko':!transferUpstreamReady(i)?'Сначала ПК → БК':'Отправить в iiko';
 }
}
function transferToggleMapping(di,li){
 const el=document.getElementById('transferMapBox-'+di+'-'+li);
 if(el)el.hidden=!el.hidden;
}
function transferFilterProduct(di,li,text){
 const el=document.getElementById('transferProduct-'+di+'-'+li);if(!el)return;
 const candidates=transferMatchCandidates(text);
 el.innerHTML='<option value="">Выберите позицию iiko</option>'+
 candidates.map(p=>'<option value="'+transferEscape(p.id)+'">'+transferEscape(p.name)+
   (p.article?' · '+transferEscape(p.article):'')+'</option>').join('');
}
async function transferChooseProduct(di,li,id){
 const product=transferLive.catalogById.get(id);
 const item=productionDocuments?.[di]?.items?.[li];
 if(!product||!item||transferLive.busy)return;
 const pair=typeof planGuestStored==='function'?planGuestStored():null;
 if(!pair?.deviceId||!pair?.token){
   transferStatus('Сначала подключите MAIN для общего сохранения соответствия.',true);
   return;
 }
 if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==pair.deviceId){
   transferStatus('Загружаю общий справочник MAIN…');
   await iikoDraftLoadMappings();
 }
 if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==pair.deviceId){
   transferStatus(iikoDraftState.mappingError||'Общий справочник не загрузился.',true);
   return;
 }
 const key=iikoDraftSourceKey(item.name);
 if(!key||key.length>300){transferStatus('Некорректное название блюда.',true);return}
 transferLive.busy=true;
 transferRefreshSendButtons();
 transferStatus('Сохраняю соответствие для актов приготовления и перемещений…');
 try{
   await planGuestFetch('iiko_map_save',{
     source_key:key,target_name:product.name,target_id:product.id||'',
     target_article:product.article||''
   });
   iikoDraftState.mappings.set(key,{source_key:key,target_name:product.name,
     target_id:product.id||'',target_article:product.article||''});
   if(typeof iikoDraftRenderSaved==='function')iikoDraftRenderSaved();
   if(typeof iikoDraftAutoCheck==='function')iikoDraftAutoCheck();
   transferStatus('Соответствие «'+item.name+'» → «'+product.name+
     '» сохранено для обеих вкладок.');
 }catch(e){
   transferStatus('Не удалось сохранить соответствие в MAIN: '+String(e.message||e),true);
 }finally{
   transferLive.busy=false;
   transferRender();
 }
}
async function transferConnect(){
 if(transferLive.busy)return;
 transferLive.busy=true;
 const button=document.getElementById('prodConnectIikoBtn');
 if(button)button.disabled=true;
 transferStatus('Подключаю единый справочник номенклатуры iiko и соответствия MAIN…');
 try{
   if(typeof iikoLiveConnect!=='function'||typeof iikoDraftLoadMappings!=='function')
     throw Error('Общий модуль сопоставлений не загружен');
   const pair=typeof planGuestStored==='function'?planGuestStored():null;
   if(!pair?.deviceId||!pair?.token)throw Error('Сначала подключите MAIN');
   if(!iikoLiveState.connected||iikoLiveState.mainDevice!==pair.deviceId)
     await iikoLiveConnect();
   if(!iikoLiveState.connected||iikoLiveState.mainDevice!==pair.deviceId)
     throw Error('iiko не подключена. Проверьте соединение на вкладке приготовления');
   if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==pair.deviceId)
     await iikoDraftLoadMappings();
   if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==pair.deviceId)
     throw Error(iikoDraftState.mappingError||'Не удалось загрузить общие соответствия');
   transferLive.catalog=iikoDraftState.catalogList.filter(p=>transferUUID.test(String(p.id||'')));
   transferLive.catalogById=new Map(transferLive.catalog.map(p=>[p.id,p]));
   transferLive.stores=iikoLiveState.stores.filter(p=>transferUUID.test(String(p.id||'')));
   if(!transferLive.catalog.length||!transferLive.stores.length)
     throw Error('iiko не вернула блюда или склады');
   transferLive.connected=true;
   transferStatus('Единый справочник подключён: '+transferLive.catalog.length+
     ' блюд, '+transferLive.stores.length+' складов, '+
     iikoDraftState.mappings.size+' подтверждённых соответствий. Одинаково для обеих вкладок.');
   if(productionDocuments?.length)transferRender();
 }catch(e){
   transferLive.connected=false;
   transferStatus('Справочник: '+String(e.message||e),true);
 }finally{transferLive.busy=false;if(button)button.disabled=false;transferRefreshSendButtons()}
}
async function transferPost(doc){
 const pair=typeof planGuestStored==='function'?planGuestStored():null;
 if(!pair?.deviceId||!/^[0-9a-f]{32}$/i.test(pair.token||''))
  throw Error('Не найден сохранённый код MAIN');
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),90000);
 try{
  const response=await fetch(TRANSFER_ENDPOINT,{method:'POST',cache:'no-store',
   headers:{'Content-Type':'application/json','x-device-id':pair.deviceId,'x-browser-token':pair.token},
   body:JSON.stringify({action:'upload_transfer',document:doc}),signal:ac.signal});
  const result=await response.json().catch(()=>({ok:false,error:'Непонятный ответ сервера iiko'}));
  if(!response.ok||!result.ok||!result.accepted)
     throw Error(result.error||'iiko не подтвердила перемещение');
  return result;
 }catch(e){
  if(e?.name==='AbortError')throw Error('Истекло время ожидания. Результат неизвестен — перед повтором проверьте iiko');
  throw e;
 }finally{clearTimeout(timer)}
}
async function transferSend(index){
 if(transferLive.busy||!transferLive.connected)return;
 const doc=productionDocuments[index];
 if(!doc||!doc.items?.length)return;
 const key=transferLockKey(doc,index);
 if(!transferUpstreamReady(index)){
   transferStatus('Сначала отправьте и подтвердите перемещение ПК → БК.',true);return;
 }
 if(transferLive.locks.has(key)||localStorage.getItem(key)){
   transferStatus('Этот документ уже отправлялся. Перед повтором обязательно проверьте iiko.',true);return;
 }
 const from=transferStore(index,'from'),to=transferStore(index,'to');
 if(!from||!to||from===to){transferStatus('Выберите два разных склада из iiko.',true);return}
 const list=transferAllItems(doc).map((item,j)=>{
  const p=transferFindProduct(item,index,j);
  return p?{productId:p.id,amount:Number(item.quantity)}:null;
 });
 if(list.some(x=>!x)){transferStatus('Не все блюда сопоставлены с iiko. Раскройте документ.',true);return}
 const used=new Set();
 for(const x of list){
   if(used.has(x.productId)){transferStatus('Два блюда попали в один код iiko. Сопоставление нужно исправить.',true);return}
   used.add(x.productId);
 }
 let date;try{date=transferDate()}catch(e){transferStatus(e.message,true);return}
 const message='Отправить РЕАЛЬНОЕ внутреннее перемещение в iiko?\n'+
    doc.source+' → '+doc.target+'\nДата: '+date.slice(0,10)+
    '\nПозиций: '+list.length+', количество: '+list.reduce((a,x)=>a+x.amount,0)+
    '\nСтатус NEW, без проведения. Номер генерирует iiko. Повтор создаст дубль.';
 if(!window.confirm(message))return;
 // Conservative one-attempt lock; uncertain responses must be checked manually.
 transferLive.locks.add(key);
 localStorage.setItem(key,'pending');
 transferLive.busy=true;transferRefreshSendButtons();
 transferStatus('Отправляю перемещение '+doc.source+' → '+doc.target+' в iiko (NEW)…');
 try{
  const payload={type:'transfer',status:'NEW',dateIncoming:date,
    storeFromId:from,storeToId:to,items:list};
  const result=await transferPost(payload);
  localStorage.setItem(key,'confirmed:'+result.id);
  transferLive.receipts.set(key,{ok:true,number:result.number||'',id:result.id});
  transferStatus('iiko приняла перемещение '+doc.source+' → '+doc.target+
    ' (NEW, без проведения). '+(result.number?'Номер '+result.number:'ID '+result.id)+'.');
 }catch(e){
  transferLive.receipts.set(key,{ok:false,error:String(e.message||e)});
  transferStatus('Перемещение '+doc.source+' → '+doc.target+': '+String(e.message||e)+
   '. Автоматических повторов нет. Проверьте iiko перед повтором.',true);
 }finally{transferLive.busy=false;transferRender()}
}
