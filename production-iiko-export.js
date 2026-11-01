/* Preparing iikoServer productionDocument XML. No network calls or live document creation. */
const iikoDraftState={catalog:new Map(),catalogList:[],catalogCount:0,documents:[],issues:[],
  mismatches:[],ready:false,signature:'',mappings:new Map(),mappingRows:[],
  mappingDevice:'',mappingLoading:false,mappingLoaded:false,mappingError:''};
function iikoDraftNorm(s){return String(s??'').toLowerCase().replace(/ё/g,'е').replace(/["«»]/g,'').replace(/\s+/g,' ').trim()}
// Composition in parentheses is not part of the product name. Preserve the full
// original plan name for reports and the source Excel.
function iikoDraftPrefix(s){return String(s??'').split(/[（(]/,1)[0].replace(/\s+/g,' ').trim()}
function iikoDraftSourceKey(s){return iikoDraftNorm(iikoDraftPrefix(s))}
function iikoDraftExact(s){return String(s??'').trim().replace(/\s+/g,' ')}
function iikoDraftEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function iikoDraftHtml(s){return iikoDraftEsc(s).replace(/&apos;/g,'&#39;')}
function iikoDraftOnlyPositive(items){return (items||[]).filter(x=>Number.isFinite(Number(x.quantity))&&Number(x.quantity)>0)}
function iikoDraftHashText(s){let h=2166136261;for(let k=0;k<s.length;k++){h^=s.charCodeAt(k);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function iikoDraftInvalidate(reason){
  iikoDraftState.ready=false;iikoDraftState.documents=[];iikoDraftState.issues=[];iikoDraftState.mismatches=[];
  const btn=document.getElementById('iikoDraftDownload');
  if(btn)btn.disabled=true;
  if(typeof iikoLiveRefreshButtons==='function')iikoLiveRefreshButtons();
  const mismatchesBtn=document.getElementById('iikoDraftMismatchDownload');
  if(mismatchesBtn)mismatchesBtn.disabled=true;
  const msg=document.getElementById('iikoDraftStatus');
  if(msg&&reason)msg.textContent=reason;
  const area=document.getElementById('iikoDraftResult');
  if(area)area.innerHTML='';
}
function iikoDraftXlsxRows(file,callback){
  return file.arrayBuffer().then(buffer=>{
    if(typeof XLSX==='undefined')throw Error('Модуль XLSX не загружен');
    const wb=XLSX.read(buffer,{type:'array',cellDates:false});
    return callback(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false}));
  });
}
async function iikoDraftLoadCatalog(){
  const file=document.getElementById('iikoDraftCatalog')?.files?.[0];if(!file)return;
  // Uploaded XLSX is not a live iiko catalogue; do not allow real write with stale IDs.
  if(typeof iikoLiveState!=='undefined'){
    iikoLiveState.connected=false;
    if(typeof iikoLiveStatus==='function')iikoLiveStatus('Выбран ручной справочник Excel. Для реальной отправки ещё раз загрузите номенклатуру непосредственно из iiko.');
    if(typeof iikoLiveRefreshButtons==='function')iikoLiveRefreshButtons();
  }
  try{
    iikoDraftState.catalog=new Map();iikoDraftState.catalogList=[];iikoDraftState.catalogCount=0;
    iikoDraftInvalidate('Загружаю новый справочник iiko…');
    await iikoDraftXlsxRows(file,rows=>{
      const h=(rows[0]||[]).map(iikoDraftNorm);
      const nameCol=h.findIndex(x=>/^(наименование|название|name|product name|номенклатура)$/.test(x));
      const guidCol=h.findIndex(x=>/^(id|uuid|guid|productid|product id|идентификатор|id блюда|id номенклатуры)$/.test(x));
      const articleCol=h.findIndex(x=>/^(артикул|article|productarticle|product article|код iiko)$/.test(x));
      const typeCol=h.findIndex(x=>/^(тип|тип номенклатуры|type|producttype|product type)$/.test(x));
      if(nameCol<0||(guidCol<0&&articleCol<0))throw Error('В справочнике нужны колонки «Наименование» и «ID/UUID» либо «Артикул».');
      const catalog=new Map();let count=0;
      for(const row of rows.slice(1)){
        const name=String(row[nameCol]||'').trim();
        const id=guidCol>=0?String(row[guidCol]||'').trim():'';
        const article=articleCol>=0?String(row[articleCol]||'').trim():'';
        if(!name||(!id&&!article))continue;
        if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))continue;
        const type=typeCol>=0?String(row[typeCol]||'').trim().toUpperCase():'';
        const key=iikoDraftExact(name),val={name,id,article,type};
        if(!catalog.has(key))catalog.set(key,[]);
        const list=catalog.get(key);
        if(!list.some(x=>x.id===id&&x.article===article))list.push(val);
        count++;
      }
      iikoDraftState.catalog=catalog;iikoDraftState.catalogList=[...catalog.values()].flat();iikoDraftState.catalogCount=count;
    });
    iikoDraftAutoCheck();
  }catch(e){iikoDraftInvalidate('Ошибка справочника iiko: '+(e.message||e))}
}

async function iikoDraftLoadMappings(){
  const device=typeof planGuestStored==='function'?planGuestStored():{deviceId:'',token:''};
  iikoDraftState.mappingDevice=device.deviceId||'';
  iikoDraftState.mappings=new Map();
  iikoDraftState.mappingLoaded=false;
  if(!device.deviceId||!device.token){
    iikoDraftState.mappingError='Чтобы сохранять общие соответствия, подключите MAIN с 32-символьным кодом.';
    iikoDraftState.mappingLoaded=true;
    iikoDraftRenderSaved();
    iikoDraftAutoCheck();
    return;
  }
  iikoDraftState.mappingLoading=true;
  iikoDraftState.mappingError='';
  iikoDraftInvalidate('Загружаю общие сохранённые соответствия iiko…');
  try{
    const response=await planGuestFetch('iiko_map_list');
    // Do not attach mappings from the previous MAIN after reconnecting to another device.
    const now=planGuestStored();
    if(now.deviceId!==device.deviceId)return;
    for(const row of response.mappings||[]){
      if(!row.source_key||!(row.target_id||row.target_article))continue;
      iikoDraftState.mappings.set(row.source_key,row);
    }
    iikoDraftState.mappingLoaded=true;
  }catch(e){
    iikoDraftState.mappingError='Не удалось загрузить сохранённые соответствия: '+String(e.message||e);
  }finally{
    iikoDraftState.mappingLoading=false;
    iikoDraftRenderSaved();
    iikoDraftAutoCheck();
    if(typeof transferRender==='function'&&typeof productionDocuments!=='undefined'&&productionDocuments.length)transferRender();
  }
}
function iikoDraftRenderSaved(){
  const el=document.getElementById('iikoDraftSavedMappings');
  if(!el)return;
  iikoDraftState.mappingRows=[...iikoDraftState.mappings.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ru'));
  const rows=iikoDraftState.mappingRows.map(([key,p],i)=>
    '<tr><td>'+iikoDraftHtml(key)+'</td><td>'+iikoDraftHtml(p.target_name)+
    '</td><td>'+iikoDraftHtml(p.target_article||p.target_id||'')+
    '</td><td><button onclick="iikoDraftDeleteMapping('+i+')">Удалить</button></td></tr>').join('');
  el.innerHTML='<details><summary>Запомненные соответствия ('+
    iikoDraftState.mappings.size+')</summary>'+
    (iikoDraftState.mappingError?'<p>'+iikoDraftHtml(iikoDraftState.mappingError)+'</p>':'')+
    (rows?'<div class="tablewrap"><table class="nomtable"><thead><tr><th>Название в плане (до скобок)</th><th>Номенклатура iiko</th><th>Артикул / ID</th><th></th></tr></thead><tbody>'+
      rows+'</tbody></table></div>':'<p>Пока нет вручную подтверждённых соответствий.</p>')+
    '</details>';
}
// Show relevant results only, never the first arbitrary 70 catalog items.
function iikoDraftChoiceTokens(s){
  return iikoDraftNorm(s).split(/[^a-zа-я0-9]+/i)
    .filter(x=>x.length>=3&&!['для','или','при','без','это','как','его','она'].includes(x));
}
function iikoDraftChoiceScore(product,search){
  const q=iikoDraftNorm(search);
  if(!q)return 0;
  const title=iikoDraftNorm(product.name),article=iikoDraftNorm(product.article);
  if(article&&article===q)return 12000;
  if(article&&article.includes(q))return 6500;
  if(title===q)return 11000;
  if(title.startsWith(q))return 9500;
  if(title.includes(q))return 8000;
  const words=iikoDraftChoiceTokens(q),titleWords=iikoDraftChoiceTokens(title);
  if(!words.length)return 0;
  let matches=0;
  for(const w of words){
    const found=titleWords.some(t=>t===w||(w.length>=5&&t.startsWith(w.slice(0,Math.max(4,w.length-2))))||
      (t.length>=5&&w.startsWith(t.slice(0,Math.max(4,t.length-2)))));
    if(found)matches++;
  }
  return matches?Math.round(1000*matches/words.length)+matches*100:0;
}
function iikoDraftFilterChoices(index){
  const issue=iikoDraftState.mismatches[index];
  const input=document.getElementById('iikoDraftFind-'+index);
  const picker=document.getElementById('iikoDraftChoose-'+index);
  const allCheckbox=document.getElementById('iikoDraftAllTypes-'+index);
  const note=document.getElementById('iikoDraftChoiceNote-'+index);
  if(!issue?.canMap||!picker)return;
  const query=String(input?.value||'').trim();
  if(!query){
    picker.innerHTML='<option value="">Введите название блюда или артикул для поиска</option>';
    picker.value='';
    if(note)note.textContent='Сначала введите название или артикул. Случайные позиции не показываются.';
    return;
  }
  const all=Boolean(allCheckbox?.checked);
  const selected=iikoDraftState.catalogList.map((product,index)=>{
      const type=String(product.type||'').toUpperCase();
      if(!all&&type&&!['DISH','PREPARED'].includes(type))return null;
      const score=iikoDraftChoiceScore(product,query);
      return score>0?{product,index,score}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score||
      String(a.product.name).localeCompare(String(b.product.name),'ru')).slice(0,30);
  picker.innerHTML='<option value="">'+
    (selected.length?'Выберите правильное блюдо iiko':'Совпадений не найдено')+'</option>'+
    selected.map(({index,product})=>'<option value="'+index+'">'+iikoDraftHtml(product.name)+
      (product.article?' · '+iikoDraftHtml(product.article):'')+
      (product.type?' · '+iikoDraftHtml(product.type):'')+'</option>').join('');
  picker.value='';
  if(note)note.textContent=selected.length?
    'Найдено '+selected.length+' подходящих позиций. Выберите нужную; автоматически ничего не подставляется.':
    all?'По запросу ничего не найдено. Уточните название или артикул.':
    'Среди блюд и заготовок совпадений нет. Измените запрос или включите «Все типы».';
}
// Unified persistent mapping write for both cooking and transfer tabs.
// Persist only after an explicit choice and successful MAIN acknowledgement.
async function iikoDraftSaveMapping(sourceName,product){
 const key=iikoDraftSourceKey(sourceName);
 if(!key||key.length>300)throw Error('Некорректное название блюда для сопоставления');
 if(!product?.id)throw Error('У выбранной номенклатуры iiko отсутствует ID');
 const device=typeof planGuestStored==='function'?planGuestStored():null;
 if(!device?.deviceId||!device?.token)
   throw Error('Сначала подключите MAIN, чтобы запоминать соответствия на всех устройствах');
 if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==device.deviceId)
   await iikoDraftLoadMappings();
 if(!iikoDraftState.mappingLoaded||iikoDraftState.mappingDevice!==device.deviceId)
   throw Error(iikoDraftState.mappingError||'Общий справочник MAIN ещё не загружен');
 const row={source_key:key,target_name:product.name,target_id:product.id,
   target_article:product.article||''};
 await planGuestFetch('iiko_map_save',row);
 if(planGuestStored().deviceId!==device.deviceId)
   throw Error('Привязка к MAIN изменилась во время сохранения. Повторно проверьте соответствия.');
 iikoDraftState.mappings.set(key,row);
 iikoDraftRenderSaved();
 iikoDraftAutoCheck();
 if(typeof transferRender==='function'&&typeof productionDocuments!=='undefined'&&productionDocuments.length)
   transferRender();
 return row;
}
async function iikoDraftSaveChoice(index){
  const issue=iikoDraftState.mismatches[index];
  const select=document.getElementById('iikoDraftChoose-'+index);
  const value=String(select?.value||'');
  const product=value!==''?iikoDraftState.catalogList[Number(value)]:null;
  const status=document.getElementById('iikoDraftStatus');
  if(!issue?.canMap||!product){
    if(status)status.textContent='Выберите конкретную позицию iiko из списка.';
    return;
  }
  if(product.type&&!['DISH','PREPARED'].includes(product.type)){
    if(!window.confirm('Вы выбрали позицию типа '+product.type+
      ' — это не готовое блюдо/заготовка. Сохранить соответствие?'))return;
  }
  if(status)status.textContent='Сохраняю соответствие в общем справочнике MAIN…';
  try{
    await iikoDraftSaveMapping(issue.name,product);
    if(status)status.textContent='Соответствие сохранено и применяется к обоим видам документов.';
  }catch(e){
    if(status)status.textContent='Не удалось сохранить соответствие: '+String(e.message||e);
  }
}
async function iikoDraftDeleteMapping(index){
  const item=iikoDraftState.mappingRows[index];
  if(!item)return;
  const [key,row]=item;
  if(!window.confirm('Удалить соответствие «'+key+'» → «'+row.target_name+'»?'))return;
  try{
    await planGuestFetch('iiko_map_delete',{source_key:key});
    iikoDraftState.mappings.delete(key);
    iikoDraftRenderSaved();
    iikoDraftAutoCheck();
    if(typeof transferRender==='function'&&typeof productionDocuments!=='undefined'&&productionDocuments.length)transferRender();
  }catch(e){
    const status=document.getElementById('iikoDraftStatus');
    if(status)status.textContent='Не удалось удалить соответствие: '+String(e.message||e);
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  if(typeof planGuestStored==='function')iikoDraftLoadMappings();
});
function iikoDraftStore(which,end){
  const id='iikoDraft'+which+(end==='from'?'From':'To');
  return String(document.getElementById(id)?.value||'').trim();
}
// The single resolver used by cooking acts and all transfer documents.
// Only currently present, unambiguous iiko product IDs may be used.
function iikoDraftResolveProduct(item){
  const key=iikoDraftSourceKey(item?.name);
  if(!key)return {error:'Пустое название блюда в плане'};
  if(!iikoDraftState.mappingLoaded)return {error:'Общий справочник соответствий ещё загружается'};
  const catalog=iikoDraftState.catalogList||[];
  const isFood=p=>!p.type||['DISH','PREPARED'].includes(String(p.type).toUpperCase());
  const usable=catalog.filter(isFood);
  const saved=iikoDraftState.mappings.get(key);
  if(saved){
    // A non-food type is permitted only when the user previously confirmed it.
    // IDs can change after iiko catalogue recreation. The saved article is
    // a safe fallback only when it uniquely identifies the replacement item.
    const byId=saved.target_id?catalog.filter(p=>String(p.id)===String(saved.target_id)):[];
    const byArticle=!byId.length&&saved.target_article?
      catalog.filter(p=>String(p.article||'')===String(saved.target_article)):[];
    const unique=new Map((byId.length?byId:byArticle).map(p=>[String(p.id||p.article),p]));
    if(unique.size===1)return {product:[...unique.values()][0],source:'saved'};
    return {error:'Сохранённое соответствие отсутствует или неоднозначно в текущем справочнике iiko'};
  }
  // Prefer one exact normalized name. A matching title with composition in
  // parentheses is a fallback only when it identifies a single product.
  const exact=usable.filter(p=>iikoDraftNorm(p.name)===key);
  const matches=exact.length?exact:usable.filter(p=>iikoDraftSourceKey(p.name)===key);
  const unique=new Map(matches.map(p=>[String(p.id||p.article),p]));
  if(unique.size===1)return {product:[...unique.values()][0],source:'exact'};
  if(unique.size>1)return {error:'В iiko несколько подходящих блюд — выберите нужное вручную'};
  const any=catalog.some(p=>iikoDraftNorm(p.name)===key||iikoDraftSourceKey(p.name)===key);
  return {error:any?'Название найдено, но тип позиции требует ручного подтверждения':
    'Название блюда не найдено в iiko'};
}
function iikoDraftItem(item){
 const match=iikoDraftResolveProduct(item);
 return match.product?iikoDraftMatchedItem(item,match.product):{error:match.error};
}
function iikoDraftMatchedItem(item,product){
  return {name:item.name,iikoName:product.name,product:product.id||'',productArticle:product.article||'',
    amount:Number(item.quantity),weight:item.weight||'',sourceRow:item.sourceRow};
}
function iikoDraftMismatch(doc,item,reason,canMap=false){
  return {kitchen:doc.warehouse,sourceRow:Number(item.sourceRow)||0,name:String(item.name||''),
    prefix:iikoDraftPrefix(item.name),weight:String(item.weight||''),
    quantity:Number(item.quantity)||0,reason,canMap};
}
function iikoDraftBuildData(){
  const original=typeof morningState!=='undefined'?morningState.result:null;
  if(!original||original.needsColumn||!Array.isArray(original.documents)||original.documents.length!==2)throw Error('Сначала сформируй два акта за выбранную дату.');
  const date=String(original.date?.iso||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Некорректная дата приготовления');
  const issues=[],mismatches=[],documents=[];
  if(!iikoDraftState.catalogCount)issues.push('Загрузи актуальный справочник номенклатуры iiko с наименованиями и ID/артикулом.');
  for(const [idx,doc] of original.documents.entries()){
    const key=idx===0?'BK':'PK';
    const from=iikoDraftStore(key,'from'),to=iikoDraftStore(key,'to');
    if(!from||!to)issues.push((key==='BK'?'Бухара кухня':'Правда кухня')+': укажи склад списания сырья и склад выпуска iiko.');
    const lines=[],names=new Map(),resolvedSizes=new Map();
    for(const item of iikoDraftOnlyPositive(doc.items)){
      const match=iikoDraftItem(item);
      if(match.error){mismatches.push(iikoDraftMismatch(doc,item,match.error,true));continue}
      const productRef=match.product||match.productArticle;
      const size=iikoDraftNorm(item.weight);
      const uniqueness=productRef+'/'+size;
      if(names.has(uniqueness)){
        const reason='Две строки используют один товар iiko с одинаковым весом/объёмом';
        mismatches.push(iikoDraftMismatch(doc,names.get(uniqueness),reason));
        mismatches.push(iikoDraftMismatch(doc,item,reason));
      }
      if(resolvedSizes.has(productRef)&&resolvedSizes.get(productRef).size!==size){
        const previous=resolvedSizes.get(productRef);
        const reason='Разные веса/объёмы направляются в один товар iiko — исправь названия в плане';
        mismatches.push(iikoDraftMismatch(doc,previous.item,reason));
        mismatches.push(iikoDraftMismatch(doc,item,reason));
      }
      names.set(uniqueness,item);resolvedSizes.set(productRef,{size,item});
      lines.push(match);
    }
    if(!lines.length)issues.push(doc.warehouse+': нет подтверждённых строк.');
    // Do not reserve, calculate or transmit a document number.
    // iikoServer is expected to assign a number when creating a NEW document.
    // This needs a live environment check before enabling actual writes.
    documents.push({type:'production',warehouseCode:key,dateIncoming:date+'T09:00:00',status:'NEW',
      numbering:'iiko-auto',warehouse:doc.warehouse,storeFrom:from,storeTo:to,items:lines});
  }
  const signature=iikoDraftHashText(JSON.stringify(documents));
  return {date,sourceSheet:original.sheet,sourceColumn:original.selected?.label||'',documents,issues,mismatches,signature};
}
// Runs automatically whenever the source plan, day, column, iiko catalogue or stores change.
function iikoDraftAutoCheck(){
   if(typeof morningRefreshMatchLabels==='function')morningRefreshMatchLabels();
  const plan=typeof morningState!=='undefined'?morningState.result:null;
  if(!plan||plan.needsColumn||!Array.isArray(plan.documents)||plan.documents.length!==2){
    iikoDraftInvalidate('Сначала получите Excel и сформируйте два акта за выбранную дату. Сверка запустится автоматически.');
    return;
  }
  if(!iikoDraftState.catalogCount){
    iikoDraftInvalidate('Акты сформированы. Для автоматической сверки загрузите актуальный справочник номенклатуры iiko.');
    return;
  }
  if(!iikoDraftState.mappingLoaded){
    iikoDraftInvalidate(iikoDraftState.mappingError||'Загружаю запомненные соответствия iiko…');
    return;
  }
  return iikoDraftCheck();
}
function iikoDraftCheck(){
   if(typeof morningRefreshMatchLabels==='function')morningRefreshMatchLabels();
  iikoDraftInvalidate();
  try{
    const data=iikoDraftBuildData();
    iikoDraftState.documents=data.documents;
    iikoDraftState.issues=data.issues;
    iikoDraftState.mismatches=data.mismatches;
    iikoDraftState.ready=data.issues.length===0&&data.mismatches.length===0;
    iikoDraftState.signature=data.signature;
    const sum=d=>d.items.reduce((n,x)=>n+x.amount,0);
    const heading=data.documents.map(d=>'<div><b>Акт '+iikoDraftHtml(d.warehouseCode)+'</b> · '+iikoDraftHtml(d.warehouse)+' · '+d.items.length+' совпавших поз. · '+sum(d)+' шт. · NEW (без проведения)</div>').join('');
    const rowHTML=data.mismatches.map((x,i)=>{
      const controls=x.canMap?'<div><input type="search" id="iikoDraftFind-'+i+
        '" placeholder="Введите название блюда или артикул" value="'+iikoDraftHtml(x.prefix)+
        '" oninput="iikoDraftFilterChoices('+i+')">'+
        '<label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" style="width:16px;min-width:16px;max-width:16px;height:16px" id="iikoDraftAllTypes-'+i+
        '" onchange="iikoDraftFilterChoices('+i+')"> Все типы (товары, услуги и др.)</label>'+
        '<select id="iikoDraftChoose-'+i+'"><option value="">Ищу подходящие блюда…</option></select>'+
        '<small class="muted" id="iikoDraftChoiceNote-'+i+'"></small>'+
        '<button onclick="iikoDraftSaveChoice('+i+')">Подтвердить и запомнить</button></div>':'';
      return '<div class="iiko-mapping-card"><div><b>'+iikoDraftHtml(x.name)+
        '</b></div><div class="muted">Кухня: '+iikoDraftHtml(x.kitchen)+
        ' · Лист: '+iikoDraftHtml(data.sourceSheet)+' · Строка: '+x.sourceRow+
        '</div><div>До скобок: <b>'+iikoDraftHtml(x.prefix)+
        '</b></div><div class="muted">'+iikoDraftHtml(x.reason)+
        '</div><div class="iiko-mapping-choice">'+controls+'</div></div>';
    }).join('');
    const mismatchHTML=data.mismatches.length?
      '<h4>Требуется сопоставление: '+data.mismatches.length+' строк</h4>'+
      '<p>Сначала сравнивается название до первой скобки (состав игнорируется). Для незнакомых блюд выберите правильную позицию iiko и нажмите «Подтвердить и запомнить». Общие соответствия доступны другим браузерам, подключённым к MAIN.</p>'+
      '<div class="iiko-mapping-list">'+rowHTML+'</div>':
      '<p>Все блюда сопоставлены с текущим справочником iiko (название до скобок или подтверждённое соответствие).</p>';
    const otherHTML=data.issues.length?'<p style="color:#b42318"><b>Другие замечания:</b></p><ul>'+data.issues.map(x=>'<li>'+iikoDraftHtml(x)+'</li>').join('')+'</ul>':'';
    const result=document.getElementById('iikoDraftResult');
    if(result)result.innerHTML=heading+mismatchHTML+otherHTML;
    for(let i=0;i<data.mismatches.length;i++){
      if(data.mismatches[i].canMap)iikoDraftFilterChoices(i);
    }
    const missing=data.mismatches.length;
    document.getElementById('iikoDraftStatus').textContent=missing?
      'Требуется выбрать соответствия iiko: '+missing+' строк. Используй поиск, затем «Подтвердить и запомнить».':
      data.issues.length?'Есть замечания: '+data.issues.length+'. Пакет не готов.':
      'Названия совпали. Два акта готовы к скачиванию в тестовом пакете (без отправки в iiko).';
    const btn=document.getElementById('iikoDraftDownload');
    if(btn)btn.disabled=!iikoDraftState.ready;
    const mismatchBtn=document.getElementById('iikoDraftMismatchDownload');
    if(mismatchBtn)mismatchBtn.disabled=!missing;
    if(typeof iikoLiveRefreshButtons==='function')iikoLiveRefreshButtons();
    return data;
  }catch(e){
    const el=document.getElementById('iikoDraftStatus');
    if(el)el.textContent='Ошибка подготовки: '+(e.message||e);
    return {issues:[String(e.message||e)],documents:[],mismatches:[]};
  }
}
function iikoDraftDownloadMismatches(){
  const data=iikoDraftState.mismatches;
  if(!data.length)throw Error('Несоответствий нет. Проверка выполняется автоматически после загрузки файлов.');
  if(typeof XLSX==='undefined')throw Error('Не загружен модуль Excel.');
  const r=morningState.result;
  const rows=[['Дата','Лист Excel','Кухня','Строка Excel','Наименование в плане','Название до скобок','Вес / объём','Количество','Причина']];
  for(const x of data)rows.push([r.date.iso,r.sheet,x.kitchen,x.sourceRow,x.name,x.prefix,x.weight,x.quantity,x.reason]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:13},{wch:18},{wch:20},{wch:14},{wch:50},{wch:42},{wch:16},{wch:14},{wch:72}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Не совпадает с iiko');
  XLSX.writeFile(wb,'несовпадения_iiko_'+r.date.iso+'.xlsx');
}
function iikoDraftReloadPlan(){
  const file=document.getElementById('prodfile');
  if(!file)throw Error('Поле загрузки Excel не найдено');
  file.value=''; // Same name after edit should still trigger change.
  file.click();
}
function iikoDraftXml(doc){
  const lines=doc.items.map((x,i)=>{
    const ref=x.product?'<product>'+iikoDraftEsc(x.product)+'</product>':'<productArticle>'+iikoDraftEsc(x.productArticle)+'</productArticle>';
    return '<item><num>'+(i+1)+'</num><amount>'+x.amount+'</amount>'+ref+'</item>';
  }).join('');
  // documentNumber intentionally omitted: the server, not the browser, assigns numbers.
  return '<?xml version="1.0" encoding="UTF-8"?>\n<document><status>NEW</status><dateIncoming>'+iikoDraftEsc(doc.dateIncoming)+'</dateIncoming><storeFrom>'+iikoDraftEsc(doc.storeFrom)+'</storeFrom><storeTo>'+iikoDraftEsc(doc.storeTo)+'</storeTo><comment>Помогатор: проект акта приготовления, без проведения</comment><items>'+lines+'</items></document>';
}
async function iikoDraftDownload(){
  if(!iikoDraftState.ready)throw Error('Сначала сопоставьте неподтверждённые блюда со справочником iiko.');
  if(typeof JSZip==='undefined')throw Error('Не загружен модуль ZIP');
  const zip=new JSZip();
  const json={schema:'pomogator.iiko.production-draft.v2',mode:'offline-test',endpoint:'/resto/api/documents/import/productionDocument',posted:false,
    numberPolicy:'omit-documentNumber',automaticNumberUnverified:true,
    createdAt:new Date().toISOString(),signature:iikoDraftState.signature,documents:iikoDraftState.documents};
  zip.file('manifest.json',JSON.stringify(json,null,2));
  for(const d of iikoDraftState.documents)zip.file('production-'+d.warehouseCode+'.xml',iikoDraftXml(d));
  zip.file('README.txt','ТЕСТОВЫЙ ПАКЕТ. Два акта приготовления NEW без проведения и без номера. Поле documentNumber отсутствует: автоматическая нумерация iikoServer должна быть подтверждена на вашем сервере до включения отправки. Никакой проверки наличия существующих актов не выполняется. Повторная отправка может создать дубликаты. В iiko ничего не отправлено.');
  const content=await zip.generateAsync({type:'blob'});
  const url=URL.createObjectURL(content),a=document.createElement('a');
  a.href=url;a.download='iiko-draft-'+iikoDraftState.documents[0].dateIncoming.slice(0,10)+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
  document.getElementById('iikoDraftStatus').textContent='Пакет скачан. В iiko ничего не передавалось.';
}
