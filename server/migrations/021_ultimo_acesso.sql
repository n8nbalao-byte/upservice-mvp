-- Último acesso de cada usuário (para mostrar quem está online). Só acrescenta uma coluna que aceita vazio.
ALTER TABLE users ADD COLUMN last_seen_at DATETIME(3) NULL;
