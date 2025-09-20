# VERSIONS Deployment Guide

## Current Deployment Strategy

VERSIONS uses **automated deployment via GitHub webhooks** to the Hetzner server.

### ✅ How It Works

```bash
GitHub Push → Webhook (port 9000) → Auto-deployment → Live Website
```

**Automatic Process:**
1. Push changes to `master` branch
2. GitHub webhook triggers deployment
3. Server pulls latest code
4. TypeScript builds automatically
5. Rust builds (only if Rust files changed)
6. Files deployed to `/var/www/versions/`
7. Nginx serves updated site

### 🚀 Manual Deployment (if needed)

```bash
# On server (ssh snel-bot)
/opt/webhook/deploy-versions.sh
```

### 📊 Monitoring

- **Webhook logs**: `/opt/webhook/deploy-versions.log`
- **Website**: https://versions.thisyearnofear.com
- **Deployment status**: Check GitHub webhooks section

### 🎯 Key Features

- **Smart building**: Only rebuilds components that changed
- **TypeScript first**: Web interface compiled automatically 
- **Clean deployment**: No node_modules or dev files deployed
- **Fast updates**: ~30 seconds for web-only changes
- **AGGRESSIVE CONSOLIDATION**: Follows project principles

### 🗑️ Legacy Cleanup

- **Old deployment script** moved to `.backup` (this commit)
- **Clean nginx configuration** with proper caching
- **Simplified CI/CD** via webhooks only

---

**Following WARP.md principles**: ENHANCEMENT FIRST, AGGRESSIVE CONSOLIDATION, CLEAN separation of concerns.