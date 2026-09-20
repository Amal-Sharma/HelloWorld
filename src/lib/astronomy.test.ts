import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Group, PerspectiveCamera, Vector2, Vector3 } from 'three'
import { ContinuousMap } from '../components/ContinuousMap'
import {
  extendedData,
  elementsFromRow,
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
  sampleSmallBodyOrbit,
  secondsIntoDay,
} from './astronomy'

import {
  absolutePosition,
  AU_PER_PARSEC,
  catalogToWorld,
  relativePosition,
  renderUnitPc,
  solarPositionPc,
  skyPositionPc,
  formatWorldDistance,
  KM_PER_PARSEC,
  LIGHT_SPEED_KM_S,
  measurePositions,
  formatLightTime,
  formatRulerDistance,
  referencePositionPc,
  LANIAKEA_RADIUS_PC,
  OBSERVABLE_RADIUS_PC,
  mapWheelZoomFactor,
  overviewOpacity,
} from './mapCoordinates'

const date = new Date('2026-09-16T12:00:00Z')

import { parseViewpoint, readSharedViewpoint, viewpointUrl } from './viewpoints'
import {
  comparisonLayout,
  physicalRadius,
  scientificConfidence,
} from './scienceTools'
import {
  defaultObserver,
  earthShadow,
  horizontalDirection,
  observerBody,
  upcomingEvents,
  validObserver,
} from './observer'
import { Body } from 'astronomy-engine'
import { missions } from '../data/missions'
import { observationBands, spectralResponse, thermalResponse } from './spectrum'
import { atlasExperiences } from '../data/experiences'
import { expansionScale } from './cosmology'

describe('atlas experience mappings', () => {
  it('keeps Phobos and Deimos paths centered on Mars at their own mean motions', () => {
    const mars = objectById.get('mars')!
    expect(mars.members).toEqual(['phobos', 'deimos'])
    for (const id of mars.members!) {
      const moon = objectById.get(id)!
      const local = getPosition(moon, date)
      const separation = measurePositions(
        solarPositionPc(mars, date),
        solarPositionPc(moon, date),
      )!
      expect(separation.distancePc * AU_PER_PARSEC).toBeCloseTo(
        distanceAu(local),
        10,
      )
      expect(distanceAu(local) / moon.orbit.semiMajorAxis!).toBeGreaterThan(
        0.98,
      )
      expect(distanceAu(local) / moon.orbit.semiMajorAxis!).toBeLessThan(1.02)
      expect(sampleOrbit(moon, date)).toHaveLength(181)
      expect(scientificConfidence(moon).position).toBe('Approximate orbit')
    }
  })
  it('maps every listed reference experience to a catalog destination', () => {
    expect(atlasExperiences).toHaveLength(15)
    expect(new Set(atlasExperiences.map((item) => item.reference)).size).toBe(
      15,
    )
    for (const item of atlasExperiences)
      expect(objectById.has(item.id), item.name).toBe(true)
  })
  it('keeps Proxima orbital distances around the host and marks invented orientation and radii', () => {
    const host = referencePositionPc(objectById.get('proxima')!)!
    for (const id of [
      'exo:Proxima Cen b',
      'exo:Proxima Cen d',
      'proxima-c',
    ]) {
      const planet = objectById.get(id)!
      const local = getPosition(planet, date)
      expect(distanceAu(local)).toBeCloseTo(planet.orbit.semiMajorAxis!, 8)
      expect(
        measurePositions(host, solarPositionPc(planet, date))!.distancePc *
          AU_PER_PARSEC,
      ).toBeCloseTo(planet.orbit.semiMajorAxis!, 7)
      const later = getPosition(
        planet,
        new Date(date.getTime() + planet.orbit.periodDays! * DAY_MS),
      )
      expect(
        new Vector3(...later).distanceTo(new Vector3(...local)),
        'Period wrapping includes TT-versus-UTC drift',
      ).toBeLessThan(planet.orbit.semiMajorAxis! * 1e-6)
      expect(physicalRadius(planet)).toBeNull()
    }
    expect(objectById.get('proxima-c')!.classification).toMatch(/candidate/i)
  })
  it('normalizes the cosmological illustration and accelerates at late times', () => {
    expect(expansionScale(13.8)).toBe(1)
    expect(expansionScale(1)).toBeLessThan(expansionScale(5))
    expect(expansionScale(25) - expansionScale(20)).toBeGreaterThan(
      expansionScale(20) - expansionScale(15),
    )
    expect(expansionScale(NaN)).toBe(1)
    expect(expansionScale(100)).toBe(expansionScale(30))
  })
})

