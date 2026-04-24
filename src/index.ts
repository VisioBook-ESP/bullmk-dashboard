import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { natsRouter } from './nats-routes.js';
import { startNatsMonitor, isNatsConnected } from './nats-monitor.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  db: parseInt(process.env.REDIS_DB || '0', 10),
};

const queueNames = (process.env.BULL_QUEUES || 'project-workflow')
  .split(',')
  .map((q) => q.trim())
  .filter(Boolean);

const queues = queueNames.map(
  (name) => new Queue(name, { connection }),
);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/bull');

createBullBoard({
  queues: queues.map((q) => new BullMQAdapter(q)),
  serverAdapter,
});

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', nats: isNatsConnected() });
});

app.use(natsRouter);
app.use('/bull', serverAdapter.getRouter());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BullMQ Dashboard running on http://0.0.0.0:${PORT}`);
  console.log(`Monitoring queues: ${queueNames.join(', ')}`);
  console.log(`Redis: ${connection.host}:${connection.port}/${connection.db}`);
  void startNatsMonitor();
});
