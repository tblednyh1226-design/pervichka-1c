/* Transfer-only UI and iikoServer NEW internal transfer submission.
   Cooking acts, their data and their API remain untouched. */
const TRANSFER_ENDPOINT='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-iiko-pomogator-transfers';
const transferLive={connected:false,busy:false,stores:[],catalog:[],catalogById:new Map(),catalogByName:new Map(),
 mapped:new Map(),warehouse:new Map(),sending:new Set(),locks:new Set(),receipts:new Map(),sig:'',mappingEntries:[],editKeys:new Set(),mappingQueries:new Map(),savedRows:[]};
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
function transferHash(text){
 let h=2166136261;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
 return (h>>>0).toString(16).padStart(8,'0');
}
function transferLockKey(doc,i){
 const device=typeof planGuestStored==='function'?planGuestStored().deviceId:'';
 // Stable per-document identity: opening the SAME Excel by another button
 // or filename must never reactivate an already confirmed transfer.
 const ref=document.getElementById('prodDocDate')?.value||'';
 const date=typeof productionSheetISO==='function'?
   productionSheetISO(doc.date,ref)||String(doc.date||''):String(doc.date||'');
 const items=transferAllItems(doc).map(x=>({
   name:transferNorm(x.name),weight:transferNorm(x.weight),
   quantity:Number(x.quantity)
 })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const identity=transferHash(JSON.stringify({date,from:doc.source,to:doc.target,items}));
 const key='pomogator-transfer-once:v2:'+device+':'+identity;
 // Preserve earlier sent/uncertain results from the old filename-based keys.
 const legacy='pomogator-transfer-once:'+device+':'+transferLive.sig+':'+i+':'+doc.source+':'+doc.target;
 const old=localStorage.getItem(legacy);
 if(old&&!localStorage.getItem(key))localStorage.setItem(key,old);
 return key;
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
 return id?(transferLive.catalogById.get(id)||iikoDraftState.catalogList.find(p=>p.id===id)||null):null;
}
function transferMatchCandidates(query,allTypes=false){
 const source=typeof iikoDraftState!=='undefined'?iikoDraftState.catalogList:[];
 const score=typeof iikoDraftChoiceScore==='function'?iikoDraftChoiceScore:()=>0;
 return source.filter(p=>allTypes||!p.type||['DISH','PREPARED'].includes(String(p.type).toUpperCase()))
   .map(p=>({p,rank:score(p,query)})).filter(x=>x.rank>0)
   .sort((a,b)=>b.rank-a.rank||a.p.name.localeCompare(b.p.name,'ru'))
   .slice(0,30).map(x=>x.p);
}
// One list of unique source names for ALL transfer documents. It shares the
// cooking-act resolver and the same persistent MAIN mapping rows.
function transferMappingEntries(){
 const entries=new Map();
 for(const doc of typeof productionDocuments!=='undefined'?productionDocuments:[]){
   for(const item of transferAllItems(doc)){
     const key=iikoDraftSourceKey(item.name);
     if(!key||entries.has(key))continue;
     const resolved=iikoDraftResolveProduct(item);
     entries.set(key,{key,name:item.name,product:resolved.product||null,
       source:resolved.source||'',reason:resolved.error||''});
   }
 }
 return [...entries.values()].sort((a,b)=>
   Number(Boolean(a.product))-Number(Boolean(b.product))||
   a.name.localeCompare(b.name,'ru'));
}
function transferMappingCard(entry,index){
 const search=transferLive.mappingQueries.get(entry.key)||iikoDraftPrefix(entry.name);
 const allTypes=false;
 const picker=transferMatchCandidates(search,allTypes);
 const open=!entry.product||transferLive.editKeys.has(entry.key);
 return '<div class="iiko-mapping-card" id="transferMappingEntry-'+index+'">'+
   '<div><b>'+transferEscape(entry.name)+'</b></div>'+
   '<div class="muted">До скобок: '+transferEscape(entry.key)+'</div>'+
   (entry.product?
     '<div>Сопоставлено с iiko: <b>'+transferEscape(entry.product.name)+'</b>'+
     (entry.source==='saved'?' (запомнено в MAIN)':' (по названию)')+'</div>':
     '<div class="muted">'+transferEscape(entry.reason||'Не сопоставлено')+'</div>')+
   '<div id="transferMappingControls-'+index+'"'+(open?'':' hidden')+'>'+
   '<input type="search" id="transferSearch-'+index+'" value="'+transferEscape(search)+
      '" placeholder="Введите название или артикул" oninput="transferFilterProduct('+index+')">'+
   '<label style="display:flex;align-items:center;gap:8px;font-size:14px">'+
    '<input type="checkbox" id="transferAllTypes-'+index+
    '" style="width:16px;min-width:16px;max-width:16px;height:16px" onchange="transferFilterProduct('+index+')">'+
    'Все типы номенклатуры (не только блюда)</label>'+
   '<select id="transferProduct-'+index+'">'+
      '<option value="">Выберите блюдо iiko</option>'+
      picker.map(p=>'<option value="'+transferEscape(p.id)+'">'+transferEscape(p.name)+
        (p.article?' · '+transferEscape(p.article):'')+
        (p.type?' · '+transferEscape(p.type):'')+'</option>').join('')+
    '</select>'+
   '<small class="muted" id="transferChoiceNote-'+index+'">'+
     (picker.length?'Найдено '+picker.length+' подходящих позиций. Выберите правильную.':
       'Совпадений не найдено — уточните название или выберите «Все типы».')+
   '</small>'+
   '<button type="button" onclick="transferSaveMapping('+index+')">Подтвердить и запомнить</button></div>'+
   (entry.product&&!open?'<button class="transfer-map-button" type="button" onclick="transferEditMapping('+index+')">Изменить соответствие</button>':'')+
 '</div>';
}
function transferRenderMappingPanel(){
 const entries=transferLive.mappingEntries=transferMappingEntries();
 const saved=typeof iikoDraftState!=='undefined'?iikoDraftState.mappings:new Map();
 const matched=entries.filter(x=>x.product).length;
 const missing=entries.length-matched;
 const remembered=entries.filter(x=>x.product&&x.source==='saved').length;
 const missingList=entries.map((entry,i)=>({entry,i})).filter(x=>!x.entry.product||
   transferLive.editKeys.has(x.entry.key));
 const savedRows=transferLive.savedRows=[...saved.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ru'));
 const savedHtml='<details class="transfer-saved-mappings"><summary>Запомненные соответствия MAIN ('+
   savedRows.length+')</summary>'+
  '<p class="muted">Общий справочник для приготовления и перемещений.</p>'+
  (savedRows.length?'<div class="tablewrap"><table class="nomtable"><thead>'+
   '<tr><th>Блюдо из плана</th><th>Номенклатура iiko</th><th>Артикул</th><th></th></tr></thead><tbody>'+
   savedRows.map(([key,row],i)=>'<tr><td>'+transferEscape(key)+'</td><td>'+
     transferEscape(row.target_name)+'</td><td>'+
     transferEscape(row.target_article||row.target_id||'')+'</td><td>'+
     '<button type="button" onclick="transferDeleteSavedMapping('+i+')">Удалить</button></td></tr>').join('')+
   '</tbody></table></div>':'<p>Пока нет подтверждённых соответствий.</p>')+
  '</details>';
 const pending=!transferLive.connected?
   '<p class="muted">Для сопоставления сначала загрузите склады и номенклатуру iiko. '+
   'Если MAIN подключён, справочник загрузится автоматически.</p>':'';
 const stateError=typeof iikoDraftState!=='undefined'?
   (iikoDraftState.mappingError||''):'';
 const errors=stateError?'<p class="muted">'+transferEscape(stateError)+'</p>':'';
 const summary='<h3>Сопоставление номенклатуры iiko</h3>'+
   '<p><b>Сопоставлено: '+matched+' из '+entries.length+'</b>'+
   ' · по сохранённым соответствиям: '+remembered+
   ' · требуется сопоставить: '+missing+'</p>';
 const unresolved=missingList.length?
  '<h4>Требуется проверить / сопоставить ('+missingList.length+')</h4>'+
  '<p class="muted">Поиск, выбор блюда и кнопка «Подтвердить и запомнить» работают точно так же, '+
    'как в актах приготовления. Сохраняются для обеих вкладок.</p>'+
  '<div class="iiko-mapping-list">'+missingList.map(x=>transferMappingCard(x.entry,x.i)).join('')+'</div>':
  '<p>Все позиции из плана сопоставлены. Проверьте блюда и количества перед отправкой.</p>';
 const matchedRows=entries.map((entry,i)=>({entry,i})).filter(x=>x.entry.product);
 const matchedHTML='<details><summary>Посмотреть все подобранные блюда ('+matchedRows.length+')</summary>'+
   (matchedRows.length?'<div class="tablewrap"><table class="nomtable"><thead>'+
     '<tr><th>Название в плане</th><th>Номенклатура iiko</th><th>Источник</th><th></th></tr></thead><tbody>'+
     matchedRows.map(({entry,i})=>'<tr><td>'+transferEscape(entry.name)+
       '</td><td>'+transferEscape(entry.product.name)+'</td><td>'+
       (entry.source==='saved'?'Запомнено в MAIN':'Точное название')+'</td><td>'+
       '<button type="button" onclick="transferEditMapping('+i+')">Изменить</button></td></tr>').join('')+
     '</tbody></table></div>':'<p>Пока нет совпадений.</p>')+'</details>';
 return '<section id="transferMappingPanel">'+summary+pending+errors+unresolved+
   matchedHTML+savedHtml+'</section>';
}
function transferEditMapping(index){
 const entry=transferLive.mappingEntries[index];
 if(!entry)return;
 transferLive.editKeys.add(entry.key);
 transferRender();
 const el=document.getElementById('transferMappingEntry-'+
   transferLive.mappingEntries.findIndex(x=>x.key===entry.key));
 if(el)el.scrollIntoView({block:'center',behavior:'smooth'});
}
function transferFocusMapping(di,li){
 const item=transferAllItems(productionDocuments?.[di])[li];
 if(!item)return;
 const key=iikoDraftSourceKey(item.name);
 const index=transferLive.mappingEntries.findIndex(x=>x.key===key);
 if(index>=0)transferEditMapping(index);
}
async function transferDeleteSavedMapping(index){
 const row=transferLive.savedRows[index];
 if(!row)return;
 const [key,product]=row;
 if(!window.confirm('Удалить сохранённое соответствие «'+key+
   '» → «'+product.target_name+'» для обеих вкладок?'))return;
 if(transferLive.busy)return;
 transferLive.busy=true;
 transferRefreshSendButtons();
 transferStatus('Удаляю сохранённое соответствие из MAIN…');
 try{
   const device=typeof planGuestStored==='function'?planGuestStored():null;
   if(!device?.token||iikoDraftState.mappingDevice!==device.deviceId)
     throw Error('Нет действующей привязки MAIN');
   await planGuestFetch('iiko_map_delete',{source_key:key});
   if(planGuestStored().deviceId!==device.deviceId)
     throw Error('Привязка MAIN изменилась, обновите справочник');
   iikoDraftState.mappings.delete(key);
   iikoDraftRenderSaved();
   iikoDraftAutoCheck();
   transferStatus('Соответствие «'+key+'» удалено из общего справочника MAIN.');
 }catch(e){
   transferStatus('Не удалось удалить соответствие: '+String(e.message||e),true);
 }finally{
   transferLive.busy=false;
   transferRender();
 }
}
function transferFilterProduct(index){
 const entry=transferLive.mappingEntries[index];
 const input=document.getElementById('transferSearch-'+index);
 const picker=document.getElementById('transferProduct-'+index);
 const note=document.getElementById('transferChoiceNote-'+index);
 if(!entry||!picker)return;
 const query=String(input?.value||'').trim();
 transferLive.mappingQueries.set(entry.key,query);
 const allTypes=Boolean(document.getElementById('transferAllTypes-'+index)?.checked);
 const products=query?transferMatchCandidates(query,allTypes):[];
 picker.innerHTML='<option value="">'+
   (query?'Выберите позицию iiko':'Введите название или артикул')+'</option>'+
   products.map(p=>'<option value="'+transferEscape(p.id)+'">'+transferEscape(p.name)+
     (p.article?' · '+transferEscape(p.article):'')+
     (p.type?' · '+transferEscape(p.type):'')+'</option>').join('');
 picker.value='';
 if(note)note.textContent=products.length?'Найдено '+products.length+' позиций — выберите нужную.':
   allTypes?'Ничего не найдено, уточните название или артикул.':
   'Среди блюд совпадений нет. Попробуйте «Все типы».';
}
async function transferSaveMapping(index){
 const entry=transferLive.mappingEntries[index];
 const field=document.getElementById('transferProduct-'+index);
 const id=String(field?.value||'');
 const product=iikoDraftState.catalogList.find(p=>p.id===id);
 if(!entry||!product){transferStatus('Выберите конкретную позицию iiko из списка.',true);return}
 if(transferLive.busy)return;
 if(product.type&&!['DISH','PREPARED'].includes(String(product.type).toUpperCase())){
   if(!window.confirm('Вы выбрали '+product.type+' — не готовое блюдо. Запомнить?'))return;
 }
 transferLive.busy=true;
 transferRefreshSendButtons();
 transferStatus('Сохраняю общее сопоставление MAIN для приготовления и перемещений…');
 try{
   await iikoDraftSaveMapping(entry.name,product);
   transferLive.editKeys.delete(entry.key);
   transferLive.mappingQueries.delete(entry.key);
   transferStatus('Запомнено: «'+entry.name+'» → «'+product.name+
     '». Соответствие применяется в обеих вкладках.');
 }catch(e){
   transferStatus('Не удалось сохранить соответствие: '+String(e.message||e),true);
 }finally{
   transferLive.busy=false;
   transferRender();
 }
}
function transferStoreOptions(routeName,selectedId){
 const options=transferLive.stores.map(s=>'<option value="'+transferEscape(s.id)+'"'+
   (s.id===selectedId?' selected':'')+'>'+transferEscape(s.name)+'</option>').join('');
 return '<option value="">'+(transferLive.connected?'Выберите склад iiko':'Сначала загрузите склады iiko')+'</option>'+options;
}
function transferExactStore(name){
 // The production plan uses «Рэдмонд», while iiko names the store «Редмонд».
 // Canonicalize this known alias; accept only a unique warehouse match.
 const short=v=>transferNorm(v).replace(/[«»"']/g,'').replace(/[._-]+/g,' ')
   .replace(/\s+/g,' ').replace(/рэдмонд/g,'редмонд').trim();
 const needle=short(name);
 if(!needle)return '';
 const exact=transferLive.stores.filter(store=>short(store.name)===needle);
 if(exact.length===1)return exact[0].id;
 if(exact.length>1)return '';
 const matches=transferLive.stores.filter(store=>short(store.name).startsWith(needle+' '));
 return matches.length===1?matches[0].id:'';
}
function transferStore(di,kind){
 const doc=productionDocuments?.[di];if(!doc)return '';
 const k=di+':'+kind,stored=transferLive.warehouse.get(k);
 const name=kind==='from'?doc.source:doc.target;
 // Explicit manual choice wins; otherwise resolve from the loaded iiko stores.
 return transferLive.stores.some(s=>s.id===stored)?stored:transferExactStore(name);
}
function transferEnsureCatalog(){
 if(typeof productionDocuments==='undefined'||!productionDocuments.length||
    transferLive.connected||transferLive.busy)return;
 const pair=typeof planGuestStored==='function'?planGuestStored():null;
 if(pair?.deviceId&&pair?.token)void transferConnect();
}
function transferRememberStore(di,kind,value){
 transferLive.warehouse.set(di+':'+kind,String(value||''));
 transferRefreshSendButtons();
}
// Date alignment belongs to productionSelectSheet/productionSelectDate.
function transferRowDate(){
 if(typeof productionSyncTransferDate==='function')productionSyncTransferDate();
}
function transferDetailItems(doc,di){
 return '<div class="tablewrap"><table class="nomtable"><thead><tr>'+
   '<th>Блюдо из Excel</th><th>Количество</th><th>Номенклатура iiko</th></tr></thead><tbody>'+
   transferAllItems(doc).map((item,li)=>{
     const result=typeof iikoDraftResolveProduct==='function'?
       iikoDraftResolveProduct(item):{error:'Справочник недоступен'};
     const product=result.product||null;
     return '<tr><td>'+transferEscape(item.name)+'</td><td class="numeric">'+
       transferEscape(item.quantity)+
       (item.conversionFactor===8?'<small class="muted"> ('+
         transferEscape(item.sourceQuantity)+' пирог × 8 = '+
         transferEscape(item.quantity)+' кус.)</small>':'')+
       '</td><td>'+
       (product?'<b>'+transferEscape(product.name)+'</b>'+
         (result.source==='saved'?' · Запомнено':''):
         '<strong>Не сопоставлено</strong> · '+transferEscape(result.error||''))+
       ' <button class="transfer-map-button" type="button" onclick="transferFocusMapping('+di+','+li+')">'+
       (product?'Изменить':'Сопоставить')+'</button></td></tr>';
   }).join('')+'</tbody></table></div>';
}
function transferRender(){
 transferEnsureCatalog();
 const area=document.getElementById('prodresult');
 if(!area||typeof productionDocuments==='undefined'||!productionDocuments.length)return;
 const nextSig=transferSignature();
 if(nextSig!==transferLive.sig){
   transferLive.sig=nextSig;transferLive.mapped.clear();transferLive.warehouse.clear();
   transferLive.mappingQueries.clear();transferLive.editKeys.clear();
 }
 const docs=productionDocuments;
 const totalQty=doc=>transferAllItems(doc).reduce((n,x)=>n+Number(x.quantity),0);
 const items=docs.map((doc,i)=>{
  const lock=transferLockKey(doc,i);
  const isLocked=transferLive.locks.has(lock)||Boolean(localStorage.getItem(lock));
  const from=transferStore(i,'from'),to=transferStore(i,'to');
  const sending=transferLive.sending.has(lock);
  const disabled=!transferLive.connected||isLocked||transferLive.busy||sending||!from||!to||
    transferAllItems(doc).some((item,j)=>!transferFindProduct(item,i,j));
  return '<article class="transfer-document" data-index="'+i+'">'+
   '<div class="transfer-summary-row">'+
    '<div><span class="transfer-label">Отправитель</span><strong>'+transferEscape(doc.source)+'</strong></div>'+
    '<div><span class="transfer-label">Получатель</span><strong>'+transferEscape(doc.target)+'</strong></div>'+
    '<div><span class="transfer-label">Количество</span><strong>'+totalQty(doc).toLocaleString('ru-RU')+'</strong></div>'+
    '<div><span class="transfer-label">Сумма, ₽</span><strong title="Себестоимость пока не загружена">—</strong></div>'+
    '<div><button type="button" class="primary transfer-send" id="transferSend-'+i+'"'+(disabled?' disabled':'')+
      ' onclick="transferSend('+i+')">'+transferButtonLabel(lock)+'</button></div>'+
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
   (disabled?'<p class="transfer-receipt">Причина блокировки: '+transferEscape(transferDisabledReason(doc,i,lock))+'</p>':'')+
   (transferLive.receipts.has(lock)?
     '<p class="transfer-receipt">'+
     (transferLive.receipts.get(lock).ok?
       'iiko подтвердила создание документа NEW'+
         (transferLive.receipts.get(lock).number?', № '+transferEscape(transferLive.receipts.get(lock).number):''):
       'Ошибка ответа сервера: '+transferEscape(transferLive.receipts.get(lock).error||'Неизвестная ошибка')+
         '. Кнопка остаётся заблокированной.')+'</p>':'')+
  '</article>';
 }).join('');
 area.hidden=false;
 area.innerHTML=transferRenderMappingPanel()+'<h3>Документы перемещений — '+transferEscape(productionSheetName)+'</h3>'+
 '<p class="muted">Перемещения отправляются в iiko в любом порядке, независимо друг от друга. '+
 'Кнопка блокируется сразу при запуске отправки, без проверки журнала iiko. '+
 'Большие пироги пересчитаны в куски ×8. Документы NEW, без проведения. '+
 'Перед отправкой проверьте склад, блюда и количество.</p>'+
 '<p class="muted">Если название склада iiko отличается от названия в плане, выберите его внутри документа.</p>'+
 items;
 transferRefreshSendButtons();
}
function transferButtonLabel(key){
 if(transferLive.sending.has(key))return 'Отправляется…';
 const stored=String(localStorage.getItem(key)||'');
 if(stored.startsWith('confirmed:')||transferLive.receipts.get(key)?.ok)return 'Отправлено';
 // Dispatch has started; don't rely on iiko status checks or unlock later.
 if(stored||transferLive.locks.has(key))return 'Отправка запущена';
 return 'Отправить в iiko';
}
function transferDisabledReason(doc,i,key){
 if(transferLive.sending.has(key))return 'Запрос сейчас отправляется';
 if(transferLive.locks.has(key)||localStorage.getItem(key))return 'Отправка уже запускалась. Сначала проверьте документ в iiko, чтобы избежать дубля';
 if(transferLive.busy)return 'Загружается справочник iiko';
 if(!transferLive.connected)return 'Нет подключения к iiko';
 const from=transferStore(i,'from'),to=transferStore(i,'to');
 if(!from)return 'Не выбран склад-отправитель iiko';
 if(!to)return 'Не выбран склад-получатель iiko (проверьте Рэдмонд)';
 if(from===to)return 'Склады отправителя и получателя совпадают';
 const missing=transferAllItems(doc).filter((x,j)=>!transferFindProduct(x,i,j));
 if(missing.length)return 'Не сопоставлены блюда: '+missing.slice(0,5).map(x=>x.name).join(', ');
 return '';
}
function transferRefreshSendButtons(){
 if(typeof productionDocuments==='undefined')return;
 for(let i=0;i<productionDocuments.length;i++){
  const doc=productionDocuments[i],btn=document.getElementById('transferSend-'+i);
  if(!btn)continue;
  const key=transferLockKey(doc,i);
  const ready=transferLive.connected&&transferStore(i,'from')&&transferStore(i,'to')&&
   transferStore(i,'from')!==transferStore(i,'to')&&
   transferAllItems(doc).every((x,j)=>transferFindProduct(x,i,j));
  const locked=transferLive.locks.has(key)||Boolean(localStorage.getItem(key));
  const sending=transferLive.sending.has(key);
  btn.disabled=transferLive.busy||!ready||locked||sending;
  btn.textContent=transferButtonLabel(key);
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
   // Refresh BOTH saved mappings and the iiko catalog on every explicit
   // connection; changes made on another browser become visible immediately.
   await iikoDraftLoadMappings();
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
 }finally{
   transferLive.busy=false;
   if(button)button.disabled=false;
   // Rebuild diagnostic messages as well as buttons after catalog loading.
   // Previously transferRender ran while busy=true, leaving stale "loading" notices.
   if(typeof productionDocuments!=='undefined'&&productionDocuments.length)transferRender();
   else transferRefreshSendButtons();
 }
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
  if(e?.name==='AbortError')throw Error('Истекло время ожидания подтверждения. Отправка уже запускалась');
  throw e;
 }finally{clearTimeout(timer)}
}
async function transferSend(index){
 if(transferLive.busy||!transferLive.connected)return;
 const doc=productionDocuments[index];
 if(!doc||!doc.items?.length)return;
 const key=transferLockKey(doc,index);
 if(transferLive.sending.has(key)||transferLive.locks.has(key)||localStorage.getItem(key)){
   transferStatus('Отправка перемещения уже запускалась. Кнопка заблокирована.',true);return;
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
 // Only lock after prerequisites have passed and a real network send can start.
 const pair=typeof planGuestStored==='function'?planGuestStored():null;
 if(!pair?.deviceId||!/^[0-9a-f]{32}$/i.test(pair.token||'')){
   transferStatus('Не найден действующий код MAIN. Отправка не начиналась.',true);
   return;
 }
 // One-attempt lock: starts at dispatch, remains blocked whatever the response.
 transferLive.locks.add(key);
 transferLive.sending.add(key);
 localStorage.setItem(key,'pending');
 // Independent in-flight state: other documents remain clickable immediately.
 transferRefreshSendButtons();
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
   '. Запрос отправлялся; кнопка остаётся заблокированной.',true);
 }finally{
  transferLive.sending.delete(key);
  transferRender();
 }
}
