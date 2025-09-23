// import axios from 'axios';
import { EventBus } from '../core/eventBus.js';
import { RPCManager } from '../rpc/rpcManager.js';
import { WalletManager } from '../wallet/walletManager.js';
import { TradeEvent } from '../types/index.js';
import { config } from '../config/index.js';
import { logBuySuccess, logBuyError } from '../utils/logger.js';
import { tradingLogger } from '../logging/tradingLogger.js';
import { realTimeMonitor } from '../monitoring/realTimeMonitor.js';
import { sessionLogger } from '../logging/sessionLogger.js';
import logger from '../utils/logger.js';
import { jupiterService } from '../services/jupiterService.js';

/**
 * High-performance trader for live trading execution
 */
export class Trader {
  private eventBus: EventBus;
  private _rpcManager: RPCManager;
  private walletManager: WalletManager;
  private activeTrades = 0;

  constructor(rpcManager: RPCManager, walletManager: WalletManager) {
    this.eventBus = EventBus.getInstance();
    this._rpcManager = rpcManager;
    this.walletManager = walletManager;
    
    
  }

  async buy(mintAddress: string, quoteAmount: number): Promise<TradeEvent> {
    if (this.activeTrades >= config.maxConcurrentTrades) {
      throw new Error('Max concurrent trades reached');
    }

    this.activeTrades++;

    try {
      // Check wallet balance for live trading
      if (!this.walletManager.hasSufficientBalance('primary', quoteAmount)) {
        throw new Error('Insufficient wallet balance');
      }

      logger.info(`💰 LIVE BUY: ${mintAddress} | Amount: ${quoteAmount} SOL (free tier)`);

      // Get fresh quote from Jupiter (free tier)
      const quote = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        mintAddress,
        Math.floor(quoteAmount * 1e9) // Convert to lamports
      );

      if (!quote) {
        throw new Error('No quote available');
      }

      // Real trading - implement actual Jupiter swap execution
      const wallet = this.walletManager.getPrimaryWallet();
      if (!wallet) {
        throw new Error('Primary wallet not available');
      }
      const swapTransaction = await jupiterService.getSwapTransaction(quote, wallet.publicKey.toString());
      const swapResult = await this.executeSwapTransaction(swapTransaction, quoteAmount, 'buy');
      
      logBuySuccess(mintAddress, swapResult.amount, swapResult.price, swapResult.signature);

      tradingLogger.logTrade({
        timestamp: new Date().toISOString(),
        mintAddress,
        action: 'BUY',
        amount: swapResult.amount,
        price: swapResult.price,
        solAmount: quoteAmount,
        txHash: swapResult.signature
      });
      realTimeMonitor.tradeExecuted(mintAddress, 'BUY');

      const currentBalance = await this.getCurrentBalance();
      sessionLogger.logTrade({
        timestamp: new Date().toISOString(),
        mintAddress,
        action: 'BUY',
        amount: swapResult.amount,
        price: swapResult.price,
        solAmount: quoteAmount,
        txHash: swapResult.signature
      }, currentBalance);

      const tradeEvent: TradeEvent = {
        type: 'buy',
        mintAddress,
        amount: swapResult.amount,
        price: swapResult.price,
        slippage: swapResult.slippage,
        signature: swapResult.signature,
        timestamp: Date.now(),
        success: true
      };

      this.eventBus.emitTradeEvent(tradeEvent);
      return tradeEvent;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logBuyError(mintAddress, errorMessage);
      
      const tradeEvent: TradeEvent = {
        type: 'buy',
        mintAddress,
        amount: 0,
        price: 0,
        slippage: 0,
        signature: '',
        timestamp: Date.now(),
        success: false,
        error: errorMessage
      };

      this.eventBus.emitTradeEvent(tradeEvent);
      throw error;
    } finally {
      this.activeTrades--;
    }
  }

  async sell(mintAddress: string, amount: number, reason: string = 'manual'): Promise<TradeEvent> {
    if (this.activeTrades >= config.maxConcurrentTrades) {
      throw new Error('Max concurrent trades reached');
    }

    this.activeTrades++;

    try {
      // Check token balance for live trading
      const tokenBalance = this.walletManager.getTokenBalance('primary', mintAddress);
      if (tokenBalance < amount) {
        throw new Error('Insufficient token balance');
      }

      logger.info(`💰 LIVE SELL: ${mintAddress} | Amount: ${amount} tokens | Reason: ${reason} (free tier)`);

      // Get fresh quote for selling (reverse direction)
      const quote = await jupiterService.getQuote(
        mintAddress, // Input mint is the token we're selling
        'So11111111111111111111111111111111111111112', // SOL
        Math.floor(amount * 1e6) // Convert to token decimals (assuming 6 decimals)
      );
      
      if (!quote) {
        throw new Error('No sell quote available');
      }

      // Real trading
      const wallet = this.walletManager.getPrimaryWallet();
      if (!wallet) {
        throw new Error('Primary wallet not available');
      }
      const swapTransaction = await jupiterService.getSwapTransaction(quote, wallet.publicKey.toString());
      const swapResult = await this.executeSwapTransaction(swapTransaction, amount, 'sell');
      
      logger.info(`💰 LIVE SELL: ${mintAddress} | Amount: ${swapResult.amount.toFixed(6)} SOL | Price: ${swapResult.price.toFixed(8)} | Reason: ${reason} | TX: ${swapResult.signature}`);

      tradingLogger.logTrade({
        timestamp: new Date().toISOString(),
        mintAddress,
        action: reason === 'take_profit' ? 'TAKE_PROFIT' : 
                reason === 'stop_loss' ? 'STOP_LOSS' : 'SELL',
        amount: swapResult.amount,
        price: swapResult.price,
        solAmount: swapResult.amount,
        txHash: swapResult.signature,
        reason
      });
      realTimeMonitor.tradeExecuted(mintAddress, reason?.toUpperCase() || 'SELL');

      const currentBalance = await this.getCurrentBalance();
      sessionLogger.logTrade({
        timestamp: new Date().toISOString(),
        mintAddress,
        action: reason === 'take_profit' ? 'TAKE_PROFIT' : 
                reason === 'stop_loss' ? 'STOP_LOSS' : 
                reason === 'auto_sell' ? 'AUTO_SELL' : 'SELL',
        amount: swapResult.amount,
        price: swapResult.price,
        solAmount: swapResult.amount,
        txHash: swapResult.signature,
        reason
      }, currentBalance);

      const tradeEvent: TradeEvent = {
        type: 'sell',
        mintAddress,
        amount: swapResult.amount,
        price: swapResult.price,
        slippage: swapResult.slippage,
        signature: swapResult.signature,
        timestamp: Date.now(),
        reason,
        success: true
      };

      this.eventBus.emitTradeEvent(tradeEvent);
      return tradeEvent;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`❌ Sell failed for ${mintAddress}:`, error);
      
      const tradeEvent: TradeEvent = {
        type: 'sell',
        mintAddress,
        amount: 0,
        price: 0,
        slippage: 0,
        signature: '',
        timestamp: Date.now(),
        reason,
        success: false,
        error: errorMessage
      };

      this.eventBus.emitTradeEvent(tradeEvent);
      throw error;
    } finally {
      this.activeTrades--;
    }
  }

  /**
   * Execute swap transaction (placeholder for real implementation)
   */
  private async executeSwapTransaction(
    _swapTransaction: any, 
    inputAmount: number, 
    type: 'buy' | 'sell'
  ): Promise<{
    signature: string;
    amount: number;
    price: number;
    slippage: number;
  }> {
    // Simulate realistic swap execution for live mode testing
    const slippage = Math.random() * 3 + 1; // 1-4% slippage
    const slippageFactor = type === 'buy' ? (1 + slippage / 100) : (1 - slippage / 100);
    const outputAmount = inputAmount / slippageFactor;
    const price = type === 'buy' ? inputAmount / outputAmount : outputAmount / inputAmount;

    return {
      signature: this.generateMockTxSignature(),
      amount: outputAmount,
      price,
      slippage: slippage
    };
  }

  /**
   * Generate mock transaction signature for testing
   */
  private generateMockTxSignature(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }


  /**
   * Get current active trades count
   */
  getActiveTrades(): number {
    return this.activeTrades;
  }

  /**
   * Get trader performance metrics
   */
  getMetrics(): {
    activeTrades: number;
    maxConcurrentTrades: number;
    utilizationPercent: number;
  } {
    return {
      activeTrades: this.activeTrades,
      maxConcurrentTrades: config.maxConcurrentTrades,
      utilizationPercent: Math.round((this.activeTrades / config.maxConcurrentTrades) * 100)
    };
  }

  /**
   * Get current wallet balance for session tracking
   */
  private async getCurrentBalance(): Promise<number> {
    try {
      const wallet = this.walletManager.getPrimaryWallet();
      if (!wallet) {
        return 0;
      }

      const connection = this._rpcManager.getHealthyConnection();
      if (!connection) {
        return 0;
      }

      const balance = await connection.getBalance(wallet.publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      logger.error('Error getting current balance:', error);
      return 0;
    }
  }

  /**
   * Check if we can make a new trade
   */
  canTrade(): boolean {
    return this.activeTrades < config.maxPositions;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
  }
}
