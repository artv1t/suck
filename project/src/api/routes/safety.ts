import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import logger from '../../utils/logger.js';

export function createSafetyRoutes(botManager: BotManager): Router {
  const router = Router();

  // Get safety status
  router.get('/status', (req: Request, res: Response) => {
    try {
      const safetyStatus = botManager.getSafetyStatus();
      res.json({
        success: true,
        data: safetyStatus,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get safety status'
      });
    }
  });

  // Enable live trading
  router.post('/enable-live-trading', async (req: Request, res: Response) => {
    try {
      const result = await botManager.enableLiveTrading();
      logger.info('Live trading enabled via API');
      
      res.json({
        success: result.success,
        message: result.message,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enable live trading'
      });
    }
  });

  // Disable live trading
  router.post('/disable-live-trading', (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      botManager.disableLiveTrading(reason || 'Manual disable via API');
      
      res.json({
        success: true,
        message: 'Live trading disabled successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable live trading'
      });
    }
  });

  // Reset emergency stop
  router.post('/reset-emergency-stop', (req: Request, res: Response) => {
    try {
      const result = botManager.resetEmergencyStop();
      logger.info('Emergency stop reset via API');
      
      res.json({
        success: result.success,
        message: result.message,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset emergency stop'
      });
    }
  });

  // Get safety logs
  router.get('/logs', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = botManager.getSafetyLogs(limit);
      
      res.json({
        success: true,
        data: logs,
        count: logs.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get safety logs'
      });
    }
  });

  return router;
}