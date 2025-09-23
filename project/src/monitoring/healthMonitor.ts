import { EventBus } from '../core/eventBus.js';
import { BotManager } from '../core/botManager.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import Database from 'better-sqlite3';

export interface HealthMetric {
  name: string;
  value: number;
  unit: string;
  status: 'healthy' | 'warning' | 'critical';
  threshold: {
    warning: number;
    critical: number;
  };
  timestamp: number;
}

export interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical';
  score: number;
  metrics: HealthMetric[];
  alerts: HealthAlert[];
  uptime: number;
  lastCheck: number;
}

export interface HealthAlert {
  id: string;
  type: 'performance' | 'error' | 'security' | 'trading';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
}

/**
 * Comprehensive Health Monitoring System
 * Tracks all aspects of bot performance and health
 */
export class HealthMonitor {
  private _eventBus: EventBus;
  private botManager: BotManager;
  private db: Database.Database;
  private metrics = new Map<string, HealthMetric>();
  private alerts: HealthAlert[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL = 5000; // 5 seconds
  private readonly ALERT_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly MAX_ALERTS = 1000;

  constructor(botManager: BotManager) {
    this._eventBus = EventBus.getInstance();
    this.botManager = botManager;
    this.db = new Database(config.dbPath);
    this.initializeDatabase();
    this.loadAlerts();
    this.startMonitoring();
  }

  /**
   * Initialize health monitoring database
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        status TEXT NOT NULL,
        warning_threshold REAL NOT NULL,
        critical_threshold REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        resolved BOOLEAN DEFAULT FALSE,
        resolved_at INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_health_metrics_timestamp ON health_metrics(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_health_alerts_timestamp ON health_alerts(timestamp)`);
  }

  /**
   * Load existing alerts from database
   */
  private loadAlerts(): void {
    const stmt = this.db.prepare('SELECT * FROM health_alerts WHERE resolved = FALSE ORDER BY timestamp DESC LIMIT 100');
    const rows = stmt.all();
    
    this.alerts = rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      message: row.message,
      timestamp: row.timestamp,
      resolved: row.resolved,
      resolvedAt: row.resolved_at
    }));

    logger.info(`📊 Loaded ${this.alerts.length} active health alerts`);
  }

  /**
   * Start health monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.MONITORING_INTERVAL);

    this.alertInterval = setInterval(() => {
      this.checkAlerts();
    }, this.ALERT_CHECK_INTERVAL);

    logger.info('📊 Health monitoring started');
  }

  /**
   * Collect all health metrics
   */
  private collectMetrics(): void {
    const timestamp = Date.now();

    // System metrics
    this.collectSystemMetrics(timestamp);
    
    // Bot metrics
    this.collectBotMetrics(timestamp);
    
    // Trading metrics
    this.collectTradingMetrics(timestamp);
    
    // Performance metrics
    this.collectPerformanceMetrics(timestamp);
    
    // RPC metrics
    this.collectRPCMetrics(timestamp);

    // Save metrics to database (sample every minute)
    if (timestamp % 60000 < this.MONITORING_INTERVAL) {
      this.saveMetricsToDatabase();
    }
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(timestamp: number): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Memory usage
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    this.setMetric('memory_heap_used', heapUsedMB, 'MB', {
      warning: config.memoryLimit * 0.7,
      critical: config.memoryLimit * 0.9
    }, timestamp);

    // Memory utilization percentage
    const memoryUtilization = (heapUsedMB / config.memoryLimit) * 100;
    this.setMetric('memory_utilization', memoryUtilization, '%', {
      warning: 70,
      critical: 90
    }, timestamp);

    // CPU usage (approximation)
    const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000) / (this.MONITORING_INTERVAL / 1000) * 100;
    this.setMetric('cpu_usage', Math.min(cpuPercent, 100), '%', {
      warning: 70,
      critical: 90
    }, timestamp);

    // Uptime
    const uptimeHours = process.uptime() / 3600;
    this.setMetric('uptime', uptimeHours, 'hours', {
      warning: 0,
      critical: 0
    }, timestamp);
  }

  /**
   * Collect bot metrics
   */
  private collectBotMetrics(timestamp: number): void {
    const status = this.botManager.getStatus();

    // Events per second
    this.setMetric('events_per_second', status.totalEvents / (status.uptime / 1000), 'events/s', {
      warning: 100,
      critical: 50
    }, timestamp);

    // Open positions
    this.setMetric('open_positions', status.openPositions, 'positions', {
      warning: config.maxPositions * 0.8,
      critical: config.maxPositions * 0.95
    }, timestamp);

    // Circuit breaker status
    this.setMetric('circuit_breaker_active', status.circuitBreakerActive ? 1 : 0, 'boolean', {
      warning: 0.5,
      critical: 0.5
    }, timestamp);
  }

  /**
   * Collect trading metrics
   */
  private collectTradingMetrics(timestamp: number): void {
    const status = this.botManager.getStatus();
    const positions = this.botManager.getOpenPositions();

    // Total PnL
    this.setMetric('total_pnl', status.totalPnl, 'SOL', {
      warning: -0.01,
      critical: -0.05
    }, timestamp);

    // Win rate
    const closedPositions = positions.filter(p => p.status === 'sold');
    const winningTrades = closedPositions.filter(p => (p.pnl || 0) > 0).length;
    const winRate = closedPositions.length > 0 ? (winningTrades / closedPositions.length) * 100 : 0;
    
    this.setMetric('win_rate', winRate, '%', {
      warning: 40,
      critical: 20
    }, timestamp);

    // Average trade size
    const avgTradeSize = closedPositions.length > 0 
      ? closedPositions.reduce((sum, p) => sum + p.buyAmount, 0) / closedPositions.length 
      : 0;
    
    this.setMetric('avg_trade_size', avgTradeSize, 'tokens', {
      warning: 0,
      critical: 0
    }, timestamp);
  }

  /**
   * Collect performance metrics
   */
  private collectPerformanceMetrics(timestamp: number): void {
    const metrics = this.botManager.getMetrics();

    // Filter pipeline utilization
    if (metrics.filters) {
      const filterUtilization = (metrics.filters.processingCount / metrics.filters.maxConcurrent) * 100;
      this.setMetric('filter_utilization', filterUtilization, '%', {
        warning: 80,
        critical: 95
      }, timestamp);
    }

    // Trader utilization
    if (metrics.trader) {
      const traderUtilization = (metrics.trader.activeTrades / metrics.trader.maxConcurrentTrades) * 100;
      this.setMetric('trader_utilization', traderUtilization, '%', {
        warning: 80,
        critical: 95
      }, timestamp);
    }

    // Queue depth
    if (metrics.detector) {
      this.setMetric('queue_depth', metrics.detector.queueSize, 'events', {
        warning: 1000,
        critical: 5000
      }, timestamp);
    }
  }

  /**
   * Collect RPC metrics
   */
  private collectRPCMetrics(timestamp: number): void {
    const metrics = this.botManager.getMetrics();

    if (metrics.rpc) {
      // RPC health percentage
      const rpcHealthPercent = metrics.rpc.totalEndpoints > 0 
        ? (metrics.rpc.healthyEndpoints / metrics.rpc.totalEndpoints) * 100 
        : 0;
      
      this.setMetric('rpc_health', rpcHealthPercent, '%', {
        warning: 70,
        critical: 50
      }, timestamp);

      // Average RPC latency
      this.setMetric('rpc_latency', metrics.rpc.averageLatency || 0, 'ms', {
        warning: 500,
        critical: 1000
      }, timestamp);
    }
  }

  /**
   * Set metric with status calculation
   */
  private setMetric(name: string, value: number, unit: string, threshold: { warning: number; critical: number }, timestamp: number): void {
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    if (name === 'circuit_breaker_active' && value > 0) {
      status = 'critical';
    } else if (name === 'rpc_health' || name === 'win_rate') {
      // Lower is worse for these metrics
      if (value <= threshold.critical) status = 'critical';
      else if (value <= threshold.warning) status = 'warning';
    } else {
      // Higher is worse for most metrics
      if (value >= threshold.critical) status = 'critical';
      else if (value >= threshold.warning) status = 'warning';
    }

    this.metrics.set(name, {
      name,
      value,
      unit,
      status,
      threshold,
      timestamp
    });
  }

  /**
   * Check for alerts based on metrics
   */
  private checkAlerts(): void {
    for (const metric of this.metrics.values()) {
      if (metric.status === 'critical') {
        this.createAlert('performance', 'critical', 
          `Critical: ${metric.name} is ${metric.value}${metric.unit} (threshold: ${metric.threshold.critical}${metric.unit})`);
      } else if (metric.status === 'warning') {
        this.createAlert('performance', 'high', 
          `Warning: ${metric.name} is ${metric.value}${metric.unit} (threshold: ${metric.threshold.warning}${metric.unit})`);
      }
    }

    // Check for trading-specific alerts
    this.checkTradingAlerts();
    
    // Check for error rate alerts
    this.checkErrorAlerts();
  }

  /**
   * Check trading-specific alerts
   */
  private checkTradingAlerts(): void {
    const status = this.botManager.getStatus();
    
    // No trades for extended period
    if (status.running && status.uptime > 300000 && status.totalTrades === 0) { // 5 minutes
      this.createAlert('trading', 'medium', 'No trades executed in the last 5 minutes');
    }

    // High loss alert
    if (status.totalPnl < -0.01) {
      this.createAlert('trading', 'high', `High losses detected: ${status.totalPnl.toFixed(6)} SOL`);
    }
  }

  /**
   * Check error rate alerts
   */
  private checkErrorAlerts(): void {
    // This would integrate with error tracking
    // For now, we'll check circuit breaker status
    const status = this.botManager.getStatus();
    
    if (status.circuitBreakerActive) {
      this.createAlert('error', 'critical', 'Circuit breaker is active - bot trading paused');
    }
  }

  /**
   * Create new alert
   */
  private createAlert(type: string, severity: string, message: string): void {
    // Check if similar alert already exists
    const existingAlert = this.alerts.find(alert => 
      !alert.resolved && alert.message === message && alert.type === type
    );
    
    if (existingAlert) return; // Don't create duplicate alerts

    const alert: HealthAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: type as any,
      severity: severity as any,
      message,
      timestamp: Date.now(),
      resolved: false
    };

    this.alerts.unshift(alert);
    
    // Limit alerts array size
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, this.MAX_ALERTS);
    }

    // Save to database
    this.saveAlert(alert);

    // Log critical alerts
    if (severity === 'critical') {
      logger.error(`🚨 CRITICAL ALERT: ${message}`);
    } else if (severity === 'high') {
      logger.warn(`⚠️ HIGH ALERT: ${message}`);
    }
  }

  /**
   * Save alert to database
   */
  private saveAlert(alert: HealthAlert): void {
    const stmt = this.db.prepare(`
      INSERT INTO health_alerts (id, type, severity, message, timestamp, resolved, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(alert.id, alert.type, alert.severity, alert.message, alert.timestamp, alert.resolved ? 1 : 0, alert.resolvedAt || null);
  }

  /**
   * Save metrics to database
   */
  private saveMetricsToDatabase(): void {
    const stmt = this.db.prepare(`
      INSERT INTO health_metrics (name, value, unit, status, warning_threshold, critical_threshold, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const metric of this.metrics.values()) {
      stmt.run(
        metric.name,
        metric.value || 0,
        metric.unit,
        metric.status,
        metric.threshold.warning,
        metric.threshold.critical,
        metric.timestamp
      );
    }
  }

  /**
   * Get current system health
   */
  getSystemHealth(): SystemHealth {
    const metrics = Array.from(this.metrics.values());
    const activeAlerts = this.alerts.filter(alert => !alert.resolved);
    
    // Calculate overall health score
    let score = 100;
    let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    for (const metric of metrics) {
      if (metric.status === 'critical') {
        score -= 20;
        overallStatus = 'critical';
      } else if (metric.status === 'warning') {
        score -= 5;
        if (overallStatus === 'healthy') overallStatus = 'warning';
      }
    }
    
    score = Math.max(0, score);

    return {
      overall: overallStatus,
      score,
      metrics,
      alerts: activeAlerts,
      uptime: process.uptime(),
      lastCheck: Date.now()
    };
  }

  /**
   * Get health metrics history
   */
  getMetricsHistory(metricName: string, hours: number = 24): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM health_metrics 
      WHERE name = ? AND timestamp > ? 
      ORDER BY timestamp DESC
    `);
    
    const since = Date.now() - (hours * 60 * 60 * 1000);
    return stmt.all(metricName, since);
  }

  /**
   * Get all alerts
   */
  getAlerts(limit: number = 100, resolved?: boolean): HealthAlert[] {
    let alerts = this.alerts;
    
    if (resolved !== undefined) {
      alerts = alerts.filter(alert => alert.resolved === resolved);
    }
    
    return alerts.slice(0, limit);
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert || alert.resolved) return false;
    
    alert.resolved = true;
    alert.resolvedAt = Date.now();
    
    // Update in database
    const stmt = this.db.prepare('UPDATE health_alerts SET resolved = 1, resolved_at = ? WHERE id = ?');
    stmt.run(alert.resolvedAt, alertId);
    
    return true;
  }

  /**
   * Get health summary for API
   */
  getHealthSummary(): any {
    const health = this.getSystemHealth();
    const criticalAlerts = health.alerts.filter(a => a.severity === 'critical').length;
    const warningAlerts = health.alerts.filter(a => a.severity === 'high' || a.severity === 'medium').length;
    
    return {
      status: health.overall,
      score: health.score,
      uptime: health.uptime,
      criticalAlerts,
      warningAlerts,
      totalAlerts: health.alerts.length,
      keyMetrics: {
        memoryUsage: this.metrics.get('memory_heap_used')?.value || 0,
        cpuUsage: this.metrics.get('cpu_usage')?.value || 0,
        rpcHealth: this.metrics.get('rpc_health')?.value || 0,
        eventsPerSecond: this.metrics.get('events_per_second')?.value || 0,
        openPositions: this.metrics.get('open_positions')?.value || 0
      },
      lastCheck: health.lastCheck
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }
    this.db.close();
  }
}