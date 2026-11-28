import type { CredentialStore } from './sessionManager';
// Web previews never persist credentials in localStorage or the SQLite preview database.
let value: string | null = null;
export const credentials: CredentialStore = {
  read: async () => value,
  write: async (next) => {
    value = next;
  },
  clear: async () => {
    value = null;
  },
};
