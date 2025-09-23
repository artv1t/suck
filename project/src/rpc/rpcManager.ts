import { Connection, Commitment } from '@solana/web3.js';
import { config } from '../config/index.js';
import { RPCHealth } from '../types/index.js';
import { logHealthCheck } from '../utils/logger.js';

/**
 * High-performance RPC manager with connection pooling and health monitoring
 * Supports 10+ RPC endpoints with automatic failover and load balancing
 */
export class RPCManager {
  private connections = new Map<string, Connection>();
  private healthStatus = new Map<string, RPCHealth>();
  private currentIndex = 0;
  private rateLimits = new Map<string, number[]>();
  private requestCounts = new Map<string, number>();
  private readonly HEALTH_CHECK_INTERVAL = 5000; // 5 seconds
  private healthCheckQueue: string[] = [];
  private isProcessingHealthChecks = false;
  private readonly MAX_CONCURRENT_HEALTH_CHECKS = 3;

  constructor() {
    console.log('🔧 RPCManager: Starting initialization...');
    
    console.log('🔧 RPCManager: About to initialize connections...');
    try {
      this.initializeConnections();
      console.log('✅ RPCManager: Connections initialized');
    } catch (error) {
      console.error('❌ RPCManager: Connections failed:', error);
      throw error;
    }
    
    console.log('🔧 RPCManager: About to start health checks...');
    try {
      // Delay health checks to avoid blocking constructor
      setTimeout(() => {
        this.startHealthChecks();
        console.log('✅ RPCManager: Health checks started');
      }, 1000);
    } catch (error) {
      console.error('❌ RPCManager: Health checks failed:', error);
      throw error;
    }
    
    console.log('🔧 RPCManager: About to start metrics collection...');
    try {
      // Delay metrics collection to avoid blocking constructor
      setTimeout(() => {
        this.startMetricsCollection();
        console.log('✅ RPCManager: Metrics collection started');
      }, 2000);
    } catch (error) {
      console.error('❌ RPCManager: Metrics collection failed:', error);
      throw error;
    }
    
    console.log('✅ RPCManager: Constructor completed');
  }

  /**
   * Initialize all RPC connections with keep-alive
   */
  private initializeConnections(): void {
    console.log('🔧 RPCManager: Starting connection initialization...');
    config.rpcEndpoints.forEach((endpoint, index) => {
      try {
        console.log(`🔗 RPCManager: Creating connection ${index + 1} to ${this.maskEndpoint(endpoint)}...`);
        
        console.log(`🔧 RPCManager: Creating Connection object for ${index + 1}...`);
        const connection = new Connection(endpoint, {
          commitment: 'processed' as Commitment,
          confirmTransactionInitialTimeout: config.rpcTimeout
        });
        console.log(`✅ RPCManager: Connection ${index + 1} created successfully`);
        
        this.connections.set(endpoint, connection);
        this.healthStatus.set(endpoint, {
          endpoint,
          healthy: true,
          latency: 0,
          errorCount: 0,
          successCount: 0,
          lastCheck: Date.now()
        });
        this.rateLimits.set(endpoint, []);
        this.requestCounts.set(endpoint, 0);
        
        console.log(`✅ RPC ${index + 1} initialized: ${this.maskEndpoint(endpoint)}`);
      } catch (error) {
        console.error(`❌ Failed to initialize RPC ${index + 1}: ${this.maskEndpoint(endpoint)}`, error);
      }
    });
    console.log('✅ RPCManager: All connections initialized');
  }

  /**
   * Get WebSocket endpoint from HTTP endpoint
   */
  private getWebSocketEndpoint(httpEndpoint: string): string {
    console.log(`🔧 RPCManager: Converting HTTP endpoint to WebSocket: ${this.maskEndpoint(httpEndpoint)}`);
    try {
      const wsEndpoint = httpEndpoint
        .replace('https://', 'wss://')
        .replace('http://', 'ws://');
      console.log(`✅ RPCManager: WebSocket endpoint created: ${this.maskEndpoint(wsEndpoint)}`);
      return wsEndpoint;
    } catch (error) {
      console.error(`❌ RPCManager: Failed to create WebSocket endpoint for ${this.maskEndpoint(httpEndpoint)}:`, error);
      throw error;
    }
  }

  /**
   * Mask sensitive parts of endpoint URL
   */
  private maskEndpoint(endpoint: string): string {
    return endpoint.replace(/api-key=[\w-]+/gi, 'api-key=***')
                  .replace(/\/v2\/[\w-]+/gi, '/v2/***');
  }

