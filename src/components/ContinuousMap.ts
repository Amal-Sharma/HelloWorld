import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { catalog, objectById, solarPlanets } from '../data/catalog'
import type {
  CelestialObject,
  ObjectKind,
  OrbitalElements,
} from '../data/catalog'
import {
  elementsFromRow,
  extendedData,
  exoplanetId,
  minorBodyId,
  minorBodyKind,
  starId,
  stellarColor,
} from '../data/extendedCatalog'
import {
  DAY_MS,
  sampleOrbit,
  sampleSmallBodyOrbit,
  smallBodyPosition,
} from '../lib/astronomy'
import {
  AU_PER_PARSEC,
  catalogToWorld,
  eclipticToWorld,
  formatWorldDistance,
  KM_PER_PARSEC,
  OBSERVABLE_RADIUS_PC,
  LANIAKEA_RADIUS_PC,
  MAX_MAP_DISTANCE_PC,
  overviewOpacity,
  renderUnitPc,
  skyPositionPc,
  solarPositionPc,
  measurePositions,
  referencePositionPc,
} from '../lib/mapCoordinates'
import type { DistanceMeasurement } from '../lib/mapCoordinates'
import type { CameraPose } from '../lib/viewpoints'
import { observationBands, spectralResponse } from '../lib/spectrum'
import type { ObservationBand } from '../lib/spectrum'

export interface MapTelemetry {
  region: string
  span: string
  distancePc: number
  coordinates: string
  nearest: string
  mapped: number
  focusedId?: string
  followingId?: string
  measurement?: DistanceMeasurement | null
}

interface Entry {
  id: string
  name: string
  kind: ObjectKind
  position: THREE.Vector3
  radius: number
  color: string
  magnitude?: number
  elements?: OrbitalElements
  solar?: CelestialObject
  aggregate?: boolean
  approximate?: boolean
  positionValid?: boolean
}

interface MapOptions {
  labels: boolean
  orbits: boolean
  highQuality: boolean
  spectrum?: ObservationBand
  radioExposure?: number
  showCandidates?: boolean
  ruler?: readonly [string, string] | null
  catalogRevision?: number
}
interface Model {
  root: THREE.Group
  entry: Entry
  unit: number
  used: number
}

const locations: Record<string, [number, number, number, number]> = {
  orion: [5.588, -5.39, 412, 3.7],
  carina: [10.75, -59.87, 2300, 46],
  helix: [22.49, -20.84, 199, 0.38],
  crab: [5.575, 22.014, 1993, 1.7],
  'crab-pulsar': [5.575, 22.014, 1993, 12 / KM_PER_PARSEC],
  vela: [8.588, -45.18, 294, 12 / KM_PER_PARSEC],
  sn1987a: [5.591, -69.27, 51500, 0.5],
  'cygnus-x1': [19.972, 35.202, 2200, 62 / KM_PER_PARSEC],
  andromeda: [0.712, 41.269, 778000, 23000],
  triangulum: [1.564, 30.66, 840000, 9200],
  whirlpool: [13.498, 47.195, 9500000, 11650],
  'm87-black-hole': [12.514, 12.391, 16800000, 19e9 / KM_PER_PARSEC],
  '3c273': [12.485, 2.052, 650000000, 2.65e9 / KM_PER_PARSEC],
  ton618: [12.474, 31.478, 5500000000, 1.2e11 / KM_PER_PARSEC],
}

function removeVisual(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    mesh.geometry?.dispose()
    if (mesh.material)
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
        (material) => material.dispose(),
      )
  })
  root.removeFromParent()
  root.clear()
}

