import { Server as SocketIOServer, Socket } from 'socket.io';
import { EventBus } from '../../core/eventBus.js';
import { BotManager } from '../../core/botManager.js';
import { TokenEvent, TradeEvent, FilterResult, PerformanceMetrics } from '../../types/index.js';
import logger from '../../utils/logger.js';

interface SocketClient {
  id: string;
  subscriptions: Set<string>;
  lastActivity: number;
  authenticated: boolean;
  rateLimitCount: number;
  rateLimitReset: number;
}

/**
 * WebSocket Manager for real-time updates
 * Handles client connections, subscriptions, and real-time data streaming
 */
export class SocketManager {
  private io: SocketIOServer;
  private eventBus: EventBus;
  private botManager: BotManager;
  private clients = new Map<string, SocketClient>();
  private readonly RATE_LIMIT = 100; // messages per minute
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute

  constructor(io: SocketIOServer, botManager: BotManager) {
    this.io = io;
    this.eventBus = EventBus.getInstance();
    this.botManager = botManager;
    
    this.setupSocketHandlers();
    this.setupEventForwarding();
    this.startPeriodicUpdates();
    this.startClientCleanup();
  }

  /**
   * Setup socket connection handlers
   */
  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const clientId = socket.id;
      
      // Initialize client
      this.clients.set(clientId, {
        id: clientId,
        subscriptions: new Set(),
        lastActivity: Date.now(),
        authenticated: false,
        rateLimitCount: 0,
        rateLimitReset: Date.now() + 60000
      });

      logger.info(`🔌 WebSocket client connected: ${clientId}`);

      // Authentication
      socket.on('authenticate', (data) => {
        this.handleAuthentication(socket, data);
      });

      // Subscription management
      socket.on('subscribe', (data) => {
        this.handleSubscription(socket, data);
      });

      socket.on('unsubscribe', (data) => {
        this.handleUnsubscription(socket, data);
      });

      // Data requests
      socket.on('get_bot_status', () => {
        this.handleDataRequest(socket, 'bot_status');
      });

      socket.on('get_positions', () => {
        this.handleDataRequest(socket, 'positions');
      });

      socket.on('get_metrics', () => {
        this.handleDataRequest(socket, 'metrics');
      });

      socket.on('get_trading_history', (data) => {
        this.handleDataRequest(socket, 'trading_history', data);
      });

      // Bot control (authenticated only)
      socket.on('bot_start', () => {
        this.handleBotControl(socket, 'start');
      });

      socket.on('bot_stop', () => {
        this.handleBotControl(socket, 'stop');
      });

      socket.on('add_token', (data) => {
        this.handleAddToken(socket, data);
      });

      // Paper trading controls
      socket.on('paper_buy', (data) => {
        this.handlePaperTrade(socket, 'buy', data);
      });

      socket.on('paper_sell', (data) => {
        this.handlePaperTrade(socket, 'sell', data);
      });

      // Disconnect handler
      socket.on('disconnect', () => {
        this.handleDisconnect(clientId);
      });

