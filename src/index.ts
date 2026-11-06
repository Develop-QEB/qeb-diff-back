import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import branches from './routes/branches.js';
import schema from './routes/schema.js';
import anomalies from './routes/anomalies.js';
import ignored from './routes/ignored.js';
import diagnostico from './routes/diagnostico.js';
import auth from './routes/auth.js';
import asana from './routes/asana.js';
import huerfanas from './routes/huerfanas.js';
import carasColgadas from './routes/caras-colgadas.js';
import logs from './routes/logs.js';
import { requireAuth } from './lib/auth.js';

const app = express();

if (config.corsOrigins.length > 0) {
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`origen no permitido: ${origin}`));
      },
      credentials: false,
    })
  );
} else {
  app.use(cors());
}

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'qeb-diff', port: config.port }));
app.use('/api/auth', auth);
app.use('/api', requireAuth);
app.use('/api/branches', branches);
app.use('/api/schema', schema);
app.use('/api/anomalies', anomalies);
app.use('/api/ignored', ignored);
app.use('/api/diagnostico', diagnostico);
app.use('/api/asana', asana);
app.use('/api/huerfanas', huerfanas);
app.use('/api/caras-colgadas', carasColgadas);
app.use('/api/logs', logs);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[qeb-diff]', err);
  res.status(400).json({ error: err?.message ?? String(err) });
});

app.listen(config.port, () => {
  console.log(
    `qeb-diff backend en http://localhost:${config.port} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})` +
      (config.corsOrigins.length ? ` · CORS: ${config.corsOrigins.join(', ')}` : ' · CORS: abierto')
  );
});
