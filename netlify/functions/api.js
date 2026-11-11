import {
  apiPath,
  authenticateCoordinator,
  ensureSchema,
  getCoordinators,
  getSql,
  json,
  ok,
  options,
  parseBody,
  requireAuth,
  resetSchemaFlag,
  signToken,
  sqlErrorCode
} from "./_shared.js";

const ALLOWED_UPDATE = new Set([
  "full_name", "birth_date", "document_number", "phone", "email",
  "emergency_name", "emergency_phone", "guardian_name", "guardian_phone",
  "guardian_document", "dietary_notes", "observations",
  "authorization_status", "payment_status", "paid_at", "attended"
]);

/** Neon DATE values serialize as ISO timestamps; keep YYYY-MM-DD for the UI. */
function serializeRegistration(row) {
  if (!row) return row;
  const birth = row.birth_date;
  let birth_date = birth;
  if (birth instanceof Date && !Number.isNaN(birth.getTime())) {
    birth_date = birth.toISOString().slice(0, 10);
  } else if (birth != null) {
    const match = String(birth).match(/^(\d{4}-\d{2}-\d{2})/);
    birth_date = match ? match[1] : birth;
  }
  return { ...row, birth_date };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const path = apiPath(event);
    const method = event.httpMethod;
    const parts = path.split("/").filter(Boolean);

    if (method === "GET" && parts[0] === "health" && parts.length === 1) {
      return ok({
        ok: true,
        databaseUrl: Boolean(process.env.DATABASE_URL),
        authSecret: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
        coordinators: getCoordinators().length > 0,
        coordinatorAccounts: getCoordinators().length
      });
    }
    if (method === "GET" && parts[0] === "capacity" && parts.length === 1) {
      return await capacity();
    }
    if (method === "POST" && parts[0] === "register" && parts.length === 1) {
      return await register(event);
    }
    if (method === "POST" && parts[0] === "login" && parts.length === 1) {
      return await login(event);
    }
    if (parts[0] === "waitlist" && parts.length === 1) {
      if (method === "GET") return await listWaitlist(event);
      if (method === "POST") return await joinWaitlist(event);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (parts[0] === "waitlist" && parts.length === 2 && parts[1] === "promote-next") {
      if (method === "POST") return await promoteNextWaitlist(event);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (parts[0] === "waitlist" && parts.length === 3 && parts[2] === "promote") {
      if (method === "POST") return await promoteWaitlist(event, parts[1]);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (parts[0] === "waitlist" && parts.length === 2) {
      if (method === "DELETE") return await deleteWaitlist(event, parts[1]);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (parts[0] === "registrations" && parts.length === 1) {
      if (method === "GET") return await listRegistrations(event);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (parts[0] === "registrations" && parts.length === 2) {
      if (method === "PATCH") return await updateRegistration(event, parts[1]);
      if (method === "DELETE") return await deleteRegistration(event, parts[1]);
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }

    return json(404, { error: "NOT_FOUND" });
  } catch (error) {
    if (error.status === 401 || error.message === "UNAUTHORIZED") {
      return json(401, { error: "UNAUTHORIZED" });
    }
    if (error.message === "INVALID_JSON") {
      return json(400, { error: "INVALID_JSON" });
    }
    if (error.code === "DATABASE_URL_MISSING" || error.message === "DATABASE_URL missing") {
      return json(503, {
        error: "DATABASE_URL_MISSING",
        message: "Configure DATABASE_URL nas Environment variables do Netlify."
      });
    }
    console.error(error);
    return json(500, { error: "SERVER_ERROR", message: String(error.message || error) });
  }
}

async function capacity() {
  const sql = getSql();
  try { await ensureSchema(sql); } catch (error) { console.error("ensureSchema:", error); }
  const rows = await sql`select public.public_capacity() as data`;
  const data = rows[0]?.data;
  return ok(typeof data === "string" ? JSON.parse(data) : (data || { registered: 0, paid: 0, capacity: 33 }));
}

async function register(event) {
  const body = parseBody(event);
  const participant = body.participant || body;
  const sql = getSql();
  try {
    await ensureSchema(sql);
    // Neon serializa objetos JS como JSON; CAST garante jsonb na função SQL.
    const rows = await sql`
      select public.register_participant(cast(${JSON.stringify(participant)} as jsonb)) as data
    `;
    const data = rows[0]?.data;
    return ok(typeof data === "string" ? JSON.parse(data) : (data || { ok: true }));
  } catch (error) {
    console.error("register_participant failed:", error);
    // Se a constraint antiga ainda atrapalhou, tenta corrigir e repetir uma vez.
    if (String(error?.message || "").includes("guardian_required_for_minor")) {
      try {
        resetSchemaFlag();
        await ensureSchema(sql);
        const rows = await sql`
          select public.register_participant(cast(${JSON.stringify(participant)} as jsonb)) as data
        `;
        const data = rows[0]?.data;
        return ok(typeof data === "string" ? JSON.parse(data) : (data || { ok: true }));
      } catch (retryError) {
        error = retryError;
      }
    }
    const code = sqlErrorCode(error);
    const status = code === "CAPACITY_REACHED" ? 409
      : code === "DUPLICATE_REGISTRATION" ? 409
      : code === "INVALID_PARTICIPANT" ? 400
      : 500;
    return json(status, {
      error: code,
      message: code === "SERVER_ERROR" ? String(error?.message || error) : undefined
    });
  }
}

async function login(event) {
  const { email, password } = parseBody(event);
  if (!authenticateCoordinator(email, password)) {
    const hasCoordinators = getCoordinators().length > 0;
    return json(401, {
      error: "INVALID_CREDENTIALS",
      hint: hasCoordinators
        ? "E-mail ou senha não conferem."
        : "Configure COORDINATOR_EMAIL e COORDINATOR_PASSWORD no Netlify e faça redeploy."
    });
  }
  const token = signToken({ email: String(email).trim().toLowerCase() });
  return ok({ token, email: String(email).trim().toLowerCase() });
}

async function listRegistrations(event) {
  requireAuth(event);
  const sql = getSql();
  const rows = await sql`
    select *
    from public.registrations
    order by created_at desc
  `;
  return ok({ data: rows.map(serializeRegistration) });
}

async function updateRegistration(event, id) {
  requireAuth(event);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "INVALID_ID" });

  const body = parseBody(event);
  const updates = {};
  for (const key of ALLOWED_UPDATE) {
    if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
  }
  if (!Object.keys(updates).length) return json(400, { error: "EMPTY_UPDATE" });

  if (Object.prototype.hasOwnProperty.call(updates, "payment_status")) {
    if (!["pending", "paid"].includes(updates.payment_status)) {
      return json(400, { error: "INVALID_PAYMENT_STATUS" });
    }
    if (updates.payment_status === "paid" && !Object.prototype.hasOwnProperty.call(updates, "paid_at")) {
      updates.paid_at = new Date().toISOString();
    }
    if (updates.payment_status === "pending") updates.paid_at = null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "authorization_status")
    && !["pending", "delivered"].includes(updates.authorization_status)) {
    return json(400, { error: "INVALID_AUTHORIZATION_STATUS" });
  }

  const sql = getSql();
  const patch = JSON.stringify(updates);
  try {
    const rows = await sql`
      with patch as (select ${patch}::jsonb as j)
      update public.registrations r set
        full_name = case when p.j ? 'full_name' then p.j->>'full_name' else r.full_name end,
        birth_date = case when p.j ? 'birth_date' then (p.j->>'birth_date')::date else r.birth_date end,
        document_number = case when p.j ? 'document_number' then p.j->>'document_number' else r.document_number end,
        phone = case when p.j ? 'phone' then p.j->>'phone' else r.phone end,
        email = case when p.j ? 'email' then p.j->>'email' else r.email end,
        emergency_name = case when p.j ? 'emergency_name' then p.j->>'emergency_name' else r.emergency_name end,
        emergency_phone = case when p.j ? 'emergency_phone' then p.j->>'emergency_phone' else r.emergency_phone end,
        guardian_name = case when p.j ? 'guardian_name' then nullif(p.j->>'guardian_name', '') else r.guardian_name end,
        guardian_phone = case when p.j ? 'guardian_phone' then nullif(p.j->>'guardian_phone', '') else r.guardian_phone end,
        guardian_document = case when p.j ? 'guardian_document' then nullif(p.j->>'guardian_document', '') else r.guardian_document end,
        dietary_notes = case when p.j ? 'dietary_notes' then nullif(p.j->>'dietary_notes', '') else r.dietary_notes end,
        observations = case when p.j ? 'observations' then nullif(p.j->>'observations', '') else r.observations end,
        authorization_status = case when p.j ? 'authorization_status' then p.j->>'authorization_status' else r.authorization_status end,
        payment_status = case when p.j ? 'payment_status' then p.j->>'payment_status' else r.payment_status end,
        paid_at = case
          when p.j ? 'paid_at' and jsonb_typeof(p.j->'paid_at') = 'null' then null
          when p.j ? 'paid_at' then (p.j->>'paid_at')::timestamptz
          when p.j ? 'payment_status' and p.j->>'payment_status' = 'pending' then null
          when p.j ? 'payment_status' and p.j->>'payment_status' = 'paid' then coalesce(r.paid_at, now())
          else r.paid_at
        end,
        attended = case when p.j ? 'attended' then (p.j->>'attended')::boolean else r.attended end
      from patch p
      where r.id = ${id}::uuid
      returning r.*`;
    if (!rows.length) return json(404, { error: "NOT_FOUND" });
    return ok({ data: serializeRegistration(rows[0]) });
  } catch (error) {
    const code = sqlErrorCode(error);
    const status = code === "DUPLICATE_REGISTRATION" || code === "INVALID_PARTICIPANT" ? 409 : 500;
    return json(status, { error: code === "SERVER_ERROR" && error?.code === "23505" ? "DUPLICATE_REGISTRATION" : code });
  }
}

async function deleteRegistration(event, id) {
  requireAuth(event);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "INVALID_ID" });
  const sql = getSql();
  await ensureSchema(sql);
  const rows = await sql`delete from public.registrations where id = ${id}::uuid returning id`;
  if (!rows.length) return json(404, { error: "NOT_FOUND" });

  // Vaga liberada: promove automaticamente o primeiro da lista de espera.
  let promoted = null;
  try {
    const resultRows = await sql`select public.promote_next_waitlist() as data`;
    const data = resultRows[0]?.data;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (parsed?.promoted) promoted = parsed.promoted;
  } catch (error) {
    const code = sqlErrorCode(error);
    if (code !== "CAPACITY_REACHED" && code !== "NOT_FOUND") {
      console.error("auto-promote after delete failed:", error);
    }
  }
  return ok({ ok: true, promoted });
}

