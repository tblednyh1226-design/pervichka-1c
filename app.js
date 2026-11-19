const SUPABASE_URL='https://dwdunpyzcfdwokoczenl.supabase.co';
const SUPABASE_KEY='sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let registerMode=false,workspace=null,baseRow=null,orgs=[],activeOrgId=null;

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function toggleAuth(){registerMode=!registerMode;authtitle.textContent=registerMode?'Регистрация':'Вход';authnamewrap.hidden=!registerMode;document.querySelector('#authgate .primary').textContent=registerMode?'Создать аккаунт':'Войти';document.querySelector('#authgate .linkbtn').textContent=registerMode?'У меня уже есть аккаунт':'Создать аккаунт';autherror.textContent=''}
async function authSubmit(){const email=authemail.value.trim().toLowerCase(),password=authpass.value,name=authname.value.trim();autherror.textContent='';if(!email||!password){autherror.textContent='Введите email и пароль.';return}try{if(registerMode){const {data,error}=await sb.auth.signUp({email,password,options:{data:{name:name||email}}});if(error)throw error;if(!data.session){autherror.textContent='Аккаунт создан. Подтвердите email по письму и затем войдите.';return}}else{const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error}await startApp()}catch(e){autherror.textContent=(e.message==='Invalid login credentials'?'Неверный email или пароль. Проверьте данные или восстановите пароль.':(e.message||'Не удалось выполнить вход.'))}}
async function resetPassword(){const email=authemail.value.trim().toLowerCase();if(!email){autherror.textContent='Введите email, затем нажмите «Забыли пароль?»';return}autherror.textContent='Отправляю письмо…';const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});autherror.textContent=error?'Не удалось отправить письмо: '+error.message:'Письмо для восстановления пароля отправлено. Проверьте почту.'}
async function logout(){await sb.auth.signOut();location.reload()}
async function ensureWorkspace(user){const wk='pervichka_workspace_v1';try{const cached=JSON.parse(localStorage.getItem(wk)||'null');if(cached?.id)workspace=cached}catch(_){}let {data,error}=await sb.from('workspace_members').select('workspace_id,role,workspaces(id,name,seat_limit,status)').eq('user_id',user.id).limit(1);if(error){if(workspace)return;throw error}if(!data.length){const name=user.user_metadata?.name||user.email||'Моё рабочее пространство';const r=await sb.rpc('create_workspace',{p_name:name});if(r.error)throw r.error;({data,error}=await sb.from('workspace_members').select('workspace_id,role,workspaces(id,name,seat_limit,status)').eq('user_id',user.id).limit(1));if(error)throw error}workspace=data[0].workspaces;localStorage.setItem(wk,JSON.stringify(workspace));const b=await sb.from('one_c_bases').select('id,workspace_id,name').eq('workspace_id',workspace.id).order('created_at').limit(1).maybeSingle();baseRow=b.data||null}
async function startApp(){const {data:{session}}=await sb.auth.getSession();authgate.hidden=true;if(!session){document.body.classList.add('guest-mode');const note=document.getElementById('guestNote');if(note)note.hidden=false;if(location.hash==='#journal')show('journal');return;}document.body.classList.remove('guest-mode');const wk='pervichka_workspace_v1';try{const cached=JSON.parse(localStorage.getItem(wk)||'null');if(cached?.id){workspace=cached;const oc=JSON.parse(localStorage.getItem('pervichka_orgs_'+cached.id)||'[]');if(Array.isArray(oc)&&oc.length){orgs=oc;activeOrgId=localStorage.getItem('pervichka_active_org_v2');if(!orgs.some(x=>x.id===activeOrgId))activeOrgId=orgs[0].id;renderOrgs()}}}catch(_){}try{await ensureWorkspace(session.user);await loadOrgs();if(location.hash==='#journal')show('journal');renderAccount().catch(console.error);renderDirs().catch(console.error)}catch(e){console.error(e);if(location.hash==='#journal')show('journal');if(!orgs.length)console.warn('Ошибка загрузки данных: '+(e.message||e))}}
async function renderAccount(){workspaceName.textContent=workspace.name;planName.textContent=workspace.seat_limit+' '+(workspace.seat_limit===1?'пользователь':'пользователей');const {data,error}=await sb.from('workspace_members').select('user_id,role').eq('workspace_id',workspace.id);if(error)throw error;seatUsage.textContent=data.length+' из '+workspace.seat_limit;seatbadge.textContent=data.length+'/'+workspace.seat_limit+' мест';seatcount.value=String(workspace.seat_limit);userslist.innerHTML=data.map((u,i)=>'<div class="orgrow"><span><b>'+(i===0?'Владелец':'Пользователь')+'</b><small>'+esc(u.role)+'</small></span></div>').join('')}
async function changeSeats(){const n=Number(seatcount.value),r=await sb.rpc('set_seat_limit',{p_workspace_id:workspace.id,p_limit:n});if(r.error){alert(r.error.message);seatcount.value=String(workspace.seat_limit);return}workspace.seat_limit=n;await renderAccount()}
function inviteUser(){inviteMsg.textContent='Приглашения сотрудников подключим следующим шагом: сначала создаётся защищённая учётная запись сотрудника, затем она привязывается к вашему рабочему пространству.'}
async function loadOrgs(){const cacheKey='pervichka_orgs_'+workspace.id;try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'[]');if(Array.isArray(cached)&&cached.length){orgs=cached;activeOrgId=localStorage.getItem('pervichka_active_org_v2');if(!orgs.some(x=>x.id===activeOrgId))activeOrgId=orgs[0]?.id||null;renderOrgs()}}catch(_){}const r=await sb.from('organizations').select('id,name,inn,workspace_id,base_id,created_at').eq('workspace_id',workspace.id).order('created_at');if(r.error)throw r.error;orgs=r.data;localStorage.setItem(cacheKey,JSON.stringify(orgs));activeOrgId=localStorage.getItem('pervichka_active_org_v2');if(!orgs.some(x=>x.id===activeOrgId))activeOrgId=orgs[0]?.id||null;renderOrgs()}
function renderOrgs(){org.innerHTML='';if(!orgs.length)org.innerHTML='<option value="">Организация не добавлена</option>';else orgs.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name;org.appendChild(o)});if(activeOrgId)org.value=activeOrgId;org.onchange=()=>{activeOrgId=org.value;localStorage.setItem('pervichka_active_org_v2',activeOrgId);renderDirs()};orglist.innerHTML=orgs.length?orgs.map(x=>'<div class="orgrow"><span><b>'+esc(x.name)+'</b><small>'+(x.inn?'ИНН '+esc(x.inn):'ИНН не указан')+'</small></span><button onclick="deleteOrg(\''+x.id+'\')">Удалить</button></div>').join(''):'<p class="muted">Пока ни одной организации.</p>'}
function openOrgForm(){orgmodal.hidden=false;orgname.value='';orginn.value='';orgerror.textContent='';setTimeout(()=>orgname.focus(),50)}function closeOrgForm(){orgmodal.hidden=true}
let orgSaving=false;async function saveOrgForm(){if(orgSaving)return;const name=orgname.value.trim(),inn=orginn.value.trim();if(!name){orgerror.textContent='Введите название организации.';return}orgSaving=true;const btn=document.querySelector('#orgmodal .primary');btn.disabled=true;btn.textContent='Сохраняю…';orgerror.textContent='';try{if(!baseRow?.id){const br=await sb.from('one_c_bases').select('id,workspace_id,name').eq('workspace_id',workspace.id).order('created_at').limit(1).maybeSingle();if(br.error)throw br.error;baseRow=br.data}if(!baseRow?.id)throw new Error('Не найден технический профиль рабочего пространства');const r=await sb.from('organizations').insert({workspace_id:workspace.id,base_id:baseRow.id,name,inn:inn||null}).select().single();if(r.error){if(r.error.code==='23505'){await loadOrgs();const existing=orgs.find(x=>x.name.trim().toLowerCase()===name.toLowerCase()&&(x.inn||'')===(inn||''));if(existing){activeOrgId=existing.id;localStorage.setItem('pervichka_active_org_v2',activeOrgId);closeOrgForm();renderOrgs();return}}throw r.error}activeOrgId=r.data.id;localStorage.setItem('pervichka_active_org_v2',activeOrgId);closeOrgForm();await loadOrgs();await renderDirs()}catch(e){console.error(e);orgerror.textContent='Не удалось сохранить: '+(e.message||e)}finally{orgSaving=false;btn.disabled=false;btn.textContent='Сохранить'}}
async function deleteOrg(id){const x=orgs.find(o=>o.id===id);if(!x||!confirm('Удалить организацию «'+x.name+'» и связанные с ней данные?'))return;const r=await sb.from('organizations').delete().eq('id',id);if(r.error){alert(r.error.message);return}if(activeOrgId===id)activeOrgId=null;await loadOrgs();await renderDirs()}
const HOME_TABS={novikova:['homeTabNovikova','homePanelNovikova'],kolhoz:['homeTabKolhoz','homePanelKolhoz'],other:['homeTabOther','homePanelOther']};
function switchHomeTab(tab,remember=true){
  const selected=Object.prototype.hasOwnProperty.call(HOME_TABS,tab)?tab:'novikova';
  for(const [name,[buttonId,panelId]] of Object.entries(HOME_TABS)){
    const button=document.getElementById(buttonId),panel=document.getElementById(panelId);
    if(!button||!panel)continue;
    const active=name===selected;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
    panel.hidden=!active;
  }
  if(remember){try{localStorage.setItem('pervichka_home_tab_v1',selected)}catch(_){}}
}
document.addEventListener('DOMContentLoaded',()=>{
  let saved='novikova';
  try{saved=localStorage.getItem('pervichka_home_tab_v1')||'novikova'}catch(_){}
  switchHomeTab(saved,false);
  const tabs=document.querySelector('.home-tabs');
  if(tabs)tabs.addEventListener('keydown',(event)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const names=Object.keys(HOME_TABS),current=names.findIndex(n=>document.getElementById(HOME_TABS[n][0])===document.activeElement);
    if(current<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?names.length-1:(current+(event.key==='ArrowRight'?1:-1)+names.length)%names.length;
    switchHomeTab(names[next]);
    document.getElementById(HOME_TABS[names[next]][0])?.focus();
  });
});
function show(id){
 const section=document.getElementById(id);
 if(!section||!section.matches('main>section'))return;
 document.querySelectorAll('main>section').forEach(x=>x.hidden=true);
 section.hidden=false;
 scrollTo(0,0);
 if(id==='journal'){
  if(location.hash!=='#journal')history.replaceState(null,'','#journal');
  renderJournal().catch(e=>{
   console.error('Ошибка журнала документов',e);
   const target=document.getElementById('journalDocumentsList');
   if(target)target.textContent='Ошибка загрузки документов: '+(e.message||e);
  });
  if(typeof renderKolhozJournal==='function'){
   renderKolhozJournal().catch(e=>{
    console.error('Ошибка журнала списаний',e);
    const target=document.getElementById('kolhozUnifiedJournal');
    if(target)target.textContent='Не удалось загрузить списания: '+(e.message||e);
   });
  }else{
   const target=document.getElementById('kolhozUnifiedJournal');
   if(target)target.textContent='Модуль журнала списаний не загружен. Обновите страницу.';
  }
 }else if(id==='home'&&location.hash==='#journal')history.replaceState(null,'',location.pathname+location.search);
 if(id==='dirs'){
  activeOrgId=org.value||activeOrgId;
  if(activeOrgId)localStorage.setItem('pervichka_active_org_v2',activeOrgId);
  dirstored.innerHTML='<p class="muted">Загружаю номенклатуру…</p>';
  renderDirs().catch(e=>{console.error(e);dirstored.innerHTML='<p class="muted">Ошибка загрузки справочника: '+esc(e.message||e)+'</p>'});
 }
}
document.getElementById('doc').addEventListener('change',e=>{const fs=[...e.target.files];docname.textContent=fs.length?(fs.length===1?'Выбран: '+fs[0].name:'Выбрано документов: '+fs.length+' — '+fs.map(f=>f.name).join(', ')):'Файлы ещё не выбраны'});
async function uploadDocuments(){activeOrgId=org.value||activeOrgId;const files=[...doc.files];if(!activeOrgId){docstatus.textContent='Сначала выберите организацию.';return}if(!files.length){docstatus.textContent='Выберите фото или PDF накладной.';return}const btn=document.getElementById('docuploadbtn');btn.disabled=true;const rows=files.map(f=>({f,state:'Ожидает загрузки'}));const paint=()=>docstatus.innerHTML=rows.map(x=>'<div class="uploadrow"><b>'+esc(x.f.name)+'</b><span>'+esc(x.state)+'</span></div>').join('');paint();try{const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Сессия истекла. Войдите снова.');for(const x of rows){x.state='Подготавливаю загрузку…';paint();const pr=await fetch(SUPABASE_URL+'/functions/v1/prepare-document-upload',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({organization_id:activeOrgId,filename:x.f.name})});const p=await pr.json();if(!pr.ok||!p.ok)throw new Error(p.error||'Не удалось подготовить загрузку');x.state='Загружается…';paint();const up=await sb.storage.from('document-files').uploadToSignedUrl(p.path,p.token,x.f,{contentType:x.f.type||'application/octet-stream'});if(up.error)throw new Error(up.error.message);x.state='Файл загружен';paint();const ins=await sb.from('documents').insert({workspace_id:p.workspace_id,organization_id:activeOrgId,doc_type:'purchase_invoice',status:'Требует проверки',source_file_name:x.f.name,storage_path:p.path,recognition_status:'queued',diagnostic_message:'Файл сохранён. Ожидает распознавания.',created_by:session.user.id}).select('id').single();if(ins.error)throw new Error(ins.error.message);x.state='✓ Загружен · ожидает распознавания';paint()}recognition.hidden=false;rlines.innerHTML='<tr><td colspan="6" class="muted">Файлы загружены. Здесь появятся распознанные строки накладной.</td></tr>';await renderJournal()}catch(e){console.error(e);const x=rows.find(r=>!r.state.startsWith('✓'));if(x)x.state='Ошибка: '+(e.message||e);paint()}finally{btn.disabled=false}}
let journalDocumentsRequest=0;
async function renderJournal(){
 const el=document.getElementById('journalDocumentsList')||document.querySelector('#journal .empty');
 if(!el)return;
 const request=++journalDocumentsRequest;
 const organizationId=document.getElementById('org')?.value||activeOrgId;
 if(!organizationId){el.textContent='Выберите организацию для просмотра её документов.';return}
 el.textContent='Загружаю документы…';
 try{
  const token=await journalAccessToken();
  if(request!==journalDocumentsRequest)return;
  if(!token){el.textContent='Для просмотра документов войдите в свой аккаунт Помогатора.';return}
  const {rows}=await kolhozJournalRead('documents',token,{organizationId});
  if(request!==journalDocumentsRequest)return;
  el.innerHTML=rows.length?rows.map(d=>'<div class="orgrow"><span><b>'+esc(d.source_file_name||'Документ')+'</b><small>'+esc(d.status)+' · '+esc(d.recognition_status||'')+' · '+new Date(d.created_at).toLocaleString('ru-RU')+'</small></span></div>').join(''):'Документов пока нет.';
 }catch(e){
  if(request!==journalDocumentsRequest)return;
  el.textContent=e?.message||'Не удалось загрузить документы.';
  const retry=document.createElement('button');
  retry.type='button';retry.textContent='Повторить загрузку документов';
  retry.addEventListener('click',renderJournal);
  el.append(document.createElement('br'),retry);
 }
}
const dirMap={'Номенклатура':'nomenclature','Поставщики':'suppliers','Склады':'warehouses','Единицы измерения':'units','Договоры':'contracts'};
async function renderDirs(){activeOrgId=org.value||activeOrgId;if(!activeOrgId){dirstored.innerHTML='<p class="muted">Сначала добавьте организацию.</p>';return}const [ri,rn]=await Promise.all([sb.from('directory_imports').select('*').eq('organization_id',activeOrgId).order('imported_at',{ascending:false}),sb.from('nomenclature').select('code,article,name,unit,vat_rate,group_name,is_active').eq('organization_id',activeOrgId).order('name')]);if(ri.error||rn.error){dirstored.innerHTML='<p class="muted">'+esc((ri.error||rn.error).message)+'</p>';return}const imports=ri.data||[],items=rn.data||[];let h=imports.length?'<h3>Загружено для этой организации</h3>'+imports.map(d=>'<div class="orgrow"><span><b>'+esc(d.directory_type)+'</b><small>'+esc(d.file_name)+' · '+new Date(d.imported_at).toLocaleString('ru-RU')+'</small></span></div>').join(''):'<p class="muted">Для выбранной организации справочники ещё не загружены.</p>';if(items.length){h+='<div class="preview"><h3>Номенклатура — '+items.length+' поз.</h3><div class="tablewrap"><table class="nomtable"><thead><tr><th>Код</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th>НДС</th><th>Группа</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+esc(x.code||'')+'</td><td><b>'+esc(x.name)+'</b></td><td>'+esc(x.article||'')+'</td><td>'+esc(x.unit||'')+'</td><td>'+esc(x.vat_rate==null?'':x.vat_rate+'%')+'</td><td>'+esc(x.group_name||'')+'</td></tr>').join('')+'</tbody></table></div></div>'}dirstored.innerHTML=h}
async function demoImport(){const f=dirfile.files[0];if(!activeOrgId){importstatus.textContent='Сначала добавьте организацию.';return}if(!f){importstatus.textContent='Сначала выберите файл.';return}const ext=(f.name.split('.').pop()||'').toLowerCase();if(!['mxl','xlsx','xls','csv'].includes(ext)){importstatus.textContent='Поддерживаются MXL, XLSX, XLS и CSV.';return}const btn=document.querySelector('#dirs .primary');btn.disabled=true;btn.textContent='Загружаю…';importstatus.textContent='Передаю файл на сервер…';try{const fd=new FormData();fd.append('file',f);fd.append('organization_id',activeOrgId);fd.append('directory_type',dirMap[dirtype.value]);const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Сессия истекла. Войдите снова.');const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),30000);let res;try{res=await fetch(SUPABASE_URL+'/functions/v1/upload-directory',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY},body:fd,signal:ctl.signal})}finally{clearTimeout(timer)}let data;try{data=await res.json()}catch(_){throw new Error('Сервер вернул ответ '+res.status)}if(!res.ok||!data?.ok)throw new Error(data?.error||('Ошибка сервера '+res.status));importstatus.textContent=data.saved>0?'Готово: из MXL распознано и сохранено позиций: '+data.saved+'.':'Файл загружен, но номенклатура автоматически не определена. Строк в MXL: '+(data.row_count||0)+'.';dirfile.value='';await renderDirs();if(data.preview?.length){const rows=data.preview.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('');dirstored.insertAdjacentHTML('afterbegin','<div class="preview"><h3>Предпросмотр MXL</h3><div class="tablewrap"><table>'+rows+'</table></div></div>')}}catch(e){console.error(e);importstatus.textContent='Ошибка загрузки: '+(e.message||e)}finally{btn.disabled=false;btn.textContent='Сохранить справочник'}}
document.addEventListener('DOMContentLoaded',startApp);
sb.auth.onAuthStateChange((_event,session)=>{if(!session){authgate.hidden=true;document.body.classList.add('guest-mode')}});

const ORDER_POINTS=[['Просвещение 80','просвещение 80'],['Просвещение 69','просвещение 69'],['Орджоникидзе','орджоникидзе'],['Петровский','петровский'],['Шувалова','шувалова'],['Ленинский 82','ленинский 82'],['Коваленко','коваленко'],['Индустриальный 34','индустриальный 34'],['Булима','ип булима']];
let preparedOrders=[];
function normOrderText(v){return String(v??'').trim().toLowerCase().replace(/ё/g,'е')}
function safeOrderName(v){return String(v).replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_')}
function excelOrderDate(v,fallback){if(v instanceof Date&&!isNaN(v))return v;if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(d)return new Date(d.y,d.m-1,d.d)}return fallback}
function orderDateFromFilename(name){const m=String(name).match(/(\d{1,2})[.\-_](\d{1,2})(?:[.\-_](\d{2,4}))?/);if(!m)return new Date();let y=m[3]?Number(m[3]):new Date().getFullYear();if(y<100)y+=2000;return new Date(y,Number(m[2])-1,Number(m[1]))}
function fmtOrderDate(d){return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+d.getFullYear()}
// Prefer the current flexible header format, with the former point names
// available for report headers that wrap or omit the usual prefix.
const LEGACY_ORDER_POINTS=['Просвещение 80','Просвещение 69','Орджоникидзе','Петровский','Шувалова','Ленинский 82','Коваленко','Индустриальный 34','Булима'];
const orderHeaderText=value=>String(value??'').trim().replace(/\s+/g,' ');
const isOrderQuantityHeader=t=>/^заказ(?:$|[\s:–—-])/iu.test(t);
const isOrderAuxiliaryHeader=t=>/^(?:выпуск|сумма|итого|остаток|цена|отгрузка|возврат|списание|поставщик)(?:$|[\s:–—(-])/iu.test(t);
const isOrderBuyerHeader=t=>/^(?:ип|ооо|ао|пао|самозанятый|покупатель|контрагент)(?:$|[\s:–—-])/iu.test(t)||/^индивидуальный предприниматель(?:$|\s)/iu.test(t);
function orderColumnName(col){
 let name='';
 for(let n=col+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
 return name;
}
function orderPointName(value){
 const name=orderHeaderText(value).replace(/^заказ(?:$|[\s:–—-]+)/iu,'').trim();
 if(!name||isOrderAuxiliaryHeader(name)||isOrderBuyerHeader(name)||/^[\d\s.,]+$/.test(name))return '';
 if(/^\([^)]*\)$/.test(name))return '';
 const clean=name.replace(/\s*\(([^)]*)\)\s*$/u,(full,inner)=>isOrderBuyerHeader(inner.trim())||!/\d/.test(inner)?'':full)
  .replace(/\s*[,;–—-]?\s+(?:ип|ооо|ао|пао)\s+.*$/iu,'').trim();
 const t=normOrderText(clean);
 if(!clean||/^(?:точка|название точки|адрес|заказы|покупателя|покупателей|номенклатура|наименование|кол(?:ичество|-во)|розница|на выпуск)$/iu.test(clean))return '';
 const known=LEGACY_ORDER_POINTS.find(label=>t===normOrderText(label));
 if(known)return known;
 if(t==='коваленкова')return 'Коваленко';
 return clean;
}
function looksLikeBuyerName(name){
 if(LEGACY_ORDER_POINTS.includes(name))return false;
 return /^(?:[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+)$/u.test(name)
  || (!/\s/u.test(name)&&/(?:ов[а]?|ев[а]?|ин[а]?|ын[а]?|енко|ян|ский|ская|чук|юк)$/iu.test(name));
}
function isOrderHeaderBand(row){
 if(!Array.isArray(row)||orderSection(row))return false;
 if(normOrderText(row[0])==='элемент номенклатуры')return true;
 const name=normOrderText(row[1]);
 if(name&&!/^(?:наименование(?: продукции)?|номенклатура|элемент номенклатуры|продукция|товар|название|точка|адрес|покупатель|контрагент|заказчик)$/iu.test(name))return false;
 return !row.slice(2).some(v=>typeof v==='number'&&Number.isFinite(v));
}
function readOrderHeader(rows,ri,merges){
 const row=rows[ri];
 const getName=(r,c)=>{
  const direct=orderHeaderText(rows[r]?.[c]);
  if(direct)return direct;
  const merge=merges.find(m=>m.s.r<=r&&m.e.r>=r&&m.s.c<=c&&m.e.c>=c&&m.s.c>=4);
  return merge?orderHeaderText(rows[merge.s.r]?.[merge.s.c]):'';
 };
 if(!isOrderHeaderBand(row))return new Map();
 const t0=normOrderText(row[0]),t1=normOrderText(row[1]);
 const productHeader=t0==='элемент номенклатуры'||/^(?:наименование(?: продукции)?|номенклатура|элемент номенклатуры|продукция|товар|название)$/iu.test(t1);
 const orderLine=row.slice(4).some(v=>isOrderQuantityHeader(orderHeaderText(v)));
 const neighbor=[];
 for(const direction of [-1,1]){
  for(let i=ri+direction;Math.abs(i-ri)<=3&&i>=0&&i<rows.length;i+=direction){
   if(!isOrderHeaderBand(rows[i]))break;
   neighbor.push(i);
  }
 }
 const otherOrderLine=neighbor.some(r=>rows[r].slice(4).some(v=>isOrderQuantityHeader(orderHeaderText(v))));
 const labeledBuyer=t0.match(/^(?:покупатель|контрагент|заказчик)$/u)||t1.match(/^(?:покупатель|контрагент|заказчик)$/u);
 if(labeledBuyer||(!orderLine&&!productHeader&&otherOrderLine))return new Map();
 const width=Math.max(row.length,...neighbor.map(i=>rows[i].length));
 const found=new Map();
 for(let col=4;col<width;col++){
  const raw=orderHeaderText(row[col]);
  if(isOrderAuxiliaryHeader(raw))continue;
  const cells=[{r:ri,text:raw},...neighbor.map(r=>({r,text:getName(r,col)}))];
  const explicit=isOrderQuantityHeader(raw);
  const titled=raw&&orderPointName(raw);
  const neighborAux=cells.slice(1).some(c=>isOrderAuxiliaryHeader(c.text));
  const buyerCell=cells.map(c=>c.text.replace(/^заказ(?:$|[\s:–—-]+)/iu,'').trim())
   .find(text=>isOrderBuyerHeader(text)||/\((?:ип|ооо|ао|пао)\s/iu.test(text));
  const legacy=titled&&LEGACY_ORDER_POINTS.includes(titled);
  const buyerPaired=raw&&!!buyerCell&&!isOrderBuyerHeader(raw)&&!looksLikeBuyerName(titled);
  if(!explicit&&(!raw||neighborAux||!(legacy||buyerPaired)))continue;
  const fromPointRow=cells.slice(1).filter(c=>!isOrderQuantityHeader(c.text)&&!isOrderAuxiliaryHeader(c.text))
   .map(({r,text})=>({name:orderPointName(text),labeled:/^(?:точка|название точки|адрес|магазин|склад)$/iu.test(orderHeaderText(rows[r]?.[0])||orderHeaderText(rows[r]?.[1]))}))
   .filter(p=>p.name&&!looksLikeBuyerName(p.name));
  const basePoint=fromPointRow.find(p=>p.labeled)?.name
   || (titled&&!looksLikeBuyerName(titled)?titled:'')
   || fromPointRow[0]?.name || '';
  const buyer=buyerCell?.match(/\(([^)]*)\)/u)?.[1]||(buyerCell&&isOrderBuyerHeader(buyerCell)?buyerCell:'')||(basePoint==='Булима'?'ИП Булима':'');
  found.set(col,{col,basePoint,buyer});
 }
 return found;
}
function orderSectionName(value){
 return normOrderText(value).replace(/\s+/g,' ').replace(/^категория\s*:\s*/,'').replace(/[«»"]/g,'').trim();
}
function orderSection(row){
 const cells=row.slice(0,2).map(v=>String(v??'').trim());
 for(const cell of cells){
  const s=orderSectionName(cell);
  if(s==='пекарня'||s==='выпечка'||s==='хлебобулочные изделия')return 'bakery';
  if(s==='кулинария япония'||s==='япония')return 'japan';
  if(s.includes('кондитерские изделия')&&(/^категория\s*:/i.test(cell)||/^кондитерские изделия$/.test(s)))return 'confectionery';
  if(/^категория\s*:/i.test(cell)||s==='кулинария')return 'main';
 }
 return null;
}
function isExcludedOrderRoll(name){
 return /(?:^|[^\p{L}\p{N}])ролл(?:ы|а|ов|ами|ом|ам|ах|е|у)?(?=$|[^\p{L}\p{N}])/iu.test(name);
}
function isExcludedOrderSoySauce(name){
 const words=normOrderText(name).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 return /(?:^| )(?:соевый соус|соус соевый)(?=$| )/u.test(words);
}
function orderNumber(value){
 if(typeof value==='number')return value;
 if(typeof value!=='string')return NaN;
 const cleaned=value.trim().replace(/[ \u00a0\u202f]/g,'').replace(',','.');
 return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cleaned)?Number(cleaned):NaN;
}
function collectCustomerOrderRows(sheets,fallbackDate){
 const main=Object.create(null),conf=Object.create(null),points=new Map();
 const bakeryFromMain=new Set();
 let sawColumns=false;
 let skippedBakerySheet=false;
 function registerPoint(meta,sheet,si){
  const axis=normOrderText(meta.basePoint);
  const slot=orderColumnName(meta.col);
  const known=axis?points.get(JSON.stringify([axis,meta.col])):null;
  const matches=si>0&&axis?[...points.values()].filter(p=>p.axis===axis&&p.si===0):[];
  if(si>0&&matches.length===1)return matches[0];
  const key=JSON.stringify(axis?[axis,meta.col]:['',si,meta.col]);
  if(known||points.has(key))return known||points.get(key);
  const basePoint=meta.basePoint||'';
  const point={key,axis,basePoint,slot,si,sheetName:sheet.name||'',name:basePoint||'Столбец '+slot};
  points.set(key,point);
  return point;
 }
 for(const [si,sheet] of sheets.entries()){
  let section=sheet.bakery?'bakery':'main';
  let cols=new Map();
  for(const [ri,row] of sheet.rows.entries()){
   if(!Array.isArray(row))continue;
   const header=readOrderHeader(sheet.rows,ri,sheet.merges||[]);
   if(header.size){
    cols=new Map([...header].map(([col,meta])=>{
     const previous=cols.get(col);
     if(previous&&!meta.basePoint)meta={...meta,basePoint:previous.basePoint,buyer:meta.buyer||previous.buyer};
     return [col,{...meta,point:registerPoint(meta,sheet,si)}];
    }));
    sawColumns=true;
    continue;
   }
   if(normOrderText(row[0])==='элемент номенклатуры')continue;
   const hasQty=[...cols.keys()].some(col=>Number.isFinite(orderNumber(row[col]))&&orderNumber(row[col])!==0);
   const tag=!hasQty?orderSection(row):null;
   if(tag){section=tag;continue}
   if(section==='japan'||!hasQty)continue;
   const name=typeof row[1]==='string'?row[1].trim():'';
   if(!name||isExcludedOrderRoll(name)||isExcludedOrderSoySauce(name))continue;
   for(const [col,{buyer,point}] of cols){
    const qty=orderNumber(row[col]);
    if(!Number.isFinite(qty)||qty===0)continue;
    const price=Number(row[2]),key=point.key;
    const item={name,qty,unit:row[3]??'',price:Number.isFinite(price)?price:'',date:fallbackDate,buyer:buyer.replace(/Гаюнова/gi,'Горюнова'),supplier:String(row[6]??'').trim(),point:point.name};
    if(section==='bakery'){
     const sig=JSON.stringify([key,normOrderText(name),qty,normOrderText(item.unit),item.price]);
     if(si===0)bakeryFromMain.add(sig);
     else if(bakeryFromMain.has(sig))continue;
    }
    const orders=section==='confectionery'?conf:main;
    (orders[key]??=[]).push(item);
   }
  }
  if(sheet.bakery&&!cols.size)skippedBakerySheet=true;
 }
 if(!sawColumns)throw new Error('Не найдены столбцы заказов точек. Проверьте заголовки «Заказ ...».');
 const used=[...points.values()].filter(p=>main[p.key]?.length||conf[p.key]?.length);
 const filenameCounts=new Map();
 for(const p of used){
  const nameKey=normOrderText(safeOrderName(p.name));
  filenameCounts.set(nameKey,(filenameCounts.get(nameKey)||0)+1);
 }
 for(const p of used){
  if(filenameCounts.get(normOrderText(safeOrderName(p.name)))>1)
   p.name+=(p.si===0?' · столбец '+p.slot:' · '+p.sheetName+' · столбец '+p.slot);
  for(const row of [...(main[p.key]||[]),...(conf[p.key]||[])])row.point=p.name;
 }
 return {main,conf,points:used,skippedBakerySheet,unknownPoints:used.filter(p=>!p.basePoint).map(p=>p.name)};
}
function buildOrderBook(rows){const aoa=rows.map(r=>[r.name,'',r.qty,r.unit,r.price,r.date]);const ws=XLSX.utils.aoa_to_sheet(aoa,{cellDates:true});ws['!cols']=[{wch:48},{wch:15},{wch:12},{wch:14},{wch:12},{wch:14}];for(let r=0;r<aoa.length;r++){const a=ws[XLSX.utils.encode_cell({r,c:5})];if(a)a.z='dd.mm.yyyy'}const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Заказ');return wb}
function downloadPreparedOrder(i){const x=preparedOrders[i];XLSX.writeFile(buildOrderBook(x.rows),x.filename,{compression:true})}
async function downloadAllPreparedOrders(){if(!preparedOrders.length)return;const btn=document.getElementById('ordersdownloadall');if(btn)btn.disabled=true;try{if(typeof JSZip==='undefined')throw new Error('Не загрузился модуль ZIP. Обновите страницу и повторите.');const zip=new JSZip();for(const x of preparedOrders){const data=XLSX.write(buildOrderBook(x.rows),{bookType:'xlsx',type:'array',compression:true});zip.file(x.filename,data)}const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Заказы_'+(preparedOrders[0].filename.match(/^\d{2}\.\d{2}\.\d{4}/)||['все'])[0]+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){ordersstatus.textContent='Ошибка скачивания архива: '+(e.message||e)}finally{if(btn)btn.disabled=false}}
async function processOrders(){
 const f=ordersfile.files[0];
 if(!f){ordersstatus.textContent='Выберите Excel с заказами.';return}
 ordersbtn.disabled=true;
 ordersstatus.textContent='Разбираю файл…';
 ordersresult.innerHTML='';
 try{
 const book=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});
 const sheets=book.SheetNames.map((name,index)=>({name,index,bakery:/^(пекарня|выпечка|хлебобулочные изделия)$/.test(orderSectionName(name))}))
  .filter(s=>s.index===0||s.bakery)
  .map(s=>{
   const sheet=book.Sheets[s.name];
   const range=sheet['!ref']?{s:{r:0,c:0},e:XLSX.utils.decode_range(sheet['!ref']).e}:undefined;
   return {...s,merges:sheet['!merges']||[],rows:XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,blankrows:true,range})};
  });
 const fallbackDate=orderDateFromFilename(f.name);
 const {main,conf,points,skippedBakerySheet,unknownPoints}=collectCustomerOrderRows(sheets,fallbackDate);
 preparedOrders=[];
 const add=(kind,point,rows,suffix,detail='')=>{
  if(!rows.length)return;
  const filename=fmtOrderDate(fallbackDate)+'_'+safeOrderName(point.name+(detail?' '+detail:''))+'_'+suffix+'.xlsx';
  preparedOrders.push({title:kind+' · '+point.name+(detail?' · '+detail:''),filename,rows});
 };
 for(const point of points)add('Основной',point,main[point.key]||[],'основной');
 for(const point of points){
  const items=conf[point.key]||[];
  if(point.basePoint==='Просвещение 80'){
   add('Кондитерский',point,items.filter(x=>normOrderText(x.name).includes('кулинария')),'кондитерский','Кулинария');
   add('Кондитерский',point,items.filter(x=>normOrderText(x.name).includes('ресторан')||['торт морковный ланч','торт медовик ланч','три шоколада ланч'].includes(normOrderText(x.name))),'кондитерский','Ресторан');
  }else add('Кондитерский',point,items,'кондитерский');
 }
 ordersstatus.textContent='Точки по столбцам Excel: '+points.map(p=>p.name+' ('+((main[p.key]||[]).length+(conf[p.key]||[]).length)+' поз.)').join('; ')+'. Япония, роллы и соевый соус исключены. Выпечка входит в основные заказы, кондитерка — отдельно.'+(unknownPoints.length?' Не найдены названия точек для: '+unknownPoints.join(', ')+'. Эти заказы оставлены отдельными файлами по столбцам.':'')+(skippedBakerySheet?' Не найдены столбцы заказов на листе выпечки.':'');
 ordersresult.innerHTML='<button id="ordersdownloadall" class="primary" onclick="downloadAllPreparedOrders()">Скачать все одним разом (ZIP)</button><div class="orderlist">'+preparedOrders.map((x,i)=>'<div class="orgrow"><span><b>'+esc(x.title)+'</b><small>'+x.rows.length+' поз. · '+x.rows.reduce((s,r)=>s+(Number(r.qty)||0)*(Number(r.price)||0),0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽</small></span><button class="orderdownload" onclick="downloadPreparedOrder('+i+')">Скачать XLSX</button></div>').join('')+'</div>'}catch(e){console.error(e);ordersstatus.textContent='Ошибка: '+(e.message||e)}finally{ordersbtn.disabled=false}}
