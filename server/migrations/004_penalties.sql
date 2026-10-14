-- Marco 4: ocorrências, bloqueios (penalidades) e contestações. Só cria tabelas: pode rodar antes do deploy.

CREATE TABLE penalties (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type ENUM('BLOQUEIO_TEMPORARIO','BLOQUEIO_PERMANENTE') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NULL,
  status ENUM('ATIVA','ENCERRADA','CANCELADA') NOT NULL DEFAULT 'ATIVA',
  created_by CHAR(36) NULL,
  ended_at DATETIME(3) NULL,
  ended_by CHAR(36) NULL,
  end_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (user_id, status),
  INDEX (status, ends_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE occurrences (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  unit_id CHAR(36) NOT NULL,
  work_session_id CHAR(36) NULL,
  application_id CHAR(36) NULL,
  type ENUM('FALTA','CHECKOUT_AUSENTE','PAUSA_EXCEDIDA','ABANDONO','FRAUDE','REGRA_OPERACIONAL') NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('PENDENTE','CONFIRMADA','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
  created_by CHAR(36) NULL,
  confirmed_by CHAR(36) NULL,
  confirmed_at DATETIME(3) NULL,
  decision_reason VARCHAR(500) NULL,
  penalty_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (work_session_id, type),
  INDEX (user_id, status),
  INDEX (unit_id, status),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contestations (
  id CHAR(36) PRIMARY KEY,
  protocol VARCHAR(20) NOT NULL UNIQUE,
  user_id CHAR(36) NOT NULL,
  penalty_id CHAR(36) NULL,
  occurrence_id CHAR(36) NULL,
  channel ENUM('APP','EMAIL') NOT NULL,
  message VARCHAR(1000) NOT NULL,
  status ENUM('ABERTA','MANTIDA','CANCELADA','AJUSTADA') NOT NULL DEFAULT 'ABERTA',
  created_by CHAR(36) NOT NULL,
  decided_by CHAR(36) NULL,
  decided_at DATETIME(3) NULL,
  decision_reason VARCHAR(500) NULL,
  new_ends_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (user_id, status),
  INDEX (status),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
