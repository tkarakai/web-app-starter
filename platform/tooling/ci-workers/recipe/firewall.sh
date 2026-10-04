#!/bin/bash
set -euo pipefail
# This trusted namespace holder is separate from the unprivileged worker.
# Default DROP closes host gateways, metadata endpoints and other container networks.
/usr/sbin/iptables -P OUTPUT DROP
/usr/sbin/iptables -P INPUT DROP
/usr/sbin/iptables -P FORWARD DROP
/usr/sbin/iptables -A INPUT -i lo -j ACCEPT
/usr/sbin/iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
/usr/sbin/iptables -A OUTPUT -o lo -j ACCEPT
/usr/sbin/iptables -A OUTPUT -p tcp -d "$1" --dport 3128 -j ACCEPT
printf ready > /tmp/ready
exec sleep infinity
