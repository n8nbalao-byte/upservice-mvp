import { app } from './app.js';
import { sweepBreaks } from './routes/presence.js';

if (process.env.NODE_ENV === 'production' && process.env.DEV_LOGIN === '1') console.warn('DEV_LOGIN ignorado em produção.');

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`UpService ouvindo em http://localhost:${port}`));

setInterval(() => sweepBreaks().catch((e) => console.error('sweepBreaks', e.message)), 60_000);
