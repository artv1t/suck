import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import { sessionLogger } from '../../logging/sessionLogger.js';
import logger from '../../utils/logger.js';

export function createBotRoutes(botManager: BotManager): Router {
  const router = Router();

  // Bot status and control
  router.get('/status', (req: Request, res: Response) => {
    try {
      const status = botManager.getStatus();
      res.json({
        success: true,
        data: status,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get bot status'
      });
    }
  });

  router.post('/start', async (req: Request, res: Response) => {
    try {
      await botManager.start();
      logger.info('Bot started via API');
      res.json({
        success: true,
        message: 'Bot started successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start bot'
      });
    }
  });

  router.post('/stop', async (req: Request, res: Response) => {
    try {
      await botManager.stop();
      logger.info('Bot stopped via API');
      res.json({
        success: true,
        message: 'Bot stopped successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop bot'
      });
    }
  });

  router.post('/restart', async (req: Request, res: Response) => {
    try {
      await botManager.stop();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      await botManager.start();
      logger.info('Bot restarted via API');
      res.json({
        success: true,
        message: 'Bot restarted successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restart bot'
      });
    }
  });

  // Circuit breaker control
  router.post('/circuit-breaker/reset', (req: Request, res: Response) => {
    try {
      botManager.resetCircuitBreaker();
      logger.info('Circuit breaker reset via API');
      res.json({
        success: true,
        message: 'Circuit breaker reset successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset circuit breaker'
      });
    }
  });

  // Manual token addition
  router.post('/tokens/add', (req: Request, res: Response) => {
    const { mintAddress } = req.body;
    
    if (!mintAddress) {
      return res.status(400).json({
        success: false,
        error: 'Mint address is required'
      });
    }

    try {
      botManager.addManualToken(mintAddress);
      logger.info(`Manual token added via API: ${mintAddress}`);
      res.json({
        success: true,
        message: `Token ${mintAddress} added for processing`,
        data: { mintAddress },
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid mint address'
      });
    }
  });

  router.get('/session/current', (req: Request, res: Response) => {
    try {
      const currentSession = sessionLogger.getCurrentSession();
      if (!currentSession) {
        return res.status(404).json({
          success: false,
          error: 'No active session'
        });
      }
      
      res.json({
        success: true,
        data: currentSession,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Current session error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/session/latest', (req: Request, res: Response) => {
    try {
      const latestSession = sessionLogger.getLatestSession();
      if (!latestSession) {
        return res.status(404).json({
          success: false,
          error: 'No sessions found'
        });
      }
      
      res.json({
        success: true,
        data: latestSession,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Latest session error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/session/:number', (req: Request, res: Response) => {
    try {
      const sessionNumber = parseInt(req.params.number, 10);
      if (isNaN(sessionNumber)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid session number'
        });
      }
      
      const session = sessionLogger.getSessionByNumber(sessionNumber);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: `Session ${sessionNumber} not found`
        });
      }
      
      res.json({
        success: true,
        data: session,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Session by number error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/sessions/all', (req: Request, res: Response) => {
    try {
      const sessions = sessionLogger.getAllSessions();
      res.json({
        success: true,
        data: sessions,
        count: sessions.length,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('All sessions error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}
