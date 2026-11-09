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
    'capacity', (select capacity from public.event_settings where id = true)
  );
$$;
