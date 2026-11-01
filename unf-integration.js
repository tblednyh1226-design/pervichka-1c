"use strict";
const $=id=>document.getElementById(id);
const sb=supabase.createClient('https://dwdunpyzcfdwokoczenl.supabase.co','sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw');
const EDGE='https://dwdunpyzcfdwokoczenl.supabase.co/functions/v1/unf-odata-readonly';
let orgId=null,ready=false,busy=false,knownEntities=[],currentRequest=0;
function message(m,error=false){$('diagnostics').textContent=m;$('diagnostics').style.color=error?'#b42335':'';}
function escapeText(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function setBusy(v){busy=v;for(const id of ['statusBtn','probeBtn','sampleBtn'])$(id).disabled=v||!orgId||(id==='probeBtn'&&!ready)||(id==='sampleBtn'&&!ready||!$('documentEntity').value)}
async function invoke(action,extras={}){
 const {data:{session},error}=await sb.auth.getSession();
 if(error||!session)throw Error('Не выполнен вход в Помогатор. Откройте главную страницу и авторизуйтесь.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
 try{
  const response=await fetch(EDGE,{method:'POST',signal:controller.signal,headers:{
   'Authorization':'Bearer '+session.access_token,'apikey':'sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw','Content-Type':'application/json'
  },body:JSON.stringify({organization_id:orgId,action,...extras})});
  const payload=await response.json().catch(()=>({error:'Сервер вернул недопустимый ответ'}));
  if(!response.ok||!payload.ok)throw Error(payload.error||'Ошибка сервера '+response.status);
  return payload;
 }finally{clearTimeout(timer)}
}
async function init(){
 $('productionDate').value=new Date().toLocaleDateString('en-CA');
 setBusy(false);
 try{
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw Error('Для настройки API нужно войти в аккаунт Помогатора на главной странице.');
  const wr=await sb.from('workspace_members').select('workspace_id').eq('user_id',session.user.id);
  if(wr.error)throw wr.error;
  const workspaceSet=new Set((wr.data||[]).map(x=>x.workspace_id));
  if(!workspaceSet.size)throw Error('Рабочее пространство ещё не создано. Откройте главную страницу Помогатора.');
  const {data,error}=await sb.from('organizations').select('id,name,workspace_id').order('name');
  if(error)throw error;
  const org=(data||[]).find(x=>workspaceSet.has(x.workspace_id)&&/здобников/i.test(x.name));
  if(!org)throw Error('Не найдена организация ИП Здобниковой в вашем пространстве Помогатора.');
  orgId=org.id;$('orgStatus').textContent=org.name;
  message('Организация найдена. Проверяю наличие реквизитов API…');
  await unfStatus();
 }catch(e){message(e.message||String(e),true);$('orgStatus').textContent='Нет доступа'}
}
async function unfStatus(){
 if(!orgId)return;
 setBusy(true);try{
  const result=await invoke('status');
  ready=!!result.configured;
  $('setupStatus').textContent=ready?'Заданы серверные реквизиты API':'Ожидает настройки';
  $('connectionStatus').textContent='Ещё не проверено';
  message(result.message+(ready?'':('\nНе заданы: '+(result.missing||[]).join(', '))));
 }catch(e){ready=false;message(e.message||String(e),true)}
 finally{setBusy(false)}
}
async function unfProbe(){
 setBusy(true);message('Читаю список опубликованных объектов 1С. Никаких изменений в базе не выполняется…');
 try{
  const res=await invoke('probe');
  knownEntities=res.documents||[];
  $('connectionStatus').textContent='Доступен · только чтение';
  $('setupStatus').textContent='Настроено';
  message('Подключение успешно. Найдено документов: '+knownEntities.length+', справочников: '+(res.catalogs||[]).length+'.\n'+res.message);
  $('entities').innerHTML='<div class="tablewrap"><table><thead><tr><th>Тип</th><th>Объект OData в конфигурации</th></tr></thead><tbody>'+
   [...knownEntities.map(n=>['Документ',n]),...(res.catalogs||[]).map(n=>['Справочник',n])].map(([type,n])=>'<tr><td>'+escapeText(type)+'</td><td>'+escapeText(n)+'</td></tr>').join('')+'</tbody></table></div>';
  $('documentEntity').replaceChildren();
  const first=new Option('Выберите документ','');$('documentEntity').appendChild(first);
  const sorted=[...(res.candidates||[]),...knownEntities.filter(n=>!(res.candidates||[]).includes(n))];
  for(const n of sorted)$('documentEntity').appendChild(new Option(n,n));
  $('documentEntity').disabled=false;
  $('sample').textContent='';
 }catch(e){$('connectionStatus').textContent='Не подключено';message('Ошибка проверки: '+(e.message||e),true)}
 finally{setBusy(false)}
}
async function unfSample(){
 const entity=$('documentEntity').value;if(!entity)return;
 setBusy(true);message('Читаю заголовки 15 документов '+entity+'…');
 try{
  const res=await invoke('sample',{entity});
  const rows=res.rows||[];
  $('sample').innerHTML=rows.length?'<table><thead><tr><th>Дата</th><th>Номер</th><th>Проведён</th><th>Ссылка 1С</th></tr></thead><tbody>'+
   rows.map(x=>'<tr><td>'+escapeText(x.date)+'</td><td>'+escapeText(x.number)+'</td><td>'+(x.posted?'Да':'Нет')+'</td><td>'+escapeText(x.ref)+'</td></tr>').join('')+'</tbody></table>':'Документы этого вида не найдены.';
  message('Получены заголовки: '+res.count+'. '+res.message);
 }catch(e){message('Ошибка чтения документов: '+(e.message||e),true)}
 finally{setBusy(false)}
}
function unfClear(){
 knownEntities=[];$('entities').textContent='Для просмотра повторите проверку соединения.';
 $('sample').textContent='';$('documentEntity').replaceChildren();
 $('documentEntity').appendChild(new Option('Сначала проверьте соединение',''));$('documentEntity').disabled=true;
 $('connectionStatus').textContent='Не проверено';message('Результаты проверки очищены.');setBusy(false);
}
$('documentEntity').addEventListener('change',()=>setBusy(false));
init();