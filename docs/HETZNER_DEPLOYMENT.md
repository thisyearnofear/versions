# 🏗️ VERSIONS - Hetzner Server Deployment Guide

## **🎯 Why Hetzner is Excellent for VERSIONS**

### **✅ Advantages Over Railway/Fly.io**

#### **💰 Cost Efficiency**
- **Hetzner**: €4-20/month for dedicated resources
- **Railway**: $5-20/month + usage-based pricing
- **Fly.io**: $5-15/month + bandwidth costs
- **Result**: Hetzner often 50-70% cheaper for same performance

#### **🚀 Performance Benefits**
- **Dedicated Resources**: No shared CPU/memory limits
- **Better I/O**: Direct SSD access for audio streaming
- **Network Control**: Configure bandwidth and caching
- **Predictable Performance**: No cold starts or scaling delays

#### **🔧 Full Control**
- **Custom Configuration**: Optimize for audio streaming
- **Security**: Full control over firewall and access
- **Monitoring**: Direct server monitoring and logging
- **Flexibility**: Install any tools or services needed

#### **🌍 European Data Sovereignty**
- **GDPR Compliance**: EU-based hosting
- **Low Latency**: Great for European users
- **Data Control**: Your data stays in your infrastructure

### **📋 Recommended Hetzner Setup**

#### **Server Specifications**
```bash
# For VERSIONS MVP (handles 100-500 concurrent users)
CPU: 2-4 vCPUs (AMD/Intel)
RAM: 4-8 GB
Storage: 40-80 GB SSD
Bandwidth: 20 TB/month
Cost: €4-12/month

# For Production (handles 1000+ concurrent users)
CPU: 4-8 vCPUs
RAM: 8-16 GB  
Storage: 80-160 GB SSD
Bandwidth: 20 TB/month
Cost: €12-25/month
```

## **🚀 Hetzner Deployment Steps**

### **Step 1: Server Setup (5 minutes)**

#### **Create Hetzner Cloud Server**
```bash
# 1. Go to console.hetzner.cloud
# 2. Create new project: "versions-production"
# 3. Create server:
#    - Location: Nuremberg/Helsinki (EU) or Ashburn (US)
#    - Image: Ubuntu 22.04 LTS
#    - Type: CPX21 (2 vCPU, 4GB RAM) - €4.51/month
#    - SSH Key: Add your public key
#    - Firewall: Create new (HTTP, HTTPS, SSH)
```

#### **Initial Server Configuration**
```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y curl git build-essential pkg-config libssl-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Node.js (for any frontend build tools)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Nginx (reverse proxy)
apt install -y nginx

# Install Certbot (SSL certificates)
apt install -y certbot python3-certbot-nginx
```

### **Step 2: Deploy VERSIONS Backend (10 minutes)**

#### **Clone and Build**
```bash
# Clone your repository
git clone https://github.com/yourusername/versions.git
cd versions

# Build release version
cargo build --release -p termusic-server

# Create systemd service
cat > /etc/systemd/system/versions-server.service << EOF
[Unit]
Description=VERSIONS Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/versions
ExecStart=/root/versions/target/release/termusic-server
Restart=always
RestartSec=10
Environment=RUST_LOG=info
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl enable versions-server
systemctl start versions-server
systemctl status versions-server
```

#### **Configure Nginx Reverse Proxy**
```bash
# Create Nginx configuration
cat > /etc/nginx/sites-available/versions << EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    # API routes
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # CORS headers
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type, Authorization";
    }

    # Frontend static files
    location / {
        root /var/www/versions;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Audio streaming optimization
    location ~* \.(mp3|wav|flac|m4a|ogg)$ {
        root /var/www/versions;
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=3600";
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/versions /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### **Step 3: Deploy Frontend (5 minutes)**

#### **Setup Web Directory**
```bash
# Create web directory
mkdir -p /var/www/versions

