import type { CelestialObject, ObjectKind, OrbitalElements } from './catalog'

type Nullable = number | null
export type StarRow = [
  string,
  string,
  string,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  string,
  Nullable,
]
export type ExoplanetRow = [
  string,
  string,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  string,
  Nullable,
]
export type MinorBodyRow = [
  string,
  string,
  string,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
  Nullable,
]
export interface CatalogMetadata {
  retrievedAt: string
  exoplanets: number
  comets: number
  minorPlanets: number
  stars: number
  starsWithDistances: number
  scope: string
}

export const extendedData: {
  stars: StarRow[]
  exoplanets: ExoplanetRow[]
  minorBodies: MinorBodyRow[]
  metadata: CatalogMetadata | null
} = { stars: [], exoplanets: [], minorBodies: [], metadata: null }
let index = new Map<
  string,
  {
    kind: ObjectKind
    row: StarRow | ExoplanetRow | MinorBodyRow
    search: string
  }
>()
const detailCache = new Map<string, CelestialObject>()
const searchCache = new Map<
  string,
  { objects: CelestialObject[]; counts: Partial<Record<ObjectKind, number>> }
>()
let loading: Promise<CatalogMetadata> | null = null

export const exoplanetId = (row: ExoplanetRow) => `exo:${row[0]}`
export const starId = (row: StarRow) => `hyg-${row[0]}`
export const minorBodyId = (row: MinorBodyRow) => `sb:${row[0]}`
export const minorBodyKind = (row: MinorBodyRow): ObjectKind =>
  row[2] === 'c'
    ? 'comet'
    : /\b(Ceres|Pluto|Eris|Haumea|Makemake)\b/i.test(row[1])
      ? 'dwarf-planet'
      : 'asteroid'
const value = (number: Nullable, unit = '') =>
  number === null
    ? 'Not available'
    : `${number.toLocaleString('en-US', { maximumFractionDigits: 3 })}${unit}`

export function stellarColor(spectral: string): string {
  const colors: Record<string, string> = {
    O: '#a7c4ff',
    B: '#c2d8ff',
    A: '#dce8ff',
    F: '#fff7dc',
    G: '#ffe8b7',
    K: '#ffca94',
    M: '#f3a184',
  }
  return colors[spectral[0]] ?? '#e0e4dc'
}

export function elementsFromRow(
  row: MinorBodyRow,
): OrbitalElements | undefined {
  if (
    row[5] === null ||
    row[6] === null ||
    row[7] === null ||
    row[8] === null ||
    row[12] === null ||
    row[12] <= 0
  )
    return undefined
  if (
    row[5] < 1 &&
    (row[4] === null || row[4] <= 0 || row[9] === null || row[10] === null)
  )
    return undefined
  if (row[5] >= 1 && row[11] === null) return undefined
  return {
    semiMajorAxis: row[4] ?? 0,
    eccentricity: row[5],
    inclination: row[6],
    ascendingNode: row[7],
    perihelionArgument: row[8],
    meanAnomaly: row[9] ?? 0,
    epoch: row[10] ?? 2451545,
    perihelionTime: row[11] ?? 2451545,
    perihelionDistance: row[12],
  }
}

