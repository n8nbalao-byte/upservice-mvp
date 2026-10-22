-- Fotos do carrossel da tela de login, gerenciadas em Configurações (antes vinham dentro do app). Cada foto tem duas
-- versões (computador e celular) e um tipo, para o login alternar profissional e loja. Só acrescenta uma tabela.
CREATE TABLE login_fotos (
  id CHAR(36) PRIMARY KEY,
  tipo ENUM('PROFISSIONAL','LOJA') NOT NULL,
  big_key VARCHAR(255) NOT NULL,
  small_key VARCHAR(255) NOT NULL,
  mime VARCHAR(20) NOT NULL,
  width INT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
