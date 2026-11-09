# Geração Tour

Landing page da Peregrinação Jovem (Geração Eucarística): inscrição pública, autorização de menores, painel da coordenação e exportações (CSV/PDF). Os dados ficam no **Neon PostgreSQL**; a API roda em **Netlify Functions**.

## Arquivos

- `index.html`, `styles.css`, `app.js`, `config.js`: site estático.
- `db/schema.sql`: tabelas, índices, trigger e funções de inscrição/capacidade no Neon.
- `netlify/functions/`: API (`/api/capacity`, `/api/register`, `/api/login`, `/api/registrations`).
- `netlify.toml`: publish + redirect `/api/*` → function.
- `image/`: imagens do site.

## 1. Banco no Neon

1. Crie um projeto em [neon.tech](https://neon.tech/).
2. Abra o SQL Editor e rode todo o conteúdo de `db/schema.sql`.
3. Copie a connection string (`DATABASE_URL`).

## 2. Variáveis de ambiente

No Netlify (**Site settings → Environment variables**) e no `.env` local:

```
DATABASE_URL=postgresql://...
AUTH_SECRET=um-segredo-longo-e-aleatorio
COORDINATORS=[{"email":"coordenacao@exemplo.com","password":"senha-forte"}]
```

- `DATABASE_URL`: string do Neon (nunca no front-end).
- `AUTH_SECRET`: assinatura do token da coordenação (mín. 16 caracteres).
- `COORDINATORS`: JSON com e-mails e senhas da equipe (mesmo login do rodapé).

Modelo em `.env.example`.

## 3. Desenvolvimento local

```powershell
npm install
copy .env.example .env
# edite o .env com Neon + senhas
npm run dev
```

Abra o endereço que o Netlify Dev mostrar (em geral `http://localhost:8888`).  
`python -m http.server` **não** sobe a API — use `npm run dev`.

## 4. Publicar no Netlify

1. Em [app.netlify.com](https://app.netlify.com/), **Add new site → Import an existing project** (Git) ou **Deploy manually**.
2. Se for Git: o `netlify.toml` já define build (`node scripts/prepare-dist.mjs`) e publish (`dist`).
3. Em **Site configuration → Environment variables**, crie:
   - `DATABASE_URL` — connection string do Neon
   - `AUTH_SECRET` — segredo longo (ex.: 32+ caracteres)
   - `COORDINATORS` — JSON, ex.: `[{"email":"seu@email.com","password":"sua-senha"}]`
4. Deploy. O endereço fica algo como `https://alguma-coisa.netlify.app`.
5. Atualize `siteUrl` em `config.js` e as tags `canonical` / Open Graph no `index.html` com a URL real.
6. Teste: inscrição, `/api/capacity`, login no rodapé (**Acesso da coordenação**).

## Personalizar o passeio

Edite `config.js` (`tourName`, datas, PIX, roteiro, `capacity` anunciado).  
O limite real de vagas é o `capacity` em `event_settings` no Neon:

```sql
update public.event_settings set capacity = 33 where id = true;
```

## API

| Rota | Auth | Uso |
|------|------|-----|
| `GET /api/capacity` | não | registrados + capacidade |
| `POST /api/register` | não | nova ficha |
| `POST /api/login` | não | `{ email, password }` → `{ token }` |
| `GET /api/registrations` | Bearer | lista |
| `PATCH /api/registrations/:id` | Bearer | PIX, autorização, presença, edição |
| `DELETE /api/registrations/:id` | Bearer | remover |

## Segurança

- Não coloque `DATABASE_URL` nem senhas em `config.js`.
- Só a API acessa o Neon.
- Dados pessoais ficam fora do HTML público; o painel exige token.
