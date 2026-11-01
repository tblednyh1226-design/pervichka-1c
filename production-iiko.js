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
 select.value=String(prior>=0?prior:matchedMorning>=0?matchedMorning:meta.SheetNames.length-1);
 productionSelectSheet();
 const status=document.getElementById('prodstatus');
 if(status)status.textContent='Отдельный план перемещений получен: '+name+
  '. Лист: '+productionSheetName+'. '+
   (window.productionContext?.pastryColumns?.needsReview?
     'Проверьте колонки выпечки в шаге 2.':'Колонки выпечки определены.')+
   ' Утренний план не изменён.';
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
function productionPoint(name){
 const n=productionNorm(name).replace(/\s+/g,' ');
 if(/^(раздача правды|правда раздача|пр)$/.test(n))return 'Правда раздача';
 if(/^(раздача бухара|бухара раздача|бр)$/.test(n))return 'Бухара раздача';
 if(/^этм(?: день| ночь)?$/.test(n))return 'ЭТМ';
 if(/^бестужевская$/.test(n))return 'Бестужевская';
 if(/^модул(?:ь)?$/.test(n))return 'Модуль';
 if(/^мега$/.test(n))return 'МЕГА';
 if(/^(редм|рэдмонд|редмонд)$/.test(n))return 'Рэдмонд';
 if(/^(мед экспресс|медэкспресс)$/.test(n))return 'Мед экспресс';
 return null;
}
function productionFindPastry(rows,start){
 let first=-1,last=rows.length;
 for(let r=start;r<rows.length;r++){
  const marker=productionNorm(rows[r]?.[0]||rows[r]?.[1]||'');
  if(first<0){
   if(marker==='выпечка')first=r;
  }else if(/^(завтрак|завтраки|комплексн|заказ|питание сотрудников|бизнес-ланч)/.test(marker)){
   last=r;break;
  }
 }
 if(first<0)throw Error('На листе нет блока «Выпечка». Проверьте выбранную дату и структуру плана.');
 return {start:first,end:last};
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
   if(count<2)continue;
   if(!productionNorm(row[1]).includes('наименован')&&productionNorm(row[0])!=='№'&&count<3)continue;
   candidates.push({row:i,roles,complete:roles.total.length===1&&roles.pr.length===1&&roles.br.length===1});
 }
 const compare=(a,b)=>Math.abs(a.row-pastryStart)-Math.abs(b.row-pastryStart);
 const match=candidates.filter(x=>x.complete).sort(compare)[0];
 if(match)return {totalCol:match.roles.total[0],prCol:match.roles.pr[0],
   brCol:match.roles.br[0],headerRow:match.row,needsReview:false};
 const nearest=candidates.sort(compare)[0];
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
 document.getElementById('prodstatus').textContent='Колонки выпечки подтверждены. Можно формировать документы.';
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
 // The plan has TWO "Наименование" headers. The first is before the main menu;
 // the second repeats before pastry. Always use the first header.
 const header=productionRows.findIndex(row=>productionNorm(row[1])==='наименование'&&
   row.slice(4).some(x=>productionPoint(x)));
 if(header<0)throw Error('Не найдена основная строка с заголовками точек');
 const heads=productionRows[header];
 const pastry=productionFindPastry(productionRows,header+1);
 const pastryColumns=productionPastryColumns(productionRows,pastry.start,header,pastry.end);
 const options=heads.map((v,col)=>({name:String(v??'').trim(),col,point:productionPoint(v)}))
   .filter(x=>x.name&&x.col>=4&&x.point&&x.point!=='Бухара раздача');
 const unknown=heads.map((v,col)=>({name:String(v??'').trim(),col}))
   .filter(x=>x.name&&x.col>=4&&!productionSkip.test(x.name)&&
      !productionPoint(x.name));
 window.productionContext={header,heads,options,pastry,pastryColumns,unknown};
 const container=document.getElementById('prodrecipients');
 container.innerHTML=options.map(o=>
  '<div class="orgrow"><span><b>'+productionText(o.name)+'</b>'+
  (o.point==='ЭТМ'?'<small>Объединяется в один документ ЭТМ</small>':'')+
  '<small>Столбец '+(o.col+1)+'</small></span>'+
  '<select data-col="'+o.col+'" aria-label="Роль '+productionText(o.name)+'">'+
  '<option value="point" selected>Включить в перемещения</option>'+
  '<option value="ignore">Не учитывать</option></select></div>'
 ).join('');
 productionDocuments=[];
 const result=document.getElementById('prodresult');
 if(result){result.innerHTML='';result.hidden=true}
 document.getElementById('prodstatus').textContent=
  'Лист: '+productionSheetName+'. '+
  (pastryColumns.needsReview?'Проверьте и подтвердите колонки выпечки ниже. Пока документы заблокированы.':
  'Маршруты: ПК→БК (вся выпечка кроме ПР), БК→БР (только выпечка), БК→остальные точки. ПК→ПР не создаётся.')+
  (unknown.length?' Есть нераспознанные колонки: '+unknown.map(x=>x.name).join(', ')+'.':'');
 productionRenderPastryReview();
 if(typeof transferRowDate==='function')transferRowDate();
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
  const selectors=[...document.querySelectorAll('#prodrecipients select')];
  const columns=selectors.filter(x=>x.value==='point').map(x=>{
    const col=Number(x.dataset.col);
    const name=String(context.heads[col]??'').trim();
    return {col,name,point:productionPoint(name)};
  });
  // PK→BK must include all pastry minus PR, even if all destination
  // checkboxes are disabled (BR and external customers remain in total).
  if(columns.some(x=>!x.point||x.point==='Бухара раздача'))
   throw Error('БР не участвует в перемещениях; проверьте выбранные колонки');
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
   const prior=items.get(key);
   if(prior){
    prior.quantity+=amount;
    prior.sourceRows.push(entry.sourceRow);
   }else items.set(key,{code:entry.code,name:entry.name,weight:entry.weight,
      quantity:amount,sourceRow:entry.sourceRow,sourceRows:[entry.sourceRow]});
  }
  let inputLines=0,excludedBRRegular=0,brPastryMoved=0,excludedPRPastry=0,etmDay=0,etmNight=0;
  for(let i=context.header+1;i<context.pastry.end;i++){
   const row=productionRows[i]||[];
   const name=String(row[1]??'').trim();
   if(!name||productionNorm(name)==='наименование'||productionGroups.test(name))continue;
   const marker=productionNorm(row[0]);
   if(marker==='выпечка'||productionGroups.test(marker)||marker==='меню'||marker==='№')continue;
   const isPastry=i>context.pastry.start;
   const entry={code:String(row[0]??'').trim(),name,
      weight:String(row[2]??'').trim(),sourceRow:i+1};
   let quantities=new Map();
   for(const target of columns){
     const raw=row[target.col],count=productionQuantity(raw);
     if(raw!==null&&raw!==undefined&&String(raw).trim()!==''&&count===null){
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
   if(rawBr!==null&&rawBr!==undefined&&String(rawBr).trim()!==''&&brQuantity===null)
     throw Error('Строка '+(i+1)+': некорректное количество БР');
   if(!isPastry&&brQuantity>0)excludedBRRegular+=brQuantity;
   let pastryUpstream=0;
   if(isPastry){
     const rawTotal=row[context.pastryColumns.totalCol];
     const rawPr=row[context.pastryColumns.prCol];
     const total=productionQuantity(rawTotal),pr=productionQuantity(rawPr);
     if(total===null||pr===null && String(rawPr??'').trim()!=='')
       throw Error('Строка '+(i+1)+': нечисловое количество в «Всего» или «Раздача Правды» для выпечки');
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
     if(point==='Бухара раздача'||(isPastry&&point==='Правда раздача'))
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
  document.getElementById('prodstatus').textContent=
    'Сформировано '+productionDocuments.length+' документов за '+productionSheetName+
    '. Номенклатуру и склады проверьте перед отправкой в iiko.';
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
