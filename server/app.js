import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadUser } from './auth.js';
import { HttpError } from './http.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import files from './routes/files.js';
import jobs from './routes/jobs.js';
import presence from './routes/presence.js';
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
app.use(express.json({ limit: '100kb' }));

app.use('/api', loadUser, auth, worker, jobs, presence, admin, files);
app.use('/api', (req, res) => res.status(404).json({ error: 'Não encontrado.' }));

app.use(express.static(dist));
app.get('/{*path}', (req, res, next) => res.sendFile('index.html', { root: dist }, (e) => e && next()));

app.use((err, req, res, next) => {
  if (err instanceof HttpError || (err.status && err.expose)) return res.status(err.status).json({ error: err.message });
  console.error(req.id, err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});
