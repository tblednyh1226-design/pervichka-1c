/* Printable internal transfer forms. No iiko writes. */
const transferPrintTotal=lines=>lines.reduce((sum,x)=>sum+(Number.isFinite(x.amount)&&x.price>=0?x.amount:0),0);
const transferPrintMoney=n=>Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
function transferPrintForms(){
 const root=document.getElementById('transferPrintResult');
 if(!root)return;
 root.replaceChildren();
 if(typeof productionDocuments==='undefined'||!productionDocuments.length){root.textContent='Сначала сформируйте перемещения.';return;}
 productionDocuments.forEach((doc,index)=>{
  const wrap=document.createElement('div');wrap.className='card';
  const heading=document.createElement('h4');heading.textContent='№ '+(index+1)+' · '+doc.source+' → '+doc.target;wrap.append(heading);
  if(index===0){const version=document.createElement('p');version.className='muted';version.textContent='Версия расчёта пирогов: 03.11.2026 / проверка ×8 №4';wrap.append(version);}
  const lines=doc.items.map(item=>{
   const row=productionRows[item.sourceRow-1]||[];
   const raw=row[3],clean=String(raw??'').replace(/\s/g,'').replace(',','.');
   const price=clean!==''?Number(clean):NaN;
   // Last-line safeguard: never print an unconverted whole large pie.
   // Already converted rows carry conversionFactor=8 and must not be doubled.
   const isLargePie=/(?:^|[^а-я])пирог(?:и|ов|а|ом)?(?=$|[^а-я])/iu.test(item.name)&&
     !/пирож|мини[\\s-]*пирог|маленьк/iu.test(item.name);
   const quantity=isLargePie
     ? (Number.isFinite(Number(item.sourceQuantity))
         ? Number(item.sourceQuantity)*8
         : item.conversionFactor===8 ? Number(item.quantity) : Number(item.quantity)*8)
     : Number(item.quantity);
   return {name:item.name,quantity,price,amount:price*quantity};
  });
  const missing=lines.filter(x=>!Number.isFinite(x.price)||x.price<0);
  if(missing.length){const p=document.createElement('p');p.className='muted';p.textContent='Нет корректной цены: '+missing.map(x=>x.name).join(', ');wrap.append(p);}
  const table=document.createElement('table'),head=document.createElement('tr');
  ['№','Блюдо','Количество','Цена, руб.','Сумма, руб.'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);});table.append(head);
  lines.forEach((line,i)=>{const tr=document.createElement('tr');[i+1,line.name,line.quantity,Number.isFinite(line.price)?transferPrintMoney(line.price):'—',Number.isFinite(line.amount)?transferPrintMoney(line.amount):'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});table.append(tr);});
  const footer=document.createElement('tr');
  const label=document.createElement('th');label.colSpan=4;label.textContent='ИТОГО';footer.append(label);
  const amount=document.createElement('th');
  amount.textContent=transferPrintMoney(transferPrintTotal(lines));
  footer.append(amount);table.append(footer);
  wrap.append(table);
  const total=document.createElement('p');total.textContent='Итого: '+(transferPrintMoney(transferPrintTotal(lines))+' руб.'+(missing.length?' (без '+missing.length+' поз. без цены)':''));wrap.append(total);
  const print=document.createElement('button');print.textContent='Распечатать';print.onclick=()=>transferPrintOpen(doc,index,lines);wrap.append(print);
  const download=document.createElement('button');download.textContent='Скачать Excel';download.onclick=()=>transferPrintDownload(doc,index,lines);wrap.append(download);
  root.append(wrap);
 });
}
function transferPrintDownload(doc,index,lines){
 if(typeof XLSX==='undefined'){alert('Библиотека Excel не загружена');return;}
 const data=[['Перемещение № '+(index+1)],['Дата',document.getElementById('prodDocDate')?.value||doc.date],['Откуда',doc.source],['Куда',doc.target],[],['№','Блюдо','Количество','Цена, руб.','Сумма, руб.']];
 lines.forEach((x,i)=>data.push([i+1,x.name,x.quantity,Number.isFinite(x.price)?x.price:'',Number.isFinite(x.amount)?x.amount:'']));
 data.push(['','ИТОГО','','',null]);
 const ws=XLSX.utils.aoa_to_sheet(data);
 const firstRow=7;
 const lastRow=firstRow+lines.length-1;
 for(let i=0;i<lines.length;i++){
  const row=firstRow+i;
  ws['E'+row]={t:'n',f:'IF(D'+row+'="","",C'+row+'*D'+row+')',v:Number.isFinite(lines[i].amount)&&lines[i].price>=0?lines[i].amount:0,z:'#,##0.00'};
 }
 const totalRow=lastRow+1;
 ws['E'+totalRow]={t:'n',f:'SUM(E'+firstRow+':E'+lastRow+')',v:transferPrintTotal(lines),z:'#,##0.00'};ws['!cols']=[{wch:7},{wch:45},{wch:16},{wch:16},{wch:18}];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,ws,'Перемещение');
 XLSX.writeFile(book,'Перемещение_'+(index+1)+'_'+String(doc.target).replace(/[^а-яёa-z0-9-]/gi,'_')+'.xlsx');
}
function transferPrintOpen(doc,index,lines){
 const w=window.open('','_blank');if(!w){alert('Разрешите всплывающие окна для печати');return;}
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const body=lines.map((x,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.quantity)+'</td><td>'+(Number.isFinite(x.price)?transferPrintMoney(x.price):'—')+'</td><td>'+(Number.isFinite(x.amount)?transferPrintMoney(x.amount):'—')+'</td></tr>').join('');
 const missing=lines.filter(x=>!Number.isFinite(x.amount)||x.price<0).length;
 const total=transferPrintMoney(transferPrintTotal(lines))+' руб.'+(missing?' (без '+missing+' поз. без цены)':'');
 w.document.write('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Перемещение</title><style>body{font:14px Arial;margin:25px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #777;padding:7px;text-align:left}h2{margin-bottom:8px}@media print{button{display:none}}</style><h2>Перемещение № '+(index+1)+'</h2><p>Дата: '+esc(document.getElementById('prodDocDate')?.value||doc.date)+'</p><p>Откуда: '+esc(doc.source)+'<br>Куда: '+esc(doc.target)+'</p><table><thead><tr><th>№</th><th>Блюдо</th><th>Количество</th><th>Цена, руб.</th><th>Сумма, руб.</th></tr></thead><tbody>'+body+'</tbody><tfoot><tr><th colspan="4" style="text-align:right">ИТОГО</th><th>'+esc(total)+'</th></tr></tfoot></table><h3>Итого: '+esc(total)+'</h3><p>Отпустил: __________________ Получил: __________________</p><button onclick="window.print()">Печать</button></html>');
 w.document.close();w.focus();
}
