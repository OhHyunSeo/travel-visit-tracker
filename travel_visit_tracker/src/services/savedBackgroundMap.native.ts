import { NativeModules } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { getBackgroundMapOperationRepository } from '../storage/database';
import { loadSavedBackgroundMap } from './backgroundMapDisplay';
import { recoverInstalledBackgroundMapOperation } from './backgroundMapRecovery.native';

export function getSavedBackgroundMap() {
  return loadSavedBackgroundMap({
    isCacheOnly: () => NativeModules.TripPaintingOfflineMaps?.isCacheOnly?.() === true,
    recover: recoverInstalledBackgroundMapOperation,
    styleForPack: async (packId) =>
      (await getBackgroundMapOperationRepository()).styleForPack(packId),
    digestStyle: (style) => digestStringAsync(CryptoDigestAlgorithm.SHA256, style),
  });
}
