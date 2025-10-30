import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // ✅ Trigger manual sync
  router.post('/sync', async (req: Request, res: Response) => {
    try {
      const online = await syncService.checkConnectivity();
      if (!online) {
        return res.status(503).json({ error: 'No internet connection' });
      }

      const result = await syncService.sync();
      res.json({
        message: 'Sync completed',
        result
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync data' });
    }
  });

  // ✅ Sync status
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const pending = await syncService.getPendingCount();
      const lastSync = await syncService.getLastSyncTime();
      const online = await syncService.checkConnectivity();

      res.json({
        pendingSyncTasks: pending,
        lastSync: lastSync || null,
        online
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get sync status' });
    }
  });

  // ✅ Batch sync (server-side support)
  router.post('/batch', async (req: Request, res: Response) => {
    res.status(200).json({
      message: 'Batch sync endpoint for server — client doesn’t use this directly'
    });
  });

  // ✅ Health check endpoint
  router.get('/health', async (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  return router;
}
