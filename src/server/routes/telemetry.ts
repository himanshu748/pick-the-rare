import { Hono } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';

// Hono equivalent of @devvit/analytics's Express telemetryRouter: the client
// telemetry wrapper posts to /api/telemetry/journey/* and expects the same
// response shapes.
export const telemetryRoutes = new Hono();
telemetryRoutes.post('/journey/start', async c => c.json(await telemetry.startJourney()));
telemetryRoutes.post('/journey/progress', async c => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await telemetry.journeyProgress({
    journeyId: typeof body.journeyId === 'string' ? body.journeyId : '',
    progress: typeof body.progress === 'number' ? body.progress : 0,
    ...(typeof body.action === 'string' ? { action: body.action } : {}),
    ...(typeof body.actionDetails === 'string' ? { actionDetails: body.actionDetails } : {}),
  }));
});
telemetryRoutes.post('/journey/interaction', async c => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await telemetry.journeyInteraction({
    journeyId: typeof body.journeyId === 'string' ? body.journeyId : '',
    action: typeof body.action === 'string' ? body.action : '',
    actionDetails: typeof body.actionDetails === 'string' ? body.actionDetails : '',
  }));
});
telemetryRoutes.post('/journey/end', async c => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await telemetry.endJourney({
    journeyId: typeof body.journeyId === 'string' ? body.journeyId : '',
    complete: body.complete === true,
    ...(typeof body.game === 'object' && body.game !== null ? { game: body.game } : {}),
  }));
});
telemetryRoutes.post('/journey/app-ready', async c => c.json(await telemetry.appReady()));
telemetryRoutes.onError((_error, c) => c.json({ receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Telemetry unavailable.' } }));
