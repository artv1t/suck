import { EventBus } from '../core/eventBus.js';
import { TradeEvent, PaperTradeResult, PaperPosition, PaperWallet, MarketData } from '../types/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import Database from 'better-sqlite3';

/**
 * Advanced Paper Trading Engine
 * Realistic market simulation with volatility, slippage, and market impact
 */
export class PaperEngine {
  private eventBus: EventBus;
  private db: Database.Database;
  private wallet: PaperWallet;
  private positions = new Map<string, PaperPosition>();
  private marketData = new Map<string, MarketData>();
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private readonly INITIAL_BALANCE = 2000.0; // 2000 SOL starting balance
  private readonly PRICE_UPDATE_INTERVAL = 2000; // 2 seconds
  private readonly BASE_VOLATILITY = 0.05; // 5% base volatility per update
  private readonly SLIPPAGE_BASE = 0.002; // 0.2% base slippage
  private readonly MARKET_IMPACT_FACTOR = 0.001; // Market impact factor

  constructor() {
    this.eventBus = EventBus.getInstance();
    this.db = new Database(config.dbPath);
    this.wallet = this.initializeWallet();
    this.initializeDatabase();
    this.loadPaperData();
    this.startPriceSimulation();
    this.setupEventListeners();
  }

  /**
   * Initialize paper wallet with starting balance
   */
  private initializeWallet(): PaperWallet {
    return {
      solBalance: this.INITIAL_BALANCE,
      tokenBalances: new Map(),
      totalValue: this.INITIAL_BALANCE,
      totalPnl: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      currentDrawdown: 0,
      peakValue: this.INITIAL_BALANCE
    };
  }

  /**
   * Initialize database for paper trading data
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mintAddress TEXT NOT NULL,
        symbol TEXT,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        slippage REAL NOT NULL,
        pnl REAL,
        pnlPercent REAL,
        reason TEXT,
        timestamp INTEGER NOT NULL,
        walletBalance REAL NOT NULL,
        totalValue REAL NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_positions (
        mintAddress TEXT PRIMARY KEY,
        symbol TEXT,
        buyPrice REAL NOT NULL,
        buyAmount REAL NOT NULL,
        buyTimestamp INTEGER NOT NULL,
        currentPrice REAL NOT NULL,
        currentValue REAL NOT NULL,
        pnl REAL NOT NULL,
        pnlPercent REAL NOT NULL,
        status TEXT NOT NULL,
        sellReason TEXT,
        sellTimestamp INTEGER,
        sellPrice REAL,
        sellAmount REAL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_market_data (
        mintAddress TEXT PRIMARY KEY,
        price REAL NOT NULL,
        volume24h REAL NOT NULL,
        priceChange24h REAL NOT NULL,
        volatility REAL NOT NULL,
        trend TEXT NOT NULL,
        lastUpdate INTEGER NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Load existing paper trading data
   */
  private loadPaperData(): void {
    // Load positions
    const positionsStmt = this.db.prepare('SELECT * FROM paper_positions WHERE status = ?');
    const positionRows = positionsStmt.all('active');
    
    for (const row of positionRows) {
      const position: PaperPosition = {
        mintAddress: (row as any).mintAddress,
        symbol: (row as any).symbol,
        buyPrice: (row as any).buyPrice,
        buyAmount: (row as any).buyAmount,
        buyTimestamp: (row as any).buyTimestamp,
        currentPrice: (row as any).currentPrice,
        currentValue: (row as any).currentValue,
        pnl: (row as any).pnl,
        pnlPercent: (row as any).pnlPercent,
        status: (row as any).status,
        sellReason: (row as any).sellReason,
        sellTimestamp: (row as any).sellTimestamp,
        sellPrice: (row as any).sellPrice,
        sellAmount: (row as any).sellAmount
      } as PaperPosition;
      
      this.positions.set(position.mintAddress, position);
      this.wallet.tokenBalances.set(position.mintAddress, position.buyAmount);
    }

    // Load market data
    const marketStmt = this.db.prepare('SELECT * FROM paper_market_data');
    const marketRows = marketStmt.all();
    
    for (const row of marketRows) {
      this.marketData.set((row as any).mintAddress, {
        price: (row as any).price,
        volume24h: (row as any).volume24h,
        priceChange24h: (row as any).priceChange24h,
        volatility: (row as any).volatility,
        trend: (row as any).trend,
        lastUpdate: (row as any).lastUpdate
      } as MarketData);
    }

    // Recalculate wallet stats
    this.updateWalletStats();
    
    logger.info(`📊 Loaded ${this.positions.size} paper positions and ${this.marketData.size} market data entries`);
  }