describe('illustrative wavelength models', () => {
  it('distinguishes cool thermal bodies, hot remnants and energetic sources without inventing void emission', () => {
    expect(thermalResponse(288, 10e-6)).toBeGreaterThan(
      thermalResponse(288, 550e-9),
    )
    expect(thermalResponse(25000, 150e-9)).toBeGreaterThan(
      thermalResponse(25000, 10e-6),
    )
    expect(thermalResponse(0, 1)).toBe(0)
    expect(thermalResponse(5772, NaN)).toBe(0)
    expect(spectralResponse(earth, 'infrared')).toBeGreaterThan(0.5)
    expect(spectralResponse(earth, 'gamma')).toBe(0)
    expect(spectralResponse(objectById.get('sirius-b')!, 'gamma')).toBe(0)
    expect(
      spectralResponse(objectById.get('crab-pulsar')!, 'gamma'),
    ).toBeGreaterThan(0.5)
    expect(spectralResponse(objectById.get('gaia-bh1')!, 'xray')).toBe(0)
    for (const band of observationBands) {
      expect(spectralResponse(objectById.get('bootes-void')!, band.id)).toBe(
        0,
      )
      for (const object of catalog)
        expect(
          Number.isFinite(spectralResponse(object, band.id)),
          `${object.id}:${band.id}`,
        ).toBe(true)
    }
  })
})

describe('large-scale reference groups', () => {
  it('places compact white dwarfs at catalog distances with physical reference radii', () => {
    expect(
      categories.some((category) => category.kind === 'white-dwarf'),
    ).toBe(true)
    for (const id of ['sirius-b', '40-eridani-b', 'van-maanen']) {
      const dwarf = objectById.get(id)!
      expect(dwarf.kind).toBe('white-dwarf')
      expect(dwarf.radiusKm).toBeGreaterThan(4000)
      expect(dwarf.radiusKm).toBeLessThan(15000)
      expect(dwarf.skyPosition!.radiusPc * KM_PER_PARSEC).toBeCloseTo(
        dwarf.radiusKm!,
        5,
      )
      expect(Math.hypot(...referencePositionPc(dwarf)!)).toBeCloseTo(
        dwarf.skyPosition!.distancePc,
        8,
      )
      expect(physicalRadius(dwarf)).toBe(dwarf.radiusKm)
      expect(sampleOrbit(dwarf, date)).toEqual([])
    }
    expect(searchCatalog('Sirius B')[0].id).toBe('sirius-b')
  })
  it('keeps the NGC 6769 triplet at catalog directions with unresolved shared depth', () => {
    const group = objectById.get('ngc-6769-group')!
    expect(group.members).toEqual(['ngc-6769', 'ngc-6770', 'ngc-6771'])
    const center = new Vector3(...referencePositionPc(group)!)
    const positions = group.members!.map((id) => {
      const member = objectById.get(id)!
      expect(member.parent).toBe(group.id)
      expect(member.skyPosition!.distancePc).toBe(58000000)
      expect(member.coordinateSource).toContain('simbad.cds.unistra.fr')
      const position = new Vector3(...referencePositionPc(member)!)
      expect(position.length()).toBeCloseTo(58000000, 5)
      expect(
        position.distanceTo(center) + member.skyPosition!.radiusPc,
      ).toBeLessThan(group.skyPosition!.radiusPc)
      return position
    })
    for (let index = 0; index < positions.length; index++) {
      const separation = positions[index].distanceTo(
        positions[(index + 1) % positions.length],
      )
      expect(separation).toBeGreaterThan(25000)
      expect(separation).toBeLessThan(65000)
    }
    expect(searchCatalog('NGC 6769 Group')[0].id).toBe(group.id)
  })

  it('provides finite source-based reference groups for the Laniakea illustration', () => {
    const basin = objectById.get('laniakea')!
    for (const id of basin.members!) {
      const position = referencePositionPc(objectById.get(id)!)!
      expect(position.every(Number.isFinite), id).toBe(true)
      expect(Math.hypot(...position), id).toBeLessThan(80000000)
    }
    expect(
      referencePositionPc(objectById.get('norma-cluster')!)!,
    ).toHaveLength(3)
    expect(referencePositionPc(earth)).toBeNull()
  })
})

