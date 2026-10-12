import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { Photo } from '../domain/types';
import { getRepository } from '../storage/database';

export async function attachPhoto(visitId: string): Promise<boolean> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return false;
  const id = Crypto.randomUUID();
  const directory = new Directory(Paths.document, 'visit-photos');
  directory.create({ idempotent: true, intermediates: true });
  const asset = result.assets[0];
  const extension =
    asset.fileName
      ?.split('.')
      .pop()
      ?.toLowerCase()
      .match(/^(jpg|jpeg|png|heic|webp)$/)?.[0] ?? 'jpg';
  const file = new File(directory, `${id}.${extension}`);
  new File(asset.uri).copy(file);
  // iOS may change its container path during an update. Persist the relative path.
  const photo: Photo = {
    id,
    visitId,
    uri: `visit-photos/${id}.${extension}`,
    createdAt: Date.now(),
  };
  try {
    await (await getRepository()).addPhoto(photo);
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
  return true;
}
export function resolvePhotoUri(uri: string): string {
  return uri.startsWith('visit-photos/') ? new File(Paths.document, uri).uri : uri;
}
export async function removePhotoFiles(uris: string[]) {
  for (const uri of uris) {
    const file = new File(resolvePhotoUri(uri));
    if (file.exists) file.delete();
  }
}
