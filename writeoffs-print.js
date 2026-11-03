'use strict';
// Печатный бланк «Колхоз». Не изменяет запись списаний или общий журнал.
const PRINT_STAFF_REASONS=new Set(['служебное питание','питание персонала','стафф питание']);
const PRINT_UTIL_TITLE='УТИЛИЗАЦИЯ (срок годности, брак, порча, возврат от покупателя)';

function getWriteoffPrintData(doc){
 const info=doc||{doc_date:$('docDate').value,shift:$('shift').value,warehouse:$('warehouse').value,status:currentStatus};
 const original=doc?(Array.isArray(doc.items)?doc.items:[]):collectRows(false);
 const items=original.filter(x=>String(x.name||'').trim().length>0);
 const staff=[],util=[];
 for(const item of items){
  if(PRINT_STAFF_REASONS.has(String(item.reason||'').trim().toLocaleLowerCase('ru')))staff.push(item);
  else util.push(item);
 }
 return {info,items,staff,util};
}
function writeoffPrintQuantity(item){
 return [String(item.qty??'').trim().replace('.',','),String(item.unit||'').trim()].filter(Boolean).join(' ');
}
function writeoffPadRows(rows,min=10){
 return [...rows,...Array.from({length:Math.max(0,min-rows.length)},()=>null)];
}
function printWriteoff(doc){
 let data;
 try{data=getWriteoffPrintData(doc)}catch(e){say('Ошибка подготовки печати: '+(e.message||e),'error');return}
 const {info,staff,util}=data;
 const renderRows=items=>writeoffPadRows(items).map(item=>
  '<tr><td>'+(item?esc(niceDate(info.doc_date)):'')+'</td>'
  +'<td>'+(item?esc(item.name):'')+'</td>'
  +'<td class="print-qty">'+(item?esc(writeoffPrintQuantity(item)):'')+'</td>'
  +'<td>'+(item&&!PRINT_STAFF_REASONS.has(String(item.reason||'').trim().toLocaleLowerCase('ru'))?esc(item.reason):'')+'</td></tr>'
 ).join('');
 const area=$('printArea');
 if(!area){say('Не найдена печатная форма. Обновите страницу.','error');return}
 area.innerHTML='<div class="print-sheet">'
  +'<div class="print-top"><h1>БЛАНК СПИСАНИЯ</h1>'
  +'<div class="print-meta"><div><b>Дата:</b> '+esc(niceDate(info.doc_date))+'</div>'
  +'<div><b>Смена:</b> '+esc(info.shift||'—')+'</div></div></div>'
  +'<div class="print-org"><span><b>Организация:</b> ИП Здобникова С. С.</span>'
  +'<span><b>Склад:</b> '+esc(info.warehouse||'—')+'</span></div>'
  +'<table class="print-table"><colgroup><col style="width:14%"><col style="width:48%"><col style="width:16%"><col style="width:22%"></colgroup>'
  +'<thead><tr><th>Дата</th><th>Наименование</th><th>Кол-во</th><th>Причина</th></tr></thead><tbody>'
  +'<tr class="print-section"><td colspan="4">СТАФФ ПИТАНИЕ</td></tr>'+renderRows(staff)
  +'<tr class="print-section"><td colspan="4">'+esc(PRINT_UTIL_TITLE)+'</td></tr>'+renderRows(util)
  +'</tbody></table></div>';
 window.print();
}
function excelPrintWorksheet(data){
 const {info,staff,util}=data;
 const rows=[
  ['БЛАНК СПИСАНИЯ','','',''],
  ['Организация','ИП Здобникова С. С.','Дата:',niceDate(info.doc_date)],
  ['Склад',info.warehouse||'—','Смена:',info.shift||'—'],
  ['Дата','Наименование','Кол-во','Причина']
 ];
 const sectionRows=[];
 const addSection=(label,items)=>{
  sectionRows.push(rows.length);
  rows.push([label,'','','']);
  for(const item of writeoffPadRows(items)){
   rows.push(item?[
    niceDate(info.doc_date),
    String(item.name||''),
    writeoffPrintQuantity(item),
    PRINT_STAFF_REASONS.has(String(item.reason||'').trim().toLocaleLowerCase('ru'))?'':String(item.reason||'')
   ]:['','','','']);
  }
 };
 addSection('СТАФФ ПИТАНИЕ',staff);
 addSection(PRINT_UTIL_TITLE,util);
 const ws=XLSX.utils.aoa_to_sheet(rows);
 ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:3}},...sectionRows.map(r=>({s:{r,c:0},e:{r,c:3}}))];
 ws['!cols']=[{wch:13},{wch:47},{wch:16},{wch:25}];
 ws['!rows']=rows.map((_,r)=>({hpt:r===0?40:(r===1||r===2)?25:r===3?30:sectionRows.includes(r)?31:28}));
 ws['!margins']={left:0.28,right:0.28,top:0.4,bottom:0.4,header:0.2,footer:0.2};
 const edge={style:'thin',color:{rgb:'000000'}};
 const outline={top:edge,bottom:edge,left:edge,right:edge};
 for(let r=0;r<rows.length;r++)for(let c=0;c<4;c++){
  const address=XLSX.utils.encode_cell({r,c});
  const cell=ws[address]||(ws[address]={t:'s',v:''});
  const title=r===0,meta=r===1||r===2,head=r===3,section=sectionRows.includes(r);
  cell.s={
   font:{name:'Arial',sz:title?22:head?12:section?10:11,
    bold:title||head||section||(meta&&(c===0||c===2)),color:{rgb:'111111'}},
   alignment:{vertical:'center',horizontal:title||head||section?'center':c===2?'center':'left',wrapText:true},
   fill:{patternType:'solid',fgColor:{rgb:section?'F0F0F0':'FFFFFF'}},
   ...(!title&&!meta?{border:outline}:{})
  };
 }
 return ws;
}
function exportWriteoffStyled(doc){
 if(typeof XLSX==='undefined'){say('Не загружена библиотека Excel. Обновите страницу.','error');return}
 let data;
 try{data=getWriteoffPrintData(doc)}catch(e){say('Ошибка экспорта: '+(e.message||e),'error');return}
 const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,excelPrintWorksheet(data),'Бланк списания');
 // Отдельная табличная вкладка сохраняет детали, включая код и единицу измерения.
 const info=data.info;
 const rows=[['Дата','Смена','Склад','Номенклатура','Код 1С','Количество','Ед. изм.','Причина','Статус']];
 for(const item of data.items)rows.push([
  niceDate(info.doc_date),info.shift||'',info.warehouse||'',item.name,item.code||'',
  String(item.qty||'').replace(',','.'),item.unit||'',item.reason||'',
  info.status==='submitted'?'Отправлено':'Черновик'
 ]);
 const sheet=XLSX.utils.aoa_to_sheet(rows);
 sheet['!cols']=[{wch:14},{wch:12},{wch:21},{wch:48},{wch:14},{wch:14},{wch:13},{wch:25},{wch:14}];
 sheet['!rows']=[{hpt:28}];
 sheet['!autofilter']={ref:'A1:I'+Math.max(1,rows.length)};
 for(let c=0;c<9;c++){
  const key=XLSX.utils.encode_cell({r:0,c});
  if(sheet[key])sheet[key].s={font:{name:'Arial',sz:11,bold:true,color:{rgb:'FFFFFF'}},
   fill:{patternType:'solid',fgColor:{rgb:'34465A'}},
   alignment:{vertical:'center',wrapText:true}};
 }
 XLSX.utils.book_append_sheet(wb,sheet,'Данные для учёта');
 XLSX.writeFile(wb,'Списание_Колхоз_'+(info.doc_date||today())+'.xlsx');
}
