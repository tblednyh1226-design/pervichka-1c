/* Production plan → iiko preparation; does not contact iiko or post documents. */
let productionBook=null,productionRows=[],productionDocuments=[],productionFileName='',productionSheetName='';
const productionSkip=/^(всего|итого|итого фасовка|вес|цена|разница|покупатели|№|наименование|меню)$/i;
const productionGroups=/^(холодные закуски|первые блюда|блюда для завтраков|вторые\s+блюда|гарниры|напитки|хлеб|дополнительный ассортимент|выпечка|комплексные обеды)$/i;
function productionNorm(v){return String(v??'').trim().replace(/\s+/g,' ').toLowerCase().replace(/ё/g,'е')}
function productionText(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function productionError(e){document.getElementById('prodstatus').textContent='Ошибка: '+(e.message||e)}
function productionInit(){
 const file=document.getElementById('prodfile');
 if(file&&!file.dataset.ready){file.dataset.ready='1';file.addEventListener('change',productionOpen)}
}
async function productionOpen(){
 const f=document.getElementById('prodfile').files[0];if(!f)return;
 try{
  document.getElementById('prodstatus').textContent='Читаю Excel…';
  if(typeof XLSX==='undefined')throw Error('Модуль Excel не загружен');
  const bytes=await f.arrayBuffer();
  productionBook=XLSX.read(bytes,{type:'array',cellDates:true});productionFileName=f.name;
  if(typeof morningPrepareFromBytes==='function')morningPrepareFromBytes(bytes,f.name);
  document.getElementById('prodsheet').innerHTML=productionBook.SheetNames.map((name,i)=>'<option value="'+i+'">'+productionText(name)+'</option>').join('');
  document.getElementById('prodsheet').value=String(productionBook.SheetNames.length-1);
  productionSelectSheet();
 }catch(e){productionError(e)}
}
function productionSelectSheet(){
 if(!productionBook)return;
 const i=Number(document.getElementById('prodsheet').value);
 productionSheetName=productionBook.SheetNames[i];
 productionRows=XLSX.utils.sheet_to_json(productionBook.Sheets[productionSheetName],{header:1,defval:'',raw:true});
 const header=productionRows.findIndex(row=>productionNorm(row[0])==='№'&&productionNorm(row[1])==='наименование');
 if(header<0)throw Error('Не найдена строка заголовков (№ / Наименование)');
 const heads=productionRows[header];
 const options=heads.map((v,col)=>({name:String(v??'').trim(),col})).filter(x=>x.name&&x.col>=4&&!productionSkip.test(x.name));
 window.productionContext={header,heads,options};
 const container=document.getElementById('prodrecipients');
 container.innerHTML=options.map((o,k)=>{
  const isShop=/правд|бухар|бестуж|модул|мега|этм|редм|мед экспресс/i.test(o.name);
  return '<div class="orgrow"><span><b>'+productionText(o.name)+'</b><small>Столбец '+(o.col+1)+'</small></span><select data-col="'+o.col+'" aria-label="Роль '+productionText(o.name)+'"><option value="customer" '+(!isShop?'selected':'')+'>Покупатель (в производство)</option><option value="point" '+(isShop?'selected':'')+'>Точка (перемещение)</option><option value="ignore">Не учитывать</option></select></div>'
 }).join('');
 productionDocuments=[];document.getElementById('prodresult').innerHTML='';
 document.getElementById('prodstatus').textContent='Лист: '+productionSheetName+'. Укажите роли получателей и кухню, затем сформируйте документы.';
}
function productionBuild(){
 try{
  if(!productionBook)throw Error('Загрузите план производства');
  const kitchen=document.getElementById('prodkitchen').value.trim();
  if(!kitchen)throw Error('Укажите склад приготовления');
  const roles=[...document.querySelectorAll('#prodrecipients select')].map(s=>({col:Number(s.dataset.col),role:s.value,name:productionContext.heads[Number(s.dataset.col)]}));
  if(!roles.some(r=>r.role!=='ignore'))throw Error('Не выбраны получатели');
  const aggregates=new Map(),transfers=new Map(),warnings=[],unmatched=[];
  let section='',count=0;
  for(let i=productionContext.header+1;i<productionRows.length;i++){
   const row=productionRows[i],name=String(row[1]??'').trim(),code=String(row[0]??'').trim();
   if(!name){if(productionGroups.test(String(row[0]??'').trim()))section=String(row[0]).trim();continue}
   if(productionGroups.test(String(row[0]??'').trim())){section=String(row[0]).trim();continue}
   if(!/^[\d]+$/.test(code)){continue} // intentionally excludes rows without source code, flagged below if quantities
   const lines=roles.map(r=>({...r,quantity:Number(row[r.col]||0)})).filter(r=>r.role!=='ignore'&&Number.isFinite(r.quantity)&&r.quantity>0);
   if(!lines.length)continue;
   const key=code+'|'+name+'|'+String(row[2]??'');
   const total=lines.reduce((n,r)=>n+r.quantity,0);
   if(aggregates.has(key)){warnings.push('Повтор кода/позиции: '+code+' — '+name+' (строка '+(i+1)+')')}
   let item=aggregates.get(key);
   if(!item){item={code,name,weight:row[2]??'',group:section,quantity:0};aggregates.set(key,item)}
   item.quantity+=total;count++;
   for(const r of lines)if(r.role==='point'){
    const label=String(r.name).trim();if(!transfers.has(label))transfers.set(label,new Map());
    const m=transfers.get(label),existing=m.get(key);
    if(existing)existing.quantity+=r.quantity;
    else m.set(key,{code,name,weight:row[2]??'',group:section,quantity:r.quantity});
   }
  }
  // Rows with quantities but no numeric code must not silently become documents.
  for(let i=productionContext.header+1;i<productionRows.length;i++){
   const row=productionRows[i],name=String(row[1]??'').trim(),code=String(row[0]??'').trim();
   if(!name||/^\d+$/.test(code))continue;
   if(roles.some(r=>r.role!=='ignore'&&Number(row[r.col])>0)&&!productionGroups.test(String(row[0]??'').trim()))unmatched.push('Строка '+(i+1)+': '+name+' — нет числового кода');
  }
  const items=[...aggregates.values()];
  if(!items.length)throw Error('Не найдены блюда с числовыми кодами и положительными количествами');
  productionDocuments=[{type:'production',date:productionSheetName,kitchen,items},...[...transfers.entries()].map(([target,m])=>({type:'transfer',date:productionSheetName,source:kitchen,target,items:[...m.values()]}))];
  const grand=items.reduce((a,x)=>a+x.quantity,0),moved=[...transfers.values()].flatMap(m=>[...m.values()]).reduce((a,x)=>a+x.quantity,0);
  const docHtml=productionDocuments.map((d,k)=>'<details '+(k===0?'open':'')+'><summary><b>'+(d.type==='production'?'Акт приготовления':'Перемещение → '+productionText(d.target))+'</b> · '+d.items.length+' поз. · '+d.items.reduce((n,x)=>n+x.quantity,0)+' шт.</summary><div class="tablewrap"><table class="nomtable"><thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th></tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+productionText(x.code)+'</td><td>'+productionText(x.name)+'</td><td>'+x.quantity+'</td></tr>').join('')+'</tbody></table></div></details>').join('');
  const issues=[...warnings,...unmatched];
  document.getElementById('prodresult').innerHTML='<h3>Предпросмотр · '+productionText(productionSheetName)+'</h3><p>Кухня: <b>'+productionText(kitchen)+'</b>. Позиций приготовления: <b>'+items.length+'</b>. Количество: <b>'+grand+'</b>. В перемещениях: <b>'+moved+'</b>. Покупатели и другие направления: <b>'+(grand-moved)+'</b>.</p>'+(issues.length?'<p style="color:#9d4b17"><b>Требуют проверки ('+issues.length+'):</b><br>'+issues.slice(0,40).map(productionText).join('<br>')+'</p>':'<p>Строк без кода с положительным количеством не обнаружено.</p>')+docHtml+'<p class="muted">Это подготовленные документы, не документы iiko. Экспорт JSON — технический пакет для будущего защищённого подключения API. Никаких изменений в iiko не производится.</p><button class="primary" onclick="productionExport()">Скачать пакет документов JSON</button>';
  document.getElementById('prodstatus').textContent='Подготовлено документов: '+productionDocuments.length+'. Строк товаров: '+count+'. Проверок: '+issues.length+'.';
 }catch(e){productionError(e)}
}
function productionExport(){
 if(!productionDocuments.length)return;
 const payload={schema:'pomogator.iiko-preparation.v1',sourceFile:productionFileName,sourceSheet:productionSheetName,createdAt:new Date().toISOString(),posted:false,documents:productionDocuments};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='iiko-preparation-'+productionSheetName.replace(/[^\wа-яё.-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
document.addEventListener('DOMContentLoaded',productionInit);
