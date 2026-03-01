export interface BlockMetrics {
    startTime: Date;
    lastActivity: Date;
    utilization?: number;
    resetsAt?: Date;
    source?: 'api' | 'transcript';
}