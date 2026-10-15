-- Selfie obrigatória no cadastro (base para a futura comparação facial). Só adiciona um valor ao ENUM: pode rodar antes do deploy.
ALTER TABLE worker_documents
  MODIFY type ENUM('CPF','RG','COMPROVANTE','SELFIE') NOT NULL;
