-- MySQL schema. Runs on every server start, so every statement must be safe to repeat.
-- Indexes are declared inside CREATE TABLE because MySQL has no CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK (CHAR_LENGTH(username) BETWEEN 3 AND 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX sessions_user (user_id),
  INDEX sessions_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  installation_id VARCHAR(128) NOT NULL,
  peer_id VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('laptop', 'phone', 'desktop')),
  last_seen BIGINT NOT NULL,
  UNIQUE (user_id, installation_id),
  INDEX devices_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friendships (
  id VARCHAR(64) PRIMARY KEY,
  requester_id VARCHAR(64) NOT NULL,
  recipient_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at BIGINT NOT NULL,
  CHECK (requester_id <> recipient_id),
  UNIQUE INDEX friendships_pair ((LEAST(requester_id, recipient_id)), (GREATEST(requester_id, recipient_id))),
  INDEX friendships_requester (requester_id),
  INDEX friendships_recipient (recipient_id),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_limits (
  `key` VARCHAR(128) PRIMARY KEY,
  attempts INT NOT NULL,
  window_start BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;