# VERSIONS — Deployment

The proxy is a single Node.js process. The web client is static
files served by the same process (mounted at `/web/*`). The SQLite
database lives on a persistent volume. No external services.

This document covers the four supported deployment targets:
Docker (anywhere), Railway, Fly.io, and a bare VPS.

## Required environment variables

```
PORT=8080                  # default
HOST=0.0.0.0               # default
PLATFORM_WALLET=0x…        # the 20% platform leg + 10% MBID fallback
ARC_RPC_URL=https://…      # omit to run in mock-first mode
ARC_USDC_CONTRACT=0x…      # only when ARC_RPC_URL is set
NODE_ENV=production
```

If `ARC_RPC_URL` is missing or unreachable, the proxy logs a
warning and falls back to deterministic mock Arc — every settlement
leg gets a synthesised `tx_hash` and the demo runs end-to-end with
no keys.

## One-command deploy (`npm run deploy`)

If you just want the whole product running locally (Docker
required) for a demo or smoke test:

```bash
cp .env.example .env.production    # fill in the optional values
npm run deploy                     # builds the image + runs the container
```

The deploy script (`scripts/deploy.sh`) uses the same
Dockerfile Railway / Fly.io would use. It:
  - builds the image if it's not present (or use `--rebuild`),
  - mounts `./data` to `/app/data` for the SQLite db + uploads,
  - forwards every env var from `.env.production` to the container,
  - waits for `/health/ready` to return 200 (up to 30s),
  - prints the URL + the next-step commands.

Subcommands: `./scripts/deploy.sh 8080 --logs` to tail,
`--stop` to stop. The default port is 8080; pass any
port as the first arg.

## Docker (anywhere)

```bash
docker build -t versions:dev .
docker run -d \
  --name versions \
  -p 8080:8080 \
  -e PLATFORM_WALLET=0xYourWallet \
  -v versions-data:/app/data \
  versions:dev
```

The `versions-data` volume persists `versions.db` and `uploads/`
across container restarts. To inspect the DB:

```bash
docker exec -it versions sqlite3 /app/data/versions.db
```

To deploy to any Docker host (Render, Fly.io with Docker, Hetzner
with Portainer, a Raspberry Pi):

1. Push the image to a registry (`docker push …`).
2. Mount a persistent volume at `/app/data`.
3. Expose port 8080.
4. Set `PLATFORM_WALLET` (and optionally `ARC_RPC_URL` +
   `ARC_USDC_CONTRACT`).

## Railway

A `railway.toml` is in the repo. Railway auto-detects it.

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Then set the environment variables in the Railway dashboard:

```
PLATFORM_WALLET=0xYourWallet
ARC_RPC_URL=https://rpc.testnet.arc.network   # optional
ARC_USDC_CONTRACT=0x…                          # optional
```

Railway assigns a public URL on the `*.up.railway.app` domain.
The first GET to `/health/ready` returns 200 once the migrations
have run.

The data volume: Railway's default ephemeral filesystem will
reset on every redeploy. To persist `versions.db` and `uploads/`,
attach a Railway Volume and set `RAILWAY_VOLUME_MOUNT_PATH=/app/data`
— Railway mounts the volume at that path.

## Fly.io

```bash
# 1. Install the CLI
curl -L https://fly.io/install.sh | sh

# 2. Create the app (uses the Dockerfile)
fly launch --name versions-lepton --no-deploy

# 3. Create a persistent volume for the SQLite DB + uploads
fly volumes create versions_data --size 1

# 4. Attach the volume in fly.toml
# (edit fly.toml — see the file's structure below)
# [[mounts]]
#   source = "versions_data"
#   destination = "/app/data"

# 5. Set the env vars
fly secrets set PLATFORM_WALLET=0xYourWallet
fly secrets set ARC_RPC_URL=https://rpc.testnet.arc.network    # optional

# 6. Deploy
fly deploy
```

A `fly.toml` template is provided in this repo.

## Bare VPS (Hetzner / DigitalOcean / Vultr)

```bash
# 1. Provision an Ubuntu 22.04 server, SSH in.

# 2. Install Node 20 + a reverse proxy
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

# 3. Clone + build
git clone https://github.com/thisyearnofear/versions /opt/versions
cd /opt/versions
npm ci --omit=dev

# 4. Run the proxy under systemd
cat > /etc/systemd/system/versions.service <<'EOF'
[Unit]
Description=VERSIONS Lepton proxy
After=network.target

[Service]
Type=simple
User=versions
WorkingDirectory=/opt/versions
EnvironmentFile=/opt/versions/.env
ExecStart=/usr/bin/node proxy-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo useradd -r -s /usr/sbin/nologin versions
sudo chown -R versions:versions /opt/versions
sudo systemctl enable --now versions

# 5. Reverse-proxy + TLS
cat > /etc/nginx/sites-available/versions <<'EOF'
server {
  server_name versions.your-domain.com;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
EOF
sudo ln -s /etc/nginx/sites-available/versions /etc/nginx/sites-enabled/
sudo certbot --nginx -d versions.your-domain.com
```

The systemd unit restarts the proxy on failure; the certbot hook
renews the cert every 60 days.

## Verifying the deployment

```bash
# Health
curl -sS https://versions.your-domain.com/health/ready

# Mock Arc
curl -sS https://versions.your-domain.com/api/v1/arc/info
# → { "mock": true, ... }

# Real Arc testnet (after setting ARC_RPC_URL)
# → { "mock": false, "chainId": "0x4cef52", ... }

# Seed the feed
PORT=8080 npm run seed   # on the server
```

## Where the data lives

| Path inside the image | Contents                              | Mount required? |
|----------------------|---------------------------------------|-----------------|
| `/app/data/versions.db` | SQLite database                     | yes — persistence |
| `/app/data/uploads/` | Audio files uploaded by artists      | yes — persistence |
| `/app/proxy/`        | Service code (read-only)              | no              |
| `/app/web/`          | Web client (read-only)                | no              |

The migrations are re-applied on every boot; they are idempotent
so re-running them is safe.
