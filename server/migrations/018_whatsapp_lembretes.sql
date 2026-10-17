-- Lembretes do WhatsApp já enviados (véspera, check-in, pausa): um por diária e tipo. Só acrescenta uma tabela.
CREATE TABLE whatsapp_lembretes (
  application_id CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (application_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
