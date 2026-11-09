-- Corrige a constraint que, invertida, bloqueava inscrição de adultos.
-- Rode no SQL Editor do Neon.

alter table public.registrations
  drop constraint if exists guardian_required_for_minor;

alter table public.registrations
  add constraint guardian_required_for_minor check (
    birth_date <= (current_date - interval '18 years') or
    (nullif(trim(guardian_name), '') is not null
      and nullif(trim(guardian_phone), '') is not null
      and nullif(trim(guardian_document), '') is not null
      and guardian_consent)
  );