async function fetchSnapshot(name: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`/data/${name}.json`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Catalog unavailable: ${name}`)
      return await response.json()
    } catch (error) {
      if (attempt === 1) throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`Catalog unavailable: ${name}`)
}

function hasValidRows<Row extends unknown[]>(
  payload: unknown,
  width: number,
  stringColumns: number[],
): payload is { rows: Row[] } {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('rows' in payload) ||
    !Array.isArray(payload.rows)
  )
    return false
  return payload.rows.every(
    (row) =>
      Array.isArray(row) &&
      row.length === width &&
      row.every((value, column) =>
        stringColumns.includes(column)
          ? typeof value === 'string'
          : value === null ||
            (typeof value === 'number' && Number.isFinite(value)),
      ),
  )
}

function isMetadata(payload: unknown): payload is CatalogMetadata {
  if (!payload || typeof payload !== 'object') return false
  const metadata = payload as Record<string, unknown>
  return (
    typeof metadata.retrievedAt === 'string' &&
    Number.isFinite(Date.parse(metadata.retrievedAt)) &&
    typeof metadata.scope === 'string' &&
    [
      'stars',
      'starsWithDistances',
      'exoplanets',
      'comets',
      'minorPlanets',
    ].every(
      (key) =>
        typeof metadata[key] === 'number' &&
        Number.isSafeInteger(metadata[key]) &&
        metadata[key] >= 0,
    )
  )
}

export async function loadExtendedCatalog(): Promise<CatalogMetadata> {
  if (extendedData.metadata) return extendedData.metadata
  if (loading) return loading
  loading = (async () => {
    const [stars, exoplanets, minorBodies, metadata] = await Promise.all(
      ['stars', 'exoplanets', 'minor-bodies', 'metadata'].map(fetchSnapshot),
    )
    if (
      !hasValidRows<StarRow>(stars, 9, [0, 1, 2, 7]) ||
      !hasValidRows<ExoplanetRow>(exoplanets, 15, [0, 1, 13]) ||
      !hasValidRows<MinorBodyRow>(minorBodies, 14, [0, 1, 2]) ||
      !isMetadata(metadata)
    )
      throw new Error('Invalid catalog snapshot')
    if (
      metadata.stars !== stars.rows.length ||
      metadata.exoplanets !== exoplanets.rows.length ||
      metadata.comets !==
        minorBodies.rows.filter((row) => row[2] === 'c').length ||
      metadata.minorPlanets !==
        minorBodies.rows.filter((row) => row[2] === 'a').length ||
      metadata.starsWithDistances > metadata.stars
    )
      throw new Error('Inconsistent catalog snapshot')
    const nextIndex: typeof index = new Map()
    for (const row of stars.rows)
      nextIndex.set(starId(row), {
        kind: 'star',
        row,
        search: `${row[1]} ${row[2]} ${row[7]} star`.toLowerCase(),
      })
    for (const row of exoplanets.rows)
      nextIndex.set(exoplanetId(row), {
        kind: 'exoplanet',
        row,
        search: `${row[0]} ${row[1]} exoplanet ${row[13]}`.toLowerCase(),
      })
    for (const row of minorBodies.rows) {
      const kind = minorBodyKind(row)
      nextIndex.set(minorBodyId(row), {
        kind,
        row,
        search: `${row[1]} ${kind.replaceAll('-', ' ')}`.toLowerCase(),
      })
    }
    if (
      nextIndex.size !==
      stars.rows.length + exoplanets.rows.length + minorBodies.rows.length
    )
      throw new Error('Duplicate catalog identifiers')
    extendedData.stars = stars.rows
    extendedData.exoplanets = exoplanets.rows
    extendedData.minorBodies = minorBodies.rows
    index = nextIndex
    detailCache.clear()
    searchCache.clear()
    extendedData.metadata = metadata
    return extendedData.metadata!
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

export function hasExtendedObject(id: string) {
  return index.has(id)
}

export function getExtendedObject(id: string): CelestialObject | undefined {
  const cached = detailCache.get(id)
  if (cached) return cached
  const entry = index.get(id)
  if (!entry) return undefined
  const baseOrbit = {
    parent: 'Milky Way',
    period: 'Not constrained',
    speed: 'Not specified',
    model: 'illustrative' as const,
    note: 'Position uses catalog coordinates. An individual galactic orbit is not supplied by this catalog; no measured future trajectory is implied.',
  }
  let object: CelestialObject
  if (entry.kind === 'star') {
    const row = entry.row as StarRow
    object = {
      id,
      name: row[1],
      kind: 'star',
      scene: 'star',
      classification: row[7] ? `${row[7]} star` : 'Cataloged star',
      subtitle: 'A point of light, a world of possibilities.',
      description: `HYG v4.1 stellar entry. ${row[2]}. Position is referred to epoch J2000. Stars without a reliable catalog distance remain searchable but are not assigned an invented map position.`,
      location: 'Stellar neighborhood / Milky Way',
      parent: 'nearby-stars',
      distance:
        row[8] === null
          ? 'Distance not constrained'
          : `${value(row[8] * 3.26156)} light-years`,
      color: stellarColor(row[7]),
      galacticPosition:
        row[3] === null || row[4] === null || row[5] === null
          ? undefined
          : [row[3], row[4], row[5]],
      facts: [
        { label: 'Distance', value: value(row[8], ' pc') },
        { label: 'Visual magnitude', value: value(row[6]) },
        { label: 'Spectral type', value: row[7] || 'Not available' },
        { label: 'Reference epoch', value: 'J2000' },
      ],
      orbit: baseOrbit,
      source: 'https://github.com/astronexus/HYG-Database/tree/main/hyg',
    }
  } else if (entry.kind === 'exoplanet') {
    const row = entry.row as ExoplanetRow
    const radius = row[10]
    object = {
      id,
      name: row[0],
      kind: 'exoplanet',
      scene: 'planet',
      classification: 'Confirmed exoplanet',
      subtitle: `A world around ${row[1]}.`,
      description: `Confirmed planet in the NASA Exoplanet Archive, discovered by ${row[13] || 'an astronomical survey'}${row[14] ? ` in ${row[14]}` : ''}. The map marker uses the host star's position, not a resolved planet position. Surface appearance and orbital orientation are unknown; the close-up is illustrative.`,
      location: `${row[1]} / Milky Way`,
      parent: 'nearby-stars',
      distance:
        row[5] === null
          ? 'Distance not constrained'
          : `${value(row[5] * 3.26156)} light-years`,
      color: radius !== null && radius > 4 ? '#d3b78c' : '#9baea6',
      galacticPosition:
        row[2] === null || row[3] === null || row[4] === null
          ? undefined
          : [row[2], row[3], row[4]],
      radiusKm: radius === null ? undefined : radius * 6371,
      facts: [
        { label: 'Radius', value: value(row[10], ' Earth') },
        { label: 'Mass / minimum mass', value: value(row[11], ' Earth') },
        { label: 'Equilibrium temperature', value: value(row[12], ' K') },
        { label: 'Discovery', value: value(row[14]) },
      ],
      orbit: {
        ...baseOrbit,
        parent: row[1],
        period: row[6] === null ? 'Not available' : `${value(row[6])} days`,
        periodDays: row[6] ?? undefined,
        semiMajorAxis: row[7] ?? undefined,
        eccentricity: row[8] ?? undefined,
        inclination: row[9] ?? undefined,
        note: 'Orbital parameters are from NASA PSCompPars. These composite measurements may come from different references. Phase and full orientation are not known here; no precise planet trajectory is drawn.',
      },
      source: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(row[0])}`,
    }
  } else {
    const row = entry.row as MinorBodyRow
    const elements = elementsFromRow(row)
    object = {
      id,
      name: row[1],
      kind: entry.kind,
      scene: entry.kind === 'comet' ? 'comet' : 'planet',
      classification:
        entry.kind === 'comet'
          ? row[5] !== null && row[5] >= 1
            ? 'Unbound / near-parabolic comet'
            : 'Comet'
          : entry.kind === 'dwarf-planet'
            ? 'Dwarf planet'
            : 'Minor planet / asteroid',
      subtitle:
        entry.kind === 'comet'
          ? 'A visitor from the cold.'
          : 'A smaller world in the Solar System.',
      description: `JPL Small-Body Database entry ${row[0]}. The displayed path is a two-body approximation from osculating elements, not a full JPL ephemeris. Perturbations, outgassing, and uncertainty can make distant-date positions inaccurate. Shape, surface, and comet tails are illustrative.`,
      location: 'Solar System',
      parent: 'solar-system',
      distance: elements
        ? `${value(row[12], ' AU')} at perihelion`
        : 'Position not available',
      color: entry.kind === 'comet' ? '#92ded6' : '#beb9ac',
      radiusKm: row[3] === null ? undefined : row[3] / 2,
      elements,
      facts: [
        { label: 'Diameter', value: value(row[3], ' km') },
        { label: 'Perihelion', value: value(row[12], ' AU') },
        { label: 'Eccentricity', value: value(row[5]) },
        { label: 'Elements epoch', value: value(row[10], ' JD TDB') },
      ],
      orbit: {
        parent: 'Sun',
        period:
          row[5] !== null && row[5] >= 1
            ? 'Open trajectory'
            : row[13] === null
              ? 'Not available'
              : `${value(row[13])} days`,
        periodDays: row[13] ?? undefined,
        semiMajorAxis: row[4] ?? undefined,
        eccentricity: row[5] ?? undefined,
        inclination: row[6] ?? undefined,
        speed: 'Variable along orbit',
        model: elements ? 'kepler' : 'none',
        note: 'JPL osculating elements propagated with Astronomia. This is an approximate two-body trajectory; planetary perturbations and nongravitational forces are omitted. Open trajectories have no orbital period.',
      },
      source: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(row[0])}`,
    }
  }
  if (detailCache.size > 1500) detailCache.clear()
  detailCache.set(id, object)
  return object
}

