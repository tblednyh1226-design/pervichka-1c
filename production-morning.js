/* Date-selected production act preparation. Does not contact iiko or post documents. */
let morningState={book:null,bytes:null,fileName:'',result:null,selectedColumn:null};

function morningNorm(v) {
  return String(v??'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
}
function morningEscape(v) {
  return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function morningTomorrowMoscow(now=new Date()) {
  const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(now);
  const val=k=>Number(f.find(x=>x.type===k).value);
  const d=new Date(Date.UTC(val('year'),val('month')-1,val('day')+1));
  return {iso:d.toISOString().slice(0,10),day:String(d.getUTCDate()).padStart(2,'0'),month:String(d.getUTCMonth()+1).padStart(2,'0'),year:String(d.getUTCFullYear())};
}
// All dates refer to the production day in Moscow; never use browser-local UTC conversion.
function morningDateFromISO(iso) {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  if(!match)throw Error('Выберите дату приготовления.');
  const [year,month,day]=match.slice(1).map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day){
    throw Error('Некорректная дата приготовления.');
  }
  return {iso:match[0],year:match[1],month:match[2],day:match[3]};
}
function morningInitDate() {
  const input=document.getElementById('morningDateInput');
  if(input&&!input.value)input.value=morningTomorrowMoscow().iso;
}
function morningSelectedDate() {
  morningInitDate();
  return morningDateFromISO(document.getElementById('morningDateInput')?.value);
}
function morningDateChanged() {
  if(!morningState.book){
    const status=document.getElementById('morningStatus');
    if(status)status.textContent='Дата выбрана. Получите план с MAIN или загрузите Excel ниже.';
    return;
  }
  morningBuildSelectedDate();
}
function morningBuildSelectedDate() {
  const status=document.getElementById('morningStatus');
  const area=document.getElementById('morningPreview');
  const picker=document.getElementById('morningColumnPicker');
  const exportBtn=document.getElementById('morningExportBtn');
  morningState.result=null;
  if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Дата изменена. Повтори проверку пакета iiko.');
  if(area)area.innerHTML='';
  if(exportBtn)exportBtn.hidden=true;
  if(picker)picker.hidden=true;
  try{
    const date=morningSelectedDate();
    if(!morningState.book)throw Error('Сначала получите Excel с MAIN или выберите файл вручную.');
    if(status)status.textContent='Ищу лист за '+date.day+'.'+date.month+'.'+date.year+' и крайний правый итоговый столбец…';
    morningState.result=morningAnalyze(morningState.book,date,null);
    morningPrintResult();
  }catch(e){
    if(status)status.textContent='Не удалось подготовить акты: '+(e.message||e);
    if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Акты не подготовлены: '+(e.message||e)+'. Сверка iiko не выполнена.');
  }
}
document.addEventListener('DOMContentLoaded',morningInitDate);

function morningMatchSheet(name,date){
  const s=String(name);
  const pattern=new RegExp('(^|\\D)'+Number(date.day)+'\\s*[.\\/-]\\s*'+Number(date.month)+'(?:\\s*[.\\/-]\\s*(\\d{2,4}))?(?!\\d)','g');
  let m;
  while((m=pattern.exec(s))){
    const yr=m[2];
    if(!yr||Number(yr)===Number(date.year)||Number(yr)===Number(date.year.slice(-2)))return true;
  }
  return false;
}
function morningRgb(color){
  if(!color||typeof color.rgb!=='string')return null;
  const raw=color.rgb.replace(/^#/,'').toUpperCase();
  const hex=raw.length===8?raw.slice(2):raw;
  if(!/^[0-9A-F]{6}$/.test(hex))return null;
  return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)];
}
function morningIsBlue(cell){
  const fill=cell&&cell.s&&cell.s.fill;
  if(!fill||fill.patternType==='none')return false;
  const rgb=morningRgb(fill.fgColor)||morningRgb(fill.bgColor);
  if(!rgb)return false;
  const [r,g,b]=rgb;
  // Neutral grey and green cells cannot match; allow both pale and saturated sky blue.
  return b-r>=13 && b-g>=4 && g-r>=-10 && b>=110;
}
function morningNumber(v){
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const s=String(v??'').replace(/\s/g,'').replace(',','.').trim();
  if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
function morningDateBook(book,date){
  const names=book.SheetNames.filter(n=>morningMatchSheet(n,date));
  if(!names.length)throw Error('Нет вкладки с датой '+date.day+'.'+date.month+'.'+date.year+'. Вкладки: '+book.SheetNames.join(', '));
  if(names.length!==1)throw Error('Найдено несколько вкладок на '+date.day+'.'+date.month+': '+names.join(', ')+'. Нужно уточнить дату.');
  return names[0];
}
function morningGetHeader(rows){
  for(let r=0;r<Math.min(rows.length,55);r++){
    const row=rows[r]||[];
    for(let c=0;c<Math.min(row.length,12);c++){
      if(/^(наименование|наименование блюда|блюдо|название блюда)$/.test(morningNorm(row[c]))){
        return {row:r,nameCol:c,codeCol:c>0?c-1:null};
      }
    }
  }
  throw Error('Не найдена строка заголовка «Наименование». Не выбираю блюда по предположению.');
}
function morningColumnSummary(ws,rows,header){
  const range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;
  if(!range)throw Error('Лист Excel пуст');
  const candidates=[];
  for(let c=header.nameCol+1;c<=Math.min(range.e.c,170);c++){
    let numeric=0,blue=0,blueNumbers=0,headerBlue=0;
    for(let r=Math.max(0,header.row-2);r<Math.min(rows.length,header.row+220);r++){
      const cell=ws[XLSX.utils.encode_cell({r,c})];
      const isBlue=morningIsBlue(cell);
      const qty=morningNumber(rows[r]?.[c]);
      if(r>header.row&&qty!==null&&qty>0){numeric++;if(isBlue)blueNumbers++}
      if(isBlue){blue++;if(r<=header.row+1)headerBlue++}
    }
    if(!numeric)continue;
    const name=String(rows[header.row]?.[c]??'').trim();
    candidates.push({col:c,label:XLSX.utils.encode_col(c),name,numeric,blue,blueNumbers,headerBlue});
  }
  // The plan's production totals are in the far-right populated quantity column.
  // The fill may be saved as an Excel theme color, so never rely on blue RGB detection.
  // Ignore isolated numbers in notes to the right of the production table.
  const quantityColumns=candidates.filter(c=>c.numeric>=5);
  return {candidates,rightmost:quantityColumns.length?quantityColumns[quantityColumns.length-1]:null};
}
function morningIsGroup(txt){
  return /^(выпечка|кондитерские изделия|холодные закуски|первые блюда|вторые блюда|гарниры|напитки|компоты|десерты|салаты|блюда для завтраков|завтраки|завтрак|дополнительный ассортимент|хлеб|комплексные обеды|комплексный обед|прочее)(\s*[:.]?)$/i.test(morningNorm(txt));
}
function morningFindSections(rows,header){
  let pastryStart=-1,compoteLast=-1,nextAfterPastry=rows.length;
  for(let i=header.row+1;i<rows.length;i++){
    const row=rows[i]||[];
    const n=morningNorm(row[header.nameCol]);
    const first=morningNorm(row[0]);
    const text=[n,first];
    const isPastry=text.some(t=>/^(выпечка|кондитерская выпечка|булочные изделия|хлебобулочные изделия)\s*:?\s*$/.test(t));
    if(isPastry&&pastryStart<0){pastryStart=i;continue}
    if(pastryStart<0){
      if(text.some(t=>/^компот(?:ы|\s|$|[:.])/.test(t)))compoteLast=i;
    }else if(i>pastryStart && (morningIsGroup(n)||morningIsGroup(first))){
      nextAfterPastry=i;break;
    }
  }
  if(pastryStart<0)throw Error('Не найден заголовок раздела «Выпечка». Нельзя надёжно распределить блюда на БК и ПК.');
  if(compoteLast>=pastryStart)throw Error('Компоты расположены после выпечки — проверьте структуру листа.');
  return {pastryStart,compoteLast,nextAfterPastry};
}
function morningExtract(rows,header,col,from,to,warnings){
  const result=[];
  for(let r=from;r<to;r++){
    const row=rows[r]||[];
    const name=String(row[header.nameCol]??'').trim();
    if(!name||morningIsGroup(name)||morningIsGroup(row[0])||/^(всего|итого|остаток|сумма|план|дата|заказ)/i.test(morningNorm(name)))continue;
    const raw=row[col];
    if(raw===null||raw===undefined||raw==='')continue;
    const quantity=morningNumber(raw);
    if(quantity===null){
      if(/[0-9]/.test(String(raw)))warnings.push('Строка '+(r+1)+': количество «'+String(raw)+'» не распознано ('+name+')');
      continue;
    }
    if(quantity<=0)continue;
    const code=header.codeCol===null?'':String(row[header.codeCol]??'').trim();
    result.push({name,quantity,code,weight:String(row[header.nameCol+1]??'').trim(),sourceRow:r+1});
  }
  return result;
}
// Parse only the selected day. The original Excel bytes remain in memory for changing dates.
function morningSheetOnDemand(book,name){
  if(book.Sheets&&book.Sheets[name])return book.Sheets[name];
  if(!morningState.bytes)throw Error('Для выбранного листа требуется повторно загрузить Excel.');
  const partial=XLSX.read(morningState.bytes,{
    type:'array',sheets:name,cellDates:true,cellStyles:false,
    cellFormula:false,cellHTML:false,cellText:false
  });
  const worksheet=partial.Sheets?.[name];
  if(!worksheet)throw Error('Не удалось прочитать лист «'+name+'».');
  if(!book.Sheets)book.Sheets={};
  book.Sheets[name]=worksheet;
  return worksheet;
}
function morningAnalyze(book,date,overrideColumn){
  if(typeof XLSX==='undefined')throw Error('Модуль Excel не загружен');
  const sheet=morningDateBook(book,date);
  const ws=morningSheetOnDemand(book,sheet);
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const header=morningGetHeader(rows);
  const columns=morningColumnSummary(ws,rows,header);
  const chosen=overrideColumn===null||overrideColumn===undefined?columns.rightmost:columns.candidates.find(c=>c.col===overrideColumn);
  if(!chosen)return {sheet,date,header,columns,needsColumn:true,documents:[],warnings:['Крайний правый столбец с итоговыми количествами не определён. Для проверки выберите его вручную.']};
  const bounds=morningFindSections(rows,header);
  const warnings=[];
  const breakfastEnd=bounds.compoteLast>=0?bounds.compoteLast+1:bounds.pastryStart;
  if(bounds.compoteLast<0)warnings.push('В листе не распознано слово «Компот». БК ограничена началом раздела «Выпечка». Проверьте границу до передачи в iiko.');
  if(bounds.compoteLast>=0&&breakfastEnd<bounds.pastryStart){
    const extra=morningExtract(rows,header,chosen.col,breakfastEnd,bounds.pastryStart,[]);
    if(extra.length)warnings.push('После последней строки компота и до выпечки есть ещё '+extra.length+' строк с количеством: они не включены в БК.');
  }
  const bk=morningExtract(rows,header,chosen.col,header.row+1,breakfastEnd,warnings);
  const pk=morningExtract(rows,header,chosen.col,bounds.pastryStart+1,bounds.nextAfterPastry,warnings);
  if(!bk.length)warnings.push('На Бухара кухня не найдено блюд с положительным количеством.');
  if(!pk.length)warnings.push('На Правда кухня не найдено выпечки с положительным количеством.');
  const documents=[
    {type:'production',date:date.iso,warehouse:'Бухара кухня',posted:false,items:bk},
    {type:'production',date:date.iso,warehouse:'Правда кухня',posted:false,items:pk}
  ];
  return {sheet,date,header,columns,selected:chosen,bounds,documents,warnings,needsColumn:false};
}
function morningPrintResult(){
  const area=document.getElementById('morningPreview');
  const status=document.getElementById('morningStatus');
  const picker=document.getElementById('morningColumnPicker');
  const exportBtn=document.getElementById('morningExportBtn');
  const r=morningState.result;
  if(!area||!status||!picker||!r)return;
  const opts=r.columns.candidates.map(c=>'<option value="'+c.col+'" '+(r.selected&&c.col===r.selected.col?'selected':'')+'>'+morningEscape(c.label+' · '+(c.name||'без заголовка')+' · '+c.numeric+' числовых значений'+(c.blue?', голубых ячеек '+c.blue:''))+'</option>').join('');
  picker.innerHTML='<option value="">Выбрать итоговый столбец</option>'+opts;
  picker.hidden=!r.needsColumn;
  exportBtn.hidden=Boolean(r.needsColumn);
  if(r.needsColumn){area.innerHTML='<p>Вкладка <b>'+morningEscape(r.sheet)+'</b> найдена. Не удалось определить крайний правый столбец итоговых количеств. Автоматического выбора нет.</p>';status.textContent='Требуется проверить итоговый столбец.';return}
  const cards=r.documents.map(d=>{
    const sum=d.items.reduce((s,x)=>s+x.quantity,0);
    const body=d.items.map(x=>'<tr><td>'+morningEscape(x.name)+'</td><td>'+morningEscape(x.weight||'')+'</td><td>'+morningEscape(x.quantity)+'</td></tr>').join('');
    return '<details open><summary><b>Акт приготовления · '+morningEscape(d.warehouse)+'</b> · '+d.items.length+' поз. · '+sum+' шт.</summary><div class="tablewrap"><table class="nomtable"><thead><tr><th>Блюдо</th><th>Вес / объём</th><th>Количество</th></tr></thead><tbody>'+body+'</tbody></table></div></details>'
  }).join('');
  const warnings=r.warnings.length?'<p style="color:#9d4b17"><b>Проверить:</b> '+r.warnings.map(morningEscape).join('; ')+'</p>':'';
  area.innerHTML='<p>Дата актов: <b>'+r.date.day+'.'+r.date.month+'.'+r.date.year+'</b>. Вкладка: <b>'+morningEscape(r.sheet)+'</b>. Крайний правый итоговый столбец: <b>'+morningEscape(r.selected.label)+'</b>.</p>'+warnings+cards;
  status.textContent='Предпросмотр готов. Это НЕ документы iiko. Никаких перемещений, расходных и проведения.';
  if(typeof iikoDraftAutoCheck==='function')iikoDraftAutoCheck();
}
function morningPrepareBook(book,name,bytes=null){
  morningState.book=book;morningState.bytes=bytes;morningState.fileName=name||'План производства.xlsx';
  if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Загружен другой Excel. Проверь акты перед выгрузкой.');
  morningState.result=null;morningState.selectedColumn=null;
  morningBuildSelectedDate();
}
function morningPrepareFromBytes(bytes,name){
  if(typeof XLSX==='undefined')throw Error('Модуль Excel не загружен');
  const metadata=XLSX.read(bytes,{type:'array',bookSheets:true});
  if(!metadata.SheetNames?.length)throw Error('В Excel нет листов');
  const book={SheetNames:metadata.SheetNames,Sheets:{}};
  morningPrepareBook(book,name,bytes);
  return book;
}
function morningRetryColumn(){
  if(!morningState.book)return;
  const value=document.getElementById('morningColumnPicker').value;
  if(value==='')return;
  try{
    if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Изменён столбец Excel. Повтори проверку iiko.');
    morningState.result=morningAnalyze(morningState.book,morningSelectedDate(),Number(value));
    morningPrintResult();
    document.getElementById('morningStatus').textContent='Столбец выбран. Номенклатура проверена автоматически, если справочник iiko загружен.';
  }catch(e){document.getElementById('morningStatus').textContent='Ошибка: '+(e.message||e)}
}
function morningExportPreview(){
  const r=morningState.result;
  if(!r||r.needsColumn)return;
  const data={schema:'pomogator.morning-preview.v1',sourceFile:morningState.fileName,sourceSheet:r.sheet,sourceColumn:r.selected.label,createdAt:new Date().toISOString(),notSentToIiko:true,documents:r.documents,warnings:r.warnings};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='prigotovlenie-'+r.date.iso+'-proverka.json';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