export class ContinuousMap {
  readonly root = new THREE.Group()
  nearBlackHole = false
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private host: HTMLDivElement
  private labelHost: HTMLDivElement
  private makeVisual: (object: CelestialObject) => THREE.Group
  private releaseVisual: (root: THREE.Group) => void
  private onSelect: (id: string) => void
  private entries: Entry[] = []
  private index = new Map<string, Entry>()
  private models = new Map<string, Model>()
  private origin = new THREE.Vector3()
  private unit = 1 / AU_PER_PARSEC
  private flight: { camera: THREE.Vector3; target: THREE.Vector3 } | null = null
  private pendingFocus: { id: string; immediate: boolean } | null = null
  private zooming = false
  private zoomAnchor: Entry | null = null
  private zoomPointer: THREE.Vector2 | null = null
  private velocity = new THREE.Vector3()
  private cloud: THREE.Points
  private rulerLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    ),
    new THREE.LineBasicMaterial({
      color: '#d7e6ae',
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    }),
  )
  private rulerEnds = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    ),
    new THREE.PointsMaterial({
      color: '#d7e6ae',
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    }),
  )
  private labels: HTMLButtonElement[] = []
  private labelEntries: Entry[] = []
  private paths: {
    id: string
    line: THREE.Line
    positions: THREE.Vector3[]
    parentId?: string
  }[] = []
  private minorOrbitRoot = new THREE.Group()
  private minorOrbitRevision = -1
  private minorOrbitBatches: {
    kind: ObjectKind
    line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    entries: { id: string; elements: OrbitalElements }[]
    next: number
    count: number
    vertices: number
  }[] = []
  private selectedMinorOrbit: {
    id: string
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    positions: THREE.Vector3[]
  } | null = null
  private options: MapOptions
  private revision = -1
  private timestamp: number
  private lastMinorTime = -Infinity
  private lastTelemetry = 0
  private lastLabels = 0
  private selected = 'solar-system'
  private projected = new THREE.Vector3()
  private currentDistance = 1 / AU_PER_PARSEC
  private worldCamera = new THREE.Vector3()
  private worldTarget = new THREE.Vector3()
  private frame = 0
  private nearest: Entry | null = null
  private following: Entry | null = null
  private followLocked = false
  private previousFollowPosition = new THREE.Vector3()
  private labelCandidates: {
    entry: Entry
    distance: number
    horizontal: number
    vertical: number
  }[] = []
  private visibleEntries: {
    entry: Entry
    distance: number
    angular: number
  }[] = []

  constructor(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    host: HTMLDivElement,
    labelHost: HTMLDivElement,
    options: MapOptions,
    timestamp: number,
    makeVisual: (object: CelestialObject) => THREE.Group,
    releaseVisual: (root: THREE.Group) => void,
    onSelect: (id: string) => void,
  ) {
    this.camera = camera
    this.controls = controls
    this.host = host
    this.labelHost = labelHost
    this.options = options
    this.timestamp = timestamp
    this.makeVisual = makeVisual
    this.releaseVisual = releaseVisual
    this.onSelect = onSelect
    this.root.name = 'continuous-universe'
    this.cloud = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: 1 }, uBandColor: { value: new THREE.Color() }, uBandMix: { value: 0 } },
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        vertexShader: `attribute float aSize, aAlpha, aBandGain; varying vec3 vColor; varying float vAlpha; uniform float uPixelRatio, uBandMix; uniform vec3 uBandColor; void main() { vColor = mix(color, uBandColor, uBandMix); vAlpha = aAlpha * aBandGain; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPixelRatio; }`,
        fragmentShader: `varying vec3 vColor; varying float vAlpha; void main() { float radius = length(gl_PointCoord - 0.5) * 2.0; if (radius > 1.0) discard; float intensity = exp(-radius * radius * 5.0); gl_FragColor = vec4(vColor, vAlpha * intensity * (1.0 - smoothstep(0.65, 1.0, radius)));\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }`,
      }),
    )
    this.cloud.frustumCulled = false
    this.cloud.renderOrder = 5
    this.root.add(this.cloud)
    this.rulerLine.name = 'distance-ruler'
    this.rulerLine.frustumCulled = this.rulerEnds.frustumCulled = false
    this.rulerLine.visible = this.rulerEnds.visible = false
    this.rulerLine.renderOrder = this.rulerEnds.renderOrder = 10
    this.root.add(this.rulerLine, this.rulerEnds)
    this.controls.minDistance = 1e-9
    this.controls.maxDistance = 1e20
    this.refreshCatalog()
    this.setWorldCamera(
      new THREE.Vector3(...eclipticToWorld([0, 28, 42])),
      new THREE.Vector3(),
    )
    this.createPaths()
    this.minorOrbitRoot.name = 'catalog-solar-orbits'
    this.minorOrbitRoot.visible = false
    this.root.add(this.minorOrbitRoot)
    for (let labelIndex = 0; labelIndex < 22; labelIndex++) {
      const label = document.createElement('button')
      label.className = 'celestial-label'
      label.style.display = 'none'
      label.addEventListener('click', () => {
        const entry = this.labelEntries[labelIndex]
        if (entry) this.onSelect(entry.id)
      })
      this.labels.push(label)
      this.labelHost.appendChild(label)
    }
  }

  private add(entry: Entry) {
    if (
      !this.index.has(entry.id) &&
      entry.position.toArray().every(Number.isFinite) &&
      Number.isFinite(entry.radius) &&
      entry.radius > 0
    ) {
      this.entries.push(entry)
      this.index.set(entry.id, entry)
    }
  }

  private refreshCatalog() {
    if (this.revision === (this.options.catalogRevision ?? 0)) return
    this.revision = this.options.catalogRevision ?? 0
    const date = new Date(this.timestamp)
    const namedStars = new Map(
      extendedData.stars.map((row) => [row[1].toLowerCase(), row]),
    )
    for (const object of catalog) {
      const base = {
        id: object.id,
        name: object.name,
        kind: object.kind,
        radius: (object.radiusKm ?? 6371) / KM_PER_PARSEC,
        color: object.color,
        position: new THREE.Vector3(),
      }
      if (
        object.body ||
        object.id === 'moon' ||
        object.jovianMoon ||
        object.saturnianMoon ||
        object.martianMoon ||
        object.planetaryHost ||
        object.trajectory
      ) {
        const position = solarPositionPc(object, date)
        const positionValid = position.every(Number.isFinite)
        this.add({
          ...base,
          position: new THREE.Vector3(
            ...(positionValid
              ? position
              : object.trajectory
                ? solarPositionPc(object, new Date(object.trajectory[0][0]))
                : [0, 0, 0]),
          ),
          positionValid,
          solar: object,
        })
      } else if (object.id === 'sun') this.add(base)
      else if (object.id === 'solar-system')
        this.add({ ...base, radius: 38 / AU_PER_PARSEC, aggregate: true })
      else if (object.id === 'earth-moon')
        this.add({
          ...base,
          radius: 500000 / KM_PER_PARSEC,
          aggregate: true,
          position: new THREE.Vector3(
            ...solarPositionPc(objectById.get('earth')!, date),
          ),
          solar: objectById.get('earth')!,
        })
      else if (object.id === 'nearby-stars')
        this.add({ ...base, radius: 8, aggregate: true })
      else if (object.id === 'milky-way')
        this.add({
          ...base,
          position: new THREE.Vector3(8200, 0, 0),
          radius: 16000,
          approximate: true,
        })
      else if (object.id === 'sagittarius-a')
        this.add({
          ...base,
          position: new THREE.Vector3(8200, 0, 0),
          radius: 12.7e6 / KM_PER_PARSEC,
          approximate: true,
        })
      else if (object.id === 'local-group')
        this.add({
          ...base,
          position: new THREE.Vector3(...referencePositionPc(object)!),
          radius: 1500000,
          aggregate: true,
          approximate: true,
        })
      else if (object.id === 'laniakea')
        this.add({
          ...base,
          radius: LANIAKEA_RADIUS_PC,
          aggregate: true,
          approximate: true,
        })
      else if (
        object.id === 'universe' ||
        object.visualization === 'dark-matter' ||
        object.visualization === 'dark-energy'
      )
        this.add({
          ...base,
          radius: OBSERVABLE_RADIUS_PC,
          aggregate: true,
          approximate: true,
        })
      else if (object.skyPosition) {
        const {
          rightAscensionHours,
          declinationDegrees,
          distancePc,
          radiusPc,
        } = object.skyPosition
        this.add({
          ...base,
          position: new THREE.Vector3(
            ...skyPositionPc(
              rightAscensionHours,
              declinationDegrees,
              distancePc,
            ),
          ),
          radius: radiusPc,
          aggregate: object.kind === 'system',
          approximate: true,
        })
      } else if (locations[object.id]) {
        const [ascension, declination, distance, radius] =
          locations[object.id]
        this.add({
          ...base,
          position: new THREE.Vector3(
            ...skyPositionPc(ascension, declination, distance),
          ),
          radius,
          approximate: true,
        })
      } else {
        const row = namedStars.get(
          object.name.toLowerCase().replace(/ a$/, ''),
        )
        if (row && row[3] !== null && row[4] !== null && row[5] !== null)
          this.add({
            ...base,
            position: new THREE.Vector3(
              ...catalogToWorld([row[3], row[4], row[5]]),
            ),
          })
      }
    }
    for (const row of extendedData.stars) {
      if (row[3] === null || row[4] === null || row[5] === null) continue
      this.add({
        id: starId(row),
        name: row[1],
        kind: 'star',
        position: new THREE.Vector3(
          ...catalogToWorld([row[3], row[4], row[5]]),
        ),
        radius: 695700 / KM_PER_PARSEC,
        color: stellarColor(row[7]),
        magnitude: row[6] ?? 10,
      })
    }
    for (const row of extendedData.exoplanets) {
      if (row[2] === null || row[3] === null || row[4] === null) continue
      this.add({
        id: exoplanetId(row),
        name: row[0],
        kind: 'exoplanet',
        position: new THREE.Vector3(
          ...catalogToWorld([row[2], row[3], row[4]]),
        ),
        radius: ((row[10] ?? 1) * 6371) / KM_PER_PARSEC,
        color: '#b4d8a3',
        approximate: true,
      })
    }
    for (const row of extendedData.minorBodies) {
      const elements = elementsFromRow(row)
      if (!elements) continue
      const position = smallBodyPosition(elements, date)
      if (!position.every(Number.isFinite)) continue
      this.add({
        id: minorBodyId(row),
        name: row[1],
        kind: minorBodyKind(row),
        position: new THREE.Vector3(...eclipticToWorld(position)),
        radius: Math.max(0.2, (row[3] ?? 5) / 2) / KM_PER_PARSEC,
        color: row[2] === 'c' ? '#95d1cf' : '#b8aa8c',
        elements,
        approximate: true,
      })
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        new Float32Array(this.entries.length * 3),
        3,
      ),
    )
    const colors = new Float32Array(this.entries.length * 3)
    const sizes = new Float32Array(this.entries.length)
    const color = new THREE.Color()
    this.entries.forEach((entry, index) => {
      color.set(entry.color)
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
      sizes[index] =
        entry.id === 'solar-system'
          ? 5
          : entry.aggregate || entry.kind === 'void'
            ? 0
            : entry.kind === 'star' || entry.kind === 'white-dwarf'
              ? Math.max(1, 4.8 - (entry.magnitude ?? 1) * 0.36)
              : entry.elements
                ? 1.8
                : entry.kind === 'exoplanet'
                  ? 2.1
                  : 5
    })
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 3),
    )
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
    geometry.setAttribute(
      'aAlpha',
      new THREE.Float32BufferAttribute(
        new Float32Array(this.entries.length),
        1,
      ),
    )
    this.cloud.geometry.dispose()
    this.cloud.geometry = geometry
    this.updateSpectrum()
  }

  private updateSpectrum() {
    const band = this.options.spectrum ?? 'visible'
    const exposure =
      band === 'radio'
        ? Math.max(1, Math.min(8, this.options.radioExposure ?? 3))
        : 1
    const curated = new Map(catalog.map((object) => [object.id, object]))
    this.cloud.geometry.setAttribute(
      'aBandGain',
      new THREE.Float32BufferAttribute(
        this.entries.map(
          (entry) =>
            spectralResponse(curated.get(entry.id) ?? entry, band) * exposure,
        ),
        1,
      ),
    )
    const material = this.cloud.material as THREE.ShaderMaterial
    material.uniforms.uBandMix.value = band === 'visible' ? 0 : 1
    material.uniforms.uBandColor.value.set(
      observationBands.find((item) => item.id === band)!.color,
    )
  }

  private createPaths() {
    for (const object of [
      ...solarPlanets,
      ...catalog.filter(
        (item) =>
          item.kind === 'moon' || item.trajectory || item.planetaryHost,
      ),
    ]) {
      const positions = sampleOrbit(
        object,
        new Date(this.timestamp),
        220,
      ).map((point) => new THREE.Vector3(...eclipticToWorld(point)))
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          new Float32Array(positions.length * 3),
          3,
        ),
      )
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: object.id === 'earth' ? '#c5dfaa' : '#7d938c',
          transparent: true,
          opacity: object.id === 'earth' ? 0.4 : 0.19,
          depthWrite: false,
        }),
      )
      line.frustumCulled = false
      this.root.add(line)
      this.paths.push({
        id: object.id,
        line,
        positions,
        parentId:
          object.planetaryHost ??
          (object.kind === 'moon' ? object.parent : undefined),
      })
    }
  }

  private updateMinorOrbits() {
    const atOrbitScale =
      this.options.orbits && this.unit < 0.02 && this.unit > 1e-9
    const visible =
      atOrbitScale &&
      this.worldCamera.length() <
        this.currentDistance * 4 + 10000 / AU_PER_PARSEC
    this.minorOrbitRoot.visible = visible
    if (visible && this.minorOrbitRevision !== this.revision) {
      for (const batch of this.minorOrbitBatches) removeVisual(batch.line)
      this.minorOrbitBatches = []
      this.minorOrbitRevision = this.revision
      const groups = new Map<
        ObjectKind,
        { id: string; elements: OrbitalElements }[]
      >([
        ['dwarf-planet', []],
        ['asteroid', []],
        ['comet', []],
      ])
      for (const row of extendedData.minorBodies) {
        const elements = elementsFromRow(row)
        if (elements)
          groups
            .get(minorBodyKind(row))!
            .push({ id: minorBodyId(row), elements })
      }
      for (const [kind, entries] of groups) {
        if (!entries.length) continue
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(
            new Float32Array(entries.length * 64 * 6),
            3,
          ),
        )
        geometry.setDrawRange(0, 0)
        const line = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({
            color:
              kind === 'dwarf-planet'
                ? '#c4b391'
                : kind === 'comet'
                  ? '#74aeb1'
                  : '#929b87',
            transparent: true,
            opacity:
              kind === 'dwarf-planet'
                ? 0.42
                : kind === 'comet'
                  ? 0.006
                  : 0.01,
            depthWrite: false,
          }),
        )
        line.name = `${kind}-orbit-batch`
        line.frustumCulled = false
        this.minorOrbitRoot.add(line)
        this.minorOrbitBatches.push({
          kind,
          line,
          entries,
          next: 0,
          count: 0,
          vertices: 0,
        })
      }
    }
    if (visible) {
      let processed = 0
      const started = performance.now()
      for (const batch of this.minorOrbitBatches) {
        const attribute = batch.line.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute
        const start = batch.vertices
        while (
          batch.next < batch.entries.length &&
          processed < 512 &&
          (processed === 0 || performance.now() - started < 8)
        ) {
          const entry = batch.entries[batch.next++]
          processed++
          const points = sampleSmallBodyOrbit(entry.elements, 64).map(
            (point) => eclipticToWorld(point),
          )
          if (points.length < 2) continue
          for (let index = 1; index < points.length; index++) {
            attribute.setXYZ(batch.vertices++, ...points[index - 1])
            attribute.setXYZ(batch.vertices++, ...points[index])
          }
          batch.count++
        }
        if (batch.vertices !== start) {
          attribute.addUpdateRange(start * 3, (batch.vertices - start) * 3)
          attribute.needsUpdate = true
          batch.line.geometry.setDrawRange(0, batch.vertices)
        }
      }
      this.minorOrbitRoot.position
        .copy(this.origin)
        .multiplyScalar(-1 / this.unit)
      this.minorOrbitRoot.scale.setScalar(1 / this.unit)
    }
    const selected = this.index.get(this.selected)
    if (
      this.selectedMinorOrbit?.id !==
      (selected?.elements ? selected.id : undefined)
    ) {
      if (this.selectedMinorOrbit) removeVisual(this.selectedMinorOrbit.line)
      this.selectedMinorOrbit = null
      if (selected?.elements) {
        const positions = sampleSmallBodyOrbit(selected.elements, 720).map(
          (point) => new THREE.Vector3(...eclipticToWorld(point)),
        )
        if (positions.length > 1) {
          const geometry = new THREE.BufferGeometry().setAttribute(
            'position',
            new THREE.BufferAttribute(
              new Float32Array(positions.length * 3),
              3,
            ),
          )
          const line = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
              color: '#d7e6ae',
              transparent: true,
              opacity: 0.85,
              depthWrite: false,
            }),
          )
          line.name = 'selected-minor-body-orbit'
          line.frustumCulled = false
          this.root.add(line)
          this.selectedMinorOrbit = { id: selected.id, line, positions }
        }
      }
    }
    if (this.selectedMinorOrbit) {
      const { line, positions } = this.selectedMinorOrbit
      line.visible = atOrbitScale
      if (line.visible) {
        const attribute = line.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute
        positions.forEach((point, index) => {
          this.projected.copy(point).sub(this.origin).divideScalar(this.unit)
          attribute.setXYZ(
            index,
            this.projected.x,
            this.projected.y,
            this.projected.z,
          )
        })
        attribute.needsUpdate = true
      }
    }
    const canvas = this.host.querySelector('canvas')!
    const counts: Partial<Record<ObjectKind, number>> = {}
    for (const path of this.paths) {
      const object = objectById.get(path.id)!
      if (object.planetaryHost) continue
      const kind = object.kind
      counts[kind] = (counts[kind] ?? 0) + 1
    }
    for (const batch of this.minorOrbitBatches)
      counts[batch.kind] = batch.count
    canvas.dataset.solarOrbitCounts = JSON.stringify(counts)
    canvas.dataset.skippedOrbitCount = String(
      this.minorOrbitRevision === this.revision
        ? extendedData.minorBodies.length -
            this.minorOrbitBatches.reduce(
              (sum, batch) =>
                sum + batch.entries.length - batch.next + batch.count,
              0,
            )
        : 0,
    )
    canvas.dataset.minorOrbitState =
      this.minorOrbitRevision < this.revision ||
      this.minorOrbitBatches.some(
        (batch) => batch.next < batch.entries.length,
      )
        ? 'pending'
        : 'ready'
    canvas.dataset.orbitDrawCalls = String(
      this.paths.filter((path) => path.line.visible).length +
        (visible
          ? this.minorOrbitBatches.filter((batch) => batch.count > 0).length
          : 0) +
        (this.selectedMinorOrbit?.line.visible ? 1 : 0),
    )
    canvas.dataset.selectedOrbitId = this.selectedMinorOrbit?.line.visible
      ? this.selectedMinorOrbit.id
      : ''
  }

  private readCamera() {
    this.worldCamera
      .copy(this.camera.position)
      .multiplyScalar(this.unit)
      .add(this.origin)
    this.worldTarget
      .copy(this.controls.target)
      .multiplyScalar(this.unit)
      .add(this.origin)
  }

  private minimumCameraDistance(target: THREE.Vector3) {
    return Math.max(
      5e-16,
      Math.max(Math.abs(target.x), Math.abs(target.y), Math.abs(target.z)) *
        Number.EPSILON *
        32,
    )
  }

  private setWorldCamera(camera: THREE.Vector3, target: THREE.Vector3) {
    const minimum = this.minimumCameraDistance(target)
    if (camera.distanceTo(target) < minimum) {
      const direction = camera.clone().sub(target)
      if (direction.lengthSq() === 0)
        direction.set(0, 0, 1).applyQuaternion(this.camera.quaternion)
      camera.copy(target).add(direction.setLength(minimum))
    }
    const distance = camera.distanceTo(target)
    const nextUnit = renderUnitPc(distance)
    if (nextUnit !== this.unit || this.controls.target.length() > 200) {
      this.origin.copy(target)
      this.unit = nextUnit
    }
    this.camera.position.copy(camera).sub(this.origin).divideScalar(this.unit)
    this.controls.target.copy(target).sub(this.origin).divideScalar(this.unit)
    this.camera.lookAt(this.controls.target)
    this.camera.updateMatrixWorld()
  }

  setOptions(options: MapOptions) {
    const spectrumChanged =
      this.options.spectrum !== options.spectrum ||
      this.options.radioExposure !== options.radioExposure
    this.options = options
    this.refreshCatalog()
    if (spectrumChanged) this.updateSpectrum()
    if (options.catalogRevision && this.pendingFocus) {
      const pending = this.pendingFocus
      this.pendingFocus = null
      this.flyTo(pending.id, pending.immediate)
    }
  }
  setTime(timestamp: number) {
    this.timestamp = timestamp
  }

  capturePose(): CameraPose {
    this.readCamera()
    return {
      position: this.worldCamera.toArray(),
      target: this.worldTarget.toArray(),
      up: this.camera.up.toArray(),
    }
  }

  restorePose(pose: CameraPose) {
    this.interrupt()
    this.velocity.set(0, 0, 0)
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = damping
    this.camera.up.fromArray(pose.up).normalize()
    this.setWorldCamera(
      new THREE.Vector3(...pose.position),
      new THREE.Vector3(...pose.target),
    )
    this.controls.update()
    this.readCamera()
    const canvas = this.host.querySelector('canvas')!
    canvas.dataset.worldCamera = this.worldCamera.toArray().join(',')
    canvas.dataset.worldTarget = this.worldTarget.toArray().join(',')
    canvas.dataset.followingId = ''
  }

  private measurementPosition(id: string) {
    const entry = this.index.get(id)
    if (!entry || entry.aggregate) return null
    const date = new Date(this.timestamp)
    const position = entry.solar
      ? solarPositionPc(entry.solar, date)
      : entry.elements
        ? eclipticToWorld(smallBodyPosition(entry.elements, date))
        : entry.position.toArray()
    return position.every(Number.isFinite) ? position : null
  }

  measure(fromId: string, toId: string): DistanceMeasurement {
    const first = this.measurementPosition(fromId)
    const second = this.measurementPosition(toId)
    const unavailableId = !first ? fromId : !second ? toId : null
    const measured = first && second ? measurePositions(first, second) : null
    const referenceDistance = Math.max(
      first ? Math.hypot(...first) : 0,
      second ? Math.hypot(...second) : 0,
    )
    const estimated = [fromId, toId].some((id) => {
      const entry = this.index.get(id)
      return entry?.approximate || (!entry?.solar && id !== 'sun')
    })
    return {
      fromId,
      toId,
      distancePc: measured?.distancePc ?? null,
      lightSeconds: measured?.lightSeconds ?? null,
      basis:
        referenceDistance >= 1e6
          ? 'cosmological'
          : estimated
            ? 'catalog'
            : 'calculated',
      unavailable: unavailableId
        ? `No usable position for ${objectById.get(unavailableId)?.name ?? unavailableId} at this date.`
        : null,
    }
  }

  frameRuler() {
    const pair = this.options.ruler
    if (!pair) return
    const first = this.measurementPosition(pair[0])
    const second = this.measurementPosition(pair[1])
    if (!first || !second) return
    this.interrupt()
    this.readCamera()
    this.velocity.set(0, 0, 0)
    const start = new THREE.Vector3(...first)
    const end = new THREE.Vector3(...second)
    const target = start.clone().lerp(end, 0.5)
    const radius = Math.max(
      this.index.get(pair[0])!.radius,
      this.index.get(pair[1])!.radius,
    )
    const distance = Math.max(
      start.distanceTo(end) /
        (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
          Math.min(this.camera.aspect, 1)),
      radius * 6,
      this.minimumCameraDistance(target),
    )
    const direction = this.worldCamera.clone().sub(this.worldTarget).normalize()
    if (!direction.lengthSq()) direction.set(0, 0.5, 1).normalize()
    this.flight = {
      camera: target.clone().addScaledVector(direction, distance),
      target,
    }
    this.host.querySelector('canvas')!.dataset.flying = 'true'
  }

  private updateRuler() {
    const pair = this.options.ruler
    const first = pair ? this.measurementPosition(pair[0]) : null
    const second = pair ? this.measurementPosition(pair[1]) : null
    this.rulerLine.visible = this.rulerEnds.visible = Boolean(first && second)
    if (first && second) {
      for (const geometry of [
        this.rulerLine.geometry,
        this.rulerEnds.geometry,
      ]) {
        const buffer = geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute
        for (const [index, position] of [first, second].entries()) {
          this.projected
            .fromArray(position)
            .sub(this.origin)
            .divideScalar(this.unit)
          buffer.setXYZ(
            index,
            this.projected.x,
            this.projected.y,
            this.projected.z,
          )
        }
        buffer.needsUpdate = true
      }
      this.host.querySelector('canvas')!.dataset.rulerScreenPoints =
        JSON.stringify(
          [first, second].map((position) => {
            this.projected
              .fromArray(position)
              .sub(this.origin)
              .divideScalar(this.unit)
              .project(this.camera)
            return [
              ((this.projected.x + 1) * this.host.clientWidth) / 2,
              ((1 - this.projected.y) * this.host.clientHeight) / 2,
            ]
          }),
        )
    }
    this.host.querySelector('canvas')!.dataset.rulerVisible = String(
      this.rulerLine.visible,
    )
  }
  stopMovement() {
    this.velocity.set(0, 0, 0)
  }
  interrupt(preserveFollow = false) {
    this.pendingFocus = null
    this.flight = null
    if (!preserveFollow) {
      this.following = null
      this.followLocked = false
    }
    this.zooming = false
    this.zoomAnchor = null
    this.zoomPointer = null
    this.host.querySelector('canvas')!.dataset.flying = 'false'
  }
  setFollow(id: string | null) {
    if (id === null) {
      this.interrupt()
      return
    }
    const entry = this.index.get(id)
    if (!entry || entry.aggregate || entry.positionValid === false) {
      this.host.dispatchEvent(
        new CustomEvent('map-notice', {
          detail: 'This body has no available position to follow.',
        }),
      )
      return
    }
    this.readCamera()
    const offset = this.worldCamera.clone().sub(this.worldTarget)
    this.followLocked = true
    this.following = entry
    this.previousFollowPosition.copy(entry.position)
    this.velocity.set(0, 0, 0)
    this.zooming = false
    this.flight = {
      camera: entry.position.clone().add(offset),
      target: entry.position.clone(),
    }
    this.host.querySelector('canvas')!.dataset.flying = 'true'
  }
  toggleFollow(id: string) {
    this.setFollow(this.followLocked ? null : id)
  }
  select(id: string) {
    this.selected = id
  }

  flyTo(id: string, immediate = false) {
    this.pendingFocus = null
    this.zooming = false
    this.zoomAnchor = null
    this.zoomPointer = null
    const entry = this.index.get(id)
    if (!entry && !this.options.catalogRevision) {
      this.pendingFocus = { id, immediate }
      this.host.querySelector('canvas')!.dataset.flying = 'true'
      return
    }
    if (!entry || entry.positionValid === false) {
      this.host.dispatchEvent(
        new CustomEvent('map-notice', {
          detail: 'This object has no usable 3D position in the catalog.',
        }),
      )
      return
    }
    this.selected = id
    this.velocity.set(0, 0, 0)
    this.followLocked = !entry.aggregate
    this.following = this.followLocked ? entry : null
    this.previousFollowPosition.copy(entry.position)
    this.readCamera()
    const distance = Math.max(
      this.minimumCameraDistance(entry.position),
      Math.min(
        MAX_MAP_DISTANCE_PC,
        entry.radius *
          (entry.kind === 'black-hole' || entry.kind === 'quasar'
            ? 42
            : entry.kind === 'galaxy'
              ? 4.8
              : entry.id === 'saturn'
                ? 10
                : 5),
      ),
    )
    const direction = this.worldCamera
      .clone()
      .sub(this.worldTarget)
      .normalize()
    if (direction.lengthSq() === 0) direction.set(0.1, 0.6, 1).normalize()
    const target = entry.position.clone()
    const camera = target.clone().addScaledVector(direction, distance)
    if (immediate) {
      this.setWorldCamera(camera, target)
      this.flight = null
    } else this.flight = { camera, target }
    this.host.querySelector('canvas')!.dataset.flying = String(!immediate)
  }

  reset() {
    this.flyTo('solar-system')
  }
  setScale(distancePc: number) {
    if (!Number.isFinite(distancePc) || distancePc <= 0) return
    this.readCamera()
    const reference = this.flight ?? {
      camera: this.worldCamera,
      target: this.worldTarget,
    }
    this.zoom(
      distancePc /
        Math.max(1e-15, reference.camera.distanceTo(reference.target)),
    )
  }

  zoom(factor: number, pointer?: THREE.Vector2, anchorId?: string) {
    if (!Number.isFinite(factor) || factor <= 0) return
    this.pendingFocus = null
    this.readCamera()
    const camera = this.flight?.camera.clone() ?? this.worldCamera.clone()
    const target = this.flight?.target.clone() ?? this.worldTarget.clone()
    const locked =
      this.followLocked && this.following?.positionValid !== false
        ? this.following
        : null
    if (locked) {
      camera.add(locked.position.clone().sub(target))
      target.copy(locked.position)
    }
    const stationary =
      pointer &&
      this.zoomPointer &&
      pointer.distanceTo(this.zoomPointer) < 0.015
    const aimed =
      locked ??
      (factor < 1 && pointer
        ? stationary && this.zoomAnchor
          ? this.zoomAnchor
          : anchorId
            ? this.index.get(anchorId)
            : this.aimedEntry(pointer, true)
        : null)
    this.zoomAnchor = aimed ?? null
    this.zoomPointer = pointer?.clone() ?? null
    const anchor = aimed?.position ?? target
    const distance = camera.distanceTo(target)
    const solid =
      aimed &&
      [
        'planet',
        'rogue-planet',
        'spacecraft',
        'moon',
        'star',
        'asteroid',
        'dwarf-planet',
        'comet',
        'black-hole',
        'quasar',
        'neutron-star',
      ].includes(aimed.kind)
    const minimum = Math.max(
      this.minimumCameraDistance(anchor),
      locked && solid ? locked.radius * 1.05 : 0,
    )
    const clamped =
      THREE.MathUtils.clamp(
        distance * factor,
        minimum,
        MAX_MAP_DISTANCE_PC,
      ) / Math.max(distance, 1e-30)
    camera.sub(anchor).multiplyScalar(clamped).add(anchor)
    target.sub(anchor).multiplyScalar(clamped).add(anchor)
    if (
      aimed &&
      solid &&
      camera.distanceTo(aimed.position) < aimed.radius * 1.05
    )
      camera
        .sub(aimed.position)
        .setLength(aimed.radius * 1.05)
        .add(aimed.position)
    if (
      aimed &&
      (aimed.solar || aimed.elements) &&
      camera.distanceTo(aimed.position) < aimed.radius * 100
    ) {
      this.following = aimed
      this.previousFollowPosition.copy(aimed.position)
    }
    this.flight = { camera, target }
    this.zooming = true
    this.host.querySelector('canvas')!.dataset.flying = 'true'
  }

  private aimedEntry(pointer?: THREE.Vector2, localOnly = false) {
    const focal = this.controls.target.clone().project(this.camera)
    const screen = pointer ?? new THREE.Vector2(focal.x, focal.y)
    let best: Entry | null = null
    let bestDistance = 0.045
    for (const {
      entry,
      horizontal,
      vertical,
      distance: physicalDistance,
    } of this.labelCandidates) {
      if (entry.positionValid === false) continue
      if (localOnly && physicalDistance > this.currentDistance * 5) continue
      const distance = Math.hypot(
        (horizontal / this.host.clientWidth) * 2 - 1 - screen.x,
        1 - (vertical / this.host.clientHeight) * 2 - screen.y,
      )
      if (distance < bestDistance) {
        bestDistance = distance
        best = entry
      }
    }
    return best
  }

  pick(pointer: THREE.Vector2) {
    const entry = this.aimedEntry(pointer)
    if (entry) this.onSelect(entry.id)
  }

  private normalizedUnit(entry: Entry) {
    if (entry.kind === 'black-hole' || entry.kind === 'quasar')
      return entry.radius / 0.45
    if (entry.kind === 'galaxy') return entry.radius / 5.65
    if (entry.kind === 'nebula' || entry.kind === 'supernova')
      return entry.radius / 4
    if (entry.kind === 'neutron-star') return entry.radius / 0.55
    if (entry.kind === 'cluster') return entry.radius / 6.4
    if (entry.kind === 'star-cluster') return entry.radius / 4
    if (entry.kind === 'void') return entry.radius / 4
    if (entry.kind === 'universe') return entry.radius / 8.5
    return entry.radius
  }

  private updateModels(now: number) {
    this.nearBlackHole = false
    for (const model of this.models.values()) model.root.visible = false
    const priority =
      this.zoomAnchor?.id ?? this.following?.id ?? this.selected
    const candidates = this.visibleEntries
      .sort(
        (first, second) =>
          Number(second.entry.id === priority) -
            Number(first.entry.id === priority) ||
          second.angular - first.angular,
      )
      .slice(0, 18)
    for (const { entry, distance } of candidates) {
      if (
        entry.aggregate &&
        entry.kind !== 'universe' &&
        entry.id !== 'laniakea'
      )
        continue
      if (entry.kind === 'exoplanet' && !entry.solar?.planetaryHost) continue
      let model = this.models.get(entry.id)
      if (!model) {
        const object = objectById.get(entry.id)
        if (!object) continue
        const root = this.makeVisual(object)
        model = { root, entry, unit: this.normalizedUnit(entry), used: now }
        this.models.set(entry.id, model)
        this.root.add(root)
      }
      model.used = now
      model.root.visible = true
      const projection =
        distance / this.unit > 180
          ? 180 / Math.max(distance, 1e-30)
          : 1 / this.unit
      model.root.position
        .copy(entry.position)
        .sub(this.worldCamera)
        .multiplyScalar(projection)
        .add(this.camera.position)
      model.root.scale.setScalar(model.unit * projection)
      if (entry.id === 'laniakea' || entry.id === 'universe') {
        const fade = overviewOpacity(entry.id, distance)
        model.root.traverse((node) => {
          const target = (node as THREE.Mesh).material
          if (!target) return
          for (const material of Array.isArray(target) ? target : [target]) {
            const uniform = (material as THREE.ShaderMaterial).uniforms
              ?.uOpacity
            material.userData.overviewBaseOpacity ??=
              uniform?.value ?? material.opacity
            if (uniform)
              uniform.value = material.userData.overviewBaseOpacity * fade
            else
              material.opacity = material.userData.overviewBaseOpacity * fade
          }
        })
        this.host.querySelector('canvas')!.dataset[
          entry.id === 'laniakea' ? 'laniakeaOpacity' : 'universeOpacity'
        ] = fade.toFixed(4)
      }
      if (entry.kind === 'galaxy') {
        model.root.traverse((node) => {
          if (
            node.name === 'spiral-emission-and-dust' ||
            node.name === 'ionized-gas-layer'
          )
            node.visible = distance > entry.radius * 0.85
        })
      }
      if (entry.kind === 'black-hole' || entry.kind === 'quasar')
        this.nearBlackHole = true
      if (entry.id === this.selected) {
        const canvas = this.host.querySelector('canvas')!
        model.root.traverse((node) => {
          if (!node.userData.modelState) return
          canvas.dataset.modelObject = entry.id
          canvas.dataset.modelState = node.userData.modelState
          canvas.dataset.modelParticles = String(
            node.userData.modelParticles ?? 0,
          )
        })
      }
    }
    if (this.models.size > 28) {
      const unused = [...this.models.values()]
        .filter((model) => !model.root.visible)
        .sort((first, second) => first.used - second.used)
      for (const model of unused.slice(0, this.models.size - 28)) {
        this.releaseVisual(model.root)
        removeVisual(model.root)
        this.models.delete(model.entry.id)
      }
    }
  }

  update(now: number, elapsed: number, keys: ReadonlySet<string>) {
    this.frame++
    this.controls.zoomToCursor = !this.followLocked
    this.controls.update()
    this.readCamera()
    const date = new Date(this.timestamp)
    for (const entry of this.entries) {
      if (!entry.solar) continue
      const position = solarPositionPc(entry.solar, date)
      entry.positionValid = position.every(Number.isFinite)
      if (entry.positionValid) entry.position.fromArray(position)
      else if (this.following === entry) {
        this.interrupt()
        this.velocity.set(0, 0, 0)
        this.host.dispatchEvent(
          new CustomEvent('map-notice', {
            detail: `Position unavailable for ${entry.name} at this date. The selected date is outside its supported ephemeris.`,
          }),
        )
      }
    }
    if (this.following?.elements) {
      const tracked = this.following
      const physical = smallBodyPosition(tracked.elements!, date)
      tracked.positionValid = physical.every(Number.isFinite)
      if (tracked.positionValid)
        tracked.position.fromArray(eclipticToWorld(physical))
      else {
        this.interrupt()
        this.velocity.set(0, 0, 0)
        this.host.dispatchEvent(
          new CustomEvent('map-notice', {
            detail: `Orbit calculation unavailable for ${tracked.name} at this date.`,
          }),
        )
      }
    }
    if (this.following) {
      const offset = this.following.position
        .clone()
        .sub(this.previousFollowPosition)
      this.worldCamera.add(offset)
      this.worldTarget.add(offset)
      if (this.flight) {
        this.flight.camera.add(offset)
        this.flight.target.add(offset)
      }
      this.previousFollowPosition.copy(this.following.position)
    }
    const delta = Math.min(elapsed, 0.2)
    const movement = new THREE.Vector3(
      Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
      Number(keys.has('KeyE')) - Number(keys.has('KeyQ')),
      Number(keys.has('KeyS')) - Number(keys.has('KeyW')),
    )
    const distance = Math.max(
      1e-13,
      this.worldCamera.distanceTo(this.worldTarget),
    )
    const clearance =
      this.nearest && !this.nearest.aggregate
        ? Math.max(
            0,
            this.worldCamera.distanceTo(this.nearest.position) -
              this.nearest.radius,
          )
        : distance
    const speed =
      Math.max(distance * 0.4, Math.min(clearance, distance * 20) * 0.3) *
      (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1)
    movement.applyQuaternion(this.camera.quaternion).multiplyScalar(speed)
    this.velocity.lerp(movement, 1 - Math.exp(-elapsed * 10))
    if (movement.lengthSq() > 0) this.flight = null
    const translation = this.velocity.clone().multiplyScalar(delta)
    this.worldCamera.add(translation)
    this.worldTarget.add(translation)
    if (this.flight) {
      const damping = 1 - Math.exp(-Math.min(elapsed, 0.5) * 8)
      if (this.zooming) {
        const currentDistance = Math.max(
          1e-15,
          this.worldCamera.distanceTo(this.worldTarget),
        )
        const destinationDistance = Math.max(
          1e-15,
          this.flight.camera.distanceTo(this.flight.target),
        )
        const zoomDistance = Math.exp(
          THREE.MathUtils.lerp(
            Math.log(currentDistance),
            Math.log(destinationDistance),
            damping,
          ),
        )
        const direction = this.worldCamera
          .clone()
          .sub(this.worldTarget)
          .normalize()
        const destinationDirection = this.flight.camera
          .clone()
          .sub(this.flight.target)
          .normalize()
        direction.lerp(destinationDirection, damping).normalize()
        this.worldTarget.lerp(this.flight.target, damping)
        this.worldCamera
          .copy(this.worldTarget)
          .addScaledVector(direction, zoomDistance)
      } else {
        this.worldCamera.lerp(this.flight.camera, damping)
        this.worldTarget.lerp(this.flight.target, damping)
      }
      const tolerance = Math.max(
        1e-15,
        this.flight.camera.distanceTo(this.flight.target) * 0.0003,
        Math.max(
          Math.abs(this.flight.target.x),
          Math.abs(this.flight.target.y),
          Math.abs(this.flight.target.z),
        ) *
          Number.EPSILON *
          16,
      )
      if (
        this.worldCamera.distanceTo(this.flight.camera) < tolerance &&
        this.worldTarget.distanceTo(this.flight.target) < tolerance
      ) {
        this.worldCamera.copy(this.flight.camera)
        this.worldTarget.copy(this.flight.target)
        this.flight = null
      }
    }
    if (this.followLocked && this.following && !this.flight) {
      this.worldCamera.add(
        this.following.position.clone().sub(this.worldTarget),
      )
      this.worldTarget.copy(this.following.position)
    }
    this.setWorldCamera(this.worldCamera, this.worldTarget)
    const positionAttribute = this.cloud.geometry.attributes
      .position as THREE.BufferAttribute
    const alphaAttribute = this.cloud.geometry.attributes
      .aAlpha as THREE.BufferAttribute
    const alphas = alphaAttribute.array as Float32Array
    const positions = positionAttribute.array as Float32Array
    const updateMinor =
      Math.abs(this.timestamp - this.lastMinorTime) > DAY_MS * 2
    const labelFrame = now - this.lastLabels > 140
    if (labelFrame) {
      this.labelCandidates = []
      this.lastLabels = now
    }
    this.visibleEntries = []
    let nearestDistance = Infinity
    this.currentDistance = this.worldCamera.distanceTo(this.worldTarget)
    const focalLength =
      this.host.clientHeight /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))
    this.entries.forEach((entry, index) => {
      const conceptual =
        this.selected === 'dark-matter' || this.selected === 'dark-energy'
      if (
        ((entry.id === 'dark-matter' || entry.id === 'dark-energy') &&
          entry.id !== this.selected) ||
        (conceptual && entry.id === 'universe')
      ) {
        alphas[index] = 0
        return
      }
      if (
        entry.elements &&
        (updateMinor || this.models.get(entry.id)?.root.visible)
      ) {
        const physical = smallBodyPosition(entry.elements, date)
        entry.positionValid = physical.every(Number.isFinite)
        if (entry.positionValid)
          entry.position.fromArray(eclipticToWorld(physical))
      }
      if (
        entry.positionValid === false ||
        (entry.id === 'proxima-c' &&
          !this.options.showCandidates &&
          this.selected !== entry.id)
      ) {
        alphas[index] = 0
        return
      }
      this.projected.copy(entry.position).sub(this.worldCamera)
      const physicalDistance = this.projected.length()
      if (!entry.aggregate && physicalDistance < nearestDistance) {
        nearestDistance = physicalDistance
        this.nearest = entry
      }
      const radialUnits = physicalDistance / this.unit
      if (radialUnits > 240)
        this.projected
          .multiplyScalar(240 / Math.max(physicalDistance, 1e-30))
          .add(this.camera.position)
      else
        this.projected
          .copy(entry.position)
          .sub(this.origin)
          .divideScalar(this.unit)
      positions[index * 3] = this.projected.x
      positions[index * 3 + 1] = this.projected.y
      positions[index * 3 + 2] = this.projected.z
      const angular =
        entry.radius / Math.max(physicalDistance, entry.radius * 0.05)
      const stellarVisibility =
        Math.min(1, 200 / Math.max(200, this.currentDistance)) ** 1.8
      alphas[index] =
        entry.kind === 'void'
          ? 0
          : entry.id === 'solar-system'
            ? this.currentDistance > 0.01
              ? 0.9
              : 0
            : entry.kind === 'star' ||
                entry.kind === 'white-dwarf' ||
                entry.kind === 'exoplanet'
              ? stellarVisibility *
                (entry.kind === 'exoplanet'
                  ? 0.6
                  : entry.magnitude !== undefined
                    ? 0.34
                    : 0.95)
              : entry.elements || entry.solar
                ? Math.min(1, 0.002 / Math.max(0.002, this.currentDistance))
                : 0.9
      if (
        angular * focalLength > 5 &&
        !entry.aggregate &&
        (entry.kind !== 'exoplanet' || entry.solar?.planetaryHost)
      )
        alphas[index] = 0
      if (
        angular * focalLength > 1.5 &&
        overviewOpacity(entry.id, physicalDistance) > 0 &&
        (!entry.aggregate ||
          (entry.kind === 'universe' && distance > 1e7) ||
          entry.id === 'laniakea')
      )
        this.visibleEntries.push({
          entry,
          distance: physicalDistance,
          angular,
        })
      if (
        labelFrame &&
        (!entry.aggregate ||
          entry.id === 'solar-system' ||
          (entry.id === 'laniakea' &&
            overviewOpacity(entry.id, physicalDistance) > 0.05) ||
          (entry.id === 'local-group' && this.selected === 'laniakea')) &&
        (alphas[index] > 0.05 || entry.kind === 'void') &&
        ((entry.kind !== 'star' && entry.kind !== 'white-dwarf') ||
          (entry.magnitude ?? 0) < 1.5 ||
          physicalDistance < distance * 4) &&
        (entry.kind !== 'exoplanet' || physicalDistance < distance * 5) &&
        (!entry.elements || physicalDistance < distance * 2)
      ) {
        this.projected.project(this.camera)
        if (
          this.projected.z > -1 &&
          this.projected.z < 1 &&
          Math.abs(this.projected.x) < 1 &&
          Math.abs(this.projected.y) < 0.8
        )
          this.labelCandidates.push({
            entry,
            distance: physicalDistance,
            horizontal: ((this.projected.x + 1) * this.host.clientWidth) / 2,
            vertical: ((1 - this.projected.y) * this.host.clientHeight) / 2,
          })
      }
    })
    if (updateMinor) this.lastMinorTime = this.timestamp
    positionAttribute.needsUpdate = true
    alphaAttribute.needsUpdate = true
    this.updateModels(now)
    this.updateRuler()
    for (const path of this.paths) {
      const host = objectById.get(path.id)?.planetaryHost
      path.line.visible =
        this.options.orbits &&
        this.unit < 0.02 &&
        this.unit > (path.parentId ? 1e-11 : 1e-9) &&
        (path.id !== 'proxima-c' ||
          Boolean(this.options.showCandidates) ||
          this.selected === path.id) &&
        (!host ||
          this.worldCamera.distanceTo(this.index.get(host)!.position) <
            Math.max(this.currentDistance * 4, 100 / AU_PER_PARSEC))
      if (!path.line.visible) continue
      const buffer = path.line.geometry.attributes
        .position as THREE.BufferAttribute
      const primaryPosition = path.parentId
        ? this.index.get(path.parentId)?.position
        : undefined
      path.positions.forEach((point, index) => {
        this.projected.copy(point)
        if (primaryPosition) this.projected.add(primaryPosition)
        this.projected.sub(this.origin).divideScalar(this.unit)
        buffer.setXYZ(
          index,
          this.projected.x,
          this.projected.y,
          this.projected.z,
        )
      })
      buffer.needsUpdate = true
    }
    this.updateMinorOrbits()
    if (labelFrame) this.updateLabels()
    const canvas = this.host.querySelector('canvas')!
    canvas.dataset.mapContext = 'unified'
    canvas.dataset.mapObjects = String(this.entries.length)
    canvas.dataset.worldDistancePc = String(
      this.worldCamera.distanceTo(this.worldTarget),
    )
    canvas.dataset.worldCamera = this.worldCamera.toArray().join(',')
    canvas.dataset.renderUnitPc = String(this.unit)
    canvas.dataset.flying = String(Boolean(this.flight))
    canvas.dataset.activeModels = String(
      [...this.models.values()].filter((model) => model.root.visible).length,
    )
    canvas.dataset.activeModelIds = [...this.models.values()]
      .filter((model) => model.root.visible)
      .map((model) => model.entry.id)
      .join(',')
    canvas.dataset.hostOrbitIds = this.paths
      .filter(
        (path) => path.line.visible && objectById.get(path.id)?.planetaryHost,
      )
      .map((path) => path.id)
      .join(',')
    canvas.dataset.worldTarget = this.worldTarget.toArray().join(',')
    canvas.dataset.followingId = this.followLocked
      ? (this.following?.id ?? '')
      : ''
    if (now - this.lastTelemetry > 250) {
      const span = this.worldCamera.distanceTo(this.worldTarget) * 1.4
      const region =
        span < 0.002 && this.worldCamera.length() < 0.05
          ? 'Solar System'
          : span < 200
            ? 'Stellar Neighborhood'
            : span < 80000
              ? 'Milky Way'
              : span < 5e6
                ? 'Local Group'
                : span < 2e7
                  ? 'Galaxy Groups & Clusters'
                  : span < LANIAKEA_RADIUS_PC * 8
                    ? 'Supercluster Neighborhood'
                    : span < OBSERVABLE_RADIUS_PC * 0.5
                      ? 'Cosmic Web'
                      : 'Observable Universe'
      const isFocused = (entry: Entry) =>
        this.currentDistance < entry.radius * 110 &&
        this.worldTarget.distanceTo(entry.position) <
          (entry.aggregate
            ? Math.min(entry.radius * 0.01, this.currentDistance * 0.1)
            : entry.kind === 'galaxy' || entry.kind === 'nebula'
              ? entry.radius * 0.015
              : entry.radius * 3)
      const selectedEntry = this.index.get(this.selected)
      const focused =
        this.followLocked && this.following
          ? this.following
          : selectedEntry && isFocused(selectedEntry)
            ? selectedEntry
            : this.entries.find(
                (entry) =>
                  !entry.aggregate &&
                  entry.kind !== 'exoplanet' &&
                  isFocused(entry),
              )
      const detail: MapTelemetry = {
        region,
        span: formatWorldDistance(span),
        distancePc: this.currentDistance,
        coordinates: this.worldCamera
          .toArray()
          .map((coordinate) => coordinate.toPrecision(5))
          .join(' / '),
        nearest: this.nearest?.name ?? 'Deep space',
        mapped: this.entries.length,
        focusedId: focused?.id,
        followingId: this.followLocked ? this.following?.id : undefined,
        measurement: this.options.ruler
          ? this.measure(...this.options.ruler)
          : null,
      }
      this.host.dispatchEvent(new CustomEvent('map-position', { detail }))
      this.lastTelemetry = now
    }
  }

  private updateLabels() {
    const priority = (entry: Entry) =>
      entry.id === this.selected
        ? -2
        : entry.kind === 'planet' || entry.id === 'sun'
          ? -1
          : entry.kind === 'moon'
            ? 0
            : entry.elements
              ? 2
              : 1
    this.labelCandidates.sort(
      (first, second) =>
        priority(first.entry) - priority(second.entry) ||
        first.distance - second.distance,
    )
    const mobile = this.host.clientWidth < 760
    const inspector = this.host.parentElement
      ?.querySelector('.object-inspector')
      ?.getBoundingClientRect()
    const leftEdge = mobile ? 16 : this.host.clientWidth < 1100 ? 235 : 267
    const rightEdge = mobile
      ? this.host.clientWidth - 55
      : inspector
        ? inspector.left - 60
        : this.host.clientWidth - 65
    const occupied: {
      left: number
      right: number
      top: number
      bottom: number
    }[] = []
    const heading = this.host.parentElement
      ?.querySelector('.scene-heading')
      ?.getBoundingClientRect()
    if (heading) occupied.push(heading)
    this.labelEntries = []
    for (const candidate of this.labelCandidates) {
      if (
        this.labelEntries.length >= this.labels.length ||
        !this.options.labels
      )
        break
      const width = Math.min(230, candidate.entry.name.length * 6 + 20)
      const bounds = {
        left: candidate.horizontal - width / 2,
        right: candidate.horizontal + width / 2,
        top: candidate.vertical + 9,
        bottom: candidate.vertical + 32,
      }
      if (
        bounds.left < leftEdge ||
        bounds.right > rightEdge ||
        bounds.top < (mobile ? 245 : 210) ||
        bounds.bottom > this.host.clientHeight - (mobile ? 280 : 175)
      )
        continue
      if (
        occupied.some(
          (other) =>
            bounds.left < other.right + 5 &&
            bounds.right > other.left - 5 &&
            bounds.top < other.bottom + 4 &&
            bounds.bottom > other.top - 4,
        )
      )
        continue
      const label = this.labels[this.labelEntries.length]
      label.textContent = candidate.entry.name
      label.setAttribute('aria-label', `Visit ${candidate.entry.name}`)
      label.style.transform = `translate(${candidate.horizontal}px, ${bounds.top}px) translateX(-50%)`
      label.style.display = ''
      label.dataset.worldId = candidate.entry.id
      this.labelEntries.push(candidate.entry)
      occupied.push(bounds)
    }
    for (
      let index = this.labelEntries.length;
      index < this.labels.length;
      index++
    )
      this.labels[index].style.display = 'none'
  }

  dispose() {
    this.labels.forEach((label) => label.remove())
    this.models.forEach((model) => this.releaseVisual(model.root))
    this.models.clear()
    removeVisual(this.root)
  }
}
