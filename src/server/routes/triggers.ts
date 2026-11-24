import { Hono } from 'hono';
import { dailyTick } from '../core/post';
export const triggers = new Hono();
triggers.post('/on-app-install',async c=> {
  try { return c.json({status:'ok',postId:await dailyTick()}); }
  catch { return c.json({status:'error',message:'Round setup requires inspection.'},500); }
});
