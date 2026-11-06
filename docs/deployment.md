# Deployment (CasaOS / Docker Compose + Nginx Proxy Manager)

> The Dockerfile and compose file are provided and follow the configuration below, but the image was **not built or run in the development sandbox** (no Docker there). The compiled app itself was run and smoke-tested with Node. Build it once on the server and check `docker logs vera`.

## 1. Prepare

```bash
git clone <your repo> vera && cd vera
cp .env.example .env
```

Edit `.env`:

* `VERA_PUBLIC_URL=https://vera.example.com` (https is required in production).
* `VERA_SECRET_KEY=$(openssl rand -base64 32)` (recommended; see key handling in `docs/database.md`).
* Optional: `GEMINI_*` (see `docs/gemini.md`), `VERA_ENABLE_MACHINE_READONLY=true`, `VERA_ALLOWED_FILE_ROOTS=/files`.

In `docker-compose.yml` set the external network to the one your Nginx Proxy Manager container uses (`docker network ls`) and set `VERA_TRUSTED_PROXY_CIDRS` to that network's subnet (`docker network inspect <name>`).

## 2. Run

```bash
docker compose up -d --build
docker logs vera        # shows the first-run SETUP CODE
```

The container runs as the unprivileged `node` user with a read-only root filesystem, no capabilities and `no-new-privileges`. Data lives in `./data` (mounted at `/data`). It is **not** privileged and the Docker socket is **not** mounted. The port is published on `127.0.0.1` only; the proxy reaches it over the shared network.

## 3. Nginx Proxy Manager

Add a proxy host: domain `vera.example.com`, scheme `http`, forward host `vera`, port `3001`, request an SSL certificate, enable *Force SSL* and HTTP/2. Under *Advanced* add `proxy_buffering off;` so streamed replies appear live. Do not expose port 3001 to the internet directly, and keep `VERA_TRUSTED_PROXY_CIDRS` limited to the proxy's network.

## 4. First login and hardening checklist

1. Open the HTTPS address, enter the setup code, create the owner account (8+ characters).
2. Settings → confirm *Secure cookies on* and *Reverse-proxy headers trusted from configured proxies*.
3. Back up `./data` (consistent snapshot command in `docs/database.md`) and the secret key separately.
4. Install integrations you want from the Store; leave sensitive permissions off until needed.

## Operations

* Health: `GET /api/v1/health` (liveness) and `/api/v1/ready` (database reachable); the image `HEALTHCHECK` uses `/ready`.
* Shutdown: `docker stop` sends SIGTERM; Vera closes the HTTP server and database (10 s limit).
* Upgrade: `git pull && docker compose up -d --build`. Migrations run automatically at start and are forward-only; take a backup first.
* Recovery: lost password → `docker exec -it vera node dist-server/server/src/cli/reset-password.js`. Lost secret key → restore it, or re-enter integration credentials.
* Memory: set `mem_limit` (512 MB in the example). Measured peak was ~200 MB under synthetic load; verify on your hardware.
