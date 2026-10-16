-- Configurações globais do app (ex.: perfil de cores), alteradas só pelo administrador principal. Só adiciona.
CREATE TABLE app_settings (
  name VARCHAR(60) PRIMARY KEY,
  value VARCHAR(500) NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
