'use strict';
const $ = (id) => document.getElementById(id);
const SUPABASE_URL = 'https://dwdunpyzcfdwokoczenl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const groups = [['raw','Сырьё'],['semi','Полуфабрикаты'],['dish','Блюда']];
const groupTitle = Object.fromEntries(groups);
let userId = '', workspaceId = '', orgId = '';
let catalog = [], catalogByName = new Map(), currentId = null, revision = null, currentStatus = 'draft';
let entries = {raw:[],semi:[],dish:[]}, journalData = [];
let dirty = false, busy = false, loading = true, viewOnly = false;

const blank = (group) => ({key: crypto.randomUUID(), group, nomenclature_id:null, code:'', name:'', qty:'', unit:'', reason:''});
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function today() {const d = new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function niceDate(s) {if(!s)return '—';const a=s.split('-');return a.length===3 ? a[2]+'.'+a[1]+'.'+a[0] : s}
function say(message,kind='') {$('notice').textContent=message;$('notice').className='notice'+(kind?' '+kind:'')}
function storeKey(){return 'kolhoz_writeoffs_unsaved_v2_'+userId+'_'+orgId}
function resetEntries() {entries={raw:[],semi:[],dish:[]};for(const [group] of groups)for(let i=0;i<5;i++)entries[group].push(blank(group))}
function lineCount(group){return entries[group].filter(r=>r.name.trim()).length}
function repaintCounts(){for(const [group] of groups)$('count-'+group).textContent='· '+lineCount(group)+' заполнено'}
function updateMode(){
 const sent=currentStatus==='submitted'||viewOnly;
 $('editorFields').disabled=sent;
 $('itemsFields').disabled=sent;
 $('saveBtn').disabled=sent||busy;
 $('submitBtn').disabled=sent||busy;
 $('submitBtn').textContent=sent?'Уже отправлено':'Отправить в журнал';
 $('stateBadge').textContent=viewOnly?'Черновик · просмотр':(currentStatus==='submitted'?'Отправлено':(currentId?'Черновик в журнале':'Новый черновик'));
 $('catalogStatus').textContent=catalog.length?'Справочник: '+catalog.length+' позиций':'Справочник пока пуст';
 repaintCounts();
}
function draftSnapshot(){
 return {id:currentId,revision,status:currentStatus,date:$('docDate').value,shift:$('shift').value,warehouse:$('warehouse').value,
         entries:Object.fromEntries(groups.map(([g])=>[g,entries[g].map(x=>({...x}))]))};
}
function persist(){
 if(loading||currentStatus==='submitted'||!userId||!orgId)return;
 dirty=true;
 try{localStorage.setItem(storeKey(),JSON.stringify(draftSnapshot()))}catch(e){console.warn('Локальная копия не сохранена',e)}
 repaintCounts();
}
function clearLocal(){try{localStorage.removeItem(storeKey())}catch(_){}}
function paintGroup(group){
 const tbody=$('rows-'+group);
 tbody.replaceChildren();
 entries[group].forEach((line)=>{
  const tr=document.createElement('tr');
  tr.innerHTML='<td><input class="item-name" data-field="name" list="catalog" placeholder="Начните вводить название" autocomplete="off"></td>'
   +'<td><input class="item-qty" data-field="qty" type="text" inputmode="decimal" placeholder="0,000"></td>'
   +'<td><input class="item-unit" data-field="unit" placeholder="Ед."></td>'
   +'<td><input class="item-reason" data-field="reason" list="reasons" placeholder="Выберите или введите"></td>'
   +'<td><button type="button" class="remove" title="Удалить строку" aria-label="Удалить строку">✕</button></td>';
  for(const field of ['name','qty','unit','reason']){
   const input=tr.querySelector('[data-field="'+field+'"]');
   input.value=line[field]||'';
   input.addEventListener('input',()=>{
    line[field]=input.value;
    if(field==='name'){
     line.nomenclature_id=null;line.code='';
     const match=catalogByName.get(line.name.trim().toLocaleLowerCase('ru'));
     if(match){line.nomenclature_id=match.id;line.code=match.code||'';line.unit=match.unit||line.unit||'';tr.querySelector('[data-field="unit"]').value=line.unit}
    }
    persist();
   });
   if(field==='name') input.addEventListener('change',()=>{
    const match=catalogByName.get(line.name.trim().toLocaleLowerCase('ru'));
    if(match){line.nomenclature_id=match.id;line.code=match.code||'';line.unit=match.unit||line.unit||'';tr.querySelector('[data-field="unit"]').value=line.unit;persist()}
   });
  }
  tr.querySelector('.remove').addEventListener('click',()=>{entries[group]=entries[group].filter(r=>r.key!==line.key);paintGroup(group);persist()});
  tbody.appendChild(tr);
 });
 repaintCounts();
}
function paintAll(){for(const [group] of groups)paintGroup(group);updateMode()}
function newForm(ask=true){
 if(ask&&dirty&&!confirm('Есть несохранённые изменения. Создать новый документ?'))return;
 if(ask||!loading)clearLocal();loading=true;
 currentId=null;revision=null;currentStatus='draft';viewOnly=false;dirty=false;
 $('docDate').value=today();$('shift').value='';$('warehouse').value='';
 resetEntries();paintAll();loading=false;
 say('Новый документ. Можно заполнять постепенно; изменения временно сохраняются и в этом браузере.');
 window.scrollTo({top:0,behavior:'smooth'});
}
function collectRows(strict){
 const out=[];
 for(const [group] of groups)for(const r of entries[group]){
  const name=r.name.trim(),reason=r.reason.trim(),unit=r.unit.trim(),qtyText=String(r.qty||'').trim();
  const touched=name||reason||unit||qtyText;
  if(!touched)continue;
  const quantity=Number(qtyText.replace(',','.'));
  if(strict){
   if(!name)throw new Error('Укажите номенклатуру в разделе «'+groupTitle[group]+'».');
   if(!qtyText||!Number.isFinite(quantity)||quantity<=0)throw new Error('Для «'+name+'» укажите количество больше нуля.');
   if(!reason)throw new Error('Для «'+name+'» укажите причину списания.');
   if(!unit)throw new Error('Для «'+name+'» укажите единицу измерения.');
  }
  out.push({group,nomenclature_id:r.nomenclature_id||null,code:r.code||'',name,qty:qtyText,unit,reason});
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
async function saveDraft(){
 if(currentStatus==='submitted'||viewOnly)return;
 await withBusy(async()=>{
  const payload=headerPayload(false);
  let result;
  if(currentId){
   result=await sb.from('kolhoz_writeoffs').update(payload).eq('id',currentId).eq('status','draft').eq('updated_at',revision).select('*').single();
  }else{
   result=await sb.from('kolhoz_writeoffs').insert({...payload,workspace_id:workspaceId,organization_id:orgId,created_by:userId,status:'draft'}).select('*').single();
  }
  if(result.error)throw new Error(result.error.code==='PGRST116'?'Черновик уже изменён или отправлен. Обновите журнал.':result.error.message);
  currentId=result.data.id;revision=result.data.updated_at;dirty=false;clearLocal();
  say('Черновик сохранён в общей базе. Его можно открыть из журнала и продолжить позднее.','success');
  await loadJournal();
 });
}
async function submit(){
 if(currentStatus==='submitted'||viewOnly)return;
 let payload;
 try{payload=headerPayload(true)}catch(e){say(e.message,'error');return}
 if(!confirm('Отправить списание в общий журнал? После отправки его нельзя будет редактировать. В 1С документ не отправляется.'))return;
 await withBusy(async()=>{
  let result;
  if(currentId){
   result=await sb.from('kolhoz_writeoffs').update({...payload,status:'submitted'}).eq('id',currentId).eq('status','draft').eq('updated_at',revision).select('*').single();
  }else{
   result=await sb.from('kolhoz_writeoffs').insert({...payload,status:'submitted',workspace_id:workspaceId,organization_id:orgId,created_by:userId}).select('*').single();
  }
  if(result.error)throw new Error(result.error.code==='PGRST116'?'Документ уже изменён или отправлен. Обновите журнал.':result.error.message);
  currentId=result.data.id;revision=result.data.updated_at;currentStatus='submitted';dirty=false;clearLocal();
  say('Списание отправлено в общий журнал и защищено от изменений. Для исправлений используйте «Создать копию».','success');
  await loadJournal();
 });
}
function fillDocument(doc,copy=false){
 clearLocal();loading=true;
 currentId=copy?null:doc.id;revision=copy?null:doc.updated_at;currentStatus=copy?'draft':doc.status;viewOnly=!copy&&doc.status==='draft'&&doc.created_by!==userId;dirty=false;
 $('docDate').value=doc.doc_date||today();$('shift').value=doc.shift||'';$('warehouse').value=doc.warehouse||'';
 entries={raw:[],semi:[],dish:[]};
 for(const item of (doc.items||[])){
  if(!entries[item.group])continue;
  entries[item.group].push({...blank(item.group),...item,key:crypto.randomUUID()});
 }
 if(currentStatus==='draft')for(const [group] of groups)while(entries[group].length<5)entries[group].push(blank(group));
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
 if(typeof XLSX==='undefined'){say('Не загружена библиотека Excel. Попробуйте обновить страницу.','error');return}
 let items;
 try{items=doc?doc.items:collectRows(false)}catch(e){say(e.message,'error');return}
 const info=doc||{doc_date:$('docDate').value,shift:$('shift').value,warehouse:$('warehouse').value,status:currentStatus};
 const rows=[['Дата','Смена','Склад','Раздел','Номенклатура','Код 1С','Количество','Ед. изм.','Причина','Статус']];
 for(const item of items)rows.push([niceDate(info.doc_date),info.shift||'',info.warehouse||'',groupTitle[item.group]||item.group,item.name,item.code||'',String(item.qty).replace(',','.'),item.unit,item.reason,info.status==='submitted'?'Отправлено':'Черновик']);
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);
 ws['!cols']=[{wch:14},{wch:12},{wch:20},{wch:19},{wch:49},{wch:14},{wch:14},{wch:13},{wch:23},{wch:14}];
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
   +(!sent&&auth?'<button class="danger" data-action="delete" data-id="'+esc(d.id)+'">Удалить</button>':'')
   +'</div></div>';
 }).join('');
}
async function loadJournal(){
 if(!orgId)return;
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
 if(b.dataset.action==='excel'){exportXlsx(doc);return}
 if(b.dataset.action==='open'){
  if(!maybeLeave())return;
  fillDocument(doc);
  if(viewOnly)say('Это черновик другого пользователя. Доступен просмотр или создание собственной копии.');
 }
 if(b.dataset.action==='copy'){if(!maybeLeave())return;fillDocument(doc,true)}
 if(b.dataset.action==='delete'){
  if(!confirm('Удалить черновик от '+niceDate(doc.doc_date)+'? Действие необратимо.'))return;
  await withBusy(async()=>{
   const r=await sb.from('kolhoz_writeoffs').delete().eq('id',doc.id).eq('status','draft');
   if(r.error)throw r.error;
   if(currentId===doc.id)newForm(false);
   say('Черновик удалён из журнала.','success');await loadJournal();
  });
 }
}
async function loadCatalog(){
 catalog=[];let from=0;
 while(from<15000){
  const r=await sb.from('nomenclature').select('id,code,name,unit,group_name').eq('organization_id',orgId).eq('is_active',true).order('name').range(from,from+999);
  if(r.error)throw r.error;
  catalog.push(...(r.data||[]));
  if((r.data||[]).length<1000)break;
  from+=1000;
 }
 catalogByName=new Map(catalog.map(n=>[n.name.trim().toLocaleLowerCase('ru'),n]));
 const list=$('catalog');list.replaceChildren();
 for(const n of catalog){const opt=document.createElement('option');opt.value=n.name;if(n.unit)opt.label=n.unit;list.appendChild(opt)}
 updateMode();
}
function restore(){
 let raw=null;
 try{raw=JSON.parse(localStorage.getItem(storeKey())||'null')}catch(_){}
 if(!raw||!raw.entries)return false;
 loading=true;
 currentId=raw.id||null;revision=raw.revision||null;currentStatus='draft';viewOnly=false;
 $('docDate').value=raw.date||today();$('shift').value=raw.shift||'';$('warehouse').value=raw.warehouse||'';
 entries={raw:[],semi:[],dish:[]};
 for(const [g] of groups){
  const stored=Array.isArray(raw.entries[g])?raw.entries[g]:[];
  entries[g]=stored.map(x=>({...blank(g),...x,key:crypto.randomUUID()}));
  while(entries[g].length<5)entries[g].push(blank(g));
 }
 dirty=true;paintAll();loading=false;
 say('Восстановлено незавершённое заполнение из этого браузера. Нажмите «Сохранить черновик», чтобы запись появилась в общем журнале.');
 return true;
}
async function init(){
 try{
  const auth=await sb.auth.getSession();
  if(auth.error)throw auth.error;
  if(!auth.data.session){$('loginCard').hidden=false;say('Для работы с общим журналом войдите в Помогатор.','error');$('stateBadge').textContent='Нужен вход';return}
  $('loginCard').hidden=true;
  userId=auth.data.session.user.id;
  const mr=await sb.from('workspace_members').select('workspace_id').eq('user_id',userId);
  if(mr.error)throw mr.error;
  if(!mr.data.length)throw new Error('Не найдено рабочее пространство. Откройте сначала главную страницу Помогатора.');
  let cached={};try{cached=JSON.parse(localStorage.getItem('pervichka_workspace_v1')||'{}')}catch(_){}
  workspaceId=(mr.data.find(x=>x.workspace_id===cached.id)||mr.data[0]).workspace_id;
  const or=await sb.from('organizations').select('id,name').eq('workspace_id',workspaceId);
  if(or.error)throw or.error;
  const target=(or.data||[]).find(x=>/здобников|колхоз/i.test(x.name));
  if(!target)throw new Error('В рабочем пространстве нет организации «Колхоз / ИП Здобникова». Добавьте или выберите её на главной странице.');
  orgId=target.id;$('orgLabel').value=target.name;
  $('screen').hidden=false;
  newForm(false);
  await Promise.all([loadCatalog(),loadJournal()]);
  if(!restore())say('Подключено к общей базе. Выберите склад и добавьте позиции списания.','success');
 }catch(e){console.error(e);say('Не удалось открыть списания: '+(e.message||e),'error');$('stateBadge').textContent='Ошибка подключения'}
}
$('loginForm').addEventListener('submit',async(event)=>{
 event.preventDefault();
 const button=$('loginButton');button.disabled=true;$('loginError').textContent='Проверяю учётную запись…';
 try{const {error}=await sb.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)throw error;
 $('loginError').textContent='';await init();
 }catch(e){$('loginError').textContent='Ошибка входа: '+(e.message||e)}finally{button.disabled=false}
});
document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{const group=b.dataset.add;entries[group].push(blank(group));paintGroup(group);persist()}));
for(const field of ['docDate','shift','warehouse'])$(field).addEventListener('change',persist);
$('newBtn').addEventListener('click',()=>newForm());
$('saveBtn').addEventListener('click',saveDraft);
$('submitBtn').addEventListener('click',submit);
$('excelBtn').addEventListener('click',()=>exportXlsx());
$('reloadBtn').addEventListener('click',()=>loadJournal().catch(e=>say('Ошибка журнала: '+e.message,'error')));
for(const id of ['statusFilter','dateFrom','dateTo'])$(id).addEventListener('change',()=>loadJournal().catch(e=>say('Ошибка журнала: '+e.message,'error')));
$('journal').addEventListener('click',onJournalClick);
init();