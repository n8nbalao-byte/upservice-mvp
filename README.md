# UpService — MVP (Marcos 1 e 2)

PWA para a UpService: cadastro aberto de profissionais (Google), documentos, unidades, vagas, candidaturas e registro de presença (check-in, pausas, retorno e checkout com GPS a até 300 m + selfie) com cálculo de horas.

Fonte das regras: `C:\Foundlab\appUpservice\UpService — Decisões fechadas para o primeiro lançamento.md` (v4.0).

## Stack

- Node 22.9+ / Express 5: API em `/api` e o build do front (`web/dist`) no mesmo processo
- MySQL 8 ou MariaDB 10.6+ (Hostinger)
- React + Vite + TypeScript (`web/`)
- Documentos e selfies em pasta privada (`STORAGE_DIR`), só acessíveis por `/api/files/*`, com checagem de acesso e auditoria

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

Com `DEV_LOGIN=1` a tela de login aceita só o e-mail (sem Google). Para testar GPS no desktop: Chrome DevTools → ⋮ → More tools → Sensors → Location.

## Testes

```bash
npm test          # regras puras + integração (precisa de TEST_DATABASE_URL; o banco de teste é apagado e recriado)
npm run typecheck
```

## Perfis

| Perfil | Como é criado | O que faz |
|---|---|---|
| Profissional | Cadastro aberto (login Google) | Cadastro + documentos, vagas por proximidade, candidatura, presença, resumo de diárias |
| Gestor | Admin promove em Usuários e vincula unidades | Vagas e candidaturas das suas unidades, atividades do dia, confirmação da diária, documentos dos seus candidatos |
| Administrador | `npm run make-admin` (o primeiro) ou promoção | Unidades, raio, bloqueio financeiro, usuários e vínculos |

## Deploy na Hostinger (Node.js app)

1. Banco MySQL no hPanel → `DATABASE_URL=mysql://usuario:senha@host:3306/banco`.
2. Variáveis do app: `NODE_ENV=production`, `DATABASE_URL`, `STORAGE_DIR` (pasta **fora** do diretório do deploy, para um redeploy não apagar documentos e selfies), `GOOGLE_CLIENT_ID`, `SMTP_*`, `MAIL_FROM`. **Não** definir `DEV_LOGIN`.
3. Build: `npm install && npm run build`. Start: `npm start`. Rodar `npm run migrate` a cada versão com migration nova.
4. HTTPS é obrigatório: câmera e GPS do navegador não funcionam sem ele.
5. Google Cloud → OAuth Client ID (Web) com origem `https://app.upserviceintermed.com`.

## Fora deste ciclo (Marcos 3–5)

Exceção de GPS aprovada pelo gestor, checkout esquecido/fechamento administrativo, punições (3 faltas → 15 dias), contestação, painel consolidado, CSV, alerta de saída do raio com a página aberta, rate limit.

## Limites conhecidos

- PWA não lê GPS com a página fechada; o painel mostra o status do último registro, não presença contínua.
- GPS do navegador pode ser falsificado; selfie + token único + auditoria reduzem, não eliminam.
- Aviso de fim de pausa por e-mail roda num `setInterval` do processo; se a Hostinger hibernar o app, mover para cron.