  /**
   * Setup event listeners for trade events
   */
  private setupEventListeners(): void {
    // Only process events in paper mode
    if (!config.paperMode) return;

    this.eventBus.on('trade_event', (_tradeEvent: TradeEvent) => {
      // Paper engine handles its own trade execution
      // This listener is for logging and analytics
    });
  }

  /**
   * Execute paper buy order with realistic simulation
   */
  async executeBuy(mintAddress: string, quoteAmount: number): Promise<PaperTradeResult> {
    if (this.wallet.solBalance < quoteAmount) {
      throw new Error('Insufficient SOL balance for paper trade');
    }

    // Get or create market data
    let market = this.marketData.get(mintAddress);
    if (!market) {
      market = this.initializeMarketData(mintAddress);
      this.marketData.set(mintAddress, market);
    }

    // Calculate realistic slippage based on order size and liquidity
    const orderSizeImpact = Math.min(quoteAmount * this.MARKET_IMPACT_FACTOR, 0.05); // Max 5% impact
    const volatilitySlippage = market.volatility * 0.5; // Volatility affects slippage
    const totalSlippage = this.SLIPPAGE_BASE + orderSizeImpact + volatilitySlippage;
    
    // Apply slippage to price (worse price for buyer)
    const executionPrice = market.price * (1 + totalSlippage);
    const tokenAmount = quoteAmount / executionPrice;

    // Update wallet
    this.wallet.solBalance -= quoteAmount;
    this.wallet.tokenBalances.set(mintAddress, 
      (this.wallet.tokenBalances.get(mintAddress) || 0) + tokenAmount
    );

    // Create position
    const position: PaperPosition = {
      mintAddress,
      buyPrice: executionPrice,
      buyAmount: tokenAmount,
      buyTimestamp: Date.now(),
      currentPrice: market.price,
      currentValue: tokenAmount * market.price,
      pnl: 0,
      pnlPercent: 0,
      status: 'active'
    };

    this.positions.set(mintAddress, position);
    this.savePosition(position);

    // Record trade
    this.recordTrade({
      mintAddress,
      type: 'buy',
      amount: tokenAmount,
      price: executionPrice,
      slippage: totalSlippage * 100,
      timestamp: Date.now()
    });

    // Update market data (buying increases price slightly)
    market.price *= (1 + orderSizeImpact * 0.1);
    market.volume24h += quoteAmount;
    this.saveMarketData(mintAddress, market);

    this.updateWalletStats();

    logger.info(`📈 PAPER BUY: ${mintAddress} | Amount: ${tokenAmount.toFixed(6)} | Price: ${executionPrice.toFixed(8)} | Slippage: ${(totalSlippage * 100).toFixed(2)}%`);

    return {
      success: true,
      mintAddress,
      type: 'buy',
      amount: tokenAmount,
      price: executionPrice,
      slippage: totalSlippage * 100,
      timestamp: Date.now(),
      signature: this.generatePaperSignature()
    };
  }

  /**
   * Execute paper sell order with realistic simulation
   */
  async executeSell(mintAddress: string, tokenAmount: number, reason: string = 'manual'): Promise<PaperTradeResult> {
    const position = this.positions.get(mintAddress);
    if (!position) {
      throw new Error('No position found for paper sell');
    }

    const tokenBalance = this.wallet.tokenBalances.get(mintAddress) || 0;
    if (tokenBalance < tokenAmount) {
      throw new Error('Insufficient token balance for paper sell');
    }

    const market = this.marketData.get(mintAddress);
    if (!market) {
      throw new Error('No market data for paper sell');
    }

    // Calculate realistic slippage for selling
    const orderSizeImpact = Math.min(tokenAmount * market.price * this.MARKET_IMPACT_FACTOR, 0.08); // Max 8% impact
    const volatilitySlippage = market.volatility * 0.6; // Higher slippage when selling
    const totalSlippage = this.SLIPPAGE_BASE + orderSizeImpact + volatilitySlippage;
    
    // Apply slippage to price (worse price for seller)
    const executionPrice = market.price * (1 - totalSlippage);
    const solReceived = tokenAmount * executionPrice;

    // Calculate PnL
    const costBasis = tokenAmount * position.buyPrice;
    const pnl = solReceived - costBasis;
    const pnlPercent = (pnl / costBasis) * 100;

    // Update wallet
    this.wallet.solBalance += solReceived;
    const remainingTokens = tokenBalance - tokenAmount;
    if (remainingTokens > 0.000001) { // Keep dust threshold
      this.wallet.tokenBalances.set(mintAddress, remainingTokens);
    } else {
      this.wallet.tokenBalances.delete(mintAddress);
    }

    // Update position
    if (tokenAmount >= position.buyAmount * 0.99) { // Selling most/all of position
      position.status = 'sold';
      position.sellReason = reason;
      position.sellTimestamp = Date.now();
      position.sellPrice = executionPrice;
      position.sellAmount = solReceived;
      position.pnl = pnl;
      position.pnlPercent = pnlPercent;
      
      this.positions.delete(mintAddress);
    } else {
      // Partial sell - update position size
      position.buyAmount -= tokenAmount;
      position.currentValue = position.buyAmount * market.price;
    }

    this.savePosition(position);

    // Record trade
    this.recordTrade({
      mintAddress,
      type: 'sell',
      amount: tokenAmount,
      price: executionPrice,
      slippage: totalSlippage * 100,
      pnl,
      pnlPercent,
      reason,
      timestamp: Date.now()
    });

    // Update market data (selling decreases price)
    market.price *= (1 - orderSizeImpact * 0.15);
    market.volume24h += solReceived;
    this.saveMarketData(mintAddress, market);

    this.updateWalletStats();

    logger.info(`📉 PAPER SELL: ${mintAddress} | Amount: ${tokenAmount.toFixed(6)} | Price: ${executionPrice.toFixed(8)} | PnL: ${pnl.toFixed(6)} SOL (${pnlPercent.toFixed(2)}%) | Reason: ${reason}`);

    return {
      success: true,
      mintAddress,
      type: 'sell',
      amount: tokenAmount,
      price: executionPrice,
      slippage: totalSlippage * 100,
      pnl,
      pnlPercent,
      reason,
      timestamp: Date.now(),
      signature: this.generatePaperSignature()
    };
  }