describe('shareable viewpoints', () => {
  it('computes observer directions and known eclipse and transit events', () => {
    expect(horizontalDirection(0, 0)).toEqual([0, 0, -1])
    expect(horizontalDirection(90, 0)[0]).toBeCloseTo(1)
    expect(validObserver({ ...defaultObserver, latitude: 91 })).toBe(false)
    const noon = observerBody(
      Body.Sun,
      new Date('2026-03-20T12:00:00Z'),
      defaultObserver,
    )
    expect(noon.altitude).toBeGreaterThan(35)
    expect(noon.altitude).toBeLessThan(42)
    expect(
      observerBody(Body.Sun, new Date('2026-03-20T00:00:00Z'), defaultObserver)
        .altitude,
    ).toBeLessThan(0)
    const site = {
      ...defaultObserver,
      latitude: 32.7767,
      longitude: -96.797,
      elevation: 131,
    }
    const solar = upcomingEvents(new Date('2024-04-01T00:00:00Z'), site).find(
      (event) => event.kind === 'solar',
    )!
    expect(new Date(solar.peak).toISOString().slice(0, 10)).toBe('2024-04-08')
    expect(solar.label).toBe('total solar eclipse')
    expect(solar.obscuration).toBe(1)
    const transit = upcomingEvents(
      new Date('2019-11-01T00:00:00Z'),
      defaultObserver,
    ).find((event) => event.body === Body.Mercury)!
    expect(new Date(transit.peak).toISOString().slice(0, 10)).toBe('2019-11-11')
    const lunarSite = { ...defaultObserver, latitude: 34.0522, longitude: -118.2437 }
    const lunar = upcomingEvents(new Date('2022-11-01T00:00:00Z'), lunarSite).find((event) => event.kind === 'lunar')!
    expect(new Date(lunar.peak).toISOString().slice(0, 10)).toBe('2022-11-08')
    const shadow = earthShadow(new Date(lunar.peak), lunarSite)!
    const moon = observerBody(Body.Moon, new Date(lunar.peak), lunarSite)
    const offset = Math.acos(Math.min(1, shadow.direction.reduce((sum, value, index) => sum + value * moon.direction[index], 0)))
    expect(offset).toBeLessThan(shadow.umbraRadians)
    expect(shadow.penumbraRadians).toBeGreaterThan(shadow.umbraRadians)
  })
  it('keeps physical radius ratios and labels uncertain science honestly', () => {
    const objects = ['earth', 'jupiter', 'sun'].map((id) => objectById.get(id)!)
    const layout = comparisonLayout(objects)
    expect(layout[1].radius / layout[0].radius).toBeCloseTo(
      objects[1].radiusKm! / objects[0].radiusKm!,
      10,
    )
    expect(layout[2].radius).toBe(2)
    expect(physicalRadius(objectById.get('gaia-bh1')!)).toBeCloseTo(
      9.62 * 2.95325,
    )
    expect(
      scientificConfidence(objectById.get('wise-0855')!).classification,
    ).toBe('Candidate / uncertain')
    expect(physicalRadius(objectById.get('wise-0855')!)).toBeNull()
  })
  it('round-trips metric camera coordinates and rejects malformed links', () => {
    const point = parseViewpoint({
      version: 1,
      name: 'Earth from above',
      objectId: 'earth',
      view: 'map',
      timestamp: date.getTime(),
      camera: {
        position: [1e-6, 2e-7, -3e-7],
        target: [1e-6, 0, 0],
        up: [0, 1, 0],
      },
      layers: {
        orbits: true,
        labels: false,
        compressed: false,
        galacticDust: true,
        galaxyStyle: 'reference',
      },
    })!
    expect(point).not.toBeNull()
    const url = new URL(viewpointUrl(point, 'https://example.com/HelloWorld/'))
    expect(url.pathname).toBe('/HelloWorld/')
    expect(readSharedViewpoint(url.hash)).toEqual(point)
    expect(point.layers.radioExposure).toBe(3)
    const radio = { ...point, layers: { ...point.layers, spectrum: 'radio' as const, radioExposure: 5 } }
    expect(readSharedViewpoint(new URL(viewpointUrl(radio, url.href)).hash)).toEqual(radio)
    for (const exposure of [0, 9, NaN, '3'])
      expect(parseViewpoint({ ...point, layers: { ...point.layers, radioExposure: exposure } })).toBeNull()
    const infrared = { ...point, layers: { ...point.layers, spectrum: 'infrared' }, model: { cosmicAgeGyr: 20, densityGain: 0.75, showCandidates: true } }
    expect(readSharedViewpoint(new URL(viewpointUrl(infrared as typeof point, url.href)).hash)).toEqual(infrared)
    expect(parseViewpoint({ ...point, layers: { ...point.layers, spectrum: 'unknown' } })).toBeNull()
    expect(parseViewpoint({ ...infrared, model: { ...infrared.model, cosmicAgeGyr: 90 } })).toBeNull()
    expect(point.layers.stellarGlints).toBe(true)
    const withoutGlints = { ...point, layers: { ...point.layers, stellarGlints: false } }
    expect(readSharedViewpoint(new URL(viewpointUrl(withoutGlints, url.href)).hash)).toEqual(withoutGlints)
    expect(parseViewpoint({ ...point, layers: { ...point.layers, stellarGlints: 'true' } })).toBeNull()
    expect(readSharedViewpoint('#view=%oops')).toBeNull()
    expect(readSharedViewpoint(`#view=${'a'.repeat(13000)}`)).toBeNull()
    expect(
      parseViewpoint({
        ...point,
        camera: { ...point.camera, position: [Infinity, 0, 0] },
      }),
    ).toBeNull()
    expect(
      parseViewpoint({
        ...point,
        camera: { ...point.camera, position: point.camera.target },
      }),
    ).toBeNull()
    expect(parseViewpoint({ ...point, timestamp: NaN })).toBeNull()
    expect(parseViewpoint({ ...point, version: 9 })).toBeNull()
  })
})

