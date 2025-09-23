/**
 * Rate Limiter для контроля частоты RPC запросов
 */
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Проверяет можно ли выполнить запрос
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Удаляем старые запросы
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    // Проверяем лимит
    return this.requests.length < this.maxRequests;
  }

  /**
   * Регистрирует выполненный запрос
   */
  recordRequest(): void {
    this.requests.push(Date.now());
  }

  /**
   * Ждет пока можно будет выполнить запрос
   */
  async waitForSlot(): Promise<void> {
    while (!this.canMakeRequest()) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.windowMs - (Date.now() - oldestRequest) + 100; // +100ms буфер
      await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 100)));
    }
  }

  /**
   * Получает статистику
   */
  getStats(): { currentRequests: number; maxRequests: number; windowMs: number } {
    return {
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs
    };
  }
}
