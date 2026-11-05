# qeb-diff-back

Backend del dashboard `qeb-diff`. Express + TypeScript. Expone JSON sobre `/api/*` para comparar ramas (`front-qeb`, `back-qeb`) y bases de datos (stage, dev, release, main) de QEB. Solo lectura: nunca escribe en las BDs ni en los repos.

El frontend vive en el repo `qeb-diff-front` (deploy en Vercel).

---

## Setup local

Requiere Node 20+.

```bash
cp .env.example .env
# llena AUTH_PASSWORD, credenciales de las 4 BDs, paths a back-qeb y front-qeb

npm install
npm run dev   # http://localhost:3100
```

El frontend local (repo aparte) apunta a `http://localhost:3100` por default via el proxy de Vite.

---

## Deploy en el VPS (Ubuntu + PM2)

```bash
git clone https://github.com/Develop-QEB/qeb-diff-back.git
cd qeb-diff-back

cp .env.example .env
nano .env   # AUTH_PASSWORD, CORS_ORIGIN, credenciales BDs, paths a los repos QEB

npm install
npm run build

pm2 start ecosystem.config.cjs
pm2 save
pm2 logs qeb-diff-back
```

Exponerlo con nginx/caddy en el subdominio que uses (tipo `diff-api.qeb.mx`) con HTTPS. El frontend en Vercel necesita HTTPS para poder llamarlo.

**Ejemplo nginx:**

```nginx
server {
  server_name diff-api.qeb.mx;
  listen 443 ssl http2;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Actualizar

```bash
cd /ruta/a/qeb-diff-back
git pull
npm install
npm run build
pm2 reload qeb-diff-back --update-env
```

---

## Qué necesita del VPS

- **Node 20+** y **npm**.
- Los repos `back-qeb` y `front-qeb` clonados en algún path del VPS. Apunta `BACK_REPO_PATH` y `FRONT_REPO_PATH` del `.env` a esos paths. Si el back corre `git fetch`, el VPS necesita credenciales para GitHub (SSH key o PAT).
- **IP del VPS en Trusted Sources** de los dos clusters de DigitalOcean (`qeb-mysql-prod`, `qeb-mysql-dev`). Las de Hostinger (`stage`, `release`) no requieren allowlist.
- `.env` llenado con credenciales reales y `CORS_ORIGIN` apuntando al dominio del front (ej. `https://qeb-diff.vercel.app` y/o el custom domain).

---

## Auth

- Password única compartida (`AUTH_PASSWORD` del `.env`).
- La pantalla de login del front pide la password; el back responde un token que se manda como `Bearer` en cada request a `/api/*`.
- Rotar la password: cambia `AUTH_PASSWORD` en el `.env` del VPS, `pm2 reload qeb-diff-back --update-env`. Todos los tokens activos quedan inválidos.

---

## Qué NO va al repo

- `.env` (credenciales reales)
- `ignored.json` (decisiones del equipo sobre anomalías intencionales)
- `node_modules/`, `dist/`

Ya están en `.gitignore`.
