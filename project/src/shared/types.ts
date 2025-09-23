// Re-export all types from the main types file
export * from '../types/index.js';

// Additional shared types for API and WebSocket communication
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  mintAddress?: string;
  source?: string;
  dateFrom?: number;
  dateTo?: number;
  status?: string;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
}

export interface SystemAlert {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: number;
  acknowledged?: boolean;
}