import React, { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text, TurboModuleRegistry } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { ExpoRoot } from 'expo-router';
import { regions } from './src/data/regions';
import { createBackgroundMapPackMetadata } from './src/domain/backgroundMapPack';
import { planBackgroundMap } from './src/domain/backgroundMapPlan';
import { recoverInstalledBackgroundMapOperation } from './src/services/backgroundMapRecovery.native';
import { getBackgroundMapOperationRepository } from './src/storage/database';
import { ProductMapTrial } from './product-map-trial';

const mapRoutes = require.context('./app');

function fixtureStyle(origin, zoom, multiZoom) {
  return JSON.stringify({
    version: 8,
    center: [0, 0],
    zoom: 0,
    sources: { fixture: {
      type: 'raster', tiles: [`${origin}/resource/tile/{z}_{x}_{y}`],
      tileSize: 512, minzoom: multiZoom ? 8 : zoom, maxzoom: multiZoom ? 9 : zoom,
    } },
    layers: [
      { id: 'fixture-background', type: 'background', paint: { 'background-color': '#177878' } },
      { id: 'fixture-raster', type: 'raster', source: 'fixture', paint: { 'raster-fade-duration': 0 } },
    ],
  });
}

async function verifyRecovery(origin, reopening, zoom, multiZoom, adjacentTiles) {
  zoom = adjacentTiles ? 9 : zoom;
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
      return saved.packId;
    }
    if (initial.kind !== 'idle') throw new Error('Expected an empty operation database');
    const style = fixtureStyle(origin, zoom, multiZoom);
    const styleSha256 = await digestStringAsync(CryptoDigestAlgorithm.SHA256, style);
    const plan = planBackgroundMap(regions[adjacentTiles ? 2 : 0].id, { styleSha256, tileVersion: '20261028_120000_pt' },
      multiZoom ? 8 : zoom, multiZoom ? 9 : zoom);
    const metadata = createBackgroundMapPackMetadata(plan, {
      operationId: '9729af8d-20ac-42db-ae59-3773944d5530',
      tileJsonSha256: 'b'.repeat(64), localStyleSha256: styleSha256,
    });
    if (!await store.prepare(metadata, style)) throw new Error('Could not save the synthetic operation');
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
        const resources = multiZoom || adjacentTiles ? 3 : 2;
        if (status.packId !== pack.id || saved?.packId !== pack.id || status.completedResourceCount !== resources ||
            status.requiredResourceCount !== resources || status.completedTileCount !== resources - 1)
          throw new Error('Recovered ID or resource counts differ');
        publish({ pass: true, status, createdPackId: pack.id, savedPackId: saved.packId });
        return;
      }
      if (status.kind === 'conflict') {
        const listed = await native.getPacks();
        const details = listed.map((item) => ({
          id: item.id, bounds: item.bounds,
          metadataMatches: JSON.stringify(JSON.parse(item.metadata)) === JSON.stringify(metadata),
        }));
        throw new Error(`Recovery conflict ${JSON.stringify({ expectedBounds: plan.bounds, packs: details })}`);
      }
      if (status.kind !== 'incomplete') throw new Error(`Unexpected recovery state ${status.kind}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Synthetic pack did not complete');
  } catch (error) {
    publish({ pass: false, error: String(error) });
  }
}

function RecoveryEntry({ origin, reopening, productMap, productTab, fixtureZoom = 8, fixtureMultiZoom = false, fixtureAdjacentTiles = false }) {
  const [packId, setPackId] = useState(null);
  useEffect(() => {
    let active = true;
    void verifyRecovery(origin, reopening, fixtureZoom, fixtureMultiZoom, fixtureAdjacentTiles).then((pack) => {
      if (active && (productMap || productTab) && pack) setPackId(pack);
    });
    return () => { active = false; };
  }, [origin, reopening, productMap, productTab, fixtureZoom, fixtureMultiZoom, fixtureAdjacentTiles]);
  if (packId && productTab) return <ExpoRoot context={mapRoutes} location="/" />;
  if (packId) return <ProductMapTrial packId={packId} />;
  return <Text>저장 지도 팩 복구 시험</Text>;
}

AppRegistry.registerComponent('TripMapRecoveryQA', () => RecoveryEntry);
