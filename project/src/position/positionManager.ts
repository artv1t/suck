import { EventBus } from '../core/eventBus.js';
import { Trader } from '../trader/trader.js';
import { Position, TradeEvent } from '../types/index.js';
import { config } from '../config/index.js';
import { logSellSuccess } from '../utils/logger.js';
import { tradingLogger } from '../logging/tradingLogger.js';
import { realTimeMonitor } from '../monitoring/realTimeMonitor.js';
import { sessionLogger } from '../logging/sessionLogger.js';
import logger from '../utils/logger.js';
import Database from 'better-sqlite3';

interface PositionRow {
  mintAddress: string;
  symbol: string | null;
  buyPrice: number;
  buyAmount: number;
  buySignature: string;
  buyTimestamp: number;
  currentPrice: number | null;
  currentValue: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  status: 'active' | 'sold' | 'failed';
  sellReason: string | null;
  sellSignature: string | null;
  sellTimestamp: number | null;
  sellPrice: number | null;
  sellAmount: number | null;
}

/**
 * High-performance position manager
 * Handles TP/SL/TTL for all positions with parallel processing
 */
export class PositionManager {
  private eventBus: EventBus;
  private trader: Trader;
  private positions = new Map<string, Position>();
  private db: Database.Database;
  private priceCheckInterval: NodeJS.Timeout | null = null;
  private readonly MAX_POSITIONS = config.maxPositions;

  constructor(trader: Trader) {
    this.eventBus = EventBus.getInstance();
    this.trader = trader;
    this.db = new Database(config.dbPath);
    this.initializeDatabase();
    this.loadPositions();
    this.setupEventListeners();
    this.startPriceMonitoring();
  }

  /**
   * Initialize SQLite database for position persistence
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        mintAddress TEXT PRIMARY KEY,
        symbol TEXT,
        buyPrice REAL NOT NULL,
        buyAmount REAL NOT NULL,
        buySignature TEXT NOT NULL,
        buyTimestamp INTEGER NOT NULL,
        currentPrice REAL,
        currentValue REAL,
        pnl REAL,
        pnlPercent REAL,
        status TEXT NOT NULL,
        sellReason TEXT,
        sellSignature TEXT,
        sellTimestamp INTEGER,
        sellPrice REAL,
        sellAmount REAL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Load existing positions from database
   */
  private loadPositions(): void {
    const stmt = this.db.prepare('SELECT * FROM positions WHERE status = ?');
    const rows = stmt.all('active') as PositionRow[];
    
    for (const row of rows) {
      const position: Position = {
        mintAddress: row.mintAddress,
        symbol: row.symbol || undefined,
        buyPrice: row.buyPrice,
        buyAmount: row.buyAmount,
        buySignature: row.buySignature,
        buyTimestamp: row.buyTimestamp,
        currentPrice: row.currentPrice || undefined,
        currentValue: row.currentValue || undefined,
        pnl: row.pnl || undefined,
        pnlPercent: row.pnlPercent || undefined,
        status: row.status as 'active' | 'sold' | 'failed',
        sellReason: row.sellReason as 'take_profit' | 'stop_loss' | 'ttl' | 'manual' | undefined,
        sellSignature: row.sellSignature || undefined,
        sellTimestamp: row.sellTimestamp || undefined,
        sellPrice: row.sellPrice || undefined,
        sellAmount: row.sellAmount || undefined
      };
      
      this.positions.set(position.mintAddress, position);
    }
    
    logger.info(`📊 Loaded ${this.positions.size} active positions`);
  }

  /**
   * Setup event listeners for trade events
   */
  private setupEventListeners(): void {
    this.eventBus.on('trade_event', (tradeEvent: TradeEvent) => {
      if (tradeEvent.success) {
        if (tradeEvent.type === 'buy') {
          this.createPosition(tradeEvent);
        } else {
          this.updatePositionOnSell(tradeEvent);
        }
      }
    });
  }