async function joinWaitlist(event) {
  const body = parseBody(event);
  const participant = body.participant || body;
  const sql = getSql();
  try {
    await ensureSchema(sql);
    const rows = await sql`
      select public.join_waitlist(cast(${JSON.stringify(participant)} as jsonb)) as data
    `;
    const data = rows[0]?.data;
    return ok(typeof data === "string" ? JSON.parse(data) : (data || { ok: true }));
  } catch (error) {
    console.error("join_waitlist failed:", error);
    const code = sqlErrorCode(error);
    const status = code === "DUPLICATE_REGISTRATION" ? 409
      : code === "INVALID_PARTICIPANT" ? 400
      : 500;
    return json(status, {
      error: code,
      message: code === "SERVER_ERROR" ? String(error?.message || error) : undefined
    });
  }
}

async function listWaitlist(event) {
  requireAuth(event);
  const sql = getSql();
  await ensureSchema(sql);
  const rows = await sql`
    select *
    from public.waitlist
    order by created_at asc
  `;
  return ok({ data: rows.map(serializeRegistration) });
}

async function promoteWaitlist(event, id) {
  requireAuth(event);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "INVALID_ID" });
  const sql = getSql();
  try {
    await ensureSchema(sql);
    const rows = await sql`select public.promote_waitlist(${id}::uuid) as data`;
    const data = rows[0]?.data;
    return ok(typeof data === "string" ? JSON.parse(data) : data);
  } catch (error) {
    console.error("promote_waitlist failed:", error);
    const code = sqlErrorCode(error);
    const status = code === "CAPACITY_REACHED" || code === "DUPLICATE_REGISTRATION" ? 409
      : code === "NOT_FOUND" ? 404
      : code === "INVALID_PARTICIPANT" ? 400
      : 500;
    return json(status, { error: code });
  }
}

async function promoteNextWaitlist(event) {
  requireAuth(event);
  const sql = getSql();
  try {
    await ensureSchema(sql);
    const rows = await sql`select public.promote_next_waitlist() as data`;
    const data = rows[0]?.data;
    return ok(typeof data === "string" ? JSON.parse(data) : data);
  } catch (error) {
    console.error("promote_next_waitlist failed:", error);
    const code = sqlErrorCode(error);
    const status = code === "CAPACITY_REACHED" || code === "DUPLICATE_REGISTRATION" ? 409
      : code === "NOT_FOUND" ? 404
      : 500;
    return json(status, { error: code });
  }
}

async function deleteWaitlist(event, id) {
  requireAuth(event);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "INVALID_ID" });
  const sql = getSql();
  await ensureSchema(sql);
  const rows = await sql`delete from public.waitlist where id = ${id}::uuid returning id`;
  if (!rows.length) return json(404, { error: "NOT_FOUND" });
  return ok({ ok: true });
}
