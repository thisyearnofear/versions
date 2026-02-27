# Environment Variables

This document describes all environment variables used by VERSIONS.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API keys and configuration

3. The server automatically loads `.env` on startup

## Required Variables

### API Keys

- `AUDIUS_API_KEY` - Audius API key for accessing music data
- `AUDIUS_API_SECRET` - Audius API secret (currently unused but reserved)
- `HELIUS_API_KEY` - Helius RPC API key for Solana blockchain access

## Optional Variables

### Blockchain Configuration

- `ARBITRUM_RPC_URL` - Arbitrum RPC endpoint (default: `https://arb1.arbitrum.io/rpc`)
- `SOLANA_RPC_URL` - Solana RPC endpoint (default: `https://api.mainnet-beta.solana.com`)

### IPFS Configuration

- `IPFS_GATEWAY_URL` - IPFS gateway for content retrieval (default: `https://ipfs.io/ipfs/`)
- `IPFS_API_URL` - IPFS API endpoint for uploads (default: `http://localhost:5001`)

### Server Configuration

- `SERVER_PORT` - Port for REST API server (default: `8080`)
- `SERVER_HOST` - Host binding for server (default: `0.0.0.0`)

### Frontend Configuration

- `FRONTEND_URL` - Production frontend URL (default: `https://versions.thisyearnofear.com`)

### Farcaster Mini App (Optional)

Only needed if deploying Farcaster integration:

- `FARCASTER_APP_NAME` - App name displayed in Farcaster
- `FARCASTER_DOMAIN` - Your deployment domain
- `FARCASTER_ICON_URL` - App icon URL
- `FARCASTER_HOME_URL` - App home page URL
- `FARCASTER_IMAGE_URL` - OpenGraph image URL
- `FARCASTER_BUTTON_TITLE` - Button text in Farcaster
- `FARCASTER_SPLASH_IMAGE_URL` - Splash screen image
- `FARCASTER_SPLASH_BG` - Splash screen background color

## Security

- Never commit `.env` to version control
- `.env` is already in `.gitignore`
- Use different API keys for development and production
- Rotate API keys regularly
- Use environment variables in production deployments (not `.env` files)

## Production Deployment

For production, set environment variables directly in your hosting platform:

- Netlify: Site settings → Environment variables
- Vercel: Project settings → Environment Variables
- Docker: Use `--env-file` or `-e` flags
- Kubernetes: Use ConfigMaps and Secrets
- Systemd: Use `Environment=` in service files

## Getting API Keys

### Audius API Key

1. Visit [Audius API Dashboard](https://audius.co/developers)
2. Create an app
3. Copy API key and secret

### Helius API Key

1. Visit [Helius Dashboard](https://helius.dev)
2. Create a free account
3. Create a new project
4. Copy API key