      // Send initial data
      this.sendInitialData(socket);
    });
  }

  /**
   * Handle client authentication
   */
  private handleAuthentication(socket: Socket, data: any): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    try {
      const { apiKey } = data;
      
      if (apiKey && (apiKey === 'test-api-key-123' || apiKey === 'admin-api-key-456')) {
        client.authenticated = true;
        socket.emit('authenticated', { success: true });
        logger.info(`🔐 WebSocket client authenticated: ${socket.id}`);
      } else {
        socket.emit('authenticated', { success: false, message: 'Invalid API key' });
      }
    } catch (error) {
      socket.emit('error', { message: 'Authentication failed' });
    }

    client.lastActivity = Date.now();
  }

  /**
   * Handle subscription requests
   */
  private handleSubscription(socket: Socket, data: any): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { channels } = data;
    if (!Array.isArray(channels)) {
      socket.emit('error', { message: 'Invalid subscription data' });
      return;
    }

    const validChannels = [
      'bot_status', 'positions', 'trades', 'tokens', 'filters', 
      'metrics', 'performance', 'safety', 'paper_trading'
    ];

    for (const channel of channels) {
      if (validChannels.includes(channel)) {
        client.subscriptions.add(channel);
      }
    }

    socket.emit('subscribed', { 
      channels: Array.from(client.subscriptions),
      timestamp: Date.now()
    });

    client.lastActivity = Date.now();
    logger.info(`📡 Client ${socket.id} subscribed to: ${channels.join(', ')}`);
  }

  /**
   * Handle unsubscription requests
   */
  private handleUnsubscription(socket: Socket, data: any): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    const { channels } = data;
    if (!Array.isArray(channels)) return;

    for (const channel of channels) {
      client.subscriptions.delete(channel);
    }

    socket.emit('unsubscribed', { 
      channels,
      remaining: Array.from(client.subscriptions),
      timestamp: Date.now()
    });

    client.lastActivity = Date.now();
  }

  /**
   * Handle data requests
   */
  private handleDataRequest(socket: Socket, type: string, params?: any): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    try {
      let data;
      
      switch (type) {
        case 'bot_status':
          data = this.botManager.getStatus();
          break;
        case 'positions':
          data = this.botManager.getOpenPositions();
          break;
        case 'metrics':
          data = this.botManager.getMetrics();
          break;
        case 'trading_history':
          const limit = params?.limit || 50;
          data = this.botManager.getRecentTrades(limit);
          break;
        default:
          socket.emit('error', { message: 'Unknown data type' });
          return;
      }

      socket.emit(type, {
        success: true,
        data,
        timestamp: Date.now()
      });
    } catch (error) {
      socket.emit('error', { 
        message: `Failed to get ${type}`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    client.lastActivity = Date.now();
  }

  /**
   * Handle bot control commands
   */
  private async handleBotControl(socket: Socket, action: string): Promise<void> {
    const client = this.clients.get(socket.id);
    if (!client || !client.authenticated) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    try {
      switch (action) {
        case 'start':
          await this.botManager.start();
          socket.emit('bot_control_result', { 
            action, 
            success: true, 
            message: 'Bot started successfully' 
          });
          break;
        case 'stop':
          await this.botManager.stop();
          socket.emit('bot_control_result', { 
            action, 
            success: true, 
            message: 'Bot stopped successfully' 
          });
          break;
        default:
          socket.emit('error', { message: 'Unknown bot action' });
      }
    } catch (error) {
      socket.emit('bot_control_result', { 
        action, 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    client.lastActivity = Date.now();
  }

  /**
   * Handle add token requests
   */
  private handleAddToken(socket: Socket, data: any): void {
    const client = this.clients.get(socket.id);
    if (!client || !client.authenticated) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { mintAddress } = data;
    if (!mintAddress) {
      socket.emit('error', { message: 'Mint address required' });
      return;
    }

    try {
      this.botManager.addManualToken(mintAddress);
      socket.emit('token_added', { 
        success: true, 
        mintAddress,
        timestamp: Date.now()
      });
    } catch (error) {
      socket.emit('error', { 
        message: 'Failed to add token',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    client.lastActivity = Date.now();
  }

  /**
   * Handle paper trading requests
   */
  private async handlePaperTrade(socket: Socket, type: 'buy' | 'sell', data: any): Promise<void> {
    const client = this.clients.get(socket.id);
    if (!client) return;

    if (!this.checkRateLimit(client)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const { mintAddress, amount, reason } = data;
    if (!mintAddress || !amount) {
      socket.emit('error', { message: 'Mint address and amount required' });
      return;
    }

    try {

      socket.emit('paper_trade_result', {
        success: false,
        type,
        error: 'Paper trading has been removed - only live trading is supported',
        timestamp: Date.now()
      });
    } catch (error) {
      socket.emit('paper_trade_result', {
        success: false,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
    }

    client.lastActivity = Date.now();
  }

  /**
   * Send initial data to new clients
   */
  private sendInitialData(socket: Socket): void {
    try {
      socket.emit('bot_status', {
        success: true,
        data: this.botManager.getStatus(),
        timestamp: Date.now()
      });

      socket.emit('positions', {
        success: true,
        data: this.botManager.getOpenPositions(),
        timestamp: Date.now()
      });

      socket.emit('metrics', {
        success: true,
        data: this.botManager.getMetrics(),
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Failed to send initial data:', error);
    }
  }

  /**
   * Setup event forwarding from EventBus to WebSocket clients
   */
  private setupEventForwarding(): void {
    // Token detection events
    this.eventBus.on('token_detected', (tokenEvent: TokenEvent) => {
      this.broadcastToSubscribers('tokens', 'token_detected', {
        success: true,
        data: tokenEvent,
        timestamp: Date.now()
      });
    });

    // Trade events
    this.eventBus.on('trade_event', (tradeEvent: TradeEvent) => {
      this.broadcastToSubscribers('trades', 'trade_event', {
        success: true,
        data: tradeEvent,
        timestamp: Date.now()
      });
    });

    // Filter results
    this.eventBus.on('filter_result', (filterResult: { mintAddress: string; result: FilterResult }) => {
      this.broadcastToSubscribers('filters', 'filter_result', {
        success: true,
        data: filterResult,
        timestamp: Date.now()
      });
    });

    // Performance metrics
    this.eventBus.on('performance_metric', (metrics: Partial<PerformanceMetrics>) => {
      this.broadcastToSubscribers('performance', 'performance_metric', {
        success: true,
        data: metrics,
        timestamp: Date.now()
      });
    });
  }

  /**
   * Start periodic updates for subscribed clients
   */
  private startPeriodicUpdates(): void {
    // Bot status updates every 5 seconds
    setInterval(() => {
      this.broadcastToSubscribers('bot_status', 'bot_status_update', {
        success: true,
        data: this.botManager.getStatus(),
        timestamp: Date.now()
      });
    }, 5000);

    // Position updates every 10 seconds
    setInterval(() => {
      this.broadcastToSubscribers('positions', 'positions_update', {
        success: true,
        data: this.botManager.getOpenPositions(),
        timestamp: Date.now()
      });
    }, 10000);

    // Metrics updates every 15 seconds
    setInterval(() => {
      this.broadcastToSubscribers('metrics', 'metrics_update', {
        success: true,
        data: this.botManager.getMetrics(),
        timestamp: Date.now()
      });
    }, 15000);
  }

  /**
   * Start client cleanup process
   */
  private startClientCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastActivity > timeout) {
          this.clients.delete(clientId);
          logger.info(`🧹 Cleaned up inactive WebSocket client: ${clientId}`);
        }
      }
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Broadcast message to subscribers of a specific channel
   */
  private broadcastToSubscribers(channel: string, event: string, data: any): void {
    for (const [socketId, client] of this.clients.entries()) {
      if (client.subscriptions.has(channel)) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, data);
        }
      }
    }
  }

  /**
   * Check rate limit for client
   */
  private checkRateLimit(client: SocketClient): boolean {
    const now = Date.now();
    
    if (now > client.rateLimitReset) {
      client.rateLimitCount = 0;
      client.rateLimitReset = now + 60000; // Reset every minute
    }

    if (client.rateLimitCount >= this.RATE_LIMIT) {
      return false;
    }

    client.rateLimitCount++;
    return true;
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    this.clients.delete(clientId);
    logger.info(`🔌 WebSocket client disconnected: ${clientId}`);
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    totalSubscriptions: number;
    channelStats: Record<string, number>;
  } {
    const channelStats: Record<string, number> = {};
    let totalSubscriptions = 0;
    let authenticatedConnections = 0;

    for (const client of this.clients.values()) {
      if (client.authenticated) {
        authenticatedConnections++;
      }
      
      totalSubscriptions += client.subscriptions.size;
      
      for (const channel of client.subscriptions) {
        channelStats[channel] = (channelStats[channel] || 0) + 1;
      }
    }

    return {
      totalConnections: this.clients.size,
      authenticatedConnections,
      totalSubscriptions,
      channelStats
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clients.clear();
  }
}
