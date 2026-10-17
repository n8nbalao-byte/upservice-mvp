-- Brinde sorteado por dia (boné, camiseta, celular...): o administrador cadastra no calendário, para uma unidade ou
-- todas. Às 9h do dia seguinte o sistema sorteia entre quem fez 3 estrelas naquele dia. Só acrescenta uma tabela.
CREATE TABLE brindes (
  id CHAR(36) PRIMARY KEY,
  day DATE NOT NULL,
  unit_id CHAR(36) NULL,
  premio VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AGENDADO',
  winner_user_id CHAR(36) NULL,
  participants INT NULL,
  drawn_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX brindes_day (day),
  INDEX brindes_status (status, day),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  FOREIGN KEY (winner_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
