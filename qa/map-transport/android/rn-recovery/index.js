import React, { useEffect } from 'react';
import { AppRegistry, NativeModules, Text, TurboModuleRegistry } from 'react-native';
import { regions } from './product-source/data/regions';
import { createBackgroundMapPackMetadata } from './product-source/domain/backgroundMapPack';
import { planBackgroundMap } from './product-source/domain/backgroundMapPlan';
import { recoverInstalledBackgroundMapOperation } from './product-source/services/backgroundMapRecovery.native';
import { getBackgroundMapOperationRepository } from './product-source/storage/database';

async function verifyRecovery(origin, reopening) {
  const states = [];
  const publish = (result) => NativeModules.TPRecoveryReport.publish(JSON.stringify({ states, ...result }));
  try {
    const store = await getBackgroundMapOperationRepository();
    const previous = reopening ? await store.current() : null;
    const initial = await recoverInstalledBackgroundMapOperation();
    states.push(initial.kind);
    if (reopening) {
      const saved = await store.current();
      if (initial.kind !== 'complete' || previous?.packId !== initial.packId || saved?.packId !== initial.packId)
        throw new Error('The recovered pack did not survive restart');
      publish({ pass: true, status: initial, savedPackId: saved.packId });
      return;
    }
    if (initial.kind !== 'idle') throw new Error('Expected an empty operation database');
    const plan = planBackgroundMap(regions[0].id, {
      styleSha256: 'a'.repeat(64), tileVersion: '20261028_120000_pt',
    }, 8, 8);
    const metadata = createBackgroundMapPackMetadata(plan, {
      operationId: '9729af8d-20ac-42db-ae59-3773944d5530',
      tileJsonSha256: 'b'.repeat(64), localStyleSha256: 'c'.repeat(64),
    });
    if (!await store.prepare(metadata)) throw new Error('Could not save the synthetic operation');
    const waiting = await recoverInstalledBackgroundMapOperation();
    states.push(waiting.kind);
    if (waiting.kind !== 'awaiting-pack') throw new Error('Expected no matching SDK pack');
    const native = TurboModuleRegistry.getEnforcing('MLRNOfflineModule');
    const pack = await native.createPack({
      mapStyle: `${origin}/resource/style/sdk`, bounds: plan.bounds,
      minZoom: plan.minZoom, maxZoom: plan.maxZoom, metadata: JSON.stringify(metadata),
    });
    if ((await store.current())?.packId !== null) throw new Error('Expected a saved operation without a pack ID');

    for (let attempt = 0; attempt < 36; attempt++) {
      const status = await recoverInstalledBackgroundMapOperation();
      if (states.at(-1) !== status.kind) states.push(status.kind);
      if (status.kind === 'complete') {
        const saved = await store.current();
        if (status.packId !== pack.id || saved?.packId !== pack.id || status.completedResourceCount !== 2 ||
            status.requiredResourceCount !== 2 || status.completedTileCount !== 1)
          throw new Error('Recovered ID or resource counts differ');
        publish({ pass: true, status, createdPackId: pack.id, savedPackId: saved.packId });
        return;
      }
      if (status.kind !== 'incomplete') throw new Error(`Unexpected recovery state ${status.kind}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Synthetic pack did not complete');
  } catch (error) {
    publish({ pass: false, error: String(error) });
  }
}

function RecoveryEntry({ origin, reopening }) {
  useEffect(() => { void verifyRecovery(origin, reopening); }, [origin, reopening]);
  return <Text>저장 지도 팩 복구 시험</Text>;
}

AppRegistry.registerComponent('TripMapRecoveryQA', () => RecoveryEntry);
