import { fetch as expoFetch } from 'expo/fetch';
import type { RestoreTransport } from './restoreSync';
export const restoreFetch: RestoreTransport = (url, init) => expoFetch(url, init);
