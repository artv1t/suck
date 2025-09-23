import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import logger from '../../utils/logger.js';

export function createTradingRoutes(botManager: BotManager): Router {
  const router = Router();

  // Get trading history
  router.get('/history', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = botManager.getRecentTrades(limit);
      res.json({
        success: true,
        data: trades,
        count: trades.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get trading history'
      });
    }
  });

  // Execute paper buy
  router.post('/paper/buy', async (req: Request, res: Response) => {
    try {
      const { mintAddress, amount } = req.body;
      
      if (!mintAddress || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Mint address and amount are required'
        });
      }

      res.status(400).json({
        success: false,
        error: 'Paper trading has been removed - only live trading is supported',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute paper buy'
      });
    }
  });

  // Execute paper sell
  router.post('/paper/sell', async (req: Request, res: Response) => {
    try {
      const { mintAddress, amount, reason } = req.body;
      
      if (!mintAddress || !amount) {
        return res.status(400).json({
          success: false,
          error: 'Mint address and amount are required'
        });
      }

      res.status(400).json({
        success: false,
        error: 'Paper trading has been removed - only live trading is supported',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute paper sell'
      });
    }
  });

  return router;
}
