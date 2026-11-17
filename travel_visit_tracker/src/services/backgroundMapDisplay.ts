import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { readBackgroundMapPlan } from '../domain/backgroundMapPlan';
import type { BackgroundMapOperationRepository } from '../storage/backgroundMapOperationRepository';

export type SavedBackgroundMap = Readonly<{
  packId: string;
  regionId: string;
  bounds: readonly [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  style: StyleSpecification;
}>;

type DisplayDependencies = {
  isCacheOnly(): boolean;
  recover(): Promise<{ kind: string; packId?: string }>;
  styleForPack: BackgroundMapOperationRepository['styleForPack'];
  digestStyle(style: string): Promise<string>;
};

export async function loadSavedBackgroundMap({
  isCacheOnly,
  recover,
  styleForPack,
  digestStyle,
}: DisplayDependencies): Promise<SavedBackgroundMap | null> {
  if (!isCacheOnly()) return null;
  const status = await recover();
  if (status.kind !== 'complete' || !status.packId) return null;

  const saved = await styleForPack(status.packId);
  if (!saved || (await digestStyle(saved.styleJson)) !== saved.metadata.localStyleSha256)
    return null;
  const style = JSON.parse(saved.styleJson) as StyleSpecification | null;
  if (
    !style ||
    style.version !== 8 ||
    !style.sources ||
    typeof style.sources !== 'object' ||
    Array.isArray(style.sources) ||
    Object.hasOwn(style.sources, 'regions') ||
    !Array.isArray(style.layers) ||
    style.layers.some(
      (layer) =>
        !layer ||
        typeof layer.id !== 'string' ||
        layer.id === 'region-fill' ||
        layer.id === 'region-border',
    ) ||
    !isCacheOnly()
  )
    return null;

  const { regionId, bounds, minZoom, maxZoom } = readBackgroundMapPlan(saved.metadata.plan);
  return { packId: status.packId, regionId, bounds, minZoom, maxZoom, style };
}
