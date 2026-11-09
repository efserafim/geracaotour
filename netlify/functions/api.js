import {
  apiPath,
  authenticateCoordinator,
  getSql,
  json,
  ok,
  options,
  parseBody,
  requireAuth,
  signToken,
  sqlErrorCode
} from "./_shared.js";

const ALLOWED_UPDATE = new Set([
  "full_name", "birth_date", "document_number", "phone", "email",
  "emergency_name", "emergency_phone", "guardian_name", "guardian_phone",
  "guardian_document", "dietary_notes", "observations",
  "authorization_status", "payment_status", "paid_at", "attended"
]);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const path = apiPath(event);
    const method = event.httpMethod;
    const parts = path.split("/").filter(Boolean);

    if (method === "GET" && parts[0] === "capacity" && parts.length === 1) {
      return await capacity();
    }
    if (method === "POST" && parts[0] === "register" && parts.length === 1) {
      return await register(event);
    }
    if (method === "POST" && parts[0] === "login" && parts.length === 1) {
      return await login(event);
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
  const rows = await sql`select public.public_capacity() as data`;
  return ok(rows[0]?.data || { registered: 0, paid: 0, capacity: 33 });
}

async function register(event) {
  const body = parseBody(event);
  const participant = body.participant || body;
  const sql = getSql();
  try {
    const rows = await sql`select public.register_participant(${JSON.stringify(participant)}::jsonb) as data`;
    return ok(rows[0]?.data || { ok: true });
  } catch (error) {
    const code = sqlErrorCode(error);
    const status = code === "CAPACITY_REACHED" ? 409
      : code === "DUPLICATE_REGISTRATION" ? 409
      : code === "INVALID_PARTICIPANT" ? 400
      : 500;
    return json(status, { error: code });
  }
}

async function login(event) {
  const { email, password } = parseBody(event);
  if (!authenticateCoordinator(email, password)) {
    return json(401, { error: "INVALID_CREDENTIALS" });
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
  return ok({ data: rows });
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
    return ok({ data: rows[0] });
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
  const rows = await sql`delete from public.registrations where id = ${id}::uuid returning id`;
  if (!rows.length) return json(404, { error: "NOT_FOUND" });
  return ok({ ok: true });
}
