import * as SecureStore from 'expo-secure-store';
import type { CredentialStore } from './sessionManager';
const key = 'trip-painting.auth.v1';
const options = {
  keychainService: 'trip-painting-auth',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const credentials: CredentialStore = {
  read: () => SecureStore.getItemAsync(key, options),
  write: (value) => SecureStore.setItemAsync(key, value, options),
  clear: () => SecureStore.deleteItemAsync(key, options),
};
