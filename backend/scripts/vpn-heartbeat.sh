#!/bin/bash

# PulseLynk VPN Heartbeat & Interface Repair Script
# Ensures SoftEther TAP Bridge has the correct IP (10.8.0.1)

INTERFACE="tap_vpn"
IP_ADDR="10.8.0.1/24"
LOG_FILE="/var/log/pulselynk-vpn.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

check_interface() {
    if ! ip link show "$INTERFACE" > /dev/null 2>&1; then
        log "WARNING: Interface $INTERFACE not found. Waiting for SoftEther..."
        return 1
    fi
    return 0
}

repair_ip() {
    if ! ip addr show "$INTERFACE" | grep -q "$IP_ADDR"; then
        log "FIXING: Assigning $IP_ADDR to $INTERFACE..."
        ip addr add "$IP_ADDR" dev "$INTERFACE"
        ip link set "$INTERFACE" up
        log "SUCCESS: IP $IP_ADDR assigned."
    fi
}

# Main loop
while true; do
    if check_interface; then
        repair_ip
    fi
    sleep 30
done
