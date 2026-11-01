/* Independent tabs for cooking and transfer workflows.
   Switching tabs never destroys the already loaded Excel or prepared documents. */
let productionActiveTab='cooking';
function productionSwitchTab(which){
  const transfer=which==='transfers';
  if(!transfer && which!=='cooking')return;
  productionActiveTab=which;
  const first=document.getElementById('productionPanelCooking');
  const second=document.getElementById('productionPanelTransfers');
  const firstButton=document.getElementById('productionTabCooking');
  const secondButton=document.getElementById('productionTabTransfers');
  if(!first||!second||!firstButton||!secondButton)return;
  first.hidden=transfer;second.hidden=!transfer;
  for(const [button,active] of [[firstButton,!transfer],[secondButton,transfer]]){
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
    button.tabIndex=active?0:-1;
  }
  if(transfer&&typeof productionMainConnectionStatus==='function')void productionMainConnectionStatus();
  // Afternoon Excel is independent. Never auto-import the morning workbook.
}
document.addEventListener('DOMContentLoaded',()=>productionSwitchTab('cooking'));
