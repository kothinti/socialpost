# Installed as /etc/cron.d/socialpost
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
__CRON_SCHEDULE__ __DEPLOY_USER__ __APP_DIR__/deploy/run-cron.sh >> __APP_DIR__/data/cron.log 2>&1
