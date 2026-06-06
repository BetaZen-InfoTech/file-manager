#!/usr/bin/env bash
# Reboot-safe wrapper: flush pending uploads, save PM2 state, then reboot.
set -euo pipefail

echo ">> Draining in-flight uploads (waiting up to 60s for pm2 idle)"
for i in $(seq 1 30); do
  if pm2 status filemanager 2>/dev/null | grep -q "online"; then
    sleep 2
  else
    break
  fi
done

echo ">> Saving PM2 state"
pm2 save

echo ">> Rebooting"
sudo reboot
