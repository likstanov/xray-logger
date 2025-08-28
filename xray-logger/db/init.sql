-- /opt/xray-logger/db/init.sql
-- Инициализация схемы для xray-logger

CREATE TABLE IF NOT EXISTS xray_logs (
  xray_user    VARCHAR(255) NOT NULL,
  user_ip      INET         NOT NULL,
  target       TEXT         NOT NULL,
  port         INTEGER      NOT NULL,
  protocol_in  VARCHAR(3)   NULL CHECK (protocol_in IN ('tcp','udp')),
  protocol_out VARCHAR(3)   NOT NULL CHECK (protocol_out IN ('tcp','udp')),
  node_ip      INET         NOT NULL,
  node_name    VARCHAR(64)  NOT NULL,
  inbound      VARCHAR(64)  NOT NULL,
  outbound     VARCHAR(64)  NOT NULL,
  datetime     TIMESTAMPTZ  NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xray_logs_port_range') THEN
    ALTER TABLE xray_logs
      ADD CONSTRAINT xray_logs_port_range CHECK (port >= 0 AND port <= 65535);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xray_logs_uniqueness') THEN
    ALTER TABLE xray_logs
      ADD CONSTRAINT xray_logs_uniqueness
      UNIQUE (datetime, xray_user, user_ip, target, port, protocol_in, protocol_out, node_ip, node_name, inbound, outbound);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_xray_logs_datetime ON xray_logs (datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_user     ON xray_logs (xray_user, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_user_ip  ON xray_logs (user_ip, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_target   ON xray_logs (target, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_node     ON xray_logs (node_name, datetime DESC)