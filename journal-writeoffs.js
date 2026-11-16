'use strict';
// The single Pomogator "Журнал документов" shows writeoffs alongside the normal document journal.
// No public access to cloud writeoffs: Supabase RLS still requires workspace membership.
const GENERAL_KOLHOZ_ORG_ID='3d89b13c-28e9-4cb8-a439-407c6ecaac22';
const GENERAL_KOLHOZ_LOCAL_KEY='kolhoz_writeoffs_local_journal_v1';

function generalJournalDate(s){
 const a=String(s||'').split('-');return a.length===3?a.reverse().join('.'):(s||'—');
}
function generalJournalLocalWriteoffs(){
 try{
  const docs=JSON.parse(localStorage.getItem(GENERAL_KOLHOZ_LOCAL_KEY)||'[]');
  return Array.isArray(docs)?docs.filter(d=>d&&d.organization_id===GENERAL_KOLHOZ_ORG_ID).map(d=>({...d,_storage:'local'})):[];
 }catch(e){console.warn('Не удалось открыть локальные списания',e);return []}
}
const JOURNAL_ACCESS_STORAGE='sb-dwdunpyzcfdwokoczenl-auth-token';
const KOLHOZ_PROCESSING_KEYS={staff:'staff_writeoff_id',cloud:'cloud_writeoff_id'};
let kolhozJournalRequestId=0;
let kolhozJournalSaving=0;
let kolhozJournalLoading=false;
let kolhozJournalToken=null;
let kolhozJournalRenderedSignature=null;
const kolhozJournalRowsBySource=new Map();

