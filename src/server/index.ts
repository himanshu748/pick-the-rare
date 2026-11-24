import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { dailyTick } from './core/post';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { telemetryRoutes } from './routes/telemetry';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/forms', forms);
internal.post('/scheduler/daily', async c => {
  try { return c.json({ status: 'ok', postId: await dailyTick() }); }
  catch { return c.json({ status: 'error' }, 500); }
});
internal.route('/triggers', triggers);

app.route('/api/telemetry', telemetryRoutes);
app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
