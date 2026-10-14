# Segurança

## Como reportar

Encontrou uma vulnerabilidade ou suspeita de vazamento de dados? **Não abra issue pública.** Escreva para **contato@upserviceintermed.com** com o que foi observado, quando e como reproduzir.

## Incidente com dados pessoais

1. Não apague evidências (logs, `audit_events`, arquivos).
2. Avise a UpService e a Automatiza imediatamente.
3. A decisão de comunicar titulares e a ANPD é da UpService, com a assessoria jurídica/DPO.

## Práticas do projeto

- Papel e escopo de unidade decididos sempre no servidor; testes de autorização em `test/api.test.js`.
- Documentos e selfies em pasta privada, acessíveis só por rota autenticada e auditada.
- Segredos só nas variáveis de ambiente do painel da Hostinger; nunca no repositório.
- Backup diário do banco em `~/upservice-backups` (14 dias), fora da pasta do deploy.