describe('continuous map coordinates', () => {
  it('bounds wheel gestures and separates supercluster and horizon overview scales', () => {
    expect(mapWheelZoomFactor(1e9)).toBeLessThan(1.4)
    expect(mapWheelZoomFactor(-1e9)).toBeGreaterThan(0.7)
    expect(mapWheelZoomFactor(100) * mapWheelZoomFactor(-100)).toBeCloseTo(1, 12)
    expect(mapWheelZoomFactor(1, 1)).toBe(mapWheelZoomFactor(16))
    expect(mapWheelZoomFactor(NaN)).toBe(1)
    expect(overviewOpacity('laniakea', 1e6)).toBe(0)
    expect(overviewOpacity('laniakea', LANIAKEA_RADIUS_PC)).toBe(1)
    expect(overviewOpacity('universe', 80e6)).toBe(0)
    expect(overviewOpacity('universe', OBSERVABLE_RADIUS_PC)).toBe(1)
    expect(OBSERVABLE_RADIUS_PC / LANIAKEA_RADIUS_PC).toBeGreaterThan(175)
  })
  it('measures center distances and light time in the same metric frame', () => {
    const earthPosition = solarPositionPc(earth, date)
    const moon = objectById.get('moon')!
    const moonPosition = solarPositionPc(moon, date)
    const result = measurePositions(earthPosition, moonPosition)!
    expect(result.distancePc * AU_PER_PARSEC).toBeCloseTo(
      distanceAu(getPosition(moon, date)),
      9,
    )
    expect(result.lightSeconds).toBeGreaterThan(1)
    expect(result.lightSeconds).toBeLessThan(1.5)
    expect(
      measurePositions([0, 0, 0], [1 / AU_PER_PARSEC, 0, 0])!.lightSeconds,
    ).toBeCloseTo(499.0047838, 4)
    expect(measurePositions(earthPosition, earthPosition)).toEqual({
      distancePc: 0,
      lightSeconds: 0,
    })
    expect(measurePositions([NaN, 0, 0], [0, 0, 0])).toBeNull()
    expect(LIGHT_SPEED_KM_S).toBe(299792.458)
    expect(formatLightTime(0)).toBe('0 s')
    expect(formatLightTime(499)).toBe('8.317 min')
    expect(formatLightTime(31557600)).toBe('1 year')
    expect(formatRulerDistance(1 / AU_PER_PARSEC)).toBe('1 AU')
    expect(formatRulerDistance(384400 / KM_PER_PARSEC)).toBe('384,400 km')
  })
  it('uses current ephemerides and refuses missing ruler coordinates', () => {
    const spacecraft = objectById.get('voyager-1')!
    const map: ContinuousMap = Object.assign(
      Object.create(ContinuousMap.prototype),
      {
        timestamp: date.getTime(),
        index: new Map([
          ['earth', { solar: earth }],
          ['moon', { solar: objectById.get('moon')! }],
          ['voyager-1', { solar: spacecraft }],
          ['sun', { position: new Vector3() }],
          ['solar-system', { position: new Vector3(), aggregate: true }],
          [
            'andromeda',
            { position: new Vector3(778000, 0, 0), approximate: true },
          ],
          [
            'messier-87',
            { position: new Vector3(16800000, 0, 0), approximate: true },
          ],
        ]),
      },
    )
    const first = map.measure('earth', 'moon')
    expect(first.basis).toBe('calculated')
    expect(first.unavailable).toBeNull()
    map.setTime(Date.UTC(2026, 9, 1))
    expect(map.measure('earth', 'moon').distancePc).not.toBe(first.distancePc)
    expect(map.measure('earth', 'unknown').distancePc).toBeNull()
    expect(map.measure('sun', 'solar-system').distancePc).toBeNull()
    expect(map.measure('sun', 'andromeda').basis).toBe('catalog')
    expect(map.measure('sun', 'messier-87').basis).toBe('cosmological')
    map.setTime(Date.UTC(2035, 0, 1))
    expect(map.measure('sun', 'voyager-1').distancePc).toBeNull()
    expect(map.measure('sun', 'voyager-1').unavailable).toContain('Voyager 1')
  })
  it('builds all minor-body paths in bounded reusable batches and disposes old buffers', () => {
    const root = new Group()
    const orbitRoot = new Group()
    root.add(orbitRoot)
    const surface = { dataset: {} as Record<string, string> }
    const options = { orbits: false }
    const map: ContinuousMap = Object.assign(
      Object.create(ContinuousMap.prototype),
      {
        root,
        minorOrbitRoot: orbitRoot,
        minorOrbitRevision: -1,
        minorOrbitBatches: [],
        selectedMinorOrbit: null,
        paths: [],
        revision: 1,
        index: new Map(),
        selected: 'solar-system',
        options,
        unit: 0.0001,
        currentDistance: 0.001,
        worldCamera: new Vector3(),
        origin: new Vector3(),
        projected: new Vector3(),
        host: { querySelector: () => surface },
        labels: [],
        models: new Map(),
      },
    )
    const update = Object.getOwnPropertyDescriptor(
      ContinuousMap.prototype,
      'updateMinorOrbits',
    )!.value as (this: ContinuousMap) => void
    update.call(map)
    expect(orbitRoot.children).toHaveLength(0)
    options.orbits = true
    for (
      let frame = 0;
      frame < 300 && surface.dataset.minorOrbitState !== 'ready';
      frame++
    )
      update.call(map)
    expect(surface.dataset.minorOrbitState).toBe('ready')
    const counts = JSON.parse(surface.dataset.solarOrbitCounts) as Record<
      string,
      number
    >
    expect(
      Object.values(counts).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(9000)
    expect(orbitRoot.children).toHaveLength(3)
    expect(surface.dataset.orbitDrawCalls).toBe('3')
    const buffers = [...orbitRoot.children]
    const disposed = vi.fn()
    for (const line of buffers) {
      const geometry = Object.getOwnPropertyDescriptor(line, 'geometry')!
        .value as import('three').BufferGeometry
      expect(
        Array.from(geometry.getAttribute('position').array).every(
          Number.isFinite,
        ),
      ).toBe(true)
      geometry.addEventListener('dispose', disposed)
    }
    options.orbits = false
    update.call(map)
    expect(surface.dataset.orbitDrawCalls).toBe('0')
    expect(orbitRoot.visible).toBe(false)
    options.orbits = true
    update.call(map)
    expect(orbitRoot.children).toEqual(buffers)
    const camera = Object.getOwnPropertyDescriptor(map, 'worldCamera')!
      .value as Vector3
    camera.set(10, 0, 0)
    update.call(map)
    expect(orbitRoot.visible).toBe(false)
    expect(surface.dataset.orbitDrawCalls).toBe('0')
    camera.set(0, 0, 0)
    Object.assign(map, { revision: 2 })
    update.call(map)
    expect(disposed).toHaveBeenCalledTimes(3)
    expect(orbitRoot.children).toHaveLength(3)
    map.dispose()
    expect(root.children).toHaveLength(0)
  })
  it('keeps spacecraft-sized distances readable in meters', () => {
    expect(formatWorldDistance(0.045 / KM_PER_PARSEC)).toBe('45 m')
    expect(formatWorldDistance(0)).toBe('0 m')
    expect(formatWorldDistance(2 / KM_PER_PARSEC)).toBe('2 km')
  })
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
  it('places Titan and Enceladus around Saturn with their own mean motions', () => {
    const saturn = solarPositionPc(objectById.get('saturn')!, date)
    for (const id of ['titan', 'enceladus']) {
      const moon = objectById.get(id)!
      const local = getPosition(moon, date)
      const world = solarPositionPc(moon, date)
      expect(
        Math.hypot(...world.map((value, index) => value - saturn[index])) *
          AU_PER_PARSEC,
      ).toBeCloseTo(distanceAu(local), 9)
      const full = getPosition(
        moon,
        new Date(date.getTime() + moon.orbit.periodDays! * DAY_MS),
      )
      expect(
        Math.hypot(...full.map((value, index) => value - local[index])),
      ).toBeLessThan(1e-8)
      expect(moon.texture).toMatch(/\/textures\/.*-nasa\./)
      expect(getAncestry(id).at(-2)?.id).toBe('saturn')
      expect(scientificConfidence(moon).position).toBe('Approximate orbit')
    }
  })
  it('covers historical mission milestones and enhanced flyby samples', () => {
    for (const mission of missions) {
      const spacecraft = objectById.get(mission.id)!
      for (const event of mission.events)
        expect(
          getPosition(spacecraft, new Date(event.date)).every(Number.isFinite),
          `${mission.name} ${event.name}`,
        ).toBe(true)
      expect(spacecraft.trajectory![0][0]).toBeLessThan(Date.UTC(2010, 0, 1))
      expect(
        getPosition(spacecraft, new Date('2035-01-01')).every(Number.isNaN),
      ).toBe(true)
    }
    const probe = objectById.get('new-horizons')!
    expect(probe.model!.path).toBe('models/new-horizons.glb')
    expect(
      distanceAu(getPosition(probe, new Date('2015-07-14T11:49:00Z'))),
    ).toBeGreaterThan(30)
    expect(
      distanceAu(getPosition(probe, new Date('2015-07-14T11:49:00Z'))),
    ).toBeLessThan(34)
  })
  it('samples every usable catalog minor-body orbit without closing escape paths', () => {
    const counts = { closed: 0, open: 0 }
    for (const row of extendedData.minorBodies) {
      const elements = elementsFromRow(row)
      if (!elements) continue
      const points = sampleSmallBodyOrbit(elements, 72)
      expect(points.length, row[1]).toBe(73)
      expect(
        points.every((point) => point.every(Number.isFinite)),
        row[1],
      ).toBe(true)
      const start = new Vector3(...points[0])
      const end = new Vector3(...points[points.length - 1])
      if (elements.eccentricity < 1) {
        counts.closed++
        expect(
          start.distanceTo(end) / Math.max(1, start.length()),
          row[1],
        ).toBeLessThan(1e-12)
      } else {
        counts.open++
        expect(start.distanceTo(end), row[1]).toBeGreaterThan(
          elements.perihelionDistance,
        )
      }
    }
    expect(counts.closed + counts.open).toBeGreaterThan(9000)
    expect(counts.open).toBeGreaterThan(0)
    const elements = elementsFromRow(extendedData.minorBodies[0])!
    for (const invalid of [
      { ...elements, eccentricity: NaN },
      { ...elements, eccentricity: -1 },
      { ...elements, perihelionDistance: 0 },
      { ...elements, inclination: Infinity },
    ])
      expect(sampleSmallBodyOrbit(invalid)).toEqual([])
    expect(sampleSmallBodyOrbit(elements, 0)).toEqual([])
    for (const eccentricity of [1, 1.001, 2]) {
      const points = sampleSmallBodyOrbit(
        { ...elements, eccentricity, perihelionDistance: 0.5 },
        64,
      )
      expect(distanceAu(points[0])).toBeCloseTo(10000, 5)
      expect(distanceAu(points[32])).toBeCloseTo(0.5, 12)
      expect(points[0]).not.toEqual(points[64])
    }
  })
  it('places both Voyagers from bounded NASA Horizons samples in the shared frame', () => {
    for (const [id, minimum, maximum] of [
      ['voyager-1', 170, 174],
      ['voyager-2', 142, 146],
    ] as const) {
      const spacecraft = objectById.get(id)!
      const samples = spacecraft.trajectory!
      expect(samples.length).toBeGreaterThan(4900)
      expect(
        samples.every(
          (sample) => sample.length === 4 && sample.every(Number.isFinite),
        ),
      ).toBe(true)
      expect(
        samples.every(
          (sample, index) => !index || sample[0] > samples[index - 1][0],
        ),
      ).toBe(true)
      const position = getPosition(spacecraft, date)
      expect(distanceAu(position)).toBeGreaterThan(minimum)
      expect(distanceAu(position)).toBeLessThan(maximum)
      expect(
        Math.hypot(...solarPositionPc(spacecraft, date)) * AU_PER_PARSEC,
      ).toBeCloseTo(distanceAu(position), 9)
      const before = samples[100]
      const after = samples[101]
      const midpoint = getPosition(
        spacecraft,
        new Date((before[0] + after[0]) / 2),
      )
      expect(midpoint[0]).toBeCloseTo((before[1] + after[1]) / 2, 9)
      expect(midpoint[1]).toBeCloseTo((before[3] + after[3]) / 2, 9)
      expect(midpoint[2]).toBeCloseTo(-(before[2] + after[2]) / 2, 9)
      for (const timestamp of [samples[0][0], samples[samples.length - 1][0]])
        expect(
          getPosition(spacecraft, new Date(timestamp)).every(Number.isFinite),
        ).toBe(true)
      for (const timestamp of [
        samples[0][0] - 1,
        samples[samples.length - 1][0] + 1,
        NaN,
      ])
        expect(
          getPosition(spacecraft, new Date(timestamp)).every(Number.isNaN),
        ).toBe(true)
      const trail = sampleOrbit(spacecraft, date)
      expect(trail).toHaveLength(samples.length)
      expect(distanceAu(trail[trail.length - 1])).toBeGreaterThan(
        distanceAu(trail[0]),
      )
      expect(trail[0]).not.toEqual(trail[trail.length - 1])
      expect(spacecraft.orbit.semiMajorAxis).toBeUndefined()
      expect(getAncestry(id).at(-2)?.id).toBe('solar-system')
    }
  })
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
  it('maps the expanded catalog with consistent host centers and honest object classes', () => {
    for (const id of [
      'pso-j318',
      'wise-0855',
      'gaia-bh1',
      'gaia-bh3',
      'v404-cygni',
      'centaurus-a-black-hole',
      'perseus-a-black-hole',
      'pillars-of-creation',
      'cats-eye-nebula',
      'butterfly-nebula',
      'bubble-nebula',
      'tycho-remnant',
      'kepler-remnant',
      'sn1006',
      'vela-remnant',
      'bootes-void',
    ]) {
      const object = objectById.get(id)!
      expect(object).toBeDefined()
      const sky = object.skyPosition!
      const world = skyPositionPc(
        sky.rightAscensionHours,
        sky.declinationDegrees,
        sky.distancePc,
      )
      expect(world.every(Number.isFinite)).toBe(true)
      expect(Math.hypot(...world)).toBeCloseTo(sky.distancePc, 6)
      expect(objectById.has(object.parent!)).toBe(true)
      expect(new URL(object.source).protocol).toBe('https:')
      if (object.blackHole) {
        expect(object.radiusKm).toBeCloseTo(
          object.blackHole.massSolar * 2.95325,
        )
        const host = objectById.get(object.parent!)!
        if (host.kind === 'galaxy' && host.skyPosition) {
          expect(sky.rightAscensionHours).toBe(
            host.skyPosition!.rightAscensionHours,
          )
          expect(sky.declinationDegrees).toBe(
            host.skyPosition!.declinationDegrees,
          )
          expect(sky.distancePc).toBe(host.skyPosition!.distancePc)
        }
      }
    }
    expect(objectById.get('gaia-bh1')!.blackHole!.accreting).toBe(false)
    for (const id of ['pso-j318', 'wise-0855', 'bootes-void']) {
      expect(objectById.get(id)!.orbit.model).toBe('none')
      expect(sampleOrbit(objectById.get(id)!, date)).toEqual([])
    }
    expect(getAncestry('pillars-of-creation').at(-2)?.id).toBe('eagle-nebula')
    expect(
      searchCatalog('Great Void').some((object) => object.id === 'bootes-void'),
    ).toBe(true)
    expect(searchCatalog('Voyager', 'nearby')).toHaveLength(2)
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
    expect(searchCatalog('Proxima').filter((object) => object.id === 'exo:Proxima Cen b')).toHaveLength(1)
    expect(searchCatalog('Earth-Moon', 'nearby')[0].id).toBe('earth-moon')
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
