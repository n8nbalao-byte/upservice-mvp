# UpService — Status do projeto

**Atualizado em:** 14/10/2026
**Produção:** https://app.upserviceintermed.com
**Linha de base:** "UpService — Decisões fechadas para o primeiro lançamento" v4.0 e "Linha de base do primeiro lançamento" v3.0 (pasta `appUpservice`)

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente

## Marcos

| Marco | Escopo | Status |
|---|---|---|
| 1 | Cadastro, documentos, unidades e vagas | ✅ em produção |
| 2 | Presença, selfie, GPS e pausas | ✅ em produção |
| 3 | Horas, notificações e exceções | ⬜ próximo |
| 4 | Punições, bloqueios e contestação | ⬜ |
| 5 | Monitoramento, relatórios e escala | ⬜ |

## Itens da linha de base (seção 11, 52 PRs)

### Fundação e segurança

| # | Item | Status | Observação |
|---|---|---|---|
| 1 | Governança do repositório | 🟡 | README, `.gitignore`, `.env.example`. Faltam templates de PR/issue, CODEOWNERS e SECURITY.md |
| 2 | Bootstrap da aplicação | ✅ | Express 5 + React/Vite/TS |
| 3 | CI/CD e ambientes | 🟡 | Deploy automático na Hostinger a cada push no `main`. Sem GitHub Actions e sem ambiente de homologação separado |
| 4 | Google Auth | ✅ | Projeto Google Cloud `upservice-511606`, app publicado |
| 5 | Banco e migrations | ✅ | MariaDB 11.8 na Hostinger; migrations 001 e 002 aplicadas |
| 6 | Storage privado de documentos e selfies | ✅ | `~/upservice-storage` (fora do deploy, permissão 700); acesso só por `/api/files/*` |
| 7 | Matriz de autorização | ✅ | Ver README → Perfis e permissões; testes de escopo em `test/api.test.js` |
| 8 | Auditoria e logs | 🟡 | `audit_events` append-only (login, cadastro, vagas, decisões, presença recusada, visualização de documentos e selfies). Sem tela de consulta |
| 9 | Backup e restauração | ⬜ | Depende do backup da Hostinger; restauração não testada |
| 10 | Política de privacidade e consentimentos | 🟡 | `/privacidade.html` e `/termos.html` publicados; aceite registrado no cadastro. Falta revisão jurídica |

### Cadastro e operação

| # | Item | Status | Observação |
|---|---|---|---|
| 11 | Cadastro aberto do profissional | ✅ | Papel sempre `PROFISSIONAL`, definido no servidor |
| 12 | CPF, RG, telefone, endereço e emergência | ✅ | CPF validado e único por conta |
| 13 | Upload e consulta controlada de documentos | ✅ | Fila "Documentos" para gestor (escopo das suas lojas) e admin (todos) |
| 14 | Unidades e gestores | ✅ | Código ATC-### automático; endereço pelo CEP; coordenadas com conferência no mapa |
| 15 | Bloqueio e reativação de unidades | ✅ | Bloqueio financeiro com justificativa; não cancela atividades aprovadas |
| 16 | Criação de vagas | ✅ | |
| 17 | Configuração de pausas | ✅ | 0 a 3 pausas, 1 a 120 min |
| 18 | Candidaturas e aprovação | ✅ | Aprovação transacional; limite de posições garantido sob concorrência |
| 19 | Ordenação por proximidade | ✅ | Localização do profissional não é gravada |
| 20 | Cancelamento pelo gestor | ✅ | Só gestor, com motivo, antes do check-in |

### Presença

| # | Item | Status | Observação |
|---|---|---|---|
| 21 | Permissões de câmera e GPS | ✅ | Mensagens de recusa e de GPS indisponível |
| 22 | Geofence de 300 metros | ✅ | Validado no servidor; precisão máxima de 100 m por unidade |
| 23 | Check-in com janela de 2 horas | ✅ | Até 15 min de tolerância; a tela mostra o horário de liberação |
| 24 | Selfie privada | ✅ | Captura ao vivo, JPEG ≤ 500 KB, SHA-256 |
| 25 | Máquina de estados | ✅ | Token de uso único por evento |
| 26 | Múltiplas pausas | ✅ | |
| 27 | Notificação de fim de pausa | ✅ | Cronômetro, som e vibração no app + e-mail via `contato@upserviceintermed.com` |
| 28 | Retorno da pausa | ✅ | |
| 29 | Checkout | ✅ | Bloqueado durante a pausa |
| 30 | Cálculo de horas | ✅ | checkout − check-in − pausas, horário do servidor |
| 31 | Solicitação de exceção GPS | ⬜ | Marco 3 |
| 32 | Confirmação administrativa pós-checkout | ✅ | Concluída ou falta (após 15 min de tolerância) |

### Punições e monitoramento

