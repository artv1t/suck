import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import logger from '../../utils/logger.js';

export function createPositionsRoutes(botManager: BotManager): Router {
  const router = Router();

  // Get all positions
  router.get('/', (req: Request, res: Response) => {
    try {
      const positions = botManager.getPositions();
      res.json({
        success: true,
        data: positions,
        count: positions.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get positions'
      });
    }
  });

  // Get open positions only
  router.get('/open', (req: Request, res: Response) => {
    try {
      const positions = botManager.getOpenPositions();
      res.json({
        success: true,
        data: positions,
        count: positions.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get open positions'
      });
    }
  });

  // Get position by mint address
  router.get('/:mintAddress', (req: Request, res: Response) => {
    try {
      const { mintAddress } = req.params;
      const positions = botManager.getPositions();
      const position = positions.find(p => p.mintAddress === mintAddress);
      
      if (!position) {
        return res.status(404).json({
          success: false,
          error: 'Position not found'
        });
      }

      res.json({
        success: true,
        data: position,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get position'
      });
    }
  });

  return router;
}