  /**
   * Start health checks for all RPC endpoints
   */
  private startHealthChecks(): void {
    console.log('🔧 RPCManager: Setting up health check interval...');
    try {
      setInterval(() => {
        console.log('🔧 RPCManager: Health check interval triggered');
        this.performHealthChecks().catch(error => {
          console.error('❌ RPCManager: Health check error:', error);
        });
      }, this.HEALTH_CHECK_INTERVAL);
      console.log('✅ RPCManager: Health check interval set up successfully');
    } catch (error) {
      console.error('❌ RPCManager: Failed to setup health check interval:', error);
      throw error;
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    console.log('🔧 RPCManager: Setting up metrics collection interval...');
    try {
      setInterval(() => {
        console.log('🔧 RPCManager: Metrics collection interval triggered');
        this.collectMetrics();
      }, 10000); // Every 10 seconds
      console.log('✅ RPCManager: Metrics collection interval set up successfully');
    } catch (error) {
      console.error('❌ RPCManager: Failed to setup metrics collection interval:', error);
      throw error;
    }
  }

  /**
   * Perform health checks on all RPC endpoints with optimized queuing
   */
  private async performHealthChecks(): Promise<void> {
    if (this.isProcessingHealthChecks) {
      return; // Skip if already processing to prevent overlap
    }

    this.isProcessingHealthChecks = true;
    
    try {
      const endpoints = Array.from(this.connections.keys());
      this.healthCheckQueue.push(...endpoints);
      
      await this.processHealthCheckQueue();
    } finally {
      this.isProcessingHealthChecks = false;
    }
  }

  /**
   * Process health check queue with controlled concurrency
   */
  private async processHealthCheckQueue(): Promise<void> {
    const activeTasks: Promise<void>[] = [];
    
    while (this.healthCheckQueue.length > 0 || activeTasks.length > 0) {
      while (this.healthCheckQueue.length > 0 && activeTasks.length < this.MAX_CONCURRENT_HEALTH_CHECKS) {
        const endpoint = this.healthCheckQueue.shift()!;
        const task = this.performSingleHealthCheck(endpoint);
        activeTasks.push(task);
      }
      
      if (activeTasks.length > 0) {
        await Promise.race(activeTasks);
        
        for (let i = activeTasks.length - 1; i >= 0; i--) {
          const task = activeTasks[i];
          const isCompleted = await Promise.race([
            task.then(() => true),
            Promise.resolve(false)
          ]);
          
          if (isCompleted) {
            activeTasks.splice(i, 1);
          }
        }
      }
      
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  /**
   * Perform health check on a single endpoint
   */
  private async performSingleHealthCheck(endpoint: string): Promise<void> {
    const start = Date.now();
    
    try {
      // Use getHealth as a lightweight health check with optimized timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.log(`⏰ RPC Health check timeout for ${this.maskEndpoint(endpoint)}`);
      }, 3000); // Increased timeout slightly
      
      const response = await Promise.race([
        fetch(endpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Connection': 'keep-alive'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(), // Unique ID to prevent caching
            method: 'getHealth'
          }),
          signal: controller.signal
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout')), 3000);
        })
      ]);
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const latency = Date.now() - start;
      const health = this.healthStatus.get(endpoint)!;
      
      this.healthStatus.set(endpoint, {
        ...health,
        healthy: latency < 2500, // Stricter latency requirement
        latency,
        errorCount: Math.max(0, health.errorCount - 1), // Decay error count
        successCount: health.successCount + 1,
        lastCheck: Date.now()
      });
      
