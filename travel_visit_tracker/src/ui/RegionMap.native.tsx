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
import { colors } from './theme';

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': colors.background } },
  ],
};
export const RegionMap = memo(function RegionMap({
  visited,
  selected,
  onSelect,
}: {
  visited: Set<string>;
  selected: string | null;
  onSelect(id: string): void;
}) {
  const camera = useRef<CameraRef>(null);
  useEffect(() => {
    const region = selected ? regionById.get(selected) : undefined;
    if (region)
      camera.current?.fitBounds(region.bounds, {
        padding: { top: 28, right: 28, bottom: 28, left: 28 },
        duration: 450,
      });
  }, [selected]);
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
    <Map mapStyle={mapStyle} style={{ flex: 1 }} attribution={false} compass>
      <Camera ref={camera} initialViewState={{ center: [127.8, 36.1], zoom: 5.7 }} />
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
            'fill-opacity': ['case', ['get', 'selected'], 1, 0.72],
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
