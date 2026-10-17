export type QueuedVisitOperation = {
  id: string;
  entityType: 'visit';
  entityId: string;
  operation: 'upsert' | 'delete';
  serializedPayload: string;
  createdAt: number;
  attempts: number;
};

export type VisitBackupState = {
  autoEnabled: boolean;
  pendingVisits: number;
  pendingPhotos: number;
  lastSuccessAt: number | null;
  nextAttemptAt: number | null;
  pauseReason: 'authentication' | 'conflict' | null;
};