function storedJournalSession(){
 try{
  const saved=JSON.parse(localStorage.getItem(JOURNAL_ACCESS_STORAGE)||'null');
  const session=saved?.currentSession||saved?.session||saved;
  if(session?.access_token&&typeof session.access_token==='string')return session;
 }catch(e){console.warn('Не удалось прочитать сессию журнала',e)}
 return null;
}
async function journalWithDeadline(action,ms,label){
 let timer;
 try{
  return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(new Error(label+' не ответил за '+Math.ceil(ms/1000)+' секунд. Повторите загрузку.')),ms);
  })]);
 }finally{clearTimeout(timer)}
}
async function journalAccessToken(){
 const saved=storedJournalSession();
 if(saved?.access_token&&(!saved.expires_at||Number(saved.expires_at)*1000>Date.now()+15000))return saved.access_token;
 try{
  const auth=await journalWithDeadline(()=>sb.auth.getSession(),3500,'Проверка авторизации');
  if(auth.error)throw auth.error;
  if(auth.data?.session?.access_token)return auth.data.session.access_token;
 }catch(e){console.warn('Ошибка сессии журнала; пробую сохранённую авторизацию',e?.message||e)}
 return saved?.access_token||null;
}
async function kolhozJournalGateway(action,token,payload={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(SUPABASE_URL+'/functions/v1/pomogator-internal-journal',{
   method:'POST',signal:controller.signal,credentials:'omit',
   headers:{'Content-Type':'text/plain'},
   body:JSON.stringify({action,...payload,token})
  });
  if(response.status===401||response.status===403)throw Object.assign(new Error('Сессия истекла или нет доступа. Войдите повторно.'),{needsLogin:true});
  if(!response.ok){
   const detail=await response.json().catch(()=>null);
   throw Object.assign(new Error(detail?.error||'Журнал временно недоступен.'),{retryable:response.status>=500});
  }
  return await response.json();
 }catch(e){
  if(e?.name==='AbortError')throw Object.assign(new Error('Сервер журнала не ответил за 15 секунд.'),{retryable:true});
  if(e instanceof TypeError)throw Object.assign(new Error('Нет связи с сервером журнала.'),{retryable:true});
  throw e;
 }finally{clearTimeout(timer)}
}
async function kolhozJournalRead(action,token,payload){
 try{
  return await kolhozJournalGateway(action,token,payload);
 }catch(e){
  if(!e?.retryable)throw e;
  return kolhozJournalGateway(action,token,payload);
 }
}
async function saveKolhozProcessed(input){
 const key=KOLHOZ_PROCESSING_KEYS[input.dataset.source];
 const row=input.closest('.orgrow');
 const message=row?.querySelector('.journal-processing-message');
 if(!key||!row||!message)return;
 const checked=input.checked;
 const refresh=document.getElementById('refreshKolhozJournal');
 kolhozJournalSaving++;
 if(refresh)refresh.disabled=true;
 input.disabled=true;
 message.textContent='Сохраняю…';
 try{
  const token=await journalAccessToken();
  if(!token)throw new Error('Войдите в Помогатор повторно.');
  const saved=await kolhozJournalGateway('mark',token,{source:input.dataset.source,id:input.dataset.writeoffId,checked});
  if(saved.is_processed!==checked)throw new Error('Сервер не подтвердил изменение.');
  row.classList.toggle('journal-processed',checked);
  const cached=kolhozJournalRowsBySource.get(input.dataset.source)?.find(doc=>doc.id===input.dataset.writeoffId);
  if(cached)cached.is_processed=checked;
  message.textContent='';
 }catch(e){
  input.checked=!checked;
  message.textContent='Не удалось сохранить отметку. '+(e?.message||e);
 }finally{
  kolhozJournalSaving--;
  input.disabled=false;
  if(refresh)refresh.disabled=kolhozJournalSaving>0;
 }
}
async function renderKolhozJournal(){
 const dest=document.getElementById('kolhozUnifiedJournal');
 if(!dest||kolhozJournalSaving||kolhozJournalLoading)return;
 kolhozJournalLoading=true;
 const card=dest.parentElement;
 let refresh=document.getElementById('refreshKolhozJournal');
 if(!refresh&&card){
  refresh=document.createElement('button');
  refresh.id='refreshKolhozJournal';refresh.type='button';
  refresh.textContent='Обновить списания';
  refresh.addEventListener('click',()=>renderKolhozJournal());
  card.insertBefore(refresh,dest);
 }
 const requestId=++kolhozJournalRequestId;
 if(refresh)refresh.disabled=true;
 if(!dest.querySelector('.orgrow'))dest.textContent='Загружаю списания «Колхоза»…';
 const loginPanel=document.getElementById('journalAdminLoginPanel');
 try{
  const token=await journalAccessToken();
  if(requestId!==kolhozJournalRequestId)return;
  if(token!==kolhozJournalToken){
   // Keep the last list only while the same signed-in session is in use.
   kolhozJournalRowsBySource.clear();
   kolhozJournalToken=token;
   kolhozJournalRenderedSignature=null;
   dest.textContent='Загружаю списания «Колхоза»…';
  }
  if(loginPanel)loginPanel.hidden=!!token;
  if(!token){
   dest.textContent='Необходимо войти в Помогатор, чтобы увидеть списания сотрудников.';
   return;
  }
  let groups;
  try{
   groups=await kolhozJournalRead('writeoffs',token);
  }catch(e){
   if(e?.needsLogin&&loginPanel)loginPanel.hidden=false;
   if(!e?.retryable)throw e;
   groups={staff:null,cloud:null};
  }
  if(requestId!==kolhozJournalRequestId)return;
  const sources={staff:'Сотрудники Колхоза',cloud:'Списания из Помогатора'};
  const rows=[],warnings=[];
  for(const [source,label] of Object.entries(sources)){
   if(Array.isArray(groups[source])){
    kolhozJournalRowsBySource.set(source,groups[source]);
   }else{
    warnings.push(label+' — не удалось обновить список.');
   }
   rows.push(...(kolhozJournalRowsBySource.get(source)||[]));
  }
  const unique=[...new Map(rows.map(doc=>[doc.id,doc])).values()];
  unique.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const errorText=warnings.length?'<p class="muted" role="alert" data-writeoff-refresh-error>'+esc(warnings.join(' | '))+'</p>':'';
  if(!unique.length){
   kolhozJournalRenderedSignature=null;
   dest.innerHTML=(warnings.length?'<p class="muted">Не удалось загрузить списания. Нажмите «Обновить списания».</p>':'<p class="muted">Списаний пока нет.</p>')+errorText;
   return;
  }
  const signature=JSON.stringify(unique);
  if(kolhozJournalSaving)return;
  if(warnings.length&&signature===kolhozJournalRenderedSignature&&dest.querySelector('.orgrow')){
   dest.querySelector('[data-writeoff-refresh-error]')?.remove();
   dest.insertAdjacentHTML('beforeend',errorText);
   return;
  }
  dest.innerHTML='<p class="muted">'+unique.length+' документ(ов) в журнале</p>'
   +'<p class="journal-processing-error" id="kolhozProcessingLoadResult" role="status"></p>'+unique.map(d=>{
   const title='Списание · '+esc(generalJournalDate(d.doc_date))+' · '+esc(d.warehouse||'Склад не указан');
   const label=d._storage==='staff'?'Сотрудники Колхоза':'Общий журнал';
   const url='./writeoffs.html?'+(d._storage==='staff'?'staffdoc=':'writeoff=')+encodeURIComponent(d.id);
   const status=d.status==='submitted'?'Отправлено':'Черновик';
   return '<div class="orgrow'+(d.is_processed===true?' journal-processed':'')+'">'
    +'<span><b>'+title+'</b>'
    +'<small>'+esc(status)+' · '+esc(d.shift||'Без смены')+' · '+label+'</small>'
    +'</span><div class="journal-writeoff-actions">'
    +'<label class="journal-processing"><input type="checkbox" data-source="'+d._storage
    +'" data-writeoff-id="'+esc(d.id)+'"'+(d.is_processed===true?' checked':d.is_processed===null?' disabled':'')+'> Обработано</label>'
    +'<a class="journal-link" href="'+url+'">Открыть / Печать</a>'
    +'<small class="journal-processing-message" role="status"></small></div>'
    +'</div>';
  }).join('')+errorText;
  kolhozJournalRenderedSignature=signature;
  const inputs=[...dest.querySelectorAll('.journal-processing input')];
  inputs.forEach(input=>{
   input.indeterminate=input.disabled;
   input.addEventListener('change',()=>saveKolhozProcessed(input));
  });
  if(inputs.some(input=>input.disabled)){
   const result=document.getElementById('kolhozProcessingLoadResult');
   if(result)result.textContent='Не удалось загрузить некоторые отметки «Обработано». Нажмите «Обновить списания».';
  }
 }catch(e){
  if(requestId!==kolhozJournalRequestId)return;
  kolhozJournalRenderedSignature=null;
  kolhozJournalRowsBySource.clear();
  dest.textContent='Не удалось открыть журнал списаний: '+(e?.message||e)+'. Нажмите «Обновить списания».';
 }finally{
  kolhozJournalLoading=false;
  if(requestId===kolhozJournalRequestId&&refresh)refresh.disabled=kolhozJournalSaving>0;
 }
}

