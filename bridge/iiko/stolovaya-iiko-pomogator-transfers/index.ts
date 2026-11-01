import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
// Transfer-only endpoint. Does not modify production documents.
const POM_URL="https://dwdunpyzcfdwokoczenl.supabase.co";
const POM_KEY="sb_publishable_6sFPuw3W1Zfqv9viN41TcQ_xeRhOEzw";
const URL_BASE=Deno.env.get("SUPABASE_URL")||"";
const ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(URL_BASE,ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGIN="https://tblednyh1226-design.github.io";
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type,apikey,x-device-id,x-browser-token",
 "Content-Type":"application/json; charset=utf-8","Vary":"Origin","Cache-Control":"no-store"};
const reply=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:CORS});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const required=(x:unknown,label:string)=>{const s=String(x??"").trim();if(!s)throw Error("Не заполнено: "+label);return s;};
async function verifyMain(req:Request){
 const device=required(req.headers.get("x-device-id"),"MAIN device");
 const code=required(req.headers.get("x-browser-token"),"MAIN token");
 if(!uuid.test(device)||!/^[0-9a-f]{32}$/i.test(code))throw Error("Нет действующего подключения MAIN");
 const r=await fetch(POM_URL+"/functions/v1/plan-bridge-guest",{
  method:"POST",headers:{"Content-Type":"application/json","apikey":POM_KEY,
    "x-device-id":device,"x-browser-token":code},
  body:JSON.stringify({action:"device_status"}),signal:AbortSignal.timeout(12000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.ok||d.device?.id!==device)
    throw Error("Код MAIN недействителен или устройство отключено");
}
async function credentials(){
 const q=await db.rpc("system_iiko_pomogator_credentials");
 if(q.error||!q.data?.base_url||!q.data?.login||!q.data?.password)
   throw Error("Не настроено безопасное подключение iiko");
 const base=String(q.data.base_url).replace(/\/+$/,"");
 if(!/^https:\/\//i.test(base))throw Error("Неверный HTTPS адрес iiko");
 return {base,login:String(q.data.login),password:String(q.data.password)};
}
async function sha1(text:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-1",new TextEncoder().encode(text)))]
 .map(x=>x.toString(16).padStart(2,"0")).join("");}
async function login(c:{base:string,login:string,password:string}){
 const u=new URL(c.base+"/resto/api/auth");u.searchParams.set("login",c.login);
 u.searchParams.set("pass",await sha1(c.password));
 const r=await fetch(u,{signal:AbortSignal.timeout(20000)});
 const s=(await r.text()).trim();
 if(!r.ok||!s||s.length>250)throw Error("iiko не подтвердила вход (HTTP "+r.status+")");
 return s;
}
async function logout(c:{base:string},key:string){
 try{const u=new URL(c.base+"/resto/api/logout");u.searchParams.set("key",key);
 await fetch(u,{signal:AbortSignal.timeout(8000)})}catch{}
}
async function getList(base:string,key:string,path:string){
 const u=new URL(base+path);u.searchParams.set("key",key);
 const r=await fetch(u,{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error("Не удалось проверить актуальные справочники iiko");
 const data=await r.json();
 return Array.isArray(data)?data:Array.isArray(data?.response)?data.response:Array.isArray(data?.items)?data.items:[];
}
function validate(x:any){
 if(!x||typeof x!=="object"||x.status!=="NEW"||x.type!=="transfer"||
    Object.prototype.hasOwnProperty.call(x,"documentNumber")||Object.prototype.hasOwnProperty.call(x,"id"))
  throw Error("Разрешено только новое непроведённое перемещение без номера");
 const date=required(x.dateIncoming,"Дата");
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date))throw Error("Неверная дата");
 const from=required(x.storeFromId,"Склад-отправитель"),to=required(x.storeToId,"Склад-получатель");
 if(!uuid.test(from)||!uuid.test(to)||from===to)throw Error("Неверная пара складов iiko");
 if(!Array.isArray(x.items)||!x.items.length||x.items.length>250)
   throw Error("В документе должно быть 1–250 строк");
 const used=new Set<string>();
 const items=x.items.map((item:any)=>{
  const productId=required(item.productId,"Товар iiko");
  const amount=Number(item.amount);
  if(!uuid.test(productId)||!Number.isFinite(amount)||amount<=0||amount>50000)
    throw Error("Неверная номенклатура или количество");
  if(used.has(productId))throw Error("Один и тот же товар iiko указан дважды");
  used.add(productId);
  return {productId,amount}; // Do not send cost/measureUnitId: server-computed fields.
 });
 return {type:"transfer",dateIncoming:date,status:"NEW",storeFromId:from,storeToId:to,items,
   comment:"Помогатор — перемещение из плана; создано без проведения"};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return reply({ok:false,error:"POST only"},405);
 try{
  if(req.headers.get("origin")!==ORIGIN)throw Error("Недопустимый источник запроса");
  await verifyMain(req);
  const body=await req.json();
  if(body?.action!=="upload_transfer")throw Error("Неизвестная операция");
  const parsed=validate(body.document);
  const c=await credentials();let key="";
  try{
   key=await login(c);
   const [accounts,products]=await Promise.all([
     getList(c.base,key,"/resto/api/v2/entities/accounts/list"),
     getList(c.base,key,"/resto/api/v2/entities/products/list")
   ]);
   const stores=new Set(accounts.filter((a:any)=>a.type==="INVENTORY_ASSETS"&&!a.deleted&&uuid.test(String(a.id||"")))
     .map((a:any)=>String(a.id)));
   const validProducts=new Set(products.filter((p:any)=>!p.deleted&&uuid.test(String(p.id||"")))
     .map((p:any)=>String(p.id)));
   if(!stores.has(parsed.storeFromId)||!stores.has(parsed.storeToId))
      throw Error("Склад удалён или отсутствует в справочнике iiko");
   if(parsed.items.some(item=>!validProducts.has(item.productId)))
      throw Error("В перемещении есть номенклатура, которой больше нет в iiko");
   const dto={dateIncoming:parsed.dateIncoming,status:"NEW",storeFromId:parsed.storeFromId,
      storeToId:parsed.storeToId,comment:parsed.comment,items:parsed.items};
   const u=new URL(c.base+"/resto/api/v2/documents/internalTransfer");u.searchParams.set("key",key);
   const response=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json; charset=utf-8"},
     body:JSON.stringify(dto),signal:AbortSignal.timeout(45000)});
   const raw=(await response.text()).trim();
   let result:any;try{result=JSON.parse(raw)}catch{
     throw Error("iiko вернула ответ неопределённого формата. Проверьте документы перед повтором");
   }
   if(!response.ok||result?.valid===false||result?.success===false||
      result?.processed===true||result?.errorMessage||result?.error)
     throw Error("iiko не подтвердила непроведённое перемещение: "+
       String(result?.errorMessage||result?.error||response.status));
   const id=String(result?.documentId||result?.id||result?.document?.id||"");
   const status=String(result?.status||result?.document?.status||"");
   if(!uuid.test(id))throw Error("iiko не подтвердила ID созданного перемещения. Перед повтором проверьте iiko");
   if(status&&status!=="NEW")throw Error("iiko вернула неожиданный статус "+status+". Проверьте документ");
   return reply({ok:true,accepted:true,id,status:"NEW",
      number:result?.documentNumber||result?.number||null,items:parsed.items.length});
  }finally{if(key)await logout(c,key)}
 }catch(e){
  return reply({ok:false,error:e instanceof Error?e.message:String(e)},400);
 }
});