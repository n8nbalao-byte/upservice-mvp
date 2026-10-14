-- Marco 5: última leitura de localização, alertas de saída do raio, horas materializadas e índices de status.
-- Só adiciona: pode rodar antes do deploy.

-- Só a ÚLTIMA leitura fica guardada (não o trajeto); saídas do raio vão para location_alerts.
ALTER TABLE work_sessions
  ADD COLUMN last_ping_at DATETIME(3) NULL,
  ADD COLUMN last_ping_distance_m DECIMAL(8,2) NULL,
  ADD COLUMN last_ping_accuracy_m DECIMAL(8,2) NULL,
  ADD COLUMN last_ping_inside TINYINT(1) NULL,
  ADD COLUMN worked_min INT NULL,
  ADD COLUMN break_min INT NULL,
  ADD COLUMN sources VARCHAR(100) NULL;

CREATE TABLE location_alerts (
  id CHAR(36) PRIMARY KEY,
  work_session_id CHAR(36) NOT NULL,
  at DATETIME(3) NOT NULL,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  accuracy_m DECIMAL(8,2) NOT NULL,
  distance_m DECIMAL(8,2) NOT NULL,
  acknowledged_by CHAR(36) NULL,
  acknowledged_at DATETIME(3) NULL,
  INDEX (work_session_id, at),
  INDEX (acknowledged_at),
  FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Filtros por status da central de pendências e dos relatórios.
CREATE INDEX applications_status ON applications (status, job_id);
CREATE INDEX presence_exceptions_status ON presence_exceptions (status);
CREATE INDEX worker_documents_status ON worker_documents (status);
CREATE INDEX occurrences_status ON occurrences (status, created_at);
