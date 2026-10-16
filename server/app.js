import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { isBlocked, loadUser } from './auth.js';
import { HttpError, fail } from './http.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import dashboard from './routes/dashboard.js';
import estrelas from './routes/estrelas.js';
import files from './routes/files.js';
import jobs from './routes/jobs.js';
import login from './routes/login.js';
import penalties from './routes/penalties.js';
import presence from './routes/presence.js';
import reports from './routes/reports.js';
import whatsapp from './routes/whatsapp.js';
import worker from './routes/worker.js';

const dist = fileURLToPath(new URL('../web/dist/', import.meta.url));

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  req.id = randomUUID();
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
  });
  next();
});

// Limites de corpo por rota: documentos (até 5 MB em base64), selfies (até 500 KB), resto pequeno.
app.post('/api/me/documents', express.json({ limit: '8mb' }));
app.post('/api/sessions/:id/events', express.json({ limit: '1mb' }));
app.post('/api/sessions/:id/exceptions', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));

// Bloqueado só vê o próprio histórico, contesta e sai; todo o resto é recusado.
const BLOCKED_ALLOWED = new Set(['/me', '/me/occurrences', '/me/contestations', '/auth/logout', '/config']);
const restrictBlocked = (req, res, next) => {
  if (req.user && isBlocked(req.user) && !BLOCKED_ALLOWED.has(req.path)) fail(403, 'Conta bloqueada. Veja o motivo e conteste no menu Ocorrências.');
  next();
};

// Respostas da API nunca ficam em cache (navegador nem CDN da Hostinger): depois de salvar, a tela recarrega dados novos.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', loadUser, restrictBlocked, auth, login, worker, jobs, presence, penalties, reports, dashboard, estrelas, admin, whatsapp, files);
app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado.' }));

app.use(express.static(dist));
app.get('/{*path}', (req, res, next) => res.sendFile('index.html', { root: dist }, (e) => e && next()));

app.use((err, req, res, next) => {
  if (err instanceof HttpError || (err.status && err.expose)) return res.status(err.status).json({ error: err.message });
  console.error(req.id, err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});