  /**
   * Initialize market data for new token
   */
  private initializeMarketData(_mintAddress: string): MarketData {
    // Realistic starting price based on quote amount
    const basePrice = config.quoteAmount / (Math.random() * 1000000 + 100000); // Random supply
    
    return {
      price: basePrice,
      volume24h: Math.random() * 50000 + 1000, // $1K-$50K volume
      priceChange24h: (Math.random() - 0.5) * 200, // -100% to +100%
      lastUpdate: Date.now(),
      volatility: Math.random() * 0.1 + 0.02, // 2-12% volatility
      trend: Math.random() > 0.5 ? 'up' : 'down'
    };
  }

  /**
   * Start realistic price simulation
   */
  private startPriceSimulation(): void {
    this.priceUpdateInterval = setInterval(() => {
      this.updateMarketPrices();
      this.updatePositionValues();
    }, this.PRICE_UPDATE_INTERVAL);
  }

  /**
   * Update market prices with realistic volatility
   */
  private updateMarketPrices(): void {
    for (const [mintAddress, market] of this.marketData.entries()) {
      // Calculate price movement based on trend and volatility
      const trendFactor = market.trend === 'up' ? 0.6 : market.trend === 'down' ? -0.6 : 0;
      const randomFactor = (Math.random() - 0.5) * 2; // -1 to +1
      const volatilityFactor = market.volatility * (trendFactor * 0.3 + randomFactor * 0.7);
      
      // Apply price change
      const priceChange = 1 + volatilityFactor;
      market.price *= Math.max(0.01, priceChange); // Prevent negative prices
      
      // Update 24h change
      const timeFactor = this.PRICE_UPDATE_INTERVAL / (24 * 60 * 60 * 1000); // Fraction of day
      market.priceChange24h = market.priceChange24h * (1 - timeFactor) + (priceChange - 1) * 100;
      
      // Adjust volatility (mean reversion)
      market.volatility = market.volatility * 0.99 + this.BASE_VOLATILITY * 0.01;
      
      // Occasionally change trend
      if (Math.random() < 0.01) { // 1% chance per update
        const trends: Array<'up' | 'down' | 'sideways'> = ['up', 'down', 'sideways'];
        market.trend = trends[Math.floor(Math.random() * trends.length)];
      }
      
      market.lastUpdate = Date.now();
      
      // Save to database periodically
      if (Math.random() < 0.1) { // 10% chance to save
        this.saveMarketData(mintAddress, market);
      }
    }
  }

  /**
   * Update position values based on current market prices
   */
  private updatePositionValues(): void {
    for (const [mintAddress, position] of this.positions.entries()) {
      const market = this.marketData.get(mintAddress);
      if (!market) continue;

      position.currentPrice = market.price;
      position.currentValue = position.buyAmount * market.price;
      
      const costBasis = position.buyAmount * position.buyPrice;
      position.pnl = position.currentValue - costBasis;
      position.pnlPercent = (position.pnl / costBasis) * 100;

      // Save position updates periodically
      if (Math.random() < 0.05) { // 5% chance to save
        this.savePosition(position);
      }
    }
  }

