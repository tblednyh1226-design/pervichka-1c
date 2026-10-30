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
  if(morningState.book)morningSyncSheetPicker();
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
    if(status)status.textContent='Ищу лист за '+date.day+'.'+date.month+'.'+date.year+' и столбец iiko…';
    morningState.result=morningAnalyze(morningState.book,date,null);
    morningPrintResult();
    morningSyncSheetPicker();
  }catch(e){
    if(status)status.textContent='Не удалось подготовить акты: '+(e.message||e);
    if(typeof iikoDraftInvalidate==='function')iikoDraftInvalidate('Акты не подготовлены: '+(e.message||e)+'. Сверка iiko не выполнена.');
  }
}
document.addEventListener('DOMContentLoaded',morningInitDate);

function morningMatchSheet(name,date){
  const s=String(name);
  const day=Number(date.day),month=Number(date.month);
  // Excel tabs can be "02.11Пн" or "2.11Пн": preserve optional leading zero.
  const d=day<10?'0?'+day:String(day);
  const mth=month<10?'0?'+month:String(month);
  const pattern=new RegExp('(^|\\D)'+d+'\\s*[.\\/-]\\s*'+mth+
    '(?:\\s*[.\\/-]\\s*(\\d{2,4}))?(?!\\d)','g');
  let m;
  while((m=pattern.exec(s))){
    const yr=m[2];
    if(!yr||Number(yr)===Number(date.year)||Number(yr)===Number(date.year.slice(-2)))return true;
  }
  return false;
}
function morningParseSheetDate(sheet){
  // Selectable date tabs: "02.11Пн", "2.11 Пн", "02.11.2026" etc.
  const m=/^\s*(0?[1-9]|[12]\d|3[01])\s*[.\/-]\s*(0?[1-9]|1[0-2])(?:(?:\s*[.\/-]\s*)(\d{2,4}))?(?!\d)/.exec(String(sheet));
  if(!m)return null;
  const day=Number(m[1]),month=Number(m[2]);
  const y=m[3]?Number(m[3]):null;
  const year=y===null?null:y<100?2000+y:y;
  const check=new Date(Date.UTC(year||2026,month-1,day));
  if(check.getUTCDate()!==day||check.getUTCMonth()+1!==month)return null;
  return {day,month,year};
}
function morningSyncSheetPicker(){
  const picker=document.getElementById('morningSheetSelect');
  if(!picker)return;
  const names=morningState.book?.SheetNames||[];
  const choices=names.filter(n=>morningParseSheetDate(n));
  if(!choices.length){
    picker.innerHTML='<option value="">Сначала загрузите план Excel</option>';
    picker.disabled=true;
    return;
  }
  picker.disabled=false;
  picker.innerHTML='<option value="">Выберите вкладку Excel</option>'+choices.map(n=>
    '<option value="'+morningEscape(n)+'">'+morningEscape(n)+'</option>').join('');
  const date=morningSelectedDate();
  const matches=choices.filter(n=>morningMatchSheet(n,date));
  picker.value=matches.length===1?matches[0]:'';
}
function morningSelectSheet(){
  const picker=document.getElementById('morningSheetSelect');
  if(!picker?.value)return;
  const entry=morningParseSheetDate(picker.value);
  if(!entry)return;
  const dateInput=document.getElementById('morningDateInput');
  let selectedYear=Number(String(dateInput?.value||'').slice(0,4));
  if(!Number.isInteger(selectedYear)||selectedYear<2000||selectedYear>2100){
    selectedYear=Number(morningTomorrowMoscow().year);
  }
  const year=entry.year||selectedYear;
  const iso=String(year)+'-'+String(entry.month).padStart(2,'0')+'-'+String(entry.day).padStart(2,'0');
  morningDateFromISO(iso); // Reject invalid calendar date without changing input.
  if(dateInput)dateInput.value=iso;
  morningBuildSelectedDate();
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
  if(!names.length)throw Error('Нет вкладки с датой '+date.day+'.'+date.month+'.'+date.year+'. Выберите дату из списка вкладок Excel ниже.');
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
// Quantities come exclusively from the column headed "iiko" on the selected date sheet.
function morningIikoColumn(ws,rows,header){
  const range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;
  if(!range)throw Error('Лист Excel пуст.');
  const matches=new Map();
  // Plan headers can span multiple lines. Scan around the header, not throughout dishes.
  const from=Math.max(0,header.row-6),to=Math.min(rows.length-1,header.row+1);
  for(let r=from;r<=to;r++){
    for(let c=range.s.c;c<=range.e.c;c++){
      const title=morningNorm(rows[r]?.[c]).replace(/[:.]$/,'').trim();
      if(title==='iiko'&&!matches.has(c)){
        matches.set(c,{col:c,label:XLSX.utils.encode_col(c),name:'iiko',headerRow:r});
      }
    }
  }
  if(!matches.size)throw Error('На листе не найден столбец «iiko». Количества из других столбцов не используются.');
  if(matches.size!==1)throw Error('На листе найдено несколько столбцов «iiko»: '+
    [...matches.values()].map(x=>x.label).join(', ')+'. Оставьте один столбец для выгрузки.');
  const selected=[...matches.values()][0];
  selected.numeric=0;
  for(let r=header.row+1;r<rows.length;r++){
    const value=morningNumber(rows[r]?.[selected.col]);
    if(value!==null&&value>0)selected.numeric++;
  }
  if(!selected.numeric)throw Error('Столбец «iiko» ('+selected.label+') найден, но в нём нет положительных количеств.');
  return selected;
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
function morningLargePieInPieces(name,weight){
  // Original production plan lists large pies as 1000гр.; it may later use "кус."
  // in the unit or name. Never convert ordinary 80гр. пирожки or small pies.
  const dish=morningNorm(name);
  if(!/^пирог(?:\\s|$)/.test(dish))return false;
  const unit=morningNorm(weight);
  if(/(?:^|[^а-я])кус\\.?(?=$|[^а-я])/.test(dish+' '+unit))return true;
  const m=/^(\\d+(?:[.,]\\d+)?)\\s*(кг|гр|г)\\.?$/.exec(unit);
  if(!m)return false;
  const grams=Number(m[1].replace(',','.'))*(m[2]==='кг'?1000:1);
  return grams>=900;
}
function morningExtract(rows,header,col,from,to,warnings,convertLargePies=false){
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
    const weight=String(row[header.nameCol+1]??'').trim();
    const slices=convertLargePies&&morningLargePieInPieces(name,weight);
    const finalQuantity=slices?quantity*8:quantity;
    result.push({
      name,quantity:finalQuantity,code,weight,sourceRow:r+1,
      ...(slices?{sourceQuantity:quantity,conversionFactor:8,quantityUnit:'кус.'}:{})
    });
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
function morningAnalyze(book,date){
  if(typeof XLSX==='undefined')throw Error('Модуль Excel не загружен');
  const sheet=morningDateBook(book,date);
  const ws=morningSheetOnDemand(book,sheet);
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const header=morningGetHeader(rows);
  const chosen=morningIikoColumn(ws,rows,header);
  const columns={iiko:chosen,candidates:[chosen]};
  const bounds=morningFindSections(rows,header);
  const warnings=[];
  const breakfastEnd=bounds.compoteLast>=0?bounds.compoteLast+1:bounds.pastryStart;
  if(bounds.compoteLast<0)warnings.push('В листе не распознано слово «Компот». БК ограничена началом раздела «Выпечка». Проверьте границу до передачи в iiko.');
  if(bounds.compoteLast>=0&&breakfastEnd<bounds.pastryStart){
    const extra=morningExtract(rows,header,chosen.col,breakfastEnd,bounds.pastryStart,[]);
    if(extra.length)warnings.push('После последней строки компота и до выпечки есть ещё '+extra.length+' строк с количеством: они не включены в БК.');
  }
  const bk=morningExtract(rows,header,chosen.col,header.row+1,breakfastEnd,warnings);
  const pk=morningExtract(rows,header,chosen.col,bounds.pastryStart+1,bounds.nextAfterPastry,warnings,true);
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
  if(!area||!status||!r)return;
  if(picker)picker.hidden=true; // No manual override: only the iiko column.
  if(exportBtn)exportBtn.hidden=Boolean(r.needsColumn);
  if(r.needsColumn)return;
  const cards=r.documents.map(d=>{
    const sum=d.items.reduce((s,x)=>s+x.quantity,0);
    // Weight is kept in the source records for validation, but not displayed in the act preview.
    const body=d.items.map(x=>'<tr><td>'+morningEscape(x.name)+'</td><td>'+morningEscape(x.quantity)+'</td></tr>').join('');
    return '<details open><summary><b>Акт приготовления · '+morningEscape(d.warehouse)+'</b> · '+d.items.length+' поз. · '+sum+' шт.</summary><div class="tablewrap"><table class="nomtable morning-acts-table"><thead><tr><th>Блюдо</th><th>Количество</th></tr></thead><tbody>'+body+'</tbody></table></div></details>'
  }).join('');
  const warnings=r.warnings.length?'<p style="color:#9d4b17"><b>Проверить:</b> '+r.warnings.map(morningEscape).join('; ')+'</p>':'';
  const slices=r.documents.flatMap(d=>d.items.filter(x=>x.conversionFactor===8));
  const convertedPies=slices.reduce((n,x)=>n+x.sourceQuantity,0);
  const convertedPieces=slices.reduce((n,x)=>n+x.quantity,0);
  const conversionNote=slices.length?'<p><b>Большие пироги:</b> '+morningEscape(convertedPies)+
    ' пирогов × 8 = '+morningEscape(convertedPieces)+' кусков. В акты включены куски.</p>':'';
  area.innerHTML='<p>Дата актов: <b>'+r.date.day+'.'+r.date.month+'.'+r.date.year+'</b>. Вкладка: <b>'+morningEscape(r.sheet)+'</b>. Источник количеств — iiko (столбец <b>'+morningEscape(r.selected.label)+'</b>).</p>'+warnings+conversionNote+cards;
  status.textContent='Предпросмотр готов. Это НЕ документы iiko. Никаких перемещений, расходных и проведения.';
  if(typeof iikoDraftAutoCheck==='function')iikoDraftAutoCheck();
}
function morningPrepareBook(book,name,bytes=null){
  morningState.book=book;morningState.bytes=bytes;morningState.fileName=name||'План производства.xlsx';
  morningSyncSheetPicker();
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
function morningExportPreview(){
  const r=morningState.result;
  if(!r||r.needsColumn||!Array.isArray(r.documents)||r.documents.length!==2){
    const status=document.getElementById('morningStatus');
    if(status)status.textContent='Сначала сформируйте два акта приготовления за выбранную дату.';
    return;
  }
  if(typeof XLSX==='undefined'||!XLSX.utils?.aoa_to_sheet||!XLSX.writeFile){
    const status=document.getElementById('morningStatus');
    if(status)status.textContent='Не загружен модуль Excel. Обновите страницу и повторите скачивание.';
    return;
  }
  const book=XLSX.utils.book_new();
  const palette={header:'155EEF',light:'EAF2FF',dark:'101828',muted:'667085',border:'D0D5DD'};
  for(let i=0;i<r.documents.length;i++){
    const doc=r.documents[i];
    const name=i===0?'Бухара кухня':'Правда кухня';
    const items=doc.items||[];
    const total=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
    const rows=[
      ['АКТ ПРИГОТОВЛЕНИЯ — '+name,''],
      ['Дата приготовления',r.date.iso],
      ['Вкладка плана',r.sheet],
      ['Столбец количеств iiko',r.selected.label],
      ['Статус',items.some(item=>item.conversionFactor===8)
        ?'Для проверки: большие пироги ×8 (куски). В iiko не отправлено'
        :'Для проверки, в iiko не отправлено'],
      ['Блюдо','Количество'],
      ...items.map(item=>[String(item.name||''),Number(item.quantity)||0]),
      ['ИТОГО',total]
    ];
    const sheet=XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols']=[{wch:56},{wch:25}];
    sheet['!rows']=[{hpt:30},{hpt:22},{hpt:22},{hpt:22},{hpt:22},{hpt:26}];
    sheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:1}}];
    sheet['!autofilter']={ref:'A6:B'+(items.length+6)};
    for(let row=0;row<rows.length;row++){
      for(let col=0;col<2;col++){
        const ref=XLSX.utils.encode_cell({r:row,c:col});
        const cell=sheet[ref];if(!cell)continue;
        if(row===0)cell.s={font:{bold:true,color:{rgb:'FFFFFF'},sz:15},fill:{fgColor:{rgb:palette.header}},alignment:{vertical:'center'}};
        else if(row===5)cell.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:palette.header}},alignment:{vertical:'center'},border:{bottom:{style:'thin',color:{rgb:palette.border}}}};
        else if(row===rows.length-1)cell.s={font:{bold:true,color:{rgb:palette.dark}},fill:{fgColor:{rgb:palette.light}},border:{top:{style:'thin',color:{rgb:palette.border}}}};
        else if(row>=6)cell.s={font:{color:{rgb:palette.dark}},alignment:{vertical:'center',wrapText:true},border:{bottom:{style:'hair',color:{rgb:'E5E7EB'}}}};
        else cell.s={font:{color:{rgb:col===0?palette.muted:palette.dark},bold:col===0},alignment:{vertical:'center',wrapText:col===1}};
        if(col===1&&row>=6&&typeof cell.v==='number')cell.z='0.##';
      }
    }
    XLSX.utils.book_append_sheet(book,sheet,name);
  }
  if((r.warnings||[]).length){
    const rows=[['ЗАМЕЧАНИЯ К ПЛАНУ'],['Дата приготовления',r.date.iso],['Лист Excel',r.sheet],['Причина для проверки'],...r.warnings.map(x=>[String(x)])];
    const notes=XLSX.utils.aoa_to_sheet(rows);
    notes['!cols']=[{wch:105},{wch:24}];
    notes['!merges']=[{s:{r:0,c:0},e:{r:0,c:1}}];
    for(let row=0;row<rows.length;row++){
      const cell=notes['A'+(row+1)];if(!cell)continue;
      cell.s=row===0?{font:{bold:true,color:{rgb:'FFFFFF'},sz:14},fill:{fgColor:{rgb:palette.header}}}:
        {alignment:{vertical:'top',wrapText:true},font:{color:{rgb:palette.dark}}};
    }
    notes['!rows']=rows.map((_,i)=>({hpt:i>=4?50:24}));
    XLSX.utils.book_append_sheet(book,notes,'Замечания');
  }
  const filename='Акты приготовления '+r.date.iso+' БК и ПК.xlsx';
  XLSX.writeFile(book,filename,{bookType:'xlsx',compression:true});
}
