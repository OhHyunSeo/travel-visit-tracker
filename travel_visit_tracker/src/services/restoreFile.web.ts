import type { RemotePhoto, RestoredPhotoFile, RestoredFileCondition } from '../storage/restore';
export type RestoredFile = { uri: string; dispose(keep: boolean): Promise<void> };
export async function inspectRestoredFile(
  _candidate: RestoredPhotoFile,
): Promise<RestoredFileCondition> {
  throw new Error('휴대폰 앱에서 복원을 사용해 주세요.');
}
export async function stageRestoredFile(
  _metadata: RemotePhoto,
  _bytes: Uint8Array,
): Promise<RestoredFile> {
  throw new Error('휴대폰 앱에서 복원을 사용해 주세요.');
}
