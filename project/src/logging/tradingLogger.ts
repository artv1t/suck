import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface TradeLogEntry {
  timestamp: string;
  mintAddress: string;
  action: 'BUY' | 'SELL' | 'STOP_LOSS' | 'TAKE_PROFIT';
  amount: number;
  price: number;
  solAmount: number;
  txHash?: string;
  reason?: string;
  pnl?: number;
  pnlPercent?: number;
  holdTime?: number;
  filterResults?: {
    routeGate: { passed: boolean; score: number; latency: number };
    onChain: { passed: boolean; score: number; latency: number };
    dexScreener: { passed: boolean; score: number; latency: number };
  };
}

export interface FilterTestEntry {
  timestamp: string;
  mintAddress: string;
  filterName: string;
  passed: boolean;
  score: number;
  latency: number;
  reason: string;
  cacheHit?: boolean;
}

export interface PerformanceMetric {
  timestamp: string;
  tokensPerSecond: number;
  memoryUsage: number;
  rpcLatency: number;
  rpcHealth: string;
  activePositions: number;
  totalPnL: number;
  successRate: number;
}

export class TradingLogger {
  private logsDir: string;
  private tradeLogFile: string;
  private filterLogFile: string;
  private performanceLogFile: string;
  private dailyStatsFile: string;

  constructor() {
    this.logsDir = join(process.cwd(), 'logs');
    this.ensureLogsDirectory();
    
    const today = new Date().toISOString().split('T')[0];
    this.tradeLogFile = join(this.logsDir, `trades_${today}.json`);
    this.filterLogFile = join(this.logsDir, `filters_${today}.json`);
    this.performanceLogFile = join(this.logsDir, `performance_${today}.json`);
    this.dailyStatsFile = join(this.logsDir, `daily_stats_${today}.json`);
    
    this.initializeLogFiles();
  }

  private ensureLogsDirectory(): void {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private initializeLogFiles(): void {
    if (!existsSync(this.tradeLogFile)) {
      writeFileSync(this.tradeLogFile, '[]');
    }
    if (!existsSync(this.filterLogFile)) {
      writeFileSync(this.filterLogFile, '[]');
    }
    if (!existsSync(this.performanceLogFile)) {
      writeFileSync(this.performanceLogFile, '[]');
    }
    if (!existsSync(this.dailyStatsFile)) {
      const initialStats = {
        date: new Date().toISOString().split('T')[0],
        totalTrades: 0,
        successfulTrades: 0,
        totalPnL: 0,
        bestTrade: null,
        worstTrade: null,
        averageHoldTime: 0,
        tokensDiscovered: 0,
        tokensFiltered: 0,
        filterPassRate: 0
      };
      writeFileSync(this.dailyStatsFile, JSON.stringify(initialStats, null, 2));
    }
  }

  logTrade(entry: TradeLogEntry): void {
    const logEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };

    this.appendToJsonFile(this.tradeLogFile, logEntry);
    this.updateDailyStats(logEntry);
    
    console.log(`💰 TRADE LOG: ${entry.action} ${entry.mintAddress} - ${entry.solAmount} SOL ${entry.pnl ? `(PnL: ${entry.pnl > 0 ? '+' : ''}${entry.pnl.toFixed(6)} SOL, ${entry.pnlPercent?.toFixed(2)}%)` : ''}`);
  }

  logFilterResult(entry: FilterTestEntry): void {
    const logEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };

    this.appendToJsonFile(this.filterLogFile, logEntry);
    
