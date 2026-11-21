import { fetch as expoFetch } from 'expo/fetch';

// Visit ACKs and health probes need a native response body stream.
export const visitFetch: typeof fetch = (url, init) => expoFetch(url, init);
