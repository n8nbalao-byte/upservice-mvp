-- Carteira: chave Pix do profissional e pagamentos registrados pelo gestor (com o comprovante do banco).
-- Só acrescenta colunas que aceitam vazio e uma tabela nova.
ALTER TABLE worker_profiles
  ADD COLUMN pix_type ENUM('CPF','EMAIL','TELEFONE','ALEATORIA') NULL,
  ADD COLUMN pix_key VARCHAR(77) NULL;

CREATE TABLE worker_payments (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  pix_key VARCHAR(77) NULL,
  receipt_key VARCHAR(255) NULL,
  receipt_mime VARCHAR(40) NULL,
  paid_by CHAR(36) NOT NULL,
  paid_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  note VARCHAR(300) NULL,
  INDEX worker_payments_user (user_id, paid_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