    const status = entry.passed ? '✅' : '❌';
    const cache = entry.cacheHit ? '🔄' : '🆕';
    console.log(`🔍 FILTER: ${status} ${cache} ${entry.filterName} - ${entry.mintAddress} (${entry.latency}ms, score: ${entry.score})`);
  }

  logPerformance(metric: PerformanceMetric): void {
    const logEntry = {
      ...metric,
      timestamp: new Date().toISOString()
    };

    this.appendToJsonFile(this.performanceLogFile, logEntry);
    
    console.log(`📊 PERFORMANCE: ${metric.tokensPerSecond.toFixed(1)} tokens/sec | Memory: ${metric.memoryUsage}MB | RPC: ${metric.rpcLatency}ms | Positions: ${metric.activePositions} | PnL: ${metric.totalPnL.toFixed(6)} SOL`);
  }

  private appendToJsonFile(filePath: string, entry: any): void {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      data.push(entry);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error writing to log file ${filePath}:`, error);
    }
  }

  private updateDailyStats(trade: TradeLogEntry): void {
    try {
      const stats = JSON.parse(readFileSync(this.dailyStatsFile, 'utf8'));
      
      stats.totalTrades++;
      if (trade.pnl && trade.pnl > 0) {
        stats.successfulTrades++;
      }
      
      if (trade.pnl) {
        stats.totalPnL += trade.pnl;
        
        if (!stats.bestTrade || trade.pnl > stats.bestTrade.pnl) {
          stats.bestTrade = trade;
        }
        
        if (!stats.worstTrade || trade.pnl < stats.worstTrade.pnl) {
          stats.worstTrade = trade;
        }
      }
      
      if (trade.holdTime) {
        stats.averageHoldTime = (stats.averageHoldTime * (stats.totalTrades - 1) + trade.holdTime) / stats.totalTrades;
      }
      
      writeFileSync(this.dailyStatsFile, JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('Error updating daily stats:', error);
    }
  }

  getDailyStats(): any {
    try {
      return JSON.parse(readFileSync(this.dailyStatsFile, 'utf8'));
    } catch (error) {
      console.error('Error reading daily stats:', error);
      return null;
    }
  }

  getRecentTrades(limit: number = 10): TradeLogEntry[] {
    try {
      const trades = JSON.parse(readFileSync(this.tradeLogFile, 'utf8'));
      return trades.slice(-limit);
    } catch (error) {
      console.error('Error reading trade log:', error);
      return [];
    }
  }

  getFilterStats(): any {
    try {
      const filters = JSON.parse(readFileSync(this.filterLogFile, 'utf8'));
      const stats = {
        routeGate: { total: 0, passed: 0, avgLatency: 0 },
        onChain: { total: 0, passed: 0, avgLatency: 0 },
        dexScreener: { total: 0, passed: 0, avgLatency: 0 }
      };

      filters.forEach((entry: FilterTestEntry) => {
        const filter = stats[entry.filterName as keyof typeof stats];
        if (filter) {
          filter.total++;
          if (entry.passed) filter.passed++;
          filter.avgLatency = (filter.avgLatency * (filter.total - 1) + entry.latency) / filter.total;
        }
      });

      return stats;
    } catch (error) {
      console.error('Error reading filter stats:', error);
      return null;
    }
  }

  printLiveStats(): void {
    const dailyStats = this.getDailyStats();
    const filterStats = this.getFilterStats();
    const recentTrades = this.getRecentTrades(5);

    console.log('\n' + '='.repeat(80));
    console.log('📊 LIVE TRADING STATISTICS');
    console.log('='.repeat(80));
    
    if (dailyStats) {
      console.log(`📅 Date: ${dailyStats.date}`);
      console.log(`💰 Total PnL: ${dailyStats.totalPnL.toFixed(6)} SOL`);
      console.log(`📈 Trades: ${dailyStats.successfulTrades}/${dailyStats.totalTrades} (${((dailyStats.successfulTrades / Math.max(dailyStats.totalTrades, 1)) * 100).toFixed(1)}% success)`);
      console.log(`⏱️  Average Hold Time: ${(dailyStats.averageHoldTime / 1000 / 60).toFixed(1)} minutes`);
      
      if (dailyStats.bestTrade) {
        console.log(`🏆 Best Trade: +${dailyStats.bestTrade.pnl.toFixed(6)} SOL (${dailyStats.bestTrade.pnlPercent?.toFixed(2)}%)`);
      }
      if (dailyStats.worstTrade) {
        console.log(`📉 Worst Trade: ${dailyStats.worstTrade.pnl.toFixed(6)} SOL (${dailyStats.worstTrade.pnlPercent?.toFixed(2)}%)`);
      }
    }

    if (filterStats) {
      console.log('\n🔍 FILTER PERFORMANCE:');
      Object.entries(filterStats).forEach(([name, stats]: [string, any]) => {
        const passRate = ((stats.passed / Math.max(stats.total, 1)) * 100).toFixed(1);
        console.log(`  ${name}: ${stats.passed}/${stats.total} (${passRate}%) - ${stats.avgLatency.toFixed(0)}ms avg`);
      });
    }

    if (recentTrades.length > 0) {
      console.log('\n💼 RECENT TRADES:');
      recentTrades.forEach(trade => {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        const pnlStr = trade.pnl ? `${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(6)} SOL` : 'N/A';
        console.log(`  ${time} | ${trade.action} | ${trade.mintAddress.slice(0, 8)}... | ${pnlStr}`);
      });
    }

    console.log('='.repeat(80) + '\n');
  }
}


export const tradingLogger = new TradingLogger();
