-- Marco 3: exceções de presença, checkout esquecido e fechamento administrativo.
-- Só adiciona (valores de ENUM no fim, colunas novas, NULL permitido): pode rodar antes do deploy.

ALTER TABLE work_sessions
  MODIFY status ENUM('AGUARDANDO_CHECKIN','EM_ATIVIDADE','EM_PAUSA','PAUSA_EXCEDIDA','FINALIZADA','CANCELADA_ADMINISTRATIVAMENTE',
                     'PENDENTE_DE_EXCECAO','PENDENTE_DE_FECHAMENTO') NOT NULL DEFAULT 'AGUARDANDO_CHECKIN',
  ADD COLUMN checkout_reminder_at DATETIME(3) NULL,
  ADD COLUMN reported_end_at DATETIME(3) NULL,
  ADD COLUMN reported_end_note VARCHAR(500) NULL;

-- Fechamento administrativo não tem GPS nem selfie; exceção pode não ter GPS.
ALTER TABLE presence_events
  MODIFY lat DECIMAL(9,6) NULL,
  MODIFY lng DECIMAL(9,6) NULL,
  MODIFY accuracy_m DECIMAL(8,2) NULL,
  MODIFY distance_m DECIMAL(8,2) NULL,
  MODIFY selfie_key VARCHAR(255) NULL,
  MODIFY selfie_sha256 CHAR(64) NULL,
  MODIFY token VARCHAR(64) NULL,
  MODIFY validation ENUM('GPS_VALIDADO','EXCECAO_APROVADA','FECHAMENTO_ADMINISTRATIVO') NOT NULL DEFAULT 'GPS_VALIDADO',
  ADD COLUMN closure_source ENUM('INFORMADO_PROFISSIONAL','PREVISTO','CONFIRMADO_GESTOR') NULL,
  ADD COLUMN note VARCHAR(500) NULL,
  ADD COLUMN exception_id CHAR(36) NULL;

CREATE TABLE presence_exceptions (
  id CHAR(36) PRIMARY KEY,
  work_session_id CHAR(36) NOT NULL,
  type ENUM('CHECK_IN','PAUSE_START','PAUSE_END','CHECK_OUT') NOT NULL,
  reason ENUM('GPS_INDISPONIVEL','PRECISAO_INSUFICIENTE','PERMISSAO_NEGADA','FORA_DO_RAIO','FORA_DO_HORARIO','OUTRO') NOT NULL,
  error_message VARCHAR(500) NULL,
  message VARCHAR(500) NULL,
  requested_by CHAR(36) NOT NULL,
  requested_at DATETIME(3) NOT NULL,
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  accuracy_m DECIMAL(8,2) NULL,
  distance_m DECIMAL(8,2) NULL,
  user_agent VARCHAR(300) NULL,
  selfie_key VARCHAR(255) NOT NULL,
  selfie_sha256 CHAR(64) NOT NULL,
  prev_status VARCHAR(40) NOT NULL,
  status ENUM('PENDENTE','APROVADA','RECUSADA') NOT NULL DEFAULT 'PENDENTE',
  decided_by CHAR(36) NULL,
  decided_at DATETIME(3) NULL,
  decision_reason VARCHAR(500) NULL,
  INDEX (work_session_id, status),
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
