/* MAIN → Помогатор: manual raw Excel transport only; no iiko writes. */
let planBridgeBytes = null;
let planBridgeFileName = 'ПЛАН ПРОИЗВОДСТВА.xlsx';
let planBridgeBusy = false;
function planBridgeStatus(message, bad) {
  const el = document.getElementById('planBridgeStatus');
  if (el) { el.textContent=message; el.style.color=bad?'#b42318':''; }
}
const planGuestApi=SUPABASE_URL+'/functions/v1/plan-bridge-guest';
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
async function planGuestFetch(action,extra={},isClaim=false){
  const {deviceId,token}=planGuestStored();
  if(!isClaim && (!deviceId||!token))throw new Error('Сначала подключите MAIN с помощью кода из программы на компьютере');
  const headers={'Content-Type':'application/json','apikey':SUPABASE_KEY};
  if(!isClaim){
    headers['x-device-id']=deviceId;
    headers['x-browser-token']=token;
  }
  // The request API must never leave the UI stuck indefinitely on "Отправляю запрос".
  const timeoutMs=action==='request'?12000:20000;
  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(),timeoutMs);
  let rsp;
  try{
    rsp=await fetch(planGuestApi,{
      method:'POST',headers,body:JSON.stringify({action,...extra}),
      cache:'no-store',signal:controller.signal
    });
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Сервер не ответил за '+(timeoutMs/1000)+' секунд. MAIN мог уже получить задание. Нажми «Открыть последний готовый файл», чтобы проверить результат без повторного запроса.');
    throw e;
  }finally{clearTimeout(timeoutId)}
  const json=await rsp.json().catch(()=>({ok:false,error:'Ошибка ответа сервера'}));
  if(!rsp.ok||!json.ok)throw new Error(json.error||('Ошибка сервера '+rsp.status));
  return json;
}
async function planBridgeCall(action,extra={}){ return planGuestFetch(action,extra); }
async function planBridgePair(){
  const el=document.getElementById('planBridgeCodeInput');
  const token=String(el?.value||'').replace(/[\s-]/g,'').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(token)){planBridgeStatus('Введите 32-символьный код, который показал установщик на MAIN.',true);return;}
  try{
    planBridgeStatus('Проверяю код MAIN…');
    const r=await planGuestFetch('claim',{browser_token:token},true);
    localStorage.setItem('pomogator_guest_device_id',r.device_id);
    localStorage.setItem('pomogator_guest_browser_token',token);
    if(el){el.value=token;el.type='password';}
    planBridgeRefreshSavedCode();
    planBridgeStatus('MAIN подключён. Код сохранён на этом устройстве и восстановится при следующем открытии Помогатора.');
    if(typeof iikoDraftLoadMappings==='function')await iikoDraftLoadMappings();
    await planBridgeDeviceStatus();
  }catch(e){planBridgeStatus('Ошибка подключения: '+(e.message||e),true)}
}
function planBridgeDisconnect(){
  if(!window.confirm('Забыть сохранённый 32-символьный код MAIN на этом устройстве и отключить доступ к файлу?'))return;
  localStorage.removeItem('pomogator_guest_device_id');
  localStorage.removeItem('pomogator_guest_browser_token');
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
  try {
    if(!planGuestStored().token){const el=document.getElementById('planBridgeDevice');if(el)el.textContent='MAIN не подключён. Введите код, который покажет установщик на MAIN.';return;}
    const r=await planBridgeCall('device_status');
    const el=document.getElementById('planBridgeDevice');
    if(!el)return;
    if(!r.device) {
      el.textContent='Компьютер MAIN ещё не подключён.';
    }else if(r.device.last_seen_at && Date.now()-Date.parse(r.device.last_seen_at)<120000) {
      el.textContent='MAIN подключён и на связи.';
    } else {
      el.textContent='MAIN зарегистрирован, но сейчас не отвечает. Проверьте, включён ли компьютер.';
    }
  }catch(e){
    const el=document.getElementById('planBridgeDevice');
    if(el)el.textContent='Не удалось проверить связь: '+(e.message||e);
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
async function planBridgeImportDownload(url,label){
  if(!url)throw Error('Сервер не предоставил адрес Excel.');
  planBridgeStatus('Скачиваю Excel с сервера…');
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw Error('Не удалось скачать Excel: HTTP '+response.status);
  planBridgeBytes=await response.arrayBuffer();
  planBridgeFileName='ПЛАН ПРОИЗВОДСТВА.xlsx';
  const download=document.getElementById('planBridgeDownloadBtn');
  if(download)download.hidden=false;
  planBridgeStatus('Excel скачан ('+(planBridgeBytes.byteLength/1048576).toFixed(1)+' МБ). Открываю выбранный день…');
  await new Promise(resolve=>setTimeout(resolve,0));
  planBridgePreview(planBridgeBytes);
  planBridgeStatus(label+' В iiko ничего не передавалось.');
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
    planBridgeStatus('Ищу последний готовый файл на сервере. Новый запрос к MAIN не создаю…');
    const latest=await planBridgeCall('latest');
    if(!latest.available)throw Error('На сервере пока нет готового файла от MAIN.');
    const finished=latest.finished_at?new Date(latest.finished_at)
      .toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hour12:false}):'время не указано';
    await planBridgeImportDownload(latest.download_url,'Открыт последний готовый файл MAIN от '+finished+' (Москва).');
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
    planBridgeStatus('Создаю задание на сервере (ответ до 12 секунд)…');
    const job=await planBridgeCall('request');
    planBridgeStatus('Задание создано. Жду выполнения на MAIN…');
    for(let attempt=0;attempt<35;attempt++){
      const r=await planBridgeCall('status',{job_id:job.job_id});
      if(r.status==='failed')throw new Error('MAIN: '+(r.error||'Ошибка чтения файла'));
      if(r.status==='completed'){
        await planBridgeImportDownload(r.download_url,'Готово: свежий Excel получен с MAIN.');
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