  /**
   * Create new position from buy trade
   */
  private createPosition(tradeEvent: TradeEvent): void {
    if (this.positions.size >= this.MAX_POSITIONS) {
      logger.warn(`Max positions reached (${this.MAX_POSITIONS}), cannot create new position`);
      return;
    }

    const position: Position = {
      mintAddress: tradeEvent.mintAddress,
      symbol: tradeEvent.symbol,
      buyPrice: tradeEvent.price,
      buyAmount: tradeEvent.amount,
      buySignature: tradeEvent.signature,
      buyTimestamp: tradeEvent.timestamp,
      currentPrice: tradeEvent.price,
      currentValue: tradeEvent.amount * tradeEvent.price,
      pnl: 0,
      pnlPercent: 0,
      status: 'active'
    };

    this.positions.set(position.mintAddress, position);
    this.savePosition(position);
    
    tradingLogger.logTrade({
      timestamp: new Date().toISOString(),
      mintAddress: position.mintAddress,
      action: 'BUY',
      amount: position.buyAmount,
      price: position.buyPrice,
      solAmount: position.buyAmount * position.buyPrice,
      txHash: position.buySignature
    });

    
    logger.info(`➕ Position created: ${position.mintAddress} | Amount: ${position.buyAmount.toFixed(6)} | Price: ${position.buyPrice.toFixed(8)}`);
  }

  /**
   * Update position when sold
   */
  private updatePositionOnSell(tradeEvent: TradeEvent): void {
    const position = this.positions.get(tradeEvent.mintAddress);
    if (!position) {
      logger.warn(`Position not found for sell: ${tradeEvent.mintAddress}`);
      return;
    }

    // Calculate PnL
    const soldValue = tradeEvent.amount; // SOL received
    const boughtValue = position.buyAmount * position.buyPrice; // SOL spent
    const pnl = soldValue - boughtValue;
    const pnlPercent = (pnl / boughtValue) * 100;

    // Update position
    position.status = 'sold';
    position.sellReason = tradeEvent.reason as any;
    position.sellSignature = tradeEvent.signature;
    position.sellTimestamp = tradeEvent.timestamp;
    position.sellPrice = tradeEvent.price;
    position.sellAmount = tradeEvent.amount;
    position.pnl = pnl;
    position.pnlPercent = pnlPercent;

    this.savePosition(position);
    this.positions.delete(position.mintAddress); // Remove from active positions
    
    tradingLogger.logTrade({
      timestamp: new Date().toISOString(),
      mintAddress: position.mintAddress,
      action: tradeEvent.reason === 'take_profit' ? 'TAKE_PROFIT' : 
              tradeEvent.reason === 'stop_loss' ? 'STOP_LOSS' : 'SELL',
      amount: tradeEvent.amount,
      price: tradeEvent.price,
      solAmount: tradeEvent.amount,
      txHash: tradeEvent.signature,
      reason: tradeEvent.reason,
      pnl,
      pnlPercent,
      holdTime: Date.now() - position.buyTimestamp
    });
    realTimeMonitor.tradeExecuted(position.mintAddress, tradeEvent.reason?.toUpperCase() || 'SELL', pnl);

    
    logSellSuccess(position.mintAddress, tradeEvent.reason || 'manual', pnl, tradeEvent.signature);
    logger.info(`➖ Position closed: ${position.mintAddress} | PnL: ${pnl.toFixed(6)} SOL (${pnlPercent.toFixed(2)}%) | Reason: ${tradeEvent.reason}`);
  }

