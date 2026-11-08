
'use strict';
/* Акты сверки — клиентская обработка: документы не отправляются на сервер. */
const reconState = {a:[], b:[], parsed:[], report:[], issues:[], busy:false, aItems:[], bItems:[]};
const reconDateRx = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/;
const reconMoneyRx = /(?<![\d.\/-])-?(?:\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+)[,.]\d{2}(?![\d.\/-])/g;
function reconHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function reconMoney(v){
  if(typeof v==='number') return Number.isFinite(v)?v:null;
  let s=String(v??'').replace(/\u2212/g,'-').replace(/руб(?:лей|ля|ль)?\.?/gi,'').replace(/[\s\u00a0\u202f₽]/g,'').trim();
  if(!s || !/^-?[\d.,]+$/.test(s))return null;
  const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
  if(comma>=0 && dot>=0)s=comma>dot?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
  else if(comma>=0)s=s.replace(',','.');
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
function reconDate(v){
  const s=String(v??'').trim();
  const iso=s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const m=iso?null:s.match(reconDateRx);
  if(!iso&&!m)return '';
  let year=Number(iso?iso[1]:m[3]);if(year<100)year+=year>=70?1900:2000;
  const d=Number(iso?iso[3]:m[1]),mo=Number(iso?iso[2]:m[2]);
  if(mo<1||mo>12||d<1||d>31)return '';
  const date=new Date(Date.UTC(year,mo-1,d));
  if(date.getUTCDate()!==d||date.getUTCMonth()!==mo-1)return '';
  return [year,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
function reconDayGap(a,b){if(!a||!b)return 999;return Math.abs((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);}
function reconNum(s){
  const t=String(s??'');
  let m=t.match(/(?:№|N\s?°|No\.?)\s*([A-Za-zА-Яа-я0-9\/_-]{1,28})/i);
  if(!m)m=t.match(/(?:накладная|реализация|поступление|счет(?:-фактура)?|счёт|упд|акт|платежное поручение|платёжное поручение)\s+([0-9][\w\/-]{1,25})(?=\s|$)/i);
  return m?m[1].toLowerCase().replace(/^0+(?=\d)/,''):'';
}
function reconKind(s){
  const x=String(s??'').toLowerCase();
  if(/возврат|корректиров|сторнир/.test(x))return 'correction';
  if(/плат[её]ж|оплат|перечислен|расчетн.*счет|расчётн.*сч[её]т|списание с р\/с|поступление на р\/с/.test(x))return 'payment';
  if(/реализац|поступление товаров|накладн|упд|счет-фактура|счёт-фактура|оказан.*услуг|выполнен.*работ|акт\s+№|акт\s+[0-9]/.test(x))return 'invoice';
  return 'other';
}
function reconLabelKind(k){return {payment:'Оплата',invoice:'Отгрузка / услуги',correction:'Корректировка',other:'Документ'}[k]||'Документ';}
function reconLooksBalance(t){return /сальдо|остаток (?:на|по)|задолженность (?:на|по)/i.test(t);}
function reconLooksTurnover(t){return /оборот(?:ы|ов)? за|итого (?:за|по|дебет|кредит)|всего за период/i.test(t);}
function reconCleanDesc(s){return String(s??'').replace(reconDateRx,' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g,' ').replace(reconMoneyRx,' ').replace(/\s+/g,' ').trim();}
function reconEntry(raw,side,source,sheet,amount,direction){
  const date=reconDate(raw),desc=reconCleanDesc(raw);
  const id=reconNum(raw);
  return {date,number:id,desc:desc.slice(0,220),amount:Math.round(amount*100)/100,direction:direction||'',kind:reconKind(raw),side,source,sheet};
}
function reconReportRows(rows,side,source,sheet,range){
  const result={entries:[],balances:[],warnings:[]};
  if(!rows?.length)return result;
  const start=range?.[0]??0,end=range?.[1]??Math.max(...rows.map(x=>x.length),0);
  const scoped=rows.map(r=>r.slice(start,end));
  let header=-1,best=-1;
  for(let i=0;i<Math.min(90,scoped.length);i++){
    const l=scoped[i].map(x=>String(x??'').toLowerCase().trim());
    const score=l.filter(x=>/^(дебет|кредит|дт|кт)(?:\s|$)/.test(x)).length*3 + l.filter(x=>/^дата(?:\s|$)/.test(x)).length*2 + l.filter(x=>/^(документ|операция|содержание|наименование)/.test(x)).length;
    if(score>best && score>=3){best=score;header=i;}
  }
  const labels=header>=0?scoped[header].map(x=>String(x??'').toLowerCase().trim()):[];
  const debits=[],credits=[],sums=[];
  labels.forEach((x,i)=>{if(/^(дебет|дт)(?:\s|$)/.test(x))debits.push(i);else if(/^(кредит|кт)(?:\s|$)/.test(x))credits.push(i);else if(/^сумма(?:\s|$)/.test(x))sums.push(i);});
  const dateCol=labels.findIndex(x=>/^дата(?:\s|$)/.test(x));
  const docCol=labels.findIndex(x=>/^(документ|операция|содержание|наименование)/.test(x));
  const getMoney=(r,ix)=>ix>=0&&ix<r.length?reconMoney(r[ix]):null;
  for(let i=header>=0?header+1:0;i<scoped.length;i++){
    const cells=scoped[i].map(x=>String(x??'').trim());
    if(!cells.some(Boolean))continue;
    const raw=cells.filter(Boolean).join(' ');
    if(/акт сверки|по данным|сверка расчетов|сверка расчётов|договор|наименовани[ея] сторон/i.test(raw) && !reconDate(raw))continue;
    if(/^(дата|документ|дебет|кредит|сумма)\b/i.test(raw) && !reconDate(raw))continue;
    let debit=debits.length?getMoney(cells,debits[0]):null;
    let credit=credits.length?getMoney(cells,credits[0]):null;
    let amount=null,direction='';
    if(debit!==null && debit!==0){amount=debit;direction='Дебет';}
    if(credit!==null && credit!==0){
      if(amount!==null && !reconLooksBalance(raw) && !reconLooksTurnover(raw)){result.warnings.push(source+': строка '+(i+1)+' — заполнены и дебет, и кредит; проверьте вручную');continue;}
      amount=amount===null?credit:Math.max(Math.abs(credit),Math.abs(amount));direction=amount===credit?'Кредит':'Дебет';
    }
    if(amount===null && sums.length)amount=getMoney(cells,sums[0]);
    if(amount===null){
      const candidates=[];
      for(let c=0;c<cells.length;c++){
        if(c===dateCol||c===docCol)continue;
        const m=reconMoney(cells[c]);if(m!==null && /[,.]\d{2}\b/.test(cells[c]))candidates.push(m);
      }
      if(candidates.length)amount=candidates[candidates.length-1];
      else{
        const matches=raw.match(reconMoneyRx)||[];
        if(matches.length)amount=reconMoney(matches[matches.length-1]);
      }
    }
    if(amount===null)continue;
    if(reconLooksBalance(raw)||reconLooksTurnover(raw)){
      result.balances.push({label:reconLooksTurnover(raw)?'Обороты':'Сальдо',stage:/начал/i.test(raw)?'Начальное':/конец|конеч|исходящ/i.test(raw)?'Конечное':'Другое',amount:Math.abs(amount),source,side,sheet});
      continue;
    }
    const date=dateCol>=0?reconDate(cells[dateCol]):reconDate(raw);
    if(!date && !reconNum(raw))continue;
    const description=docCol>=0 && cells[docCol]?cells[docCol]:raw;
    const entry=reconEntry(date+' '+description,side,source,sheet,amount,direction);
    if(!entry.date)entry.date=reconDate(raw);
    if(!entry.number)entry.number=reconNum(raw);
    if(!entry.desc)entry.desc=reconCleanDesc(raw);
    result.entries.push(entry);
  }
  return result;
}
function reconDualInfo(rows){
  const count=Math.max(0,...rows.map(x=>x.length));
  for(let i=0;i<Math.min(rows.length,90);i++){
    const cells=rows[i].map(x=>String(x??'').trim().toLowerCase());
    const dc=cells.map((x,k)=>/^(дебет|кредит)(?:\s|$)/.test(x)?k:-1).filter(x=>x>=0);
    if(dc.length>=4){
      const dates=cells.map((x,k)=>/^дата(?:\s|$)/.test(x)?k:-1).filter(x=>x>=0);
      const pivot=dates.length>=2?dates[1]:Math.max(dc[1]+1,Math.floor((dc[1]+dc[2])/2));
      if(pivot>0 && pivot<count)return pivot;
    }
  }
  return 0;
}
function reconParseExcel(file,side){
  return file.arrayBuffer().then(buf=>{
    if(typeof XLSX==='undefined')throw new Error('Не загружена библиотека Excel');
    const book=XLSX.read(buf,{type:'array',cellDates:false});
    const docs=[];
    for(const sheet of book.SheetNames){
      const rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,raw:false,defval:''});
      const pivot=reconDualInfo(rows);
      if(pivot){
        docs.push({side,source:file.name,sheet,pivot,sourceType:'excel',raw:'',left:reconReportRows(rows,side,file.name,sheet,[0,pivot]),right:reconReportRows(rows,side,file.name,sheet,[pivot,Math.max(...rows.map(x=>x.length),pivot+1)])});
      }else{
        docs.push({side,source:file.name,sheet,pivot:0,sourceType:'excel',raw:'',left:reconReportRows(rows,side,file.name,sheet),right:null});
      }
    }
    return docs;
  });
}
function reconParseText(text,side,source,sheet){
  const rows=String(text||'').split(/\r?\n/).map(s=>s.replace(/\t/g,'  ').trim()).filter(Boolean);
  const out={entries:[],balances:[],warnings:[]};
  for(let i=0;i<rows.length;i++){
    const raw=rows[i];
    if(/акт сверки|по данным|наименование|период|договор|данные организации/i.test(raw)&&!reconDate(raw))continue;
    const matches=raw.match(reconMoneyRx)||[];
    if(!matches.length)continue;
    const amount=reconMoney(matches[matches.length-1]);
    if(amount===null)continue;
    if(reconLooksBalance(raw)||reconLooksTurnover(raw)){
      out.balances.push({label:reconLooksTurnover(raw)?'Обороты':'Сальдо',stage:/начал/i.test(raw)?'Начальное':/конец|конеч|исходящ/i.test(raw)?'Конечное':'Другое',amount:Math.abs(amount),source,side,sheet});
      continue;
    }
    if(!reconDate(raw))continue;
    const entry=reconEntry(raw,side,source,sheet,amount,'');
    out.entries.push(entry);
  }
  if(!out.entries.length)out.warnings.push(source+': не удалось надёжно выделить даты и суммы. Проверьте текст распознавания.');
  return out;
}
let reconOcrWorker=null;
async function reconOcr(image){
  if(typeof Tesseract==='undefined')throw new Error('Не загрузилась библиотека распознавания фото');
  if(!reconOcrWorker)reconOcrWorker=await Tesseract.createWorker('rus+eng',1);
  const r=await reconOcrWorker.recognize(image);
  return {text:r.data.text||'',confidence:Number(r.data.confidence)||0};
}
async function reconParsePdf(file,side,progress){
  if(typeof pdfjsLib==='undefined')throw new Error('Не загрузилась библиотека PDF');
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const docs=[];
  try{
    for(let p=1;p<=pdf.numPages;p++){
      progress(file.name+': страница '+p+' из '+pdf.numPages);
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const positioned=content.items.filter(x=>x.str?.trim()).map(x=>({s:x.str,y:x.transform[5],x:x.transform[4]}));
      positioned.sort((a,b)=>b.y-a.y||a.x-b.x);
      const lines=[];
      for(const cell of positioned){
        let line=lines.find(x=>Math.abs(x.y-cell.y)<3);
        if(!line){line={y:cell.y,parts:[]};lines.push(line);}
        line.parts.push(cell);
      }
      lines.sort((a,b)=>b.y-a.y);
      let raw=lines.map(l=>l.parts.sort((a,b)=>a.x-b.x).map(x=>x.s).join(' ')).join('\n');
      let confidence=100,sourceType='pdf-text';
      if(raw.trim().length<80){
        const viewport=page.getViewport({scale:1.8});
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const out=await reconOcr(canvas);
        raw=out.text;confidence=out.confidence;sourceType='pdf-ocr';
        canvas.width=0;canvas.height=0;
      }
      const parse=reconParseText(raw,side,file.name,'Стр. '+p);
      if(confidence<65 && sourceType==='pdf-ocr')parse.warnings.push(file.name+': страница '+p+' — низкая точность OCR ('+Math.round(confidence)+'%).');
      docs.push({side,source:file.name,sheet:'Стр. '+p,pivot:0,sourceType,raw,left:parse,right:null});
    }
  }finally{await pdf.destroy();}
  return docs;
}
async function reconParseFile(file,side,progress){
  const ext=file.name.split('.').pop().toLowerCase();
  if(['xlsx','xls','csv'].includes(ext))return reconParseExcel(file,side);
  if(ext==='pdf')return reconParsePdf(file,side,progress);
  if(file.type.startsWith('image/')||['png','jpg','jpeg','webp','bmp','tif','tiff'].includes(ext)){
    const ocr=await reconOcr(file);
    const left=reconParseText(ocr.text,side,file.name,'Фото');
    if(ocr.confidence<65)left.warnings.push(file.name+': качество распознавания '+Math.round(ocr.confidence)+'%.');
    return [{side,source:file.name,sheet:'Фото',pivot:0,sourceType:'ocr',raw:ocr.text,left,right:null}];
  }
  if(['txt'].includes(ext)){
    const raw=await file.text();
    return [{side,source:file.name,sheet:'Текст',pivot:0,sourceType:'text',raw,left:reconParseText(raw,side,file.name,'Текст'),right:null}];
  }
  throw new Error('Неподдерживаемый тип файла: '+file.name);
}
function reconFilesChanged(side){
  const el=document.getElementById(side==='a'?'reconFilesA':'reconFilesB');
  reconState[side].push(...Array.from(el.files||[]));el.value='';
  reconDrawFiles();
}
function reconRemoveFile(side,n){if(reconState.busy)return;reconState[side].splice(n,1);reconDrawFiles();}
function reconDrawFiles(){
  for(const side of ['a','b']){
    const div=document.getElementById(side==='a'?'reconListA':'reconListB');
    if(!div)return;
    div.innerHTML=reconState[side].length?reconState[side].map((f,i)=>'<div class="recon-file"><span>'+reconHtml(f.name)+'</span><button type="button" onclick="reconRemoveFile(\''+side+'\','+i+')">Удалить</button></div>').join(''):'<span class="muted">Файлы не выбраны</span>';
  }
}
function reconSameNum(a,b){return Boolean(a.number&&b.number&&a.number===b.number);}
function reconSimilarity(a,b){
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\b(от|за|для|по|акт|документ|услуги|товары|товаров|поступление|реализация|номер)\b/g,' ').replace(/[^a-zа-я0-9]+/g,' ').split(' ').filter(x=>x.length>=3);
  const x=new Set(norm(a.desc)),y=new Set(norm(b.desc));
  if(!x.size||!y.size)return 0;
  let hits=0;for(const k of x)if(y.has(k))hits++;
  return hits/Math.max(x.size,y.size);
}
function reconPairScore(a,b,tol){
  const numbered=reconSameNum(a,b),gap=reconDayGap(a.date,b.date),diff=Math.abs(a.amount-b.amount),similarity=reconSimilarity(a,b);
  if(a.number && b.number && !numbered)return -1;
  if(numbered && gap>31 && a.date && b.date)return -1;
  if(a.kind!=='other' && b.kind!=='other' && a.kind!==b.kind)return -1;
  if(!numbered && gap>7)return -1;
  if(!numbered && diff>tol && !(gap===0 && similarity>=0.5))return -1;
  if(!numbered && diff<=tol && gap>3 && similarity<0.5)return -1;
  let score=0;
  if(numbered)score+=75;
  if(diff<=tol)score+=42;else if(numbered)score+=Math.max(0,12-diff/100);
  if(gap===0)score+=27;else if(gap<=3)score+=16;else if(gap<=7)score+=5;
  score+=similarity*17;
  if(a.kind===b.kind && a.kind!=='other')score+=7;
  return score;
}
function reconCompare(a,b,tol){
  const used=new Set(),report=[];
  const indexedA=a.map((entry,idx)=>({...entry,_idx:idx})).sort((x,y)=>Number(Boolean(y.number))-Number(Boolean(x.number)));
  for(const x of indexedA){
    const candidates=[];
    for(let j=0;j<b.length;j++){
      if(used.has(j))continue;
      const score=reconPairScore(x,b[j],tol);
      if(score>=45)candidates.push({j,score});
    }
    candidates.sort((p,q)=>q.score-p.score);
    if(!candidates.length){report.push({status:'Нет у контрагента',a:x,b:null,diff:x.amount,note:''});continue;}
    if(candidates.length>1 && candidates[0].score-candidates[1].score<3 && !x.number){
      report.push({status:'Требует проверки',a:x,b:null,diff:x.amount,note:'Несколько похожих операций у контрагента; автоматическое сопоставление не выполнено'});
      continue;
    }
    const y=b[candidates[0].j];used.add(candidates[0].j);
    const diff=Math.round((x.amount-y.amount)*100)/100;
    const changedDate=x.date&&y.date&&x.date!==y.date;
    const changedSum=Math.abs(diff)>tol;
    const status=changedSum?'Разная сумма':changedDate?'Разные даты':'Совпадает';
    let note='';
    if(!x.number||!y.number)note='Проверьте номер: сопоставлено по дате / сумме / описанию';
    report.push({status,a:x,b:y,diff,note});
  }
  for(let j=0;j<b.length;j++)if(!used.has(j))report.push({status:'Нет у нас',a:null,b:b[j],diff:-b[j].amount,note:''});
  return report.sort((x,y)=>String(x.a?.date||x.b?.date).localeCompare(String(y.a?.date||y.b?.date)));
}
function reconDuplicates(items,side){
  const seen=new Map(),warnings=[];
  for(const x of items){
    if(!x.number)continue;
    const key=x.date+'|'+x.number+'|'+x.amount;
    if(seen.has(key))warnings.push('Возможный дубль '+(side==='a'?'у нас':'у контрагента')+': '+x.date+', № '+x.number+', '+x.amount.toFixed(2)+' ₽ ('+x.source+')');
    seen.set(key,x);
  }
  return warnings;
}
function reconSelected(doc,side,autoRight){
  const select=document.getElementById(side==='a'?'reconColumnA':'reconColumnB');
  const mode=select?.value||'left';
  return autoRight?doc.right:(mode==='right'&&doc.right?doc.right:doc.left);
}
function reconFormatMoney(n){return typeof n==='number'?n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽':'—';}
function reconStatus(msg){const el=document.getElementById('reconStatus');if(el)el.textContent=msg;}
function reconControls(docs,side,autoRight){
  const result=[];
  for(const doc of docs){const selected=reconSelected(doc,side,autoRight);result.push(...(selected?.balances||[]));}
  return result;
}
function reconBalanceSummary(a,b,tol){
  const find=(items,stage)=>items.filter(x=>x.label==='Сальдо'&&x.stage===stage);
  const parts=[];
  for(const stage of ['Начальное','Конечное']){
    const x=find(a,stage),y=find(b,stage);
    if(x.length===1&&y.length===1){
      const delta=Math.round((x[0].amount-y[0].amount)*100)/100;
      parts.push('<div><b>'+stage+' сальдо:</b> у нас '+reconFormatMoney(x[0].amount)+', у контрагента '+reconFormatMoney(y[0].amount)+' — '+(Math.abs(delta)<=tol?'по сумме совпадает':'расхождение '+reconFormatMoney(Math.abs(delta)))+'</div>');
    }else if(x.length||y.length){
      parts.push('<div class="muted">'+stage+' сальдо: найдено '+x.length+' знач. у нас и '+y.length+' у контрагента. Итог по нескольким актам нужно проверять по каждому контрагенту и периоду.</div>');
    }
  }
  return parts.join('');
}
function reconShowPreview(docs){
  const panel=document.getElementById('reconPreview');
  panel.innerHTML=docs.map((d,i)=>{
    const parse=reconSelected(d,d.side,false);
    return '<details class="recon-doc"><summary>'+reconHtml(d.source)+' · '+reconHtml(d.sheet)+' · '+parse.entries.length+' операций'+(d.pivot?' · две стороны':'')+'</summary>'+
      '<div class="muted">Найденные операции: '+parse.entries.length+'. Сальдо и оборотов: '+parse.balances.length+'.</div>'+
      (parse.entries.length?'<div class="tablewrap"><table class="nomtable"><thead><tr><th>Дата</th><th>Номер</th><th>Операция</th><th>Сумма</th></tr></thead><tbody>'+parse.entries.slice(0,120).map(x=>'<tr><td>'+reconHtml(x.date)+'</td><td>'+reconHtml(x.number)+'</td><td>'+reconHtml(x.desc)+'</td><td>'+reconFormatMoney(x.amount)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="recon-error">Строки операций не обнаружены.</p>')+
      (d.raw?'<label>Распознанный текст (можно исправить и пересчитать)<textarea id="reconRaw'+i+'" rows="7">'+reconHtml(d.raw)+'</textarea></label><button type="button" onclick="reconApplyText('+i+')">Применить исправления</button>':'')+'</details>';
  }).join('');
}
function reconApplyText(index){
  const doc=reconState.parsed[index];if(!doc||!doc.raw)return;
  const el=document.getElementById('reconRaw'+index);if(!el)return;
  doc.raw=el.value;doc.left=reconParseText(el.value,doc.side,doc.source,doc.sheet);
  reconBuildResult();
  reconStatus('Исправленный текст применён. Расхождения пересчитаны.');
}
function reconBuildResult(){
  const docs=reconState.parsed;
  const autoRight=!reconState.b.length&&docs.some(d=>d.side==='a'&&d.right);
  const listA=[],listB=[],warnings=[...reconState.issues];
  for(const d of docs){
    const data=reconSelected(d,d.side,false);
    warnings.push(...(data?.warnings||[]));
    if(d.side==='a')listA.push(...data.entries);
    else listB.push(...data.entries);
    if(autoRight && d.side==='a'&&d.right){
      listB.push(...d.right.entries.map(x=>({...x,side:'b'})));
      warnings.push(...d.right.warnings);
    }
  }
  warnings.push(...reconDuplicates(listA,'a'),...reconDuplicates(listB,'b'));
  const result=document.getElementById('reconResult');
  reconState.aItems=listA;reconState.bItems=listB;
  if(!listA.length||!listB.length){
    reconState.report=[];
    result.innerHTML='<p class="recon-error">Недостаточно данных для сверки: найдено '+listA.length+' операций у нас и '+listB.length+' у контрагента. Загрузите документы обеих сторон (или один двусторонний Excel) и проверьте распознавание.</p>';
    document.getElementById('reconQuality').innerHTML=warnings.length?'<h3>Нужно проверить</h3><ul>'+warnings.map(x=>'<li>'+reconHtml(x)+'</li>').join('')+'</ul>':'';
    reconShowPreview(docs);
    return;
  }
  const tol=Math.max(0,Number(document.getElementById('reconTolerance').value)||0.01);
  const report=reconCompare(listA,listB,tol);
  reconState.report=report;
  const differences=report.filter(r=>r.status!=='Совпадает');
  const summary='<div class="recon-stats"><div><b>'+listA.length+'</b><span>У нас</span></div><div><b>'+listB.length+'</b><span>У контрагента</span></div><div><b>'+report.filter(r=>r.status==='Совпадает').length+'</b><span>Совпало</span></div><div><b>'+differences.length+'</b><span>Расхождений / проверки</span></div></div>';
  const rows=differences.map(r=>'<tr><td><b>'+reconHtml(r.status)+'</b></td><td>'+reconHtml(r.a?.date||'—')+'</td><td>'+reconHtml(r.a?.number||'—')+'</td><td>'+reconHtml(r.a?.desc||'—')+'</td><td>'+reconFormatMoney(r.a?.amount)+'</td><td>'+reconHtml(r.b?.date||'—')+'</td><td>'+reconHtml(r.b?.number||'—')+'</td><td>'+reconHtml(r.b?.desc||'—')+'</td><td>'+reconFormatMoney(r.b?.amount)+'</td><td>'+reconFormatMoney(r.diff)+'</td><td>'+reconHtml(r.note||'')+'</td></tr>').join('');
  const balance=reconBalanceSummary(reconControls(docs.filter(d=>d.side==='a'),'a',false),autoRight?docs.filter(d=>d.right).flatMap(d=>d.right.balances):reconControls(docs.filter(d=>d.side==='b'),'b',false),tol);
  result.innerHTML=summary+(differences.length?'<h3>Выявленные расхождения</h3><div class="tablewrap"><table class="nomtable"><thead><tr><th>Тип</th><th>Дата у нас</th><th>№ у нас</th><th>Документ у нас</th><th>Сумма у нас</th><th>Дата у контрагента</th><th>№ контрагента</th><th>Документ контрагента</th><th>Сумма контрагента</th><th>Разница, ₽</th><th>Примечание</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="recon-success">По распознанным операциям расхождений не обнаружено.</p>')+
    (balance?'<h3>Контроль сальдо</h3><div class="recon-balance">'+balance+'</div>':'')+
    '<button type="button" class="primary" onclick="reconExport()">Скачать результат в Excel</button>';
  const quality=document.getElementById('reconQuality');
  quality.innerHTML=warnings.length?'<h3>Требует внимания ('+warnings.length+')</h3><ul>'+warnings.map(x=>'<li>'+reconHtml(x)+'</li>').join('')+'</ul>':'<p class="muted">Необработанных файлов или предупреждений не обнаружено.</p>';
  reconShowPreview(docs);
}
function reconExport(){
  if(typeof XLSX==='undefined'||!reconState.report.length)return;
  const rows=reconState.report.map(r=>({
    'Результат':r.status,'Дата у нас':r.a?.date||'','№ у нас':r.a?.number||'','Документ у нас':r.a?.desc||'','Сумма у нас':r.a?.amount??'','Источник у нас':r.a?.source||'',
    'Дата у контрагента':r.b?.date||'','№ у контрагента':r.b?.number||'','Документ контрагента':r.b?.desc||'','Сумма контрагента':r.b?.amount??'','Источник контрагента':r.b?.source||'','Разница':r.diff,'Примечание':r.note||''
  }));
  const book=XLSX.utils.book_new();
  const bad=rows.filter(x=>x['Результат']!=='Совпадает');
  XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(bad.length?bad:[{'Результат':'Расхождений не обнаружено'}]),'Расхождения');
  XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'Все операции');
  XLSX.writeFile(book,'Акты_сверки_'+new Date().toISOString().slice(0,10)+'.xlsx');
}
async function reconRun(){
  if(reconState.busy)return;
  if(!reconState.a.length){reconStatus('Сначала добавьте хотя бы один файл «У нас».');return;}
  reconState.busy=true;reconState.parsed=[];reconState.issues=[];reconState.report=[];
  const btn=document.getElementById('reconRunBtn');btn.disabled=true;
  document.getElementById('reconResult').innerHTML='';
  document.getElementById('reconPreview').innerHTML='';
  document.getElementById('reconQuality').innerHTML='';
  const jobs=[...reconState.a.map(file=>({side:'a',file})),...reconState.b.map(file=>({side:'b',file}))];
  try{
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i];reconStatus('Обрабатываю '+(i+1)+' из '+jobs.length+': '+job.file.name);
      try{
        const docs=await reconParseFile(job.file,job.side,reconStatus);
        reconState.parsed.push(...docs);
        const n=docs.reduce((sum,d)=>sum+d.left.entries.length,0);
        if(n===0)reconState.issues.push(job.file.name+': не найдены операции для сравнения; файл необходимо проверить вручную.');
      }catch(e){
        console.error('Ошибка акта сверки:',job.file.name,e);
        reconState.issues.push(job.file.name+': '+(e?.message||'не удалось открыть файл'));
      }
    }
    reconBuildResult();
    reconStatus('Обработка завершена: '+jobs.length+' файл(ов), '+reconState.parsed.length+' листов / страниц. Внимательно проверьте строки с фото и предупреждения.');
  }finally{
    if(reconOcrWorker){try{await reconOcrWorker.terminate();}catch(e){}reconOcrWorker=null;}
    reconState.busy=false;btn.disabled=false;
  }
}
