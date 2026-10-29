import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const db = createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'apikey,content-type,x-main-token,x-device-id,x-browser-token,x-job-id','Cache-Control':'no-store'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
function assertOk(r:{error?:{message:string}|null}){if(r.error)throw new Error(r.error.message)}
async function hash(s:string){
  const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return [...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function byMain(req:Request){
  const id=req.headers.get('x-device-id')||'';
  const token=req.headers.get('x-main-token')||'';
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/i.test(token))throw new Error('MAIN не подключён');
  const q=await db.from('plan_guest_devices').select('*').eq('id',id).is('disabled_at',null).maybeSingle();
  assertOk(q);
  if(!q.data || q.data.main_token_hash !== await hash(token))throw new Error('Недействительный ключ MAIN');
  return q.data;
}
async function byBrowser(req:Request){
  const id=req.headers.get('x-device-id')||'';
  const token=req.headers.get('x-browser-token')||'';
  if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{32}$/i.test(token))throw new Error('Сначала введите код подключения с MAIN');
  const q=await db.from('plan_guest_devices').select('id,name,browser_token_hash,last_seen_at').eq('id',id).is('disabled_at',null).maybeSingle();
  assertOk(q);
  if(!q.data||q.data.browser_token_hash!==await hash(token))throw new Error('Недействительный код подключения MAIN');
  return q.data;
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({ok:false,error:'Only POST'},405);
  try{
    if(new URL(req.url).searchParams.get('action')==='upload'){
      const dev=await byMain(req);
      const jobId=req.headers.get('x-job-id')||'';
      const q=await db.from('plan_guest_jobs').select('id').eq('id',jobId).eq('device_id',dev.id).eq('status','processing').maybeSingle();
      assertOk(q);
      if(!q.data)throw new Error('Задание не найдено');
      const contentLength=Number(req.headers.get('content-length')||0);
      if(contentLength>15000000)throw new Error('Excel больше 15 МБ');
      const bytes=new Uint8Array(await req.arrayBuffer());
      if(bytes.length<4||bytes.length>15000000||bytes[0]!==80||bytes[1]!==75)throw new Error('Ожидался XLSX до 15 МБ');
      const path='guest/'+dev.id+'/'+jobId+'/plan.xlsx';
      const u=await db.storage.from('plan-bridge').upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
      assertOk(u);
      const done=await db.from('plan_guest_jobs').update({status:'completed',storage_path:path,finished_at:new Date().toISOString()}).eq('id',jobId).eq('device_id',dev.id).eq('status','processing');
      assertOk(done);
      return reply({ok:true});
    }
    const body=await req.json();
    switch(body.action){
      case 'register': {
        // The device generates both secrets locally; neither is included in public web source.
        const mainToken=String(body.main_token||'').toLowerCase();
        const browserToken=String(body.browser_token||'').toLowerCase();
        if(!/^[0-9a-f]{64}$/.test(mainToken)||!/^[0-9a-f]{32}$/.test(browserToken))
          throw new Error('Некорректный запрос регистрации MAIN');
        const created=await db.from('plan_guest_devices').insert({
          name:'MAIN',main_token_hash:await hash(mainToken),browser_token_hash:await hash(browserToken)
        }).select('id').single();
        assertOk(created);
        return reply({ok:true,device_id:created.data.id});
      }
      case 'claim': {
        const token=String(body.browser_token||'').toLowerCase().replace(/[\s-]/g,'');
        if(!/^[0-9a-f]{32}$/.test(token))throw new Error('Код состоит из 32 символов');
        const q=await db.from('plan_guest_devices').select('id,name,last_seen_at')
          .eq('browser_token_hash',await hash(token)).is('disabled_at',null).maybeSingle();
        assertOk(q);
        if(!q.data)throw new Error('Неверный код MAIN');
        return reply({ok:true,device_id:q.data.id,name:q.data.name,last_seen_at:q.data.last_seen_at});
      }
      case 'device_status': {
        const dev=await byBrowser(req);
        return reply({ok:true,device:{id:dev.id,name:dev.name,last_seen_at:dev.last_seen_at}});
      }
      case 'request': {
        const dev=await byBrowser(req);
        const pending=await db.from('plan_guest_jobs').select('id,status').eq('device_id',dev.id)
          .in('status',['queued','processing']).order('created_at',{ascending:false}).limit(1).maybeSingle();
        assertOk(pending);
        if(pending.data)return reply({ok:true,job_id:pending.data.id,status:pending.data.status});
        const q=await db.from('plan_guest_jobs').insert({device_id:dev.id,status:'queued'}).select('id').single();
        assertOk(q);
        return reply({ok:true,job_id:q.data.id,status:'queued'});
      }
      case 'poll': {
        const dev=await byMain(req);
        const seen=await db.from('plan_guest_devices').update({last_seen_at:new Date().toISOString()}).eq('id',dev.id);
        assertOk(seen);
        const pending=await db.from('plan_guest_jobs').select('id').eq('device_id',dev.id).eq('status','queued')
          .order('created_at',{ascending:true}).limit(1).maybeSingle();
        assertOk(pending);
        if(!pending.data)return reply({ok:true,job_id:null});
        const claim=await db.from('plan_guest_jobs').update({status:'processing',started_at:new Date().toISOString()})
          .eq('id',pending.data.id).eq('status','queued').select('id').maybeSingle();
        assertOk(claim);
        return reply({ok:true,job_id:claim.data?.id||null});
      }
      case 'fail': {
        const dev=await byMain(req);
        const jobId=String(body.job_id||'');
        const q=await db.from('plan_guest_jobs').update({
          status:'failed',error_message:String(body.message||'Ошибка MAIN').slice(0,500),finished_at:new Date().toISOString()
        }).eq('id',jobId).eq('device_id',dev.id).eq('status','processing');
        assertOk(q);return reply({ok:true});
      }
      case 'status': {
        const dev=await byBrowser(req);
        const jobId=String(body.job_id||'');
        const q=await db.from('plan_guest_jobs').select('id,status,error_message,storage_path').eq('id',jobId).eq('device_id',dev.id).maybeSingle();
        assertOk(q);
        if(!q.data)throw new Error('Задание не найдено');
        let download_url=null;
        if(q.data.status==='completed'&&q.data.storage_path){
          const signed=await db.storage.from('plan-bridge').createSignedUrl(q.data.storage_path,120);
          assertOk(signed); download_url=signed.data.signedUrl;
        }
        return reply({ok:true,status:q.data.status,error:q.data.error_message,download_url});
      }
      default:return reply({ok:false,error:'Неверная команда'},400);
    }
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    console.error('plan-bridge-guest:',msg);
    return reply({ok:false,error:msg},400);
  }
});