  /**
   * Start price monitoring and exit condition checking
   */
  private startPriceMonitoring(): void {
    this.priceCheckInterval = setInterval(async () => {
      await this.updatePositionPrices();
      await this.checkExitConditions();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Update current prices for all positions
   */
  private async updatePositionPrices(): Promise<void> {
    const positions = Array.from(this.positions.values());
    if (positions.length === 0) return;

    // In a real implementation, you would fetch current prices from Jupiter or other price feeds
    // For demo purposes, we'll simulate price movements
    for (const position of positions) {
      if (config.paperMode) {
        // Simulate realistic price movement
        const volatility = 0.02; // 2% volatility per 5-second interval
        const change = (Math.random() - 0.5) * volatility * 2;
        const newPrice = position.currentPrice! * (1 + change);
        
        // Update position metrics
        position.currentPrice = Math.max(0, newPrice);
        position.currentValue = position.buyAmount * position.currentPrice;
        
        const boughtValue = position.buyAmount * position.buyPrice;
        position.pnl = position.currentValue - boughtValue;
        position.pnlPercent = (position.pnl / boughtValue) * 100;
        
        this.savePosition(position);
      }
    }
  }

  /**
   * Check exit conditions for all positions (TP/SL/TTL)
   */
  private async checkExitConditions(): Promise<void> {
    const positions = Array.from(this.positions.values()).filter(p => p.status === 'active');
    
    for (const position of positions) {
      const pnlPercent = position.pnlPercent || 0;
      const ageMinutes = (Date.now() - position.buyTimestamp) / (1000 * 60);
      
      let shouldSell = false;
      let reason: string = 'manual';
      
      // Take Profit
      if (pnlPercent >= config.takeProfit) {
        shouldSell = true;
        reason = 'take_profit';
      }
      // Stop Loss
      else if (pnlPercent <= -config.stopLoss) {
        shouldSell = true;
        reason = 'stop_loss';
      }
      // Time-based exit (TTL)
      else if (ageMinutes >= config.ttlMinutes) {
        shouldSell = true;
        reason = 'ttl';
      }
      
      if (shouldSell) {
        try {
          await this.trader.sell(position.mintAddress, position.buyAmount, reason);
        } catch (error) {
          logger.error(`Failed to sell position ${position.mintAddress}:`, error);
          position.status = 'failed';
          this.savePosition(position);
        }
      }
    }
  }

  /**
   * Save position to database
   */
  private savePosition(position: Position): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO positions 
      (mintAddress, symbol, buyPrice, buyAmount, buySignature, buyTimestamp,
       currentPrice, currentValue, pnl, pnlPercent, status, sellReason,
       sellSignature, sellTimestamp, sellPrice, sellAmount, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      position.mintAddress,
      position.symbol,
      position.buyPrice,
      position.buyAmount,
      position.buySignature,
      position.buyTimestamp,
      position.currentPrice,
      position.currentValue,
      position.pnl,
      position.pnlPercent,
      position.status,
      position.sellReason,
      position.sellSignature,
      position.sellTimestamp,
      position.sellPrice,
      position.sellAmount
    );
  }

  /**
   * Get all active positions
   */
  getActivePositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'active');
  }

  /**
   * Get all positions (including closed ones)
   */
  getAllPositions(limit = 100): Position[] {
    const stmt = this.db.prepare('SELECT * FROM positions ORDER BY buyTimestamp DESC LIMIT ?');
    const rows = stmt.all(limit) as PositionRow[];
    
    return rows.map((row: PositionRow) => ({
      mintAddress: row.mintAddress,
      symbol: row.symbol || undefined,
      buyPrice: row.buyPrice,
      buyAmount: row.buyAmount,
      buySignature: row.buySignature,
      buyTimestamp: row.buyTimestamp,
      currentPrice: row.currentPrice || undefined,
      currentValue: row.currentValue || undefined,
      pnl: row.pnl || undefined,
      pnlPercent: row.pnlPercent || undefined,
      status: row.status as 'active' | 'sold' | 'failed',
      sellReason: row.sellReason as 'take_profit' | 'stop_loss' | 'ttl' | 'manual' | undefined,
      sellSignature: row.sellSignature || undefined,
      sellTimestamp: row.sellTimestamp || undefined,
      sellPrice: row.sellPrice || undefined,
      sellAmount: row.sellAmount || undefined
    }));
  }

  /**
   * Get total PnL across all positions
   */
  getTotalPnl(): number {
    const stmt = this.db.prepare('SELECT SUM(pnl) as totalPnl FROM positions WHERE status = ?');
    const result = stmt.get('sold') as { totalPnl: number } | undefined;
    return result?.totalPnl || 0;
  }

  /**
   * Get current exposure (total value of active positions)
   */
  getCurrentExposure(): number {
    return Array.from(this.positions.values())
      .reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
  }

  /**
   * Check if we can open a new position
   */
  canOpenNewPosition(): boolean {
    const activePositions = this.getActivePositions();
    const currentExposure = this.getCurrentExposure();
    
    const estimatedNewExposure = currentExposure + (config.quoteAmount * 100);
    const hasPositionCapacity = activePositions.length < config.maxPositions;
    const hasExposureCapacity = estimatedNewExposure < (config.maxExposure * 0.9);
    
    return hasPositionCapacity && hasExposureCapacity;
  }

  /**
   * Get position manager metrics
   */
  getMetrics(): {
    activePositions: number;
    totalPositions: number;
    totalPnl: number;
    currentExposure: number;
    maxPositions: number;
  } {
    return {
      activePositions: this.positions.size,
      totalPositions: this.getAllPositions().length,
      totalPnl: this.getTotalPnl(),
      currentExposure: this.getCurrentExposure(),
      maxPositions: this.MAX_POSITIONS
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
    }
    this.db.close();
  }
}
