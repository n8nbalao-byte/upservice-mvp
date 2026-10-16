-- Login por e-mail/senha, recuperação de senha, QR Code e código por WhatsApp. Só adiciona.
ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL;

-- Tokens de uso único, sempre guardados como hash (sha256): RESET (senha), OTP (código no WhatsApp), QR (login no computador).
CREATE TABLE auth_tokens (
  id CHAR(36) PRIMARY KEY,
  kind ENUM('RESET','OTP','QR') NOT NULL,
  user_id CHAR(36) NULL,
  token_hash CHAR(64) NOT NULL,
  secret_hash CHAR(64) NULL,
  code CHAR(2) NULL,
  target VARCHAR(30) NULL,
  attempts TINYINT NOT NULL DEFAULT 0,
  approved_at DATETIME(3) NULL,
  used_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_ip VARCHAR(64) NULL,
  user_agent VARCHAR(200) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY auth_tokens_hash (token_hash),
  INDEX (kind, target),
  INDEX (user_id),
  INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Limite de tentativas por chave (IP, e-mail, telefone) em janelas de tempo; vale para vários processos do app.
CREATE TABLE rate_limits (
  k VARCHAR(190) PRIMARY KEY,
  window_start DATETIME(3) NOT NULL,
  n INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
