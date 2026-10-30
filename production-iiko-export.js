/* Preparing iikoServer productionDocument XML. No network calls or live document creation. */
const iikoDraftState={catalog:new Map(),catalogCount:0,documents:[],issues:[],mismatches:[],ready:false,signature:''};
function iikoDraftNorm(s){return String(s??'').toLowerCase().replace(/ё/g,'е').replace(/["«»]/g,'').replace(/\s+/g,' ').trim()}
// Exact production name including case and ё: the goal is to correct the SOURCE workbook.
function iikoDraftExact(s){return String(s??'').trim().replace(/\s+/g,' ')}
function iikoDraftEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function iikoDraftHtml(s){return iikoDraftEsc(s).replace(/&apos;/g,'&#39;')}
function iikoDraftOnlyPositive(items){return (items||[]).filter(x=>Number.isFinite(Number(x.quantity))&&Number(x.quantity)>0)}
function iikoDraftHashText(s){let h=2166136261;for(let k=0;k<s.length;k++){h^=s.charCodeAt(k);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function iikoDraftInvalidate(reason){
  iikoDraftState.ready=false;iikoDraftState.documents=[];iikoDraftState.issues=[];iikoDraftState.mismatches=[];
  const btn=document.getElementById('iikoDraftDownload');
  if(btn)btn.disabled=true;
  const mismatchesBtn=document.getElementById('iikoDraftMismatchDownload');
  if(mismatchesBtn)mismatchesBtn.disabled=true;
  const msg=document.getElementById('iikoDraftStatus');
  if(msg&&reason)msg.textContent=reason;
  const area=document.getElementById('iikoDraftResult');
  if(area)area.innerHTML='';
}
function iikoDraftXlsxRows(file,callback){
  return file.arrayBuffer().then(buffer=>{
    if(typeof XLSX==='undefined')throw Error('Модуль XLSX не загружен');
    const wb=XLSX.read(buffer,{type:'array',cellDates:false});
    return callback(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false}));
  });
}
async function iikoDraftLoadCatalog(){
  const file=document.getElementById('iikoDraftCatalog')?.files?.[0];if(!file)return;
  try{
    iikoDraftState.catalog=new Map();iikoDraftState.catalogCount=0;
    iikoDraftInvalidate('Загружаю новый справочник iiko…');
    await iikoDraftXlsxRows(file,rows=>{
      const h=(rows[0]||[]).map(iikoDraftNorm);
      const nameCol=h.findIndex(x=>/^(наименование|название|name|product name|номенклатура)$/.test(x));
      const guidCol=h.findIndex(x=>/^(id|uuid|guid|productid|product id|идентификатор|id блюда|id номенклатуры)$/.test(x));
      const articleCol=h.findIndex(x=>/^(артикул|article|productarticle|product article|код iiko)$/.test(x));
      if(nameCol<0||(guidCol<0&&articleCol<0))throw Error('В справочнике нужны колонки «Наименование» и «ID/UUID» либо «Артикул».');
      const catalog=new Map();let count=0;
      for(const row of rows.slice(1)){
        const name=String(row[nameCol]||'').trim();
        const id=guidCol>=0?String(row[guidCol]||'').trim():'';
        const article=articleCol>=0?String(row[articleCol]||'').trim():'';
        if(!name||(!id&&!article))continue;
        if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))continue;
        const key=iikoDraftExact(name),val={name,id,article};
        if(!catalog.has(key))catalog.set(key,[]);
        const list=catalog.get(key);
        if(!list.some(x=>x.id===id&&x.article===article))list.push(val);
        count++;
      }
      iikoDraftState.catalog=catalog;iikoDraftState.catalogCount=count;
    });
    iikoDraftAutoCheck();
  }catch(e){iikoDraftInvalidate('Ошибка справочника iiko: '+(e.message||e))}
}
function iikoDraftStore(which,end){
  const id='iikoDraft'+which+(end==='from'?'From':'To');
  return String(document.getElementById(id)?.value||'').trim();
}
function iikoDraftItem(item){
  // No persistent, suggested or local name substitutions.
  // The Excel name must exactly match the iiko catalogue name.
  const matches=iikoDraftState.catalog.get(iikoDraftExact(item.name))||[];
  if(matches.length!==1)return {
    error:matches.length?'В iiko несколько товаров с точно таким названием':'Нет точного совпадения в номенклатуре iiko'
  };
  const match=matches[0];
  return {name:item.name,iikoName:match.name,product:match.id||'',productArticle:match.article||'',
    amount:Number(item.quantity),weight:item.weight||'',sourceRow:item.sourceRow};
}
function iikoDraftMismatch(doc,item,reason){
  return {kitchen:doc.warehouse,sourceRow:Number(item.sourceRow)||0,name:String(item.name||''),
    weight:String(item.weight||''),quantity:Number(item.quantity)||0,reason};
}
function iikoDraftBuildData(){
  const original=typeof morningState!=='undefined'?morningState.result:null;
  if(!original||original.needsColumn||!Array.isArray(original.documents)||original.documents.length!==2)throw Error('Сначала сформируй два акта за выбранную дату.');
  const date=String(original.date?.iso||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Некорректная дата приготовления');
  const issues=[],mismatches=[],documents=[];
  if(!iikoDraftState.catalogCount)issues.push('Загрузи актуальный справочник номенклатуры iiko с наименованиями и ID/артикулом.');
  for(const [idx,doc] of original.documents.entries()){
    const key=idx===0?'BK':'PK';
    const from=iikoDraftStore(key,'from'),to=iikoDraftStore(key,'to');
    if(!from||!to)issues.push((key==='BK'?'Бухара кухня':'Правда кухня')+': укажи склад списания сырья и склад выпуска iiko.');
    const lines=[],names=new Map(),resolvedSizes=new Map();
    for(const item of iikoDraftOnlyPositive(doc.items)){
      const match=iikoDraftItem(item);
      if(match.error){mismatches.push(iikoDraftMismatch(doc,item,match.error));continue}
      const productRef=match.product||match.productArticle;
      const size=iikoDraftNorm(item.weight);
      const uniqueness=productRef+'/'+size;
      if(names.has(uniqueness)){
        const reason='Две строки используют один товар iiko с одинаковым весом/объёмом';
        mismatches.push(iikoDraftMismatch(doc,names.get(uniqueness),reason));
        mismatches.push(iikoDraftMismatch(doc,item,reason));
      }
      if(resolvedSizes.has(productRef)&&resolvedSizes.get(productRef).size!==size){
        const previous=resolvedSizes.get(productRef);
        const reason='Разные веса/объёмы направляются в один товар iiko — исправь названия в плане';
        mismatches.push(iikoDraftMismatch(doc,previous.item,reason));
        mismatches.push(iikoDraftMismatch(doc,item,reason));
      }
      names.set(uniqueness,item);resolvedSizes.set(productRef,{size,item});
      lines.push(match);
    }
    if(!lines.length)issues.push(doc.warehouse+': нет подтверждённых строк.');
    // Do not reserve, calculate or transmit a document number.
    // iikoServer is expected to assign a number when creating a NEW document.
    // This needs a live environment check before enabling actual writes.
    documents.push({type:'production',warehouseCode:key,dateIncoming:date+'T09:00:00',status:'NEW',
      numbering:'iiko-auto',warehouse:doc.warehouse,storeFrom:from,storeTo:to,items:lines});
  }
  const signature=iikoDraftHashText(JSON.stringify(documents));
  return {date,sourceSheet:original.sheet,sourceColumn:original.selected?.label||'',documents,issues,mismatches,signature};
}
// Runs automatically whenever the source plan, day, column, iiko catalogue or stores change.
function iikoDraftAutoCheck(){
  const plan=typeof morningState!=='undefined'?morningState.result:null;
  if(!plan||plan.needsColumn||!Array.isArray(plan.documents)||plan.documents.length!==2){
    iikoDraftInvalidate('Сначала получите Excel и сформируйте два акта за выбранную дату. Сверка запустится автоматически.');
    return;
  }
  if(!iikoDraftState.catalogCount){
    iikoDraftInvalidate('Акты сформированы. Для автоматической сверки загрузите актуальный справочник номенклатуры iiko.');
    return;
  }
  return iikoDraftCheck();
}
function iikoDraftCheck(){
  iikoDraftInvalidate();
  try{
    const data=iikoDraftBuildData();
    iikoDraftState.documents=data.documents;
    iikoDraftState.issues=data.issues;
    iikoDraftState.mismatches=data.mismatches;
    iikoDraftState.ready=data.issues.length===0&&data.mismatches.length===0;
    iikoDraftState.signature=data.signature;
    const sum=d=>d.items.reduce((n,x)=>n+x.amount,0);
    const heading=data.documents.map(d=>'<div><b>Акт '+iikoDraftHtml(d.warehouseCode)+'</b> · '+iikoDraftHtml(d.warehouse)+' · '+d.items.length+' совпавших поз. · '+sum(d)+' шт. · NEW (без проведения)</div>').join('');
    const rowHTML=data.mismatches.map(x=>'<tr><td>'+iikoDraftHtml(x.kitchen)+'</td><td>'+iikoDraftHtml(data.sourceSheet)+'</td><td>'+x.sourceRow+'</td><td>'+iikoDraftHtml(x.name)+'</td><td>'+iikoDraftHtml(x.weight)+'</td><td>'+x.quantity+'</td><td>'+iikoDraftHtml(x.reason)+'</td></tr>').join('');
    const mismatchHTML=data.mismatches.length?
      '<h4>Номенклатура не совпадает: '+data.mismatches.length+' строк</h4>'+
      '<p>Администратор исправляет названия в исходном Excel точно по справочнику iiko, сохраняет файл и загружает его повторно. Подмены названий не сохраняются.</p>'+
      '<div class="tablewrap"><table class="nomtable"><thead><tr><th>Кухня</th><th>Лист</th><th>Строка</th><th>В плане</th><th>Вес / объём</th><th>Кол-во</th><th>Причина</th></tr></thead><tbody>'+rowHTML+'</tbody></table></div>':
      '<p>Все названия блюд точно совпадают с загруженным справочником iiko.</p>';
    const otherHTML=data.issues.length?'<p style="color:#b42318"><b>Другие замечания:</b></p><ul>'+data.issues.map(x=>'<li>'+iikoDraftHtml(x)+'</li>').join('')+'</ul>':'';
    const result=document.getElementById('iikoDraftResult');
    if(result)result.innerHTML=heading+mismatchHTML+otherHTML;
    const missing=data.mismatches.length;
    document.getElementById('iikoDraftStatus').textContent=missing?
      'Не совпадает номенклатура: '+missing+' строк. Исправь исходный Excel и загрузи его повторно.':
      data.issues.length?'Есть замечания: '+data.issues.length+'. Пакет не готов.':
      'Названия совпали. Два акта готовы к скачиванию в тестовом пакете (без отправки в iiko).';
    const btn=document.getElementById('iikoDraftDownload');
    if(btn)btn.disabled=!iikoDraftState.ready;
    const mismatchBtn=document.getElementById('iikoDraftMismatchDownload');
    if(mismatchBtn)mismatchBtn.disabled=!missing;
    return data;
  }catch(e){
    const el=document.getElementById('iikoDraftStatus');
    if(el)el.textContent='Ошибка подготовки: '+(e.message||e);
    return {issues:[String(e.message||e)],documents:[],mismatches:[]};
  }
}
function iikoDraftDownloadMismatches(){
  const data=iikoDraftState.mismatches;
  if(!data.length)throw Error('Несоответствий нет. Проверка выполняется автоматически после загрузки файлов.');
  if(typeof XLSX==='undefined')throw Error('Не загружен модуль Excel.');
  const r=morningState.result;
  const rows=[['Дата','Лист Excel','Кухня','Строка Excel','Наименование в плане','Вес / объём','Количество','Несоответствие']];
  for(const x of data)rows.push([r.date.iso,r.sheet,x.kitchen,x.sourceRow,x.name,x.weight,x.quantity,x.reason]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:13},{wch:18},{wch:20},{wch:14},{wch:50},{wch:16},{wch:14},{wch:72}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Не совпадает с iiko');
  XLSX.writeFile(wb,'несовпадения_iiko_'+r.date.iso+'.xlsx');
}
function iikoDraftReloadPlan(){
  const file=document.getElementById('prodfile');
  if(!file)throw Error('Поле загрузки Excel не найдено');
  file.value=''; // Same name after edit should still trigger change.
  file.click();
}
function iikoDraftXml(doc){
  const lines=doc.items.map((x,i)=>{
    const ref=x.product?'<product>'+iikoDraftEsc(x.product)+'</product>':'<productArticle>'+iikoDraftEsc(x.productArticle)+'</productArticle>';
    return '<item><num>'+(i+1)+'</num><amount>'+x.amount+'</amount>'+ref+'</item>';
  }).join('');
  // documentNumber intentionally omitted: the server, not the browser, assigns numbers.
  return '<?xml version="1.0" encoding="UTF-8"?>\n<document><status>NEW</status><dateIncoming>'+iikoDraftEsc(doc.dateIncoming)+'</dateIncoming><storeFrom>'+iikoDraftEsc(doc.storeFrom)+'</storeFrom><storeTo>'+iikoDraftEsc(doc.storeTo)+'</storeTo><comment>Помогатор: проект акта приготовления, без проведения</comment><items>'+lines+'</items></document>';
}
async function iikoDraftDownload(){
  if(!iikoDraftState.ready)throw Error('Исправь несовпадения в исходном Excel, загрузи его повторно и сверяй заново.');
  if(typeof JSZip==='undefined')throw Error('Не загружен модуль ZIP');
  const zip=new JSZip();
  const json={schema:'pomogator.iiko.production-draft.v2',mode:'offline-test',endpoint:'/resto/api/documents/import/productionDocument',posted:false,
    numberPolicy:'omit-documentNumber',automaticNumberUnverified:true,
    createdAt:new Date().toISOString(),signature:iikoDraftState.signature,documents:iikoDraftState.documents};
  zip.file('manifest.json',JSON.stringify(json,null,2));
  for(const d of iikoDraftState.documents)zip.file('production-'+d.warehouseCode+'.xml',iikoDraftXml(d));
  zip.file('README.txt','ТЕСТОВЫЙ ПАКЕТ. Два акта приготовления NEW без проведения и без номера. Поле documentNumber отсутствует: автоматическая нумерация iikoServer должна быть подтверждена на вашем сервере до включения отправки. Никакой проверки наличия существующих актов не выполняется. Повторная отправка может создать дубликаты. В iiko ничего не отправлено.');
  const content=await zip.generateAsync({type:'blob'});
  const url=URL.createObjectURL(content),a=document.createElement('a');
  a.href=url;a.download='iiko-draft-'+iikoDraftState.documents[0].dateIncoming.slice(0,10)+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
  document.getElementById('iikoDraftStatus').textContent='Пакет скачан. В iiko ничего не передавалось.';
}
