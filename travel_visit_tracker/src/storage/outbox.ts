export type QueuedVisitOperation = {
  id: string;
  entityType: 'visit';
  entityId: string;
  operation: 'upsert' | 'delete';
  serializedPayload: string;
  createdAt: number;
  attempts: number;
};
