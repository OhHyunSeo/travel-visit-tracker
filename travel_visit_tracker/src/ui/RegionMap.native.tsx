import { memo, useEffect, useMemo, useRef } from 'react';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type StyleSpecification,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';
import { regionById, regions } from '../data/regions';
import type { SavedBackgroundMap } from '../services/backgroundMapDisplay';
import { colors } from './theme';

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': colors.background } },
  ],
};
// Derive the initial viewport from every region, including outlying islands.
const packBounds = regions.reduce<[number, number, number, number]>(
  (bounds, region) => [
    Math.min(bounds[0], region.bounds[0]),
    Math.min(bounds[1], region.bounds[1]),
    Math.max(bounds[2], region.bounds[2]),
    Math.max(bounds[3], region.bounds[3]),
  ],
  [Infinity, Infinity, -Infinity, -Infinity],
);
const cameraPadding = { top: 24, right: 24, bottom: 24, left: 24 };
export const RegionMap = memo(function RegionMap({
  visited,
  selected,
  onSelect,
  background,
  onBackgroundError,
}: {
  visited: Set<string>;
  selected: string | null;
  onSelect(id: string): void;
  background?: SavedBackgroundMap;
  onBackgroundError?(): void;
}) {
  const camera = useRef<CameraRef>(null);
  const bounds = background
    ? ([...background.bounds] as [number, number, number, number])
    : packBounds;
  useEffect(() => {
    if (background) return;
    const region = selected ? regionById.get(selected) : undefined;
    if (region)
      camera.current?.fitBounds(region.bounds, {
        padding: { top: 28, right: 28, bottom: 28, left: 28 },
        duration: 450,
      });
  }, [background, selected]);
  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: regions.map((region) => ({
        ...region.feature,
        properties: {
          ...region.feature.properties,
          visited: visited.has(region.id),
          selected: region.id === selected,
        },
      })),
    }),
    [visited, selected],
  );
  return (
    <Map
      key={background?.packId ?? 'regions'}
      mapStyle={background?.style ?? mapStyle}
      style={{ flex: 1 }}
      attribution={Boolean(background)}
      compass
      onDidFailLoadingMap={background ? onBackgroundError : undefined}
      onDidFinishLoadingMap={() => {
        const target = !background && selected ? regionById.get(selected)?.bounds : bounds;
        if (target && target.every(Number.isFinite))
          camera.current?.fitBounds(target, { padding: cameraPadding, duration: 0 });
      }}
    >
      <Camera
        ref={camera}
        initialViewState={{ bounds, padding: cameraPadding }}
        minZoom={background?.minZoom}
        maxZoom={background?.maxZoom}
        maxBounds={background ? bounds : undefined}
      />
      <GeoJSONSource
        id="regions"
        data={data}
        onPress={(event) => {
          const id = event.nativeEvent.features[0]?.properties?.regionId;
          if (typeof id === 'string') onSelect(id);
        }}
      >
        <Layer
          id="region-fill"
          type="fill"
          paint={{
            'fill-color': ['case', ['get', 'visited'], colors.mint, '#304a4a'],
            'fill-opacity': background
              ? ['case', ['get', 'selected'], 0.45, ['get', 'visited'], 0.35, 0.08]
              : ['case', ['get', 'selected'], 1, 0.72],
          }}
        />
        <Layer
          id="region-border"
          type="line"
          paint={{
            'line-color': ['case', ['get', 'selected'], '#ffffff', '#527170'],
            'line-width': ['case', ['get', 'selected'], 2.5, 0.7],
          }}
        />
      </GeoJSONSource>
    </Map>
  );
});
