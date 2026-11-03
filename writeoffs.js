'use strict';
const $ = (id) => document.getElementById(id);
const SUPABASE_URL = 'https://dwdunpyzcfdwokoczenl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const GUEST_ORG_ID='3d89b13c-28e9-4cb8-a439-407c6ecaac22';
const GUEST_JOURNAL_KEY='kolhoz_writeoffs_local_journal_v1';
const GUEST_CATALOG_URL=SUPABASE_URL+'/functions/v1/kolhoz-writeoffs-catalog';
const STAFF_WRITE_API=SUPABASE_URL+'/functions/v1/kolhoz-staff-writeoffs';
const STAFF_ACCESS_STORAGE='kolhoz_staff_access_v1';
const STAFF_WRITER_PREFIX='kolhoz_staff_writer_v1_';
let staffAccessKey='',writerSecret='';
const REASONS=['Порча','Бракераж','Брак','Служебное питание','Возврат от покупателя','Прочее','Срок годности'];
let userId = '', workspaceId = '', orgId = '';
let catalog = [], catalogByName = new Map(), currentId = null, revision = null, currentStatus = 'draft';
let entries = [], journalData = [];
let dirty = false, busy = false, loading = true, viewOnly = false, guestMode = false;

const blank = () => ({key: crypto.randomUUID(), nomenclature_id:null, code:'', name:'', qty:'', unit:'', reason:''});
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function today() {const d = new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function niceDate(s) {if(!s)return '—';const a=s.split('-');return a.length===3 ? a[2]+'.'+a[1]+'.'+a[0] : s}
function say(message,kind='') {const top=$('notice');top.textContent=message;top.className='notice'+(kind?' '+kind:'');const beside=$('actionStatus');if(beside){beside.textContent=message;beside.className='notice'+(kind?' '+kind:'')}}
function storeKey(){return 'kolhoz_writeoffs_unsaved_v2_'+userId+'_'+orgId}

function resetEntries(){entries=Array.from({length:10},()=>blank())}
function repaintCounts(){
 const filled=entries.filter(r=>String(r.name||'').trim()).length;
 $('itemCount').textContent='· '+filled+' заполнено / '+entries.length+' строк';
}
function updateMode(){
 const sent=currentStatus==='submitted'||viewOnly;
 $('editorFields').disabled=sent;
 $('itemsFields').disabled=sent;
 const needsStaffLink=guestMode&&!staffAccessKey;
 $('saveBtn').disabled=sent||busy||needsStaffLink;
 $('submitBtn').disabled=sent||busy||needsStaffLink;
 $('submitBtn').textContent=sent?'Уже отправлено':'Отправить в журнал';
 $('stateBadge').textContent=(guestMode?(staffAccessKey?'Общая база · ':'Нужна ссылка · '):'')+(viewOnly?'Черновик · просмотр':(currentStatus==='submitted'?'Отправлено':(currentId?'Черновик в журнале':'Новый черновик')));
 $('catalogStatus').textContent=catalog.length?'Справочник: '+catalog.length+' позиций':'Справочник пока пуст';
 repaintCounts();
}

function draftSnapshot(){
 return {id:currentId,revision,status:currentStatus,date:$('docDate').value,shift:$('shift').value,warehouse:$('warehouse').value,
         entries:entries.map(x=>({...x}))};
}
function persist(){
 if(loading||currentStatus==='submitted'||!userId||!orgId)return;
 dirty=true;
 try{localStorage.setItem(storeKey(),JSON.stringify(draftSnapshot()))}catch(e){console.warn('Локальная копия не сохранена',e)}
 repaintCounts();
}
function clearLocal(){try{localStorage.removeItem(storeKey())}catch(_){}}

function applyCatalogMatch(line,tr){
  line.nomenclature_id=null;line.code='';
  const matches=catalogByName.get(line.name.trim().toLocaleLowerCase('ru').replace(/ё/g,'е'))||[];
  if(!matches.length){line.unit='';tr.querySelector('[data-field="unit"]').value='';return}
  const units=[...new Set(matches.map(x=>x.unit||''))];
  if(units.length===1){
    line.nomenclature_id=matches[0].id;
    line.unit=units[0];
    tr.querySelector('[data-field="unit"]').value=line.unit;
    tr.querySelector('[data-field="name"]').title='';
  }else{
    const currentUnit=line.unit;
    const selected=matches.find(x=>x.unit===currentUnit);
    line.nomenclature_id=selected?.id||null;
    line.unit=selected?.unit||'';
    tr.querySelector('[data-field="unit"]').value=line.unit;
    tr.querySelector('[data-field="name"]').title='Есть одинаковые названия с разными единицами: '+units.join(', ')+'. Уточните единицу измерения.';
  }
}
function paintRows(){
 const tbody=$('rows-all');tbody.replaceChildren();
 entries.forEach((line)=>{
  const tr=document.createElement('tr');
  tr.innerHTML='<td><input class="item-name" data-field="name" list="catalog" placeholder="Начните вводить название" autocomplete="off"></td>'
   +'<td><input class="item-qty" data-field="qty" type="text" inputmode="decimal" placeholder="0,000"></td>'
   +'<td><input class="item-unit" data-field="unit" placeholder="Ед."></td>'
   +'<td><select class="item-reason" data-field="reason"><option value="">Выберите причину</option>'+REASONS.map(r=>'<option value="'+esc(r)+'">'+esc(r)+'</option>').join('')+'</select></td>'
   +'<td><button type="button" class="remove" title="Удалить строку" aria-label="Удалить строку">✕</button></td>';
  for(const field of ['name','qty','unit','reason']){
   const input=tr.querySelector('[data-field="'+field+'"]');
   if(field==='reason'&&line.reason&&!REASONS.includes(line.reason)){
     const oldOption=document.createElement('option');oldOption.value=line.reason;oldOption.textContent=line.reason+' (ранее сохранено)';input.appendChild(oldOption);
   }
   input.value=line[field]??'';
   input.addEventListener(field==='reason'?'change':'input',()=>{
    line[field]=input.value;
    if(field==='name')applyCatalogMatch(line,tr);
    if(field==='unit'){
      const matches=catalogByName.get(line.name.trim().toLocaleLowerCase('ru').replace(/ё/g,'е'))||[];
      line.nomenclature_id=matches.find(x=>x.unit.trim()===line.unit.trim())?.id||null;
    }
    persist();
   });
  }
  tr.querySelector('.remove').addEventListener('click',()=>{
    entries=entries.filter(r=>r.key!==line.key);paintRows();persist();
  });
  tbody.appendChild(tr);
 });
 repaintCounts();
}
function paintAll(){paintRows();updateMode()}
function newForm(ask=true){
 if(ask&&dirty&&!confirm('Есть несохранённые изменения. Создать новый документ?'))return;
 if(ask||!loading)clearLocal();loading=true;
 currentId=null;revision=null;writerSecret='';currentStatus='draft';viewOnly=false;dirty=false;
 $('docDate').value=today();$('shift').value='';$('warehouse').value='';
 resetEntries();paintAll();loading=false;
 say('Новый документ. Можно заполнять постепенно; изменения временно сохраняются и в этом браузере.');
 window.scrollTo({top:0,behavior:'smooth'});
}

function collectRows(strict){
 const out=[];
 for(const r of entries){
  const name=String(r.name||'').trim(),reason=String(r.reason||'').trim(),unit=String(r.unit||'').trim(),qtyText=String(r.qty||'').trim();
  const touched=name||reason||unit||qtyText;
  if(!touched)continue;
  const quantity=Number(qtyText.replace(',','.'));
  if(strict){
   if(!name)throw new Error('Укажите наименование в строке списания.');
   if(!qtyText||!Number.isFinite(quantity)||quantity<=0)throw new Error('Для «'+name+'» укажите количество больше нуля.');
   if(!unit)throw new Error('Для «'+name+'» укажите единицу измерения.');
   if(!reason)throw new Error('Для «'+name+'» укажите причину списания.');
  }
  out.push({nomenclature_id:r.nomenclature_id||null,code:r.code||'',name,qty:qtyText,unit,reason});
 }
 return out;
}
function headerPayload(strict){
 const date=$('docDate').value,warehouse=$('warehouse').value;
 if(!date)throw new Error('Выберите дату списания.');
 if(!warehouse)throw new Error('Выберите склад: Кулинария или Кондитерский цех.');
 const items=collectRows(strict);
 if(strict&&!items.length)throw new Error('Нельзя отправить пустое списание.');
 return {doc_date:date,shift:$('shift').value||null,warehouse,items};
}
async function withBusy(fn){
 if(busy)return;
 busy=true;updateMode();
 try{await fn()}catch(e){console.error(e);say('Ошибка: '+(e.message||e),'error')}
 finally{busy=false;updateMode()}
}

function readStaffAccessKey(){
 const raw=new URLSearchParams(location.hash.slice(1)).get('staff')||'';
 if(/^[A-Za-z0-9_-]{40,100}$/.test(raw)){
  try{localStorage.setItem(STAFF_ACCESS_STORAGE,raw)}catch(_){}
  return raw;
 }
 let saved='';
 try{saved=localStorage.getItem(STAFF_ACCESS_STORAGE)||''}catch(_){}
 return /^[A-Za-z0-9_-]{40,100}$/.test(saved)?saved:'';
}
function getStaffWriter(id){
 if(!id)return '';
 try{return localStorage.getItem(STAFF_WRITER_PREFIX+id)||''}catch(_){return ''}
}
function makeStaffWriter(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return Array.from(bytes).map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function writeStaffToCloud(payload,status){
 if(!staffAccessKey)throw Error('Для сохранения в общую базу нужна новая ссылка сотрудника. Обратитесь к администратору.');
 if(!writerSecret)writerSecret=currentId?getStaffWriter(currentId):'';
 if(!writerSecret)writerSecret=makeStaffWriter();
 const olderId=currentId;
 const cloudId=currentId&&getStaffWriter(currentId)?currentId:null;
 const ctl=new AbortController();
 const timer=setTimeout(()=>ctl.abort(),18000);
 let response;
 try {
  response=await fetch(STAFF_WRITE_API,{
   method:'POST',signal:ctl.signal,
   headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
   body:JSON.stringify({access_key:staffAccessKey,writer_secret:writerSecret,document_id:cloudId,
     revision:cloudId?revision:null,payload:{...payload,status}})
  });
 }finally{clearTimeout(timer)}
 const reply=await response.json().catch(()=>({ok:false,error:'Неверный ответ сервера'}));
 if(!response.ok||!reply.ok)throw Error(reply.error||('Ошибка сохранения: HTTP '+response.status));
 const data=reply.document;
 if(!data?.id||!data?.updated_at)throw Error('Сервер не подтвердил сохранение документа');
 try{
  localStorage.setItem(STAFF_WRITER_PREFIX+data.id,writerSecret);
  const docs=readLocalJournal().filter(d=>d.id!==olderId&&d.id!==data.id);
  docs.push({id:data.id,organization_id:orgId,created_by:'guest',...data});
  localStorage.setItem(GUEST_JOURNAL_KEY,JSON.stringify(docs));
 }catch(e){console.warn('Документ есть в облаке, но локальная копия не сохранилась',e)}
 return data;
}

function readLocalJournal(){
 try{const docs=JSON.parse(localStorage.getItem(GUEST_JOURNAL_KEY)||'[]');return Array.isArray(docs)?docs:[]}
 catch(e){console.warn('Локальный журнал недоступен',e);return []}
}
function upsertLocalDocument(payload,status){
 const journal=readLocalJournal(),stamp=new Date().toISOString();
 let doc;
 if(currentId){
  const index=journal.findIndex(x=>x.id===currentId);
  if(index<0)throw new Error('Локальный черновик не найден. Создайте копию.');
  const prev=journal[index];
  if(prev.status!=='draft'||prev.updated_at!==revision)throw new Error('Черновик уже изменён или отправлен.');
  doc={...prev,...payload,status,updated_at:stamp,submitted_at:status==='submitted'?stamp:null};
  journal[index]=doc;
 }else{
  doc={id:crypto.randomUUID(),workspace_id:null,organization_id:orgId,
    created_by:userId,created_at:stamp,updated_at:stamp,
    submitted_at:status==='submitted'?stamp:null,...payload,status};
  journal.push(doc);
 }
 localStorage.setItem(GUEST_JOURNAL_KEY,JSON.stringify(journal));
 return doc;
}
function deleteLocalDocument(id){
 const docs=readLocalJournal(),doc=docs.find(d=>d.id===id);
 if(!doc||doc.status!=='draft')throw new Error('Можно удалить только локальный черновик.');
 localStorage.setItem(GUEST_JOURNAL_KEY,JSON.stringify(docs.filter(d=>d.id!==id)));
}
async function saveDraft(){
 if(currentStatus==='submitted'||viewOnly)return;
 await withBusy(async()=>{
  const payload=headerPayload(false);
  let data;
  if(guestMode){
   data=await writeStaffToCloud(payload,'draft');
  }else{
   const result=currentId
    ? await sb.from('kolhoz_writeoffs').update(payload).eq('id',currentId).eq('status','draft').eq('updated_at',revision).select('*').single()
    : await sb.from('kolhoz_writeoffs').insert({...payload,workspace_id:workspaceId,organization_id:orgId,created_by:userId,status:'draft'}).select('*').single();
   if(result.error)throw new Error(result.error.code==='PGRST116'?'Черновик уже изменён или отправлен. Обновите журнал.':result.error.message);
   data=result.data;
  }
  currentId=data.id;revision=data.updated_at;dirty=false;clearLocal();
  say('Черновик сохранён в общей базе. Он доступен администратору в Помогаторе.','success');
  await loadJournal();
 });
}
async function submit(){
 if(currentStatus==='submitted'||viewOnly)return;
 let payload;
 try{payload=headerPayload(true)}catch(e){say(e.message,'error');return}
 const localMessage=guestMode?' Списание появится в общем журнале администратора.':'';
 if(!confirm('Отправить списание в журнал? После отправки его нельзя редактировать. В 1С документ не отправляется.'+localMessage))return;
 await withBusy(async()=>{
  let data;
  if(guestMode){
   data=await writeStaffToCloud(payload,'submitted');
  }else{
   const result=currentId
    ? await sb.from('kolhoz_writeoffs').update({...payload,status:'submitted'}).eq('id',currentId).eq('status','draft').eq('updated_at',revision).select('*').single()
    : await sb.from('kolhoz_writeoffs').insert({...payload,status:'submitted',workspace_id:workspaceId,organization_id:orgId,created_by:userId}).select('*').single();
   if(result.error)throw new Error(result.error.code==='PGRST116'?'Документ уже изменён или отправлен. Обновите журнал.':result.error.message);
   data=result.data;
  }
  currentId=data.id;revision=data.updated_at;currentStatus='submitted';dirty=false;clearLocal();
  say('Списание отправлено в общий журнал и защищено от изменений.','success');
  await loadJournal();
 });
}

function fillDocument(doc,copy=false){
 clearLocal();loading=true;
 currentId=copy?null:doc.id;revision=copy?null:doc.updated_at;writerSecret=copy?'':getStaffWriter(doc.id);currentStatus=copy?'draft':doc.status;
 viewOnly=!copy&&doc.status==='draft'&&doc.created_by!==userId;dirty=false;
 $('docDate').value=doc.doc_date||today();$('shift').value=doc.shift||'';$('warehouse').value=doc.warehouse||'';
 entries=(Array.isArray(doc.items)?doc.items:[]).map(item=>({...blank(),...item,key:crypto.randomUUID()}));
 if(currentStatus==='draft')while(entries.length<10)entries.push(blank());
 paintAll();loading=false;
 if(copy){persist();say('Создана редактируемая копия документа. Сохраните её как новый черновик.');}
 else say(currentStatus==='submitted'?'Просмотр отправленного списания (только чтение).':'Черновик открыт для редактирования.');
 window.scrollTo({top:0,behavior:'smooth'});
}
function maybeLeave(){
 if(dirty&&!confirm('Есть несохранённые изменения. Открыть другой документ?'))return false;
 return true;
}

function exportXlsx(doc){
 if(typeof XLSX==='undefined'){say('Не загружена библиотека Excel. Обновите страницу.','error');return}
 let items;
 try{items=doc?doc.items:collectRows(false)}catch(e){say(e.message,'error');return}
 const info=doc||{doc_date:$('docDate').value,shift:$('shift').value,warehouse:$('warehouse').value,status:currentStatus};
 const rows=[['Дата','Смена','Склад','Номенклатура','Код 1С','Количество','Ед. изм.','Причина','Статус']];
 for(const item of (items||[]))rows.push([niceDate(info.doc_date),info.shift||'',info.warehouse||'',item.name,item.code||'',String(item.qty).replace(',','.'),item.unit,item.reason,info.status==='submitted'?'Отправлено':'Черновик']);
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);
 ws['!cols']=[{wch:14},{wch:12},{wch:21},{wch:49},{wch:14},{wch:14},{wch:13},{wch:23},{wch:14}];
 XLSX.utils.book_append_sheet(wb,ws,'Списание');
 XLSX.writeFile(wb,'Списание_Колхоз_'+(info.doc_date||today())+'.xlsx');
}
function drawJournal(){
 const status=$('statusFilter').value,from=$('dateFrom').value,to=$('dateTo').value;
 const data=journalData.filter(d=>(!status||d.status===status)&&(!from||d.doc_date>=from)&&(!to||d.doc_date<=to));
 $('journalCount').textContent='Показано документов: '+data.length+(journalData.length===100?' (первые 100; уточните диапазон дат)':'');
 if(!data.length){$('journal').innerHTML='<p class="empty">По выбранным условиям списаний нет.</p>';return}
 $('journal').innerHTML=data.map(d=>{
  const sent=d.status==='submitted',rows=Array.isArray(d.items)?d.items:[];
  const summary=rows.filter(x=>x.name&&Number(String(x.qty||'0').replace(',','.'))>0).length;
  const auth=d.created_by===userId;
  return '<div class="journal-row"><div><b>'+niceDate(d.doc_date)+' · '+esc(d.warehouse)
   +' <span class="tag '+(sent?'sent':'')+'">'+(sent?'Отправлено':'Черновик')+'</span></b>'
   +'<small>'+(d.shift?esc(d.shift)+' · ':'')+summary+' поз. · создано '+new Date(d.created_at).toLocaleString('ru-RU')+'</small></div>'
   +'<div class="actions"><button data-action="open" data-id="'+esc(d.id)+'">'+(sent?'Посмотреть':(auth?'Открыть':'Посмотреть'))+'</button>'
   +'<button data-action="copy" data-id="'+esc(d.id)+'">Создать копию</button>'
   +'<button data-action="excel" data-id="'+esc(d.id)+'">Excel</button>'
   +'<button data-action="print" data-id="'+esc(d.id)+'">Печать</button>'
   +(!sent&&auth?'<button class="danger" data-action="delete" data-id="'+esc(d.id)+'">Удалить</button>':'')
   +'</div></div>';
 }).join('');
}

async function loadJournal(){
 if(!orgId)return;
 if(guestMode){
  journalData=readLocalJournal().sort((a,b)=>String(b.doc_date).localeCompare(String(a.doc_date))||String(b.created_at).localeCompare(String(a.created_at))).slice(0,100);
  drawJournal();return;
 }
 let query=sb.from('kolhoz_writeoffs').select('id,workspace_id,organization_id,doc_date,shift,warehouse,items,status,created_by,created_at,updated_at,submitted_at').eq('organization_id',orgId);
 if($('statusFilter').value)query=query.eq('status',$('statusFilter').value);
 if($('dateFrom').value)query=query.gte('doc_date',$('dateFrom').value);
 if($('dateTo').value)query=query.lte('doc_date',$('dateTo').value);
 const r=await query.order('doc_date',{ascending:false}).order('created_at',{ascending:false}).limit(100);
 if(r.error)throw r.error;
 journalData=r.data||[];drawJournal();
}

async function onJournalClick(e){
 const b=e.target.closest('button[data-action]');if(!b||busy)return;
 const doc=journalData.find(x=>x.id===b.dataset.id);if(!doc)return;
 if(b.dataset.action==='excel'){exportWriteoffStyled(doc);return}
 if(b.dataset.action==='print'){printWriteoff(doc);return}
 if(b.dataset.action==='open'){
  if(!maybeLeave())return;
  fillDocument(doc);
  if(viewOnly)say('Это черновик другого пользователя. Доступен просмотр или создание собственной копии.');
 }
 if(b.dataset.action==='copy'){if(!maybeLeave())return;fillDocument(doc,true)}
 if(b.dataset.action==='delete'){
  if(!confirm('Удалить черновик от '+niceDate(doc.doc_date)+'? Действие необратимо.'))return;
  await withBusy(async()=>{
   if(guestMode){deleteLocalDocument(doc.id)}
   else {const r=await sb.from('kolhoz_writeoffs').delete().eq('id',doc.id).eq('status','draft');if(r.error)throw r.error;}
   if(currentId===doc.id)newForm(false);
   say('Черновик удалён из журнала.','success');await loadJournal();
  });
 }
}

async function loadCatalog(){
 catalog=[];let from=0;
 while(from<15000){
  if(guestMode){
   const response=await fetch(GUEST_CATALOG_URL,{method:'GET',headers:{Accept:'application/json'}});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||'Не удалось загрузить справочник');
   catalog.push(...data.rows);break;
  }
  const r=await sb.from('kolhoz_writeoff_nomenclature').select('id,source_row,name,unit').eq('organization_id',orgId).order('source_row').range(from,from+999);
  if(r.error)throw r.error;
  catalog.push(...(r.data||[]));
  if((r.data||[]).length<1000)break;
  from+=1000;
 }
 catalogByName=new Map();
 for(const n of catalog){
  const key=n.name.trim().toLocaleLowerCase('ru').replace(/ё/g,'е');
  const matches=catalogByName.get(key)||[];
  matches.push(n);
  catalogByName.set(key,matches);
 }
 const list=$('catalog');list.replaceChildren();
 for(const n of catalog){
  const opt=document.createElement('option');
  opt.value=n.name;if(n.unit)opt.label='Ед. изм.: '+n.unit;
  list.appendChild(opt);
 }
 updateMode();
}

