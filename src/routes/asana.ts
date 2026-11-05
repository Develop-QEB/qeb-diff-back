import { Router } from 'express';
import { AsanaNotConfiguredError, fetchAsanaTask } from '../lib/asana.js';

const router = Router();

router.get('/task/:gid', async (req, res, next) => {
  try {
    const gid = String(req.params.gid);
    const task = await fetchAsanaTask(gid);
    if (!task) {
      res.status(404).json({ error: 'tarea no encontrada o sin acceso' });
      return;
    }
    res.json(task);
  } catch (e) {
    if (e instanceof AsanaNotConfiguredError) {
      res.status(503).json({ error: e.message, code: 'asana_not_configured' });
      return;
    }
    next(e);
  }
});

export default router;
