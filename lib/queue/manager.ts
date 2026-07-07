export interface QueuedCaller {
  id: string;
  phoneNumber?: string;
  joinedAt: number;
  priority: number; // Lower number = higher priority. Default 5.
  clientId?: string;
}

export class CallQueueManager {
  private queue: QueuedCaller[] = [];
  private activeCalls: number = 0;
  
  // Assumption for wait time calculation (3 minutes per call)
  private readonly AVERAGE_CALL_DURATION_MS = 3 * 60 * 1000;
  
  // Configurable max concurrent calls
  private maxConcurrentCalls: number;
  private totalHandled: number = 0;
  private totalRejected: number = 0;
  private onSlotAvailable: (() => void) | null = null;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrentCalls = maxConcurrent;
  }

  public setMaxConcurrent(max: number): void {
    this.maxConcurrentCalls = max;
  }

  public enqueueCaller(callerId: string, phoneNumber?: string, priority: number = 5, clientId?: string): QueuedCaller {
    // Reject if queue is excessively deep (prevent unbounded growth)
    if (this.queue.length >= this.maxConcurrentCalls * 5) {
      this.totalRejected++;
      throw new Error(`Queue full: ${this.queue.length} callers waiting`);
    }

    const caller: QueuedCaller = {
      id: callerId,
      phoneNumber,
      joinedAt: Date.now(),
      priority,
      clientId,
    };
    this.queue.push(caller);

    // Sort queue by priority (lower = higher), then by join time (FIFO within priority)
    this.queue.sort((a, b) => a.priority - b.priority || a.joinedAt - b.joinedAt);

    return caller;
  }

  public dequeueCaller(callerId: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(c => c.id !== callerId);
    return this.queue.length < initialLength;
  }

  public peekNextCaller(): QueuedCaller | null {
    if (this.queue.length === 0) return null;
    return this.queue[0];
  }

  public getQueuePosition(callerId: string): number {
    const index = this.queue.findIndex(c => c.id === callerId);
    return index >= 0 ? index + 1 : -1;
  }

  public getEstimatedWaitTimeMs(callerId: string): number {
    const position = this.getQueuePosition(callerId);
    if (position === -1) return 0;

    if (this.activeCalls < this.maxConcurrentCalls && position === 1) {
      return 0; // Next in line and there is a free agent
    }

    const capacity = Math.max(1, this.maxConcurrentCalls);
    const groupsAhead = Math.ceil(position / capacity);
    
    return groupsAhead * this.AVERAGE_CALL_DURATION_MS;
  }

  // --- Methods to manage active call count for accurate queue wait times ---

  public markCallStarted() {
    this.activeCalls++;
    this.totalHandled++;
  }

  public markCallEnded() {
    if (this.activeCalls > 0) {
      this.activeCalls--;
    }
    // Auto-dequeue — notify listener if a slot opened and someone is waiting
    if (this.queue.length > 0 && this.activeCalls < this.maxConcurrentCalls && this.onSlotAvailable) {
      this.onSlotAvailable();
    }
  }

  /**
   * Register a callback to be invoked when a call slot becomes available.
   */
  public onSlotOpen(callback: () => void): void {
    this.onSlotAvailable = callback;
  }

  public canAcceptCall(): boolean {
    return this.activeCalls < this.maxConcurrentCalls;
  }

  public getActiveCallCount(): number {
    return this.activeCalls;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Returns a snapshot of live telephony metrics for the analytics dashboard.
   */
  public getMetrics(): { activeCallCount: number; queueLength: number; totalHandled: number; totalRejected: number } {
    return {
      activeCallCount: this.activeCalls,
      queueLength: this.queue.length,
      totalHandled: this.totalHandled,
      totalRejected: this.totalRejected,
    };
  }
}

// Global singleton for use across the application
export const callQueue = new CallQueueManager();
