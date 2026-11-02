/* Customer invoices: local preview only, never sends to iiko. */
function customerInvoicesPreview(){
 const status=document.getElementById('customerInvoicesStatus'),target=document.getElementById('customerInvoicesResult');
 if(!status||!target)return;
 target.replaceChildren();
 if(!typeof productionContext==='undefined'||!productionRows?.length){status.textContent='Сначала загрузите план и выберите день в разделе перемещений.';return;}
 const names=['Янино','Навык+','ЗИДКИ','Обухово','Ревада','Крокид','НПП','Сервис Ман','Гранд Капитал'];
 const groups=[[4],[5],[6],[7],[8],[9],[10],[11],[12,13]];
 const rows=productionRows;
 const num=x=>{if(typeof x==='number')return x;const n=Number(String(x??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0;};
 let count=0;
 for(let i=0;i<names.length;i++){
  const lines=[];
  for(let ri=0;ri<rows.length;ri++){
   const row=rows[ri];
   const ctx=window.productionContext;
   if(ctx && (ri<=ctx.header || (ri>ctx.pastry.end && ri<ctx.pastry.start)))continue;
   if(ctx && ri>ctx.pastry.end)continue;
   if(!Array.isArray(row))continue;
   const item=String(row[1]||'').trim(),price=num(row[3]),qty=groups[i].reduce((v,col)=>v+num(row[col]),0);
   if(!item||qty<=0||/^(итого|всего|сумма|наименование|допы|выпечка|цена)/i.test(item))continue;
   if(price<=0){status.textContent='Есть позиции без цены. Проверьте столбец D.';continue;}
   lines.push({item,qty,price,sum:Math.round(qty*price*100)/100});
  }
  if(!lines.length)continue;
  count++;
  const wrap=document.createElement('details'),summary=document.createElement('summary');
  summary.textContent=names[i]+' — '+lines.length+' поз., '+lines.reduce((v,x)=>v+x.sum,0).toFixed(2)+' руб.';
  wrap.append(summary);
  const table=document.createElement('table');
  const head=document.createElement('tr');
  for(const title of ['Блюдо','Кол-во','Цена','Сумма']){const th=document.createElement('th');th.textContent=title;head.append(th);}
  table.append(head);
  for(const line of lines){const tr=document.createElement('tr');for(const value of [line.item,line.qty,line.price.toFixed(2),line.sum.toFixed(2)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}
  wrap.append(table);target.append(wrap);
 }
 status.textContent='Сформировано для проверки: '+count+' накладных. Контрагент iiko: Покупатели. Отправка не выполняется.';
}
