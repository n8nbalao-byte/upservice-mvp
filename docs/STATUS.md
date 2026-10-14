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
| 3 | Horas, notificações e exceções | ✅ em produção |
| 4 | Punições, bloqueios e contestação | ✅ em produção |
| 5 | Monitoramento, relatórios e escala | ⬜ próximo |

## Itens da linha de base (seção 11, 52 PRs)

### Fundação e segurança

| # | Item | Status | Observação |
|---|---|---|---|
| 1 | Governança do repositório | 🟡 | README, `.gitignore`, `.env.example`. Faltam templates de PR/issue, CODEOWNERS e SECURITY.md |
| 2 | Bootstrap da aplicação | ✅ | Express 5 + React/Vite/TS |
| 3 | CI/CD e ambientes | 🟡 | Deploy automático na Hostinger a cada push no `main`. Sem GitHub Actions e sem ambiente de homologação separado |
| 4 | Google Auth | ✅ | Projeto Google Cloud `upservice-511606`, app publicado |
| 5 | Banco e migrations | ✅ | MariaDB 11.8 na Hostinger; migrations 001 a 004 aplicadas |
| 6 | Storage privado de documentos e selfies | ✅ | `~/upservice-storage` (fora do deploy, permissão 700); acesso só por `/api/files/*` |
| 7 | Matriz de autorização | ✅ | Ver README → Perfis e permissões; testes de escopo em `test/api.test.js` |
| 8 | Auditoria e logs | 🟡 | `audit_events` append-only (login, cadastro, vagas, decisões, presença recusada, exceções, checkout ausente, fechamentos, ocorrências, bloqueios, contestações, visualização de documentos e selfies). Sem tela de consulta |
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
| 23 | Check-in com janela de 2 horas | ✅ | Até 15 min de tolerância; depois disso, só por exceção aprovada até o término da vaga |
| 24 | Selfie privada | ✅ | Captura ao vivo, JPEG ≤ 500 KB, SHA-256 |
| 25 | Máquina de estados | ✅ | Token de uso único por evento |
| 26 | Múltiplas pausas | ✅ | |
| 27 | Notificação de fim de pausa | ✅ | Cronômetro, som e vibração no app + e-mail via `contato@upserviceintermed.com` |
| 28 | Retorno da pausa | ✅ | |
| 29 | Checkout | ✅ | Bloqueado durante a pausa |
| 30 | Cálculo de horas | ✅ | checkout − check-in − pausas, horário do servidor; mostra a origem (GPS, exceção, fechamento administrativo) |
| 31 | Solicitação de exceção GPS | ✅ | Pedido com selfie, motivo, erro e localização (se houver); gestor aprova ou recusa com justificativa; evento `EXCECAO_APROVADA` com o horário do pedido |
| 32 | Confirmação administrativa pós-checkout | ✅ | Concluída ou falta (após 15 min de tolerância) |

### Punições e monitoramento

| # | Item | Status | Observação |
|---|---|---|---|
| 33 | Ocorrências e faltas | ✅ | Falta confirmada pelo gestor; pausa excedida e checkout ausente geradas pela varredura como pendentes; abandono, fraude e regra operacional registradas manualmente. Falha técnica nunca vira falta |
| 34 | Bloqueio temporário de profissional | ✅ | 3 faltas confirmadas desde o último bloqueio → 15 dias; vagas aprovadas futuras liberadas; aviso por e-mail |
| 35 | Reativação | ✅ | Automática no fim do prazo (varredura) ou manual por gestor/admin com justificativa |
| 36 | Bloqueio permanente manual e auditado | ✅ | Gestor (suas lojas) ou admin, justificativa + confirmação digitada (BLOQUEAR), aviso e auditoria |
| 37 | Painel operacional por loja | 🟡 | "Atividades" com contadores por status, selfies e horas; central de **Pendências** com aviso sonoro e notificação do navegador |
| 38 | Indicadores consolidados | ⬜ | Marco 5 |
| 39 | Atualização periódica do painel | ✅ | Atividades a cada 30 s; Pendências e Ocorrências a cada 20 s, com horário da última atualização |
| 40 | Alertas de localização com a página ativa | ⬜ | Marco 5 |
| 41 | Relatórios de presença, diárias, horas e exceções | ⬜ | Marco 5 |
| 42 | Exportação CSV segura | ⬜ | Marco 5 |

### Validação e entrega

