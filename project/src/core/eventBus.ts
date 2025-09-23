import { EventEmitter } from 'events';
import { TokenEvent, TradeEvent, FilterResult, PerformanceMetrics } from '../types/index.js';
import { logDetectedPool, logPerformanceMetric } from '../utils/logger.js';
import { tradingLogger } from '../logging/tradingLogger.js';
import { realTimeMonitor } from '../monitoring/realTimeMonitor.js';
import { sessionLogger } from '../logging/sessionLogger.js';

/**
 * High-performance event bus for processing 1000+ events/sec
 * Uses EventEmitter with optimized listeners and batching
 */
export class EventBus extends EventEmitter {
  private static instance: EventBus;
  private eventCounts = new Map<string, number>();
  private lastReset = Date.now();
  private batchBuffer: TokenEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_TIMEOUT = 50; // 50ms batching
  private readonly ENABLE_BATCH_PROCESSING = true; // Configuration flag
  private readonly ENABLE_INDIVIDUAL_PROCESSING = false; // Avoid duplicate processing

  private constructor() {
    super();
    this.setMaxListeners(1000); // High limit for performance
    
    // Performance monitoring
    setInterval(() => {
      this.emitPerformanceMetrics();
    }, 10000); // Every 10 seconds
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Emit token detection event with optimized batching for performance
   */
  emitTokenEvent(event: TokenEvent): void {
    this.incrementCounter('token_detected');
    
    realTimeMonitor.tokenDiscovered(event.mintAddress);
    
    sessionLogger.updateFilterStats({
      tokensDiscovered: (sessionLogger.getCurrentSession()?.filterStats.tokensDiscovered || 0) + 1
    });
    
    if (this.ENABLE_BATCH_PROCESSING) {
      // Add to batch buffer for high-throughput processing
      this.batchBuffer.push(event);
      
      // Process batch if full or start timer
      if (this.batchBuffer.length >= this.BATCH_SIZE) {
        this.processBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.processBatch();
        }, this.BATCH_TIMEOUT);
      }
    } else if (this.ENABLE_INDIVIDUAL_PROCESSING) {
      this.emit('token_detected', event);
    }
    
    logDetectedPool(event.mintAddress, event.source);
  }

  /**
   * Process batched token events for high throughput with optimized processing
   */
  private processBatch(): void {
    if (this.batchBuffer.length === 0) return;
    
    const batch = [...this.batchBuffer];
    this.batchBuffer = [];
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.ENABLE_BATCH_PROCESSING) {
      // Emit batch event for parallel processing (preferred for high throughput)
      this.emit('token_batch', batch);
    }
    
    if (this.ENABLE_INDIVIDUAL_PROCESSING) {
      // Emit individual events only if specifically needed for compatibility
      batch.forEach(event => {
        this.emit('token_detected', event);
      });
    }
  }

  /**
   * Emit filter result with performance tracking
   */
  emitFilterResult(mintAddress: string, result: FilterResult): void {
    this.incrementCounter(`filter_${result.filterName.toLowerCase()}`);
    
    const currentSession = sessionLogger.getCurrentSession();
    if (currentSession) {
      const stats = currentSession.filterStats;
      stats.tokensFiltered++;
      
      if (result.ok) {
        switch (result.filterName.toLowerCase()) {
          case 'routegate':
            stats.routeGatePassed++;
            break;
          case 'onchain':
            stats.onChainPassed++;
            break;
          case 'dexscreener':
            stats.dexScreenerPassed++;
            break;
        }
        stats.totalPassed++;
      }
      
      sessionLogger.updateFilterStats(stats);
    }
    
    this.emit('filter_result', { mintAddress, result });
  }

  /**
   * Emit trade event with performance tracking
   */
  emitTradeEvent(event: TradeEvent): void {
    this.incrementCounter(`trade_${event.type.toLowerCase()}`);
    
    if (event.success) {
      tradingLogger.logTrade({
        timestamp: new Date().toISOString(),
        mintAddress: event.mintAddress,
        action: event.type.toUpperCase() as 'BUY' | 'SELL' | 'STOP_LOSS' | 'TAKE_PROFIT',
        amount: event.amount,
        price: event.price,
        solAmount: event.type === 'buy' ? event.amount * event.price : event.amount,
        txHash: event.signature,
        reason: event.reason,
        pnl: event.pnl,
        pnlPercent: event.pnl && event.type === 'sell' ? (event.pnl / (event.amount * event.price)) * 100 : undefined
      });
      
      realTimeMonitor.tradeExecuted(event.mintAddress, event.type.toUpperCase(), event.pnl);
    }
    
    this.emit('trade_event', event);
  }

  /**
   * Emit performance metrics
   */
  emitPerformanceMetric(metrics: Partial<PerformanceMetrics>): void {
    this.emit('performance_metric', metrics);
    logPerformanceMetric(metrics);
  }

  /**
   * Get events per second calculation
   */
  getEventsPerSecond(): number {
    const elapsed = (Date.now() - this.lastReset) / 1000;
    const totalEvents = this.getTotalEvents();
    return elapsed > 0 ? Math.round(totalEvents / elapsed) : 0;
  }

  /**
   * Get total event count
   */
  getTotalEvents(): number {
    return Array.from(this.eventCounts.values()).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Get event counts by type
   */
  getEventCounts(): Map<string, number> {
    return new Map(this.eventCounts);
  }

  /**
   * Reset counters and emit performance metrics
   */
  private emitPerformanceMetrics(): void {
    const elapsed = Date.now() - this.lastReset;
    const totalEvents = this.getTotalEvents();
    const eventsPerSecond = elapsed > 0 ? Math.round((totalEvents * 1000) / elapsed) : 0;
    
    const metrics: Partial<PerformanceMetrics> = {
      eventsPerSecond,
      queueDepth: this.batchBuffer.length,
      uptime: elapsed,
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
    
    this.emitPerformanceMetric(metrics);
    
    // Reset counters
    this.eventCounts.clear();
    this.lastReset = Date.now();
  }

  /**
   * Increment event counter
   */
  private incrementCounter(event: string): void {
    const current = this.eventCounts.get(event) || 0;
    this.eventCounts.set(event, current + 1);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.removeAllListeners();
  }
}
