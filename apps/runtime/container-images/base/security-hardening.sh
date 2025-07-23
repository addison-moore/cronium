#!/bin/sh
# Additional security hardening script for Cronium containers

set -e

echo "Applying security hardening..."

# Remove shell access for www-data user if exists
if id www-data >/dev/null 2>&1; then
    usermod -s /sbin/nologin www-data
fi

# Set secure permissions on sensitive directories
chmod 700 /root 2>/dev/null || true
chmod 700 /home/* 2>/dev/null || true

# Remove unnecessary SUID/SGID bits
find /bin /sbin /usr/bin /usr/sbin -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true

# Clear bash history
rm -f /root/.bash_history /home/*/.bash_history 2>/dev/null || true

# Remove package manager caches
rm -rf /var/cache/apk/* 2>/dev/null || true

# Set restrictive umask
echo "umask 077" >> /etc/profile

echo "Security hardening complete"