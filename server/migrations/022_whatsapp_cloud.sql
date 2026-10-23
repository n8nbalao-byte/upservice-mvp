-- API oficial do WhatsApp: o token da Meta com os IDs e as chaves passa dos 500 caracteres. Só aumenta o tamanho.
ALTER TABLE app_settings MODIFY value TEXT NOT NULL;