# Copy web files
cp -r /root/versions/web/* /var/www/versions/

# Set permissions
chown -R www-data:www-data /var/www/versions
chmod -R 755 /var/www/versions
```

#### **Update Configuration**
```bash
# Update config.js for production
cat > /var/www/versions/config.js << EOF
const config = {
    development: {
        domain: 'localhost:3000',
        apiBase: 'http://localhost:8080',
        manifestUrl: 'http://localhost:3000/.well-known/farcaster.json'
    },
    production: {
        domain: 'your-domain.com',  // Replace with your domain
        apiBase: 'https://your-domain.com',  // Same domain, Nginx proxies /api/
        manifestUrl: 'https://your-domain.com/.well-known/farcaster.json'
    }
};

function getEnvironment() {
    const hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' ? 'development' : 'production';
}

const currentEnv = getEnvironment();
export const appConfig = config[currentEnv];
export const environment = currentEnv;

console.log(\`🎭 VERSIONS running in \${currentEnv} mode\`);
EOF
```

### **Step 4: SSL Certificate (2 minutes)**

#### **Setup Let's Encrypt**
```bash
# Get SSL certificate
certbot --nginx -d your-domain.com

# Verify auto-renewal
certbot renew --dry-run

# Certificate will auto-renew every 90 days
```

### **Step 5: Monitoring & Maintenance**

#### **Setup Basic Monitoring**
```bash
# Create monitoring script
cat > /root/monitor-versions.sh << EOF
#!/bin/bash
# Check if VERSIONS server is running
if ! systemctl is-active --quiet versions-server; then
    echo "VERSIONS server is down, restarting..."
    systemctl restart versions-server
    # Optional: send notification
fi

# Check disk space
DISK_USAGE=\$(df / | tail -1 | awk '{print \$5}' | sed 's/%//')
if [ \$DISK_USAGE -gt 80 ]; then
    echo "Warning: Disk usage is \${DISK_USAGE}%"
fi
EOF

chmod +x /root/monitor-versions.sh

# Add to crontab (check every 5 minutes)
echo "*/5 * * * * /root/monitor-versions.sh" | crontab -
```

#### **Log Management**
```bash
# View server logs
journalctl -u versions-server -f

# View Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Rotate logs automatically (already configured in Ubuntu)
```

## **🔧 Hetzner-Specific Optimizations**

### **Audio Streaming Optimization**
```bash
# Optimize Nginx for audio streaming
cat >> /etc/nginx/nginx.conf << EOF
# Add to http block
client_max_body_size 100M;  # Allow large audio uploads
sendfile on;                # Efficient file serving
tcp_nopush on;             # Optimize packet sending
tcp_nodelay on;            # Reduce latency
keepalive_timeout 65;      # Keep connections alive

# Gzip compression
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
EOF

systemctl reload nginx
```

### **Firewall Configuration**
```bash
# Configure UFW firewall
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable

# Check status
ufw status
```

### **Performance Tuning**
```bash
# Optimize for audio streaming
echo 'net.core.rmem_max = 16777216' >> /etc/sysctl.conf
echo 'net.core.wmem_max = 16777216' >> /etc/sysctl.conf
echo 'net.ipv4.tcp_rmem = 4096 87380 16777216' >> /etc/sysctl.conf
echo 'net.ipv4.tcp_wmem = 4096 65536 16777216' >> /etc/sysctl.conf
sysctl -p
```

## **💰 Cost Comparison**

### **Monthly Costs**
```
Hetzner CPX21 (4GB RAM):     €4.51/month
Railway Starter:             $5/month + usage
Fly.io Shared CPU:           $5/month + bandwidth
Vercel Pro:                  $20/month

Winner: Hetzner (50-70% cheaper)
```

### **Performance Benefits**
- **Dedicated Resources**: No noisy neighbors
- **Better Audio Streaming**: Direct SSD access
- **Predictable Costs**: No surprise usage bills
- **Full Control**: Optimize for your specific needs

## **🚀 Deployment Automation**

### **One-Click Deploy Script**
```bash
# Create deployment script
cat > deploy-to-hetzner.sh << EOF
#!/bin/bash
set -e

echo "🚀 Deploying VERSIONS to Hetzner..."

# Pull latest code
git pull origin main

# Build server
cargo build --release -p termusic-server

# Restart server
systemctl restart versions-server

# Update frontend
cp -r web/* /var/www/versions/
chown -R www-data:www-data /var/www/versions

# Reload Nginx
systemctl reload nginx

echo "✅ Deployment complete!"
echo "🌐 Visit: https://your-domain.com"
EOF

chmod +x deploy-to-hetzner.sh
```

## **📊 Hetzner vs Alternatives**

| Feature | Hetzner | Railway | Fly.io | Vercel |
|---------|---------|---------|---------|---------|
| **Cost** | €4-12/mo | $5-20/mo | $5-15/mo | $20/mo |
| **Performance** | Dedicated | Shared | Shared | Shared |
| **Control** | Full | Limited | Limited | Limited |
| **Audio Streaming** | Optimized | Basic | Basic | Basic |
| **EU Hosting** | ✅ | ❌ | ✅ | ✅ |
| **Setup Time** | 20 min | 5 min | 5 min | 2 min |

## **🎯 Recommendation**

**Hetzner is EXCELLENT for VERSIONS because:**

1. **Cost Effective**: 50-70% cheaper than alternatives
2. **Performance**: Dedicated resources for audio streaming
3. **Control**: Full server access for optimization
4. **Reliability**: Enterprise-grade infrastructure
5. **EU-based**: Great for GDPR compliance

**Best for**: Production deployments, cost-conscious projects, performance-critical applications

**Use Railway/Fly.io for**: Quick prototypes, testing, when you want zero server management

---

## 🏗️ **Hetzner: The Smart Choice for VERSIONS Production**

For a music streaming platform like VERSIONS, **Hetzner provides the best value** with dedicated resources, full control, and significant cost savings. Perfect for getting your MVP to users affordably! 🎵💰