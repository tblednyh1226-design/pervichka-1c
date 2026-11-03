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
async function renderKolhozJournal(){
 const dest=document.getElementById('kolhozUnifiedJournal');
 if(!dest)return;
 dest.textContent='Загружаю списания «Колхоза»…';
 let cloud=[],warning='';
 try{
  const {data:{session},error:authError}=await sb.auth.getSession();
  if(!authError&&session){
   const r=await sb.from('kolhoz_writeoffs')
    .select('id,doc_date,shift,warehouse,status,items,created_at,updated_at')
    .eq('organization_id',GENERAL_KOLHOZ_ORG_ID).order('created_at',{ascending:false}).limit(100);
   if(r.error)throw r.error;
   cloud=(r.data||[]).map(d=>({...d,_storage:'cloud'}));
   const staff=await sb.from('kolhoz_staff_writeoffs')
    .select('id,doc_date,shift,warehouse,status,items,created_at,updated_at')
    .eq('organization_id',GENERAL_KOLHOZ_ORG_ID).order('created_at',{ascending:false}).limit(100);
   if(staff.error)throw staff.error;
   cloud.push(...(staff.data||[]).map(d=>({...d,_storage:'staff'})));
  }
 }catch(e){warning='Не удалось получить облачные списания: '+(e.message||e)}
 const rows=[...generalJournalLocalWriteoffs(),...cloud];
 const unique=[...new Map(rows.map(x=>[x.id,x])).values()];
 unique.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
 if(!unique.length){
  dest.innerHTML='<p class="muted">Списаний пока нет.'+(warning?'<span> '+esc(warning)+'</span>':'')+'</p>';
  return;
 }
 dest.innerHTML=unique.map(d=>{
  const count=Array.isArray(d.items)?d.items.filter(x=>String(x.name||'').trim()).length:0;
  const title='Списание · '+generalJournalDate(d.doc_date)+' · '+esc(d.warehouse||'Склад не указан');
  const label=d._storage==='staff'?'Сотрудники Колхоза':d._storage==='local'?'Этот браузер':'Общий журнал';
  const link='./writeoffs.html?'+(d._storage==='staff'?'staffdoc=':'writeoff=')+encodeURIComponent(d.id);
  const status=d.status==='submitted'?'Отправлено':'Черновик';
  return '<div class="orgrow">'
   +'<span><b>'+title+'</b>'
   +'<small>'+esc(status)+' · '+esc(d.shift||'Без смены')+' · '+count+' поз. · '+label+'</small>'
   +'</span><a class="journal-link" href="'+link+'">Открыть / Печать</a>'
   +'</div>';
 }).join('')+(warning?'<p class="muted">'+esc(warning)+'</p>':'');
}
