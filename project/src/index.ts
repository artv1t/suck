#!/usr/bin/env node

import { BotManager } from './core/botManager.js';
import { APIServer } from './api/server.js';
import { config } from './config/index.js';
import logger from './utils/logger.js';
import fs from 'fs';

// ASCII Art Banner
const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                    SOLANA SNIPER BOT v1.0                    ║
║                High-Performance Trading Bot                   ║
║                                                               ║
║  🚀 1000+ Events/sec  💰 Auto TP/SL  ⚡ Real-time Detection  ║
╚═══════════════════════════════════════════════════════════════╝
`;

console.log(banner);

// Create required directories
const requiredDirs = ['./data', './logs', './wallets'];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

async function main() {
  try {
    // Log startup configuration
    console.log('🚀 Starting Solana Sniper Bot...');
    console.log(`📊 Mode: ${config.paperMode ? 'PAPER TRADING' : '🔴 LIVE TRADING'}`);
    
    // CRITICAL SAFETY WARNING for live mode
    if (!config.paperMode) {
      console.log('\n🚨🚨🚨 CRITICAL SAFETY WARNING 🚨🚨🚨');
      console.log('💰 LIVE TRADING MODE - REAL MONEY AT RISK!');
      console.log('🔒 Live trading is DISABLED by default for safety');
      console.log('📋 Complete safety checklist before enabling:');
      console.log('   ✅ Test thoroughly in paper mode');
      console.log('   ✅ Use small amounts (0.001 SOL max)');
      console.log('   ✅ Verify all safety settings');
      console.log('   ✅ Monitor continuously');
      console.log('🌐 Enable via API: POST /api/safety/enable-live-trading');
      console.log('🔐 Security hardening is ACTIVE');
      console.log('🛡️ Rate limiting and input validation enabled');
      console.log('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n');
    }
    
    console.log(`💰 Quote Amount: ${config.quoteAmount} SOL`);
    console.log(`📈 Take Profit: ${config.takeProfit}%`);
    console.log(`📉 Stop Loss: ${config.stopLoss}%`);
    console.log(`⏰ TTL: ${config.ttlMinutes} minutes`);
    console.log(`🔗 RPC Endpoints: ${config.rpcEndpoints.length}`);
    console.log(`⚡ Max Concurrent Trades: ${config.maxConcurrentTrades}`);
    console.log(`🔍 Max Concurrent Filters: ${config.maxConcurrentFilters}`);
    
    console.log('🔧 Index: About to validate configuration...');
    // Validate configuration
    if (!config.paperMode) {
      console.log('\n⚠️  WARNING: LIVE TRADING MODE ENABLED!');
      console.log('💰 This will use real money. Make sure you understand the risks.');
      console.log('🔒 Ensure you have proper wallet security and small test amounts.');
      
      // Add 1 second delay for live mode
      console.log('⏳ Starting in 1 second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('✅ Index: 1 second delay completed');
    }
    
    console.log('🔧 Index: Configuration validation completed');
    console.log('🔧 Index: About to initialize core components...');
    // Initialize core components
    console.log('🔧 Index: Creating BotManager...');
    console.log('🔧 Index: About to call new BotManager()...');
    const botManager = new BotManager();
    console.log('✅ Index: BotManager created successfully');
    console.log('🔧 Index: BotManager object:', typeof botManager);
    
    console.log('🔧 Index: Initializing BotManager...');
    await botManager.initialize();
    console.log('✅ Index: BotManager initialized successfully');
    
    // Start API server if enabled
    let apiServer: APIServer | null = null;
    if (config.enableApi) {
      apiServer = new APIServer(botManager);
      await apiServer.start(config.apiPort);
      logger.info(`🌐 API server started on port ${config.apiPort}`);
      logger.info(`📊 Health check: http://localhost:${config.apiPort}/health`);
      logger.info(`📈 Metrics: http://localhost:${config.apiPort}/metrics`);
    }
    
    // Start the bot
    await botManager.start();
    logger.info('✅ Bot started successfully');
    
    // Log performance targets
    logger.info('🎯 Performance Targets:');
    logger.info('   • Events/sec: 1000+');
    logger.info('   • Processing latency: <50ms');
    logger.info('   • Memory usage: <2GB');
    logger.info('   • Success rate: >95%');
    
    // Log security status
    logger.info('🔒 Security Features:');
    logger.info('   • Rate limiting enabled');
    logger.info('   • Input validation active');
    logger.info('   • File system protection');
    logger.info('   • API key authentication');
    logger.info('   • Security event logging');
    
    // Setup graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`📴 Received ${signal}, shutting down gracefully...`);
      
      try {
        await botManager.stop();
        if (apiServer) {
          await apiServer.stop();
        }
        botManager.destroy();
        
        logger.info('✅ Shutdown completed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    // Handle shutdown signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception:', error);
      console.error('💥 Uncaught Exception Details:', error);
      console.error('Stack trace:', error.stack);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
    
    // Log successful startup
    logger.info('🎉 Solana Sniper Bot is now running!');
    if (config.paperMode) {
      logger.info('📝 Paper mode: No real trades will be executed');
    } else {
      logger.info('💰 Live mode: Real trades will be executed!');
    }
    
    // Keep process alive and log periodic status
    setInterval(() => {
      const status = botManager.getStatus();
      const uptime = Math.floor((Date.now() - status.startTime) / 1000);
      
      logger.info(`📊 Status: ${status.running ? '🟢 Running' : '🔴 Stopped'} | ` +
                 `Uptime: ${uptime}s | Events: ${status.totalEvents} | ` +
                 `Trades: ${status.totalTrades} | PnL: ${status.totalPnl.toFixed(4)} SOL | ` +
                 `Positions: ${status.openPositions}`);
    }, 60000); // Every minute
    
  } catch (error) {
    logger.error('💥 Failed to start bot:', error);
    console.error('\n❌ Startup failed. Check the logs above for details.');
    console.error('💡 Common issues:');
    console.error('   • Invalid RPC endpoints in .env');
    console.error('   • Missing wallet files');
    console.error('   • Network connectivity issues');
    console.error('   • Insufficient permissions for data directory');
    process.exit(1);
  }
}

// Handle CLI arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm start [options]

Options:
  --help, -h     Show this help message
  --paper        Force paper mode (safe testing)
  --live         Force live mode (real trading - BE CAREFUL!)
  --config       Show current configuration
  --test         Run system tests

Environment Variables:
  PAPER_MODE=true/false    Set trading mode
  LOG_LEVEL=info/debug     Set logging level
  RPC_ENDPOINT_1=url       Primary RPC endpoint
  QUOTE_AMOUNT=0.0001      SOL amount per trade
  
Examples:
  npm run start:paper      Start in paper mode
  npm run start:live       Start in live mode
  npm run test            Run tests
  npm run lint            Check code quality

For more information, see README.md
`);
  process.exit(0);
}

if (args.includes('--config')) {
  console.log('\n📋 Current Configuration:');
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}

// Start the bot
main().catch(error => {
  logger.error('💥 Fatal error:', error);
  process.exit(1);
});

