# Installed as /etc/apache2/sites-available/socialpost.conf
# Proxies __DOMAIN__ -> http://127.0.0.1:__APP_PORT__/

<VirtualHost *:80>
    ServerName __DOMAIN__

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:__APP_PORT__/
    ProxyPassReverse / http://127.0.0.1:__APP_PORT__/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:__APP_PORT__/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*) http://127.0.0.1:__APP_PORT__/$1 [P,L]

    LimitRequestBody 16777216

    ErrorLog ${APACHE_LOG_DIR}/socialpost-error.log
    CustomLog ${APACHE_LOG_DIR}/socialpost-access.log combined
</VirtualHost>
