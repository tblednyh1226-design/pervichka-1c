/* MAIN → Помогатор: manual raw Excel transport only; no iiko writes. */
let planBridgeBytes = null;
let planBridgeFileName = 'ПЛАН ПРОИЗВОДСТВА.xlsx';
let planBridgeBusy = false;
function planBridgeStatus(message, bad) {
  const el = document.getElementById('planBridgeStatus');
  if (el) { el.textContent=message; el.style.color=bad?'#b42318':''; }
}
const planGuestApi=SUPABASE_URL+'/functions/v1/plan-bridge-guest';
const planGuestBackupApi='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-main-plan-relay';
const planGuestBackupKey='sb_publishable_rcvNssgN4_dPnVUpjU0bjQ_1cEWsA52';
let planGuestPreferredRoute='primary';
function planGuestStored(){
  const deviceId=localStorage.getItem('pomogator_guest_device_id')||'';
  const token=localStorage.getItem('pomogator_guest_browser_token')||'';
  return {deviceId,token};
}
function planBridgeRefreshSavedCode(){
  const saved=planGuestStored();
  const hasCode=Boolean(saved.deviceId&&/^[0-9a-f]{32}$/i.test(saved.token));
  const status=document.getElementById('planBridgeSavedCode');
  if(status)status.textContent=hasCode
    ?'Код MAIN сохранён на этом устройстве. После обновления страницы вводить его заново не нужно.'
    :'Код пока не сохранён. Введите 32 символа и нажмите «Подключить MAIN».';
  const reveal=document.getElementById('planBridgeShowCodeBtn');
  if(reveal){
    reveal.disabled=!hasCode;
    const input=document.getElementById('planBridgeCodeInput');
    reveal.textContent=input?.type==='text'?'Скрыть код':'Показать код';
  }
}
function planBridgeRestoreSavedCode(){
  const saved=planGuestStored();
  const el=document.getElementById('planBridgeCodeInput');
  // Existing successful pairings are already stored locally; restore them visually.
  if(el&&saved.deviceId&&/^[0-9a-f]{32}$/i.test(saved.token)){
    el.value=saved.token;
    el.type='password';
  }
  planBridgeRefreshSavedCode();
}
function planBridgeToggleCodeVisibility(){
  const el=document.getElementById('planBridgeCodeInput');
  if(!el)return;
  el.type=el.type==='password'?'text':'password';
  planBridgeRefreshSavedCode();
}
// Two independent Supabase endpoints. Read-only calls can be tried on both:
// never retry uncertain job creation or iiko document submissions.
const planGuestReadActions=new Set(['device_status','latest','status','iiko_map_list']);
const planGuestIdempotentActions=new Set(['claim','iiko_map_save','iiko_map_delete']);
const planGuestInflightReads=new Map();
const planGuestTimeoutMs={primary:30000,relay:45000,request:45000,download:120000};
async function planGuestTransport(route,action,extra={},isClaim=false,download=false,externalSignal=null){
  const {deviceId,token}=planGuestStored();
  if(!isClaim&&(!deviceId||!token))
    throw Error('Сначала подключите MAIN с помощью кода из программы на компьютере');
  const headers={'Content-Type':'application/json',
    'apikey':route==='relay'?planGuestBackupKey:SUPABASE_KEY};
  if(!isClaim){headers['x-device-id']=deviceId;headers['x-browser-token']=token}
  const timeoutMs=download?planGuestTimeoutMs.download:
    action==='request'?planGuestTimeoutMs.request:planGuestTimeoutMs[route];
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(externalSignal?.aborted)cancel();
  else externalSignal?.addEventListener?.('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    // Keep the timeout active until the ENTIRE response body is read, not
    // merely until headers arrive (important for large XLSX files).
    let response;
    try{
      response=await fetch(route==='relay'?planGuestBackupApi:planGuestApi,{
        method:'POST',headers,body:JSON.stringify({action,...extra}),
        cache:'no-store',signal:controller.signal
      });
      if(download){
        if(!response.ok)throw Error('Excel недоступен (HTTP '+response.status+')');
        return await response.arrayBuffer();
      }
      const result=await response.json().catch(()=>({ok:false,error:'Некорректный ответ сервера'}));
      if(!response.ok||!result.ok)
        throw Error(result.error||'Ошибка сервера (HTTP '+response.status+')');
      return result;
    }catch(e){
      if(controller.signal.aborted||e?.name==='AbortError'){
        const problem=new Error('Сервер не ответил за '+Math.round(timeoutMs/1000)+' секунд');
        problem.planTransport=true;throw problem;
      }
      if(e instanceof TypeError||/failed to fetch|networkerror|load failed/i.test(String(e.message||''))){
        const problem=new Error('Сетевое соединение прервалось: '+String(e.message||e));
        problem.planTransport=true;throw problem;
      }
      throw e;
    }
  }finally{
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort',cancel);
  }
}
// Race the primary/backup for READS, starting the second shortly after the
// first. A temporarily slow server no longer forces a 30+45 second serial
// wait, nor does a failed backup become permanently preferred.
async function planGuestReadRace(action,extra={},download=false){
 const first=planGuestPreferredRoute;
 const second=first==='primary'?'relay':'primary';
 const controllers={primary:new AbortController(),relay:new AbortController()};
 let winner='';
 const run=async(route)=>{
   const result=await planGuestTransport(route,action,extra,false,download,controllers[route].signal);
   if(!winner){
     winner=route;planGuestPreferredRoute=route;
     controllers[route==='primary'?'relay':'primary'].abort();
   }
   return result;
 };
 const a=run(first);
 const b=new Promise((resolve,reject)=>{
   setTimeout(()=>{
     if(winner){resolve(null);return;}
     run(second).then(resolve,reject);
   },1300);
 });
 try{return await Promise.any([a,b])}
 catch(error){
   const failures=error?.errors||[error];
   const detail=failures.map((e,i)=>
     (i===0?(first==='primary'?'Основной':'Резервный'):
       (second==='primary'?'Основной':'Резервный'))+': '+String(e.message||e)).join('; ');
   const combined=new Error('Оба канала недоступны. '+detail);
   combined.planTransport=failures.some(x=>x?.planTransport);
   throw combined;
 }
}
async function planGuestFetch(action,extra={},isClaim=false){
 if(planGuestReadActions.has(action)){
   const key=action+':'+JSON.stringify(extra);
   if(planGuestInflightReads.has(key))return planGuestInflightReads.get(key);
   const promise=(async()=>{
     const started=Date.now();
     try{return await planGuestReadRace(action,extra)}
     catch(error){
       // One safe retry after a FAST transient network failure. Never retry
       // after lengthy timeouts; never issue the same CREATE request twice.
       if(!error.planTransport||Date.now()-started>15000)throw error;
       await new Promise(resolve=>setTimeout(resolve,1100));
       return await planGuestReadRace(action,extra);
     }
   })();
   planGuestInflightReads.set(key,promise);
   try{return await promise}
   finally{
     if(planGuestInflightReads.get(key)===promise)planGuestInflightReads.delete(key);
   }
 }
 const route=planGuestPreferredRoute;
 try{return await planGuestTransport(route,action,extra,isClaim)}
 catch(e){
   if(!e.planTransport)throw e;
   if(action==='request')
     throw Error('Связь оборвалась при создании задания. Повторно его автоматически не отправляю, чтобы не создать дубль. Проверьте «Открыть последний готовый файл».');
   if(!planGuestIdempotentActions.has(action))throw e;
   // Pairing and mapping upserts/deletions are idempotent; job creation isn't.
   const other=route==='primary'?'relay':'primary';
   try{
     const result=await planGuestTransport(other,action,extra,isClaim);
     planGuestPreferredRoute=other;
     return result;
   }catch(otherError){
     throw Error('Не удалось связаться с MAIN. Первый канал: '+
       String(e.message||e)+'; второй: '+String(otherError.message||otherError));
   }
 }
}
async function planBridgeCall(action,extra={}){ return planGuestFetch(action,extra); }
// A browser can be paired to an obsolete MAIN record. Do not queue new jobs
// until the paired MAIN has actually reported its own heartbeat.
async function planGuestCheckConnection(requireOnline=false){
 const {deviceId,token}=planGuestStored();
 if(!deviceId||!/^[0-9a-f]{32}$/i.test(String(token||'')))
   throw Error('Этот браузер не подключён к MAIN. Во вкладке «Акт приготовления» введите действующий код MAIN и нажмите «Подключить MAIN».');
 const response=await planGuestFetch('device_status');
 const last=response?.device?.last_seen_at||'';
 const lastMillis=last?Date.parse(last):NaN;
 const online=Number.isFinite(lastMillis)&&Date.now()-lastMillis<180000&&Date.now()-lastMillis>-60000;
 if(requireOnline&&!online){
   if(!last)throw Error('Браузер подключён к старой регистрации MAIN, которая ни разу не выходила на связь. Подключите действующий код MAIN во вкладке «Акт приготовления».');
   throw Error('Этот MAIN сейчас не отвечает. Проверьте агент на основном компьютере. Если он работает — браузер, возможно, подключён к старому MAIN. Переподключите действующий код.');
 }
 return {online,last,device:response?.device||null};
}
// Both tabs use the same verified download mechanism: authenticated edge relay
// first, a freshly signed direct storage URL only as fallback.
async function planGuestDownloadExcel(url,jobId,statusCallback){
 if(!jobId)throw Error('MAIN не указал номер задания для получения Excel.');
 const status=typeof statusCallback==='function'?statusCallback:()=>{};
 let relayError='';
 try{
   status('Скачиваю Excel через основной и резервный каналы MAIN (до 120 секунд)…');
   const data=await planGuestReadRace('download',{job_id:jobId},true);
   if(data.byteLength<4||new Uint8Array(data,0,2).some((v,i)=>v!==[80,75][i]))
     throw Error('Сервер вернул не Excel (XLSX).');
   return data;
 }catch(e){relayError=String(e.message||e);}
 try{
   status('Каналы MAIN не ответили. Пробую прямую ссылку на готовый Excel…');
   // Refresh URL: its signature expires, especially after a long relay timeout.
   let direct=url;
   try{
     const job=await planGuestFetch('status',{job_id:jobId});
     if(job?.status==='completed'&&job.download_url)direct=job.download_url;
   }catch(_){}
   if(!direct)throw Error('Ссылка на файл отсутствует');
   const u=new URL(direct);
   if(u.protocol!=='https:'||u.hostname!=='dwdunpyzcfdwokoczenl.supabase.co'||
      !u.pathname.includes('/storage/v1/object/sign/'))
     throw Error('Неверный адрес Excel на сервере');
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),120000);
   try{
     const response=await fetch(u.href,{cache:'no-store',signal:controller.signal});
     if(!response.ok)throw Error('HTTP '+response.status);
     const data=await response.arrayBuffer();
     if(data.byteLength<4||new Uint8Array(data,0,2).some((v,i)=>v!==[80,75][i]))
       throw Error('Получен не файл XLSX');
     return data;
   }finally{clearTimeout(timeout)}
 }catch(e){
   throw Error('Оба канала скачивания недоступны. Резервный: '+relayError+
     '; прямой: '+String(e.message||e)+'. Файл на MAIN сохранён, повторно создавать его не нужно.');
 }
}
async function planBridgePair(){
  const el=document.getElementById('planBridgeCodeInput');
  const token=String(el?.value||'').replace(/[\s-]/g,'').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(token)){planBridgeStatus('Введите 32-символьный код, который показал установщик на MAIN.',true);return;}
  try{
    planBridgeStatus('Проверяю код MAIN…');
    const previousDevice=planGuestStored().deviceId;
    const r=await planGuestFetch('claim',{browser_token:token},true);
    localStorage.setItem('pomogator_guest_device_id',r.device_id);
    localStorage.setItem('pomogator_guest_browser_token',token);
    if(el){el.value=token;el.type='password';}
    planBridgeRefreshSavedCode();
    planBridgeStatus('MAIN подключён. Код сохранён на этом устройстве и восстановится при следующем открытии Помогатора.');
    if(previousDevice!==r.device_id){
      // Do not reuse the previous MAIN's iiko catalogue or paired lookups.
      if(typeof iikoLiveState!=='undefined'){
        iikoLiveState.connected=false;iikoLiveState.mainDevice='';
      }
      if(typeof transferLive!=='undefined'){
        transferLive.connected=false;
        transferLive.catalog=[];transferLive.catalogById.clear();transferLive.stores=[];
      }
      if(typeof iikoDraftState!=='undefined'){
        iikoDraftState.catalog=new Map();iikoDraftState.catalogList=[];iikoDraftState.catalogCount=0;
      }
    }
    if(typeof iikoDraftLoadMappings==='function')await iikoDraftLoadMappings();
    if(typeof productionDocuments!=='undefined'&&productionDocuments.length&&
       typeof transferConnect==='function')void transferConnect();
    else if(typeof morningState!=='undefined'&&morningState.result&&
       typeof iikoLiveEnsureCatalog==='function')void iikoLiveEnsureCatalog();
    await planBridgeDeviceStatus();
  }catch(e){planBridgeStatus('Ошибка подключения: '+(e.message||e),true)}
}
function planBridgeDisconnect(){
  if(!window.confirm('Забыть сохранённый 32-символьный код MAIN на этом устройстве и отключить доступ к файлу?'))return;
  localStorage.removeItem('pomogator_guest_device_id');
  localStorage.removeItem('pomogator_guest_browser_token');
  if(typeof iikoLiveState!=='undefined'){iikoLiveState.connected=false;iikoLiveState.mainDevice=''}
  if(typeof transferLive!=='undefined'){
    transferLive.connected=false;transferLive.catalog=[];transferLive.catalogById.clear();transferLive.stores=[];
  }
  if(typeof iikoDraftState!=='undefined'){
    iikoDraftState.catalog=new Map();iikoDraftState.catalogList=[];iikoDraftState.catalogCount=0;
  }
  planBridgeBytes=null;
  const codeInput=document.getElementById('planBridgeCodeInput');
  if(codeInput){codeInput.value='';codeInput.type='password';}
  planBridgeRefreshSavedCode();
  if(typeof iikoDraftLoadMappings==='function')iikoDraftLoadMappings();
  const download=document.getElementById('planBridgeDownloadBtn');
  if(download)download.hidden=true;
  const preview=document.getElementById('planBridgePreview');if(preview)preview.textContent='';
  const device=document.getElementById('planBridgeDevice');if(device)device.textContent='MAIN не подключён в этом браузере.';
  planBridgeStatus('Код удалён с этого устройства. Для повторного подключения нужен код с MAIN.');
}
async function planBridgeDeviceStatus() {
 const el=document.getElementById('planBridgeDevice');
 if(el)el.textContent='Проверяю MAIN через основной и резервный серверы (ожидание до 45 секунд)…';
 try{
   const result=await planGuestCheckConnection(false);
   const message=result.online?'MAIN на связи через '+(planGuestPreferredRoute==='relay'?'резервный':'основной')+' сервер. Файл можно получить.':
     !result.last?'Это подключение MAIN ни разу не выходило на связь. Возможно, сохранён старый код. Введите действующий код MAIN и переподключитесь.':
     'MAIN по сохранённому коду сейчас не отвечает. Если агент MAIN работает, обновите код подключения.';
   if(el)el.textContent=message;
   return result;
 }catch(e){
   if(el)el.textContent='Не удалось проверить MAIN: '+String(e.message||e);
   return null;
 }
}
function planBridgePreview(arraybuffer) {
  if(typeof XLSX==='undefined')throw new Error('Модуль Excel не загружен');
  // The 8 MB plan contains 75+ tabs. Parse only the chosen day, not every sheet.
  const book=morningPrepareFromBytes(arraybuffer,'План производства с MAIN');
  const target=typeof morningSelectedDate==='function'?morningSelectedDate():morningTomorrowMoscow();
  const el=document.getElementById('planBridgePreview');
  const formatted=target.day+'.'+target.month+'.'+target.year;
  let sheet;
  try{
    sheet=typeof morningDateBook==='function'?morningDateBook(book,target):
      book.SheetNames.find(name=>name.includes(target.day+'.'+target.month));
  }catch(e){
    el.textContent='Исходный Excel получен, но за '+formatted+' лист не найден: '+(e.message||e);
    return;
  }
  if(!sheet) {
    el.textContent='Исходный Excel получен, но лист за '+formatted+' отсутствует.';
    return;
  }
  const ws=book.Sheets[sheet];
  const range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;
  const rows=range?range.e.r-range.s.r+1:0;
  const cols=range?range.e.c-range.s.c+1:0;
  el.textContent='Исходный Excel получен. Лист за '+formatted+': «'+sheet+'». Размер: '+rows+' строк, '+cols+' столбцов. Акты за эту дату — в блоке ниже.';
}
function planBridgeDownload() {
  if(!planBridgeBytes)return;
  const blob=new Blob([planBridgeBytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=planBridgeFileName;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function planBridgeImportDownload(url,label,jobId){
  if(!url||!jobId)throw Error('Сервер не предоставил адрес и номер Excel.');
  const bytes=await planGuestDownloadExcel(url,jobId,text=>planBridgeStatus(text));
  // The downloaded file remains available even if the chosen date cannot be
  // parsed; never confuse a sheet-selection error with a failed download.
  planBridgeBytes=bytes;
  planBridgeFileName='ПЛАН ПРОИЗВОДСТВА.xlsx';
  const download=document.getElementById('planBridgeDownloadBtn');
  if(download)download.hidden=false;
  planBridgeStatus('Excel получен ('+(bytes.byteLength/1048576).toFixed(1)+' МБ). Открываю выбранный день…');
  await new Promise(resolve=>setTimeout(resolve,0));
  try{
    planBridgePreview(bytes);
    planBridgeStatus(label+' В iiko ничего не передавалось.');
  }catch(e){
    planBridgeStatus('Excel с MAIN получен и доступен для скачивания, но выбранный день не прочитан: '+
      String(e.message||e)+'. Выберите другой лист/дату, не создавая повторного задания.',true);
  }
}
async function planBridgeLoadLatest(){
  if(planBridgeBusy)return;
  planBridgeBusy=true;
  const btn=document.getElementById('planBridgeLatestBtn');
  if(btn)btn.disabled=true;
  planBridgeBytes=null;
  if(typeof morningState!=='undefined'){morningState.book=null;morningState.bytes=null;morningState.result=null;}
  if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Загружаю последний готовый Excel. Предыдущие акты сняты с подготовки.');
  const download=document.getElementById('planBridgeDownloadBtn');
  if(download)download.hidden=true;
  const preview=document.getElementById('planBridgePreview');
  if(preview)preview.textContent='';
  try{
    planBridgeStatus('Проверяю основной и резервный серверы. Ищу последний готовый Excel без нового задания…');
    const latest=await planBridgeCall('latest');
    if(!latest.available){
      const connected=await planGuestCheckConnection(false);
      throw Error(!connected.last?
        'Сохранённый код относится к регистрации MAIN без файлов и без подключений. Переподключите действующий код MAIN.':
        'У этого подключения MAIN нет готовых файлов. Если другой MAIN уже создал Excel, переподключите его действующий код.');
    }
    const finished=latest.finished_at?new Date(latest.finished_at)
      .toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hour12:false}):'время не указано';
    await planBridgeImportDownload(latest.download_url,'Открыт последний готовый файл MAIN от '+finished+' (Москва).',latest.job_id);
  }catch(e){planBridgeStatus('Ошибка получения готового файла: '+(e.message||e),true)}
  finally{planBridgeBusy=false;if(btn)btn.disabled=false;}
}
async function planBridgeRequest() {
  if(planBridgeBusy)return;
  planBridgeBusy=true;
  const btn=document.getElementById('planBridgeRequestBtn');
  if(btn)btn.disabled=true;
  planBridgeBytes=null;
  // A fresh MAIN request replaces the old plan; do not keep previous acts exportable if it fails.
  if(typeof morningState!=='undefined'){morningState.book=null;morningState.bytes=null;morningState.result=null;}
  if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Запросили новый план с MAIN. Предыдущая проверка снята.');
  document.getElementById('planBridgeDownloadBtn').hidden=true;
  document.getElementById('planBridgePreview').textContent='';
  try {
    planBridgeStatus('Проверяю действующее подключение MAIN…');
    await planGuestCheckConnection(true);
    planBridgeStatus('Создаю задание на сервере (ответ до 12 секунд)…');
    const job=await planBridgeCall('request');
    planBridgeStatus('Задание создано. Жду выполнения на MAIN…');
    for(let attempt=0;attempt<35;attempt++){
      const r=await planBridgeCall('status',{job_id:job.job_id});
      if(r.status==='failed')throw new Error('MAIN: '+(r.error||'Ошибка чтения файла'));
      if(r.status==='completed'){
        await planBridgeImportDownload(r.download_url,'Готово: свежий Excel получен с MAIN.',job.job_id);
        await planBridgeDeviceStatus();
        return;
      }
      planBridgeStatus(r.status==='processing'?'MAIN читает и передаёт Excel…':'Задание в очереди MAIN. Жду ответа…');
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw new Error('MAIN не ответил за время проверки. Попробуй позже; запрос остался в очереди.');
  }catch(e){
    planBridgeStatus('Ошибка: '+(e.message||e),true);
  }finally{
    planBridgeBusy=false;
    if(btn)btn.disabled=false;
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  planBridgeRestoreSavedCode();
  const btn=document.querySelector("#home button[onclick=\"show('iiko')\"]");
  if(btn)btn.addEventListener('click',()=>setTimeout(planBridgeDeviceStatus,200));
  planBridgeDeviceStatus();
});
