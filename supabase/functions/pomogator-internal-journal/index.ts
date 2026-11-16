const SITE = 'https://tblednyh1226-design.github.io';
const ORG = '3d89b13c-28e9-4cb8-a439-407c6ecaac22';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const sources = {
  staff: { table: 'kolhoz_staff_writeoffs', key: 'staff_writeoff_id' },
  cloud: { table: 'kolhoz_writeoffs', key: 'cloud_writeoff_id' },
};
const cors = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'private, no-store',
  'Vary': 'Origin',
};
const reply = (status, body) => Response.json(body, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.headers.get('origin') !== SITE) return reply(403, { error: 'Недопустимый источник запроса.' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Недопустимый метод запроса.' });

  // A text/plain POST avoids the browser's cross-origin preflight. The token
  // is sent only in the encrypted request body, never in a URL or a log.
  const raw = await req.text();
  if (raw.length > 8192) return reply(413, { error: 'Запрос слишком большой.' });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Некорректный запрос.' }); }
  if (!body || typeof body.token !== 'string' || !JWT.test(body.token))
    return reply(401, { error: 'Войдите в Помогатор.' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) return reply(503, { error: 'Журнал временно недоступен.' });
  const headers = { apikey: key, Authorization: 'Bearer ' + body.token };
  try {
    // Validate the user session before querying. PostgREST additionally
    // checks the same user JWT and applies the existing row-level policies.
    const auth = await fetch(url + '/auth/v1/user', { headers, signal: AbortSignal.timeout(5000) });
    if (!auth.ok) return reply(auth.status === 401 || auth.status === 403 ? 401 : 503, { error: 'Не удалось подтвердить сессию.' });
    const user = await auth.json();
    if (!user?.id || user.is_anonymous) return reply(401, { error: 'Войдите в Помогатор.' });

    const rest = (table, params, init = {}) => fetch(url + '/rest/v1/' + table + '?' + new URLSearchParams(params), {
      ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000),
    });
    const readTable = async (table, params) => {
      const r = await rest(table, params);
      if (!r.ok) throw r.status;
      return r.json();
    };

    if (body.action === 'documents') {
      if (typeof body.organizationId !== 'string' || !UUID.test(body.organizationId))
        return reply(400, { error: 'Выберите организацию.' });
      const rows = await readTable('documents', {
        select: 'id,source_file_name,status,recognition_status,created_at',
        organization_id: 'eq.' + body.organizationId, order: 'created_at.desc', limit: '50',
      });
      return reply(200, { rows });
    }

    const org = await readTable('organizations', { select: 'id', id: 'eq.' + ORG, limit: '1' });
    if (!org.length) return reply(403, { error: 'Нет доступа к списаниям Колхоза.' });

    if (body.action === 'writeoffs') {
      const entries = Object.entries(sources);
      const results = await Promise.allSettled(entries.map(async ([source, cfg]) => {
        const rows = await readTable(cfg.table, {
          select: 'id,doc_date,shift,warehouse,status,created_at,updated_at',
          organization_id: 'eq.' + ORG, order: 'created_at.desc', limit: '100',
        });
        let marks = [];
        let marksAvailable = true;
        if (rows.length) {
          try {
            marks = await readTable('kolhoz_writeoff_processing', {
              select: cfg.key + ',is_processed', [cfg.key]: 'in.(' + rows.map(row => row.id).join(',') + ')',
            });
          } catch { marksAvailable = false; }
        }
        const processed = new Set(marks.filter(mark => mark.is_processed).map(mark => mark[cfg.key]));
        return rows.map(row => ({ ...row, _storage: source, is_processed: marksAvailable ? processed.has(row.id) : null }));
      }));
      const groups = {};
      for (let i = 0; i < entries.length; i++) {
        const result = results[i];
        if (result.status === 'rejected' && (result.reason === 401 || result.reason === 403))
          return reply(result.reason, { error: 'Нет доступа к списаниям.' });
        groups[entries[i][0]] = result.status === 'fulfilled' ? result.value : null;
      }
      if (!groups.staff && !groups.cloud) return reply(503, { error: 'Не удалось прочитать списания.' });
      return reply(200, groups);
    }

    if (body.action === 'mark') {
      const cfg = body.source === 'staff' ? sources.staff : body.source === 'cloud' ? sources.cloud : null;
      if (!cfg || typeof body.id !== 'string' || !UUID.test(body.id) || typeof body.checked !== 'boolean')
        return reply(400, { error: 'Некорректная отметка.' });
      const doc = await readTable(cfg.table, { select: 'id', organization_id: 'eq.' + ORG, id: 'eq.' + body.id, limit: '1' });
      if (!doc.length) return reply(404, { error: 'Списание не найдено.' });
      const r = await rest('kolhoz_writeoff_processing', { on_conflict: cfg.key, select: 'is_processed' }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ [cfg.key]: body.id, is_processed: body.checked }),
      });
      if (!r.ok) throw r.status;
      const rows = await r.json();
      if (rows.length !== 1 || rows[0].is_processed !== body.checked)
        return reply(502, { error: 'Сервер не подтвердил изменение.' });
      return reply(200, { is_processed: rows[0].is_processed });
    }

    return reply(400, { error: 'Неизвестный запрос журнала.' });
  } catch (error) {
    const status = error === 401 || error === 403 ? error : 503;
    return reply(status, { error: status === 503 ? 'Журнал временно недоступен.' : 'Нет доступа к журналу.' });
  }
});
