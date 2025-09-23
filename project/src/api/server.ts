import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { EventBus } from '../core/eventBus.js';
import { BotManager } from '../core/botManager.js';
import { SecurityMiddleware } from '../api/middleware/security.js';
import { SocketManager } from './websocket/socketManager.js';
import { createBotRoutes } from './routes/bot.js';
import { createPositionsRoutes } from './routes/positions.js';
import { createTradingRoutes } from './routes/trading.js';
import { createMetricsRoutes } from './routes/metrics.js';
import { createWalletsRoutes } from './routes/wallets.js';
import { createSafetyRoutes } from './routes/safety.js';
import { createHealthRoutes } from './routes/health.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export class APIServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private botManager: BotManager;
  private eventBus: EventBus;
  private securityMiddleware: SecurityMiddleware;
  private socketManager: SocketManager;

  constructor(botManager: BotManager) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    this.botManager = botManager;
    this.eventBus = EventBus.getInstance();
    this.securityMiddleware = new SecurityMiddleware();
    this.socketManager = new SocketManager(this.io, this.botManager);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Security middleware (order matters!)
    this.app.use(this.securityMiddleware.securityHeaders());
    this.app.use(this.securityMiddleware.checkBlocked());
    this.app.use(this.securityMiddleware.requestLogging());
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(this.securityMiddleware.validateInput());
    this.app.use(this.securityMiddleware.rateLimit('api'));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      const status = this.botManager.getStatus();
      const metrics = this.botManager.getMetrics();
      
      res.json({
        status: 'ok',
        bot: status,
        paper: metrics.paper || null,
        timestamp: Date.now()
      });
    });

    // API Routes
    this.app.use('/api/bot', createBotRoutes(this.botManager));
    this.app.use('/api/positions', createPositionsRoutes(this.botManager));
    this.app.use('/api/trading', createTradingRoutes(this.botManager));
    this.app.use('/api/metrics', createMetricsRoutes(this.botManager));
    this.app.use('/api/wallets', createWalletsRoutes(this.botManager));
    this.app.use('/api/safety', createSafetyRoutes(this.botManager));
    this.app.use('/api/health', createHealthRoutes(this.botManager.getHealthMonitor()));

    // Security endpoints
    this.app.get('/api/security/status', this.securityMiddleware.requireApiKey('admin'), (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'active',
          timestamp: Date.now()
        }
      });
    });

    // Configuration
    this.app.get('/api/config', (_req, res) => {
      res.json(config);
    });

    this.app.post('/api/config', (_req, res) => {
      // In a real implementation, you would update the configuration
      res.json({ success: true, message: 'Configuration updated' });
    });
    
    // WebSocket stats endpoint
    this.app.get('/api/websocket/stats', (req, res) => {
      const stats = this.socketManager.getStats();
      res.json({
        success: true,
        data: stats,
        timestamp: Date.now()
      });
    });
  }

  async start(port: number = 3001): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        logger.info(`API server started on port ${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.socketManager.destroy();
      this.server.close(() => {
        logger.info('API server stopped');
        resolve();
      });
    });
  }
}