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
async function planGuestFetch(action,extra={},isClaim=false){
  const {deviceId,token}=planGuestStored();
  if(!isClaim && (!deviceId||!token))throw new Error('Сначала подключите MAIN с помощью кода из программы на компьютере');
  const headers={'Content-Type':'application/json','apikey':SUPABASE_KEY};
  if(!isClaim){
    headers['x-device-id']=deviceId;
    headers['x-browser-token']=token;
  }
  const rsp=await fetch(planGuestApi,{method:'POST',headers,body:JSON.stringify({action,...extra}),cache:'no-store'});
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
    if(el)el.value='';
    planBridgeStatus('MAIN подключён к этому браузеру. Теперь можно запросить Excel.');
    await planBridgeDeviceStatus();
  }catch(e){planBridgeStatus('Ошибка подключения: '+(e.message||e),true)}
}
function planBridgeDisconnect(){
  localStorage.removeItem('pomogator_guest_device_id');
  localStorage.removeItem('pomogator_guest_browser_token');
  planBridgeBytes=null;
  const download=document.getElementById('planBridgeDownloadBtn');
  if(download)download.hidden=true;
  const preview=document.getElementById('planBridgePreview');if(preview)preview.textContent='';
  const device=document.getElementById('planBridgeDevice');if(device)device.textContent='MAIN не подключён в этом браузере.';
  planBridgeStatus('Привязка из браузера очищена. Для повторного подключения нужен код MAIN.');
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
function planBridgeTomorrow() {
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(new Date());
  const get=t=>Number(p.find(x=>x.type===t)?.value);
  const d=new Date(Date.UTC(get('year'),get('month')-1,get('day')+1));
  return {day:String(d.getUTCDate()).padStart(2,'0'),month:String(d.getUTCMonth()+1).padStart(2,'0'),year:String(d.getUTCFullYear())};
}
function planBridgePreview(arraybuffer) {
  if(typeof XLSX==='undefined')throw new Error('Модуль Excel не загружен');
  const book=XLSX.read(arraybuffer,{type:'array',cellStyles:true});
  const target=planBridgeTomorrow();
  const expected=target.day+'.'+target.month;
  const sheet=book.SheetNames.find(name=>name.includes(expected)||name.includes(target.day+'/'+target.month));
  const el=document.getElementById('planBridgePreview');
  if(!sheet) {
    el.textContent='Excel получен. Лист на '+expected+' не найден. Вкладки: '+book.SheetNames.join(', ')+'.';
    return;
  }
  const ws=book.Sheets[sheet];
  const range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;
  const rows=range?range.e.r-range.s.r+1:0;
  const cols=range?range.e.c-range.s.c+1:0;
  el.textContent='Excel получен. Вкладка на завтра: «'+sheet+'». Размер: '+rows+' строк, '+cols+' столбцов. Обработка голубого столбца и распределение блюд пока не включены — сначала проверяем передачу исходного файла.';
}
function planBridgeDownload() {
  if(!planBridgeBytes)return;
  const blob=new Blob([planBridgeBytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=planBridgeFileName;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function planBridgeRequest() {
  if(planBridgeBusy)return;
  planBridgeBusy=true;
  const btn=document.getElementById('planBridgeRequestBtn');
  if(btn)btn.disabled=true;
  planBridgeBytes=null;
  document.getElementById('planBridgeDownloadBtn').hidden=true;
  document.getElementById('planBridgePreview').textContent='';
  try {
    planBridgeStatus('Отправляю запрос на компьютер MAIN…');
    const job=await planBridgeCall('request');
    for(let attempt=0;attempt<35;attempt++){
      const r=await planBridgeCall('status',{job_id:job.job_id});
      if(r.status==='failed')throw new Error('MAIN: '+(r.error||'Ошибка чтения файла'));
      if(r.status==='completed') {
        planBridgeStatus('Файл получен. Проверяю содержимое Excel…');
        const response=await fetch(r.download_url,{cache:'no-store'});
        if(!response.ok)throw new Error('Не удалось скачать полученный Excel');
        planBridgeBytes=await response.arrayBuffer();
        planBridgeFileName='ПЛАН ПРОИЗВОДСТВА.xlsx';
        document.getElementById('planBridgeDownloadBtn').hidden=false;
        planBridgePreview(planBridgeBytes);
        planBridgeStatus('Готово: исходный Excel получен с MAIN. В iiko ничего не передавалось.');
        await planBridgeDeviceStatus();
        return;
      }
      planBridgeStatus(r.status==='processing'?'MAIN читает и передаёт Excel…':'Ожидаю ответа MAIN…');
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
  const btn=document.querySelector("#home button[onclick=\"show('iiko')\"]");
  if(btn)btn.addEventListener('click',()=>setTimeout(planBridgeDeviceStatus,200));
  planBridgeDeviceStatus();
});
