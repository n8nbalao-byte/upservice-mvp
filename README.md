# UpService

PWA para a UpService: cadastro aberto de profissionais (Google), documentos, unidades, vagas, candidaturas e registro de presença (check-in, pausas, retorno e checkout com GPS a até 300 m + selfie), com exceções aprovadas pelo gestor, fechamento de checkout esquecido, cálculo de horas e confirmação da diária.

- **Produção:** https://app.upserviceintermed.com
- **Andamento:** [docs/STATUS.md](docs/STATUS.md) (marcos, os 52 itens da linha de base e critérios de aceite)
- **Regras de negócio:** "UpService — Decisões fechadas para o primeiro lançamento" v4.0 (pasta `C:\Foundlab\appUpservice`)

## Stack

- Node 22.9+ / Express 5: API em `/api` e o build do front (`web/dist`) no mesmo processo; entry `server.js`
- MySQL 8 ou MariaDB 10.6+ (produção: MariaDB 11.8 na Hostinger)
- React + Vite + TypeScript (`web/`)
- Documentos e selfies em pasta privada (`STORAGE_DIR`), só acessíveis por `/api/files/*`, com checagem de acesso e auditoria
- CEP pelo ViaCEP; coordenadas pelo Google Geocoding (com `GOOGLE_MAPS_API_KEY`) ou OpenStreetMap

## Perfis e permissões

| Ação | Profissional | Gestor | Admin |
|---|:---:|:---:|:---:|
| Cadastro próprio, documentos, vagas, candidatura, presença, resumo de diárias | ✅ | | |
| Criar, publicar, encerrar e cancelar vagas | | suas lojas | todas |
| Aprovar ou recusar candidaturas | | suas lojas | todas |
| Cancelar candidatura já aprovada (antes do check-in) | | suas lojas | ❌ |
| Reabrir vaga encerrada | | ❌ | ✅ |
| Atividades do dia, selfies, horas, confirmar diária ou falta | | suas lojas | todas |
| Aprovar ou recusar exceções de presença | | suas lojas | todas |
| Encerrar checkout esquecido (fechamento administrativo) | | suas lojas | todas |
| Ver e aprovar documentos (aba Documentos) | | quem se candidatou nas suas lojas | todos |
| Unidades: cadastrar, editar, bloquear ou inativar | | ❌ | ✅ |
| Usuários: papel, status e vínculo gestor↔unidade | | ❌ | ✅ |

Ninguém altera o próprio papel. O cadastro aberto sempre cria `PROFISSIONAL`; gestores e administradores são promovidos em **Usuários** depois do primeiro login. Toda ação administrativa fica em `audit_events`.

## Rodar localmente

```bash
docker run -d --name upservice-db -e MARIADB_ROOT_PASSWORD=dev -e MARIADB_DATABASE=upservice -p 3306:3306 mariadb:11
cp .env.example .env
npm install
npm run migrate
npm run make-admin -- voce@empresa.com "Seu Nome"
npm run api      # terminal 1: API em :3000
npm run web      # terminal 2: front em http://localhost:5173
```

Com `DEV_LOGIN=1` a tela de login aceita só o e-mail (sem Google; o servidor recusa em produção). Para simular GPS no desktop: Chrome DevTools → ⋮ → More tools → Sensors → Location.

## Testes

```bash
npm test          # regras puras + integração da API (precisa de TEST_DATABASE_URL; o banco de teste é apagado e recriado)
npm run typecheck
```

## Produção (Hostinger)

| Item | Valor |
|---|---|
| Site | `app.upserviceintermed.com` (Node.js app, Node 22, conta `u770915504`) |
| Deploy | Automático a cada push no `main` (`npm install && npm run build`, entry `server.js`) |
| Variáveis de ambiente | **Somente pelo painel** (Node.js → Variáveis de ambiente). Editar o `.env` do servidor por SSH não vale: a Hostinger injeta as variáveis no deploy |
| Banco | `u770915504_upservice` (MariaDB 11.8, host `127.0.0.1`) |
| Arquivos privados | `/home/u770915504/upservice-storage` (fora do deploy) |
| E-mail | SMTP `smtp.hostinger.com:465`, remetente `contato@upserviceintermed.com` |
| Google OAuth | Projeto `upservice-511606`, app publicado |

Variáveis: `NODE_ENV=production`, `DATABASE_URL`, `STORAGE_DIR`, `GOOGLE_CLIENT_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` e, opcional, `GOOGLE_MAPS_API_KEY`. Nunca definir `DEV_LOGIN` nem `PORT` (a Hostinger define a porta).

### Migrations em produção

Rodar por SSH depois do deploy. Migrations que só **adicionam** colunas podem rodar antes, para não haver janela com código novo e banco antigo:

```bash
H=~/domains/app.upserviceintermed.com/hbuilds
cd $H/current/nodejs && /opt/alt/alt-nodejs22/root/bin/node --env-file=$H/config/.env server/migrate.js
```

Logs da aplicação: `$H/current/nodejs/console.log`. Logs de deploy: `$H/logs/<id>/*.log`.

## Limites conhecidos

- A PWA não lê GPS com a página fechada; o painel mostra o status do último registro, não presença contínua.
- O GPS do navegador pode ser falsificado; selfie, token único e auditoria reduzem, mas não eliminam.
- Os avisos por e-mail (fim de pausa, checkout pendente) e a passagem para `PENDENTE_DE_FECHAMENTO` rodam num `setInterval` do processo; se a Hostinger hibernar o app, mover para cron.
- As coordenadas automáticas pelo OpenStreetMap erram centenas de metros a km em avenidas longas; conferir o pino no mapa ou usar `GOOGLE_MAPS_API_KEY`.
