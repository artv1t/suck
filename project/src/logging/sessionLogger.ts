import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TradeRecord {
  timestamp: string;
  mintAddress: string;
  action: 'BUY' | 'SELL' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'AUTO_SELL';
  amount: number;
  price: number;
  solAmount: number;
  txHash?: string;
  reason?: string;
  pnl?: number;
  pnlPercent?: number;
  holdTime?: number;
  balanceAfter: number;
}

export interface FilterStats {
  tokensDiscovered: number;
  tokensFiltered: number;
  routeGatePassed: number;
  onChainPassed: number;
  dexScreenerPassed: number;
  totalPassed: number;
}

export interface PerformanceMetrics {
  peakTokensPerSecond: number;
  averageTokensPerSecond: number;
  memoryUsageMB: number;
  rpcLatencyMs: number;
  filterLatencyMs: number;
}

export interface SessionReport {
  sessionId: string;
  sessionNumber: number;
  startTime: string;
  endTime?: string;
  duration?: number;
  startingBalance: number;
  endingBalance?: number;
  totalPnL?: number;
  totalPnLPercent?: number;
  trades: TradeRecord[];
  filterStats: FilterStats;
  performanceMetrics: PerformanceMetrics;
  bestTrade?: TradeRecord;
  worstTrade?: TradeRecord;
  successfulTrades: number;
  failedTrades: number;
  autoSellCount: number;
  positionsAtShutdown: string[];
}

export class SessionLogger {
  private static instance: SessionLogger;
  private currentSession: SessionReport | null = null;
  private logsDir: string;
  private sessionNumber: number = 0;

  private constructor() {
    this.logsDir = path.join(path.dirname(__dirname), '..', 'trading_logs');
    this.ensureLogsDirectory();
    this.sessionNumber = this.getNextSessionNumber();
  }

