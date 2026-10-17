-- Atendimento do profissional pelo WhatsApp (bot com enquetes). Só acréscimos: a conversa de cada número (passo atual,
-- contexto e opções mostradas) e o canal WHATSAPP nas contestações.
CREATE TABLE whatsapp_conversas (
  phone CHAR(11) PRIMARY KEY,
  user_id CHAR(36) NULL,
  step VARCHAR(40) NOT NULL,
  ctx TEXT NULL,
  options TEXT NULL,
  poll_id VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE contestations MODIFY channel ENUM('APP','EMAIL','WHATSAPP') NOT NULL;
