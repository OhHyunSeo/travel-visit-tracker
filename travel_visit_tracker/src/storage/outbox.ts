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
  connectionCheckAt: number | null;
  pauseReason: 'authentication' | 'conflict' | null;
};

export type QueuedPhotoOperation = {
  id: string;
  entityType: 'photo';
  entityId: string;
  operation: 'upsert';
  serializedPayload: string;
  createdAt: number;
  attempts: number;
};
export type PhotoFingerprint = {
  sha256: string;
  byteLength: number;
  mimeType: 'image/jpeg' | 'image/png';
};
export type PhotoAcknowledgement = {
  acknowledgedId: string;
  photo: PhotoFingerprint & {
    id: string;
    visitId: string;
    createdAt: number;
    revision: number;
    originalPath: string;
    thumbnailPath: string;
  };
};
export type PhotoBackupState = { pendingPhotos: number; backedUpPhotos: number };