      logHealthCheck('RPC', 'healthy', latency);
    } catch (error) {
      const health = this.healthStatus.get(endpoint)!;
      this.healthStatus.set(endpoint, {
        ...health,
        healthy: false,
        latency: 0,
        errorCount: health.errorCount + 1,
        lastCheck: Date.now()
      });
      
      logHealthCheck('RPC', 'unhealthy', 0);
      
      if (error instanceof Error && 
          !error.message.includes('timeout') && 
          !error.message.includes('ECONNREFUSED') &&
          !error.message.includes('aborted')) {
        console.error(`RPC Health check error for ${this.maskEndpoint(endpoint)}:`, error.message);
      }
    }
  }

  /**
   * Check if endpoint is rate limited
   */
  private isRateLimited(endpoint: string): boolean {
    const now = Date.now();
    const requests = this.rateLimits.get(endpoint) || [];
    const recentRequests = requests.filter(time => now - time < 1000);
    return recentRequests.length >= config.rpcRateLimit;
  }

  /**
   * Add rate limit tracking
   */
  private addRateLimit(endpoint: string): void {
    const now = Date.now();
    const requests = this.rateLimits.get(endpoint) || [];
    requests.push(now);
    
    // Keep only recent requests (last second)
    const recentRequests = requests.filter(time => now - time < 1000);
    this.rateLimits.set(endpoint, recentRequests);
    
    // Increment request count
    const count = this.requestCounts.get(endpoint) || 0;
    this.requestCounts.set(endpoint, count + 1);
  }

  /**
   * Get the best available RPC connection
   * Prioritizes: healthy > low latency > low error rate > round-robin
   */
  getHealthyConnection(): Connection | null {
    // Get healthy endpoints sorted by performance
    const healthyEndpoints = Array.from(this.healthStatus.entries())
      .filter(([_, health]) => health.healthy)
      .sort((a, b) => {
        // Sort by latency first, then error rate
        if (a[1].latency !== b[1].latency) {
          return a[1].latency - b[1].latency;
        }
        return a[1].errorCount - b[1].errorCount;
      })
      .map(([endpoint]) => endpoint);

    // Try to find a non-rate-limited healthy endpoint
    for (const endpoint of healthyEndpoints) {
      if (!this.isRateLimited(endpoint)) {
        this.addRateLimit(endpoint);
        return this.connections.get(endpoint) || null;
      }
    }

    // Fallback to round-robin if all healthy endpoints are rate limited
    const allEndpoints = Array.from(this.connections.keys());
    if (allEndpoints.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % allEndpoints.length;
    const endpoint = allEndpoints[this.currentIndex];
    this.addRateLimit(endpoint);
    
    return this.connections.get(endpoint) || null;
  }

  /**
   * Get any available connection (fallback)
   */
  getConnection(): Connection {
    const firstConnection = this.connections.values().next().value;
    if (!firstConnection) {
      throw new Error('No RPC connections available');
    }
    return firstConnection;
  }

  /**
   * Execute batch RPC requests with optimal performance
   */
  async batchRequest<T>(requests: (() => Promise<T>)[]): Promise<(T | null)[]> {
    const batchSize = config.rpcBatchSize;
    const results: (T | null)[] = [];

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (request) => {
          try {
            return await request();
          } catch (error) {
            console.error('Batch request failed:', error);
            return null;
          }
        })
      );

      results.push(...batchResults.map(result => 
        result.status === 'fulfilled' ? result.value : null
      ));
    }

    return results;
  }

  /**
   * Get all RPC health status
   */
  getHealthStatus(): RPCHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get average latency across healthy connections
   */
  getAverageLatency(): number {
    const healthyConnections = Array.from(this.healthStatus.values())
      .filter(health => health.healthy);
    
    if (healthyConnections.length === 0) return 0;
    
    const totalLatency = healthyConnections.reduce((sum, health) => sum + health.latency, 0);
    return Math.round(totalLatency / healthyConnections.length);
  }

  /**
   * Get total request count across all RPCs
   */
  getTotalRequests(): number {
    return Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Collect and emit metrics
   */
  private collectMetrics(): void {
    const healthyCount = Array.from(this.healthStatus.values())
      .filter(health => health.healthy).length;
    
    const metrics = {
      totalRPCs: this.connections.size,
      healthyRPCs: healthyCount,
      averageLatency: this.getAverageLatency(),
      totalRequests: this.getTotalRequests(),
      requestsPerSecond: this.calculateRequestsPerSecond()
    };
    
    console.log(`📊 RPC Metrics: ${healthyCount}/${this.connections.size} healthy, ${metrics.averageLatency}ms avg latency, ${metrics.requestsPerSecond} req/s`);
  }

  /**
   * Calculate requests per second
   */
  private calculateRequestsPerSecond(): number {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    let totalRecentRequests = 0;
    for (const requests of this.rateLimits.values()) {
      totalRecentRequests += requests.filter(time => time > oneSecondAgo).length;
    }
    
    return totalRecentRequests;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    // Close all connections
    for (const _connection of this.connections.values()) {
      // Note: @solana/web3.js doesn't have explicit close method
      // Connections will be garbage collected
    }
    
    this.connections.clear();
    this.healthStatus.clear();
    this.rateLimits.clear();
    this.requestCounts.clear();
  }
}
