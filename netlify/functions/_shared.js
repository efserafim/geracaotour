import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

export function json(status, body) {
  return {
    statusCode: status,
    headers: CORS,
    body: JSON.stringify(body)
  };
}

export function ok(body) {
  return json(200, body);
}

export function noContent() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export function options() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const error = new Error("DATABASE_URL missing");
    error.status = 503;
    error.code = "DATABASE_URL_MISSING";
    throw error;
  }
  return neon(url, { fullResults: false });
}

let schemaReady = false;
export function resetSchemaFlag() { schemaReady = false; }
export async function ensureSchema(sql = getSql()) {
  if (schemaReady) return;
  // Corrige constraint invertida que bloqueava inscrição de adultos.
  await sql`alter table public.registrations drop constraint if exists guardian_required_for_minor`;
  try {
    await sql`
      alter table public.registrations
      add constraint guardian_required_for_minor check (
        birth_date <= (current_date - interval '18 years')
        or (
          nullif(trim(guardian_name), '') is not null
          and nullif(trim(guardian_phone), '') is not null
          and nullif(trim(guardian_document), '') is not null
          and guardian_consent
        )
      )
    `;
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("already exists")) throw error;
  }

  await sql`
    create table if not exists public.waitlist (
      id uuid primary key default gen_random_uuid(),
      full_name text not null,
      birth_date date not null,
      document_number text not null,
      document_digits text not null,
      phone text not null,
      email text not null,
      emergency_name text not null,
      emergency_phone text not null,
      guardian_name text,
      guardian_phone text,
      guardian_document text,
      guardian_consent boolean not null default false,
      dietary_notes text,
      observations text,
      consent boolean not null default false check (consent),
      created_at timestamptz not null default now()
    )
  `;
  await sql`create unique index if not exists waitlist_document_unique on public.waitlist (document_digits)`;
  await sql`create unique index if not exists waitlist_name_birth_unique
    on public.waitlist (lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')), birth_date)`;

  await sql`
    create or replace function public.public_capacity()
    returns jsonb
    language sql
    stable
    set search_path = public
    as $$
      select jsonb_build_object(
        'registered', (select count(*) from public.registrations),
        'paid', (select count(*) from public.registrations where payment_status = 'paid'),
        'capacity', (select capacity from public.event_settings where id = true),
        'waitlist', (select count(*) from public.waitlist)
      );
    $$
  `;

  await sql`
    create or replace function public.join_waitlist(participant jsonb)
    returns jsonb
    language plpgsql
    set search_path = public
    as $$
    declare
      inserted_id uuid;
      participant_birth date;
      normalized_name text;
      normalized_document text;
      position_n integer;
    begin
      if coalesce((participant ->> 'consent')::boolean, false) is not true
        or length(trim(coalesce(participant ->> 'full_name', ''))) < 3
        or length(trim(coalesce(participant ->> 'document_number', ''))) < 5
        or length(regexp_replace(coalesce(participant ->> 'document_number', ''), '\D', '', 'g')) < 5
        or length(trim(coalesce(participant ->> 'phone', ''))) < 8
        or length(trim(coalesce(participant ->> 'email', ''))) < 5
        or length(trim(coalesce(participant ->> 'emergency_name', ''))) < 3
        or length(trim(coalesce(participant ->> 'emergency_phone', ''))) < 8
        or coalesce(participant ->> 'birth_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      then
        raise exception 'INVALID_PARTICIPANT';
      end if;

      participant_birth := (participant ->> 'birth_date')::date;
      normalized_name := lower(regexp_replace(trim(participant ->> 'full_name'), '\s+', ' ', 'g'));
      normalized_document := regexp_replace(participant ->> 'document_number', '\D', '', 'g');

      if participant_birth > current_date or length(normalized_document) > 14 then
        raise exception 'INVALID_PARTICIPANT';
      end if;
      if participant_birth > (current_date - interval '18 years')
        and (length(trim(coalesce(participant ->> 'guardian_name', ''))) < 3
          or length(regexp_replace(coalesce(participant ->> 'guardian_document', ''), '\D', '', 'g')) < 5
          or length(trim(coalesce(participant ->> 'guardian_phone', ''))) < 8
          or coalesce((participant ->> 'guardian_consent')::boolean, false) is not true)
      then
        raise exception 'INVALID_PARTICIPANT';
      end if;

      if exists (select 1 from public.registrations where document_digits = normalized_document)
        or exists (
          select 1 from public.registrations
          where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = normalized_name
            and birth_date = participant_birth
        )
        or exists (select 1 from public.waitlist where document_digits = normalized_document)
        or exists (
          select 1 from public.waitlist
          where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = normalized_name
            and birth_date = participant_birth
        )
      then
        raise exception 'DUPLICATE_REGISTRATION';
      end if;

      insert into public.waitlist (
        full_name, birth_date, document_number, document_digits, phone, email,
        emergency_name, emergency_phone, guardian_name, guardian_phone,
        guardian_document, guardian_consent, dietary_notes, observations, consent
      ) values (
        trim(participant ->> 'full_name'), participant_birth, trim(participant ->> 'document_number'),
        normalized_document, trim(participant ->> 'phone'), lower(trim(participant ->> 'email')),
        trim(participant ->> 'emergency_name'), trim(participant ->> 'emergency_phone'),
        nullif(trim(participant ->> 'guardian_name'), ''), nullif(trim(participant ->> 'guardian_phone'), ''),
        nullif(trim(participant ->> 'guardian_document'), ''), coalesce((participant ->> 'guardian_consent')::boolean, false),
        nullif(trim(participant ->> 'dietary_notes'), ''),
        nullif(trim(participant ->> 'observations'), ''), true
      ) returning id into inserted_id;

      select count(*) into position_n from public.waitlist;
      return jsonb_build_object('id', inserted_id, 'position', position_n);
    exception
      when unique_violation then raise exception 'DUPLICATE_REGISTRATION';
    end;
    $$
  `;

  await sql`
    create or replace function public.promote_waitlist(entry_id uuid)
    returns jsonb
    language plpgsql
    set search_path = public
    as $$
    declare
      entry public.waitlist%rowtype;
      result jsonb;
      participant jsonb;
    begin
      select * into entry from public.waitlist where id = entry_id for update;
      if not found then
        raise exception 'NOT_FOUND';
      end if;

      participant := jsonb_build_object(
        'full_name', entry.full_name,
        'birth_date', to_char(entry.birth_date, 'YYYY-MM-DD'),
        'document_number', entry.document_number,
        'phone', entry.phone,
        'email', entry.email,
        'emergency_name', entry.emergency_name,
        'emergency_phone', entry.emergency_phone,
        'guardian_name', coalesce(entry.guardian_name, ''),
        'guardian_phone', coalesce(entry.guardian_phone, ''),
        'guardian_document', coalesce(entry.guardian_document, ''),
        'guardian_consent', entry.guardian_consent,
        'dietary_notes', coalesce(entry.dietary_notes, ''),
        'observations', coalesce(entry.observations, ''),
        'consent', true
      );

      result := public.register_participant(participant);
      delete from public.waitlist where id = entry_id;

      return jsonb_build_object(
        'id', result->>'id',
        'registered', result->'registered',
        'promoted', jsonb_build_object(
          'id', entry.id,
          'full_name', entry.full_name,
          'phone', entry.phone,
          'email', entry.email
        )
      );
    end;
    $$
  `;

  await sql`
    create or replace function public.promote_next_waitlist()
    returns jsonb
    language plpgsql
    set search_path = public
    as $$
    declare
      next_id uuid;
    begin
      select id into next_id from public.waitlist order by created_at asc limit 1;
      if next_id is null then
        return jsonb_build_object('promoted', null);
      end if;
      return public.promote_waitlist(next_id);
    end;
    $$
  `;

  schemaReady = true;
}

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET missing");
  return secret;
}

