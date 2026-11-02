/* Customer invoices: previews and explicit per-buyer send controls. */
function customerInvoicesPreview(){
 const status=document.getElementById('customerInvoicesStatus');
 const target=document.getElementById('customerInvoicesResult');
 if(!status||!target)return;
 target.replaceChildren();status.textContent='';
 const ctx=window.productionContext;
 if(!ctx||typeof productionRows==='undefined'||!productionRows.length){
  status.textContent='Сначала загрузите дневной план Excel и выберите лист.';return;
 }
 const norm=v=>String(v??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^a-zа-я0-9+]+/gi,' ').trim();
 const aliases=new Map([
  ['янино','Янино'],['навык+','Навык+'],['навык','Навык+'],
  ['эйджи','Эйджи'],['ейджи','Эйджи'],['обухово','Обухово'],
  ['ревада','Ревада'],['крокид','Крокид'],['нпп','НПП'],
  ['сервис ман','Сервис Ман'],['сервисман','Сервис Ман'],
  ['гранд капитал','Гранд Капитал'],['гранд капитал ночь','Гранд Капитал'],
  ['мед экспресс','Мед экспресс'],['медэкспресс','Мед экспресс']
 ]);
 const buyers=new Map(),unrecognized=[];
 (ctx.heads||[]).forEach((raw,col)=>{
  if(col<4)return;
  const heading=String(raw??'').trim(),key=norm(heading);
  if(!heading)return;
  const buyer=aliases.get(key);
  if(buyer){if(!buyers.has(buyer))buyers.set(buyer,[]);buyers.get(buyer).push(col);}
  else if(!/^(всего|итого|раздача|правда|бухара|этм|редмонд|рэдмонд|бестужевская|модуль|мега|цена|кол во|количество|выпечка)/.test(key))
   unrecognized.push(heading+' ('+(typeof XLSX!=='undefined'?XLSX.utils.encode_col(col):col)+')');
 });
 if(!buyers.size){status.textContent='Не найдены заголовки покупателей в выбранном листе. Накладные не сформированы.';return;}
 const number=v=>{
  if(v===null||v===undefined||String(v).trim()==='')return null;
  const n=Number(String(v).replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(n)?n:null;
 };
 const missingPrices=[],invalidQty=[],cards=[];
 for(const [buyer,columns] of buyers){
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
   const price=number(row[3]);
   if(price===null||price<0){missingPrices.push(buyer+': '+name+' (строка '+(i+1)+')');continue;}
   lines.push({name,qty,price,amount:Math.round(qty*price*100)/100});
  }
  if(lines.length)cards.push({buyer,columns,lines});
 }
 if(missingPrices.length||invalidQty.length){
  status.textContent='Накладные требуют проверки: '+(missingPrices.length?'нет цены у '+missingPrices.slice(0,6).join('; ')+'. ':'')+
   (invalidQty.length?'Некорректные количества: '+invalidQty.slice(0,6).join('; '):'');
  return;
 }
 for(const {buyer,columns,lines} of cards){
  const details=document.createElement('details'),summary=document.createElement('summary');
  const total=lines.reduce((v,x)=>v+x.amount,0);
  summary.textContent=buyer+' — '+lines.length+' поз., '+total.toFixed(2)+' руб.';
  details.append(summary);
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
  }
  details.append(table);
  const btn=document.createElement('button');btn.type='button';btn.textContent='Выгрузить в iiko';btn.disabled=true;btn.title='Ожидается подключение серверной выгрузки расходных накладных';details.append(btn);
  target.append(details);
 }
 const med=buyers.has('Мед экспресс')?'«Мед экспресс» найден.':'«Мед экспресс» не найден в заголовках этого листа.';
 status.textContent='Сформировано '+cards.length+' накладных для проверки. '+med+
  (unrecognized.length?' Неопознанные заголовки: '+unrecognized.join(', ')+'.':'')+
  ' Кнопки выгрузки появятся в каждой накладной; до подключения серверного обработчика они заблокированы.';
}
