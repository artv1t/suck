import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, DollarSign, Shield, Settings, Zap, AlertTriangle, CheckCircle, XCircle, BarChart3, Wallet, Bot, Play, Square, RotateCcw, Plus } from 'lucide-react';
import io from 'socket.io-client';
import './App.css';

interface BotStatus {
  running: boolean;
  startTime: number;
  totalEvents: number;
  totalTrades: number;
  totalPnl: number;
  openPositions: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  mode: 'paper' | 'live';
  circuitBreakerActive: boolean;
}

interface Position {
  mintAddress: string;
  symbol?: string;
  buyPrice: number;
  buyAmount: number;
  currentPrice?: number;
  currentValue?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'active' | 'sold' | 'failed';
  buyTimestamp: number;
}

interface Metrics {
  bot: BotStatus;
  positions: any;
  trader: any;
  rpc: any;
  safety: any;
}

interface SafetyStatus {
  liveTradingEnabled: boolean;
  emergencyStop: boolean;
  tradingAllowed: boolean;
  criticalIssues: number;
  failedChecks: any[];
}

function App() {
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [safetyStatus, setSafetyStatus] = useState<SafetyStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [socket, setSocket] = useState<any>(null);
  const [newTokenAddress, setNewTokenAddress] = useState('');

  useEffect(() => {
    // Initialize WebSocket connection
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
      console.log('Connected to WebSocket');
      
      // Subscribe to all channels
      newSocket.emit('subscribe', {
        channels: ['bot_status', 'positions', 'metrics', 'safety', 'trades', 'tokens']
      });
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from WebSocket');
    });

    // Listen for real-time updates
    newSocket.on('bot_status_update', (data: any) => {
      if (data.success) setBotStatus(data.data);
    });

    newSocket.on('positions_update', (data: any) => {
      if (data.success) setPositions(data.data);
    });

    newSocket.on('metrics_update', (data: any) => {
      if (data.success) setMetrics(data.data);
    });

    // Initial data requests
    newSocket.emit('get_bot_status');
    newSocket.emit('get_positions');
    newSocket.emit('get_metrics');

    // Fetch safety status via REST API
    fetchSafetyStatus();

    return () => {
      newSocket.close();
    };
  }, []);

  const fetchSafetyStatus = async () => {
    try {
      const response = await fetch('/api/safety/status');
      const data = await response.json();
      if (data.success) setSafetyStatus(data.data);
    } catch (error) {
      console.error('Failed to fetch safety status:', error);
    }
  };

  const handleBotControl = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const response = await fetch(`/api/bot/${action}`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        console.log(`Bot ${action} successful`);
        // Refresh status
        socket?.emit('get_bot_status');
      }
    } catch (error) {
      console.error(`Bot ${action} failed:`, error);
    }
  };

  const handleAddToken = async () => {
    if (!newTokenAddress.trim()) return;
    
    try {
      const response = await fetch('/api/bot/tokens/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAddress: newTokenAddress.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setNewTokenAddress('');
        console.log('Token added successfully');
      }
    } catch (error) {
      console.error('Failed to add token:', error);
    }
  };

  const formatNumber = (num: number, decimals = 2) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(num);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m ${seconds % 60}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-500';
      case 'sold': return 'text-blue-500';
      case 'failed': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getPnlColor = (pnl?: number) => {
    if (!pnl) return 'text-gray-500';
    return pnl > 0 ? 'text-green-500' : 'text-red-500';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Bot className="w-8 h-8 text-blue-500" />
            <h1 className="text-2xl font-bold">Solana Sniper Bot</h1>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
              connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
            }`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span>{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {botStatus && (
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                botStatus.mode === 'paper' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'
              }`}>
                {botStatus.mode === 'paper' ? '📝 Paper Mode' : '💰 Live Mode'}
              </div>
            )}
            
            <div className="flex space-x-2">
              <button
                onClick={() => handleBotControl('start')}
                disabled={botStatus?.running}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>Start</span>
              </button>
              
              <button
                onClick={() => handleBotControl('stop')}
                disabled={!botStatus?.running}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                <Square className="w-4 h-4" />
                <span>Stop</span>
              </button>
              
              <button
                onClick={() => handleBotControl('restart')}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restart</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700 px-6">
        <div className="flex space-x-8">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            { id: 'positions', label: 'Positions', icon: TrendingUp },
            { id: 'trading', label: 'Trading', icon: DollarSign },
            { id: 'safety', label: 'Safety', icon: Shield },
            { id: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="p-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Bot Status</p>
                    <p className={`text-lg font-semibold ${
                      botStatus?.running ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {botStatus?.running ? 'Running' : 'Stopped'}
                    </p>
                  </div>
                  <Activity className={`w-8 h-8 ${
                    botStatus?.running ? 'text-green-400' : 'text-red-400'
                  }`} />
                </div>
                {botStatus && (
                  <p className="text-gray-400 text-xs mt-2">
                    Uptime: {formatUptime(botStatus.uptime)}
                  </p>
                )}
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Total PnL</p>
                    <p className={`text-lg font-semibold ${
                      getPnlColor(botStatus?.totalPnl)
                    }`}>
                      {botStatus ? `${formatNumber(botStatus.totalPnl, 6)} SOL` : '0 SOL'}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-blue-400" />
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Open Positions</p>
                    <p className="text-lg font-semibold text-white">
                      {botStatus?.openPositions || 0}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-400" />
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Total Trades</p>
                    <p className="text-lg font-semibold text-white">
                      {botStatus?.totalTrades || 0}
                    </p>
                  </div>
                  <Zap className="w-8 h-8 text-yellow-400" />
                </div>
              </div>
            </div>

            {/* System Metrics */}
            {metrics && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-800 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4">System Performance</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Memory Usage</span>
                      <span className="text-white">{botStatus?.memoryUsage || 0} MB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Events/sec</span>
                      <span className="text-white">{botStatus?.totalEvents || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">RPC Health</span>
                      <span className="text-green-400">
                        {metrics.rpc?.healthyEndpoints || 0}/{metrics.rpc?.totalEndpoints || 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6">
                  <h3 className="text-lg font-semibold mb-4">Safety Status</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Circuit Breaker</span>
                      <div className="flex items-center space-x-2">
                        {botStatus?.circuitBreakerActive ? (
                          <XCircle className="w-4 h-4 text-red-400" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        )}
                        <span className={botStatus?.circuitBreakerActive ? 'text-red-400' : 'text-green-400'}>
                          {botStatus?.circuitBreakerActive ? 'Active' : 'Normal'}
                        </span>
                      </div>
                    </div>
                    
                    {safetyStatus && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">Live Trading</span>
                          <div className="flex items-center space-x-2">
                            {safetyStatus.liveTradingEnabled ? (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-400" />
                            )}
                            <span className={safetyStatus.liveTradingEnabled ? 'text-green-400' : 'text-red-400'}>
                              {safetyStatus.liveTradingEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">Critical Issues</span>
                          <span className={safetyStatus.criticalIssues > 0 ? 'text-red-400' : 'text-green-400'}>
                            {safetyStatus.criticalIssues}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Add Token */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Add Token Manually</h3>
              <div className="flex space-x-4">
                <input
                  type="text"
                  value={newTokenAddress}
                  onChange={(e) => setNewTokenAddress((e.target as HTMLInputElement).value)}
                  placeholder="Enter mint address..."
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleAddToken}
                  disabled={!newTokenAddress.trim()}
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Token</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Positions</h2>
              <div className="text-gray-400">
                {positions.length} total positions
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Token
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Buy Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Current Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        PnL
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Age
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {positions.map((position) => (
                      <tr key={position.mintAddress} className="hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-white">
                              {position.symbol || 'Unknown'}
                            </div>
                            <div className="text-xs text-gray-400">
                              {position.mintAddress.slice(0, 8)}...{position.mintAddress.slice(-8)}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            position.status === 'active' ? 'bg-green-900 text-green-300' :
                            position.status === 'sold' ? 'bg-blue-900 text-blue-300' :
                            'bg-red-900 text-red-300'
                          }`}>
                            {position.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                          {formatNumber(position.buyPrice, 8)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                          {position.currentPrice ? formatNumber(position.currentPrice, 8) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm font-medium ${getPnlColor(position.pnl)}`}>
                            {position.pnl ? `${formatNumber(position.pnl, 6)} SOL` : '-'}
                          </div>
                          <div className={`text-xs ${getPnlColor(position.pnlPercent)}`}>
                            {position.pnlPercent ? `${formatNumber(position.pnlPercent, 2)}%` : '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {formatTime(position.buyTimestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'safety' && safetyStatus && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Safety & Security</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <Shield className="w-5 h-5 mr-2" />
                  Trading Safety
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Live Trading</span>
                    <div className="flex items-center space-x-2">
                      {safetyStatus.liveTradingEnabled ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className={safetyStatus.liveTradingEnabled ? 'text-green-400' : 'text-red-400'}>
                        {safetyStatus.liveTradingEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Emergency Stop</span>
                    <div className="flex items-center space-x-2">
                      {safetyStatus.emergencyStop ? (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      )}
                      <span className={safetyStatus.emergencyStop ? 'text-red-400' : 'text-green-400'}>
                        {safetyStatus.emergencyStop ? 'Active' : 'Normal'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Trading Allowed</span>
                    <div className="flex items-center space-x-2">
                      {safetyStatus.tradingAllowed ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className={safetyStatus.tradingAllowed ? 'text-green-400' : 'text-red-400'}>
                        {safetyStatus.tradingAllowed ? 'Yes' : 'No'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Critical Issues</span>
                    <span className={safetyStatus.criticalIssues > 0 ? 'text-red-400' : 'text-green-400'}>
                      {safetyStatus.criticalIssues}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">Failed Safety Checks</h3>
                {safetyStatus.failedChecks.length > 0 ? (
                  <div className="space-y-2">
                    {safetyStatus.failedChecks.map((check, index) => (
                      <div key={index} className="flex items-center space-x-2 p-2 bg-red-900/20 rounded">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <div>
                          <div className="text-sm font-medium text-red-400">{check.name}</div>
                          <div className="text-xs text-gray-400">{check.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span>All safety checks passed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;