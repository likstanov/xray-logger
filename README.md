# xray-logger & xray-logger-agent
Parsing &amp; sending xray logs from nodes to the database for analysis (malware, torrents, etc.)

It works as a client-server. The client (xray-logger-agent) scans the logs and sends them in batches to the server (xray-logger). The server receives the data and writes it to the database.

The client and server can work both via http (by IP address) so it is via https (via domain). Even when working over http, **the data is encrypted with aes-256-gcm.**

1. If you want to configure work via *http + IP*, do not forget to add a port at the end of the IP address during the configuration of the client agent. **By default: 8080**.
2. If you want to set up work via *https + domain*, **prepare a proxy server**. 
3. You also need to **prepare a proxy server for working with Adminer** (this is mandatory).

*Tested and works with **Marzban** and **Remna** panels*

# Installation

## xray-logger (server)

### Run the script on the server:
```
curl -fsSL https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/start-xray-logger.sh | sudo bash
```

After executing the script, **copy the secret encryption** key (you will need it when installing the agent client) and also do not forget to **copy the password for the Adminer panel**.

## xray-logger-agent (client)

### Run the script on the node:
```
curl -fsSL https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/start-xray-logger-agent.sh | sudo bash -s --
```

Prepare yourself before running the script. It will ask you to enter **the secret encryption key** (for communication between the client and the server), **the path to the log file** and **the name of the log file**, **the server address** (xray-logger server),  and **the name of the node** from which the logs are sent.

## Additional settings

### xray-logger (server) settings

You can configure the server by editing the **/opt/xray-logger/.env** (by default, everything will work out of the box if you installed the application using the script from this guide).

```
# xray-logger (server) .env example
PORT=8080

# true if nginx/Cloudflare is behind the server and you need a client IP from X-Forwarded-For.
# On the proxy server, you need to transmit the client's address in the stub:
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# proxy_set_header X-Real-IP $remote_addr;
TRUST_PROXY=false

# secret code generated using openssl rand -base64 32 (it must be the same on the server and the client)
ENCRYPTION_KEY_BASE64=JeQ7i6EsZE58Z16v6LjhPstC742uAhePd6L42eHNfaA=

# data for initialization and connection to the database
PGHOST=db
PGPORT=5432
PGDATABASE=xray_logger
PGUSER=xraylogger
PGPASSWORD=postgresqlPassword

# request body limit for API
BODY_LIMIT=25mb

# Optional: comma-separated node names to accept (leave empty to accept all)
ALLOWED_NODE_NAMES=

# Optional deny lists (lowercased) – matching records will be dropped server-side
DENY_TARGETS=one.one.one.one,dns.google,1.1.1.1,8.8.8.8
DENY_PORTS=53,853
```

### xray-logger-agent (client) settings

You can configure the client by editing the **/opt/xray-logger/agent/.env** file (by default, everything will work out of the box if you installed the application through the script from this guide).

```
# xray-logger-agent (node) .env example
ACCESS_LOG_DIR=/var/lib/marzban-node
ACCESS_LOG_FILE=access.log

# server address must be written in http:// or https format
# example: http://78.222.213.55:8080 or https://xraylogger.domain.com
API_URL=https://api.xrayproject.com

NODE_NAME=NODE-1

LOG_TIMEZONE=UTC

# batch size (number of log entries) to generate and send to the server
BATCH_SIZE=200
# the interval for sending batches to the server
FLUSH_INTERVAL_MS=10000
# should the application start scanning logs from the very beginning when launching the application?
START_FROM_BEGINNING=false

# secret code generated using openssl rand -base64 32 (it must be the same on the server and the client)
ENCRYPTION_KEY_BASE64=JeQ7i6EsZE58Z16v6LjhPstC742uAhePd6L42eHNfaA=
VERIFY_TLS=true

# filtering ports and addresses that are unnecessary for tracking
DENY_TARGETS=one.one.one.one,dns.google,1.1.1.1,8.8.8.8
DENY_PORTS=53,853

# enable/disable local deduplication of identical events in logs in 1 second
DEDUP_ENABLED=true
# how many seconds to keep buckets for dedup (limits memory):
DEDUP_KEEP_SECONDS=30

# periodic cleaning of the log file
TRUNCATE_ENABLED=false
# interval: The suffixes ms, s, m, h, d are supported (for example, 24h, 12h, 30m, 86400000ms)
TRUNCATE_INTERVAL=24h
```