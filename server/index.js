import { app } from './app.js';
import { backupIfDue } from './backup.js';
import { sweep } from './routes/presence.js';

if (process.env.NODE_ENV === 'production' && process.env.DEV_LOGIN === '1') console.warn('DEV_LOGIN ignorado em produção.');

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`UpService ouvindo em http://localhost:${port}`));

setInterval(() => sweep().catch((e) => console.error('sweep', e.message)), 60_000);

if (process.env.NODE_ENV === 'production') {
  // ponytail: backup diário dentro do app (a hospedagem não oferece crontab por SSH); se o app ficar dias sem tráfego, agendar no cron do hPanel.
  const backup = () => backupIfDue().catch((e) => console.error('backup', e.message));
  setTimeout(backup, 2 * 60_000);
  setInterval(backup, 60 * 60_000);
}
