import { View } from 'react-native';
import { memo } from 'react';
import { regions } from '../data/regions';
import { colors } from './theme';

export const RegionMap = memo(function RegionMap({
  visited,
  selected,
  onSelect,
}: {
  visited: Set<string>;
  selected: string | null;
  onSelect(id: string): void;
}) {
  return (
    <View style={{ flex: 1, minHeight: 350 }}>
      <svg
        style={{ width: '100%', height: '100%' }}
        viewBox="0 0 340 420"
        aria-label="방문 지역 지도"
      >
        {regions.map((region) => {
          const geometry = region.feature.geometry;
          const polygons =
            geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
          const d = polygons
            .flatMap((rings) =>
              rings.map(
                (ring) =>
                  ring
                    .map(
                      (p, i) =>
                        `${i ? 'L' : 'M'}${((p[0] - 124.5) * 62).toFixed(2)},${((38.7 - p[1]) * 78).toFixed(2)}`,
                    )
                    .join(' ') + ' Z',
              ),
            )
            .join(' ');
          return (
            <path
              key={region.id}
              d={d}
              fillRule="evenodd"
              fill={visited.has(region.id) ? colors.mint : '#304a4a'}
              stroke={region.id === selected ? '#fff' : '#6d9290'}
              strokeWidth={region.id === selected ? 1.6 : 0.5}
              onClick={() => onSelect(region.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelect(region.id);
              }}
              aria-label={region.name}
            />
          );
        })}
      </svg>
    </View>
  );
});
