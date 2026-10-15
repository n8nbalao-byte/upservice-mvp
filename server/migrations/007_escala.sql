-- Operação em escala: nº da filial e telefone da loja; diária confirmada automaticamente (confirmed_by NULL).
-- Só adiciona/afrouxa: pode rodar antes do deploy.
ALTER TABLE units
  ADD COLUMN filial VARCHAR(10) NULL AFTER code,
  ADD COLUMN phone VARCHAR(20) NULL AFTER filial,
  ADD UNIQUE KEY units_filial (filial);

ALTER TABLE daily_confirmations
  MODIFY confirmed_by CHAR(36) NULL;
