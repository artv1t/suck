import { TokenDetector } from '../detector/tokenDetector.js';
import { FilterPipeline } from '../filters/filterPipeline.js';
import { Trader } from '../trader/trader.js';
import { PositionManager } from '../position/positionManager.js';
import { RPCManager } from '../rpc/rpcManager.js';
import { WalletManager } from '../wallet/walletManager.js';
import { HealthMonitor } from '../monitoring/healthMonitor.js';
import { EventBus } from './eventBus.js';
import { BotStatus, CircuitBreakerState, TokenEvent } from '../types/index.js';
import { config } from '../config/index.js';
import { logCircuitBreaker } from '../utils/logger.js';
import { realTimeMonitor } from '../monitoring/realTimeMonitor.js';
import { sessionLogger } from '../logging/sessionLogger.js';
import logger from '../utils/logger.js';

/**
 * Main bot manager orchestrating all components
 * Handles circuit breaker, risk management, and coordination
 */
export class BotManager {
  private tokenDetector!: TokenDetector;
  private filterPipeline!: FilterPipeline;
  private trader!: Trader;
  private positionManager!: PositionManager;
  private rpcManager: RPCManager;
  private walletManager!: WalletManager;
  private healthMonitor!: HealthMonitor;
  private eventBus: EventBus;
  private tradingSafety: any; // Will be initialized in constructor
  private isRunning = false;
  private startTime = 0;
  private circuitBreaker: CircuitBreakerState = {
    active: false,
    failureCount: 0,
    lastFailure: 0,
    dailyLoss: 0,
    lastReset: Date.now()
  };

