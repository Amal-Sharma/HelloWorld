import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { PerspectiveCamera, Vector2, Vector3 } from 'three'
import { ContinuousMap } from '../components/ContinuousMap'
import {
  extendedData,
  loadExtendedCatalog,
  searchExtendedCatalog,
  starId,
} from '../data/extendedCatalog'
import {
  catalog,
  categories,
  earth,
  getAncestry,
  objectById,
  searchCatalog,
  solarPlanets,
} from '../data/catalog'
import {
  clampTime,
  DAY_MS,
  displayPosition,
  distanceAu,
  getPosition,
  MAX_DATE,
  MIN_DATE,
  sampleOrbit,
  secondsIntoDay,
} from './astronomy'

import {
  absolutePosition,
  AU_PER_PARSEC,
  catalogToWorld,
  relativePosition,
  renderUnitPc,
  solarPositionPc,
} from './mapCoordinates'

const date = new Date('2026-09-16T12:00:00Z')

describe('continuous map coordinates', () => {
  it('keeps a followed distant quasar separated from the camera at extreme zoom', () => {
    const position = new Vector3(-6.2e8, 5.4e9, -1.0e8)
    const quasar = { id: 'quasar', position, radius: 0.004, kind: 'quasar' }
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 1)
    const map: ContinuousMap = Object.assign(
      Object.create(ContinuousMap.prototype),
      {
        camera,
        controls: { target: new Vector3() },
        origin: position.clone(),
        unit: 1,
        worldCamera: new Vector3(),
        worldTarget: new Vector3(),
        following: quasar,
        followLocked: true,
        host: { querySelector: () => ({ dataset: {} }) },
      },
    )
    map.zoom(1e-14)
    const flight = Object.getOwnPropertyDescriptor(map, 'flight')!.value as {
      camera: Vector3
      target: Vector3
    }
    expect(flight.camera.distanceTo(flight.target)).toBeGreaterThan(
      quasar.radius,
    )
    expect(flight.camera.toArray().every(Number.isFinite)).toBe(true)
    expect(flight.target.distanceTo(position)).toBe(0)
  })
  it('keeps a selected planet centered even when zooming over another body', () => {
    const camera = new PerspectiveCamera()
    camera.position.set(1, 0, 0.2)
    const planet = {
      id: 'earth',
      position: new Vector3(1, 0, 0),
      radius: 0.02,
      kind: 'planet',
      solar: earth,
    }
    const sun = {
      id: 'sun',
      position: new Vector3(),
      radius: 0.05,
      kind: 'star',
    }
    const surface = { dataset: {} }
    const map: ContinuousMap = Object.assign(
      Object.create(ContinuousMap.prototype),
      {
        camera,
        controls: { target: planet.position.clone() },
        worldCamera: new Vector3(),
        worldTarget: new Vector3(),
        origin: new Vector3(),
        unit: 1,
        velocity: new Vector3(),
        previousFollowPosition: new Vector3(),
        index: new Map([
          ['earth', planet],
          ['sun', sun],
        ]),
        options: { catalogRevision: 1 },
        host: { querySelector: () => surface },
      },
    )
    map.flyTo('earth', true)
    for (const factor of [0.5, 2, 0.75]) {
      map.zoom(factor, new Vector2(0, 0), 'sun')
      const flight = Object.getOwnPropertyDescriptor(map, 'flight')!.value as {
        camera: Vector3
        target: Vector3
      }
      expect(flight.target.distanceTo(planet.position)).toBeLessThan(1e-12)
      expect(flight.camera.toArray().every(Number.isFinite)).toBe(true)
    }
  })
  it('replaces an in-flight absolute zoom instead of multiplying it', () => {
    const surface = { dataset: {} }
    const map: ContinuousMap = Object.assign(
      Object.create(ContinuousMap.prototype),
      {
        camera: { position: new Vector3(0, 0, 4) },
        controls: { target: new Vector3() },
        worldCamera: new Vector3(),
        worldTarget: new Vector3(),
        origin: new Vector3(),
        unit: 1,
        flight: { camera: new Vector3(0, 0, 1000), target: new Vector3() },
        host: { querySelector: () => surface },
      },
    )
    map.setScale(10)
    const flight = Object.getOwnPropertyDescriptor(map, 'flight')!.value as {
      camera: Vector3
      target: Vector3
    }
    expect(flight.camera.distanceTo(flight.target)).toBeCloseTo(10, 12)
    for (const invalid of [NaN, Infinity, -1, 0]) {
      map.setScale(invalid)
      map.zoom(invalid)
      expect(Object.getOwnPropertyDescriptor(map, 'flight')!.value).toBe(flight)
    }
  })
  it('keeps planetary distances metric in the shared Galactic frame', () => {
    const position = solarPositionPc(earth, date)
    expect(Math.hypot(...position) * AU_PER_PARSEC).toBeCloseTo(
      distanceAu(getPosition(earth, date)),
      9,
    )
    const moon = solarPositionPc(objectById.get('moon')!, date)
    expect(
      Math.hypot(
        ...moon.map((coordinate, index) => coordinate - position[index]),
      ) * AU_PER_PARSEC,
    ).toBeCloseTo(distanceAu(getPosition(objectById.get('moon')!, date)), 9)
  })
  it('preserves world positions through origin and scale changes', () => {
    const position: [number, number, number] = [2.3, -0.015, 4.2]
    for (const distance of [1e-9, 1e-4, 1, 1e4, 1e9]) {
      const origin: [number, number, number] = [2, -0.01, 4]
      const unit = renderUnitPc(distance)
      const projected = relativePosition(position, origin, unit)
      const restored = absolutePosition(projected, origin, unit)
      restored.forEach((coordinate, index) =>
        expect(coordinate).toBeCloseTo(position[index], 12),
      )
    }
    expect(catalogToWorld([1, 2, 3])).toEqual([1, 3, -2])
  })
})

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    async (path: string) =>
      new Response(
        await readFile(new URL(`../../public${path}`, import.meta.url), 'utf8'),
      ),
  )
  try {
    await loadExtendedCatalog()
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('astronomy model', () => {
  it('places all Galilean moons around Jupiter in the shared world frame', () => {
    const jupiter = objectById.get('jupiter')!
    const primary = solarPositionPc(jupiter, date)
    for (const id of ['io', 'europa', 'ganymede', 'callisto']) {
      const moon = objectById.get(id)!
      const local = getPosition(moon, date)
      const world = solarPositionPc(moon, date)
      expect(
        Math.hypot(
          ...world.map((coordinate, index) => coordinate - primary[index]),
        ) * AU_PER_PARSEC,
      ).toBeCloseTo(distanceAu(local), 9)
      expect(distanceAu(local) / moon.orbit.semiMajorAxis!).toBeGreaterThan(
        0.96,
      )
      expect(distanceAu(local) / moon.orbit.semiMajorAxis!).toBeLessThan(1.04)
      expect(sampleOrbit(moon, date, 60)).toHaveLength(61)
      expect(getAncestry(id).at(-2)?.id).toBe('jupiter')
    }
  })
  it('includes additional deep-sky destinations with finite reference coordinates', () => {
    const mapped = catalog.filter((object) => object.skyPosition)
    expect(mapped.length).toBeGreaterThanOrEqual(20)
    expect(mapped.some((object) => object.kind === 'star-cluster')).toBe(true)
    for (const object of mapped) {
      expect(Object.values(object.skyPosition!).every(Number.isFinite)).toBe(
        true,
      )
      expect(object.skyPosition!.distancePc).toBeGreaterThan(0)
      expect(object.skyPosition!.radiusPc).toBeGreaterThan(0)
    }
  })
  it('places Earth approximately one AU from the Sun', () => {
    expect(distanceAu(getPosition(earth, date))).toBeGreaterThan(0.98)
    expect(distanceAu(getPosition(earth, date))).toBeLessThan(1.02)
  })

  it('moves Earth to the other side of the Sun after half a year', () => {
    const start = getPosition(earth, date)
    const later = getPosition(earth, new Date(date.getTime() + 182.6 * DAY_MS))
    expect(start[0] * later[0] + start[2] * later[2]).toBeLessThan(-0.95)
  })

  it('computes all eight planets and approximately closed orbital paths', () => {
    expect(solarPlanets).toHaveLength(8)
    for (const planet of solarPlanets) {
      const radius = distanceAu(getPosition(planet, date))
      expect(radius).toBeGreaterThan(planet.orbit.semiMajorAxis! * 0.7)
      expect(radius).toBeLessThan(planet.orbit.semiMajorAxis! * 1.3)
      const path = sampleOrbit(planet, date, 48)
      expect(path).toHaveLength(49)
      const error = Math.hypot(
        ...path[0].map((coordinate, index) => coordinate - path[48][index]),
      )
      expect(error / radius).toBeLessThan(0.12)
    }
  })

  it('uses a geocentric lunar orbit and does not invent orbits for deep-sky objects', () => {
    expect(
      distanceAu(getPosition(objectById.get('moon')!, date)),
    ).toBeGreaterThan(0.0023)
    expect(distanceAu(getPosition(objectById.get('moon')!, date))).toBeLessThan(
      0.0028,
    )
    expect(sampleOrbit(objectById.get('universe')!, date)).toEqual([])
    expect(sampleOrbit(objectById.get('sagittarius-a')!, date)).toEqual([])
  })

  it('preserves orbital direction while compressing distances', () => {
    const position = getPosition(earth, date)
    const displayed = displayPosition(position, true)
    expect(displayed[0] / displayed[2]).toBeCloseTo(position[0] / position[2])
    expect(displayPosition([0, 0, 0], true)).toEqual([0, 0, 0])
  })

  it('bounds simulation time to the supported interval', () => {
    expect(clampTime(MIN_DATE - DAY_MS)).toBe(MIN_DATE)
    expect(clampTime(MAX_DATE + DAY_MS)).toBe(MAX_DATE)
    expect(Number.isFinite(clampTime(NaN))).toBe(true)
  })
})

describe('object catalog', () => {
  it('has unique ids, valid parents, and all requested categories', () => {
    expect(new Set(catalog.map((object) => object.id)).size).toBe(
      catalog.length,
    )
    for (const category of categories)
      expect(
        searchCatalog('').some((object) => object.kind === category.kind),
      ).toBe(true)
    for (const object of catalog) {
      if (object.parent) expect(objectById.has(object.parent)).toBe(true)
      expect(object.source.startsWith('https://')).toBe(true)
      expect(object.orbit.note.length).toBeGreaterThan(20)
    }
  })

  it('navigates from Earth through its enclosing structures', () => {
    expect(getAncestry('earth').map((object) => object.id)).toEqual([
      'universe',
      'laniakea',
      'local-group',
      'milky-way',
      'solar-system',
      'earth',
    ])
    expect(getAncestry('missing')).toEqual([])
  })

  it('searches names, classifications, aliases, and distance scopes', () => {
    expect(searchCatalog(' EARTH ')[0].id).toBe('earth')
    expect(searchCatalog('blackhole').length).toBeGreaterThanOrEqual(3)
    expect(
      searchCatalog('tsar').every((object) => object.kind === 'quasar'),
    ).toBe(true)
    expect(
      searchCatalog('', 'nearby').some((object) => object.kind === 'comet'),
    ).toBe(true)
    expect(
      searchCatalog('', 'nearby').some((object) => object.kind === 'exoplanet'),
    ).toBe(false)
    expect(searchCatalog('Earth', 'deep')).toHaveLength(0)
    expect(searchCatalog('no-such-object')).toHaveLength(0)
  })
})

describe('expanded source catalogs', () => {
  it('indexes the full imported confirmed-planet, comet, and stellar snapshots', () => {
    expect(extendedData.exoplanets.length).toBeGreaterThan(6000)
    expect(extendedData.stars.length).toBeGreaterThan(100000)
    expect(
      extendedData.minorBodies.filter((row) => row[2] === 'c').length,
    ).toBeGreaterThan(4000)
    expect(
      searchCatalog('TRAPPIST-1 e').some(
        (object) => object.kind === 'exoplanet',
      ),
    ).toBe(true)
    expect(
      searchCatalog('Ceres').some((object) => object.kind === 'dwarf-planet'),
    ).toBe(true)
    for (const name of ['Ceres', 'Pluto', 'Eris', 'Haumea', 'Makemake']) {
      const dwarf = searchCatalog(name).find(
        (object) => object.kind === 'dwarf-planet',
      )
      expect(dwarf, name).toBeDefined()
      expect(getPosition(dwarf!, date).every(Number.isFinite), name).toBe(true)
    }
    expect(searchExtendedCatalog('', 'all').objects.length).toBeLessThan(130)
  })
  it('propagates Halley with source-backed elements and samples a closed ellipse', () => {
    const halley = searchCatalog('1P/Halley').find(
      (object) => object.name === '1P/Halley',
    )!
    expect(halley.elements).toBeDefined()
    const position = getPosition(halley, date)
    expect(position.every(Number.isFinite)).toBe(true)
    expect(distanceAu(position)).toBeGreaterThan(0.5)
    expect(distanceAu(position)).toBeLessThan(40)
    const path = sampleOrbit(halley, date)
    expect(
      Math.hypot(
        ...path[0].map((coordinate, index) => coordinate - path.at(-1)![index]),
      ),
    ).toBeLessThan(0.001)
  })
  it('does not invent distances for stars with missing parallax', () => {
    const missing = extendedData.stars.find((row) => row[8] === null)!
    expect(objectById.get(starId(missing))!.galacticPosition).toBeUndefined()
  })
  it('handles time-of-day scrubbing before the Unix epoch', () => {
    expect(secondsIntoDay(Date.UTC(1950, 1, 1, 18, 30))).toBe(
      18 * 3600 + 30 * 60,
    )
  })
})