function normalizeCoordinator(item) {
  if (!item || typeof item !== "object") return null;
  const email = String(item.email || item.Email || "").trim().toLowerCase();
  const password = String(item.password || item.senha || item.Password || "");
  if (!email || !password) return null;
  return { email, password };
}

export function getCoordinators() {
  const list = [];

  // Formato simples (recomendado no Netlify): COORDINATOR_EMAIL + COORDINATOR_PASSWORD
  const simpleEmail = String(process.env.COORDINATOR_EMAIL || "").trim().toLowerCase();
  const simplePassword = String(process.env.COORDINATOR_PASSWORD || "");
  if (simpleEmail && simplePassword) {
    list.push({ email: simpleEmail, password: simplePassword });
  }

  // Formato JSON: COORDINATORS=[{"email":"...","password":"..."}]
  let raw = String(process.env.COORDINATORS || "").trim();
  if (raw) {
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      raw = raw.slice(1, -1);
    }
    try {
      let parsed = JSON.parse(raw);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const normalized = normalizeCoordinator(item);
        if (normalized) list.push(normalized);
      }
    } catch {
      // aceita também email:senha ou email|senha
      const match = raw.match(/^([^:|\s]+)[:|](.+)$/);
      if (match) {
        list.push({
          email: match[1].trim().toLowerCase(),
          password: match[2]
        });
      }
    }
  }

  // remove duplicados por e-mail (mantém o primeiro)
  const seen = new Set();
  return list.filter(item => {
    if (seen.has(item.email)) return false;
    seen.add(item.email);
    return true;
  });
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signToken(payload, days = 7) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60
  };
  const encoded = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  const expected = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(encoded));
    if (!payload?.email || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) {
    const error = new Error("UNAUTHORIZED");
    error.status = 401;
    throw error;
  }
  return payload;
}

export function authenticateCoordinator(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  const pass = String(password || "");
  const match = getCoordinators().find(user => user.email === normalized && user.password === pass);
  return Boolean(match);
}

export function apiPath(event) {
  const fromQuery = event.queryStringParameters?.path;
  if (fromQuery) {
    return `/${String(fromQuery).replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  }
  const raw = event.rawUrl || `https://local${event.path || ""}`;
  let pathname = "/";
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = event.path || "/";
  }
  return pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "/")
    .replace(/^\/api\/?/, "/")
    .replace(/\/+$/, "") || "/";
}

export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("INVALID_JSON");
    error.status = 400;
    throw error;
  }
}

export function sqlErrorCode(error) {
  const message = String(error?.message || error || "");
  if (message.includes("CAPACITY_REACHED")) return "CAPACITY_REACHED";
  if (message.includes("DUPLICATE_REGISTRATION") || error?.code === "23505") return "DUPLICATE_REGISTRATION";
  if (message.includes("INVALID_PARTICIPANT")) return "INVALID_PARTICIPANT";
  if (message.includes("guardian_required_for_minor")) return "INVALID_PARTICIPANT";
  if (message.includes("NOT_FOUND")) return "NOT_FOUND";
  return "SERVER_ERROR";
}
