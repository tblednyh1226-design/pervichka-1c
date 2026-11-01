/* Production plan → iiko preparation; does not contact iiko or post documents. */
let productionBook=null,productionBytes=null,productionRows=[],productionDocuments=[],productionFileName='',productionSheetName='';
const productionSkip=/^(всего.*|итого.*|сумма.*|iiko|iiкo|айко|итого фасовка|вес|цена|разница|покупатели|№|наименование|меню)$/i;
const productionGroups=/^(холодные закуски|первые блюда|блюда для завтраков|вторые\s+блюда|гарниры|напитки|хлеб|дополнительный ассортимент|выпечка|комплексные обеды)$/i;
function productionNorm(v){return String(v??'').trim().replace(/\s+/g,' ').toLowerCase().replace(/ё/g,'е')}
function productionText(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function productionError(e){document.getElementById('prodstatus').textContent='Ошибка: '+(e.message||e)}
function productionInit(){
 const file=document.getElementById('prodfile');
 if(file&&!file.dataset.ready){file.dataset.ready='1';file.addEventListener('change',productionOpen)}
}
// Transfers have their own afternoon copy of the Excel plan.
// Never replace morningState or invalidate cooking-act iiko mappings here.
let productionMainBusy=false;
function productionClearSource(message){
 productionBook=null;productionBytes=null;productionRows=[];productionDocuments=[];
 productionFileName='';productionSheetName='';
 window.productionContext=null;
 const select=document.getElementById('prodsheet');
 if(select)select.innerHTML='<option value="">Загрузите отдельный план перемещений</option>';
 const recipients=document.getElementById('prodrecipients');
 if(recipients)recipients.innerHTML='';
 const result=document.getElementById('prodresult');
 if(result){result.hidden=true;result.innerHTML=''}
 const status=document.getElementById('prodstatus');
 if(status)status.textContent=message||'Для перемещений нужен отдельный Excel.';
}
function productionLoadIndependentBook(bytes,name){
 if(typeof XLSX==='undefined')throw Error('Модуль Excel не загружен');
 const previous=productionSheetName;
 const meta=XLSX.read(bytes,{type:'array',bookSheets:true});
 if(!meta.SheetNames?.length)throw Error('Excel не содержит листов');
 const select=document.getElementById('prodsheet');
 if(!select)throw Error('Поле даты не найдено');
 // Change only afternoon plan state, and only after validating the new workbook.
 productionBook={SheetNames:meta.SheetNames,Sheets:{}};
 productionBytes=bytes;
 productionFileName=name;
 select.innerHTML=meta.SheetNames.map((sheet,i)=>
   '<option value="'+i+'">'+productionText(sheet)+'</option>').join('');
 const prior=meta.SheetNames.indexOf(previous);
 // Prefer the same day as the morning plan, but NEVER reuse its bytes or worksheets.
 const morningSheet=typeof morningState!=='undefined'?morningState.result?.sheet:'';
 const matchedMorning=meta.SheetNames.indexOf(morningSheet);
 select.value=String(prior>=0?prior:matchedMorning>=0?matchedMorning:meta.SheetNames.length-1);
 productionSelectSheet();
 const status=document.getElementById('prodstatus');
 if(status)status.textContent='Отдельный план перемещений получен: '+name+
  '. Лист: '+productionSheetName+'. Выберите склад и получателей. Утренний план не изменён.';
}
async function productionOpen(){
 const file=document.getElementById('prodfile')?.files?.[0];
 if(!file||productionMainBusy)return;
 const status=document.getElementById('prodstatus');
 productionClearSource('Читаю отдельный Excel для перемещений…');
 try{
  const bytes=await file.arrayBuffer();
  productionLoadIndependentBook(bytes,file.name);
 }catch(e){
  productionClearSource('Ошибка нового плана перемещений: '+(e.message||e));
 }
}
async function productionMainDownload(url,jobId){
 if(!url||!jobId)throw Error('MAIN не выдал ссылку и номер задания для нового Excel');
 let response;
 if(planGuestPreferredRoute!=='relay'){
  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(),15000);
  try{
   response=await fetch(url,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('HTTP '+response.status);
  }catch(e){
   planGuestPreferredRoute='relay';
  }finally{clearTimeout(timeoutId)}
 }
 if(!response){
  const status=document.getElementById('prodstatus');
  if(status)status.textContent='Основное хранилище недоступно. Скачиваю новый план через резервный сервер…';
  response=await planGuestTransport('relay','download',{job_id:jobId},false,true);
 }
 const bytes=await response.arrayBuffer();
 if(!bytes.byteLength)throw Error('Получен пустой Excel');
 return bytes;
}
async function productionMainRequest(){
 if(productionMainBusy)return;
 if(typeof planGuestFetch!=='function'||typeof planGuestTransport!=='function')
  throw Error('Модуль подключения MAIN не загружен');
 if(typeof planBridgeBusy!=='undefined'&&planBridgeBusy){
  document.getElementById('prodstatus').textContent='Идёт утренний запрос MAIN. Дождитесь окончания перед загрузкой файла для перемещений.';
  return;
 }
 productionMainBusy=true;
 const button=document.getElementById('prodRequestMainBtn');
 if(button)button.disabled=true;
 productionClearSource('Создаю НОВОЕ задание MAIN для перемещений. Утренний файл и акты не изменяются…');
 try{
  const job=await planGuestFetch('request');
  if(!job?.job_id)throw Error('MAIN не вернул номер нового задания');
  for(let attempt=0;attempt<35;attempt++){
   const r=await planGuestFetch('status',{job_id:job.job_id});
   if(r.status==='failed')throw Error('MAIN: '+(r.error||'не удалось подготовить Excel'));
   if(r.status==='completed'){
    const status=document.getElementById('prodstatus');
    if(status)status.textContent='Новый Excel для перемещений готов. Скачиваю…';
    const bytes=await productionMainDownload(r.download_url,job.job_id);
    productionLoadIndependentBook(bytes,'План перемещений с MAIN.xlsx');
    return;
   }
   const status=document.getElementById('prodstatus');
   if(status)status.textContent=r.status==='processing'?
     'MAIN читает обновлённый план перемещений…':
     'Новое задание для перемещений в очереди MAIN…';
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error('MAIN ещё не подготовил файл. Задание осталось в очереди. Не создавайте повторное без проверки.');
 }catch(e){
  productionClearSource('Не удалось получить отдельный план для перемещений: '+(e.message||e));
 }finally{
  productionMainBusy=false;
  if(button)button.disabled=false;
 }
}
function productionSelectSheet(){
 if(!productionBook)return;
 const i=Number(document.getElementById('prodsheet').value);
 productionSheetName=productionBook.SheetNames[i];
 if(!productionSheetName)throw Error('Выберите лист Excel.');
 if(!productionBook.Sheets[productionSheetName]){
   if(!productionBytes)throw Error('Исходный Excel не загружен.');
   const selected=XLSX.read(productionBytes,{
     type:'array',sheets:productionSheetName,cellDates:true,cellStyles:false,
     cellFormula:false,cellHTML:false,cellText:false
   });
   if(!selected.Sheets?.[productionSheetName])throw Error('Не удалось открыть лист '+productionSheetName);
   productionBook.Sheets[productionSheetName]=selected.Sheets[productionSheetName];
 }
 productionRows=XLSX.utils.sheet_to_json(productionBook.Sheets[productionSheetName],{header:1,defval:'',raw:true});
 const header=productionRows.findIndex(row=>productionNorm(row[0])==='№'&&productionNorm(row[1])==='наименование');
 if(header<0)throw Error('Не найдена строка заголовков (№ / Наименование)');
 const heads=productionRows[header];
 const options=heads.map((v,col)=>({name:String(v??'').trim(),col})).filter(x=>x.name&&x.col>=4&&!productionSkip.test(x.name));
 window.productionContext={header,heads,options};
 const container=document.getElementById('prodrecipients');
 container.innerHTML=options.map((o,k)=>{
  const isShop=/правд|бухар|бестуж|модул|мега|этм|редм|мед экспресс/i.test(o.name);
  return '<div class="orgrow"><span><b>'+productionText(o.name)+'</b><small>Столбец '+(o.col+1)+'</small></span><select data-col="'+o.col+'" aria-label="Роль '+productionText(o.name)+'"><option value="point" '+(isShop?'selected':'')+'>Получатель перемещения</option><option value="ignore" '+(!isShop?'selected':'')+'>Не учитывать</option></select></div>'
 }).join('');
 productionDocuments=[];document.getElementById('prodresult').innerHTML='';document.getElementById('prodresult').hidden=true;
 document.getElementById('prodstatus').textContent='Лист: '+productionSheetName+'. Укажите склад-отправитель и получателей, затем сформируйте черновики перемещений.';
}
function productionQuantity(v){
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 const raw=String(v??'').trim().replace(/\s/g,'').replace(',','.');
 if(!raw||!/^\d+(?:\.\d+)?$/.test(raw))return null;
 const n=Number(raw);return Number.isFinite(n)?n:null;
}
function productionBuild(){
 productionDocuments=[];
 const result=document.getElementById('prodresult');
 if(result){result.hidden=true;result.innerHTML=''}
 try{
  if(!productionBook||!productionSheetName||!window.productionContext)throw Error('Сначала получите план Excel и выберите дату');
  const kitchen=document.getElementById('prodkitchen').value.trim();
  if(!kitchen)throw Error('Укажите склад-отправитель');
  const selectors=[...document.querySelectorAll('#prodrecipients select')];
  const roles=selectors.filter(x=>x.value==='point').map(x=>{
    const col=Number(x.dataset.col);
    return {col,name:String(window.productionContext.heads[col]??'').trim()};
  });
  if(!roles.length)throw Error('Выберите хотя бы один столбец «Получатель перемещения»');
  const badRole=roles.find(x=>!x.name||productionSkip.test(x.name)||productionNorm(x.name)==='iiko');
  if(badRole)throw Error('Недопустимый получатель: '+badRole.name);
  const same=roles.find(x=>productionNorm(x.name)===productionNorm(kitchen));
  if(same)throw Error('Склад-отправитель не может совпадать с получателем «'+same.name+'»');
  const transfers=new Map(roles.map(r=>[r.name,new Map()]));
  const warnings=[],withoutCode=[],invalidValues=[];
  let accepted=0;
  for(let i=window.productionContext.header+1;i<productionRows.length;i++){
   const row=productionRows[i]||[];
   const name=String(row[1]??'').trim(),code=String(row[0]??'').trim();
   if(!name||productionGroups.test(code)||productionGroups.test(name))continue;
   const entries=[];
   for(const recipient of roles){
    const raw=row[recipient.col];
    const quantity=productionQuantity(raw);
    if(raw!==null&&raw!==undefined&&String(raw).trim()!==''&&quantity===null)
      invalidValues.push('Строка '+(i+1)+', '+recipient.name+': некорректное количество «'+String(raw).slice(0,35)+'»');
    if(quantity!==null&&quantity>0)entries.push({...recipient,quantity});
   }
   if(!entries.length)continue;
   if(!/^\d+$/.test(code)){
    withoutCode.push('Строка '+(i+1)+': '+name+' — нет числового кода');
    continue;
   }
   const weight=String(row[2]??'').trim();
   const key=code+'|'+name+'|'+weight;
   for(const recipient of entries){
    const entriesForTarget=transfers.get(recipient.name);
    const existing=entriesForTarget.get(key);
    if(existing){
      warnings.push('Повтор кода/блюда '+code+' — '+name+', получатель '+recipient.name+
        ' (строка '+(i+1)+'). Количества сложены.');
      existing.quantity+=recipient.quantity;
    }else{
      entriesForTarget.set(key,{code,name,weight,quantity:recipient.quantity,sourceRow:i+1});
    }
    accepted++;
   }
  }
  productionDocuments=[...transfers.entries()]
    .filter(([,items])=>items.size>0)
    .map(([target,items])=>({
      type:'transfer',date:productionSheetName,source:kitchen,target,items:[...items.values()],
      status:'DRAFT',posted:false
    }));
  if(!productionDocuments.length)throw Error('Нет положительных количеств для выбранных получателей');
  const escaped=productionText;
  const warningsAll=[...warnings,...withoutCode,...invalidValues];
  const cards=productionDocuments.map(doc=>{
    const total=doc.items.reduce((n,item)=>n+item.quantity,0);
    return '<details><summary><b>'+escaped(doc.source)+' → '+escaped(doc.target)+'</b> · '+
      doc.items.length+' поз. · '+total+' шт.</summary><div class="tablewrap"><table class="nomtable">'+
      '<thead><tr><th>Код</th><th>Блюдо</th><th>Количество</th></tr></thead><tbody>'+
      doc.items.map(item=>'<tr><td>'+escaped(item.code)+'</td><td>'+escaped(item.name)+
       '</td><td>'+item.quantity+'</td></tr>').join('')+
      '</tbody></table></div></details>';
  }).join('');
  result.innerHTML='<h3>Черновики перемещений · '+escaped(productionSheetName)+'</h3>'+
    '<p>Склад-отправитель: <b>'+escaped(kitchen)+'</b>. Документов: <b>'+
    productionDocuments.length+'</b>. Строк: <b>'+accepted+'</b>.</p>'+
    (warningsAll.length?
     '<p style="color:#9d4b17"><b>Проверить ('+warningsAll.length+'):</b> '+
       warningsAll.slice(0,40).map(escaped).join('; ')+'</p>':
     '<p>Строк без числового кода, повторов и некорректных количеств не обнаружено.</p>')+
    cards+
    '<p class="muted">Черновики для проверки: склады обозначены названиями из плана, номенклатура ещё не сопоставлена с iiko. В iiko ничего не создаётся и не проводится.</p>'+
    '<button onclick="productionExport()">Скачать черновики перемещений (JSON)</button>';
  result.hidden=false;
  document.getElementById('prodstatus').textContent='Готово: '+
    productionDocuments.length+' черновиков перемещений за '+productionSheetName+
    '. Замечаний: '+warningsAll.length+'. Выгрузка в iiko не выполнялась.';
 }catch(e){
  productionDocuments=[];
  if(result){result.innerHTML='';result.hidden=true}
  productionError(e);
 }
}
function productionExport(){
 if(!productionDocuments.length)return;
 const payload={schema:'pomogator.iiko-transfers-draft.v1',sourceFile:productionFileName,sourceSheet:productionSheetName,createdAt:new Date().toISOString(),posted:false,documents:productionDocuments};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='iiko-transfers-draft-'+productionSheetName.replace(/[^\wа-яё.-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
document.addEventListener('DOMContentLoaded',productionInit);
