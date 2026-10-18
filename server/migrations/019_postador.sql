-- Postador de vagas nos grupos de WhatsApp das lojas. Só acréscimos: o grupo de cada loja (id "…@g.us" e o nome
-- mostrado) e o registro do que já foi postado (cada vaga uma vez).
ALTER TABLE units
  ADD COLUMN whatsapp_group VARCHAR(60) NULL,
  ADD COLUMN whatsapp_group_name VARCHAR(120) NULL;

CREATE TABLE vagas_postagens (
  job_id CHAR(36) PRIMARY KEY,
  unit_id CHAR(36) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at DATETIME(3) NULL,
  INDEX vagas_postagens_unit (status, unit_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
