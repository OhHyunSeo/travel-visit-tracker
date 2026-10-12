import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import data from './korea-adm2.json';
import metadata from './korea-adm2.metadata.json';
import { containsPoint, geometryBounds } from '../domain/geometry';
import type { Region } from '../domain/types';

const koreanNames: Record<string, string> = {
  'Gangnam-gu': '강남구',
  'Seocho-gu': '서초구',
  'Songpa-gu': '송파구',
  'Gangdong-gu': '강동구',
  'Mapo-gu': '마포구',
  'Yongsan-gu': '용산구',
  'Jongno-gu': '종로구',
  'Seongdong-gu': '성동구',
  'Gwangjin-gu': '광진구',
  'Dongdaemun-gu': '동대문구',
  'Seongbuk-gu': '성북구',
  'Gangbuk-gu': '강북구',
  'Dobong-gu': '도봉구',
  'Nowon-gu': '노원구',
  'Eunpyeong-gu': '은평구',
  'Seodaemun-gu': '서대문구',
  'Yangcheon-gu': '양천구',
  'Gangseo-gu': '강서구',
  'Guro-gu': '구로구',
  'Geumcheon-gu': '금천구',
  'Yeongdeungpo-gu': '영등포구',
  'Dongjak-gu': '동작구',
  'Gwanak-gu': '관악구',
  'Jung-gu': '중구',
  'Jungnang-gu': '중랑구',
};
type SourceProps = { shapeID: string; shapeName: string };
const source = data as unknown as FeatureCollection<Polygon | MultiPolygon, SourceProps>;
export const regions: Region[] = source.features.map((feature) => {
  const id = `gb:${feature.properties.shapeID}`;
  const name = koreanNames[feature.properties.shapeName] ?? feature.properties.shapeName;
  return {
    id,
    name,
    sourceName: feature.properties.shapeName,
    bounds: geometryBounds(feature.geometry),
    feature: {
      type: 'Feature',
      id,
      geometry: feature.geometry,
      properties: { regionId: id, name, sourceName: feature.properties.shapeName },
    },
  };
});
export const regionById = new Map(regions.map((r) => [r.id, r]));
export const regionPack = {
  id: metadata.boundaryID,
  version: `${metadata.boundaryYearRepresented}-${metadata.downloadedSha256.slice(0, 12)}`,
  count: regions.length,
  year: metadata.boundaryYearRepresented,
  attribution: 'geoBoundaries / citypopulation.de · CC BY 3.0',
};

export function findRegion(longitude: number, latitude: number): Region | undefined {
  return regions.find(
    (r) =>
      longitude >= r.bounds[0] &&
      longitude <= r.bounds[2] &&
      latitude >= r.bounds[1] &&
      latitude <= r.bounds[3] &&
      containsPoint([longitude, latitude], r.feature.geometry),
  );
}
