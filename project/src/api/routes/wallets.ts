import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import logger from '../../utils/logger.js';

export function createWalletsRoutes(botManager: BotManager): Router {
  const router = Router();

  // Get all wallet info
  router.get('/', (req: Request, res: Response) => {
    try {
      const walletInfo = botManager.getWalletInfo();
      res.json({
        success: true,
        data: walletInfo,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get wallet info'
      });
    }
  });

  // Get specific wallet info
  router.get('/:name', (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const walletInfo = botManager.getWalletInfo(name);
      
      if (!walletInfo) {
        return res.status(404).json({
          success: false,
          error: 'Wallet not found'
        });
      }

      res.json({
        success: true,
        data: walletInfo,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get wallet info'
      });
    }
  });

  // Create new wallet
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { name, encrypt = true } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'Wallet name is required'
        });
      }

      const publicKey = await botManager.createWallet(name, encrypt);
      logger.info(`New wallet created via API: ${name}`);
      
      res.json({
        success: true,
        data: { name, publicKey },
        message: `Wallet ${name} created successfully`,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create wallet'
      });
    }
  });

  return router;
}