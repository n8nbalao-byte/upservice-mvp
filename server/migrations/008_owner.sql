-- Administrador principal (definido só por SSH, com identidade Google confirmada) e exclusão de usuários (anonimização).
-- Só adiciona: pode rodar antes do deploy.
ALTER TABLE users
  ADD COLUMN is_owner TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
  ADD COLUMN deleted_at DATETIME(3) NULL;
