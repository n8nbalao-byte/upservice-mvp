-- Quebra de caixa: vaga marcada como "de caixa" e a diferença lançada pelo gestor ao fim do expediente, abatida do
-- A receber (não é ocorrência nem punição). O profissional pode pedir uma revisão (reaproveita as contestações).
-- Só acrescenta: coluna com padrão, tabela nova e coluna que aceita vazio.
ALTER TABLE jobs ADD COLUMN is_cashier TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE cash_breaks (
  id CHAR(36) PRIMARY KEY,
  application_id CHAR(36) NOT NULL UNIQUE,
  user_id CHAR(36) NOT NULL,
  unit_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  reason VARCHAR(500) NOT NULL,
  status ENUM('ATIVA','CANCELADA') NOT NULL DEFAULT 'ATIVA',
  final_amount DECIMAL(10,2) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  canceled_by CHAR(36) NULL,
  canceled_at DATETIME(3) NULL,
  cancel_reason VARCHAR(500) NULL,
  INDEX cash_breaks_user (user_id, status),
  FOREIGN KEY (application_id) REFERENCES applications(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE contestations ADD COLUMN cash_break_id CHAR(36) NULL, ADD INDEX contestations_cash_break (cash_break_id);
