import type { CelestialObject } from '../data/catalog'

export function physicalRadius(object: CelestialObject): number | null {
  const radius = object.blackHole
    ? object.blackHole.massSolar * 2.95325
    : object.radiusKm
  if (object.kind === 'rogue-planet' || object.kind === 'spacecraft')
    return null
  return radius && Number.isFinite(radius) && radius > 0 ? radius : null
}

export function comparisonLayout(objects: CelestialObject[]) {
  const known = objects
    .map((object) => ({ object, radiusKm: physicalRadius(object) }))
    .filter(
      (item): item is { object: CelestialObject; radiusKm: number } =>
        item.radiusKm !== null,
    )
  if (!known.length) return []
  const maximum = Math.max(...known.map((item) => item.radiusKm))
  let cursor = 0
  const layout = known.map(({ object, radiusKm }) => {
    const radius = (radiusKm / maximum) * 2
    const center = cursor + radius
    cursor += radius * 2 + 0.4
    return { id: object.id, radiusKm, radius, center }
  })
  return layout.map((item) => ({
    ...item,
    center: item.center - (cursor - 0.4) / 2,
  }))
}

export function scientificConfidence(object: CelestialObject) {
  return {
    position: object.trajectory
      ? 'Horizons samples'
      : object.body || object.jovianMoon || object.id === 'moon'
        ? 'Calculated ephemeris'
        : object.elements
          ? 'Approximate orbit'
          : object.kind === 'exoplanet'
            ? 'Host-star coordinates'
            : object.skyPosition || object.galacticPosition
              ? 'Catalog estimate'
              : object.kind === 'system' ||
                  object.kind === 'void' ||
                  object.kind === 'universe'
                ? 'Reference region'
                : 'Reference position',
    size: object.blackHole
      ? 'Inferred horizon'
      : object.kind === 'rogue-planet'
        ? 'Illustrative radius'
        : physicalRadius(object)
          ? object.body || object.kind === 'moon'
            ? 'Reference radius'
            : 'Estimated radius'
          : 'Not constrained',
    classification: /candidate|uncertain/i.test(object.classification)
      ? 'Candidate / uncertain'
      : 'Catalog classification',
    appearance: object.model
      ? 'NASA-hosted model'
      : object.texture
        ? 'Mapped texture'
        : 'Artistic reconstruction',
  }
}
