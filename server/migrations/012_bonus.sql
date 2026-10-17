-- Bônus do mês (valor total definido pela gestão; o sistema sorteia os dias) e dias especiais (sorteio). Só acrescenta tabelas.
CREATE TABLE bonus_months (
  month CHAR(7) PRIMARY KEY,
  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
  set_by CHAR(36) NOT NULL,
  set_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bonus_days (
  day DATE PRIMARY KEY,
  kind ENUM('BONUS','SORTEIO') NOT NULL,
  value DECIMAL(8,2) NULL,
  label VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promoção: quem tiver 15 dias com 3 estrelas em 2026 e fizer 3 estrelas em 20/12 concorre a uma TV de 32".
INSERT INTO bonus_days (day, kind, label) VALUES ('2026-12-20', 'SORTEIO', 'Sorteio de uma TV de 32 polegadas');
