# Deploying ArtiSoul to Vercel

The whole app deploys as **one Vercel project**:

| Piece | Where it runs on Vercel |
| --- | --- |
| React + Vite frontend (`frontend/`) | Static files built to `frontend/dist`, served from the CDN |
| Express API (`backend/src/app.js`) | One serverless function (`api/index.js`) answering every `/api/*` request |
| MySQL | **Not on Vercel.** You need a hosted MySQL database (see step 1) |
| Uploaded photos, videos, `.glb` models | **Vercel Blob** (Vercel's disk is read-only, so `backend/uploads/` can't be written in production) |

Because the frontend and API share one domain, there is no CORS setup and
`VITE_API_URL` stays empty.

`vercel.json` at the repo root already holds the configuration: install both
`backend/` and `frontend/`, build the frontend, serve `frontend/dist`, send
`/api/*` to the Express function, and send every other path to `index.html`
so React Router's deep links (`/feed`, `/product/12`, ...) work on refresh.

---

## 1. Create a hosted MySQL database

Pick any MySQL-compatible host that's reachable from the internet. Free options:

- **TiDB Cloud Serverless** (tidbcloud.com): MySQL-compatible, has a free tier, TLS with a public CA (no certificate to paste).
- **Aiven for MySQL** (aiven.io): free plan. Download its CA certificate and paste it into `DB_SSL_CA`.
- **Railway** (railway.app): MySQL plugin, trial credit.

Then create the tables. **Use `database/artisoul_full_schema.sql`.** It is
every phase migration (1 → 10) flattened into one file, and it runs against
whatever database your connection is already using:

```bash
mysql --ssl-mode=REQUIRED -h <host> -P <port> -u <user> -p <database> < database/artisoul_full_schema.sql
```

(You can also paste the file into MySQL Workbench or the provider's SQL console.)

> Moving your local data across? Export it with
> `mysqldump --no-create-info artisoul > data.sql` and import that after the schema.
> The files in `backend/uploads/` are deployed as static files, so existing
> `/uploads/...` image links keep working.

## 2. Import the repo into Vercel

1. Push this branch to GitHub.
2. Go to vercel.com → **Add New… → Project** → import `DTPLM-Course-Project`.
3. Leave **Root Directory** as the repository root (`./`). Framework preset
   **Other** is fine: `vercel.json` overrides the install, build and output settings.
4. Don't deploy yet. Add the environment variables first (step 4).

## 3. Connect a Blob store (file uploads)

In the Vercel project: **Storage → Create Database → Blob** → connect it to the
project for all environments. This adds `BLOB_READ_WRITE_TOKEN` automatically.

With it set, the browser uploads files **directly to Blob**. That matters
because Vercel functions reject request bodies over 4.5 MB, and products can
have videos and 3D models up to 30 MB. Without a Blob store, uploads on Vercel
return *"File uploads are not configured"*; everything else still works.

## 4. Environment variables

**Project → Settings → Environment Variables**:

| Name | Required | Value |
| --- | --- | --- |
| `JWT_SECRET` | yes | A long random string (e.g. `openssl rand -hex 32`) |
| `DATABASE_URL` | yes\* | `mysql://user:password@host:port/database` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | yes\* | Alternative to `DATABASE_URL` |
| `DB_SSL` | for cloud DBs | `true` |
| `DB_SSL_CA` | Aiven etc. | The provider's CA certificate (PEM) |
| `BLOB_READ_WRITE_TOKEN` | yes | Added by step 3 |
| `TEST_KEY_ID` / `TEST_KEY_SECRET` | for UPI checkout | Razorpay test keys. Without them, Cash on Delivery still works |
| `JWT_EXPIRES_IN` | no | Default `7d` |
| `DB_CONNECTION_LIMIT` | no | Default `3` per function instance on Vercel |

\* Set either `DATABASE_URL` or the five `DB_*` values.

You **don't** need `PORT`, `CORS_ORIGIN` or `VITE_API_URL` on Vercel.

## 5. Deploy and check

Click **Deploy** (or push again). Then open:

- `https://<your-app>.vercel.app/api/health` should return `{"success":true,"message":"ArtiSoul API is running"}`
- `https://<your-app>.vercel.app/api/uploads/config` should return `"mode":"blob"`
- `https://<your-app>.vercel.app/`: sign up as an artisan, open a shop, add a product with a photo.

If a request fails, look at **Project → Logs**. The usual causes:

| Symptom | Cause |
| --- | --- |
| `ER_ACCESS_DENIED_ERROR` / `ECONNREFUSED` / timeouts | Wrong DB credentials, or the DB doesn't allow connections from anywhere (`0.0.0.0/0`) |
| `Connections using insecure transport are prohibited` | Set `DB_SSL=true` |
| `self-signed certificate in certificate chain` | Paste the provider's CA into `DB_SSL_CA` |
| `Table 'xxx.Users' doesn't exist` | Step 1's schema wasn't run against the database in your connection settings |
| `secretOrPrivateKey must have a value` on login/signup | `JWT_SECRET` is missing |
| Uploads fail with "not configured" | Blob store not connected (step 3); redeploy after connecting |

Environment variable changes only take effect after a **redeploy**.

## Local development is unchanged

```bash
cd backend && cp .env.example .env && npm install && npm run dev   # :5000
cd frontend && npm install && npm run dev                           # :5173, proxies /api to :5000
```

Locally, with no `BLOB_READ_WRITE_TOKEN`, uploads are still saved to `backend/uploads/`.
