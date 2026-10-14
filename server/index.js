import { app } from './app.js';
import { sweep } from './routes/presence.js';

if (process.env.NODE_ENV === 'production' && process.env.DEV_LOGIN === '1') console.warn('DEV_LOGIN ignorado em produção.');

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`UpService ouvindo em http://localhost:${port}`));

setInterval(() => sweep().catch((e) => console.error('sweep', e.message)), 60_000);
