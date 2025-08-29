# xray-logger & xray-logger-agent
Parsing &amp; sending xray logs from nodes to the database for analysis (malware, torrents, etc.)

It works as a client-server. The client (agent) scans the logs and sends them in batches to the server. The server receives the data and writes it to the database.

The client and server can work both via http (by IP address) so it is via https (via domain). Even when working over http, **the data is encrypted with aes-256-gcm.**

1. If you want to configure work via *http + IP*, do not forget to add a port at the end of the IP address during the configuration of the client agent. **By default: 8080**.
2. If you want to set up work via *https + domain*, **prepare a proxy server**. 
3. You also need to **prepare a proxy server for working with Adminer** (this is mandatory).

# Installation

## xray-logger (server)

###Run the script on the server:
`curl -fsSL https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/start-xray-logger.sh | sudo bash`

After executing the script, **copy the secret encryption** key (you will need it when installing the agent client) and also do not forget to **copy the password for the Adminer panel**.

## xray-logger-agent (client)

###Run the script on the node:
`curl -fsSL https://raw.githubusercontent.com/likstanov/xray-logger/refs/heads/main/start-xray-logger-agent.sh | sudo bash -s --`

Prepare yourself before running the script. It will ask you to enter **the server address** (xray-logger server), **the secret encryption key** (for communication between the client and the server) and **the name of the node** from which the logs are sent.