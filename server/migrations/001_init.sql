-- Marcos 1 e 2: cadastro, documentos, unidades, vagas, candidaturas e presença.
-- Compatível com MySQL 8 e MariaDB 10.6+. Horários em UTC.

CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  google_sub VARCHAR(255) NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  role ENUM('PROFISSIONAL','GESTOR','ADMINISTRADOR') NOT NULL DEFAULT 'PROFISSIONAL',
  status ENUM('ATIVO','EM_ANALISE','BLOQUEADO_TEMPORARIAMENTE','BLOQUEADO_PERMANENTEMENTE','INATIVO') NOT NULL DEFAULT 'ATIVO',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE worker_profiles (
  user_id CHAR(36) PRIMARY KEY,
  cpf CHAR(11) NOT NULL UNIQUE,
  rg VARCHAR(20) NOT NULL,
  phone VARCHAR(11) NOT NULL,
  address VARCHAR(300) NOT NULL,
  city VARCHAR(100) NOT NULL,
  uf CHAR(2) NOT NULL,
  emergency_name VARCHAR(200) NOT NULL,
  emergency_phone VARCHAR(11) NOT NULL,
  terms_accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE worker_documents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type ENUM('CPF','RG','COMPROVANTE') NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size INT NOT NULL,
  mime VARCHAR(50) NOT NULL,
  status ENUM('PENDENTE','APROVADO','REJEITADO','SUBSTITUIDO') NOT NULL DEFAULT 'PENDENTE',
  rejection_reason VARCHAR(500) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (user_id, type),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE units (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  region VARCHAR(100) NULL,
  address VARCHAR(300) NOT NULL,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  radius_m SMALLINT NOT NULL DEFAULT 300 CHECK (radius_m BETWEEN 100 AND 500),
  max_accuracy_m SMALLINT NOT NULL DEFAULT 100 CHECK (max_accuracy_m BETWEEN 10 AND 500),
  status ENUM('ATIVA','BLOQUEADA_FINANCEIRA','INATIVA') NOT NULL DEFAULT 'ATIVA',
  status_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE unit_managers (
  user_id CHAR(36) NOT NULL,
  unit_id CHAR(36) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, unit_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jobs (
  id CHAR(36) PRIMARY KEY,
  unit_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  positions SMALLINT NOT NULL CHECK (positions > 0),
  daily_value DECIMAL(10,2) NOT NULL CHECK (daily_value >= 0),
  break_count TINYINT NOT NULL DEFAULT 1 CHECK (break_count BETWEEN 0 AND 3),
  break_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (break_minutes BETWEEN 1 AND 120),
  status ENUM('RASCUNHO','ABERTA','ENCERRADA','CANCELADA') NOT NULL DEFAULT 'RASCUNHO',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (ends_at > starts_at),
  INDEX (status, starts_at),
  INDEX (unit_id, starts_at),
  FOREIGN KEY (unit_id) REFERENCES units(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE applications (
  id CHAR(36) PRIMARY KEY,
  job_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  status ENUM('PENDENTE','APROVADA','RECUSADA','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
  cancel_reason VARCHAR(500) NULL,
  decided_by CHAR(36) NULL,
  decided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (job_id, user_id),
  INDEX (user_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE work_sessions (
  id CHAR(36) PRIMARY KEY,
  application_id CHAR(36) NOT NULL UNIQUE,
  status ENUM('AGUARDANDO_CHECKIN','EM_ATIVIDADE','EM_PAUSA','PAUSA_EXCEDIDA','FINALIZADA','CANCELADA_ADMINISTRATIVAMENTE') NOT NULL DEFAULT 'AGUARDANDO_CHECKIN',
  breaks_used TINYINT NOT NULL DEFAULT 0,
  break_ends_at DATETIME(3) NULL,
  break_email_sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (status, break_ends_at),
  FOREIGN KEY (application_id) REFERENCES applications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE event_tokens (
  token VARCHAR(64) PRIMARY KEY,
  work_session_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eventos imutáveis: correções futuras criam novos eventos, nunca editam estes.
CREATE TABLE presence_events (
  id CHAR(36) PRIMARY KEY,
  work_session_id CHAR(36) NOT NULL,
  type ENUM('CHECK_IN','PAUSE_START','PAUSE_END','CHECK_OUT') NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  client_ts DATETIME(3) NULL,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  accuracy_m DECIMAL(8,2) NOT NULL,
  unit_lat DECIMAL(9,6) NOT NULL,
  unit_lng DECIMAL(9,6) NOT NULL,
  distance_m DECIMAL(8,2) NOT NULL,
  radius_m SMALLINT NOT NULL,
  selfie_key VARCHAR(255) NOT NULL,
  selfie_sha256 CHAR(64) NOT NULL,
  validation ENUM('GPS_VALIDADO','EXCECAO_APROVADA') NOT NULL DEFAULT 'GPS_VALIDADO',
  token VARCHAR(64) NOT NULL UNIQUE,
  INDEX (work_session_id, occurred_at),
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE daily_confirmations (
  application_id CHAR(36) PRIMARY KEY,
  result ENUM('CONCLUIDA','NAO_COMPARECEU') NOT NULL,
  note VARCHAR(500) NULL,
  confirmed_by CHAR(36) NOT NULL,
  confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (application_id) REFERENCES applications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_events (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(64) NULL,
  before_json TEXT NULL,
  after_json TEXT NULL,
  reason VARCHAR(500) NULL,
  request_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (entity, entity_id),
  INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
