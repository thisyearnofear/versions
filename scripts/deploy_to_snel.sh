#!/bin/bash

echo "🚀 VERSIONS - Deploying to Snel Server"
echo "======================================"

# Configuration
DOMAIN="versions.thisyearnofear.com"  # Update this to your desired domain
SERVER="snel-bot"
DEPLOY_DIR="/opt/versions"
WEB_DIR="/var/www/versions"

echo "📋 Deployment Configuration:"
echo "   Domain: $DOMAIN"
echo "   Server: $SERVER"
echo "   Deploy Directory: $DEPLOY_DIR"
echo "   Web Directory: $WEB_DIR"
echo ""

# Step 1: Build VERSIONS (in background)
echo "🔨 Step 1: Building VERSIONS server..."
ssh $SERVER "cd $DEPLOY_DIR && source ~/.cargo/env && nohup cargo build --release -p termusic-server > build.log 2>&1 &"
echo "✅ Build started in background (check build.log for progress)"

# Step 2: Setup web directory
echo ""
echo "🌐 Step 2: Setting up web directory..."
ssh $SERVER "mkdir -p $WEB_DIR && cp -r $DEPLOY_DIR/web/* $WEB_DIR/ && chown -R www-data:www-data $WEB_DIR"
echo "✅ Web files deployed"

# Step 3: Create systemd service
echo ""
echo "⚙️  Step 3: Creating systemd service..."
ssh $SERVER "cat > /etc/systemd/system/versions-server.service << 'EOF'
[Unit]
Description=VERSIONS Music Platform
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$DEPLOY_DIR
ExecStart=$DEPLOY_DIR/target/release/termusic-server
Restart=always
RestartSec=10
Environment=RUST_LOG=info
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
EOF"
echo "✅ Systemd service created"

# Step 4: Create Nginx configuration
echo ""
echo "🔧 Step 4: Creating Nginx configuration..."
ssh $SERVER "cat > /etc/nginx/sites-available/$DOMAIN << 'EOF'
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;
    
    # SSL configuration (will be added by certbot)
    # ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    
    # Audio streaming optimization
    client_max_body_size 100M;
    
    # API routes
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # CORS headers
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods \"GET, POST, PUT, DELETE, OPTIONS\";
        add_header Access-Control-Allow-Headers \"Content-Type, Authorization\";
    }
    
    # Frontend static files
    location / {
        root $WEB_DIR;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)\$ {
            expires 1y;
            add_header Cache-Control \"public, immutable\";
        }
    }
    
    # Audio streaming with range support
    location ~* \\.(mp3|wav|flac|m4a|ogg)\$ {
        root $WEB_DIR;
        add_header Accept-Ranges bytes;
        add_header Cache-Control \"public, max-age=3600\";
    }
}
EOF"

# Enable the site
ssh $SERVER "ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ && nginx -t"
echo "✅ Nginx configuration created and enabled"

# Step 5: Update web config for production
echo ""
echo "📝 Step 5: Updating web configuration..."
ssh $SERVER "cat > $WEB_DIR/config.js << 'EOF'
const config = {
    development: {
        domain: 'localhost:3000',
        apiBase: 'http://localhost:8080',
        manifestUrl: 'http://localhost:3000/.well-known/farcaster.json'
    },
    production: {
        domain: '$DOMAIN',
        apiBase: 'https://$DOMAIN',
        manifestUrl: 'https://$DOMAIN/.well-known/farcaster.json'
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
EOF"
echo "✅ Production configuration updated"

# Step 6: Check build status
echo ""
echo "🔍 Step 6: Checking build status..."
BUILD_STATUS=$(ssh $SERVER "cd $DEPLOY_DIR && ps aux | grep 'cargo build' | grep -v grep | wc -l")
if [ "$BUILD_STATUS" -gt 0 ]; then
    echo "⏳ Build still in progress..."
    echo "   You can check progress with: ssh $SERVER 'cd $DEPLOY_DIR && tail -f build.log'"
else
    echo "✅ Build completed (or not started)"
fi

# Step 7: Instructions for SSL and final setup
echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. 🔒 Setup SSL Certificate:"
echo "   ssh $SERVER"
echo "   certbot --nginx -d $DOMAIN"
echo ""
echo "2. 🔨 Wait for build to complete:"
echo "   ssh $SERVER 'cd $DEPLOY_DIR && tail -f build.log'"
echo ""
echo "3. 🚀 Start VERSIONS service:"
echo "   ssh $SERVER 'systemctl enable versions-server && systemctl start versions-server'"
echo ""
echo "4. 🔄 Reload Nginx:"
echo "   ssh $SERVER 'systemctl reload nginx'"
echo ""
echo "5. ✅ Test deployment:"
echo "   curl -I https://$DOMAIN"
echo "   curl https://$DOMAIN/api/v1/health"
echo ""
echo "🎭 VERSIONS deployment initiated!"
echo "   Domain: https://$DOMAIN"
echo "   Status: Building..."