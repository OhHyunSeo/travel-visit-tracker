import { readBackgroundMapPlan, type BackgroundMapPlan } from './backgroundMapPlan';

const marker = 'trip-painting-background-map';
export const backgroundMapUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;

export type BackgroundMapPackMetadata = Readonly<{
  kind: typeof marker;
  schemaVersion: 1;
  operationId: string;
  plan: string;
  tileJsonSha256: string;
  localStyleSha256: string;
}>;

type PackIdentity = Pick<
  BackgroundMapPackMetadata,
  'operationId' | 'tileJsonSha256' | 'localStyleSha256'
>;

const metadataKeys = [
  'kind',
  'schemaVersion',
  'operationId',
  'plan',
  'tileJsonSha256',
  'localStyleSha256',
] as const;

function isPackIdentity<T extends Record<string, unknown>>(value: T): value is T & PackIdentity {
  return (
    typeof value.operationId === 'string' &&
    backgroundMapUuid.test(value.operationId) &&
    typeof value.tileJsonSha256 === 'string' &&
    digest.test(value.tileJsonSha256) &&
    typeof value.localStyleSha256 === 'string' &&
    digest.test(value.localStyleSha256)
  );
}

/** Store the same operation and exact style revision in the SDK's pack context. */
export function createBackgroundMapPackMetadata(
  plan: BackgroundMapPlan,
  identity: PackIdentity,
): BackgroundMapPackMetadata {
  if (!isPackIdentity(identity)) throw new Error('Invalid background map pack identity');
  const serialized = JSON.stringify(plan);
  readBackgroundMapPlan(serialized);
  return Object.freeze({
    kind: marker,
    schemaVersion: 1,
    operationId: identity.operationId,
    plan: serialized,
    tileJsonSha256: identity.tileJsonSha256,
    localStyleSha256: identity.localStyleSha256,
  });
}

export function readBackgroundMapPackMetadata(input: unknown): BackgroundMapPackMetadata {
  if (typeof input !== 'object' || !input || Array.isArray(input))
    throw new Error('Invalid background map pack metadata');
  const value = input as Record<string, unknown>;
  if (
    value.kind !== marker ||
    value.schemaVersion !== 1 ||
    typeof value.plan !== 'string' ||
    !isPackIdentity(value) ||
    Object.keys(value).length !== metadataKeys.length ||
    !metadataKeys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error('Invalid background map pack metadata');
  }
  return createBackgroundMapPackMetadata(readBackgroundMapPlan(value.plan), value);
}

/** Find a single SDK pack for an operation, including after a restart before its ID was saved. */
export function findBackgroundMapPack(
  packs: readonly { id: unknown; bounds: unknown; metadata: unknown }[],
  expected: BackgroundMapPackMetadata,
  recordedPackId?: string,
): { kind: 'found'; packId: string } | { kind: 'missing' | 'conflict' } {
  const plan = readBackgroundMapPlan(expected.plan);
  let match: string | undefined;
  for (const pack of packs) {
    const value = pack.metadata;
    const metadata =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
    const claimsOperation =
      metadata?.kind === marker && metadata.operationId === expected.operationId;
    const usesRecordedId = recordedPackId !== undefined && pack.id === recordedPackId;
    if (!claimsOperation && !usesRecordedId) continue;

    const bounds = pack.bounds;
    if (
      !claimsOperation ||
      !metadata ||
      Object.keys(metadata).length !== metadataKeys.length ||
      !metadataKeys.every(
        (key) => Object.hasOwn(metadata, key) && metadata[key] === expected[key],
      ) ||
      match !== undefined ||
      typeof pack.id !== 'string' ||
      !backgroundMapUuid.test(pack.id) ||
      (recordedPackId !== undefined && !usesRecordedId) ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !plan.bounds.every((coordinate, index) => coordinate === bounds[index])
    ) {
      return { kind: 'conflict' };
    }
    match = pack.id;
  }
  return match === undefined ? { kind: 'missing' } : { kind: 'found', packId: match };
}
