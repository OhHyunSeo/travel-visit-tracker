import { fetch as expoFetch } from 'expo/fetch';
import type { PhotoTransport } from './photoSync';

// Expo's multipart encoder reads File.bytes() without constructing an RN Blob.
export const photoFetch: PhotoTransport = (url, init) => expoFetch(url, init);
