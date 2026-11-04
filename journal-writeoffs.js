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
let kolhozJournalRequestId=0;

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
async function loadKolhozSource(table,token){
 const columns='id,doc_date,shift,warehouse,status,items,created_at,updated_at';
 const url=SUPABASE_URL+'/rest/v1/'+table+'?select='+encodeURIComponent(columns)
  +'&organization_id=eq.'+encodeURIComponent(GENERAL_KOLHOZ_ORG_ID)
  +'&order=created_at.desc&limit=100';
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),9000);
 try{
  // Direct fetch avoids an occasional auth-lock deadlock in older supabase-js browsers.
  // Supabase verifies this user's JWT and enforces RLS; no service-role credentials.
  const response=await fetch(url,{
   method:'GET',signal:controller.signal,cache:'no-store',
   headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+token,Accept:'application/json'}
  });
  if(response.status===401||response.status===403)throw Object.assign(new Error('Сессия истекла или нет доступа к списаниям. Войдите повторно.'),{needsLogin:true});
  if(!response.ok){
   const detail=await response.json().catch(()=>null);
   throw new Error(detail?.message||detail?.error||'Ошибка базы: HTTP '+response.status);
  }
  const data=await response.json();
  if(!Array.isArray(data))throw new Error('База вернула неверный формат списка');
  return data;
 }catch(e){
  if(e?.name==='AbortError')throw new Error('Сервер списаний не ответил за 9 секунд. Проверьте соединение и нажмите «Обновить».');
  throw e;
 }finally{clearTimeout(timer)}
}
async function renderKolhozJournal(){
 const dest=document.getElementById('kolhozUnifiedJournal');
 if(!dest)return;
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
 dest.textContent='Проверяю списания «Колхоза»…';
 const loginPanel=document.getElementById('journalAdminLoginPanel');
 try{
  const token=await journalAccessToken();
  if(requestId!==kolhozJournalRequestId)return;
  if(loginPanel)loginPanel.hidden=!!token;
  if(!token){
   dest.textContent='Необходимо войти в Помогатор, чтобы увидеть списания сотрудников.';
   return;
  }
  const sources=[
   {table:'kolhoz_staff_writeoffs',label:'Сотрудники Колхоза',storage:'staff'},
   {table:'kolhoz_writeoffs',label:'Списания из Помогатора',storage:'cloud'}
  ];
  const results=await Promise.allSettled(sources.map(async source=>{
   const rows=await journalWithDeadline(()=>loadKolhozSource(source.table,token),11000,source.label);
   return rows.map(doc=>({...doc,_storage:source.storage}));
  }));
  if(requestId!==kolhozJournalRequestId)return;
  let rows=[],warnings=[],unauthorized=false;
  for(let i=0;i<results.length;i++){
   if(results[i].status==='fulfilled')rows.push(...results[i].value);
   else{
    warnings.push(sources[i].label+': '+(results[i].reason?.message||'Ошибка загрузки'));
    if(results[i].reason?.needsLogin)unauthorized=true;
   }
  }
  if(unauthorized&&loginPanel)loginPanel.hidden=false;
  const unique=[...new Map(rows.map(doc=>[doc.id,doc])).values()];
  unique.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const errorText=warnings.length?'<p class="muted" role="alert">'+esc(warnings.join(' | '))+'</p>':'';
  if(!unique.length){
   dest.innerHTML=(warnings.length?'<p class="muted">Не удалось загрузить списания. Нажмите «Обновить списания».</p>':'<p class="muted">Списаний пока нет.</p>')+errorText;
   return;
  }
  dest.innerHTML='<p class="muted">'+unique.length+' документ(ов) в журнале</p>'+unique.map(d=>{
   const count=Array.isArray(d.items)?d.items.filter(x=>String(x.name||'').trim()).length:0;
   const title='Списание · '+generalJournalDate(d.doc_date)+' · '+esc(d.warehouse||'Склад не указан');
   const label=d._storage==='staff'?'Сотрудники Колхоза':'Общий журнал';
   const url='./writeoffs.html?'+(d._storage==='staff'?'staffdoc=':'writeoff=')+encodeURIComponent(d.id);
   const status=d.status==='submitted'?'Отправлено':'Черновик';
   return '<div class="orgrow">'
    +'<span><b>'+title+'</b>'
    +'<small>'+esc(status)+' · '+esc(d.shift||'Без смены')+' · '+count+' поз. · '+label+'</small>'
    +'</span><a class="journal-link" href="'+url+'">Открыть / Печать</a>'
    +'</div>';
  }).join('')+errorText;
 }catch(e){
  if(requestId!==kolhozJournalRequestId)return;
  dest.textContent='Не удалось открыть журнал списаний: '+(e?.message||e)+'. Нажмите «Обновить списания».';
 }finally{
  if(requestId===kolhozJournalRequestId&&refresh)refresh.disabled=false;
 }
}

// Deep link may be opened while app.js is still initializing; retry once all scripts are loaded.
window.addEventListener('load',()=>{
 if(location.hash==='#journal')renderKolhozJournal().catch(console.error);
},{once:true});

// While the general journal remains open, refresh new staff documents periodically.
setInterval(()=>{
 const pane=document.getElementById('journal');
 if(pane&&!pane.hidden)renderKolhozJournal().catch(console.error);
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
