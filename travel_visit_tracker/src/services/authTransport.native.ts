import { fetch as expoFetch } from 'expo/fetch';

// Account requests need a bounded native response stream too.
export const authFetch: typeof fetch = (url, init) => expoFetch(url, init);
