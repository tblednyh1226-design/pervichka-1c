const INVOICE_ENDPOINT='https://rgluzdxikpagugpmusbp.supabase.co/functions/v1/stolovaya-iiko-pomogator-invoices';
let invoiceCatalog=null;
let invoiceCatalogLoading=false;
const invoiceSent=new Set();
const invoiceHash=x=>{let h=2166136261;for(const c of JSON.stringify(x)){h=Math.imul(h^c.charCodeAt(0),16777619)}return (h>>>0).toString(36)};
async function customerInvoiceSend(btn,buyer,lines,select){
 const status=document.getElementById('customerInvoicesStatus');
 const pair=typeof planGuestStored==='function'?planGuestStored():null;
 const store=invoiceCatalog?.stores?.find(x=>/бухара\s*кухня/i.test(x.name));
 const date=document.getElementById('prodDocDate')?.value;
 if(!invoiceCatalog){status.textContent='Загружаю справочники iiko. Повторите отправку после загрузки.';void customerInvoiceLoadCatalog();return;}
 // Leave counteragent empty; user selects «Покупатели» manually in iiko.
 const counteragentId=null;
 if(!pair?.deviceId||!pair?.token||!store||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){status.textContent='Подключите MAIN, проверьте склад Бухара кухня и дату.';return;}
 const items=lines.map(x=>{const resolved=typeof iikoDraftResolveProduct==='function'?iikoDraftResolveProduct({name:x.name}):null;return {name:x.name,productId:resolved?.product?.id,amount:x.qty,price:x.price};});
 if(items.some(x=>!x.productId)){status.textContent='Сначала сопоставьте номенклатуру iiko: '+items.filter(x=>!x.productId).map(x=>x.name).slice(0,8).join(', ');return;}
 if(btn.disabled)return;
 if(!confirm('Отправить расходную накладную '+buyer+' в iiko без проведения?\\nКонтрагент не указан.\\nДата: '+date+'\\nПозиций: '+items.length+'.'))return;
 btn.disabled=true;btn.textContent='Отправляется…';
 try{
  const res=await fetch(INVOICE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-device-id':pair.deviceId,'x-browser-token':pair.token},body:JSON.stringify({action:'upload',document:{type:'outgoingInvoice',status:'NEW',dateIncoming:date+'T16:00:00',storeId:store.id,comment:'Покупатель по плану: '+buyer,items:items.map(({productId,amount,price})=>({productId,amount,price}))}})});
  const data=await res.json();
  if(!res.ok||!data.ok)throw Error(data.error||'iiko отклонила запрос');
  status.textContent='Запрос на отправку накладной '+buyer+' выполнен. Наличие документа проверяет администратор.';
 }catch(e){status.textContent='Ошибка отправки: '+String(e.message||e)+'. Можно повторить запрос.';}
 finally{btn.disabled=false;btn.textContent='Отправить в iiko';}

}

async function customerInvoiceLoadCatalog(){
 if(invoiceCatalogLoading)return;
 invoiceCatalogLoading=true;
 const status=document.getElementById('customerInvoicesStatus');
 try{
  const pair=typeof planGuestStored==='function'?planGuestStored():null;
  if(!pair?.deviceId||!pair?.token)throw Error('Сначала подключите MAIN');
  if(status)status.textContent='Загружаю покупателей и склады iiko…';
  const response=await fetch(INVOICE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-device-id':pair.deviceId,'x-browser-token':pair.token},body:JSON.stringify({action:'catalog'})});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Ошибка получения справочника');
  invoiceCatalog=data;
  customerInvoicesPreview();
 }catch(e){if(status)status.textContent='Справочники iiko: '+String(e.message||e);}
 finally{invoiceCatalogLoading=false;}
}
/* Customer invoices: previews and explicit per-buyer send controls. */
function customerInvoicesPreview(){
 const status=document.getElementById('customerInvoicesStatus');
 const target=document.getElementById('customerInvoicesResult');
 if(!status||!target)return;
 target.replaceChildren();status.textContent='';
 const load=document.createElement('button');load.type='button';load.textContent='Обновить покупателей и склады из iiko';load.onclick=customerInvoiceLoadCatalog;target.append(load);
 if(!invoiceCatalog&&!invoiceCatalogLoading&&typeof planGuestStored==='function'&&planGuestStored()?.deviceId){void customerInvoiceLoadCatalog();}
 if(invoiceCatalog){const info=document.createElement('p');info.textContent='iiko: '+invoiceCatalog.counteragents.length+' контрагентов, '+invoiceCatalog.stores.length+' складов. Проверьте соответствия номенклатуры перед отправкой.';target.append(info);}
 const ctx=window.productionContext;
 if(!ctx||typeof productionRows==='undefined'||!productionRows.length){
  status.textContent='Сначала загрузите дневной план Excel и выберите лист.';return;
 }
 const norm=v=>String(v??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^a-zа-я0-9+]+/gi,' ').trim();
 const excludedHeadings=/^(?:всего|итого|сумма|раздача|правда(?:\s|$)|бухара(?:\s|$)|этм(?:\s|$)|редмонд(?:\s|$)|рэдмонд(?:\s|$)|бестужевская(?:\s|$)|модуль(?:\s|$)|мега(?:\s|$)|цена(?:\s|$)|кол\s*во|количество|выпечка|iiko(?:\s|$)|айко(?:\s|$)|номер(?:\s|$)|наименование)/i;
 const buyers=new Map(),unrecognized=[];
 (ctx.heads||[]).forEach((raw,col)=>{
  if(col<4)return;
  const heading=String(raw??'').trim(),key=norm(heading);
  if(!heading||excludedHeadings.test(key))return;
  // In the new plan, the row above names marks outlets; blank means external buyer.
  if(ctx.hasClassification&&String(ctx.classification?.[col]??'').trim())return;
  // Grand Capital day and night are summed into one invoice.
  const grandCapital=/^гранд капитал(?: ночь)?$/.test(key);
  const buyer=grandCapital?'Гранд Капитал':heading;
  const id=grandCapital?'grand-capital':heading+' ['+col+']';
  if(!buyers.has(id))buyers.set(id,{buyer,columns:[]});
  buyers.get(id).columns.push(col);
 });
 if(!buyers.size){status.textContent='Не найдены заголовки покупателей в выбранном листе. Накладные не сформированы.';return;}
 const number=v=>{
  if(v===null||v===undefined||String(v).trim()==='')return null;
  const n=Number(String(v).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n)?n:null;
 };
 const missingPrices=[],invalidQty=[],cards=[];
 for(const {buyer,columns} of buyers.values()){
  const lines=[];
  for(let i=ctx.header+1;i<ctx.pastry.end;i++){
   if(i>ctx.pastry.compoteLast&&i<ctx.pastry.start)continue;
   const row=productionRows[i]||[],name=String(row[1]??'').trim();
   if(!name||/^(итого|всего|сумма|наименование|допы|выпечка|цена)/i.test(name)||
      (typeof productionGroups!=='undefined'&&productionGroups.test(name)))continue;
   let qty=0;
   for(const col of columns){
    const raw=row[col],value=number(raw);
    if(value===null){if(String(raw??'').trim())invalidQty.push(buyer+': '+name+' (строка '+(i+1)+')');continue;}
    if(value>0)qty+=value;
   }
   if(qty<=0)continue;
   const weight=String(row[2]??'').trim();
   const isLargePie=/(?:^|[^а-я])пирог(?:и|ов|а|ом)?(?=$|[^а-я])/iu.test(name)&&
     !/пирож|мини[\s-]*пирог|маленьк/iu.test(name);
   const originalQty=qty;
   if(isLargePie)qty*=8;
   const price=number(row[3]);
   if(price===null||price<0){missingPrices.push(buyer+': '+name+' (строка '+(i+1)+')');continue;}
   lines.push({name,qty,price,amount:Math.round(qty*price*100)/100,...(isLargePie?{sourceQuantity:originalQty,conversionFactor:8}:{})});
  }
  if(lines.length)cards.push({buyer,columns,lines});
 }
 if(missingPrices.length||invalidQty.length){
  status.textContent='Накладные требуют проверки: '+(missingPrices.length?'нет цены у '+missingPrices.slice(0,6).join('; ')+'. ':'')+
   (invalidQty.length?'Некорректные количества: '+invalidQty.slice(0,6).join('; '):'');
  return;
 }
 for(const {buyer,columns,lines} of cards){
  const details=document.createElement('details');
  details.className='card';
  details.style.cssText='margin:12px 0;padding:16px;border:1px solid #e3e7ef;border-radius:12px;background:#fff';
  const summary=document.createElement('summary');
  summary.style.cssText='list-style:none;cursor:pointer;display:block';
  const total=lines.reduce((v,x)=>v+x.amount,0);
  const top=document.createElement('div');
  top.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap';
  const info=document.createElement('div');
  info.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:18px;flex:1';
  for(const [label,value] of [['Покупатель',buyer],['Количество',String(lines.reduce((n,x)=>n+x.qty,0))],['Сумма, ₽',total.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})]]){
    const field=document.createElement('div');
    const small=document.createElement('div');small.textContent=label;small.style.cssText='color:#64748b;font-size:12px';
    const strong=document.createElement('strong');strong.textContent=value;
    field.append(small,strong);info.append(field);
  }
  const btn=document.createElement('button');
  btn.type='button';btn.textContent='Отправить в iiko';
  btn.disabled=false;
  btn.title='Создать непроведённую накладную без контрагента — выбрать в iiko вручную';
  btn.style.cssText='background:#0878d9;color:white;border:0;border-radius:8px;padding:12px 16px;font-weight:600;cursor:pointer';
  btn.onclick=e=>{e.preventDefault();e.stopPropagation();customerInvoiceSend(btn,buyer,lines,details.querySelector('select'));};
  top.append(info,btn);
  const hint=document.createElement('div');hint.textContent='▸ Проверить блюда и количество ('+lines.length+' поз.)';hint.style.cssText='margin-top:12px;font-weight:600';
  summary.append(top,hint);details.append(summary);
  details.addEventListener('toggle',()=>{hint.textContent=(details.open?'▾':'▸')+' Проверить блюда и количество ('+lines.length+' поз.)';});
  const table=document.createElement('table'),header=document.createElement('tr');
  for(const name of ['Блюдо','Количество','Цена, руб.','Сумма, руб.']){
   const th=document.createElement('th');th.textContent=name;header.append(th);
  }
  table.append(header);
  for(const line of lines){
   const tr=document.createElement('tr');
   for(const value of [line.name,line.qty,line.price.toFixed(2),line.amount.toFixed(2)]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }
   table.append(tr);
   if(line.conversionFactor===8){const note=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=4;cell.textContent='Большой пирог: '+line.sourceQuantity+' × 8 = '+line.qty+' кусков';note.append(cell);table.append(note);}
  }
  details.append(table);
  target.append(details);
 }
 const med='Каждый столбец — отдельная накладная, кроме объединённого «Гранд Капитал».';
 status.textContent='Сформировано '+cards.length+' накладных для проверки. '+med+
  (unrecognized.length?' Неопознанные заголовки: '+unrecognized.join(', ')+'.':'')+
  (invoiceCatalog?' Контрагент не заполняется; выберите «Покупатели» вручную в iiko. Название из столбца — в комментарии. Проверьте сопоставление блюд.':' Сначала загрузите справочники iiko для включения кнопок.');
}
