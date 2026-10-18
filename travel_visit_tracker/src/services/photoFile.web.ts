import { PhotoFileError, type PreparedPhotoFile } from './photoSync';

export async function preparePhotoFile(_uri: string): Promise<PreparedPhotoFile> {
  throw new PhotoFileError('unsupported');
}
