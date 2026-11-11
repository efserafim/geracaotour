-- Rode no SQL Editor do Neon (projeto novo).
-- A connection string fica só nas variáveis de ambiente do Netlify — nunca no front-end.

create extension if not exists pgcrypto;

create table if not exists public.event_settings (
  id boolean primary key default true check (id),
  tour_name text not null default 'Geração Tour',
  tour_date text not null default 'Data a confirmar',
  capacity integer not null default 33 check (capacity > 0)
);

insert into public.event_settings (id, tour_name, tour_date, capacity)
values (true, 'Peregrinação Jovem — Geração Eucarística', '5 de dezembro de 2026', 33)
on conflict (id) do nothing;

create table if not exists public.registrations (
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
  authorization_status text not null default 'pending' check (authorization_status in ('pending', 'delivered')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid')),
  paid_at timestamptz,
  attended boolean not null default false,
  created_at timestamptz not null default now(),
  -- Adultos (18+) passam sem responsável. Menores precisam de responsável completo.
  constraint guardian_required_for_minor check (
    birth_date <= (current_date - interval '18 years') or
    (nullif(trim(guardian_name), '') is not null and nullif(trim(guardian_phone), '') is not null
      and nullif(trim(guardian_document), '') is not null and guardian_consent)
  )
);

create unique index if not exists registrations_document_unique on public.registrations (document_digits);
create unique index if not exists registrations_name_birth_unique
  on public.registrations (lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')), birth_date);

create or replace function public.normalize_registration_document()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.document_digits := regexp_replace(coalesce(new.document_number, ''), '\D', '', 'g');
  if length(new.document_digits) < 5 or length(new.document_digits) > 14 then
    raise exception 'INVALID_PARTICIPANT';
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_registration_document on public.registrations;
create trigger normalize_registration_document
  before insert or update of document_number on public.registrations
  for each row execute function public.normalize_registration_document();

-- Inscrição pública com limite de vagas e proteção contra corrida.
create or replace function public.register_participant(participant jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_count integer;
  max_capacity integer;
  inserted_id uuid;
  participant_birth date;
  normalized_name text;
  normalized_document text;
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

  perform pg_advisory_xact_lock(hashtext('geracao-tour-capacity'));

  select capacity into max_capacity from public.event_settings where id = true;
  select count(*) into current_count from public.registrations;
  if current_count >= max_capacity then
    raise exception 'CAPACITY_REACHED';
  end if;

  if exists (select 1 from public.registrations where document_digits = normalized_document)
    or exists (
      select 1 from public.registrations
      where lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = normalized_name
        and birth_date = participant_birth
    )
  then
    raise exception 'DUPLICATE_REGISTRATION';
  end if;

  insert into public.registrations (
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

  return jsonb_build_object('id', inserted_id, 'registered', current_count + 1);
exception
  when unique_violation then raise exception 'DUPLICATE_REGISTRATION';
end;
$$;

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
$$;

-- Lista de espera: mesma ficha, sem ocupar vaga até a promoção.
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
);

create unique index if not exists waitlist_document_unique on public.waitlist (document_digits);
create unique index if not exists waitlist_name_birth_unique
  on public.waitlist (lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')), birth_date);

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
$$;

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
$$;

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
$$;
