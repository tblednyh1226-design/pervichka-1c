/* MAIN → Помогатор: manual raw Excel transport only; no iiko writes. */
let planBridgeBytes = null;
let planBridgeFileName = 'ПЛАН ПРОИЗВОДСТВА.xlsx';
let planBridgeBusy = false;
function planBridgeStatus(message, bad) {
  const el = document.getElementById('planBridgeStatus');
  if (el) { el.textContent=message; el.style.color=bad?'#b42318':''; }
}
async function planBridgeCall(action,extra={}) {
  const session = (await sb.auth.getSession()).data.session;
  if(!session) throw new Error('Войдите в Помогатор');
  if(!workspace?.id) throw new Error('Рабочее пространство ещё не загружено');
  const rsp = await fetch(SUPABASE_URL+'/functions/v1/plan-bridge',{
    method:'POST',
    headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({action,workspace_id:workspace.id,...extra}),
    cache:'no-store'
  });
  const json = await rsp.json().catch(()=>({ok:false,error:'Ошибка ответа сервера'}));
  if(!rsp.ok || !json.ok) throw new Error(json.error||('Ошибка сервера '+rsp.status));
  return json;
}
async function planBridgeDeviceStatus() {
  try {
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
async function planBridgePair() {
  try {
    const r=await planBridgeCall('create_pair');
    document.getElementById('planBridgeCode').textContent=r.code;
    planBridgeStatus('Введи код в INSTALL_MAIN.cmd на компьютере MAIN. Код действует 10 минут.');
  }catch(e){planBridgeStatus('Ошибка: '+(e.message||e),true)}
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
});
