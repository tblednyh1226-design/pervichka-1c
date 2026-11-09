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
 const rev=document.getElementById('prodPastryColumns');
 if(rev){rev.hidden=true;rev.innerHTML=''}
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
 const preferred=prior>=0?prior:matchedMorning>=0?matchedMorning:-1;
 const datedSheets=meta.SheetNames.map((name,i)=>({name,i}))
   .filter(x=>productionSheetISO(x.name,productionMoscowToday()));
 // Last tab may be a summary, so prefer an actual business-day sheet.
 const chosen=preferred>=0&&productionSheetISO(meta.SheetNames[preferred],productionMoscowToday())?
   preferred:datedSheets.length?datedSheets[datedSheets.length-1].i:meta.SheetNames.length-1;
 select.value=String(chosen);
 let parsed=true,error='';
 try{productionSelectSheet()}catch(e){
   parsed=false;error=String(e.message||e);
   productionRows=[];productionDocuments=[];window.productionContext=null;
   const result=document.getElementById('prodresult');
   if(result){result.hidden=true;result.innerHTML=''}
 }
 const status=document.getElementById('prodstatus');
 if(status&&!parsed)status.textContent='Excel с MAIN успешно получен: '+name+
   '. Выбранный лист «'+productionSheetName+
   '» не подошёл: '+error+'. Выберите другой день без повторного запроса.';
 else if(status){
  const needsReview=Boolean(window.productionContext?.pastryColumns?.needsReview);
  if(productionDocuments.length||needsReview)status.textContent='Отдельный план перемещений получен: '+name+
   '. Лист: '+productionSheetName+'. '+
   (needsReview?'Подтвердите колонки выпечки перед формированием.':
     productionDocuments.length?'Сформировано '+productionDocuments.length+' перемещений для проверки.':
     'Документы не сформированы: проверьте ошибку и лист.')+
   ' Утренний план не изменён.';
  // If automatic generation failed, do not overwrite its precise error.
 }
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
 return planGuestDownloadExcel(url,jobId,message=>{
   const el=document.getElementById('prodstatus');
   if(el)el.textContent=message;
 });
}
function productionOpenMainConnection(){
 if(typeof productionSwitchTab==='function')productionSwitchTab('cooking');
 const el=document.getElementById('planBridge');
 if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
}
async function productionMainConnectionStatus(){
 const el=document.getElementById('prodMainConnection');
 if(!el)return;
 el.textContent='Проверяю MAIN через основной и резервный серверы (до 45 секунд)…';
 try{
   const r=await planGuestCheckConnection(false);
   el.textContent=r.online?'MAIN подключён через '+(planGuestPreferredRoute==='relay'?'резервный':'основной')+' сервер. Файлы доступны.':
     !r.last?'Этот браузер сохранён под неактивным MAIN. Подключите действующий код на вкладке «Акт приготовления».':
     'MAIN по сохранённому коду сейчас не отвечает. Проверьте агент MAIN либо обновите код подключения.';
 }catch(e){el.textContent=String(e.message||e);}
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
 const latestButton=document.getElementById('prodLatestMainBtn');
 if(button)button.disabled=true;
 if(latestButton)latestButton.disabled=true;
 const current=document.getElementById('prodstatus');
 if(current)current.textContent='Проверяю MAIN и создаю новое задание. Уже открытый Excel сохраняется…';
 try{
  await planGuestCheckConnection(true);
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
  const status=document.getElementById('prodstatus');
  if(status)status.textContent='Не удалось получить новый Excel: '+String(e.message||e)+'. Уже открытый план сохранён.';
  void productionMainConnectionStatus();
 }finally{
  productionMainBusy=false;
  if(button)button.disabled=false;
  if(latestButton)latestButton.disabled=false;
 }
}
// Read the last completed MAIN job WITHOUT creating a new request.
// The transfer workbook remains independent of the morning cooking workbook.
async function productionMainLoadLatest(){
 if(productionMainBusy)return;
 if(typeof planGuestFetch!=='function'||typeof planGuestTransport!=='function'){
   productionError(Error('Модуль подключения MAIN не загружен'));return;
 }
 if(typeof planBridgeBusy!=='undefined'&&planBridgeBusy){
   document.getElementById('prodstatus').textContent=
      'MAIN сейчас получает план на вкладке приготовления. Дождитесь завершения.';
   return;
 }
 const buttons=['prodRequestMainBtn','prodLatestMainBtn']
   .map(id=>document.getElementById(id)).filter(Boolean);
 productionMainBusy=true;buttons.forEach(btn=>btn.disabled=true);
 const status=document.getElementById('prodstatus');
 if(status)status.textContent='Проверяю основной и резервный серверы. Ищу последний готовый Excel без нового задания…';
 try{
   const latest=await planGuestFetch('latest');
   if(!latest?.available||!latest.download_url||!latest.job_id){
     const connection=await planGuestCheckConnection(false);
     throw Error(!connection.last?
       'Этот браузер привязан к неактивной регистрации MAIN без файлов. Во вкладке «Акт приготовления» подключите действующий код MAIN.':
       'У подключённого MAIN нет готового Excel. Проверьте, что используется код действующего MAIN.');
   }
   const when=latest.finished_at?new Date(latest.finished_at)
     .toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hour12:false}):'время неизвестно';
   if(status)status.textContent='Нашёл готовый Excel от '+when+
     ' (Москва). Загружаю в перемещения без нового задания…';
   const bytes=await productionMainDownload(latest.download_url,latest.job_id);
   productionLoadIndependentBook(bytes,'Последний готовый план MAIN.xlsx');
   if(status)status.textContent+=' Готовый Excel от '+when+
     ' (Москва). Это последняя сохранённая версия на сервере, проверьте дату и лист.';
 }catch(e){
   if(status)status.textContent='Не удалось открыть последний готовый Excel: '+
     String(e.message||e)+'. Новый запрос MAIN не создавался.';
   void productionMainConnectionStatus();
 }finally{
   productionMainBusy=false;
   buttons.forEach(btn=>btn.disabled=false);
 }
}
function productionPoint(name){
 const n=productionNorm(name).replace(/\s+/g,' ');
 // «Редм фас» is an external customer invoice column, not the Рэдмонд outlet.
 if(/^р[еэ]дм\s*фас(?:\s|$)/u.test(n))return null;
 if(/^(раздача правды|правда раздача|пр)$/.test(n))return 'Правда раздача';
 if(/^(раздача бухара|бухара раздача|бр)$/.test(n))return 'Бухара раздача';
 if(/^этм(?: день| ночь)?$/.test(n))return 'ЭТМ';
 if(/^бестужевская$/.test(n))return 'Бестужевская';
 if(/^модул(?:ь)?$/.test(n))return 'Модуль';
 if(/^мега$/.test(n))return 'МЕГА'; // Recognize for exclusion only.
 // "Рэдм" is how this outlet is abbreviated in the production sheet.
 // Accept either е or э, full names, punctuation and optional qualifiers.
 if(/^р[еэ]дм(?:онд|онт)?(?:$|[.\s(№_:—-])/u.test(n)||
    /^(?:точка|кафе|столовая)\s+р[еэ]дм(?:онд|онт)?(?:$|[.\s(№_:—-])/u.test(n))
   return 'Рэдмонд';
 if(/^(мед экспресс|медэкспресс)$/.test(n))return 'Мед экспресс';
 return null;
}
// Use exactly the cooking-act boundaries for compotes and pastry.
// All "Допы" rows in between are outside every production document.
function productionFindPastry(rows,start){
 if(typeof morningFindSections!=='function')
   throw Error('Не загружен общий модуль определения разделов производства.');
 const sections=morningFindSections(rows,{row:start-1,nameCol:1});
 if(sections.compoteLast<0)
   throw Error('Не найдена последняя строка компота. Чтобы не включить «допы» в перемещения, формирование остановлено. Проверьте лист Excel.');
 if(sections.compoteLast>=sections.pastryStart)
   throw Error('Неверные границы компотов и выпечки. Перемещения не формируются.');
 return {start:sections.pastryStart,end:sections.nextAfterPastry,
   compoteLast:sections.compoteLast,extrasStart:sections.extrasStart};
}
function productionPastryRole(v){
 const n=productionNorm(v).replace(/[^a-zа-я0-9]+/gi,' ').trim().replace(/\s+/g,' ');
 if(/^(?:всего|итого)(?: (?:выпечка|шт|штук|порций|количество|кол во))*$/.test(n))return 'total';
 if(productionPoint(n)==='Правда раздача'||/^(?:раздача )?правд(?:а|ы|е)?(?: раздача)?$/.test(n))return 'pr';
 if(productionPoint(n)==='Бухара раздача'||/^(?:раздача )?бухар(?:а|ы|е)?(?: раздача)?$/.test(n))return 'br';
 return '';
}
function productionPastryColumns(rows,pastryStart,mainHeader,pastryEnd){
 const stop=Math.min(rows.length-1,pastryEnd-1,pastryStart+9);
 const candidates=[];
 for(let i=Math.max(0,mainHeader);i<=stop;i++){
   const row=rows[i]||[],roles={total:[],pr:[],br:[]};
   row.forEach((value,col)=>{const role=productionPastryRole(value);if(role)roles[role].push(col)});
   const count=roles.total.length+roles.pr.length+roles.br.length;
   const looksLikeHeader=productionNorm(row[1]).includes('наименован')||
     productionNorm(row[0])==='№';
   if(!looksLikeHeader&&count<3)continue;
   candidates.push({row:i,roles,complete:roles.total.length===1&&roles.pr.length===1&&roles.br.length===1});
 }
 const compare=(a,b)=>Math.abs(a.row-pastryStart)-Math.abs(b.row-pastryStart);
 // A nearby incomplete pastry heading must NOT be silently overridden by
 // a complete but distant main-menu heading: columns may have moved.
 const nearest=candidates.sort(compare)[0];
 if(nearest?.complete)return {totalCol:nearest.roles.total[0],prCol:nearest.roles.pr[0],
   brCol:nearest.roles.br[0],headerRow:nearest.row,needsReview:false};
 return {totalCol:nearest?.roles.total.length===1?nearest.roles.total[0]:null,
   prCol:nearest?.roles.pr.length===1?nearest.roles.pr[0]:null,
   brCol:nearest?.roles.br.length===1?nearest.roles.br[0]:null,
   headerRow:nearest?.row??mainHeader,needsReview:true};
}
function productionLetter(col){
 let n=col+1,s='';
 while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}
 return s;
}
function productionRenderPastryReview(){
 const root=document.getElementById('prodPastryColumns');
 if(!root)return;
 const context=window.productionContext,p=context?.pastryColumns;
 if(!p?.needsReview){root.hidden=true;root.innerHTML='';return}
 const headings=productionRows[p.headerRow]||[];
 const first=productionRows.slice(context.pastry.start+1,context.pastry.start+6)
   .find(r=>String(r?.[1]??'').trim()&&!productionGroups.test(String(r[1])));
 const count=Math.min(120,Math.max(headings.length,context.heads.length,first?.length||0));
 const controls=[['total','Всего'],['pr','Раздача Правды'],['br','Раздача Бухара']]
   .map(([key,label])=>{
     const wanted=p[key+'Col'];
     const choices='<option value="">Выберите колонку</option>'+
       Array.from({length:count},(_,col)=>{
         const name=String(headings[col]||context.heads[col]||'').trim();
         const sample=String(first?.[col]??'').trim();
         return '<option value="'+col+'"'+(wanted===col?' selected':'')+'>'+
           productionText(productionLetter(col)+' — '+(name||'без названия')+
           (sample?' · '+sample.slice(0,18):''))+'</option>';
       }).join('');
     return '<label>'+productionText(label)+
       '<select id="prodPastry-'+key+'">'+choices+'</select></label>';
   }).join('');
 root.hidden=false;
 root.innerHTML='<p><b>План загружен, но заголовки выпечки отличаются.</b> '+
  'Выберите соответствующие колонки. До подтверждения перемещения не формируются.</p>'+
  '<div class="formgrid">'+controls+'</div>'+
  '<button type="button" onclick="productionConfirmPastryColumns()">Подтвердить колонки выпечки</button>';
}
function productionConfirmPastryColumns(){
 const context=window.productionContext;
 if(!context?.pastryColumns?.needsReview)return;
 const selected={};
 for(const [key,label] of [['total','Всего'],['pr','Раздача Правды'],['br','Раздача Бухара']]){
   const value=String(document.getElementById('prodPastry-'+key)?.value??'');
   if(!/^\d+$/.test(value)){productionError(Error('Выберите колонку «'+label+'»'));return}
   selected[key]=Number(value);
 }
 if(new Set(Object.values(selected)).size!==3){
   productionError(Error('«Всего», ПР и БР должны быть разными колонками'));return;
 }
 const examples=[];
 for(let i=context.pastry.start+1;i<context.pastry.end&&examples.length<3;i++){
   const row=productionRows[i]||[],name=String(row[1]??'').trim();
   if(!name||productionNorm(name)==='наименование'||productionGroups.test(name))continue;
   const raw=row[selected.total];
   if(String(raw??'').trim()==='')continue;
   const total=productionQuantity(raw),pr=productionQuantity(row[selected.pr]);
   const br=productionQuantity(row[selected.br]);
   if(total===null||pr===null&&String(row[selected.pr]??'').trim()!==''||
      br===null&&String(row[selected.br]??'').trim()!==''||
      (pr||0)>total||(br||0)>total-(pr||0)){
      productionError(Error('Проверьте выбранные колонки, некорректное значение в строке '+(i+1)+': '+name));
      return;
   }
   examples.push(name+': всего '+total+', ПР '+(pr||0)+', БР '+(br||0));
 }
 if(!examples.length){productionError(Error('Не найдено чисел в колонке «Всего» для выпечки'));return}
 const msg='Подтвердить колонки? Всего '+productionLetter(selected.total)+
  ', ПР '+productionLetter(selected.pr)+', БР '+productionLetter(selected.br)+
  '\nПримеры:\n'+examples.join('\n')+
  '\n\nПроверьте, что это именно нужные количества Excel.';
 if(!window.confirm(msg))return;
 context.pastryColumns={totalCol:selected.total,prCol:selected.pr,
   brCol:selected.br,headerRow:context.pastryColumns.headerRow,
   needsReview:false,manuallyConfirmed:true};
 productionRenderPastryReview();
 document.getElementById('prodstatus').textContent='Колонки выпечки подтверждены. Формирую черновики для проверки…';
 productionBuild();
}
// Sheet and iiko-document dates are always the same business day.
function productionMoscowToday(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const val=k=>parts.find(x=>x.type===k)?.value||'';
 return val('year')+'-'+val('month')+'-'+val('day');
}
function productionSheetISO(sheet,referenceISO){
 const match=/^\s*(0?[1-9]|[12]\d|3[01])\s*[.\/-]\s*(0?[1-9]|1[0-2])(?:\s*[.\/-]\s*(\d{2,4}))?(?!\d)/.exec(String(sheet||''));
 if(!match)return '';
 const day=Number(match[1]),month=Number(match[2]);
 const reference=/^\d{4}-\d{2}-\d{2}$/.test(String(referenceISO||''))?
   String(referenceISO):productionMoscowToday();
 const refYear=Number(reference.slice(0,4));
 const explicitYear=match[3]?Number(match[3]):null;
 const years=explicitYear===null?[refYear-1,refYear,refYear+1]:
   [explicitYear<100?2000+explicitYear:explicitYear];
 const candidates=years.map(year=>{
   const d=new Date(Date.UTC(year,month-1,day));
   return d.getUTCFullYear()===year&&d.getUTCMonth()+1===month&&d.getUTCDate()===day?
     d.toISOString().slice(0,10):'';
 }).filter(Boolean);
 const refTime=Date.parse(reference+'T12:00:00Z');
 candidates.sort((a,b)=>Math.abs(Date.parse(a+'T12:00:00Z')-refTime)-
   Math.abs(Date.parse(b+'T12:00:00Z')-refTime));
 return candidates[0]||'';
}
function productionSyncTransferDate(){
 const field=document.getElementById('prodDocDate');
 if(!field)return;
 field.value=productionSheetISO(productionSheetName,field.value||productionMoscowToday());
 if(typeof transferRefreshSendButtons==='function')transferRefreshSendButtons();
}
function productionSelectDate(){
 const field=document.getElementById('prodDocDate');
 const select=document.getElementById('prodsheet');
 if(!field||!select||!productionBook)return;
 const chosen=String(field.value||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(chosen)){productionSyncTransferDate();return}
 const index=productionBook.SheetNames.findIndex(name=>productionSheetISO(name,chosen)===chosen);
 if(index<0){
   productionSyncTransferDate();
   productionError(Error('В загруженном Excel нет листа за '+chosen+
     '. Дата документов восстановлена по выбранному дню.'));
   return;
 }
 select.value=String(index);
 productionSelectSheet();
}
function productionSelectSheet(){
 if(!productionBook)return;
 // Invalidate documents from the previous day BEFORE parsing a new sheet.
 // An invalid compote/pastry boundary must never leave old documents sendable.
 productionDocuments=[];
 window.productionContext=null;
 const previousResult=document.getElementById('prodresult');
 if(previousResult){previousResult.hidden=true;previousResult.innerHTML='';}
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
 // The plan has TWO "Наименование" headers. The first is before the main menu;
 // the second repeats before pastry. Always use the first header.
 const header=productionRows.findIndex(row=>productionNorm(row[1])==='наименование'&&
   row.slice(4).some(x=>productionPoint(x)));
 if(header<0)throw Error('Не найдена основная строка с заголовками точек');
 const heads=productionRows[header];
 // Optional classification row immediately above the named columns: outlet names for transfers, blanks for external buyers.
 const classification=header>0?productionRows[header-1]||[]:[];
 const hasClassification=heads.some((v,col)=>col>=4&&productionPoint(v)&&productionPoint(classification[col]));
 let pastry;
 try{pastry=productionFindPastry(productionRows,header+1)}
 catch(e){productionError(e);throw e}
 const pastryColumns=productionPastryColumns(productionRows,pastry.start,header,pastry.end);
 const allReceivers=heads.map((v,col)=>({name:String(v??'').trim(),col,point:productionPoint(v)}))
   .filter(x=>x.name&&x.col>=4&&x.point&&(!hasClassification||Boolean(productionPoint(classification[x.col])))&&
      x.point!=='Бухара раздача'&&x.point!=='Мед экспресс'&&x.point!=='МЕГА');
 const etmSources=allReceivers.filter(x=>x.point==='ЭТМ');
 const options=allReceivers.filter(x=>x.point!=='ЭТМ');
 if(etmSources.length){
   // One visible selector controls both ETM DAY and NIGHT columns.
   // The underlying values stay separate until summed per dish below.
   const first=etmSources[0];
   options.splice(allReceivers.indexOf(first),0,{
     name:'ЭТМ',col:first.col,point:'ЭТМ',sources:etmSources
   });
 }
 const unknown=heads.map((v,col)=>({name:String(v??'').trim(),col}))
   .filter(x=>x.name&&x.col>=4&&!productionSkip.test(x.name)&&
      !productionPoint(x.name));
 window.productionContext={header,heads,classification,hasClassification,options,pastry,pastryColumns,unknown};
 productionDocuments=[];
 const result=document.getElementById('prodresult');
 if(result){result.innerHTML='';result.hidden=true}
 document.getElementById('prodstatus').textContent=
  'Лист: '+productionSheetName+'. Допы между компотами и выпечкой исключены. '+
  (pastryColumns.needsReview?'Проверьте и подтвердите колонки выпечки ниже. Пока документы заблокированы.':
  'Маршруты: ПК→БК (вся выпечка кроме ПР), БК→БР (только выпечка), БК→остальные точки. ПК→ПР не создаётся.')+
  (unknown.length?' Есть нераспознанные колонки: '+unknown.map(x=>x.name).join(', ')+'.':'');
 productionRenderPastryReview();
 productionSyncTransferDate();
 // Build immediately; no intermediate destination selection required.
 if(!pastryColumns.needsReview)productionBuild();
}
function productionPastryReceiverColumn(target,context){
 const cols=context.pastryColumns;
 if(target.point==='Правда раздача')return cols.prCol;
 if(target.point==='Бухара раздача')return cols.brCol;
 if(cols.headerRow===context.header)return target.col;
 const heading=productionRows[cols.headerRow]||[];
 const exact=heading.map((v,col)=>({label:productionNorm(v),col}))
   .filter(x=>x.label&&x.label===productionNorm(target.name));
 if(exact.length===1)return exact[0].col;
 const aliases=heading.map((v,col)=>({point:productionPoint(v),col}))
   .filter(x=>x.point===target.point);
 if(aliases.length===1)return aliases[0].col;
 const mainPR=context.heads.findIndex(x=>productionPoint(x)==='Правда раздача');
 const mainBR=context.heads.findIndex(x=>productionPoint(x)==='Бухара раздача');
 // Only reuse the main column when both checked anchors are in the same
 // positions and the pastry heading does not label that column differently.
 if(mainPR===cols.prCol&&mainBR===cols.brCol&&
   (!heading[target.col]||productionPoint(heading[target.col])===target.point))
   return target.col;
 throw Error('В блоке выпечки не определена колонка точки «'+target.name+
   '». Проверьте отдельную строку заголовков в Excel.');
}
function productionBlankQuantity(v){
 return v===null||v===undefined||/^(?:\s*|[-—–])$/.test(String(v).trim());
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
  const context=window.productionContext;
  if(!productionBook||!productionSheetName||!context)
   throw Error('Сначала получите отдельный план Excel и выберите дату');
  if(context.pastryColumns?.needsReview)
   throw Error('Перед формированием подтвердите три колонки блока выпечки.');
  // All recognised outlets are included automatically, as with the
  // old default "Включить". ETM day and night form one destination.
  const columns=context.options.flatMap(o=>o.sources||[
    {col:o.col,name:o.name,point:o.point}
  ]);
  // ПК→БК: pastry «Всего» minus ПР, regardless of outlet selection.
  if(columns.some(x=>!x.point||['Бухара раздача','Мед экспресс','МЕГА'].includes(x.point)))
   throw Error('БР, Мед экспресс и МЕГА не выбираются как обычные получатели перемещений');
  const redmondHeader=context.heads.map((v,col)=>({col,name:String(v??'').trim()}))
    .find(x=>x.col>=4&&productionPoint(x.name)==='Рэдмонд');
  if(redmondHeader&&!context.options.some(x=>x.point==='Рэдмонд'))
    throw Error('Столбец Рэдмонд найден в плане, но отсутствует среди получателей.');
  const warnings=[],missingCodes=[],invalidValues=[];
  if(context.unknown.length)
   warnings.push('Неизвестные колонки не обрабатываются: '+
     context.unknown.map(x=>x.name).join(', '));
  const routes=new Map(),totals=new Map();
  function add(from,to,entry,amount){
   if(!Number.isFinite(amount)||amount<=0)return;
   if(from===to)throw Error('Внутреннее перемещение на тот же склад: '+from);
   const routeKey=from+' → '+to;
   if(!routes.has(routeKey)){routes.set(routeKey,new Map());totals.set(routeKey,{from,to})}
   const items=routes.get(routeKey);
   // For transfer drafts the identity is by name + weight, not only the
   // plan's often-reused or empty numeric code. Mapping to iiko is a later step.
   const key=productionNorm(entry.name)+'|'+productionNorm(entry.weight);
   // A full-size pie (normally 1000 g) is transferred in the same pieces
   // as the cooking act: one pie = eight portions. Convert exactly once
   // while building EACH route, before totals, preview and iiko upload.
   const isLargePie=/(?:^|[^а-я])пирог(?:и|ов|а|ом)?(?=$|[^а-я])/iu.test(entry.name)&&
     !/пирож|мини[\\s-]*пирог|маленьк|песочн/iu.test(entry.name);
   const conversionFactor=isLargePie?8:1;
   const finalAmount=amount*conversionFactor;
   const prior=items.get(key);
   if(prior){
    prior.quantity+=finalAmount;
    if(conversionFactor===8)prior.sourceQuantity+=amount;
    prior.sourceRows.push(entry.sourceRow);
   }else items.set(key,{code:entry.code,name:entry.name,weight:entry.weight,
      quantity:finalAmount,sourceRow:entry.sourceRow,sourceRows:[entry.sourceRow],
      ...(conversionFactor===8?{sourceQuantity:amount,conversionFactor:8,quantityUnit:'кус.'}:{})});
  }
  let inputLines=0,excludedBRRegular=0,brPastryMoved=0,excludedPRPastry=0,etmDay=0,etmNight=0,emptyPastrySkipped=0;
  for(let i=context.header+1;i<context.pastry.end;i++){
   // Ignore every row after compotes and before the pastry heading.
   // None of these extras may enter quantity checks or iiko mappings.
   if(i>context.pastry.compoteLast&&i<context.pastry.start)continue;
   const row=productionRows[i]||[];
   const name=String(row[1]??'').trim();
   if(!name||productionNorm(name)==='наименование'||productionGroups.test(name))continue;
   const marker=productionNorm(row[0]);
   if(productionSkip.test(name)||marker==='выпечка'||productionGroups.test(marker)||marker==='меню'||marker==='№')continue;
   const isPastry=i>context.pastry.start;
   if(isPastry){
     // Blank future-day pastry lines and section notes have nothing to move.
     // A positive number ANYWHERE in the relevant columns keeps strict validation.
     const cols=context.pastryColumns;
     const relevant=[...columns.map(t=>productionPastryReceiverColumn(t,context)),
       cols.totalCol,cols.prCol,cols.brCol];
     const hasPositive=[...new Set(relevant)].some(c=>productionQuantity(row[c])>0);
     const invalidReceiverValue=[...new Set(relevant)]
       .filter(c=>c!==cols.totalCol)
       .some(c=>productionQuantity(row[c])===null&&!productionBlankQuantity(row[c]));
     const rawTotal=row[cols.totalCol];
     if(!hasPositive&&!invalidReceiverValue&&productionQuantity(rawTotal)===null){
       emptyPastrySkipped++;
       if(!productionBlankQuantity(rawTotal))
         warnings.push('Строка '+(i+1)+' «'+name+
          '»: нет положительных количеств, «Всего» нечисловое — пропущена');
       continue;
     }
   }
   const entry={code:String(row[0]??'').trim(),name,
      weight:String(row[2]??'').trim(),sourceRow:i+1};
   let quantities=new Map();
   // Pastry headings may collapse ETM DAY and ETM NIGHT into one column.
   // Never count the same physical Excel cell twice for one destination.
   const seenReceiverCells=new Set();
   for(const target of columns){
     const targetCol=isPastry?productionPastryReceiverColumn(target,context):target.col;
     const cellKey=target.point+'|'+targetCol;
     if(seenReceiverCells.has(cellKey))continue;
     seenReceiverCells.add(cellKey);
     const raw=row[targetCol],count=productionQuantity(raw);
     if(!productionBlankQuantity(raw)&&count===null){
       invalidValues.push('Строка '+(i+1)+': '+target.name+
         ' — нечисловое количество «'+String(raw).slice(0,45)+'»');
     }
     if(count!==null&&count>0){
       quantities.set(target.point,(quantities.get(target.point)||0)+count);
       if(target.point==='ЭТМ'){
         if(/ночь/i.test(target.name))etmNight+=count;
         else etmDay+=count;
       }
     }
   }
   // Ordinary dishes for BR are excluded; ONLY pastry produces a BK→BR transfer.
   // Use each section's own BR header: the pastry header may have a different layout.
   const brCol=isPastry?context.pastryColumns.brCol:
     context.heads.findIndex(x=>productionPoint(x)==='Бухара раздача');
   const rawBr=brCol>=0?row[brCol]:'';
   const brQuantity=productionQuantity(rawBr);
   if(!productionBlankQuantity(rawBr)&&brQuantity===null)
     throw Error('Строка '+(i+1)+': некорректное количество БР');
   if(!isPastry&&brQuantity>0)excludedBRRegular+=brQuantity;
   let pastryUpstream=0;
   if(isPastry){
     const rawTotal=row[context.pastryColumns.totalCol];
     const rawPr=row[context.pastryColumns.prCol];
     const total=productionQuantity(rawTotal),pr=productionQuantity(rawPr);
     if(total===null||pr===null&&!productionBlankQuantity(rawPr))
       throw Error('Строка '+(i+1)+' «'+name+'»: некорректное количество выпечки. '+
         'Всего ('+productionLetter(context.pastryColumns.totalCol)+'): «'+String(rawTotal??'').slice(0,35)+
         '», Раздача Правды ('+productionLetter(context.pastryColumns.prCol)+'): «'+
         String(rawPr??'').slice(0,35)+'». Есть положительные количества — пропускать нельзя.');
     const prCount=pr||0;
     pastryUpstream=total-prCount;
     if(pastryUpstream<0)
       throw Error('Строка '+(i+1)+': выпечки для ПР больше, чем общее количество');
     excludedPRPastry+=prCount;
     if(brQuantity>pastryUpstream)
       throw Error('Строка '+(i+1)+': выпечки БР больше, чем «Всего» минус ПР');
     if(brQuantity>0)brPastryMoved+=brQuantity;
   }
   if(!quantities.size&&!pastryUpstream)continue;
   if(!/^\d+$/.test(entry.code))
     missingCodes.push('Строка '+entry.sourceRow+': «'+entry.name+
       '» — нет числового кода (оставлено в черновике для сопоставления)');
   for(const [point,count] of quantities){
     if(point==='Бухара раздача'||point==='Мед экспресс'||
       (isPastry&&point==='Правда раздача'))
       continue; // PR pastry stays outside ALL transfer documents.
     add('Бухара кухня',point,entry,count);
     inputLines++;
   }
   // All pastry except PR is received by BK. Of that amount, BR receives
   // only its own pastry via BK→BR; ordinary BR dishes remain excluded.
   if(isPastry&&pastryUpstream>0)
     add('Правда кухня','Бухара кухня',entry,pastryUpstream);
   if(isPastry&&brQuantity>0)
     add('Бухара кухня','Бухара раздача',entry,brQuantity);
  }
  if(invalidValues.length)
    throw Error('В плане есть некорректные количества: '+invalidValues.slice(0,7).join('; ')+
      '. Исправьте файл, чтобы не формировать неправильные перемещения.');
  // The PK→BK document precedes all BK-origin transfers.
  // First receive all non-PR pastry in BK, then send BK→BR pastry,
  // and only after that other BK→outlet drafts.
  const order=route=>route==='Правда кухня → Бухара кухня'?0:
    route==='Бухара кухня → Бухара раздача'?1:2;
  const ordered=[...routes.entries()].sort(([ak],[bk])=>order(ak)-order(bk));
  productionDocuments=ordered.map(([route,items])=>{
    const {from,to}=totals.get(route);
    return {type:'transfer',date:productionSheetName,source:from,target:to,
      items:[...items.values()],status:'DRAFT',posted:false};
  });
  if(!productionDocuments.length)
    throw Error('Нет положительных количеств для выбранных точек');
  // Validate all transfer drafts before preview, print, Excel or iiko send.
  // Source plan values are whole large pies even when labelled "кус.".
  for(const doc of productionDocuments){
    for(const item of doc.items){
      const large=/(?:^|[^а-я])пирог(?:и|ов|а|ом)?(?=$|[^а-я])/iu.test(item.name)&&
        !/пирож|мини[\\s-]*пирог|маленьк|песочн/iu.test(item.name);
      if(large&&item.conversionFactor!==8){
        item.sourceQuantity=item.quantity;
        item.quantity*=8;
        item.conversionFactor=8;
        item.quantityUnit='кус.';
      }
    }
  }
  const warningsAll=[...warnings,...missingCodes];
  result.hidden=false;
  if(typeof transferRender==='function')transferRender();
  else result.textContent='Черновики готовы: '+productionDocuments.length;
  if(warningsAll.length){
    const notes=document.createElement('p');
    notes.className='transfer-warnings';
    notes.textContent='Требует проверки: '+warningsAll.slice(0,30).join('; ');
    result.appendChild(notes);
  }
  const redmondIncluded=context.options.some(x=>x.point==='Рэдмонд');
  const redmondMade=productionDocuments.some(d=>d.target==='Рэдмонд');
  const redmondNote=redmondIncluded?
    ' Рэдмонд: найден в плане'+(redmondMade?', перемещение сформировано.':', нет положительных количеств.') :
    ' Рэдмонд: колонка не найдена в заголовках Excel.';
  const converted=productionDocuments.flatMap(d=>d.items).filter(x=>x.conversionFactor===8);
  document.getElementById('prodstatus').textContent=
    'Автоматически сформировано '+productionDocuments.length+' перемещений за '+productionSheetName+
    '. Пропущено незапланированных строк выпечки: '+emptyPastrySkipped+
    '. Крупные пироги: '+(converted.length?
      converted.length+' строк переведено в куски (×8).':'нет позиций для пересчёта ×8.')+
    redmondNote+' Откройте документы и проверьте блюда, количества и склады до отправки в iiko.';
  // Catalogue read only. Sending iiko documents remains manual.
  if(typeof transferConnect==='function'&&typeof planGuestStored==='function'&&
     planGuestStored()?.token&&typeof transferLive!=='undefined'&&
     !transferLive.connected&&!transferLive.busy)void transferConnect();

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
