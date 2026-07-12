[Unit]
Description=SocialPost (Next.js)
After=network.target

[Service]
Type=simple
User=__DEPLOY_USER__
WorkingDirectory=__APP_DIR__
Environment=NODE_ENV=production
EnvironmentFile=__APP_DIR__/.env.local
ExecStart=__APP_DIR__/node_modules/.bin/next start -p __APP_PORT__ -H 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
