#!/bin/sh /etc/rc.common

START=95
USE_PROCD=1

start_service() {
    procd_open_instance
    procd_set_param command /bin/sh -c 'set -a; . /etc/token-router/agent.env; set +a; exec /usr/bin/tokenrouter-agent'
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
