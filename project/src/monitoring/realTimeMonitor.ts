import { EventEmitter } from 'events';
import { tradingLogger, PerformanceMetric } from '../logging/tradingLogger.js';

export interface MonitoringData {
  timestamp: string;
  botStatus: 'RUNNING' | 'STOPPED' | 'ERROR';
  uptime: number;
  tokensDiscovered: number;
  tokensFiltered: number;
  activePositions: number;
  totalPnL: number;
  memoryUsage: number;
  rpcHealth: {
    healthy: number;
    total: number;
    avgLatency: number;
  };
  filterPerformance: {
    routeGate: { passRate: number; avgLatency: number };
    onChain: { passRate: number; avgLatency: number };
    dexScreener: { passRate: number; avgLatency: number };
  };
  recentActivity: string[];
}

export class RealTimeMonitor extends EventEmitter {
  private startTime: number;
  private tokensDiscovered: number = 0;
  private tokensFiltered: number = 0;
  private activePositions: number = 0;
  private totalPnL: number = 0;
  private recentActivity: string[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.startTime = Date.now();
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🔴 Real-time monitoring started');
    
    this.monitoringInterval = setInterval(() => {
      this.collectAndEmitData();
    }, 5000); // Update every 5 seconds
    
    this.setupEventListeners();
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    console.log('⚫ Real-time monitoring stopped');
  }

  private setupEventListeners(): void {
    this.on('tokenDiscovered', (mintAddress: string) => {
      this.tokensDiscovered++;
      this.addActivity(`🔍 Discovered: ${mintAddress.slice(0, 8)}...`);
    });

    this.on('tokenFiltered', (mintAddress: string, passed: boolean) => {
      this.tokensFiltered++;
      const status = passed ? '✅ Passed' : '❌ Filtered';
      this.addActivity(`${status}: ${mintAddress.slice(0, 8)}...`);
    });

    this.on('tradeExecuted', (mintAddress: string, action: string, pnl?: number) => {
      if (action === 'BUY') {
        this.activePositions++;
      } else if (action === 'SELL' || action === 'STOP_LOSS' || action === 'TAKE_PROFIT') {
        this.activePositions = Math.max(0, this.activePositions - 1);
        if (pnl !== undefined) {
          this.totalPnL += pnl;
        }
      }
      
      const pnlStr = pnl !== undefined ? ` (${pnl > 0 ? '+' : ''}${pnl.toFixed(6)} SOL)` : '';
      this.addActivity(`💰 ${action}: ${mintAddress.slice(0, 8)}...${pnlStr}`);
    });
  }

  private addActivity(activity: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.recentActivity.unshift(`${timestamp} - ${activity}`);
    
    if (this.recentActivity.length > 20) {
      this.recentActivity = this.recentActivity.slice(0, 20);
    }
  }

  private async collectAndEmitData(): Promise<void> {
    try {
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const uptime = Date.now() - this.startTime;
      
      const filterStats = tradingLogger.getFilterStats() || {
        routeGate: { total: 0, passed: 0, avgLatency: 0 },
        onChain: { total: 0, passed: 0, avgLatency: 0 },
        dexScreener: { total: 0, passed: 0, avgLatency: 0 }
      };

      const monitoringData: MonitoringData = {
        timestamp: new Date().toISOString(),
        botStatus: 'RUNNING',
        uptime,
        tokensDiscovered: this.tokensDiscovered,
        tokensFiltered: this.tokensFiltered,
        activePositions: this.activePositions,
        totalPnL: this.totalPnL,
        memoryUsage,
        rpcHealth: {
          healthy: 2, // Will be updated by RPC manager
          total: 2,
          avgLatency: 76 // Will be updated by RPC manager
        },
        filterPerformance: {
          routeGate: {
            passRate: (filterStats.routeGate.passed / Math.max(filterStats.routeGate.total, 1)) * 100,
            avgLatency: filterStats.routeGate.avgLatency
          },
          onChain: {
            passRate: (filterStats.onChain.passed / Math.max(filterStats.onChain.total, 1)) * 100,
            avgLatency: filterStats.onChain.avgLatency
          },
          dexScreener: {
            passRate: (filterStats.dexScreener.passed / Math.max(filterStats.dexScreener.total, 1)) * 100,
            avgLatency: filterStats.dexScreener.avgLatency
          }
        },
        recentActivity: [...this.recentActivity]
      };

      this.emit('monitoringUpdate', monitoringData);
      
      const performanceMetric: PerformanceMetric = {
        timestamp: new Date().toISOString(),
        tokensPerSecond: this.tokensDiscovered / (uptime / 1000),
        memoryUsage,
        rpcLatency: monitoringData.rpcHealth.avgLatency,
        rpcHealth: `${monitoringData.rpcHealth.healthy}/${monitoringData.rpcHealth.total} healthy`,
        activePositions: this.activePositions,
        totalPnL: this.totalPnL,
        successRate: this.activePositions > 0 ? (this.totalPnL > 0 ? 100 : 0) : 0
      };

      tradingLogger.logPerformance(performanceMetric);
      
    } catch (error) {
      console.error('Error collecting monitoring data:', error);
    }
  }

  printLiveStatus(): void {
    const uptime = Date.now() - this.startTime;
    const uptimeMinutes = Math.floor(uptime / 1000 / 60);
    const uptimeSeconds = Math.floor((uptime / 1000) % 60);
    
    console.log('\n' + '🔴'.repeat(40));
    console.log('🔴 LIVE BOT STATUS');
    console.log('🔴'.repeat(40));
    console.log(`⏱️  Uptime: ${uptimeMinutes}m ${uptimeSeconds}s`);
    console.log(`🔍 Tokens Discovered: ${this.tokensDiscovered}`);
    console.log(`🔄 Tokens Filtered: ${this.tokensFiltered}`);
    console.log(`💼 Active Positions: ${this.activePositions}`);
    console.log(`💰 Total PnL: ${this.totalPnL.toFixed(6)} SOL`);
    console.log(`📊 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    
    if (this.recentActivity.length > 0) {
      console.log('\n📋 RECENT ACTIVITY:');
      this.recentActivity.slice(0, 10).forEach(activity => {
        console.log(`  ${activity}`);
      });
    }
    
    console.log('🔴'.repeat(40) + '\n');
  }

  updateRPCHealth(healthy: number, total: number, avgLatency: number): void {
    this.emit('rpcHealthUpdate', { healthy, total, avgLatency });
  }

  tokenDiscovered(mintAddress: string): void {
    this.emit('tokenDiscovered', mintAddress);
  }

  tokenFiltered(mintAddress: string, passed: boolean): void {
    this.emit('tokenFiltered', mintAddress, passed);
  }

  tradeExecuted(mintAddress: string, action: string, pnl?: number): void {
    this.emit('tradeExecuted', mintAddress, action, pnl);
  }
}

export const realTimeMonitor = new RealTimeMonitor();