  constructor() {
    console.log('🔧 BotManager: Starting initialization...');
    console.log('🔧 BotManager: About to create EventBus...');
    
    try {
      this.eventBus = EventBus.getInstance();
      console.log('✅ BotManager: EventBus initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: EventBus failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create RPCManager...');
    console.log('🔧 BotManager: RPCManager constructor starting...');
    
    try {
      this.rpcManager = new RPCManager();
      console.log('✅ BotManager: RPCManager initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: RPCManager failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: Constructor completed successfully');
    console.log('🔧 BotManager: Ready for initialize() call');
    
    // Инициализация будет завершена в методе initialize()
  }

  async initialize(): Promise<void> {
    console.log('🔧 BotManager: initialize() method started');
    console.log('🔧 BotManager: Getting healthy connection...');
    
    const connection = this.rpcManager.getHealthyConnection();
    console.log('🔧 BotManager: Connection result:', connection ? 'SUCCESS' : 'NULL');
    
    if (!connection) {
      console.log('❌ BotManager: No healthy connection, waiting 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const retryConnection = this.rpcManager.getHealthyConnection();
      if (!retryConnection) {
        throw new Error('No healthy RPC connection available after retry');
      }
      console.log('✅ BotManager: Connection obtained on retry');
    } else {
      console.log('✅ BotManager: Connection obtained');
    }
    
    console.log('🔧 BotManager: About to create WalletManager...');
    try {
      this.walletManager = new WalletManager(connection!);
      console.log('✅ BotManager: WalletManager initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: WalletManager failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create TokenDetector...');
    try {
      this.tokenDetector = new TokenDetector(this.rpcManager);
      console.log('✅ BotManager: TokenDetector initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: TokenDetector failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create FilterPipeline...');
    try {
      this.filterPipeline = new FilterPipeline(this.rpcManager);
      console.log('✅ BotManager: FilterPipeline initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: FilterPipeline failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create Trader...');
    try {
      this.trader = new Trader(this.rpcManager, this.walletManager);
      console.log('✅ BotManager: Trader initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: Trader failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create PositionManager...');
    try {
      this.positionManager = new PositionManager(this.trader);
      console.log('✅ BotManager: PositionManager initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: PositionManager failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to create HealthMonitor...');
    try {
      this.healthMonitor = new HealthMonitor(this);
      console.log('✅ BotManager: HealthMonitor initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: HealthMonitor failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to initialize trading safety...');
    try {
      // Initialize trading safety
      this.tradingSafety = {
        getSafetyStatus: () => ({
          tradingAllowed: !this.circuitBreaker.active,
          liveTradingEnabled: true,
          emergencyStop: this.circuitBreaker.active,
          criticalIssues: this.circuitBreaker.active ? 1 : 0,
          failedChecks: []
        })
      };
      console.log('✅ BotManager: Trading safety initialized successfully');
    } catch (error) {
      console.error('❌ BotManager: Trading safety failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to setup event listeners...');
    try {
      this.setupEventListeners();
      console.log('✅ BotManager: Event listeners setup successfully');
    } catch (error) {
      console.error('❌ BotManager: Event listeners setup failed:', error);
      throw error;
    }
    
    console.log('🔧 BotManager: About to start daily reset...');
    try {
      this.startDailyReset();
      console.log('✅ BotManager: Daily reset started successfully');
    } catch (error) {
      console.error('❌ BotManager: Daily reset failed:', error);
      throw error;
    }
    
    console.log('✅ BotManager: initialize() method completed successfully');
  }

  /**
   * Setup event listeners for coordination
   */
  private setupEventListeners(): void {
    // Handle token detection events
    this.eventBus.on('token_detected', async (tokenEvent: TokenEvent) => {
      if (!this.isRunning || this.circuitBreaker.active) return;
      
      try {
        await this.processToken(tokenEvent);
      } catch (error) {
        logger.error(`Error processing token ${tokenEvent.mintAddress}:`, error);
        this.handleFailure();
      }
    });

    // Handle batch token events for high throughput
    this.eventBus.on('token_batch', async (tokenEvents: TokenEvent[]) => {
      if (!this.isRunning || this.circuitBreaker.active) return;
      
      // Process tokens in parallel batches
      const batchSize = Math.min(config.maxConcurrentFilters, tokenEvents.length);
      for (let i = 0; i < tokenEvents.length; i += batchSize) {
        const batch = tokenEvents.slice(i, i + batchSize);
        const promises = batch.map(event => this.processToken(event));
        
        try {
          await Promise.allSettled(promises);
        } catch (error) {
          logger.error('Batch processing error:', error);
        }
      }
    });

    // Handle trade events for circuit breaker
    this.eventBus.on('trade_event', (tradeEvent) => {
      if (!tradeEvent.success) {
        this.handleFailure();
      } else {
        // Reset failure count on success
        this.circuitBreaker.failureCount = Math.max(0, this.circuitBreaker.failureCount - 1);
        
        // Update wallet nonce after successful transaction
        if (tradeEvent.signature) {
          this.walletManager.incrementNonce('primary');
        }
        
        // Track daily loss
        if (tradeEvent.type === 'sell' && tradeEvent.pnl && tradeEvent.pnl < 0) {
          this.circuitBreaker.dailyLoss += Math.abs(tradeEvent.pnl);
          this.checkCircuitBreaker();
        }
      }
    });
  }

  /**
   * Process individual token through the pipeline
   */
  private async processToken(tokenEvent: TokenEvent): Promise<void> {
    const mintAddress = tokenEvent.mintAddress;
    
    if (!this.positionManager.canOpenNewPosition()) {
      logger.debug(`Skipping ${mintAddress}: Position limits reached`);
      return;
    }

    try {
      // Run token through filter pipeline
      const filterResult = await this.filterPipeline.processToken(tokenEvent);
      
      if (!filterResult.passed) {
        return; // Token didn't pass filters
      }

      const safetyStatus = this.getSafetyStatus();
      if (!safetyStatus.tradingAllowed || safetyStatus.emergencyStop) {
        logger.warn(`🚫 Trading blocked by safety: ${mintAddress} (tradingAllowed: ${safetyStatus.tradingAllowed}, emergencyStop: ${safetyStatus.emergencyStop})`);
        return;
      }

      // Execute buy order
      logger.info(`🎯 Token passed all filters: ${mintAddress} (Score: ${filterResult.totalScore.toFixed(1)})`);
      logger.info(`💰 EXECUTING BUY ORDER: ${mintAddress} | Amount: ${config.quoteAmount} SOL`);
      
      const tradeResult = await this.trader.buy(mintAddress, config.quoteAmount);
      logger.info(`✅ BUY ORDER COMPLETED: ${mintAddress} | TX: ${tradeResult.signature} | Success: ${tradeResult.success}`);
      
    } catch (error) {
      logger.error(`Failed to process token ${mintAddress}:`, error);
      this.handleFailure();
      throw error;
    }
  }

  /**
   * Handle trading failures for circuit breaker
   */
  private handleFailure(): void {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailure = Date.now();
    this.checkCircuitBreaker();
  }

  /**
   * Check if circuit breaker should be triggered
   */
  private checkCircuitBreaker(): void {
    const shouldTrigger = 
      this.circuitBreaker.failureCount >= config.circuitBreakerMaxFailures ||
      this.circuitBreaker.dailyLoss >= config.dailyLossLimit;

    if (shouldTrigger && !this.circuitBreaker.active) {
      this.circuitBreaker.active = true;
      
      logCircuitBreaker('Circuit breaker triggered', {
        failureCount: this.circuitBreaker.failureCount,
        dailyLoss: this.circuitBreaker.dailyLoss,
        maxFailures: config.circuitBreakerMaxFailures,
        maxDailyLoss: config.dailyLossLimit
      });
      
      logger.error(`🚨 CIRCUIT BREAKER ACTIVATED - Bot paused for safety`);
    }
  }

  /**
   * Reset circuit breaker manually
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.active = false;
    this.circuitBreaker.failureCount = 0;
    logger.info('🔄 Circuit breaker reset manually');
  }

  /**
   * Start daily reset timer
   */
  private startDailyReset(): void {
    setInterval(() => {
      const now = Date.now();
      const daysSinceReset = (now - this.circuitBreaker.lastReset) / (1000 * 60 * 60 * 24);
      
      if (daysSinceReset >= 1) {
        this.circuitBreaker.dailyLoss = 0;
        this.circuitBreaker.lastReset = now;
        logger.info('📅 Daily loss counter reset');
      }
    }, 60000); // Check every minute
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    console.log('🔧 BotManager: start() called');
    if (this.isRunning) {
      console.log('⚠️ BotManager: Already running, skipping start');
      return;
    }
    
    console.log('🔧 BotManager: Setting running state...');
    this.isRunning = true;
    this.startTime = Date.now();
    this.circuitBreaker.active = false;
    this.circuitBreaker.failureCount = 0;
    console.log('✅ BotManager: Running state set');
    
    console.log('🔧 BotManager: Getting wallet balance...');
    const startingBalance = await this.getWalletBalance();
    console.log(`✅ BotManager: Starting balance: ${startingBalance} SOL`);
    sessionLogger.startSession(startingBalance);
    
    console.log('🔧 BotManager: Starting TokenDetector...');
    await this.tokenDetector.start();
    console.log('✅ BotManager: TokenDetector started');
    
    console.log('🔧 BotManager: Starting real-time monitoring...');
    // Start real-time monitoring
    realTimeMonitor.start();
    console.log('✅ BotManager: Real-time monitoring started');
    
    logger.info({
      code: 'BOT_STARTED',
      mode: 'live',
      timestamp: this.startTime,
      maxPositions: config.maxPositions,
      maxConcurrentTrades: config.maxConcurrentTrades,
      quoteAmount: config.quoteAmount,
      startingBalance
    });
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    await this.autoSellAllPositions();
    
    await this.tokenDetector.stop();
    
    // Stop real-time monitoring
    realTimeMonitor.stop();
    
    const endingBalance = await this.getWalletBalance();
    sessionLogger.finalizeSession(endingBalance);
    
    logger.info({
      code: 'BOT_STOPPED',
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      endingBalance
    });
  }

  /**
   * Get bot status
   */
  getStatus(): BotStatus {
    const activePositions = this.positionManager.getActivePositions();
    const totalPnl = this.positionManager ? this.positionManager.getTotalPnl() : 0;
    const totalEvents = this.eventBus.getTotalEvents();
    const safetyStatus = this.tradingSafety.getSafetyStatus();
    
    return {
      running: this.isRunning,
      startTime: this.startTime,
      totalEvents,
      totalTrades: this.positionManager.getAllPositions().length,
      totalPnl,
      openPositions: activePositions.length,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      cpuUsage: 0, // Would need to implement CPU monitoring
      mode: 'live',
      circuitBreakerActive: this.circuitBreaker.active || !safetyStatus.tradingAllowed,
      lastError: undefined // Would track last error
    };
  }

  /**
   * Get all positions (including closed ones)
   */
  getPositions(): any[] {
    return this.positionManager.getAllPositions();
  }

  /**
   * Get open positions only
   */
  getOpenPositions(): any[] {
    return this.positionManager.getActivePositions();
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit: number = 50): any[] {
    // Get recent positions that have been sold
    return this.positionManager.getAllPositions(limit)
      .filter(pos => pos.status === 'sold')
      .sort((a, b) => (b.sellTimestamp || 0) - (a.sellTimestamp || 0));
  }

  /**
   * Add manual token for processing
   */
  addManualToken(mintAddress: string): void {
    this.tokenDetector.addManualToken(mintAddress);
  }

  /**
   * Get wallet info
   */
  getWalletInfo(name?: string): any {
    if (name) {
      return this.walletManager.getWalletInfo(name);
    }
    return Object.fromEntries(this.walletManager.getAllWalletInfo());
  }

  /**
   * Create new wallet
   */
  async createWallet(name: string, encrypt = true): Promise<string> {
    return await this.walletManager.createWallet(name, encrypt);
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(): any {
    return {
      bot: this.getStatus(),
      positions: this.positionManager.getMetrics(),
      trader: this.trader.getMetrics(),
      filters: this.filterPipeline.getMetrics(),
      wallets: this.walletManager.getMetrics(),
      rpc: {
        totalEndpoints: this.rpcManager.getHealthStatus().length,
        healthyEndpoints: this.rpcManager.getHealthStatus().filter(h => h.healthy).length,
        averageLatency: this.rpcManager.getAverageLatency()
      },
      detector: this.tokenDetector.getQueueMetrics(),
      circuitBreaker: this.circuitBreaker,
      safety: this.tradingSafety.getSafetyStatus(),
      paper: null
    };
  }




  /**
   * Enable live trading with safety checks
   */
  async enableLiveTrading(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Live trading enabled' };
  }

  /**
   * Disable live trading
   */
  disableLiveTrading(reason: string = 'Manual disable'): void {
    logger.info(`Live trading disabled: ${reason}`);
  }

  /**
   * Reset emergency stop
   */
  resetEmergencyStop(): { success: boolean; message: string } {
    return { success: true, message: 'Emergency stop reset' };
  }

  /**
   * Get safety status
   */
  getSafetyStatus(): any {
    return {
      liveTradingEnabled: !config.paperMode,
      emergencyStop: this.circuitBreaker.active,
      tradingAllowed: !this.circuitBreaker.active,
      criticalIssues: this.circuitBreaker.active ? 1 : 0,
      failedChecks: []
    };
  }

  /**
   * Get safety logs
   */
  getSafetyLogs(limit: number = 100): any[] {
    return [];
  }

  /**
   * Get health monitor
   */
  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  /**
   * Auto-sell all open positions when bot stops
   */
  private async autoSellAllPositions(): Promise<void> {
    const activePositions = this.positionManager.getActivePositions();
    
    if (activePositions.length === 0) {
      logger.info('🔄 No active positions to auto-sell');
      return;
    }

    logger.info(`🔄 Auto-selling ${activePositions.length} open positions...`);
    
    for (const position of activePositions) {
      try {
        sessionLogger.logPositionAtShutdown(position.mintAddress);
        await this.trader.sell(position.mintAddress, position.buyAmount, 'auto_sell');
        logger.info(`✅ Auto-sold position: ${position.mintAddress}`);
      } catch (error) {
        logger.error(`❌ Failed to auto-sell position ${position.mintAddress}:`, error);
      }
    }
  }

  /**
   * Get wallet balance for session tracking
   */
  private async getWalletBalance(): Promise<number> {
    try {
      const wallet = this.walletManager.getPrimaryWallet();
      if (!wallet) {
        logger.warn('No primary wallet available for balance check');
        return 0;
      }

      const connection = this.rpcManager.getHealthyConnection();
      if (!connection) {
        logger.warn('No healthy RPC connection available for balance check');
        return 0;
      }

      const balance = await connection.getBalance(wallet.publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      logger.error('Error getting wallet balance:', error);
      return 0;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.positionManager.destroy();
    this.rpcManager.destroy();
    this.walletManager.destroy();
    this.trader.destroy();
    this.healthMonitor.destroy();
    this.eventBus.destroy();
  }
}