// Deep link may be opened while app.js is still initializing; retry once all scripts are loaded.
window.addEventListener('load',()=>{
 if(location.hash!=='#journal')return;
 if(document.getElementById('journal')?.hidden)show('journal');
 else renderKolhozJournal().catch(console.error);
},{once:true});

// While the general journal remains open, refresh new staff documents periodically.
setInterval(()=>{
 const pane=document.getElementById('journal');
 const dest=document.getElementById('kolhozUnifiedJournal');
 if(pane&&!pane.hidden&&!dest?.contains(document.activeElement))renderKolhozJournal().catch(console.error);
},30000);

document.getElementById('journalAdminLoginForm')?.addEventListener('submit',async event=>{
 event.preventDefault();
 const submit=event.currentTarget.querySelector('button[type="submit"]');
 const email=document.getElementById('journalAdminEmail').value.trim();
 const password=document.getElementById('journalAdminPassword').value;
 const status=document.getElementById('journalAdminLoginResult');
 if(!email||!password)return;
 if(submit)submit.disabled=true;
 status.textContent='Проверяю учётную запись…';
 try{
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error)throw error;
  document.getElementById('journalAdminPassword').value='';
  status.textContent='Вход выполнен, загружаю документы…';
  await startApp();
  show('journal');
 }catch(e){
  status.textContent='Не удалось войти: '+(e.message||e);
 }finally{if(submit)submit.disabled=false}
});
