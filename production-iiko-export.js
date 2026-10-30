/* Preparing iikoServer productionDocument XML. No network calls or live document creation. */
const iikoDraftState={crosswalk:new Map(),catalog:new Map(),catalogCount:0,documents:[],issues:[],ready:false,signature:''};
function iikoDraftNorm(s){return String(s??'').toLowerCase().replace(/ё/g,'е').replace(/["«»]/g,'').replace(/\s+/g,' ').trim()}
function iikoDraftEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function iikoDraftHtml(s){return iikoDraftEsc(s).replace(/&apos;/g,'&#39;')}
function iikoDraftOnlyPositive(items){return (items||[]).filter(x=>Number.isFinite(Number(x.quantity))&&Number(x.quantity)>0)}
function iikoDraftHashText(s){let h=2166136261;for(let k=0;k<s.length;k++){h^=s.charCodeAt(k);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function iikoDraftInvalidate(reason){
  iikoDraftState.ready=false;iikoDraftState.documents=[];iikoDraftState.issues=[];
  const btn=document.getElementById('iikoDraftDownload');
  if(btn)btn.disabled=true;
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
async function iikoDraftLoadMapping(){
  const file=document.getElementById('iikoDraftMapping')?.files?.[0];if(!file)return;
  try{
    await iikoDraftXlsxRows(file,rows=>{
      const m=new Map();
      for(const row of rows.slice(1)){
        const source=String(row[0]||'').trim(),target=String(row[1]||'').trim();
        const status=iikoDraftNorm(row[2]);
        if(!source||!target)continue;
        const approved=/^(точное совпадение названия|подтверждено|одобрено)$/.test(status);
        const key=iikoDraftNorm(source);
        const prev=m.get(key);
        if(prev&&(prev.target!==target||prev.approved!==approved))m.set(key,{target:'',approved:false,conflict:true});
        else if(!prev)m.set(key,{target,approved,conflict:false});
      }
      iikoDraftState.crosswalk=m;
    });
    iikoDraftInvalidate('Таблица соответствия загружена: '+iikoDraftState.crosswalk.size+' вариантов. Неподтверждённые позиции не будут подставлены автоматически.');
  }catch(e){iikoDraftInvalidate('Ошибка чтения соответствия: '+(e.message||e))}
}
async function iikoDraftLoadCatalog(){
  const file=document.getElementById('iikoDraftCatalog')?.files?.[0];if(!file)return;
  try{
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
        const key=iikoDraftNorm(name),val={name,id,article};
        if(!catalog.has(key))catalog.set(key,[]);
        const list=catalog.get(key);
        if(!list.some(x=>x.id===id&&x.article===article))list.push(val);
        count++;
      }
      iikoDraftState.catalog=catalog;iikoDraftState.catalogCount=count;
    });
    iikoDraftInvalidate('Номенклатура iiko загружена: '+iikoDraftState.catalogCount+' записей. Запусти проверку двух актов.');
  }catch(e){iikoDraftInvalidate('Ошибка справочника iiko: '+(e.message||e))}
}
function iikoDraftStore(which,end){
  const id='iikoDraft'+which+(end==='from'?'From':'To');
  return String(document.getElementById(id)?.value||'').trim();
}
function iikoDraftItem(item){
  const normalized=iikoDraftNorm(item.name);
  const m=iikoDraftState.crosswalk.get(normalized);
  if(m&&!m.approved)return {error:'Не подтверждено соответствие: '+item.name};
  const expected=m?.approved?m.target:item.name;
  const matches=iikoDraftState.catalog.get(iikoDraftNorm(expected))||[];
  if(matches.length!==1)return {error:(matches.length?'Неоднозначное наименование iiko: ':'Нет точного соответствия в iiko: ')+item.name+' → '+expected};
  const match=matches[0];
  return {name:item.name,iikoName:match.name,product:match.id||'',productArticle:match.article||'',amount:Number(item.quantity),weight:item.weight||'',sourceRow:item.sourceRow};
}
function iikoDraftBuildData(){
  const original=typeof morningState!=='undefined'?morningState.result:null;
  if(!original||original.needsColumn||!Array.isArray(original.documents)||original.documents.length!==2)throw Error('Сначала сформируй два акта за выбранную дату.');
  const date=String(original.date?.iso||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Некорректная дата приготовления');
  const issues=[],documents=[];
  for(const [idx,doc] of original.documents.entries()){
    const key=idx===0?'BK':'PK';
    const from=iikoDraftStore(key,'from'),to=iikoDraftStore(key,'to');
    if(!from||!to)issues.push((key==='BK'?'Бухара кухня':'Правда кухня')+': укажи склад списания сырья и склад выпуска iiko.');
    const lines=[],names=new Set(),resolvedSizes=new Map();
    for(const item of iikoDraftOnlyPositive(doc.items)){
      const match=iikoDraftItem(item);
      if(match.error){issues.push(match.error);continue}
      // Keep separate compote sizes: identical iiko product must not be used for different volumes.
      const productRef=match.product||match.productArticle;
      const size=iikoDraftNorm(item.weight);
      const uniqueness=productRef+'/'+size;
      if(names.has(uniqueness))issues.push('Повтор блюда с одинаковым размером: '+item.name+'. Требуется сверка.');
      if(resolvedSizes.has(productRef)&&resolvedSizes.get(productRef)!==size)
        issues.push('Разные веса/объёмы привязаны к одному блюду iiko: '+item.name+' ('+resolvedSizes.get(productRef)+' и '+size+'). Нужны отдельные позиции.');
      names.add(uniqueness);resolvedSizes.set(productRef,size);
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
  return {date,sourceSheet:original.sheet,sourceColumn:original.selected?.label||'',documents,issues,signature};
}
function iikoDraftCheck(){
  iikoDraftInvalidate();
  try{
    const data=iikoDraftBuildData();
    iikoDraftState.documents=data.documents;
    iikoDraftState.issues=data.issues;
    iikoDraftState.ready=data.issues.length===0;
    iikoDraftState.signature=data.signature;
    const sum=d=>d.items.reduce((n,x)=>n+x.amount,0);
    const heading=data.documents.map(d=>'<div><b>Акт '+iikoDraftHtml(d.warehouseCode)+'</b> · '+iikoDraftHtml(d.warehouse)+' · номер назначает iiko · '+d.items.length+' поз. · '+sum(d)+' шт. · NEW (без проведения)</div>').join('');
    const warnings=data.issues.length?'<p style="color:#b42318"><b>Нужно исправить ('+data.issues.length+'):</b></p><ul>'+data.issues.slice(0,60).map(x=>'<li>'+iikoDraftHtml(x)+'</li>').join('')+'</ul>':'<p>Все позиции сопоставлены. Готов тестовый пакет из двух актов. Реальная отправка пока отключена.</p>';
    const result=document.getElementById('iikoDraftResult');
    if(result)result.innerHTML=heading+warnings;
    document.getElementById('iikoDraftStatus').textContent=data.issues.length?'Пакет не готов: '+data.issues.length+' замечаний.':'Проверка пройдена. Пакет актов подготовлен для теста.';
    const btn=document.getElementById('iikoDraftDownload');if(btn)btn.disabled=!iikoDraftState.ready;
    return data;
  }catch(e){
    const el=document.getElementById('iikoDraftStatus');if(el)el.textContent='Ошибка подготовки: '+(e.message||e);
    return {issues:[String(e.message||e)],documents:[]};
  }
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
  if(!iikoDraftState.ready)throw Error('Сначала устрани замечания проверки.');
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
