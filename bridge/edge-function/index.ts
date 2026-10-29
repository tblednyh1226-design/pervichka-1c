import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const url = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-id, x-main-token, x-job-id',
  'Cache-Control': 'no-store'
};
const encoder = new TextEncoder();
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'}
});
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const check = (response: {error?: {message:string} | null}) => {
  if (response.error) throw new Error(response.error.message);
};
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes)).map(v => v.toString(16).padStart(2,'0')).join('');
}
function randomHex(bytes: number) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
}
async function member(req: Request, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('Не выбрано рабочее пространство');
  const auth = req.headers.get('authorization') || '';
  const token = auth.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new Error('Войдите в Помогатор');
  const authRes = await db.auth.getUser(token);
  if (!authRes.data.user) throw new Error('Сессия истекла. Войдите снова');
  const m = await db.from('workspace_members').select('workspace_id')
    .eq('user_id', authRes.data.user.id).eq('workspace_id', workspaceId).maybeSingle();
  check(m);
  if (!m.data) throw new Error('Нет доступа к рабочему пространству');
  return authRes.data.user.id;
}
async function device(req: Request) {
  const id = req.headers.get('x-device-id') || '';
  const token = req.headers.get('x-main-token') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{64}$/i.test(token)) throw new Error('MAIN не настроен');
  const r = await db.from('plan_bridge_devices').select('*').eq('id',id).is('disabled_at',null).maybeSingle();
  check(r);
  if (!r.data || r.data.token_hash !== await digest(token)) throw new Error('Неверный ключ MAIN');
  return r.data;
}
Deno.serve(async(req: Request)=>{
  if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  if (req.method !== 'POST') return reply({error:'Use POST'},405);
  try {
    const action = new URL(req.url).searchParams.get('action');
    if (action === 'upload') {
      const dev = await device(req);
      const id = req.headers.get('x-job-id') || '';
      const jr = await db.from('plan_bridge_jobs').select('*').eq('id',id)
        .eq('device_id',dev.id).eq('status','processing').maybeSingle();
      check(jr);
      if (!jr.data) throw new Error('Задание не найдено или завершено');
      const len = Number(req.headers.get('content-length')||'0');
      if(len > 15000000) throw new Error('Excel больше 15 МБ');
      const bytes = new Uint8Array(await req.arrayBuffer());
      if(bytes.length < 4 || bytes.length > 15000000 || bytes[0] !== 80 || bytes[1] !== 75)
        throw new Error('Файл не похож на XLSX или превышает 15 МБ');
      const path = dev.workspace_id + '/' + id + '/plan.xlsx';
      const saved = await db.storage.from('plan-bridge').upload(path,bytes,{
        contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert:false
      });
      if(saved.error) throw saved.error;
      const done = await db.from('plan_bridge_jobs').update({
        status:'completed',storage_path:path,finished_at:new Date().toISOString()
      }).eq('id',id).eq('status','processing');
      check(done);
      return reply({ok:true});
    }
    const data = await req.json();
    switch(data.action) {
      case 'create_pair': {
        const workspace = String(data.workspace_id||'');
        const uid = await member(req,workspace);
        const code = randomHex(6);
        const created = await db.from('plan_bridge_pairings').insert({
          workspace_id:workspace,created_by:uid,code_hash:await digest(code),
          expires_at:new Date(Date.now()+10*60*1000).toISOString()
        });
        check(created);
        return reply({ok:true,code,expires_minutes:10});
      }
      case 'pair': {
        const code = String(data.code||'').trim().toUpperCase().replace(/[\s-]/g,'');
        const token = String(data.token||'').toLowerCase();
        if(!/^[0-9A-F]{12}$/.test(code)||!/^[0-9a-f]{64}$/.test(token))
          throw new Error('Неверный код подключения');
        const found = await db.from('plan_bridge_pairings').select('id,workspace_id')
          .eq('code_hash',await digest(code)).is('consumed_at',null)
          .gt('expires_at',new Date().toISOString()).maybeSingle();
        check(found);
        if(!found.data) throw new Error('Код недействителен или истёк');
        const consumed = await db.from('plan_bridge_pairings')
          .update({consumed_at:new Date().toISOString()})
          .eq('id',found.data.id).is('consumed_at',null).select('id').maybeSingle();
        check(consumed);
        if(!consumed.data) throw new Error('Код уже использован');
        const created = await db.from('plan_bridge_devices').insert({
          workspace_id:found.data.workspace_id,name:'MAIN',token_hash:await digest(token)
        }).select('id').single();
        check(created);
        return reply({ok:true,device_id:created.data.id});
      }
      case 'device_status': {
        const workspace = String(data.workspace_id||'');
        await member(req,workspace);
        const found = await db.from('plan_bridge_devices').select('id,name,last_seen_at,created_at')
          .eq('workspace_id',workspace).is('disabled_at',null)
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        check(found);
        return reply({ok:true,device:found.data||null});
      }
      case 'request': {
        const workspace = String(data.workspace_id||'');
        const uid = await member(req,workspace);
        const found = await db.from('plan_bridge_devices').select('id')
          .eq('workspace_id',workspace).is('disabled_at',null)
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        check(found);
        if(!found.data) throw new Error('Сначала подключите MAIN');
        const pending = await db.from('plan_bridge_jobs').select('id,status')
          .eq('device_id',found.data.id).in('status',['queued','processing'])
          .order('created_at',{ascending:false}).limit(1).maybeSingle();
        check(pending);
        if(pending.data) return reply({ok:true,job_id:pending.data.id,status:pending.data.status});
        const created = await db.from('plan_bridge_jobs').insert({
          workspace_id:workspace,device_id:found.data.id,requested_by:uid,status:'queued'
        }).select('id').single();
        check(created);
        return reply({ok:true,job_id:created.data.id,status:'queued'});
      }
      case 'poll': {
        const dev = await device(req);
        const seen = await db.from('plan_bridge_devices').update({last_seen_at:new Date().toISOString()}).eq('id',dev.id);
        check(seen);
        const oldest = await db.from('plan_bridge_jobs').select('id')
          .eq('device_id',dev.id).eq('status','queued')
          .order('created_at',{ascending:true}).limit(1).maybeSingle();
        check(oldest);
        if(!oldest.data) return reply({ok:true,job_id:null});
        const claim = await db.from('plan_bridge_jobs').update({
          status:'processing',started_at:new Date().toISOString()
        }).eq('id',oldest.data.id).eq('status','queued').select('id').maybeSingle();
        check(claim);
        return reply({ok:true,job_id:claim.data?.id||null});
      }
      case 'fail': {
        const dev = await device(req);
        const jobId = String(data.job_id||'');
        const updated = await db.from('plan_bridge_jobs').update({
          status:'failed',error_message:String(data.message||'Ошибка MAIN').slice(0,500),
          finished_at:new Date().toISOString()
        }).eq('id',jobId).eq('device_id',dev.id).eq('status','processing');
        check(updated);
        return reply({ok:true});
      }
      case 'status': {
        const workspace = String(data.workspace_id||'');
        await member(req,workspace);
        const jobId = String(data.job_id||'');
        const found = await db.from('plan_bridge_jobs')
          .select('id,status,error_message,storage_path,created_at')
          .eq('id',jobId).eq('workspace_id',workspace).maybeSingle();
        check(found);
        if(!found.data) throw new Error('Задание не найдено');
        let download_url = null;
        if(found.data.status==='completed' && found.data.storage_path) {
          const signed = await db.storage.from('plan-bridge').createSignedUrl(found.data.storage_path,120);
          if(signed.error) throw signed.error;
          download_url = signed.data.signedUrl;
        }
        return reply({ok:true,status:found.data.status,error:found.data.error_message,download_url});
      }
      default: return reply({error:'Unknown action'},400);
    }
  } catch(e) {
    console.error('plan-bridge',errorText(e));
    return reply({ok:false,error:errorText(e)},400);
  }
});