| # | Item | Status | Observação |
|---|---|---|---|
| 33 | Ocorrências e faltas | 🟡 | Falta registrada na confirmação; sem entidade de ocorrência (Marco 4) |
| 34 | Bloqueio temporário de profissional | 🟡 | Só manual pelo admin; regra de 3 faltas → 15 dias no Marco 4 |
| 35 | Reativação | 🟡 | Manual; reativação automática no Marco 4 |
| 36 | Bloqueio permanente manual e auditado | 🟡 | Admin com justificativa; gestor, confirmação extra e aviso ao profissional no Marco 4 |
| 37 | Painel operacional por loja | 🟡 | "Atividades" com contadores por status, selfies e horas |
| 38 | Indicadores consolidados | ⬜ | Marco 5 |
| 39 | Atualização periódica do painel | ✅ | 30 s, com horário da última atualização |
| 40 | Alertas de localização com a página ativa | ⬜ | Marco 5 |
| 41 | Relatórios de presença, diárias, horas e exceções | ⬜ | Marco 5 |
| 42 | Exportação CSV segura | ⬜ | Marco 5 |

### Validação e entrega

| # | Item | Status | Observação |
|---|---|---|---|
| 43 | Testes E2E | 🟡 | Integração da API contra MariaDB (14 testes); sem E2E de navegador |
| 44 | Testes de autorização | ✅ | Papel via payload, escopo de unidade, selfies e documentos alheios |
| 45 | Testes de documentos e storage privado | ✅ | |
| 46 | Testes de GPS, câmera e permissões | ⬜ | Precisa de celular real na loja |
| 47 | Testes de pausas e notificações | 🟡 | Automatizados; e-mail real ainda não recebido em teste |
| 48 | Testes de punições e bloqueios | 🟡 | Bloqueio de conta e de unidade testados; punições no Marco 4 |
| 49 | Testes em Android e rede móvel | ⬜ | |
| 50 | Teste de carga | ⬜ | Marco 5 |
| 51 | Homologação | 🟡 | Em andamento com usuários reais |
| 52 | Deploy controlado | ✅ | Produção ativa |

## Critérios de aceite (v4.0, seção 11, e v3.0, seção 12)

| Critério | Status |
|---|---|
| Cadastro de CPF, RG e comprovante de residência | ✅ |
| Documentos sem URL pública | ✅ |
| Acesso privado e auditado aos documentos por gestor e admin | ✅ |
| Profissional consulta e atualiza os próprios dados | ✅ |
| Check-in respeita a janela de 2 horas e a tolerância de 15 min | ✅ |
| Raio de 300 m validado no servidor | ✅ |
| Cada pausa respeita a quantidade e a duração da vaga | ✅ |
| Notificação de fim de pausa no app e por e-mail | ✅ (e-mail real a confirmar em teste) |
| Checkout durante a pausa bloqueado | ✅ |
| Horas calculadas com eventos do servidor | ✅ |
| Erro de GPS gera exceção, não aprovação automática | 🟡 hoje é bloqueado; fluxo de exceção no Marco 3 |
| Gestor aprova ou recusa exceções | ⬜ Marco 3 |
| Checkout esquecido gera pendência, não checkout falso | ⬜ Marco 3 |
| Distinção entre GPS validado, exceção e fechamento administrativo | 🟡 campo `validation` existe; exceção no Marco 3 |
| Três faltas confirmadas geram bloqueio de 15 dias | ⬜ Marco 4 |
| Bloqueio permanente manual por gestor ou admin | 🟡 só admin hoje |
| Contestação pelo app e por e-mail | ⬜ Marco 4 |
| Punições diferenciam falta confirmada de falha técnica | ⬜ Marco 4 |
| Bloqueios preservam o histórico | ✅ |
| Painel mostra a última atualização | ✅ |
| Aviso de localização não atualizada com a página fechada | ⬜ Marco 5 |
| Selfies e documentos com acesso controlado e auditado | ✅ |
| Backups e restauração testados | ⬜ |
| Privacidade e retenção aprovadas antes do uso real | 🟡 textos publicados, falta revisão jurídica |

## Próximo: Marco 3 — Horas, notificações e exceções

Regras já fechadas na v4.0:

- **Exceção de GPS (seção 5 da v3.0):** falha de GPS, precisão ou permissão → o profissional abre uma solicitação com selfie, horário, dispositivo e erro → o gestor aprova ou recusa com justificativa → o evento entra como `EXCECAO_APROVADA`, nunca como `GPS_VALIDADO`.
- **Check-in atrasado (seção 8 da v4.0):** depois dos 15 min, só por exceção aprovada pelo gestor; atraso aprovado não gera falta.
- **Checkout esquecido (seção 7 da v4.0):** depois do término previsto, aparece "Checkout pendente" e há lembrete ao profissional e alerta ao gestor. Com 30 min de tolerância, cria a ocorrência `CHECKOUT_AUSENTE` e a jornada fica `PENDENTE_DE_FECHAMENTO`. O gestor encerra com a origem do horário (informado pelo profissional, previsto ou confirmado pelo gestor) e justificativa, marcado como `FECHAMENTO_ADMINISTRATIVO`.
- **Horas:** separar o período validado por GPS do período por exceção ou fechamento administrativo.

## Pendências de operação

- Revisão jurídica da política de privacidade e dos termos (LGPD e trabalhista)
- Chave `GOOGLE_MAPS_API_KEY` para coordenadas precisas no cadastro de unidades (opcional)
- Teste de restauração de backup da Hostinger
- Teste em celular Android real numa loja (GPS, câmera, rede móvel)
- Trocar a senha SSH e a do e-mail `contato@`, que passaram pelo chat
