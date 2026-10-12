export async function attachPhoto(_visitId: string): Promise<boolean> {
  throw new Error('사진 첨부는 휴대폰 앱에서 확인해 주세요.');
}
export async function removePhotoFiles(_uris: string[]): Promise<void> {}
export function resolvePhotoUri(uri: string): string {
  return uri;
}
