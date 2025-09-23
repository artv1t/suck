import { Router, Request, Response } from 'express';
import { BotManager } from '../../core/botManager.js';
import logger from '../../utils/logger.js';

export function createMetricsRoutes(botManager: BotManager): Router {
  const router = Router();

  // Get comprehensive metrics
  router.get('/', (req: Request, res: Response) => {
    try {
      const metrics = botManager.getMetrics();
      res.json({
        success: true,
        data: metrics,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get metrics'
      });
    }
  });

  // Get performance metrics only
  router.get('/performance', (req: Request, res: Response) => {
    try {
      const status = botManager.getStatus();
      const metrics = botManager.getMetrics();
      
      const performanceMetrics = {
        eventsPerSecond: status.totalEvents / (status.uptime / 1000) || 0,
        memoryUsage: status.memoryUsage,
        cpuUsage: status.cpuUsage,
        uptime: status.uptime,
        totalTrades: status.totalTrades,
        openPositions: status.openPositions,
        totalPnl: status.totalPnl,
        circuitBreakerActive: status.circuitBreakerActive,
        rpc: metrics.rpc,
        filters: metrics.filters,
        trader: metrics.trader
      };

      res.json({
        success: true,
        data: performanceMetrics,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get performance metrics'
      });
    }
  });

  // Get trading metrics only
  router.get('/trading', (req: Request, res: Response) => {
    try {
      const status = botManager.getStatus();
      const positions = botManager.getPositions();
      
      const closedPositions = positions.filter(p => p.status === 'sold');
      const winningTrades = closedPositions.filter(p => (p.pnl || 0) > 0).length;
      const winRate = closedPositions.length > 0 ? (winningTrades / closedPositions.length) * 100 : 0;
      
      const tradingMetrics = {
        totalTrades: status.totalTrades,
        openPositions: status.openPositions,
        totalPnl: status.totalPnl,
        winRate: winRate,
        winningTrades: winningTrades,
        losingTrades: closedPositions.length - winningTrades,
        averageTradeSize: closedPositions.length > 0 
          ? closedPositions.reduce((sum, p) => sum + p.buyAmount, 0) / closedPositions.length 
          : 0
      };

      res.json({
        success: true,
        data: tradingMetrics,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get trading metrics'
      });
    }
  });

  return router;
}