  /**
   * Update wallet statistics
   */
  private updateWalletStats(): void {
    // Calculate total value
    let totalTokenValue = 0;
    for (const [mintAddress, amount] of this.wallet.tokenBalances.entries()) {
      const market = this.marketData.get(mintAddress);
      if (market) {
        totalTokenValue += amount * market.price;
      }
    }
    
    this.wallet.totalValue = this.wallet.solBalance + totalTokenValue;
    
    // Update peak value and drawdown
    if (this.wallet.totalValue > this.wallet.peakValue) {
      this.wallet.peakValue = this.wallet.totalValue;
      this.wallet.currentDrawdown = 0;
    } else {
      this.wallet.currentDrawdown = ((this.wallet.peakValue - this.wallet.totalValue) / this.wallet.peakValue) * 100;
      this.wallet.maxDrawdown = Math.max(this.wallet.maxDrawdown, this.wallet.currentDrawdown);
    }
    
    // Calculate total PnL
    this.wallet.totalPnl = this.wallet.totalValue - this.INITIAL_BALANCE;
    
    // Update win rate
    if (this.wallet.totalTrades > 0) {
      this.wallet.winRate = (this.wallet.winningTrades / this.wallet.totalTrades) * 100;
    }
  }

  /**
   * Record trade in database
   */
  private recordTrade(trade: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO paper_trades 
      (mintAddress, symbol, type, amount, price, slippage, pnl, pnlPercent, reason, timestamp, walletBalance, totalValue)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      trade.mintAddress,
      trade.symbol || null,
      trade.type,
      trade.amount,
      trade.price,
      trade.slippage,
      trade.pnl || null,
      trade.pnlPercent || null,
      trade.reason || null,
      trade.timestamp,
      this.wallet.solBalance,
      this.wallet.totalValue
    );

    // Update trade counters
    this.wallet.totalTrades++;
    if (trade.pnl && trade.pnl > 0) {
      this.wallet.winningTrades++;
    } else if (trade.pnl && trade.pnl < 0) {
      this.wallet.losingTrades++;
    }
  }

  /**
   * Save position to database
   */
  private savePosition(position: PaperPosition): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO paper_positions 
      (mintAddress, symbol, buyPrice, buyAmount, buyTimestamp, currentPrice, currentValue, 
       pnl, pnlPercent, status, sellReason, sellTimestamp, sellPrice, sellAmount, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      position.mintAddress,
      position.symbol || null,
      position.buyPrice,
      position.buyAmount,
      position.buyTimestamp,
      position.currentPrice,
      position.currentValue,
      position.pnl,
      position.pnlPercent,
      position.status,
      position.sellReason || null,
      position.sellTimestamp || null,
      position.sellPrice || null,
      position.sellAmount || null
    );
  }

  /**
   * Save market data to database
   */
  private saveMarketData(mintAddress: string, market: MarketData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO paper_market_data 
      (mintAddress, price, volume24h, priceChange24h, volatility, trend, lastUpdate, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      mintAddress,
      market.price,
      market.volume24h,
      market.priceChange24h,
      market.volatility,
      market.trend,
      market.lastUpdate
    );
  }

  /**
   * Generate paper transaction signature
   */
  private generatePaperSignature(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'PAPER_';
    for (let i = 0; i < 82; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Get current wallet status
   */
  getWalletStatus(): PaperWallet {
    this.updateWalletStats();
    return { ...this.wallet };
  }

  /**
   * Get all active positions
   */
  getActivePositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get trading history
   */
  getTradingHistory(limit: number = 100): any[] {
    const stmt = this.db.prepare('SELECT * FROM paper_trades ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit);
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): any {
    const positions = this.getActivePositions();
    const totalPositions = positions.length;
    const profitablePositions = positions.filter(p => p.pnl > 0).length;
    
    return {
      wallet: this.getWalletStatus(),
      positions: {
        total: totalPositions,
        profitable: profitablePositions,
        unprofitable: totalPositions - profitablePositions,
        profitableRate: totalPositions > 0 ? (profitablePositions / totalPositions) * 100 : 0
      },
      performance: {
        totalReturn: ((this.wallet.totalValue - this.INITIAL_BALANCE) / this.INITIAL_BALANCE) * 100,
        maxDrawdown: this.wallet.maxDrawdown,
        currentDrawdown: this.wallet.currentDrawdown,
        winRate: this.wallet.winRate,
        totalTrades: this.wallet.totalTrades
      }
    };
  }

  /**
   * Reset paper trading data
   */
  resetPaperData(): void {
    this.db.exec('DELETE FROM paper_trades');
    this.db.exec('DELETE FROM paper_positions');
    this.db.exec('DELETE FROM paper_market_data');
    
    this.positions.clear();
    this.marketData.clear();
    this.wallet = this.initializeWallet();
    
    logger.info('🔄 Paper trading data reset');
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    this.db.close();
  }
}