  static getInstance(): SessionLogger {
    if (!SessionLogger.instance) {
      SessionLogger.instance = new SessionLogger();
    }
    return SessionLogger.instance;
  }

  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
      logger.info(`📁 Created trading logs directory: ${this.logsDir}`);
    }
  }

  private getNextSessionNumber(): number {
    try {
      const files = fs.readdirSync(this.logsDir);
      const sessionFiles = files.filter(file => file.match(/^run_\d{3}\.json$/));
      
      if (sessionFiles.length === 0) {
        return 1;
      }

      const numbers = sessionFiles.map(file => {
        const match = file.match(/^run_(\d{3})\.json$/);
        return match ? parseInt(match[1], 10) : 0;
      });

      return Math.max(...numbers) + 1;
    } catch (error) {
      logger.warn('Error reading logs directory, starting from session 1:', error);
      return 1;
    }
  }

  startSession(startingBalance: number): void {
    const sessionId = `session_${Date.now()}`;
    this.sessionNumber = this.getNextSessionNumber();

    this.currentSession = {
      sessionId,
      sessionNumber: this.sessionNumber,
      startTime: new Date().toISOString(),
      startingBalance,
      trades: [],
      filterStats: {
        tokensDiscovered: 0,
        tokensFiltered: 0,
        routeGatePassed: 0,
        onChainPassed: 0,
        dexScreenerPassed: 0,
        totalPassed: 0
      },
      performanceMetrics: {
        peakTokensPerSecond: 0,
        averageTokensPerSecond: 0,
        memoryUsageMB: 0,
        rpcLatencyMs: 0,
        filterLatencyMs: 0
      },
      successfulTrades: 0,
      failedTrades: 0,
      autoSellCount: 0,
      positionsAtShutdown: []
    };

    logger.info(`📊 Session ${this.sessionNumber} started with balance: ${startingBalance.toFixed(6)} SOL`);
  }

  logTrade(trade: Omit<TradeRecord, 'balanceAfter'>, currentBalance: number): void {
    if (!this.currentSession) {
      logger.warn('No active session to log trade');
      return;
    }

    const tradeRecord: TradeRecord = {
      ...trade,
      balanceAfter: currentBalance
    };

    this.currentSession.trades.push(tradeRecord);

    if (trade.action === 'AUTO_SELL') {
      this.currentSession.autoSellCount++;
    }

    if (trade.pnl !== undefined) {
      if (trade.pnl > 0) {
        this.currentSession.successfulTrades++;
      } else {
        this.currentSession.failedTrades++;
      }

      if (!this.currentSession.bestTrade || trade.pnl > (this.currentSession.bestTrade.pnl || 0)) {
        this.currentSession.bestTrade = tradeRecord;
      }

      if (!this.currentSession.worstTrade || trade.pnl < (this.currentSession.worstTrade.pnl || 0)) {
        this.currentSession.worstTrade = tradeRecord;
      }
    }

    this.saveCurrentSession();
    logger.debug(`📝 Trade logged: ${trade.action} ${trade.mintAddress} | Balance: ${currentBalance.toFixed(6)} SOL`);
  }

  updateFilterStats(stats: Partial<FilterStats>): void {
    if (!this.currentSession) return;

    Object.assign(this.currentSession.filterStats, stats);
    this.saveCurrentSession();
  }

  updatePerformanceMetrics(metrics: Partial<PerformanceMetrics>): void {
    if (!this.currentSession) return;

    Object.assign(this.currentSession.performanceMetrics, metrics);
    this.saveCurrentSession();
  }

  logPositionAtShutdown(mintAddress: string): void {
    if (!this.currentSession) return;

    this.currentSession.positionsAtShutdown.push(mintAddress);
  }

  finalizeSession(endingBalance: number): void {
    if (!this.currentSession) {
      logger.warn('No active session to finalize');
      return;
    }

    const endTime = new Date().toISOString();
    const startTime = new Date(this.currentSession.startTime);
    const duration = Date.now() - startTime.getTime();

    this.currentSession.endTime = endTime;
    this.currentSession.duration = duration;
    this.currentSession.endingBalance = endingBalance;
    this.currentSession.totalPnL = endingBalance - this.currentSession.startingBalance;
    this.currentSession.totalPnLPercent = (this.currentSession.totalPnL / this.currentSession.startingBalance) * 100;

    this.saveCurrentSession();

    logger.info(`📊 Session ${this.sessionNumber} finalized:`);
    logger.info(`   Duration: ${Math.round(duration / 1000)}s`);
    logger.info(`   Starting Balance: ${this.currentSession.startingBalance.toFixed(6)} SOL`);
    logger.info(`   Ending Balance: ${endingBalance.toFixed(6)} SOL`);
    logger.info(`   Total P&L: ${this.currentSession.totalPnL.toFixed(6)} SOL (${this.currentSession.totalPnLPercent.toFixed(2)}%)`);
    logger.info(`   Trades: ${this.currentSession.trades.length} | Successful: ${this.currentSession.successfulTrades} | Failed: ${this.currentSession.failedTrades}`);
    logger.info(`   Auto-sells: ${this.currentSession.autoSellCount}`);

    this.currentSession = null;
  }

  private saveCurrentSession(): void {
    if (!this.currentSession) return;

    try {
      const filename = `run_${this.sessionNumber.toString().padStart(3, '0')}.json`;
      const filepath = path.join(this.logsDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(this.currentSession, null, 2));
    } catch (error) {
      logger.error('Error saving session:', error);
    }
  }

  getCurrentSession(): SessionReport | null {
    return this.currentSession;
  }

  getSessionByNumber(sessionNumber: number): SessionReport | null {
    try {
      const filename = `run_${sessionNumber.toString().padStart(3, '0')}.json`;
      const filepath = path.join(this.logsDir, filename);
      
      if (!fs.existsSync(filepath)) {
        return null;
      }

      const data = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Error reading session ${sessionNumber}:`, error);
      return null;
    }
  }

  getLatestSession(): SessionReport | null {
    try {
      const files = fs.readdirSync(this.logsDir);
      const sessionFiles = files.filter(file => file.match(/^run_\d{3}\.json$/));
      
      if (sessionFiles.length === 0) {
        return null;
      }

      sessionFiles.sort((a, b) => {
        const aNum = parseInt(a.match(/^run_(\d{3})\.json$/)![1], 10);
        const bNum = parseInt(b.match(/^run_(\d{3})\.json$/)![1], 10);
        return bNum - aNum;
      });

      const latestFile = sessionFiles[0];
      const filepath = path.join(this.logsDir, latestFile);
      const data = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Error reading latest session:', error);
      return null;
    }
  }

  getAllSessions(): SessionReport[] {
    try {
      const files = fs.readdirSync(this.logsDir);
      const sessionFiles = files.filter(file => file.match(/^run_\d{3}\.json$/));
      
      const sessions: SessionReport[] = [];
      
      for (const file of sessionFiles) {
        try {
          const filepath = path.join(this.logsDir, file);
          const data = fs.readFileSync(filepath, 'utf8');
          sessions.push(JSON.parse(data));
        } catch (error) {
          logger.warn(`Error reading session file ${file}:`, error);
        }
      }

      return sessions.sort((a, b) => b.sessionNumber - a.sessionNumber);
    } catch (error) {
      logger.error('Error reading all sessions:', error);
      return [];
    }
  }
}

export const sessionLogger = SessionLogger.getInstance();