function restore(){
 let raw=null;
 try{raw=JSON.parse(localStorage.getItem(storeKey())||'null')}catch(_){}
 if(!raw||!raw.entries)return false;
 loading=true;
 currentId=raw.id||null;revision=raw.revision||null;writerSecret=currentId?getStaffWriter(currentId):'';currentStatus='draft';viewOnly=false;
 $('docDate').value=raw.date||today();$('shift').value=raw.shift||'';$('warehouse').value=raw.warehouse||'';
 let saved=[];
 if(Array.isArray(raw.entries))saved=raw.entries;
 else if(typeof raw.entries==='object'){
   for(const g of ['raw','semi','dish'])if(Array.isArray(raw.entries[g]))saved.push(...raw.entries[g]);
 }
 entries=saved.map(x=>({...blank(),...x,key:crypto.randomUUID()}));
 while(entries.length<10)entries.push(blank());
 dirty=true;paintAll();loading=false;
 say('Восстановлен незавершённый черновик, в том числе записи из прежних трёх блоков. Сохраните его в журнал.');
 return true;
}

async function init(){
 const login=$('loginCard');if(login)login.hidden=true;
 try{
  const requestedStaffDoc=new URLSearchParams(location.search).get('staffdoc');
  staffAccessKey=requestedStaffDoc?'':readStaffAccessKey();
  let session=null;
  try{const auth=await sb.auth.getSession();session=auth.data?.session||null}
  catch(error){console.warn('Сессия недоступна, доступен локальный режим',error)}
  if(session&&!staffAccessKey){
   try{
    userId=session.user.id;
    const mr=await sb.from('workspace_members').select('workspace_id').eq('user_id',userId);
    if(mr.error||!mr.data?.length)throw new Error('Нет рабочего пространства');
    let cached={};try{cached=JSON.parse(localStorage.getItem('pervichka_workspace_v1')||'{}')}catch(_){}
    workspaceId=(mr.data.find(x=>x.workspace_id===cached.id)||mr.data[0]).workspace_id;
    const or=await sb.from('organizations').select('id,name').eq('workspace_id',workspaceId);
    if(or.error)throw or.error;
    const target=(or.data||[]).find(x=>/здобников|колхоз/i.test(x.name));
    if(!target)throw new Error('Не найдена организация Колхоз');
    orgId=target.id;$('orgLabel').value=target.name;
    guestMode=false;
   }catch(error){console.warn('Общий журнал недоступен, открываю локальный режим',error)}
  }
  if(!orgId){
   guestMode=true;userId='guest';workspaceId='';orgId=GUEST_ORG_ID;
   $('orgLabel').value='ИП Здобникова С. С.';
  }
  $('storageModeNotice').textContent=guestMode
   ? (staffAccessKey?'Форма для сотрудников. Черновики и отправленные списания сохраняются в общей базе и сразу доступны администратору.'
     :'Для сохранения в общую базу откройте персональную ссылку, которую предоставил администратор.')
   : 'Документы сохраняются в общем облачном журнале.';
  $('screen').hidden=false;
  newForm(false);
  const results=await Promise.allSettled([loadCatalog(),loadJournal()]);
  const issues=results.filter(x=>x.status==='rejected').map(x=>x.reason?.message||'Ошибка получения данных');
  const staffDocId=new URLSearchParams(location.search).get('staffdoc');
  const requestId=new URLSearchParams(location.search).get('writeoff');
  if(staffDocId){
   if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(staffDocId)||guestMode){
    say('Документ сотрудников можно открыть только из авторизованного интерфейса администратора.','error');
   }else{
    const reply=await sb.from('kolhoz_staff_writeoffs')
      .select('id,organization_id,workspace_id,doc_date,shift,warehouse,items,status,created_at,updated_at,submitted_at')
      .eq('organization_id',orgId).eq('id',staffDocId).maybeSingle();
    if(reply.error)throw reply.error;
    if(reply.data){
      fillDocument({...reply.data,created_by:null});
      viewOnly=true;updateMode();
      say('Списание сотрудника открыто в режиме просмотра. Доступны печать и Excel.','success');
    }else say('Документ сотрудника не найден или недоступен.','error');
   }
  }else if(requestId){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)){
    say('Некорректная ссылка на списание.','error');
   }else{
    let linked=journalData.find(x=>x.id===requestId);
    if(!linked&&guestMode)linked=readLocalJournal().find(x=>x.id===requestId);
    if(!linked&&!guestMode){
     const reply=await sb.from('kolhoz_writeoffs').select('id,workspace_id,organization_id,doc_date,shift,warehouse,items,status,created_by,created_at,updated_at,submitted_at')
      .eq('organization_id',orgId).eq('id',requestId).maybeSingle();
     if(reply.error)throw reply.error;
     linked=reply.data;
    }
    if(linked){fillDocument(linked);say('Документ открыт из общего журнала. Доступны печать и Excel.','success')}
    else say('Документ не найден. Возможно, он удалён или недоступен вашему аккаунту.','error');
   }
  }else if(!restore())say(issues.length?'Форма открыта. '+issues.join('; '):'Страница готова: '+(guestMode?'передача в общий журнал '+(staffAccessKey?'подключена.':'ожидает ссылку сотрудника.'):'подключён общий журнал.'),issues.length?'error':'success');
 }catch(e){console.error(e);say('Не удалось открыть списания: '+(e.message||e),'error');$('stateBadge').textContent='Ошибка'}
}
$('addRowBtn').addEventListener('click',()=>{entries.push(blank());paintRows();persist()});
for(const field of ['docDate','shift','warehouse'])$(field).addEventListener('change',persist);
$('newBtn').addEventListener('click',()=>newForm());
$('saveBtn').addEventListener('click',saveDraft);
$('submitBtn').addEventListener('click',submit);
$('excelBtn').addEventListener('click',()=>exportWriteoffStyled());
$('printBtn').addEventListener('click',()=>printWriteoff());
$('reloadBtn').addEventListener('click',()=>loadJournal().catch(e=>say('Ошибка журнала: '+e.message,'error')));
for(const id of ['statusFilter','dateFrom','dateTo'])$(id).addEventListener('change',()=>loadJournal().catch(e=>say('Ошибка журнала: '+e.message,'error')));
$('journal').addEventListener('click',onJournalClick);
init();