import { Router, Request, Response } from 'express';
import { HealthMonitor } from '../../monitoring/healthMonitor.js';
import logger from '../../utils/logger.js';

export function createHealthRoutes(healthMonitor: HealthMonitor): Router {
  const router = Router();

  // Get system health
  router.get('/', (req: Request, res: Response) => {
    try {
      const health = healthMonitor.getSystemHealth();
      res.json({
        success: true,
        data: health,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get system health'
      });
    }
  });

  // Get health summary
  router.get('/summary', (req: Request, res: Response) => {
    try {
      const summary = healthMonitor.getHealthSummary();
      res.json({
        success: true,
        data: summary,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get health summary'
      });
    }
  });

  // Get alerts
  router.get('/alerts', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const resolved = req.query.resolved === 'true';
      const alerts = healthMonitor.getAlerts(limit, resolved);
      
      res.json({
        success: true,
        data: alerts,
        count: alerts.length,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get alerts'
      });
    }
  });

  // Resolve alert
  router.post('/alerts/:alertId/resolve', (req: Request, res: Response) => {
    try {
      const { alertId } = req.params;
      const resolved = healthMonitor.resolveAlert(alertId);
      
      if (!resolved) {
        return res.status(404).json({
          success: false,
          error: 'Alert not found or already resolved'
        });
      }

      res.json({
        success: true,
        message: 'Alert resolved successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve alert'
      });
    }
  });

  // Get metrics history
  router.get('/metrics/:metricName', (req: Request, res: Response) => {
    try {
      const { metricName } = req.params;
      const hours = parseInt(req.query.hours as string) || 24;
      const history = healthMonitor.getMetricsHistory(metricName, hours);
      
      res.json({
        success: true,
        data: history,
        count: history.length,
        metricName,
        hours,
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get metrics history'
      });
    }
  });

  return router;
}