export function searchExtendedCatalog(
  query: string,
  scope: 'all' | 'nearby' | 'deep',
  limit = 24,
) {
  const normalized = query.trim().toLowerCase()
  const key = `${normalized}|${scope}|${limit}`
  const cached = searchCache.get(key)
  if (cached) return cached
  const counts: Partial<Record<ObjectKind, number>> = {}
  const chosen: Partial<Record<ObjectKind, string[]>> = {}
  const exact: string[] = []
  for (const [id, entry] of index) {
    const local = ['comet', 'asteroid', 'dwarf-planet'].includes(entry.kind)
    if (
      (scope === 'nearby' && !local) ||
      (scope === 'deep' && local) ||
      !entry.search.includes(normalized)
    )
      continue
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
    const name = entry.kind === 'exoplanet' ? entry.row[0] : entry.row[1]
    if (String(name).toLowerCase() === normalized && normalized) exact.push(id)
    const group = (chosen[entry.kind] ??= [])
    if (group.length < limit) group.push(id)
  }
  const ids = [...new Set([...exact, ...Object.values(chosen).flat()])]
  const result = { objects: ids.map((id) => getExtendedObject(id)!), counts }
  if (searchCache.size > 32) searchCache.clear()
  searchCache.set(key, result)
  return result
}