| # | Item | Status | Observação |
|---|---|---|---|
| 43 | Testes E2E | 🟡 | Integração da API contra MariaDB (25 testes no total); sem E2E de navegador |
| 44 | Testes de autorização | ✅ | Papel via payload, escopo de unidade, selfies e documentos alheios |
| 45 | Testes de documentos e storage privado | ✅ | |
| 46 | Testes de GPS, câmera e permissões | ⬜ | Precisa de celular real na loja |
| 47 | Testes de pausas e notificações | 🟡 | Automatizados; e-mail real ainda não recebido em teste |
| 48 | Testes de punições e bloqueios | ✅ | 3 faltas, modo restrito, contestação, reativação automática, bloqueio permanente e escopo do gestor |
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
| Erro de GPS gera exceção, não aprovação automática | ✅ |
| Gestor aprova ou recusa exceções | ✅ |
| Checkout esquecido gera pendência, não checkout falso | ✅ lembrete no término, pendência após 30 min |
| Distinção entre GPS validado, exceção e fechamento administrativo | ✅ nos registros, nas horas e no painel |
| Três faltas confirmadas geram bloqueio de 15 dias | ✅ |
| Bloqueio permanente manual por gestor ou admin | ✅ |
| Contestação pelo app e por e-mail | ✅ protocolo CT-AAAAMMDD-XXXX |
| Punições diferenciam falta confirmada de falha técnica | ✅ |
| Bloqueios preservam o histórico | ✅ |
| Painel mostra a última atualização | ✅ |
| Aviso de localização não atualizada com a página fechada | ⬜ Marco 5 |
| Selfies e documentos com acesso controlado e auditado | ✅ |
| Backups e restauração testados | ⬜ |
| Privacidade e retenção aprovadas antes do uso real | 🟡 textos publicados, falta revisão jurídica |

## Marco 3 — entregue

- **Exceção:** quando o registro falha (GPS, precisão, permissão, fora do raio), o profissional pede exceção com selfie e mensagem. A atividade fica `PENDENTE_DE_EXCECAO` e bloqueia outros registros até o gestor decidir. Aprovada, vira evento `EXCECAO_APROVADA` com o horário do pedido (o gestor não altera); recusada, volta ao estado anterior.
- **Check-in atrasado:** depois dos 15 min, botão "Pedir check-in com atraso" até o término da vaga. Exceção nunca serve para chegar antes da janela.
- **Checkout esquecido:** no término, e-mail de lembrete ao profissional e alerta aos gestores da unidade. Após 30 min, a jornada fica `PENDENTE_DE_FECHAMENTO` (`CHECKOUT_AUSENTE` na auditoria); o profissional informa o horário de saída e o gestor encerra com a origem do horário e justificativa (`FECHAMENTO_ADMINISTRATIVO`).
- **Horas:** pausa aberta no fechamento conta como pausa; registros, horas e painel mostram a origem.

## Marco 4 — entregue

Decisões tomadas em 14/10/2026: as 3 faltas contam **desde o último bloqueio**; o bloqueio **cancela as vagas aprovadas futuras** (liberando a posição); o profissional bloqueado entra em **modo restrito** (vê motivo e prazo e contesta, mas não vê vagas nem registra presença).

- **Ocorrências:** falta (confirmada pelo gestor na diária); pausa excedida e checkout ausente (criadas pela varredura como pendentes, o gestor confirma ou cancela); abandono, fraude e regra operacional (manuais). 1ª confirmada = aviso por e-mail; 2ª = alerta de revisão aos gestores.
- **Bloqueios:** temporário de 15 dias na 3ª falta, com reativação automática; permanente só manual, com justificativa e "BLOQUEAR" digitado. O bloqueio pelo menu Usuários segue o mesmo fluxo.
- **Contestação:** pelo app (protocolo) ou registrada pelo gestor a partir de e-mail; decisão Mantida, Cancelada (anula a punição) ou Ajustada (novo prazo); não suspende o bloqueio.
- **Central de pendências:** o sino do menu do gestor/admin mostra exceções, checkouts pendentes, contestações, ocorrências, candidaturas e documentos. Atualiza a cada 20 s, toca um aviso e mostra notificação do navegador quando surge algo novo. Exceção pedida também gera e-mail aos gestores da loja.
- **Correção:** a rota de pedido de exceção aceitava só 100 KB; selfies reais de celular falhavam. Agora aceita até 1 MB, como o registro normal, com teste usando uma selfie de 400 KB.

## Próximo: Marco 5 — Monitoramento, relatórios e escala

Indicadores consolidados (item 38), alerta de localização com a página ativa (40), relatórios de presença, diárias, horas e exceções (41), exportação CSV segura (42), testes de carga (50) e de Android em rede móvel (49).

## Pendências de operação

- Revisão jurídica da política de privacidade e dos termos (LGPD e trabalhista)
- Chave `GOOGLE_MAPS_API_KEY` para coordenadas precisas no cadastro de unidades (opcional)
- Teste de restauração de backup da Hostinger
- Teste em celular Android real numa loja (GPS, câmera, rede móvel)
- Trocar a senha SSH e a do e-mail `contato@`, que passaram pelo chat
