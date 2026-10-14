-- Endereço estruturado da unidade (CEP primeiro). `address` continua como a linha completa exibida nas telas.
ALTER TABLE units
  ADD COLUMN cep CHAR(8) NULL AFTER region,
  ADD COLUMN street VARCHAR(200) NULL AFTER cep,
  ADD COLUMN number VARCHAR(20) NULL AFTER street,
  ADD COLUMN district VARCHAR(100) NULL AFTER number,
  ADD COLUMN city VARCHAR(100) NULL AFTER district,
  ADD COLUMN uf CHAR(2) NULL AFTER city;
