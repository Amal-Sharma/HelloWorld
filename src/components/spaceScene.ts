import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { ContinuousMap } from './ContinuousMap'
import type { CameraPose, Viewpoint } from '../lib/viewpoints'
import { comparisonLayout } from '../lib/scienceTools'
import { cameraDampingFactor, referencePositionPc } from '../lib/mapCoordinates'
import { SpectralAppearance } from './spectralAppearance'
import type { ObservationBand } from '../lib/spectrum'
import { AU_PER_PARSEC, KM_PER_PARSEC, LANIAKEA_RADIUS_PC, mapWheelZoomFactor } from '../lib/mapCoordinates'
import { expansionScale } from '../lib/cosmology'
import { marsRegions } from '../data/marsRegions'
import { Body } from 'astronomy-engine'
import {
  defaultObserver,
  earthShadow,
  horizontalDirection,
  observerBody,
  observerStars,
  solarObscuration,
} from '../lib/observer'
import type { ObserverSite } from '../lib/observer'
import { earth, objectById, solarPlanets } from '../data/catalog'
import type { CelestialObject } from '../data/catalog'
import type { OrbitalElements } from '../data/catalog'
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
  displayPosition,
  getPosition,
  sampleOrbit,
  smallBodyPosition,
} from '../lib/astronomy'

export type GalaxyStyle = 'original' | 'reference'

export interface SceneOptions {
  orbits: boolean
  labels: boolean
  compressed: boolean
  playing: boolean
  highQuality: boolean
  adaptiveQuality?: boolean
  ruler?: readonly [string, string] | null
  comparison?: string[]
  observer?: ObserverSite
  skyFocus?: 'Sun' | 'Moon' | null
  inspectorOpen: boolean
  uiHidden?: boolean
  galaxyStyle?: GalaxyStyle
  galacticDust?: boolean
  stellarGlints?: boolean
  spectrum?: ObservationBand
  radioExposure?: number
  showCandidates?: boolean
  cosmicAgeGyr?: number
  densityGain?: number
  catalogRevision?: number
  navigation?: 'orbit' | 'pan'
}

export type ViewMode = 'map' | 'object' | 'orbit' | 'compare' | 'sky'

interface OrbitEntry {
  node: THREE.Object3D
  object: CelestialObject
  scale: number
  compressed: boolean
  parent?: THREE.Object3D
}

interface SceneLabel {
  id: string
  element: HTMLButtonElement
  anchor: THREE.Object3D
  offset: number
}

const initialEpoch = Date.UTC(2026, 8, 16, 12)

function seededRandom(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function hashId(id: string) {
  return Array.from(id).reduce(
    (hash, character) => Math.imul(hash, 31) + character.charCodeAt(0),
    17,
  )
}

function disposeGroup(group: THREE.Object3D) {
  disposeModelAssets(group)
  group.traverse((object) => {
    const renderable = object as THREE.Mesh
    renderable.geometry?.dispose()
    if (renderable.material) {
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]
      materials.forEach((material) => material.dispose())
    }
  })
}

function disposeModelAssets(group: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  group.traverse((object) => {
    object.userData.disposed = true
    const material = (object as THREE.Mesh).material
    if (!material) return
    for (const item of Array.isArray(material) ? material : [material])
      for (const value of Object.values(item))
        if (value instanceof THREE.Texture && value.userData.modelAsset)
          textures.add(value)
  })
  for (const texture of textures) {
    texture.dispose()
    if (typeof texture.image?.close === 'function') texture.image.close()
  }
}

const particleVertex = `
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPixelRatio;
  void main() {
    vColor = color;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (360.0 / -viewPosition.z), 0.75, 100.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const particleFragment = `
  varying vec3 vColor;
  uniform float uOpacity;
  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float radius = length(point) * 2.0;
    if (radius > 1.0) discard;
    float glow = exp(-radius * radius * 5.0) * (1.0 - smoothstep(0.7, 1.0, radius));
    gl_FragColor = vec4(vColor, glow * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export class SpaceScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private spectralAppearance = new SpectralAppearance()
  private camera = new THREE.PerspectiveCamera(43, 1, 0.025, 500)
  private controls: OrbitControls
  private content = new THREE.Group()
  private continuousMap: ContinuousMap | null = null
  private buildingWorldVisual = false
  private starfield: THREE.Points
  private textures = new Map<string, THREE.Texture>()
  private loader = new THREE.TextureLoader()
  private modelData = new Map<string, Promise<ArrayBuffer>>()
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private contextLost = false
  private selected: CelestialObject = earth
  private view: ViewMode = 'object'
  private options: SceneOptions
  private timestamp = initialEpoch
  private visualTime = 0
  private lastFrame = 0
  private controlActive = false
  private navigationQuality = false
  private lastCameraMotion = -Infinity
  private previousViewOffset = new THREE.Vector3()
  private previousViewRotation = new THREE.Quaternion()
  private viewOffset = new THREE.Vector3()
  private lastEphemeris = -Infinity
  private entries: OrbitEntry[] = []
  private labels: SceneLabel[] = []
  private orbitLines: THREE.Object3D[] = []
  private shaders: THREE.ShaderMaterial[] = []
  private billboards: THREE.Object3D[] = []
  private rotating: {
    node: THREE.Object3D
    hours?: number
    speed?: number
    base: number
  }[] = []
  private targetCamera = new THREE.Vector3()
  private targetLookAt = new THREE.Vector3()
  private mapContext: string | null = null
  private mapGeneration = 0
  private mapNodes = new Map<string, { node: THREE.Object3D; radius: number }>()
  private followNode: THREE.Object3D | null = null
  private previousFocus = new THREE.Vector3()
  private dollying = false
  private pressedKeys = new Set<string>()
  private movementVelocity = new THREE.Vector3()
  private pointCount = 0
  private minorCloud: {
    points: THREE.Points
    elements: OrbitalElements[]
  } | null = null
  private lastMinorUpdate = -Infinity
  private activeDetail: {
    id: string
    node: THREE.Group
    orbit?: THREE.Object3D
  } | null = null
  private flying = false
  private fitRadius = 2.1
  private orbitPerspective = false
  private pointerDown = new THREE.Vector2()
  private raycaster = new THREE.Raycaster()
  private screenVector = new THREE.Vector3()
  private loadedAssets = 0
  private failedAssets = new Set<string>()
  private skyLayer: THREE.Group | null = null
  private earthMoonPair: { earth: THREE.Group; moon: THREE.Group; unit: number } | null = null
  private lastSkyTime = -Infinity
  private lastSkyFrame = -Infinity
  private onSelect: (id: string) => void
  private host: HTMLDivElement
  private labelHost: HTMLDivElement

  constructor(
    host: HTMLDivElement,
    labelHost: HTMLDivElement,
    options: SceneOptions,
    onSelect: (id: string) => void,
  ) {
    this.host = host
    this.labelHost = labelHost
    this.options = options
    this.onSelect = onSelect
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    this.renderer.setClearColor('#060809')
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, options.highQuality ? 2 : 1.25),
    )
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D universe',
    )
    this.renderer.domElement.setAttribute('role', 'img')
    this.renderer.domElement.dataset.scene = 'earth'
    this.renderer.domElement.dataset.graphicsState = 'ready'
    host.appendChild(this.renderer.domElement)
    this.camera.position.set(0, 0.5, 8)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.065
    this.controls.enablePan = true
    this.controls.screenSpacePanning = true
    this.controls.panSpeed = 0.65
    this.controls.zoomToCursor = true
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.8
    this.controls.maxDistance = 160
    this.controls.addEventListener('start', this.handleControlStart)
    this.controls.addEventListener('end', this.handleControlEnd)
    this.scene.add(new THREE.AmbientLight('#c9d7df', 0.14))
    const sunlight = new THREE.DirectionalLight('#fff7e9', 3.2)
    sunlight.position.set(-5, 3, 5)
    this.scene.add(sunlight)
    this.starfield = this.createStarfield()
    this.scene.add(this.starfield, this.content)
    this.renderer.domElement.addEventListener(
      'pointerdown',
      this.handlePointerDown,
      true,
    )
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, {
      capture: true,
      passive: false,
    })
    this.labelHost.addEventListener('wheel', this.handleWheel, {
      capture: true,
      passive: false,
    })
    window.addEventListener('keydown', this.handleMoveKey)
    window.addEventListener('keyup', this.handleMoveKey)
    window.addEventListener('blur', this.clearMovement)
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.handleContextLost,
    )
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    )
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.setObject(earth, 'object', true)
    this.scheduleFrame()
  }

  private handleControlStart = () => {
    this.controlActive = true
    this.interruptFlight(true)
  }

  private handleControlEnd = () => {
    this.controlActive = false
    this.lastCameraMotion = performance.now()
  }

  private interruptFlight = (preserveFollow = false) => {
    this.host.dispatchEvent(new Event('map-navigation'))
    this.continuousMap?.interrupt(preserveFollow)
    this.flying = false
    this.dollying = false
    this.followNode = null
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    this.host.dispatchEvent(new Event('map-navigation'))
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1
    if (this.continuousMap && this.view === 'map') {
      const bounds = this.host.getBoundingClientRect()
      const anchorId = (event.target as HTMLElement).closest?.<HTMLElement>(
        '[data-world-id]',
      )?.dataset.worldId
      this.continuousMap.zoom(
        mapWheelZoomFactor(event.deltaY, event.deltaMode),
        new THREE.Vector2(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          1 - ((event.clientY - bounds.top) / bounds.height) * 2,
        ),
        anchorId,
      )
      return
    }
    this.zoom(
      Math.exp(THREE.MathUtils.clamp(event.deltaY * units * 0.0016, -0.7, 0.7)),
    )
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault()
    this.contextLost = true
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.clearMovement()
    this.renderer.domElement.dataset.graphicsState = 'lost'
    this.host.dispatchEvent(
      new CustomEvent('scene-error', {
        detail:
          'Graphics were interrupted. The view will resume automatically when the browser restores them.',
      }),
    )
  }

  private handleContextRestored = () => {
    if (this.disposed) return
    this.contextLost = false
    this.lastFrame = 0
    this.renderer.domElement.dataset.graphicsState = 'ready'
    this.host.dispatchEvent(new Event('scene-restored'))
    this.scheduleFrame()
  }

  private handleVisibilityChange = () => {
    this.lastFrame = 0
    this.clearMovement()
    if (document.hidden) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    } else this.scheduleFrame()
  }

  private scheduleFrame() {
    if (!this.disposed && !this.contextLost && !document.hidden && !this.frame)
      this.frame = requestAnimationFrame(this.animate)
  }

  private clearMovement = () => {
    this.controlActive = false
    this.lastCameraMotion = -Infinity
    this.pressedKeys.clear()
    this.movementVelocity.set(0, 0, 0)
    this.continuousMap?.stopMovement()
  }

  private handleMoveKey = (event: KeyboardEvent) => {
    if (event.type === 'keyup') {
      this.pressedKeys.delete(event.code)
      return
    }
    const target = event.target as HTMLElement
    if (
      this.view !== 'map' ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.isContentEditable ||
      document.querySelector('dialog[open]') ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    if (
      ![
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'KeyQ',
        'KeyE',
        'ShiftLeft',
        'ShiftRight',
      ].includes(event.code)
    )
      return
    event.preventDefault()
    this.interruptFlight()
    this.pressedKeys.add(event.code)
  }

  private texture(path: string, color = true) {
    const existing = this.textures.get(path)
    if (existing) return existing
    const texture = this.loader.load(
      path.startsWith('/') && !path.startsWith('//')
        ? `${import.meta.env.BASE_URL}${path.slice(1)}`
        : path,
      () => {
        if (this.disposed) return
        this.loadedAssets += 1
        this.renderer.domElement.dataset.loadedAssets = String(
          this.loadedAssets,
        )
      },
      undefined,
      () => {
        if (this.disposed) return
        this.failedAssets.add(path)
        this.renderer.domElement.dataset.failedAssets = [
          ...this.failedAssets,
        ].join(',')
        this.host.dispatchEvent(
          new CustomEvent('asset-error', {
            detail:
              'A surface map could not be loaded. Some objects may appear without texture.',
          }),
        )
      },
    )
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    )
    this.textures.set(path, texture)
    return texture
  }

  private loadModelData(path: string) {
    let data = this.modelData.get(path)
    if (!data) {
      data = fetch(`${import.meta.env.BASE_URL}${path}`, {
        signal: AbortSignal.timeout(20_000),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Model unavailable: ${path}`)
          return response.arrayBuffer()
        })
        .catch((error: unknown) => {
          this.modelData.delete(path)
          throw error
        })
      this.modelData.set(path, data)
    }
    return data
  }

  private spacecraft(object: CelestialObject, radius = 1) {
    const holder = new THREE.Group()
    holder.name = `spacecraft-${object.id}`
    holder.userData.objectId = object.id
    holder.userData.modelState = 'loading'
    const fallback = new THREE.Mesh(
      new THREE.OctahedronGeometry(radius * 0.2),
      new THREE.MeshBasicMaterial({ color: object.color, wireframe: true }),
    )
    holder.add(fallback)
    const model = object.model!
    if (this.selected.id === object.id) {
      this.renderer.domElement.dataset.modelState = 'loading'
      this.renderer.domElement.dataset.modelObject = object.id
    }
    void Promise.all([
      this.loadModelData(model.path),
      import('three/addons/loaders/GLTFLoader.js'),
    ])
      .then(async ([data, { GLTFLoader }]) => {
        const loaded = await new GLTFLoader().parseAsync(data.slice(0), '')
        const root = loaded.scene
        root.traverse((node) => {
          const material = (node as THREE.Mesh).material
          if (!material) return
          for (const item of Array.isArray(material) ? material : [material])
            for (const value of Object.values(item))
              if (value instanceof THREE.Texture)
                value.userData.modelAsset = true
        })
        if (this.disposed || holder.userData.disposed) {
          disposeGroup(root)
          return
        }
        const bounds = new THREE.Box3().setFromObject(root)
        const sphere = bounds.getBoundingSphere(new THREE.Sphere())
        if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
          disposeGroup(root)
          throw new Error('Invalid spacecraft model bounds')
        }
        const scale = radius / sphere.radius
        root.scale.multiplyScalar(scale)
        root.position.addScaledVector(sphere.center, -scale)
        fallback.removeFromParent()
        disposeGroup(fallback)
        holder.add(root)
        this.spectralAppearance.bind(holder, object)
        holder.rotation.set(0.24, -0.65, 0.12)
        holder.userData.modelReady = true
        holder.userData.modelState = 'ready'
        if (this.selected.id === object.id) {
          this.renderer.domElement.dataset.modelObject = object.id
          this.renderer.domElement.dataset.modelState = 'ready'
        }
      })
      .catch(() => {
        if (this.disposed || holder.userData.disposed) return
        this.modelData.delete(model.path)
        holder.userData.modelState = 'failed'
        if (this.selected.id === object.id)
          this.renderer.domElement.dataset.modelState = 'failed'
        this.host.dispatchEvent(
          new CustomEvent('asset-error', {
            detail:
              'The NASA spacecraft model could not be loaded. Its position remains available; a marker is shown instead.',
          }),
        )
      })
    return holder
  }

  private particles(
    positions: number[],
    colors: number[],
    sizes: number[],
    opacity = 1,
  ) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    )
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uOpacity: { value: opacity },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return new THREE.Points(geometry, material)
  }

  private createStarfield() {
    const random = seededRandom(9147)
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const color = new THREE.Color()
    for (let index = 0; index < 6500; index++) {
      const azimuth = random() * Math.PI * 2
      const vertical = random() * 2 - 1
      const spread = Math.sqrt(1 - vertical * vertical)
      const radius = 80 + random() * 50
      positions.push(
        Math.cos(azimuth) * spread * radius,
        vertical * radius,
        Math.sin(azimuth) * spread * radius,
      )
      const brightness = 0.2 + Math.pow(random(), 3) * 1.15
      color.setHSL(0.08 + random() * 0.6, random() * 0.24, brightness * 0.6)
      colors.push(color.r, color.g, color.b)
      sizes.push(0.13 + Math.pow(random(), 5) * 0.55)
    }
    return this.particles(positions, colors, sizes, 0.9)
  }

  private earthMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: this.texture('/textures/earth.jpg') },
        nightMap: { value: this.texture('/textures/earth-night.jpg') },
        lightDirection: { value: new THREE.Vector3(-4, 2.8, 5).normalize() },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayMap;
        uniform sampler2D nightMap;
        uniform vec3 lightDirection;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDirection = normalize(cameraPosition - vWorld);
          float sunlight = dot(normal, lightDirection);
          float daylight = smoothstep(-0.12, 0.5, sunlight);
          vec3 surface = texture2D(dayMap, vUv).rgb;
          vec3 night = texture2D(nightMap, vUv).rgb;
          vec3 lit = surface * (0.038 + 1.35 * max(sunlight, 0.0));
          lit += night * (1.0 - daylight) * 1.65;
          float ocean = smoothstep(surface.r * 1.1, surface.r * 1.1 + 0.15, surface.b);
          vec3 reflection = reflect(-lightDirection, normal);
          lit += vec3(0.7, 0.82, 0.9) * pow(max(dot(reflection, viewDirection), 0.0), 45.0) * ocean * 0.3;
          float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
          lit += vec3(0.14, 0.39, 0.65) * rim * daylight * 0.28;
          gl_FragColor = vec4(lit, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  }

  private atmosphere(radius: number, color: string, strength = 0.7) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        glowColor: { value: new THREE.Color(color) },
        strength: { value: strength },
        sunDirection: { value: new THREE.Vector3(-5, 3, 5).normalize() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vPosition = viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 glowColor;
        uniform float strength;
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 normal = normalize(vNormal), sight = normalize(-vPosition);
          float rim = pow(1.0 - abs(dot(normal, sight)), 3.8);
          float illumination = smoothstep(-0.2, 0.45, dot(normal, sunDirection));
          float scatteringAngle = dot(sight, sunDirection);
          float rayleigh = 0.75 * (1.0 + scatteringAngle * scatteringAngle);
          float mie = 0.12 / pow(max(0.08, 1.49 - 1.4 * scatteringAngle), 1.5);
          vec3 light = glowColor * rayleigh + vec3(0.75, 0.57, 0.36) * mie;
          gl_FragColor = vec4(light, rim * strength * (0.035 + illumination * 0.965));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 72, 48),
      material,
    )
    shell.onBeforeRender = () =>
      material.uniforms.sunDirection.value
        .set(-5, 3, 5)
        .normalize()
        .transformDirection(this.camera.matrixWorldInverse)
    return shell
  }

  private moonTexture(object: CelestialObject) {
    const key = `illustrative-${object.id}`
    const cached = this.textures.get(key)
    if (cached) return cached
    const width = 768,
      height = 384
    const pixels = new Uint8Array(width * height * 4)
    const noise = new ImprovedNoise()
    const offset = Math.abs(hashId(object.id) % 500)
    const color = new THREE.Color()
    for (let row = 0; row < height; row++) {
      const latitude = (row / (height - 1)) * Math.PI
      for (let column = 0; column < width; column++) {
        const longitude = (column / (width - 1)) * Math.PI * 2
        const horizontal = Math.sin(latitude) * Math.cos(longitude)
        const vertical = Math.cos(latitude)
        const depth = Math.sin(latitude) * Math.sin(longitude)
        const broad = noise.noise(
          horizontal * 5 + offset,
          vertical * 5,
          depth * 5,
        )
        const grain = noise.noise(
          horizontal * 65 + offset,
          vertical * 65,
          depth * 65,
        )
        const veins = Math.abs(
          noise.noise(
            horizontal * 13 + offset + broad,
            vertical * 13 - broad,
            depth * 13,
          ),
        )
        color.set(object.color)
        if (object.id === 'europa') {
          color.lerp(
            new THREE.Color('#805a40'),
            veins < 0.025 ? 0.85 : Math.max(0, broad) * 0.48,
          )
          color.multiplyScalar(0.88 + grain * 0.11)
        } else if (object.id === 'io') {
          color.lerp(new THREE.Color('#a84121'), Math.max(0, broad) * 1.5)
          if (grain < -0.47 && broad > 0) color.set('#34251d')
          color.multiplyScalar(0.84 + grain * 0.2)
        } else {
          color.multiplyScalar(0.56 + (broad + 0.5) * 0.6 + grain * 0.3)
          if (grain > 0.49) color.lerp(new THREE.Color('#e9e3cf'), 0.7)
        }
        const index = (row * width + column) * 4
        color.convertLinearToSRGB()
        pixels[index] = Math.min(255, color.r * 255)
        pixels[index + 1] = Math.min(255, color.g * 255)
        pixels[index + 2] = Math.min(255, color.b * 255)
        pixels[index + 3] = 255
      }
    }
    const texture = new THREE.DataTexture(pixels, width, height)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    this.textures.set(key, texture)
    return texture
  }

  private planet(object: CelestialObject, radius: number, detailed = false) {
    if (object.kind === 'rogue-planet')
      return this.roguePlanet(object, radius)
    const group = new THREE.Group()
    const surfaceMap = object.texture
      ? this.texture(object.texture)
      : object.jovianMoon || object.martianMoon
        ? this.moonTexture(object)
        : null
    const material =
      object.id === 'earth' && detailed
        ? this.earthMaterial()
        : new THREE.MeshPhongMaterial({
            map: surfaceMap,
            color: surfaceMap ? '#ffffff' : object.color,
            shininess: 8,
            specular: new THREE.Color('#182326'),
            bumpMap:
              detailed &&
              ['moon', 'mercury', 'mars'].includes(object.id) &&
              object.texture
                ? this.texture(object.texture)
                : null,
            bumpScale: 0.009,
          })
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(
        radius,
        detailed ? 96 : 40,
        detailed ? 64 : 28,
      ),
      material,
    )
    if (object.martianMoon) {
      const positions = surface.geometry.attributes.position
      const noise = new ImprovedNoise()
      const point = new THREE.Vector3()
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).divideScalar(radius)
        point.multiplyScalar(
          1 + noise.noise(point.x * 3, point.y * 3, point.z * 3) * 0.06,
        )
        point
          .multiply(
            new THREE.Vector3(
              object.id === 'phobos' ? 1.2 : 1.15,
              0.92,
              object.id === 'phobos' ? 0.8 : 0.88,
            ),
          )
          .multiplyScalar(radius)
        positions.setXYZ(index, point.x, point.y, point.z)
      }
      surface.geometry.computeVertexNormals()
      this.renderer.domElement.dataset.moonMorphology =
        'irregular-regolith-illustration'
    }
    surface.rotation.y = object.id === 'earth' ? 4.15 : 0.4
    surface.name = `body-surface-${object.id}`
    surface.userData.objectId = object.id
    group.add(surface)
    this.rotating.push({
      node: surface,
      hours: object.rotationHours,
      base: surface.rotation.y,
    })
    if (detailed && object.id === 'earth') {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.006, 80, 52),
        new THREE.MeshPhongMaterial({
          map: this.texture('/textures/earth-clouds.jpg', false),
          alphaMap: this.texture('/textures/earth-clouds.jpg', false),
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          shininess: 0,
        }),
      )
      clouds.rotation.y = surface.rotation.y
      group.add(clouds, this.atmosphere(radius * 1.025, '#7bbcff', 0.72))
      this.rotating.push({
        node: clouds,
        hours: 24.3,
        base: clouds.rotation.y,
      })
    } else if (
      detailed &&
      ['venus', 'neptune', 'uranus', 'titan'].includes(object.id)
    ) {
      group.add(
        this.atmosphere(
          radius * (object.id === 'titan' ? 1.06 : 1.02),
          object.color,
          object.id === 'titan' ? 0.65 : 0.28,
        ),
      )
    }
    if (object.id === 'saturn') {
      const ringGeometry = new THREE.RingGeometry(
        radius * 1.24,
        radius * 2.3,
        160,
      )
      const positions = ringGeometry.attributes.position
      const uv = ringGeometry.attributes.uv
      for (let index = 0; index < positions.count; index++) {
        const length = Math.hypot(
          positions.getX(index),
          positions.getY(index),
        )
        uv.setXY(index, (length / radius - 1.24) / 1.06, 0.5)
      }
      const rings = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshPhongMaterial({
          map: this.texture('/textures/saturn-ring.png'),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          shininess: 0,
          depthWrite: false,
        }),
      )
      rings.rotation.x = Math.PI / 2
      group.add(rings)
      group.rotation.z = -0.38
      group.rotation.x = 0.27
      const toPlanet = { value: new THREE.Matrix4() }
      const sunDirection = { value: new THREE.Vector3() }
      const ringMap = { value: this.texture('/textures/saturn-ring.png') }
      const installShadow = (target: THREE.Mesh, ring: boolean) => {
        const surfaceMaterial = target.material as THREE.MeshPhongMaterial
        surfaceMaterial.customProgramCacheKey = () =>
          ring ? 'saturn-ring-shadow-v1' : 'saturn-surface-shadow-v1'
        surfaceMaterial.onBeforeCompile = (shader) => {
          shader.uniforms.uToPlanet = toPlanet
          shader.uniforms.uRingSun = sunDirection
          shader.uniforms.uBodyRadius = { value: radius }
          shader.uniforms.uRingMap = ringMap
          shader.vertexShader =
            `uniform mat4 uToPlanet; uniform float uBodyRadius; varying vec3 vPlanetPosition;\n${shader.vertexShader}`.replace(
              '#include <project_vertex>',
              '#include <project_vertex>\nvPlanetPosition = (uToPlanet * modelMatrix * vec4(transformed, 1.0)).xyz / uBodyRadius;',
            )
          shader.fragmentShader =
            `uniform vec3 uRingSun; uniform sampler2D uRingMap; varying vec3 vPlanetPosition;\n${shader.fragmentShader}`.replace(
              '#include <opaque_fragment>',
              ring
                ? `
            float along = dot(vPlanetPosition, uRingSun);
            float chord = along * along - dot(vPlanetPosition, vPlanetPosition) + 1.0;
            float shadow = (along < 0.0 ? smoothstep(0.0, 0.025, chord) : 0.0);
            outgoingLight *= 1.0 - shadow * 0.92;
            #include <opaque_fragment>
          `
                : `
            float crossing = -vPlanetPosition.y / (abs(uRingSun.y) < 0.0001 ? 0.0001 : uRingSun.y);
            vec3 hit = vPlanetPosition + uRingSun * crossing;
            float ringRadius = length(hit.xz);
            float shadow = 0.0;
            if (crossing > 0.001 && ringRadius > 1.24 && ringRadius < 2.3) {
              vec4 density = texture2D(uRingMap, vec2((ringRadius - 1.24) / 1.06, 0.5));
              shadow = density.a * smoothstep(1.24, 1.27, ringRadius) * (1.0 - smoothstep(2.27, 2.3, ringRadius));
            }
            outgoingLight *= 1.0 - shadow * 0.7;
            #include <opaque_fragment>
          `,
            )
        }
        target.onBeforeRender = () => {
          toPlanet.value.copy(group.matrixWorld).invert()
          sunDirection.value
            .set(-5, 3, 5)
            .normalize()
            .transformDirection(toPlanet.value)
        }
      }
      installShadow(rings, true)
      installShadow(surface, false)
      this.renderer.domElement.dataset.saturnShadows = 'planet-and-rings'
    } else {
      group.rotation.z = object.id === 'uranus' ? -1.7 : -0.12
    }
    this.spectralAppearance.bind(group, object)
    return group
  }

  private solarSurfaceMaterial() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSurface: { value: this.texture('/textures/sun.jpg') },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition; void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); vec4 viewPosition = modelViewMatrix * vec4(position, 1.0); vPosition = viewPosition.xyz; gl_Position = projectionMatrix * viewPosition; }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D uSurface;
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
        float hash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 point) { vec2 cell = floor(point), local = fract(point); local = local * local * (3.0 - 2.0 * local); return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x), mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), local.x), local.y); }
        void main() {
          vec3 surface = texture2D(uSurface, vUv).rgb;
          float convection = noise(vUv * vec2(480.0, 240.0) + vec2(uTime * 0.045, sin(uTime * 0.18) * 0.3));
          float cell = noise(vUv * vec2(95.0, 47.5) + vec2(uTime * 0.017, 0.0));
          float limb = 0.45 + 0.55 * pow(max(dot(normalize(vNormal), normalize(-vPosition)), 0.0), 0.4);
          vec3 light = surface * vec3(1.0, 0.78, 0.57) * (1.55 + convection * 0.9);
          light += vec3(1.0, 0.38, 0.08) * pow(cell, 5.0) * 0.26;
          gl_FragColor = vec4(light * limb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    this.shaders.push(material)
    return material
  }

  private solarActivity(radius: number) {
    const activity = new THREE.Group()
    activity.name = 'solar-prominences-and-plasma'
    activity.userData.emissionComponent = 'hot-gas'
    const random = seededRandom(20260916)
    const loopCount = this.options.highQuality ? 7 : 4
    for (let index = 0; index < loopCount; index++) {
      const angle =
        [0.12, 0.2, 1.62, 2.78, 2.89, 4.45, 5.4][index] + random() * 0.09
      const normal = new THREE.Vector3(
        Math.cos(angle),
        Math.sin(angle),
        (random() - 0.5) * 0.6,
      ).normalize()
      const tangent = new THREE.Vector3(-normal.y, normal.x, 0).normalize()
      const width = 0.06 + random() * 0.1
      const height = 0.05 + random() * 0.19
      const points = Array.from({ length: 65 }, (_, sample) => {
        const progress = sample / 64
        const arc = (progress - 0.5) * width * 2
        const direction = normal
          .clone()
          .multiplyScalar(Math.cos(arc))
          .addScaledVector(tangent, Math.sin(arc))
        return direction.multiplyScalar(
          radius * (0.995 + Math.sin(progress * Math.PI) * height),
        )
      })
      const curve = new THREE.CatmullRomCurve3(points)
      for (const halo of [false, true]) {
        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uPhase: { value: index * 1.83 },
            uHalo: { value: halo ? 1 : 0 },
          },
          vertexShader: `varying vec2 vUv; uniform float uTime; uniform float uPhase; void main() { vUv = uv; vec3 ripple = position * (1.0 + sin(uv.x * 8.0 - uTime * 0.9 + uPhase) * 0.005); gl_Position = projectionMatrix * modelViewMatrix * vec4(ripple, 1.0); }`,
          fragmentShader: `
            uniform float uTime, uPhase, uHalo; varying vec2 vUv;
            void main() {
              float life = pow(0.5 + 0.5 * sin(uTime * 0.28 + uPhase), 2.5);
              float stream = pow(0.5 + 0.5 * sin(vUv.x * 31.0 - uTime * 3.8 + uPhase), 3.0);
              float footpoint = pow(abs(vUv.x - 0.5) * 2.0, 6.0);
              vec3 heat = mix(vec3(1.0, 0.11, 0.015), vec3(1.0, 0.75, 0.25), stream * 0.55 + footpoint * 0.45);
              float alpha = (0.025 + life * (0.18 + stream * 0.65 + footpoint * 0.2)) * mix(0.9, 0.25, uHalo);
              gl_FragColor = vec4(heat * (1.2 + stream * 1.3), alpha);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        this.shaders.push(material)
        const loop = new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            64,
            radius * (halo ? 0.019 : 0.003),
            7,
            false,
          ),
          material,
        )
        activity.add(loop)
      }
    }
    const positions: number[] = [],
      phases: number[] = [],
      sizes: number[] = []
    for (
      let index = 0;
      index < (this.options.highQuality ? 1800 : 850);
      index++
    ) {
      const arc = (Math.floor(random() * 7) / 7) * Math.PI * 2
      const angle = arc + (random() - 0.5) * 0.065
      positions.push(Math.cos(angle), Math.sin(angle), (random() - 0.5) * 0.16)
      phases.push(random())
      sizes.push(radius * (0.01 + random() * 0.035))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    )
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      radius * 1.8,
    )
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: radius },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        uniform float uTime, uRadius, uPixelRatio; attribute float aPhase, aSize; varying float vAge;
        void main() {
          vAge = fract(aPhase + uTime * 0.075);
          vec3 direction = normalize(position);
          vec3 tangent = normalize(vec3(-direction.y, direction.x, 0.0));
          vec3 plasma = direction * uRadius * (1.002 + vAge * 0.68) + tangent * uRadius * sin(vAge * 3.14159) * vAge * 0.12;
          vec4 projected = modelViewMatrix * vec4(plasma, 1.0);
          gl_PointSize = clamp(aSize * uPixelRatio * 360.0 / -projected.z, 1.0, 32.0);
          gl_Position = projectionMatrix * projected;
        }`,
      fragmentShader: `
        varying float vAge;
        void main() {
          float radial = length(gl_PointCoord - 0.5) * 2.0;
          if (radial > 1.0) discard;
          float envelope = sin(vAge * 3.14159) * pow(1.0 - vAge, 1.4);
          vec3 heat = mix(vec3(1.0, 0.63, 0.16), vec3(0.85, 0.045, 0.006), vAge);
          gl_FragColor = vec4(heat * 1.9, exp(-radial * radial * 4.0) * envelope * 0.55);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.shaders.push(material)
    activity.add(new THREE.Points(geometry, material))
    return activity
  }

  private star(object: CelestialObject, radius = 1.55) {
    const group = new THREE.Group()
    if (object.kind === 'white-dwarf') {
      const material = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(object.color) } },
        vertexShader: `varying vec3 vNormal, vSight; void main() { vec4 view = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vSight = normalize(-view.xyz); gl_Position = projectionMatrix * view; }`,
        fragmentShader: `uniform vec3 uColor; varying vec3 vNormal, vSight; void main() { float limb = pow(max(0.0, dot(normalize(vNormal), normalize(vSight))), 0.5); gl_FragColor = vec4(uColor * (0.4 + limb * 0.85), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      })
      const surface = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 40),
        material,
      )
      surface.name = 'white-dwarf-photosphere'
      surface.userData.objectId = object.id
      group.add(surface)
      this.spectralAppearance.bind(group, object)
      this.renderer.domElement.dataset.whiteDwarfAppearance =
        'compact-cooling-photosphere'
      return group
    }
    const material =
      object.id === 'sun'
        ? this.solarSurfaceMaterial()
        : new THREE.MeshBasicMaterial({
            map: this.texture('/textures/sun.jpg'),
            color: new THREE.Color(object.color).multiplyScalar(1.4),
          })
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 80, 52),
      material,
    )
    surface.userData.objectId = object.id
    group.add(
      surface,
      this.atmosphere(
        radius * (object.id === 'sun' ? 1.02 : 1.06),
        object.color,
        object.id === 'sun' ? 0.3 : 0.75,
      ),
      this.atmosphere(
        radius * (object.id === 'sun' ? 1.09 : 1.18),
        object.color,
        object.id === 'sun' ? 0.055 : 0.12,
      ),
    )
    this.rotating.push({
      node: surface,
      hours: object.rotationHours ?? 600,
      base: 0.2,
    })
    const random = seededRandom(724)
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const color = new THREE.Color(object.color)
    for (let index = 0; index < 500; index++) {
      const angle = random() * Math.PI * 2
      const radial = radius * (1.015 + Math.pow(random(), 3) * 0.18)
      positions.push(
        Math.cos(angle) * radial,
        Math.sin(angle) * radial,
        (random() - 0.5) * 0.1,
      )
      colors.push(color.r, color.g * 0.7, color.b * 0.3)
      sizes.push(0.06 + random() * 0.12)
    }
    group.add(this.particles(positions, colors, sizes, 0.15))
    if (object.id === 'sun') {
      group.add(this.solarActivity(radius))
      this.renderer.domElement.dataset.solarActivity =
        'prominences,plasma,granulation'
    }
    this.spectralAppearance.bind(group, object)
    return group
  }

  private addLabel(
    text: string,
    id: string,
    anchor: THREE.Object3D,
    offset = 18,
  ) {
    if (this.buildingWorldVisual) return
    const element = document.createElement('button')
    element.className = 'celestial-label'
    element.textContent = text
    element.setAttribute('aria-label', `Visit ${text}`)
    element.addEventListener('click', () => this.onSelect(id))
    this.labelHost.appendChild(element)
    this.labels.push({ id, element, anchor, offset })
  }

  private line(
    points: THREE.Vector3[],
    color: string,
    opacity = 0.3,
    dashed = false,
  ) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 0.065,
          gapSize: 0.06,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        })
    const line = new THREE.Line(geometry, material)
    if (dashed) line.computeLineDistances()
    this.orbitLines.push(line)
    return line
  }

  focusMarsRegion(id: string) {
    if (this.view !== 'object' || this.selected.id !== 'mars') return
    const region = marsRegions.find((item) => item.id === id)
    const surface = this.content.getObjectByName('body-surface-mars') as
      THREE.Mesh<THREE.SphereGeometry> | undefined
    if (!region || !surface) return
    this.interruptFlight()
    this.labels = this.labels.filter((label) => {
      if (!label.anchor.userData.surfaceRegion) return true
      label.element.remove()
      disposeGroup(label.anchor)
      label.anchor.removeFromParent()
      return false
    })
    const direction = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - region.latitude),
      THREE.MathUtils.degToRad(90 + region.longitude),
    )
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#def4b0', depthTest: true }),
    )
    marker.position
      .copy(direction)
      .multiplyScalar(surface.geometry.parameters.radius * 1.008)
    marker.userData.surfaceRegion = true
    marker.userData.spectralAnnotation = true
    surface.add(marker)
    this.addLabel(region.name, 'mars', marker, 12)
    surface.updateWorldMatrix(true, true)
    const center = surface.getWorldPosition(new THREE.Vector3())
    direction.applyQuaternion(
      surface.getWorldQuaternion(new THREE.Quaternion()),
    )
    this.targetLookAt.copy(center)
    this.targetCamera
      .copy(direction)
      .multiplyScalar(this.cameraDistance())
      .add(center)
    this.flying = true
    this.renderer.domElement.dataset.flying = 'true'
    this.renderer.domElement.dataset.marsRegion = region.id
    this.renderer.domElement.dataset.marsRegionCoordinates = `${region.latitude},${region.longitude}`
  }

  private buildPlanet(object: CelestialObject) {
    const radius = 1.65
    this.fitRadius = object.id === 'saturn' ? 3.7 : 2.05
    this.content.add(this.planet(object, radius, true))
    if (object.id === 'earth') {
      const moon = this.planet(objectById.get('moon')!, 0.19)
      moon.position.set(3.7, 0.4, -1.4)
      this.content.add(moon)
      this.addLabel('The Moon', 'moon', moon, 18)
      const points = Array.from({ length: 257 }, (_, index) => {
        const angle = (index / 256) * Math.PI * 2
        return new THREE.Vector3(
          Math.cos(angle) * 4,
          Math.sin(angle) * 0.3 - 0.1,
          Math.sin(angle) * 4,
        )
      })
      this.content.add(this.line(points, '#9bbdb8', 0.13, true))
    }
  }

  private comet(object: CelestialObject, radius = 0.35) {
    const group = new THREE.Group()
    const nucleus = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 3),
      new THREE.MeshStandardMaterial({
        color: '#a7a396',
        roughness: 1,
        flatShading: true,
      }),
    )
    nucleus.scale.set(1.4, 0.75, 1)
    nucleus.userData.objectId = object.id
    group.add(nucleus, this.atmosphere(radius * 1.8, '#9fe6d5', 0.12))
    const random = seededRandom(hashId(object.id))
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    for (let index = 0; index < 2200; index++) {
      const progress = Math.pow(random(), 1.3)
      const dust = index % 3 === 0
      const length = radius * (dust ? 15 : 22)
      const spread = radius * (0.6 + progress * (dust ? 3.1 : 0.6))
      positions.push(
        (random() - 0.5) * spread + (dust ? progress ** 2 * radius * 5 : 0),
        (random() - 0.5) * spread * 0.6,
        progress * length,
      )
      colors.push(dust ? 0.7 : 0.2, dust ? 0.58 : 0.48, dust ? 0.36 : 0.65)
      sizes.push(radius * (0.3 + random() * 0.7) * (1 - progress * 0.5))
    }
    group.add(this.particles(positions, colors, sizes, 0.16))
    return group
  }

  private stellarPosition(coordinates: [number, number, number]) {
    const position = new THREE.Vector3(
      coordinates[0],
      coordinates[2],
      -coordinates[1],
    )
    const distance = position.length()
    return distance > 0
      ? position.multiplyScalar(
          this.options.compressed
            ? (Math.log1p(distance) * 1.35) / distance
            : 0.045,
        )
      : position
  }

  private buildStellarMap() {
    this.fitRadius = 12
    this.orbitPerspective = true
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = [],
      ids: string[] = []
    const color = new THREE.Color()
    for (const row of extendedData.stars) {
      if (row[3] === null || row[4] === null || row[5] === null) continue
      const position = this.stellarPosition([row[3], row[4], row[5]])
      positions.push(position.x, position.y, position.z)
      color.set(stellarColor(row[7])).multiplyScalar(0.6)
      colors.push(color.r, color.g, color.b)
      sizes.push(row[6] !== null && row[6] < 3 ? 0.09 : 0.03)
      ids.push(starId(row))
    }
    for (const row of extendedData.exoplanets) {
      if (row[2] === null || row[3] === null || row[4] === null) continue
      const position = this.stellarPosition([row[2], row[3], row[4]])
      positions.push(position.x, position.y, position.z)
      colors.push(0.44, 0.84, 0.54)
      sizes.push(0.09)
      ids.push(exoplanetId(row))
    }
    const stars = this.particles(positions, colors, sizes, 0.85)
    stars.userData.pointIds = ids
    this.pointCount += ids.length
    this.content.add(stars)
    const sun = this.star(objectById.get('sun')!, 0.09)
    this.content.add(sun)
    this.mapNodes.set('solar-system', { node: sun, radius: 0.09 })
    this.addLabel('Solar System', 'solar-system', sun, 16)
    const named = extendedData.stars
      .filter(
        (row) =>
          row[8] !== null && row[8] < 35 && row[6] !== null && row[6] < 2.5,
      )
      .slice(0, 18)
    for (const row of named) {
      const anchor = new THREE.Object3D()
      anchor.position.copy(this.stellarPosition([row[3]!, row[4]!, row[5]!]))
      this.content.add(anchor)
      this.addLabel(row[1], starId(row), anchor, 10)
    }
    const grid = new THREE.PolarGridHelper(14, 12, 5, 120, '#49645b', '#2a3a35')
    const materials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material]
    materials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.13
      material.depthWrite = false
    })
    this.content.add(grid)
    this.orbitLines.push(grid)
  }

  private buildMinorBodyMap() {
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = [],
      ids: string[] = []
    const elements: OrbitalElements[] = []
    const date = new Date(this.timestamp)
    for (const row of extendedData.minorBodies) {
      const orbit = elementsFromRow(row)
      if (!orbit) continue
      const physical = smallBodyPosition(orbit, date)
      if (!physical.every(Number.isFinite)) continue
      const position = displayPosition(physical, this.options.compressed).map(
        (coordinate) => coordinate * (this.options.compressed ? 1 : 0.42),
      )
      positions.push(...position)
      const comet = row[2] === 'c'
      colors.push(comet ? 0.25 : 0.51, comet ? 0.62 : 0.43, comet ? 0.58 : 0.31)
      sizes.push(comet ? 0.052 : 0.022)
      ids.push(minorBodyId(row))
      elements.push(orbit)
    }
    const points = this.particles(positions, colors, sizes, 0.55)
    points.userData.pointIds = ids
    this.content.add(points)
    this.pointCount += ids.length
    this.minorCloud = { points, elements }
    this.lastMinorUpdate = this.timestamp
    for (const row of extendedData.minorBodies.filter(
      (row) => minorBodyKind(row) === 'dwarf-planet',
    )) {
      const object = objectById.get(minorBodyId(row))!
      if (!object.elements) continue
      const position = getPosition(object, date)
      if (!position.every(Number.isFinite)) continue
      const node = this.planet(object, 0.065)
      const scale = this.options.compressed ? 1 : 0.42
      node.position
        .fromArray(displayPosition(position, this.options.compressed))
        .multiplyScalar(scale)
      this.content.add(node)
      this.entries.push({
        node,
        object,
        scale,
        compressed: this.options.compressed,
      })
      this.mapNodes.set(object.id, { node, radius: 0.065 })
      this.addLabel(
        object.name.replace(/^\d+\s+/, '').replace(/\s*\(.+\)/, ''),
        object.id,
        node,
        12,
      )
    }
  }

  private ensureMapDestination(object: CelestialObject) {
    if (this.mapNodes.has(object.id) || object.id === this.mapContext) return
    let position: THREE.Vector3 | null = null
    if (this.mapContext === 'solar-system' && object.elements) {
      const physical = getPosition(object, new Date(this.timestamp))
      if (physical.every(Number.isFinite))
        position = new THREE.Vector3(
          ...displayPosition(physical, this.options.compressed),
        ).multiplyScalar(this.options.compressed ? 1 : 0.42)
    } else if (this.mapContext === 'nearby-stars') {
      const fallback = extendedData.stars.find(
        (row) => row[1] === object.name.replace(/ A$/, ''),
      )
      const coordinates =
        object.galacticPosition ??
        (fallback &&
        fallback[3] !== null &&
        fallback[4] !== null &&
        fallback[5] !== null
          ? ([fallback[3], fallback[4], fallback[5]] as [
              number,
              number,
              number,
            ])
          : null)
      if (coordinates) position = this.stellarPosition(coordinates)
    }
    if (!position) return
    if (this.activeDetail) {
      const previous = this.activeDetail
      const removed = new Set<THREE.Object3D>()
      previous.node.traverse((node) => removed.add(node))
      this.rotating = this.rotating.filter(({ node }) => !removed.has(node))
      this.labels = this.labels.filter((label) => {
        if (removed.has(label.anchor)) {
          label.element.remove()
          return false
        }
        return true
      })
      this.entries = this.entries.filter(
        (entry) => entry.node !== previous.node,
      )
      this.mapNodes.delete(previous.id)
      previous.node.removeFromParent()
      disposeGroup(previous.node)
      if (previous.orbit) {
        previous.orbit.removeFromParent()
        disposeGroup(previous.orbit)
        this.orbitLines = this.orbitLines.filter(
          (line) => line !== previous.orbit,
        )
      }
    }
    const radius =
      object.kind === 'comet'
        ? 0.045
        : this.mapContext === 'nearby-stars'
          ? 0.06
          : 0.07
    const node =
      object.kind === 'star'
        ? this.star(object, radius)
        : object.kind === 'comet'
          ? this.comet(object, radius)
          : this.planet(object, radius, true)
    node.position.copy(position)
    this.content.add(node)
    this.mapNodes.set(object.id, {
      node,
      radius: object.kind === 'comet' ? radius * 5 : radius,
    })
    this.addLabel(object.name, object.id, node, 16)
    let orbit: THREE.Object3D | undefined
    if (object.elements) {
      const scale = this.options.compressed ? 1 : 0.42
      this.entries.push({
        node,
        object,
        scale,
        compressed: this.options.compressed,
      })
      const path = sampleOrbit(object, new Date(this.timestamp), 300)
        .filter((point) => point.every(Number.isFinite))
        .map((point) =>
          new THREE.Vector3(
            ...displayPosition(point, this.options.compressed),
          ).multiplyScalar(scale),
        )
      orbit = this.line(path, object.color, 0.5)
      orbit.visible = this.options.orbits
      this.content.add(orbit)
      if (object.kind === 'comet')
        node.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          node.position.clone().normalize(),
        )
    }
    this.activeDetail = { id: object.id, node, orbit }
  }

  private buildSky() {
    this.starfield.visible = false
    this.skyLayer = new THREE.Group()
    this.content.add(this.skyLayer)
    this.lastSkyTime = -Infinity
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(
        95,
        64,
        32,
        0,
        Math.PI * 2,
        Math.PI / 2,
        Math.PI / 2,
      ),
      new THREE.MeshBasicMaterial({ color: '#0c1617', side: THREE.BackSide }),
    )
    this.content.add(ground)
    const horizon = Array.from({ length: 181 }, (_, index) =>
      new THREE.Vector3(...horizontalDirection(index * 2, 0)).multiplyScalar(
        90,
      ),
    )
    this.content.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(horizon),
        new THREE.LineBasicMaterial({
          color: '#65888a',
          transparent: true,
          opacity: 0.5,
        }),
      ),
    )
    for (const [name, azimuth] of [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ] as const) {
      const marker = new THREE.Object3D()
      marker.position
        .fromArray(horizontalDirection(azimuth, 2))
        .multiplyScalar(85)
      this.content.add(marker)
      this.addLabel(name, '', marker, 0)
    }
    this.updateSky()
  }

  private updateSky() {
    if (!this.skyLayer) return
    const layer = this.skyLayer
    const descendants = new Set<THREE.Object3D>()
    layer.traverse((node) => descendants.add(node))
    this.labels = this.labels.filter((label) => {
      if (!descendants.has(label.anchor)) return true
      label.element.remove()
      return false
    })
    disposeGroup(layer)
    layer.clear()
    const site = this.options.observer ?? defaultObserver
    const date = new Date(this.timestamp)
    const sun = observerBody(Body.Sun, date, site)
    const stars = observerStars(extendedData.stars, date, site).filter(
      (star) => star.altitude >= 0,
    )
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    const constellationCenters = new Map<string, THREE.Vector3>()
    const obscuration = solarObscuration(date, site)
    const daylight =
      THREE.MathUtils.smoothstep(sun.altitude, -12, 0) *
      Math.pow(1 - obscuration, 0.2)
    this.renderer.setClearColor(
      new THREE.Color('#05080d').lerp(new THREE.Color('#477b9c'), daylight),
    )
    for (const star of stars) {
      positions.push(...star.direction.map((value) => value * 85))
      const color = new THREE.Color(stellarColor(star.spectrum))
      colors.push(color.r, color.g, color.b)
      sizes.push(Math.max(0.32, 2 - star.magnitude * 0.2))
      if (!constellationCenters.has(star.constellation))
        constellationCenters.set(
          star.constellation,
          new THREE.Vector3(...star.direction),
        )
    }
    layer.add(this.particles(positions, colors, sizes, 0.95 * (1 - daylight)))
    if (site.constellations && daylight < 0.7) {
      for (const [name, direction] of [...constellationCenters].slice(0, 35)) {
        const anchor = new THREE.Object3D()
        anchor.position.copy(direction).multiplyScalar(84)
        layer.add(anchor)
        this.addLabel(name, '', anchor, 0)
      }
    }
    const bodies = [
      Body.Sun,
      Body.Moon,
      Body.Mercury,
      Body.Venus,
      Body.Mars,
      Body.Jupiter,
      Body.Saturn,
      Body.Uranus,
      Body.Neptune,
    ]
    const states = bodies.map((body) => observerBody(body, date, site))
    const shadow = earthShadow(date, site)
    for (const state of states) {
      if (state.altitude < -1) continue
      const disk =
        state.body === Body.Sun ||
        state.body === Body.Moon ||
        Boolean(this.options.skyFocus)
      const skyDistance =
        state.body === Body.Sun
          ? 80
          : state.distanceAu < sun.distanceAu
            ? 79
            : 81
      const radiusKm =
        state.body === Body.Sun
          ? 695700
          : state.body === Body.Moon
            ? 1737.4
            : (objectById.get(state.body.toLowerCase())?.radiusKm ?? 1)
      const radius = disk
        ? (skyDistance * radiusKm) / (state.distanceAu * 149597870.7)
        : 0.14
      const nearSun =
        state.body !== Body.Sun &&
        state.distanceAu < sun.distanceAu &&
        new THREE.Vector3(...state.direction).dot(
          new THREE.Vector3(...sun.direction),
        ) > 0.995
      const material =
        state.body === Body.Moon && !nearSun
          ? new THREE.ShaderMaterial({
              uniforms: {
                uMap: { value: this.texture('/textures/moon.jpg') },
                uShadowDirection: {
                  value: new THREE.Vector3(
                    ...(shadow?.direction ?? [0, -1, 0]),
                  ),
                },
                uUmbra: { value: shadow?.umbraRadians ?? 0 },
                uPenumbra: { value: shadow?.penumbraRadians ?? 0 },
                uSun: {
                  value: new THREE.Vector3(...sun.direction)
                    .multiplyScalar(sun.distanceAu)
                    .sub(
                      new THREE.Vector3(...state.direction).multiplyScalar(
                        state.distanceAu,
                      ),
                    )
                    .normalize(),
                },
              },
              vertexShader:
                'varying vec2 vUv; varying vec3 vDirection,vNormal; void main(){ vUv=uv; vec4 world=modelMatrix*vec4(position,1.0); vDirection=world.xyz; vNormal=mat3(modelMatrix)*normal; gl_Position=projectionMatrix*viewMatrix*world; }',
              fragmentShader: `uniform sampler2D uMap; uniform vec3 uShadowDirection,uSun; uniform float uUmbra,uPenumbra; varying vec2 vUv; varying vec3 vDirection,vNormal; void main(){float angle=acos(clamp(dot(normalize(vDirection),normalize(uShadowDirection)),-1.0,1.0)); float umbra=uUmbra>0.0?1.0-smoothstep(uUmbra-0.0001,uUmbra+0.0001,angle):0.0; float penumbra=uPenumbra>0.0?1.0-smoothstep(uUmbra,uPenumbra,angle):0.0; vec3 light=texture2D(uMap,vUv).rgb*(0.03+max(0.0,dot(normalize(vNormal),uSun))); light*=mix(vec3(1.0),vec3(0.3,0.065,0.035),umbra); light*=1.0-penumbra*0.3; gl_FragColor=vec4(light,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
            })
          : new THREE.MeshBasicMaterial({
              color: nearSun
                ? '#000000'
                : state.body === Body.Sun
                  ? '#fff1c4'
                  : '#dbcea2',
              map:
                state.body === Body.Sun
                  ? this.texture('/textures/sun.jpg')
                  : null,
            })
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 24),
        material,
      )
      body.position.fromArray(state.direction).multiplyScalar(skyDistance)
      layer.add(body)
      if (state.body === Body.Sun && obscuration > 0.95) {
        const corona = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 6, radius * 6),
          new THREE.ShaderMaterial({
            uniforms: {
              uVisibility: {
                value: THREE.MathUtils.smoothstep(obscuration, 0.95, 1),
              },
            },
            vertexShader:
              'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
            fragmentShader:
              'uniform float uVisibility; varying vec2 vUv; void main(){float radius=length(vUv-0.5)*6.0; float glow=exp(-max(0.0,radius-1.0)*3.0)*smoothstep(0.98,1.05,radius);gl_FragColor=vec4(0.75,0.82,0.88,glow*uVisibility*0.5);}',
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        )
        corona.position.copy(body.position)
        corona.lookAt(this.camera.position)
        layer.add(corona)
      }
      this.addLabel(state.body, state.body.toLowerCase(), body, 12)
    }
    this.renderer.domElement.dataset.skyBodies = JSON.stringify(
      states.map(({ body, altitude, azimuth }) => ({
        body,
        altitude,
        azimuth,
      })),
    )
    this.renderer.domElement.dataset.skyStars = String(stars.length)
    this.renderer.domElement.dataset.skySite = `${site.latitude},${site.longitude}`
    this.renderer.domElement.dataset.solarObscuration = String(obscuration)
    this.renderer.domElement.dataset.lunarUmbra = String(shadow?.umbraRadians ?? 0)
    this.renderer.domElement.dataset.skyFocus = this.options.skyFocus ?? ''
    this.renderer.domElement.dataset.skyAngularRadii = JSON.stringify(
      states.map((state) => ({
        body: state.body,
        radians:
          (state.body === Body.Sun
            ? 695700
            : state.body === Body.Moon
              ? 1737.4
              : (objectById.get(state.body.toLowerCase())?.radiusKm ?? 1)) /
          (state.distanceAu * 149597870.7),
      })),
    )
    this.lastSkyTime = this.timestamp
  }

  private buildComparison() {
    const objects = (this.options.comparison ?? ['earth', 'jupiter', 'sun'])
      .map((id) => objectById.get(id))
      .filter((object): object is CelestialObject => Boolean(object))
    const layout = comparisonLayout(objects)
    this.fitRadius = Math.max(
      3,
      ...layout.map((item) => Math.abs(item.center) + item.radius),
    )
    for (const item of layout) {
      const object = objectById.get(item.id)!
      const body = object.blackHole
        ? new THREE.Mesh(
            new THREE.SphereGeometry(item.radius, 64, 40),
            new THREE.MeshBasicMaterial({ color: '#020405' }),
          )
        : object.kind === 'star' || object.kind === 'white-dwarf'
          ? this.star(object, item.radius)
          : this.planet(object, item.radius, true)
      body.position.set(item.center, item.radius - 2, 0)
      this.content.add(body)
      const anchor = new THREE.Object3D()
      anchor.position.set(item.center, -2.25, 0)
      this.content.add(anchor)
      this.addLabel(object.name, object.id, anchor, 0)
    }
    this.renderer.domElement.dataset.comparisonRadii = JSON.stringify(
      layout.map(({ id, radius, radiusKm }) => ({ id, radius, radiusKm })),
    )
  }

  private buildEarthMoon() {
    const unit = 6 / 384400
    const moonObject = objectById.get('moon')!
    const earthModel = this.planet(earth, earth.radiusKm! * unit, true)
    const moonModel = this.planet(
      moonObject,
      moonObject.radiusKm! * unit,
      true,
    )
    this.content.add(earthModel, moonModel)
    this.addLabel('Earth', 'earth', earthModel, 12)
    this.addLabel('The Moon', 'moon', moonModel, 12)
    this.earthMoonPair = { earth: earthModel, moon: moonModel, unit }
    this.fitRadius = 4.3
    this.updateEarthMoon()
    this.renderer.domElement.dataset.systemRepresentation =
      'earth-moon-physical-scale'
    this.renderer.domElement.dataset.earthMoonRadii = JSON.stringify([
      earth.radiusKm,
      moonObject.radiusKm,
    ])
  }

  private updateEarthMoon() {
    if (!this.earthMoonPair) return
    const { earth: earthModel, moon, unit } = this.earthMoonPair
    const displacement = new THREE.Vector3(
      ...getPosition(objectById.get('moon')!, new Date(this.timestamp)),
    ).multiplyScalar(KM_PER_PARSEC / AU_PER_PARSEC)
    this.renderer.domElement.dataset.earthMoonDistanceKm = String(
      displacement.length(),
    )
    earthModel.position.copy(displacement).multiplyScalar(-unit * 0.5)
    moon.position.copy(displacement).multiplyScalar(unit * 0.5)
  }

  private buildProxima(object: CelestialObject, single: boolean) {
    const host = objectById.get('proxima')!
    const planets = single
      ? [object]
      : object
          .members!.map((id) => objectById.get(id)!)
          .filter(
            (member) =>
              member.planetaryHost &&
              (member.id !== 'proxima-c' || this.options.showCandidates),
          )
    const maximum = Math.max(
      0.075,
      ...planets.map((planet) => planet.orbit.semiMajorAxis!),
    )
    const compressed = this.options.compressed && maximum > 0.1
    const scaledRadius = (axis: number) =>
      6 * (compressed ? Math.sqrt(axis / maximum) : axis / maximum)
    const star = this.star(host, 0.48)
    this.content.add(star)
    this.addLabel(host.name, host.id, star, 12)
    this.fitRadius = 7.8
    this.orbitPerspective = true
    const zone = new THREE.Mesh(
      new THREE.RingGeometry(scaledRadius(0.038), scaledRadius(0.075), 100),
      new THREE.MeshBasicMaterial({
        color: '#8fae92',
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    zone.rotation.x = -Math.PI / 2
    zone.userData.spectralAnnotation = true
    this.content.add(zone)
    for (const planet of planets) {
      const scale =
        scaledRadius(planet.orbit.semiMajorAxis!) /
        planet.orbit.semiMajorAxis!
      const body = this.planet(
        planet,
        planet.id === 'proxima-c' ? 0.2 : 0.14,
        true,
      )
      body.position
        .fromArray(getPosition(planet, new Date(this.timestamp)))
        .multiplyScalar(scale)
      this.content.add(body)
      this.entries.push({
        node: body,
        object: planet,
        scale,
        compressed: false,
      })
      this.addLabel(planet.name, planet.id, body, 12)
      const path = sampleOrbit(planet, new Date(this.timestamp), 180).map(
        (point) => new THREE.Vector3(...point).multiplyScalar(scale),
      )
      this.content.add(
        this.line(
          path,
          planet.id === 'proxima-c' ? '#b7a193' : '#9ac7c1',
          planet.id === 'proxima-c' ? 0.2 : 0.4,
        ),
      )
    }
    this.renderer.domElement.dataset.systemRepresentation =
      'proxima-host-relative-kepler-illustration'
    this.renderer.domElement.dataset.systemMembers = [
      'proxima',
      ...planets.map((planet) => planet.id),
    ].join(',')
    this.renderer.domElement.dataset.systemSpacing = compressed
      ? 'compressed'
      : 'linear'
  }

  private buildSystem(object: CelestialObject, single: boolean) {
    if (object.visualization === 'earth-moon') {
      this.buildEarthMoon()
      return
    }
    if (object.visualization === 'proxima-system' || object.planetaryHost) {
      this.buildProxima(object, single)
      return
    }
    const isMoon = object.kind === 'moon'
    const primary = isMoon
      ? objectById.get(object.parent ?? 'earth')!
      : objectById.get('sun')!
    const central = isMoon
      ? this.planet(primary, 0.52, true)
      : this.star(
          primary,
          single ? 0.35 : this.options.compressed ? 0.46 : 0.14,
        )
    this.content.add(central)
    this.mapNodes.set(primary.id, {
      node: central,
      radius: single ? 0.35 : 0.46,
    })
    this.addLabel(primary.name, primary.id, central, 20)
    const bodies = single ? [object] : solarPlanets
    this.fitRadius = object.trajectory ? 5 : single ? 7.8 : 14.2
    this.orbitPerspective = true
    const date = new Date(this.timestamp)
    bodies.forEach((planet) => {
      const scale = single
        ? 6 /
          Math.max(
            isMoon ? 1e-9 : 0.001,
            planet.trajectory
              ? Math.max(
                  ...sampleOrbit(planet, date).map((point) =>
                    Math.hypot(...point),
                  ),
                )
              : Math.abs(
                  planet.orbit.semiMajorAxis ??
                    planet.elements?.perihelionDistance ??
                    1,
                ),
          )
        : this.options.compressed
          ? 1
          : 0.42
      const compressed = !single && this.options.compressed
      const radius = single
        ? planet.trajectory
          ? 0.45
          : 0.24
        : ['jupiter', 'saturn'].includes(planet.id)
          ? 0.23
          : 0.11
      const model =
        planet.kind === 'spacecraft'
          ? this.spacecraft(planet, radius)
          : planet.kind === 'comet'
            ? this.comet(planet, radius * 0.25)
            : this.planet(planet, radius, true)
      this.mapNodes.set(planet.id, { node: model, radius })
      const position = displayPosition(getPosition(planet, date), compressed)
      model.position.fromArray(position).multiplyScalar(scale)
      this.content.add(model)
      this.entries.push({ node: model, object: planet, scale, compressed })
      this.addLabel(planet.name, planet.id, model, 15)
      const points = sampleOrbit(planet, date, 220).map((point) =>
        new THREE.Vector3(
          ...displayPosition(point, compressed),
        ).multiplyScalar(scale),
      )
      this.content.add(
        this.line(
          points,
          planet.id === object.id || planet.id === 'earth'
            ? '#c9e9a4'
            : '#859496',
          single ? 0.58 : 0.28,
        ),
      )
    })
    if (!single && this.view === 'map') {
      const earthNode = this.mapNodes.get('earth')!.node
      const moonObject = objectById.get('moon')!
      const moon = this.planet(moonObject, 0.03)
      moon.position
        .fromArray(getPosition(moonObject, date))
        .multiplyScalar(160)
        .add(earthNode.position)
      this.content.add(moon)
      this.mapNodes.set('moon', { node: moon, radius: 0.03 })
      this.entries.push({
        node: moon,
        object: moonObject,
        scale: 160,
        compressed: false,
        parent: earthNode,
      })
      this.addLabel('The Moon', 'moon', moon, 11)
      this.buildMinorBodyMap()
    }
  }

  private blackHoleMaterial(color: string, activeNucleus = false) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uDiskNormal: {
          value: new THREE.Vector3(
            0,
            0.997,
            activeNucleus ? 0.48 : 0.075,
          ).normalize(),
        },
        uActiveNucleus: { value: activeNucleus ? 1 : 0 },
        uTonPalette: { value: 0 },
        uAccreting: { value: 1 },
        uSpaceInverse: { value: new THREE.Matrix4() },
      },
      defines: { RAY_STEPS: this.options.highQuality ? 120 : 88 },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime, uActiveNucleus, uAccreting, uTonPalette;
        uniform vec3 uColor, uDiskNormal;
        uniform mat4 uSpaceInverse;
        varying vec3 vWorld;
        const float horizon = 0.45;
        const float innerDisk = 1.4;
        const float outerDisk = 4.65;
        float hash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123); }
        float noise(vec2 point) {
          vec2 cell = floor(point), local = fract(point);
          local = local * local * (3.0 - 2.0 * local);
          return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x), mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), local.x), local.y);
        }
        float turbulence(vec2 point) {
          float total = 0.0, amplitude = 0.5;
          for (int octave = 0; octave < 5; octave++) { total += noise(point) * amplitude; point = point * 2.03 + 17.2; amplitude *= 0.5; }
          return total;
        }
        vec4 diskEmission(vec3 hit, vec3 sight) {
          float radius = length(hit);
          float progress = clamp((radius - innerDisk) / (outerDisk - innerDisk), 0.0, 1.0);
          vec3 tangent = normalize(cross(uDiskNormal, hit));
          vec3 axis = normalize(cross(uDiskNormal, vec3(1.0, 0.0, 0.0)));
          float angle = atan(dot(hit, axis), hit.x);
          float phase = angle - uTime * 2.4 / pow(radius, 1.5);
          vec2 flowCoordinates = vec2(cos(phase), sin(phase)) * radius;
          float flow = turbulence(flowCoordinates * vec2(7.0, 7.0) + radius * 1.2);
          float wisps = turbulence(vec2(radius * 32.0, sin(phase * 3.0) * 3.0 + uTime * 0.08));
          float fibers = 0.94 + 0.06 * sin(radius * 65.0 + flow * 17.0 + wisps * 4.0);
          float temperature = pow(innerDisk / radius, 0.75);
          vec3 cool = mix(vec3(0.72, 0.19, 0.045), uColor * vec3(0.65, 0.26, 0.09), 0.35);
          cool = mix(cool, vec3(0.36, 0.09, 0.27), uActiveNucleus * 0.55);
          cool = mix(cool, vec3(0.75, 0.21, 0.055), uTonPalette);
          vec3 warm = mix(vec3(1.0, 0.6, 0.22), vec3(1.0, 0.7, 0.4), uTonPalette);
          vec3 hot = mix(vec3(1.0, 0.94, 0.78), vec3(0.64, 0.83, 1.0), uTonPalette);
          vec3 emission = mix(cool, warm, smoothstep(0.38, 0.72, temperature));
          emission = mix(emission, hot, smoothstep(0.72, 1.0, temperature));
          float velocity = sqrt(horizon / (2.0 * max(radius - horizon, 0.1)));
          float shift = sqrt(1.0 - horizon / radius) * sqrt(1.0 - velocity * velocity) / (1.0 - dot(tangent * velocity, -normalize(sight)));
          float beaming = clamp(pow(shift, 3.0), 0.12, 3.8);
          float edge = smoothstep(innerDisk, innerDisk + 0.08, radius) * (1.0 - smoothstep(0.55, 1.0, progress));
          float density = (0.22 + flow * 1.05 + wisps * 0.42) * fibers;
          float spiral = pow(0.5 + 0.5 * sin(phase * 3.0 + log(radius) * 12.0), 6.0);
          float hotspotAngle = atan(sin(angle - uTime * 1.25), cos(angle - uTime * 1.25));
          float hotspot = exp(-pow(hotspotAngle / 0.25, 2.0) - pow((radius - 1.85) / 0.2, 2.0));
          float brightness = (0.7 + 2.8 * pow(temperature, 3.0)) * (density + spiral * 0.15 + hotspot * 0.85) * beaming;
          return vec4(emission * brightness, edge * (0.73 + flow * 0.24));
        }
        vec3 bending(vec3 position, float angularMomentum) {
          float radiusSquared = max(dot(position, position), 0.035);
          return -1.5 * horizon * angularMomentum * position / pow(radiusSquared, 2.5);
        }
        void main() {
          vec3 observer = (uSpaceInverse * vec4(cameraPosition, 1.0)).xyz;
          vec3 destination = (uSpaceInverse * vec4(vWorld, 1.0)).xyz;
          vec3 direction = normalize(destination - observer);
          float projected = dot(observer, direction);
          float discriminant = projected * projected - dot(observer, observer) + 30.25;
          if (discriminant < 0.0) discard;
          float entry = max(0.0, -projected - sqrt(discriminant));
          vec3 position = observer + direction * (entry + 0.001);
          vec3 angularVector = cross(position, direction);
          float angularMomentum = dot(angularVector, angularVector);
          vec3 radiance = vec3(0.0);
          float transmission = 1.0;
          bool captured = false;
          for (int stepIndex = 0; stepIndex < RAY_STEPS; stepIndex++) {
            float radius = length(position);
            if (radius < horizon * 1.025) { captured = true; break; }
            if (radius > 5.65) break;
            float stepSize = clamp(radius * 0.065, 0.018, 0.34);
            vec3 acceleration = bending(position, angularMomentum);
            vec3 nextPosition = position + direction * stepSize + acceleration * stepSize * stepSize * 0.5;
            vec3 nextDirection = direction + (acceleration + bending(nextPosition, angularMomentum)) * stepSize * 0.5;
            float previousHeight = dot(position, uDiskNormal);
            float nextHeight = dot(nextPosition, uDiskNormal);
            if (uAccreting > 0.5 && previousHeight * nextHeight < 0.0) {
              float fraction = previousHeight / (previousHeight - nextHeight);
              vec3 hit = mix(position, nextPosition, fraction);
              float hitRadius = length(hit);
              if (hitRadius > innerDisk && hitRadius < outerDisk) {
                vec4 emission = diskEmission(hit, mix(direction, nextDirection, fraction));
                radiance += emission.rgb * emission.a * transmission;
                transmission *= 1.0 - emission.a;
              }
            }
            position = nextPosition;
            direction = nextDirection;
            if (transmission < 0.025) break;
          }
          float impact = sqrt(angularMomentum);
          float critical = horizon * 2.598076;
          float photonWidth = max(fwidth(impact) * 1.25, 0.016);
          float photonGlow = exp(-pow((impact - critical) / photonWidth, 2.0));
          radiance += mix(vec3(0.55, 0.66, 0.8), vec3(1.0, 0.72, 0.39), uAccreting) * photonGlow * 0.025;
          float backgroundAlpha = 0.0;
          if (uAccreting < 0.5 && !captured) {
            vec3 sight = normalize(direction);
            vec2 sky = vec2(atan(sight.z, sight.x) / 6.283185 + 0.5, asin(clamp(sight.y, -1.0, 1.0)) / 3.141593 + 0.5) * vec2(240.0, 120.0);
            vec2 cell = floor(sky);
            vec2 offset = fract(sky) - vec2(0.2 + hash(cell + 9.0) * 0.6, 0.2 + hash(cell + 17.0) * 0.6);
            float width = max(0.08, length(fwidth(sky)) * 0.45);
            float starlight = exp(-dot(offset, offset) / (width * width)) * smoothstep(0.89, 0.99, hash(cell));
            radiance += mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.86, 0.66), hash(cell + 23.0)) * starlight;
            backgroundAlpha = starlight;
          }
          float alpha = captured ? 1.0 : max(max(1.0 - transmission, photonGlow * 0.06), backgroundAlpha);
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(radiance / max(alpha, 0.001), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    })
    this.shaders.push(material)
    return material
  }

  private beam(color: string, height: number, radius: number) {
    const geometry = new THREE.ConeGeometry(radius, height, 40, 1, true)
    geometry.rotateZ(Math.PI)
    geometry.translate(0, height / 2, 0)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uHeight: { value: height },
        uTime: { value: 0 },
        uStrength: { value: 0.25 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime, uStrength;
        varying vec2 vUv;
        void main() {
          float progress = 1.0 - vUv.y;
          float knots = pow(0.5 + 0.5 * sin(progress * 34.0 - uTime * 5.0), 5.0);
          float fade = pow(vUv.y, 1.5) * uStrength * (0.6 + knots * 0.9);
          gl_FragColor = vec4(uColor * (1.2 + knots), fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const group = new THREE.Group()
    group.name = 'pulsing-polar-jet'
    group.userData.emissionComponent = 'nonthermal'
    this.shaders.push(material)
    group.add(new THREE.Mesh(geometry, material))
    const coreMaterial = material.clone()
    coreMaterial.uniforms.uStrength.value = 0.75
    this.shaders.push(coreMaterial)
    const core = new THREE.Mesh(geometry.clone(), coreMaterial)
    core.scale.set(0.1, 1, 0.1)
    group.add(core)
    return group
  }

  private buildBlackHole(object: CelestialObject) {
    const accreting = object.blackHole?.accreting !== false
    this.fitRadius = !accreting ? 1.65 : object.kind === 'quasar' ? 5.1 : 4.85
    const group = new THREE.Group()
    group.name = 'black-hole-lensing'
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      this.blackHoleMaterial(object.color, object.kind === 'quasar'),
    )
    image.material.uniforms.uAccreting.value = accreting ? 1 : 0
    image.material.uniforms.uTonPalette.value = object.id === 'ton618' ? 1 : 0
    if (this.selected.id === object.id && object.id === 'ton618')
      this.renderer.domElement.dataset.quasarAppearance = 'cool-core-warm-disk'
    image.name = accreting
      ? 'ray-bent-accretion-disk'
      : 'dormant-black-hole-shadow'
    if (this.selected.id === object.id)
      this.renderer.domElement.dataset.blackHoleState = accreting
        ? 'accreting'
        : 'dormant'
    image.onBeforeRender = () => {
      image.material.uniforms.uSpaceInverse.value
        .copy(group.matrixWorld)
        .invert()
    }
    image.userData.objectId = object.id
    image.renderOrder = 3
    group.add(image)
    this.billboards.push(image)
    if (
      accreting &&
      (object.kind === 'quasar' ||
        object.id === 'm87-black-hole' ||
        object.blackHole?.jets)
    ) {
      const jets = new THREE.Group()
      jets.add(this.beam('#b1dfff', 7, 0.55))
      const opposite = this.beam('#b1dfff', 7, 0.55)
      opposite.rotation.z = Math.PI
      jets.add(opposite)
      jets.rotation.x =
        object.kind === 'quasar' ? Math.atan2(0.48, 0.997) : 0.075
      group.add(jets)
    }
    this.content.add(group)
  }

  private roguePlanet(object: CelestialObject, radius: number) {
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(object.color) } },
      vertexShader: `
        varying vec3 vPosition, vNormal, vSight;
        void main() {
          vPosition = normalize(position);
          vNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vSight = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vPosition, vNormal, vSight;
        float hash(vec3 point) { return fract(sin(dot(point, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 point) {
          vec3 cell = floor(point), local = fract(point);
          local = local * local * (3.0 - 2.0 * local);
          return mix(mix(mix(hash(cell), hash(cell + vec3(1,0,0)), local.x), mix(hash(cell + vec3(0,1,0)), hash(cell + vec3(1,1,0)), local.x), local.y), mix(mix(hash(cell + vec3(0,0,1)), hash(cell + vec3(1,0,1)), local.x), mix(hash(cell + vec3(0,1,1)), hash(cell + vec3(1,1,1)), local.x), local.y), local.z);
        }
        void main() {
          vec3 point = normalize(vPosition);
          float broad = noise(point * 6.0);
          float clouds = noise(point * 23.0 + broad * 3.0) * 0.65 + noise(point * 65.0) * 0.35;
          float bands = sin(point.y * 55.0 + broad * 8.0 + clouds * 2.5) * 0.5 + 0.5;
          vec3 shade = mix(uColor * 0.3, mix(uColor, vec3(0.65, 0.55, 0.47), 0.2), bands * 0.7 + clouds * 0.3);
          float limb = pow(max(dot(normalize(vNormal), normalize(vSight)), 0.0), 0.45);
          gl_FragColor = vec4(shade * (0.25 + limb * 0.75), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 80, 56),
      material,
    )
    sphere.userData.objectId = object.id
    const group = new THREE.Group()
    group.add(sphere)
    return group
  }

  private buildNebula(object: CelestialObject) {
    if (object.model?.format === 'particles') return this.buildPillars(object)
    this.fitRadius = 4.5
    const random = seededRandom(hashId(object.id))
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const primary = new THREE.Color(object.color)
    const secondary = new THREE.Color(
      object.id === 'carina' ? '#88bfc9' : '#759ed2',
    )
    const color = new THREE.Color()
    const shell =
      object.scene === 'supernova' ||
      object.id === 'helix' ||
      object.morphology === 'shell'
    const bipolar = object.morphology === 'bipolar'
    const noise = new ImprovedNoise()
    for (let index = 0; index < 14500; index++) {
      const azimuth = random() * Math.PI * 2
      const vertical = random() * 2 - 1
      const radial = shell
        ? 1.7 + Math.pow(random(), 3) * 1.3
        : Math.pow(random(), 0.65) * 4
      const circular = Math.sqrt(1 - vertical * vertical)
      const wobble = 1 + Math.sin(azimuth * 5 + vertical * 8) * 0.22
      let horizontal = Math.cos(azimuth) * radial * circular * wobble
      let altitude = vertical * radial * (shell ? 0.78 : 0.55)
      let depth = Math.sin(azimuth) * radial * circular * 0.65
      if (bipolar) {
        const lobe = Math.abs(vertical)
        const width = 0.2 + Math.sin(lobe * Math.PI) * 1.4
        horizontal = Math.cos(azimuth) * width * (0.7 + random() * 0.3)
        altitude = vertical * 3.8
        depth = Math.sin(azimuth) * width * 0.65
      }
      if (
        object.morphology === 'filaments' &&
        Math.abs(noise.noise(horizontal * 1.5, altitude * 1.5, depth * 1.5)) >
          0.095
      )
        continue
      positions.push(
        horizontal,
        altitude + (shell ? 0 : Math.sin(horizontal * 1.2) * 0.7),
        depth,
      )
      const mix = (Math.sin(horizontal * 0.85 + depth * 0.7) + 1) / 2
      color
        .copy(primary)
        .lerp(secondary, mix)
        .multiplyScalar(0.28 + random() * 0.45)
      if (object.id === 'sn1006')
        color.multiplyScalar(
          0.22 + Math.pow(Math.abs(horizontal) / 3.7, 2) * 1.6,
        )
      colors.push(color.r, color.g, color.b)
      sizes.push(
        object.morphology ? 0.075 + random() * 0.12 : 0.22 + random() * 0.47,
      )
    }
    const cloud = object.morphology
      ? this.volumeParticles(positions, colors, sizes, shell ? 0.085 : 0.045)
      : this.particles(positions, colors, sizes, shell ? 0.09 : 0.058)
    this.content.add(cloud)
    if (!object.morphology)
      this.rotating.push({ node: cloud, speed: 0.009, base: 0 })
    const starPositions: number[] = []
    const starColors: number[] = []
    const starSizes: number[] = []
    for (let index = 0; index < 240; index++) {
      starPositions.push(
        (random() - 0.5) * 9,
        (random() - 0.5) * 5,
        (random() - 0.5) * 3,
      )
      starColors.push(0.8, 0.86, 1)
      starSizes.push(0.025 + Math.pow(random(), 6) * 0.22)
    }
    this.content.add(this.particles(starPositions, starColors, starSizes, 0.85))
    if (object.id === 'crab') {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 20, 14),
        new THREE.MeshBasicMaterial({ color: '#e0faff' }),
      )
      core.userData.objectId = 'crab-pulsar'
      this.content.add(core)
      this.addLabel('Crab Pulsar', 'crab-pulsar', core)
    }
  }

  private volumeParticles(
    positions: number[],
    colors: number[],
    sizes: number[],
    opacity: number,
  ) {
    const cloud = this.particles(positions, colors, sizes, opacity)
    cloud.material.uniforms.uViewportHeight = { value: this.host.clientHeight }
    cloud.material.vertexShader = `
      attribute float aSize;
      varying vec3 vColor;
      varying float vVisibility;
      uniform float uPixelRatio, uViewportHeight;
      void main() {
        vColor = color;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float worldScale = length(modelMatrix[0].xyz);
        float size = aSize * worldScale * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(-viewPosition.z, 0.0001);
        vVisibility = pow(min(1.0, size / 1.2), 2.0) * smoothstep(0.0, aSize * worldScale, -viewPosition.z);
        gl_PointSize = clamp(size, 1.2, 90.0) * uPixelRatio;
        gl_Position = projectionMatrix * viewPosition;
      }
    `
    cloud.material.fragmentShader = `
      varying vec3 vColor;
      varying float vVisibility;
      uniform float uOpacity;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        if (radius > 1.0) discard;
        float glow = exp(-radius * radius * 5.0) * (1.0 - smoothstep(0.7, 1.0, radius));
        gl_FragColor = vec4(vColor, glow * uOpacity * vVisibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
    cloud.onBeforeRender = () => {
      cloud.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
      cloud.material.uniforms.uViewportHeight.value = this.host.clientHeight
    }
    return cloud
  }

  private buildPillars(object: CelestialObject) {
    this.fitRadius = 4.3
    const holder = new THREE.Group()
    holder.name = 'nasa-pillars-volume'
    holder.userData.modelState = 'loading'
    const fallback = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4),
      new THREE.MeshBasicMaterial({ color: object.color, wireframe: true }),
    )
    holder.add(fallback)
    this.content.add(holder)
    if (this.selected.id === object.id) {
      this.renderer.domElement.dataset.modelState = 'loading'
      this.renderer.domElement.dataset.modelObject = object.id
    }
    void this.loadModelData(object.model!.path)
      .then((buffer) => {
        if (this.disposed || holder.userData.disposed) return
        const data = JSON.parse(new TextDecoder().decode(buffer)) as {
          positions: number[]
          illumination: number[]
        }
        if (
          !Array.isArray(data.positions) ||
          !Array.isArray(data.illumination) ||
          data.positions.length !== data.illumination.length * 3 ||
          data.illumination.length < 1000 ||
          data.illumination.length > 100000 ||
          !data.positions.every(
            (value) => Number.isFinite(value) && Math.abs(value) <= 16,
          ) ||
          !data.illumination.every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 255,
          )
        )
          throw new Error('Invalid nebula model')
        const positions: number[] = [],
          colors: number[] = [],
          sizes: number[] = []
        const random = seededRandom(10748)
        const color = new THREE.Color()
        const shadow = new THREE.Color('#52666c')
        const lit = new THREE.Color('#dbba8c')
        const stride = this.options.highQuality ? 1 : 2
        for (let index = 0; index < data.illumination.length; index += stride) {
          positions.push(...data.positions.slice(index * 3, index * 3 + 3))
          color
            .copy(shadow)
            .lerp(lit, Math.pow(data.illumination[index] / 255, 1.4))
          colors.push(color.r, color.g, color.b)
          sizes.push(0.045 + random() * 0.08)
        }
        const cloud = this.volumeParticles(positions, colors, sizes, 0.62)
        cloud.material.blending = THREE.NormalBlending
        cloud.rotation.set(-0.15, -1.1, -0.12)
        fallback.removeFromParent()
        disposeGroup(fallback)
        holder.add(cloud)
        this.spectralAppearance.bind(holder, object)
        holder.userData.modelReady = true
        holder.userData.modelState = 'ready'
        holder.userData.modelParticles = sizes.length
        if (this.selected.id === object.id) {
          this.renderer.domElement.dataset.modelState = 'ready'
          this.renderer.domElement.dataset.modelObject = object.id
          this.renderer.domElement.dataset.modelParticles = String(sizes.length)
        }
      })
      .catch(() => {
        if (this.disposed || holder.userData.disposed) return
        this.modelData.delete(object.model!.path)
        holder.userData.modelState = 'failed'
        if (this.selected.id === object.id)
          this.renderer.domElement.dataset.modelState = 'failed'
        this.host.dispatchEvent(
          new CustomEvent('asset-error', {
            detail:
              'The NASA nebula geometry could not be loaded. Its catalog position remains available; a marker is shown instead.',
          }),
        )
      })
  }

  private buildPulsar(object: CelestialObject) {
    this.fitRadius = 3.25
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 64, 48),
      new THREE.MeshBasicMaterial({ color: '#d0e7f5' }),
    )
    core.userData.objectId = object.id
    this.content.add(core, this.atmosphere(0.62, '#9cd8ff', 0.75))
    const magnetic = new THREE.Group()
    const beams = new THREE.Group()
    beams.add(this.beam(object.color, 4.7, 0.7))
    const opposite = this.beam(object.color, 4.7, 0.7)
    opposite.rotation.z = Math.PI
    beams.add(opposite)
    beams.rotation.z = 0.45
    magnetic.add(beams)
    for (let index = 0; index < 8; index++) {
      const points = Array.from({ length: 129 }, (_, pointIndex) => {
        const angle = (pointIndex / 128) * Math.PI * 2
        const fieldRadius = 0.55 + Math.sin(angle) ** 2 * 1.3
        return new THREE.Vector3(
          Math.sin(angle) * fieldRadius,
          Math.cos(angle) * fieldRadius * 0.9,
          0,
        )
      })
      const field = this.line(points, object.color, 0.13)
      field.rotation.y = (index / 8) * Math.PI
      magnetic.add(field)
    }
    magnetic.rotation.z = -0.22
    this.content.add(magnetic)
    this.rotating.push({ node: magnetic, speed: 0.42, base: 0 })
  }

  private buildStarCluster(object: CelestialObject) {
    this.fitRadius = 4.8
    const random = seededRandom(hashId(object.id))
    const open = object.id === 'pleiades'
    const galactic = object.kind === 'galaxy'
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    const count = open ? 1000 : this.options.highQuality ? 38000 : 17000
    const color = new THREE.Color()
    for (let index = 0; index < count; index++) {
      const angle = random() * Math.PI * 2
      const altitude = random() * 2 - 1
      const radial = Math.min(
        4,
        0.48 / Math.sqrt(Math.pow(Math.max(random(), 0.001), -2 / 3) - 1),
      )
      const spread = Math.sqrt(1 - altitude * altitude)
      positions.push(
        Math.cos(angle) * radial * spread,
        altitude * radial * (galactic ? 0.65 : 1),
        Math.sin(angle) * radial * spread,
      )
      color.set(open ? '#b7d4ff' : random() > 0.88 ? '#e6a767' : '#f6e8d0')
      color.multiplyScalar(0.5 + random() * 0.7)
      colors.push(color.r, color.g, color.b)
      sizes.push(
        open
          ? 0.03 + Math.pow(random(), 6) * 0.25
          : 0.008 + Math.pow(random(), 4) * 0.05,
      )
    }
    this.content.add(this.particles(positions, colors, sizes, 0.8))
    const glow = this.particles(
      positions.filter((_, index) => Math.floor(index / 3) % 9 === 0),
      colors.filter((_, index) => Math.floor(index / 3) % 9 === 0),
      sizes
        .filter((_, index) => index % 9 === 0)
        .map(() => (open ? 0.5 : 0.16)),
      open ? 0.11 : 0.025,
    )
    this.content.add(glow)
  }

  private galaxyParticles(
    positions: number[],
    colors: number[],
    sizes: number[],
    opacity: number,
    diffuse = false,
    referenceOnly = false,
  ) {
    const points = this.particles(positions, colors, sizes, opacity)
    points.userData.emissionComponent = diffuse ? 'dust' : 'photosphere'
    const referenceColors: number[] = []
    const referenceSizes: number[] = []
    const accents: number[] = []
    const referenceRandom = seededRandom(diffuse ? 9127 : 9126)
    const accentRandom = seededRandom(19083)
    const neutral = new THREE.Color('#cdd7e5')
    const golden = new THREE.Color('#edca81')
    const amber = new THREE.Color('#d3a27a')
    const blue = new THREE.Color('#7eacd1')
    const stellarColor = new THREE.Color()
    for (let index = 0; index < sizes.length; index++) {
      const offset = index * 3
      const radial = Math.hypot(positions[offset], positions[offset + 2])
      const bulge = Math.exp(-radial * radial * 0.45)
      const population = referenceRandom()
      if (diffuse) stellarColor.copy(blue).lerp(golden, bulge * 0.95)
      else
        stellarColor.copy(
          population < 0.06
            ? amber
            : population < 0.12 + bulge * 0.58
              ? golden
              : population < 0.6
                ? neutral
                : blue,
        )
      stellarColor.multiplyScalar(
        Math.max(colors[offset], colors[offset + 1], colors[offset + 2]) *
          (0.9 + referenceRandom() * 0.2),
      )
      referenceColors.push(stellarColor.r, stellarColor.g, stellarColor.b)
      referenceSizes.push(
        sizes[index] * (diffuse ? (referenceOnly ? 1 : 1.8) : 1.05),
      )
      const accent = accentRandom()
      accents.push(
        !diffuse && sizes[index] > 0.055 && accent > 0.96
          ? 0.65 + (accent - 0.96) * 8.75
          : 0,
        accentRandom() * Math.PI * 0.5,
      )
    }
    points.geometry.setAttribute(
      'aReferenceColor',
      new THREE.Float32BufferAttribute(referenceColors, 3),
    )
    points.geometry.setAttribute(
      'aReferenceSize',
      new THREE.Float32BufferAttribute(referenceSizes, 1),
    )
    points.geometry.setAttribute(
      'aAccent',
      new THREE.Float32BufferAttribute(accents, 2),
    )
    points.material.uniforms.uViewportHeight = {
      value: this.host.clientHeight,
    }
    points.material.uniforms.uDiffuse = { value: diffuse ? 1 : 0 }
    points.material.uniforms.uReferenceStyle = {
      value: this.options.galaxyStyle === 'reference' ? 1 : 0,
    }
    points.material.uniforms.uReferenceOnly = { value: referenceOnly ? 1 : 0 }
    points.material.uniforms.uStellarGlints = { value: 1 }
    points.material.uniforms.uInterior = { value: 0 }
    points.material.uniforms.uOverview = { value: 0 }
    points.material.uniforms.uOverviewContrast = { value: 0 }
    points.material.uniforms.uDustMap = { value: null }
    points.material.uniforms.uDustStrength = { value: 0 }
    points.material.uniforms.uDustSteps = { value: 8 }
    points.material.uniforms.uObserver = { value: new THREE.Vector3() }
    points.userData.referenceOnly = referenceOnly
    points.visible =
      !referenceOnly || this.options.galaxyStyle === 'reference'
    points.material.vertexShader = `
      attribute float aSize, aReferenceSize;
      attribute vec2 aAccent;
      attribute vec3 aReferenceColor;
      varying vec3 vColor;
      varying vec3 vTransmission;
      varying float vVisibility;
      varying vec2 vAccent;
      varying float vStarScale;
      uniform float uPixelRatio, uViewportHeight, uDiffuse, uReferenceStyle, uReferenceOnly, uInterior, uOverview, uStellarGlints;
      uniform sampler2D uDustMap;
      uniform float uDustStrength, uDustSteps;
      uniform vec3 uObserver;
      vec3 dustTransmission(vec3 source) {
        if (uDustStrength < 0.001) return vec3(1.0);
        vec3 difference = uObserver - source;
        float distance = length(difference);
        vec3 direction = difference / max(distance, 0.0001);
        vec3 safeDirection = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), direction)) * max(abs(direction), vec3(0.0001));
        vec3 bounds = vec3(5.8, 0.38, 5.8);
        vec3 first = (-bounds - source) / safeDirection;
        vec3 second = (bounds - source) / safeDirection;
        vec3 near = min(first, second), far = max(first, second);
        float entry = max(0.0, max(near.x, max(near.y, near.z)));
        float exit = min(distance, min(far.x, min(far.y, far.z)));
        if (exit <= entry) return vec3(1.0);
        float stepLength = (exit - entry) / uDustSteps;
        float opticalDepth = 0.0;
        for (int index = 0; index < 8; index++) {
          if (float(index) >= uDustSteps) break;
          vec3 point = source + direction * (entry + (float(index) + 0.5) * stepLength);
          float radial = length(point.xz);
          float warp = sin(atan(point.z, point.x) * 2.0 + radial) * pow(radial / 5.75, 2.0) * 0.1;
          float altitude = (point.y - warp) / (0.045 + radial * 0.006);
          float density = texture2D(uDustMap, point.xz / 12.0 + 0.5).r;
          density *= exp(-altitude * altitude) * (1.0 - smoothstep(4.8, 5.75, radial)) * smoothstep(0.3, 0.9, radial);
          opticalDepth += density * stepLength * 5.5;
        }
        return exp(-min(opticalDepth, 1.8) * uDustStrength * vec3(0.7, 0.92, 1.22));
      }
      void main() {
        vColor = mix(color, aReferenceColor, uReferenceStyle);
        vec3 stellarPosition = position;
        float bulge = exp(-dot(position.xz, position.xz) * 0.6);
        stellarPosition.y *= mix(1.0, 0.6 + bulge * 0.4, uReferenceStyle * (1.0 - uReferenceOnly));
        vTransmission = dustTransmission(stellarPosition);
        float size = mix(aSize, aReferenceSize, uReferenceStyle) * mix(1.0, 0.72, uInterior * (1.0 - uDiffuse));
        size *= mix(1.0, 1.5, uOverview * uDiffuse);
        vec4 viewPosition = modelViewMatrix * vec4(stellarPosition, 1.0);
        float worldScale = length(modelMatrix[0].xyz);
        float projectedSize = size * worldScale * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(-viewPosition.z, 0.0001);
        float minimumSize = mix(2.8, 1.5, uDiffuse);
        vVisibility = pow(min(1.0, projectedSize / minimumSize), 2.0) * smoothstep(0.0, aSize * worldScale * 0.8, -viewPosition.z);
        float maximumSize = mix(mix(56.0, 110.0, uDiffuse), mix(30.0, 48.0, uDiffuse), uInterior);
        vAccent = vec2(aAccent.x * uReferenceStyle * uStellarGlints * (1.0 - uOverview) * smoothstep(3.0, 10.0, projectedSize), aAccent.y);
        vStarScale = 1.0 + vAccent.x * 0.8;
        gl_PointSize = clamp(projectedSize, minimumSize, maximumSize) * vStarScale * uPixelRatio;
        gl_Position = projectionMatrix * viewPosition;
      }
    `
    points.material.fragmentShader = `
      varying vec3 vColor;
      varying vec3 vTransmission;
      varying float vVisibility;
      varying vec2 vAccent;
      varying float vStarScale;
      uniform float uOpacity, uDiffuse, uReferenceStyle, uInterior, uOverviewContrast;
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float radius = length(point) * 2.0;
        if (radius > 1.0) discard;
        float stellarRadius = radius * vStarScale;
        float core = exp(-stellarRadius * stellarRadius * mix(65.0, 78.0, uReferenceStyle));
        float halo = exp(-stellarRadius * stellarRadius * mix(5.0, 6.0, uReferenceStyle * (1.0 - uDiffuse)));
        float profile = mix(core * mix(1.45, mix(mix(1.8, 0.95, uOverviewContrast), 4.2, uInterior), uReferenceStyle) + halo * mix(0.15, mix(mix(0.12, 0.065, uOverviewContrast), 0.045, uInterior), uReferenceStyle), halo, uDiffuse);
        vec2 axes = mat2(cos(vAccent.y), -sin(vAccent.y), sin(vAccent.y), cos(vAccent.y)) * point * 2.0;
        float crossSection = min(abs(axes.x), abs(axes.y));
        float rayLength = max(abs(axes.x), abs(axes.y));
        float rays = exp(-crossSection / max(0.012, fwidth(crossSection))) * pow(max(0.0, 1.0 - rayLength), 2.4);
        profile += vAccent.x * (rays * 1.65 + exp(-radius * radius * 9.0) * 0.12);
        float edge = 1.0 - smoothstep(0.75, 1.0, radius);
        vec3 light = mix(vColor, mix(vColor, vec3(1.0), core * mix(0.1, 0.035, uReferenceStyle)), 1.0 - uDiffuse);
        light *= vTransmission;
        gl_FragColor = vec4(light, min(1.0, profile * uOpacity * vVisibility * edge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
    const normal = new THREE.Vector3()
    const sight = new THREE.Vector3()
    const observer = new THREE.Vector3()
    const inverse = new THREE.Matrix4()
    points.onBeforeRender = () => {
      const reference = this.options.galaxyStyle === 'reference'
      observer
        .copy(this.camera.position)
        .applyMatrix4(inverse.copy(points.matrixWorld).invert())
      const dustMap = this.textures.get('milky-way-dust')
      const dusty =
        reference && this.options.galacticDust !== false && Boolean(dustMap)
      points.material.uniforms.uObserver.value.copy(observer)
      points.material.uniforms.uDustMap.value = dustMap ?? null
      points.material.uniforms.uDustStrength.value = dusty ? 1 : 0
      points.material.uniforms.uDustSteps.value =
        this.navigationQuality || !this.options.highQuality ? 4 : 8
      this.renderer.domElement.dataset.galaxyDust = dusty
        ? 'enabled'
        : 'disabled'
      const interior = reference
        ? 1 - THREE.MathUtils.smoothstep(observer.length(), 1.5, 7)
        : 0
      const overview = reference
        ? THREE.MathUtils.smoothstep(observer.length(), 5.5, 13)
        : 0
      points.material.uniforms.uInterior.value = interior
      points.material.uniforms.uOverview.value = overview
      points.material.uniforms.uReferenceStyle.value = reference ? 1 : 0
      points.material.blending =
        reference && diffuse ? THREE.NormalBlending : THREE.AdditiveBlending
      this.renderer.domElement.dataset.galaxyStyle = reference
        ? 'reference'
        : 'original'
      const glints = reference && this.options.stellarGlints !== false
      points.material.uniforms.uStellarGlints.value = glints ? 1 : 0
      this.renderer.domElement.dataset.galaxyGlints = glints
        ? 'selective-distance-faded'
        : 'disabled'
      points.material.uniforms.uViewportHeight.value = this.host.clientHeight
      points.material.uniforms.uPixelRatio.value =
        this.renderer.getPixelRatio()
      normal.set(0, 1, 0).transformDirection(points.matrixWorld)
      sight
        .setFromMatrixPosition(points.matrixWorld)
        .sub(this.camera.position)
        .normalize()
      const alignment = THREE.MathUtils.clamp(
        Math.abs(normal.dot(sight)),
        0,
        1,
      )
      points.material.uniforms.uOverviewContrast.value =
        overview * THREE.MathUtils.smoothstep(alignment, 0.15, 0.65)
      points.material.uniforms.uOpacity.value =
        opacity *
        (diffuse ? (reference ? 2.4 : 0.55) : reference ? 0.82 : 1) *
        (1 + (diffuse ? overview * 0.15 : 0)) *
        (reference ? 0.2 + alignment * 0.8 : 0.16 + alignment * 0.84) *
        (1 - interior * (diffuse ? 0.78 : 0))
      this.renderer.domElement.dataset.galaxyOverviewBlend =
        overview.toFixed(3)
      this.renderer.domElement.dataset.galaxyInclination =
        THREE.MathUtils.radToDeg(Math.acos(alignment)).toFixed(2)
    }
    points.userData.galaxyParticles = true
    return points
  }

  private buildGalaxy(object: CelestialObject) {
    if (
      [
        'messier-87',
        'centaurus-a',
        'ngc-1275',
        'large-magellanic-cloud',
        'small-magellanic-cloud',
      ].includes(object.id)
    ) {
      this.buildStarCluster(object)
      return
    }
    const galaxyParent = this.content
    this.fitRadius = 5.65
    const random = seededRandom(hashId(object.id))
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const color = new THREE.Color()
    const warm = new THREE.Color('#fff0d6')
    const milkyWay = object.id === 'milky-way'
    const triplet = object.parent === 'ngc-6769-group'
    const lenticular = object.id === 'ngc-6771'
    const arms = object.id === 'triangulum' ? 3 : 2
    const barAngle = milkyWay ? 0.7 : 0
    const count = triplet
      ? this.options.highQuality
        ? 48000
        : 24000
      : this.buildingWorldVisual
        ? 65000
        : this.options.highQuality
          ? 180000
          : 85000
    for (let index = 0; index < count; index++) {
      const bulge = index < count * (lenticular ? 0.4 : 0.11)
      const bar =
        (milkyWay || object.id === 'ngc-6770') &&
        index >= count * 0.11 &&
        index < count * 0.24
      const radial = bulge
        ? Math.pow(random(), 1.5) * 1.15
        : 0.65 + Math.pow(random(), 0.8) * 4.7
      const arm = (Math.floor(random() * arms) * Math.PI * 2) / arms
      const angle =
        bulge || lenticular
          ? random() * Math.PI * 2
          : barAngle +
            Math.log(Math.max(radial, 1.15) / 1.15) *
              (object.id === 'ngc-6769' ? 3.6 : 2.8) +
            arm +
            (index % 7 === 0 ? Math.PI * 0.5 : 0) +
            (random() + random() - 1) * (index % 3 === 0 ? 3.5 : 0.23)
      const scatter =
        (random() + random() - 1) * (bulge ? 0.55 : bar ? 0.2 : 0.12)
      const barLength = (random() + random() + random() - 1.5) * 1.55
      const barWidth = (random() + random() - 1) * 0.22
      positions.push(
        bar
          ? barLength * Math.cos(barAngle) - barWidth * Math.sin(barAngle)
          : Math.cos(angle) * radial,
        scatter * (1 - radial / 6) +
          Math.sin(angle * 2 + radial) * Math.pow(radial / 5.5, 3) * 0.12,
        bar
          ? barLength * Math.sin(barAngle) + barWidth * Math.cos(barAngle)
          : Math.sin(angle) * radial,
      )
      color.set(
        milkyWay
          ? bulge || bar
            ? '#f5e5cd'
            : index % 43 === 0
              ? '#d9c4c4'
              : '#e4e8ed'
          : bulge || bar || lenticular
            ? '#ffd7a2'
            : index % 43 === 0
              ? '#f7a5bb'
              : '#adc9f0',
      )
      color.lerp(warm, random() * 0.5).multiplyScalar(0.5 + random() * 0.6)
      colors.push(color.r, color.g, color.b)
      sizes.push(
        bulge || bar
          ? 0.007 + random() * 0.016
          : 0.005 + Math.pow(random(), 8) * 0.075,
      )
    }
    const galaxy = new THREE.Group()
    galaxy.name = 'galaxy-volume'
    galaxy.rotation.x = milkyWay
      ? 0.42
      : object.id === 'andromeda'
        ? 0.2
        : 0.45
    galaxy.rotation.z = milkyWay ? -0.1 : -0.24
    if (triplet)
      galaxy.rotation.set(
        lenticular ? 0.22 : object.id === 'ngc-6769' ? 0.85 : 1.05,
        0,
        lenticular ? -0.6 : object.id === 'ngc-6769' ? -0.2 : 0.55,
      )
    const stellarDisk = milkyWay
      ? this.galaxyParticles(
          positions,
          colors,
          sizes.map((size) => size * 2.5),
          0.8,
        )
      : triplet
        ? this.volumeParticles(
            positions,
            colors,
            sizes.map((size) => size * 2.2),
            0.4,
          )
        : this.particles(positions, colors, sizes, 0.15)
    if (triplet) stellarDisk.material.blending = THREE.NormalBlending
    stellarDisk.name = 'resolved-stellar-disk'
    stellarDisk.renderOrder = 1
    galaxy.add(stellarDisk)
    const hazeColors = colors.map((value) => value * 0.4)
    const makeHaze = milkyWay
      ? (
          locations: number[],
          tones: number[],
          diameters: number[],
          strength: number,
        ) => this.galaxyParticles(locations, tones, diameters, strength, true)
      : triplet
        ? this.volumeParticles.bind(this)
        : this.particles.bind(this)
    const haze = makeHaze(
      positions.filter((_, index) => Math.floor(index / 3) % 8 === 0),
      hazeColors.filter((_, index) => Math.floor(index / 3) % 8 === 0),
      sizes
        .filter((_, index) => index % 8 === 0)
        .map(() => (triplet ? 0.25 : 0.17)),
      milkyWay ? 0.05 : triplet ? 0.055 : 0.018,
    )
    if (triplet) haze.material.blending = THREE.NormalBlending
    galaxy.add(haze)
    if (!milkyWay && !triplet) {
      const dustMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uArms: { value: arms },
          uBarAngle: { value: barAngle },
          uBarStrength: { value: milkyWay ? 1 : 0.12 },
          uLayer: { value: 0 },
          uArtwork: { value: null },
          uUseArtwork: { value: 0 },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
        varying vec2 vUv;
        uniform float uArms, uBarAngle, uBarStrength, uLayer;
        uniform sampler2D uArtwork;
        uniform float uUseArtwork;
        float hash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 point) { vec2 cell = floor(point), local = fract(point); local = local * local * (3.0 - 2.0 * local); return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x), mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), local.x), local.y); }
        float fbm(vec2 point) {
          float total = 0.0, amplitude = 0.5;
          mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
          for (int octave = 0; octave < 6; octave++) { total += noise(point) * amplitude; point = rotation * point * 2.04 + 13.7; amplitude *= 0.5; }
          return total;
        }
        void main() {
          vec2 point = vec2(vUv.x - 0.5, 0.5 - vUv.y) * 12.0;
          if (uUseArtwork > 0.5) {
            vec3 artwork = texture2D(uArtwork, vUv).rgb;
            float luminosity = dot(artwork, vec3(0.2126, 0.7152, 0.0722));
            float edge = 1.0 - smoothstep(5.35, 6.0, length(point));
            float alpha = smoothstep(0.001, 0.035, luminosity) * edge;
            vec3 light = artwork * (0.91 + fbm(point * 23.0) * 0.24);
            if (uLayer > 0.5) {
              float hydrogen = max(0.0, artwork.r - artwork.g * 1.1) * smoothstep(0.9, 1.8, length(point));
              light = artwork * 0.025 + vec3(0.85, 0.13, 0.24) * hydrogen * 0.35;
              alpha *= 0.09;
            }
            gl_FragColor = vec4(light / max(alpha, 0.01), alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          float radius = length(point);
          float largeCloud = fbm(point * 2.2 + 9.0);
          vec2 warp = vec2(fbm(point * 3.6), fbm(point * 3.6 + 41.0)) - 0.5;
          vec2 warped = point + warp * 0.16;
          float angle = atan(warped.y, warped.x);
          float phase = angle - uBarAngle - log(max(radius, 1.15) / 1.15) * 2.8;
          float armPhase = phase * uArms * 0.5 + (largeCloud - 0.5) * 0.34;
          float armDistance = abs(sin(armPhase)) * radius;
          float arm = exp(-pow(armDistance / (0.36 + radius * 0.12), 2.0));
          float broadArm = exp(-pow(armDistance / (0.8 + radius * 0.19), 2.0));
          float secondary = exp(-pow(abs(cos(armPhase + 0.13)) * radius / (0.3 + radius * 0.09), 2.0)) * 0.62;
          float outerFade = 1.0 - smoothstep(4.05 + largeCloud * 0.7, 5.65, radius);
          float innerFade = smoothstep(0.75, 1.6, radius);
          arm *= innerFade * outerFade;
          broadArm *= innerFade * outerFade;
          secondary *= smoothstep(1.5, 2.4, radius) * outerFade;
          float fineCloud = fbm(warped * 19.0 + warp * 2.0);
          float dustGrain = fbm(warped * 56.0);
          float filaments = pow(abs(fineCloud - 0.49) * 4.2, 1.6);
          float lane = exp(-pow(sin(armPhase + 0.105 + (largeCloud - 0.5) * 0.1) * radius / (0.06 + radius * 0.025), 2.0));
          float extinction = clamp((lane * (0.5 + dustGrain) + (0.54 - fineCloud) * 2.1) * innerFade, 0.0, 0.83);
          float disk = exp(-radius * 0.38) * outerFade;
          mat2 barRotation = mat2(cos(uBarAngle), -sin(uBarAngle), sin(uBarAngle), cos(uBarAngle));
          vec2 barPosition = barRotation * point;
          float bar = exp(-pow(abs(barPosition.x) / 1.48, 2.7) - pow(abs(barPosition.y) / 0.26, 1.6)) * uBarStrength;
          float bulge = exp(-radius * radius * 1.9);
          float textureDetail = 0.28 + fineCloud * 1.3 + filaments * 0.55;
          vec3 light = vec3(0.33, 0.37, 0.46) * disk * 0.7;
          light += vec3(0.56, 0.66, 0.84) * (arm * 0.51 + broadArm * 0.4 + secondary * 0.64) * textureDetail;
          light *= 1.0 - extinction;
          light += vec3(1.0, 0.77, 0.47) * (bar * 1.45 + bulge * 0.6) * (0.65 + fineCloud * 0.55);
          float knots = smoothstep(0.59, 0.77, noise(warped * 15.0 + warp * 4.0)) * smoothstep(0.46, 0.61, dustGrain);
          float ionizedGas = knots * (arm + secondary) * 1.65;
          light += vec3(1.0, 0.13, 0.36) * ionizedGas;
          float alpha = clamp(disk * 1.2 + broadArm * 0.7 + arm * 0.5 + bar + bulge, 0.0, 0.99);
          if (uLayer > 0.5) {
            light = vec3(0.24, 0.34, 0.54) * broadArm + vec3(0.95, 0.09, 0.22) * ionizedGas * 1.5;
            alpha = (broadArm * 0.035 + ionizedGas * 0.075) * (0.4 + largeCloud);
          }
          gl_FragColor = vec4(light, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const dust = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 12, 48, 48),
        dustMaterial,
      )
      dust.name = 'spiral-emission-and-dust'
      const surface = dust.geometry.attributes.position
      for (let index = 0; index < surface.count; index++) {
        const horizontal = surface.getX(index),
          depth = surface.getY(index)
        const radial = Math.hypot(horizontal, depth)
        surface.setZ(
          index,
          Math.sin(Math.atan2(depth, horizontal) * 2 + radial) *
            Math.pow(radial / 6, 3) *
            0.1,
        )
      }
      dust.geometry.computeVertexNormals()
      dust.rotation.x = -Math.PI / 2
      dust.position.y = 0.03
      dust.renderOrder = 0
      galaxy.add(dust)
      const cloudMaterials: THREE.ShaderMaterial[] = []
      for (const altitude of [-0.075, 0.095]) {
        const cloudMaterial = dustMaterial.clone()
        cloudMaterial.uniforms.uLayer.value = 1
        cloudMaterial.uniforms.uArtwork.value =
          dustMaterial.uniforms.uArtwork.value
        cloudMaterials.push(cloudMaterial)
        const clouds = new THREE.Mesh(dust.geometry.clone(), cloudMaterial)
        clouds.name = 'ionized-gas-layer'
        clouds.rotation.copy(dust.rotation)
        clouds.position.y = altitude
        clouds.renderOrder = 2
        galaxy.add(clouds)
      }
    }
    this.content.add(galaxy)
    if (milkyWay) {
      galaxy.userData.particleOnly = true
      this.renderer.domElement.dataset.galaxyRepresentation =
        'volumetric-particles'
      this.renderer.domElement.dataset.galaxySurfaceLayers = '0'
      this.renderer.domElement.dataset.galaxyTextureReady = 'false'
      const source = new Image()
      source.onload = () => {
        if (this.disposed || galaxy.parent !== galaxyParent) return
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1024
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return
        context.drawImage(source, 0, 0, 1024, 1024)
        const pixels = context.getImageData(0, 0, 1024, 1024).data
        if (!this.textures.has('milky-way-dust')) {
          const density = new Uint8Array(256 * 256)
          const intensityAt = (horizontal: number, vertical: number) => {
            const offset =
              (THREE.MathUtils.clamp(vertical, 0, 1023) * 1024 +
                THREE.MathUtils.clamp(horizontal, 0, 1023)) *
              4
            return (
              Math.max(
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2],
              ) / 255
            )
          }
          for (let vertical = 0; vertical < 256; vertical++) {
            for (let horizontal = 0; horizontal < 256; horizontal++) {
              const sampleX = horizontal * 4 + 2
              const sampleY = vertical * 4 + 2
              const intensity = intensityAt(sampleX, sampleY)
              const surrounding =
                (intensityAt(sampleX - 12, sampleY) +
                  intensityAt(sampleX + 12, sampleY) +
                  intensityAt(sampleX, sampleY - 12) +
                  intensityAt(sampleX, sampleY + 12)) /
                4
              density[vertical * 256 + horizontal] = Math.round(
                255 *
                  Math.min(
                    1,
                    Math.pow(intensity, 0.8) * 0.35 +
                      Math.max(0, surrounding - intensity) * 2.4,
                  ),
              )
            }
          }
          const dustMap = new THREE.DataTexture(
            density,
            256,
            256,
            THREE.RedFormat,
          )
          dustMap.minFilter = dustMap.magFilter = THREE.LinearFilter
          dustMap.needsUpdate = true
          this.textures.set('milky-way-dust', dustMap)
        }
        const imagePositions: number[] = [],
          imageColors: number[] = [],
          imageSizes: number[] = []
        const sampleRandom = seededRandom(10748)
        const sampledColor = new THREE.Color()
        const neutralStars = new THREE.Color('#e4dcd8')
        const youngStars = new THREE.Color('#829cd8')
        const oldStars = new THREE.Color('#f4c5a6')
        const emissionRegions = new THREE.Color('#f36aa9')
        const total = this.options.highQuality ? 220000 : 110000
        const normalSample = () =>
          Math.sqrt(-2 * Math.log(Math.max(sampleRandom(), 1e-7))) *
          Math.cos(sampleRandom() * Math.PI * 2)
        const glowPositions: number[] = [],
          glowColors: number[] = [],
          glowSizes: number[] = []
        let maximumHeight = 0
        for (
          let attempt = 0;
          imageSizes.length < total && attempt < total * 24;
          attempt++
        ) {
          const horizontal = sampleRandom(),
            vertical = sampleRandom()
          const pixel =
            (Math.floor(vertical * 1024) * 1024 +
              Math.floor(horizontal * 1024)) *
            4
          const red = pixels[pixel] / 255,
            green = pixels[pixel + 1] / 255,
            blue = pixels[pixel + 2] / 255
          const intensity = Math.max(red, green, blue)
          const ionizedGas = red > green * 1.1 && blue > green * 1.025
          if (intensity < 0.05 || sampleRandom() > Math.pow(intensity, 1.85))
            continue
          const radial = Math.hypot(horizontal - 0.5, vertical - 0.5) * 12
          if (radial > 5.75) continue
          const bulge = Math.exp(-radial * radial * 1.4)
          const thickDisk = sampleRandom() < 0.12
          const warp =
            Math.sin(
              Math.atan2(vertical - 0.5, horizontal - 0.5) * 2 + radial,
            ) *
            Math.pow(radial / 5.75, 2) *
            0.16
          const height =
            THREE.MathUtils.clamp(normalSample(), -3, 3) *
              (0.065 +
                radial * 0.009 +
                bulge * 0.5 +
                (thickDisk ? 0.19 : 0)) +
            warp
          maximumHeight = Math.max(maximumHeight, Math.abs(height))
          imagePositions.push(
            (horizontal - 0.5) * 12,
            height,
            (vertical - 0.5) * 12,
          )
          sampledColor
            .setRGB(red, green, blue, THREE.SRGBColorSpace)
            .multiplyScalar(
              1 /
                Math.max(
                  0.01,
                  Math.max(sampledColor.r, sampledColor.g, sampledColor.b),
                ),
            )
            .lerp(
              ionizedGas
                ? emissionRegions
                : red > blue * 1.05 && radial < 2
                  ? oldStars
                  : blue > red * 1.12
                    ? youngStars
                    : neutralStars,
              ionizedGas ? 0.85 : 0.65,
            )
            .multiplyScalar(
              (0.5 + sampleRandom() * 0.65) * Math.sqrt(intensity),
            )
          imageColors.push(sampledColor.r, sampledColor.g, sampledColor.b)
          const starSize = 0.025 + Math.pow(sampleRandom(), 4) * 0.11
          imageSizes.push(starSize * (ionizedGas ? 1.3 : 1))
          const glowSize =
            imageSizes.length % 16 === 0
              ? 0.16 + sampleRandom() * 0.26
              : ionizedGas
                ? 0.16 + (starSize / 0.135) * 0.26
                : 0
          if (glowSize > 0) {
            glowPositions.push(
              (horizontal - 0.5) * 12,
              height,
              (vertical - 0.5) * 12,
            )
            glowColors.push(sampledColor.r, sampledColor.g, sampledColor.b)
            glowSizes.push(glowSize)
          }
        }
        const haloCount = this.options.highQuality ? 6000 : 3000
        for (let index = 0; index < haloCount; index++) {
          const azimuth = sampleRandom() * Math.PI * 2
          const vertical = sampleRandom() * 2 - 1
          const radial = 0.35 + Math.pow(sampleRandom(), 1.3) * 4.8
          const spread = Math.sqrt(1 - vertical * vertical)
          const height = vertical * radial * 0.65
          maximumHeight = Math.max(maximumHeight, Math.abs(height))
          imagePositions.push(
            Math.cos(azimuth) * spread * radial,
            height,
            Math.sin(azimuth) * spread * radial,
          )
          sampledColor
            .set(sampleRandom() < 0.2 ? '#e1e7ee' : '#eee2cf')
            .multiplyScalar(0.4 + sampleRandom() * 0.45)
          imageColors.push(sampledColor.r, sampledColor.g, sampledColor.b)
          imageSizes.push(0.022 + Math.pow(sampleRandom(), 6) * 0.1)
        }
        stellarDisk.removeFromParent()
        haze.removeFromParent()
        disposeGroup(stellarDisk)
        disposeGroup(haze)
        const volume = this.galaxyParticles(
          imagePositions,
          imageColors,
          imageSizes,
          0.42,
        )
        volume.name = 'artwork-aligned-stellar-volume'
        volume.renderOrder = 1
        galaxy.add(volume)
        const unresolvedStars = this.galaxyParticles(
          glowPositions,
          glowColors,
          glowSizes,
          0.022,
          true,
        )
        unresolvedStars.name = 'volumetric-stellar-glow'
        galaxy.add(unresolvedStars)
        const bulgePositions: number[] = [],
          bulgeColors: number[] = [],
          bulgeSizes: number[] = [],
          bulgeGlowPositions: number[] = [],
          bulgeGlowColors: number[] = [],
          bulgeGlowSizes: number[] = []
        const bulgeRandom = seededRandom(1933)
        const bulgeCount = this.options.highQuality ? 24000 : 12000
        const bulgeColor = new THREE.Color('#f5d49b')
        for (let index = 0; index < bulgeCount; index++) {
          const azimuth = bulgeRandom() * Math.PI * 2
          const vertical = bulgeRandom() * 2 - 1
          const radial = Math.pow(bulgeRandom(), 0.65) * 1.6
          const spread = Math.sqrt(1 - vertical * vertical)
          const horizontal = Math.cos(azimuth) * radial * spread
          const depth = Math.sin(azimuth) * radial * spread * 0.78
          const position = [
            horizontal * Math.cos(0.7) - depth * Math.sin(0.7),
            vertical * radial * 0.42,
            horizontal * Math.sin(0.7) + depth * Math.cos(0.7),
          ]
          bulgePositions.push(...position)
          const luminosity = 0.42 + bulgeRandom() * 0.45
          bulgeColors.push(
            bulgeColor.r * luminosity,
            bulgeColor.g * luminosity,
            bulgeColor.b * luminosity,
          )
          bulgeSizes.push(0.025 + Math.pow(bulgeRandom(), 4) * 0.065)
          if (index % 12 === 0) {
            bulgeGlowPositions.push(...position)
            bulgeGlowColors.push(bulgeColor.r, bulgeColor.g, bulgeColor.b)
            bulgeGlowSizes.push(0.24 + bulgeRandom() * 0.2)
          }
        }
        const referenceBulge = this.galaxyParticles(
          bulgePositions,
          bulgeColors,
          bulgeSizes,
          0.3,
          false,
          true,
        )
        referenceBulge.name = 'reference-stellar-bulge'
        referenceBulge.renderOrder = 1
        galaxy.add(referenceBulge)
        const bulgeGlow = this.galaxyParticles(
          bulgeGlowPositions,
          bulgeGlowColors,
          bulgeGlowSizes,
          0.055,
          true,
          true,
        )
        bulgeGlow.name = 'reference-bulge-starlight'
        galaxy.add(bulgeGlow)
        this.spectralAppearance.bind(galaxy, object)
        galaxy.userData.particleDepth = maximumHeight * 2
        this.renderer.domElement.dataset.galaxyTextureReady = 'true'
        this.renderer.domElement.dataset.galaxyParticleDepth = (
          maximumHeight * 2
        ).toFixed(3)
        this.renderer.domElement.dataset.galaxyParticles = String(
          imageSizes.length,
        )
      }
      source.src = `${import.meta.env.BASE_URL}textures/milky-way-nasa.jpg`
    }
    if (object.id === 'milky-way') {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 18, 12),
        new THREE.MeshBasicMaterial({ color: '#d7ecae' }),
      )
      marker.position.set(2.67, 0.05, 0)
      marker.userData.objectId = 'solar-system'
      galaxy.add(marker)
      this.addLabel('Solar System', 'solar-system', marker, 7)
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 18, 12),
        new THREE.MeshBasicMaterial({ color: '#ffd69b' }),
      )
      center.userData.objectId = 'sagittarius-a'
      galaxy.add(center)
      this.addLabel('Sagittarius A*', 'sagittarius-a', center, 14)
      const points: number[] = [],
        pointColors: number[] = [],
        pointSizes: number[] = [],
        ids: string[] = []
      for (const row of extendedData.stars) {
        if (row[3] === null || row[4] === null || row[5] === null) continue
        points.push(2.67 - row[3] / 3066, row[5] / 3066, row[4] / 3066)
        pointColors.push(0.25, 0.34, 0.37)
        pointSizes.push(0.003)
        ids.push(starId(row))
      }
      const measuredStars = this.particles(
        points,
        pointColors,
        pointSizes,
        0.008,
      )
      measuredStars.userData.pointIds = ids
      this.pointCount += ids.length
      galaxy.add(measuredStars)
      for (const [name, horizontal, depth] of [
        ['Perseus Arm', -3.1, 1.6],
        ['Sagittarius Arm', 1.1, 2.2],
        ['Outer Arm', -3.8, -2.5],
      ] as const) {
        const anchor = new THREE.Object3D()
        anchor.position.set(horizontal, 0.05, depth)
        galaxy.add(anchor)
        this.addLabel(name, 'milky-way', anchor, 4)
      }
    }
  }

  private buildGalaxyGroup(object: CelestialObject) {
    this.fitRadius = 6.4
    const unit = object.skyPosition!.radiusPc / 6.4
    const origin = new THREE.Vector3(...referencePositionPc(object)!)
    const diagram = new THREE.Group()
    diagram.name = 'catalog-galaxy-triplet'
    const members = object.members!.map((id) => {
      const member = objectById.get(id)!
      const position = new THREE.Vector3(...referencePositionPc(member)!)
        .sub(origin)
        .divideScalar(unit)
      if (!this.buildingWorldVisual) {
        const galaxy = this.createWorldVisual(member)
        galaxy.position.copy(position)
        galaxy.scale.setScalar(member.skyPosition!.radiusPc / (5.65 * unit))
        galaxy.traverse((node) => {
          if ((node as THREE.Points).isPoints) node.userData.objectId = id
        })
        diagram.add(galaxy)
        this.addLabel(member.name, member.id, galaxy, 18)
      }
      return position
    })
    const random = seededRandom(6769)
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    const color = new THREE.Color()
    const point = new THREE.Vector3()
    for (const [first, second] of [
      [0, 1],
      [0, 2],
    ]) {
      const start = members[first],
        end = members[second]
      const control = start
        .clone()
        .lerp(end, 0.5)
        .add(new THREE.Vector3(0.3, 0.15, -0.25))
      const curve = new THREE.QuadraticBezierCurve3(start, control, end)
      for (let index = 0; index < 2600; index++) {
        const progress = random()
        curve.getPoint(progress, point)
        const spread = 0.06 + Math.sin(progress * Math.PI) * 0.13
        point.add(
          new THREE.Vector3(
            random() - 0.5,
            random() - 0.5,
            random() - 0.5,
          ).multiplyScalar(spread),
        )
        positions.push(...point.toArray())
        color
          .set(index % 4 === 0 ? '#ddbd95' : '#9fbccf')
          .multiplyScalar(0.3 + random() * 0.3)
        colors.push(color.r, color.g, color.b)
        sizes.push(0.025 + random() * 0.04)
      }
    }
    const tails = this.volumeParticles(positions, colors, sizes, 0.24)
    tails.material.blending = THREE.NormalBlending
    tails.name = 'illustrative-tidal-trails'
    diagram.add(tails)
    if (!this.buildingWorldVisual)
      diagram.quaternion.setFromUnitVectors(
        origin.clone().negate().normalize(),
        new THREE.Vector3(0.15, 0.3, 1).normalize(),
      )
    this.content.add(diagram)
    this.renderer.domElement.dataset.groupRepresentation =
      'catalog-triplet-with-tidal-trails'
    this.renderer.domElement.dataset.structureMembers =
      object.members!.join(',')
  }

  private buildCluster(object: CelestialObject) {
    if (object.members && object.skyPosition) {
      this.buildGalaxyGroup(object)
      return
    }
    this.fitRadius = 6.4
    const random = seededRandom(hashId(object.id))
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const local = object.id === 'local-group'
    const count = local ? 80 : 220
    for (let galaxyIndex = 0; galaxyIndex < count; galaxyIndex++) {
      let center = new THREE.Vector3(
        (random() - 0.5) * 11,
        (random() - 0.5) * 6,
        (random() - 0.5) * 7,
      )
      if (local) {
        if (galaxyIndex === 0) center = new THREE.Vector3(-2.4, -0.2, 0.5)
        if (galaxyIndex === 1) center = new THREE.Vector3(2.1, 1.3, -1)
        if (galaxyIndex === 2) center = new THREE.Vector3(3.1, -1.5, 0)
      } else {
        center.normalize().multiplyScalar(5.2 * Math.pow(random(), 0.85))
        center.y *= 0.7
        if (galaxyIndex % 5 === 1)
          center.multiplyScalar(0.4).add(new THREE.Vector3(2.8, 0.8, -0.8))
        if (galaxyIndex === 0) center.set(0, 0, 0)
        if (galaxyIndex === 1) center.set(2.8, 0.8, -0.8)
        if (galaxyIndex === 2) center.set(-2.1, -0.6, 1.2)
      }
      const radius = galaxyIndex < 3 ? 0.7 : 0.08 + random() * 0.24
      const tilt = new THREE.Euler(random(), random() * 2, random() * 2)
      const elliptical =
        !local &&
        (galaxyIndex < 3 || (center.length() < 2.5 && random() < 0.7))
      const tone = new THREE.Color(elliptical ? '#f1d3a4' : '#b4cbdc')
      for (
        let pointIndex = 0;
        pointIndex < (galaxyIndex < 3 ? 1500 : 80);
        pointIndex++
      ) {
        const radial = Math.pow(random(), elliptical ? 1 / 3 : 1.1) * radius
        const angle =
          (radial / radius) * 5 +
          Math.floor(random() * 2) * Math.PI +
          (random() - 0.5) * 0.7
        const point = new THREE.Vector3(
          Math.cos(angle) * radial,
          (random() - 0.5) * radius * 0.15,
          Math.sin(angle) * radial,
        )
        if (elliptical) {
          const azimuth = random() * Math.PI * 2
          const vertical = random() * 2 - 1
          const spread = Math.sqrt(1 - vertical * vertical)
          point.set(
            Math.cos(azimuth) * spread * radial,
            vertical * radial * 0.65,
            Math.sin(azimuth) * spread * radial * 0.8,
          )
        }
        point.applyEuler(tilt).add(center)
        positions.push(point.x, point.y, point.z)
        if (local)
          colors.push(0.9, 0.76 + random() * 0.2, 0.64 + random() * 0.3)
        else {
          const luminosity =
            (0.6 + random() * 0.4) *
            (elliptical
              ? 0.25 + 0.75 * Math.exp(-3 * Math.pow(radial / radius, 2))
              : 1)
          colors.push(
            tone.r * luminosity,
            tone.g * luminosity,
            tone.b * luminosity,
          )
        }
        sizes.push(0.025 + random() * 0.075)
      }
      if (local && galaxyIndex < 3) {
        const id = ['milky-way', 'andromeda', 'triangulum'][galaxyIndex]
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 12, 8),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        )
        marker.position.copy(center)
        marker.userData.objectId = id
        this.content.add(marker)
        this.addLabel(objectById.get(id)!.name, id, marker, 22)
      }
    }
    const starlight = local
      ? this.particles(positions, colors, sizes, 0.9)
      : this.volumeParticles(positions, colors, sizes, 0.2)
    starlight.userData.emissionComponent = 'photosphere'
    this.content.add(starlight)
    if (!local) {
      const gasPositions: number[] = [],
        gasColors: number[] = [],
        gasSizes: number[] = []
      for (let index = 0; index < 4000; index++) {
        const radius = Math.pow(random(), 0.8) * 5.2
        const point = new THREE.Vector3(
          random() - 0.5,
          random() - 0.5,
          random() - 0.5,
        )
          .normalize()
          .multiplyScalar(radius)
        gasPositions.push(point.x, point.y * 0.72, point.z)
        gasColors.push(0.4, 0.7, 0.82)
        gasSizes.push(0.28 + random() * 0.5)
      }
      const gas = this.volumeParticles(
        gasPositions,
        gasColors,
        gasSizes,
        0.055,
      )
      gas.material.blending = THREE.NormalBlending
      gas.name = 'illustrative-intracluster-xray-gas'
      gas.userData.emissionComponent = 'hot-gas'
      gas.userData.spectralBands = ['xray']
      gas.visible = this.options.spectrum === 'xray'
      this.content.add(gas)
    }
    this.renderer.domElement.dataset.clusterRepresentation = local
      ? 'galaxy-group'
      : 'concentrated-galaxies'
  }

  private buildVoid() {
    this.fitRadius = 7.2
    if (!this.buildingWorldVisual) this.starfield.visible = false
    this.renderer.domElement.dataset.voidRepresentation =
      'non-emitting-reference-region'
    this.renderer.domElement.dataset.voidInteriorMarkers = '0'
    this.renderer.domElement.dataset.voidSurfaceLayers = '0'
  }

  private buildLaniakea(object: CelestialObject) {
    this.fitRadius = 7
    const unit = LANIAKEA_RADIUS_PC / 6.4
    const random = seededRandom(2014)
    const target = new THREE.Vector3(
      ...referencePositionPc(objectById.get('norma-cluster')!)!,
    ).divideScalar(unit)
    const positions: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    const tracks: number[] = [],
      trackColors: number[] = []
    const starts: number[] = [],
      controls: number[] = [],
      ends: number[] = [],
      phases: number[] = []
    const cool = new THREE.Color('#8cbacb')
    const warm = new THREE.Color('#efc78b')
    const color = new THREE.Color()
    const previous = new THREE.Vector3()
    const current = new THREE.Vector3()
    const members = object.members!.map((id) => {
      const member = objectById.get(id)!
      const position = new THREE.Vector3(
        ...referencePositionPc(member)!,
      ).divideScalar(unit)
      const marker = new THREE.Object3D()
      marker.position.copy(position)
      this.content.add(marker)
      this.addLabel(member.name, member.id, marker, 12)
      if (!this.buildingWorldVisual) {
        const count = id === 'norma-cluster' ? 1100 : 600
        for (let index = 0; index < count; index++) {
          const spread = 0.04 + Math.pow(random(), 1.3) * 0.28
          current
            .set(random() - 0.5, random() - 0.5, random() - 0.5)
            .normalize()
            .multiplyScalar(spread)
            .add(position)
          positions.push(...current.toArray())
          color
            .copy(id === 'norma-cluster' ? warm : cool)
            .multiplyScalar(0.5 + random() * 0.5)
          colors.push(color.r, color.g, color.b)
          sizes.push(0.025 + random() * 0.045)
        }
      }
      return position
    })
    this.content.add(this.buildCosmicWeb(object, members))
    const count = this.options.highQuality ? 128 : 80
    for (let index = 0; index < count; index++) {
      const start = new THREE.Vector3(
        random() - 0.5,
        random() - 0.5,
        random() - 0.5,
      )
        .normalize()
        .multiplyScalar(3.2 + random() * 3.2)
      if (index < 32) start.multiplyScalar(0.12).add(members[index % 3])
      const end = target
        .clone()
        .add(
          new THREE.Vector3(
            random() - 0.5,
            random() - 0.5,
            random() - 0.5,
          ).multiplyScalar(0.4),
        )
      const control = start.clone().lerp(end, 0.45)
      control.add(
        new THREE.Vector3(-start.z, start.x * 0.3, start.x).multiplyScalar(
          0.5,
        ),
      )
      const curve = new THREE.QuadraticBezierCurve3(start, control, end)
      for (let sample = 1; sample <= 56; sample++) {
        curve.getPoint((sample - 1) / 56, previous)
        curve.getPoint(sample / 56, current)
        tracks.push(...previous.toArray(), ...current.toArray())
        color.copy(cool).lerp(warm, sample / 56)
        trackColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
      }
      for (let sample = 0; sample < 12; sample++) {
        starts.push(...start.toArray())
        controls.push(...control.toArray())
        ends.push(...end.toArray())
        phases.push((sample + random() * 0.3) / 12)
      }
    }
    const flow = new THREE.Group()
    flow.name = 'laniakea-flow-traces'
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(tracks, 3),
    )
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(trackColors, 3),
    )
    flow.add(
      new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.025,
          depthWrite: false,
        }),
      ),
    )
    const tracers = this.volumeParticles(
      new Array(phases.length * 3).fill(0),
      new Array(phases.length * 3).fill(1),
      new Array(phases.length).fill(0.065),
      0.24,
    )
    tracers.geometry.setAttribute(
      'aStart',
      new THREE.Float32BufferAttribute(starts, 3),
    )
    tracers.geometry.setAttribute(
      'aControl',
      new THREE.Float32BufferAttribute(controls, 3),
    )
    tracers.geometry.setAttribute(
      'aEnd',
      new THREE.Float32BufferAttribute(ends, 3),
    )
    tracers.geometry.setAttribute(
      'aPhase',
      new THREE.Float32BufferAttribute(phases, 1),
    )
    tracers.material.uniforms.uTime = { value: this.visualTime }
    tracers.material.uniforms.uCool = { value: cool }
    tracers.material.uniforms.uWarm = { value: warm }
    tracers.material.vertexShader = `
      attribute vec3 aStart, aControl, aEnd;
      attribute float aPhase;
      uniform float uTime, uPixelRatio, uViewportHeight;
      uniform vec3 uCool, uWarm;
      varying vec3 vColor;
      varying float vVisibility;
      void main() {
        float progress = fract(aPhase + uTime * 0.035);
        vec3 point = mix(mix(aStart, aControl, progress), mix(aControl, aEnd, progress), progress);
        vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
        float size = 0.065 * length(modelMatrix[0].xyz) * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(0.0001, -viewPosition.z);
        vVisibility = pow(min(1.0, size / 1.5), 2.0) * smoothstep(0.0, 0.06, progress) * (1.0 - smoothstep(0.85, 1.0, progress));
        vColor = mix(uCool, uWarm, progress);
        gl_PointSize = clamp(size, 1.5, 8.0) * uPixelRatio;
        gl_Position = projectionMatrix * viewPosition;
      }
    `
    tracers.frustumCulled = false
    this.shaders.push(tracers.material)
    flow.add(tracers)
    this.content.add(flow)
    if (sizes.length) {
      const groups = this.volumeParticles(positions, colors, sizes, 0.6)
      groups.material.blending = THREE.NormalBlending
      this.content.add(groups)
    }
    this.renderer.domElement.dataset.laniakeaRepresentation =
      'catalog-anchored-filament-web'
    this.renderer.domElement.dataset.laniakeaRadiusPc =
      String(LANIAKEA_RADIUS_PC)
    this.renderer.domElement.dataset.laniakeaFlowCurves = String(count)
    this.renderer.domElement.dataset.structureMembers =
      object.members!.join(',')
  }

  private buildExpansion() {
    this.fitRadius = 10
    const random = seededRandom(13800)
    const positions: number[] = [],
      centers: number[] = [],
      colors: number[] = [],
      sizes: number[] = []
    const color = new THREE.Color()
    for (let galaxy = 0; galaxy < 650; galaxy++) {
      const center = new THREE.Vector3(
        (random() - 0.5) * 13,
        (random() - 0.5) * 9,
        (random() - 0.5) * 11,
      )
      const tilt = new THREE.Euler(
        random() * Math.PI,
        random() * Math.PI,
        random() * Math.PI,
      )
      color.set(galaxy % 3 === 0 ? '#e7c299' : '#9ec6da')
      for (let index = 0; index < 24; index++) {
        const angle = random() * Math.PI * 2
        const radius = Math.sqrt(random()) * 0.07
        const offset = new THREE.Vector3(
          Math.cos(angle) * radius,
          (random() - 0.5) * 0.014,
          Math.sin(angle) * radius,
        ).applyEuler(tilt)
        positions.push(...offset.toArray())
        centers.push(...center.toArray())
        colors.push(color.r, color.g, color.b)
        sizes.push(0.015 + random() * 0.04)
      }
    }
    const galaxies = this.volumeParticles(positions, colors, sizes, 0.65)
    galaxies.material.blending = THREE.NormalBlending
    galaxies.geometry.setAttribute(
      'aCenter',
      new THREE.Float32BufferAttribute(centers, 3),
    )
    galaxies.material.uniforms.uExpansion = {
      value: expansionScale(this.options.cosmicAgeGyr ?? 13.8),
    }
    galaxies.material.vertexShader = galaxies.material.vertexShader
      .replace(
        'attribute float aSize;',
        'attribute float aSize; attribute vec3 aCenter; uniform float uExpansion;',
      )
      .replace(
        'vec4(position, 1.0)',
        'vec4(aCenter * uExpansion + position, 1.0)',
      )
    const beforeRender = galaxies.onBeforeRender
    galaxies.onBeforeRender = (...args) => {
      beforeRender.apply(galaxies, args)
      const age = this.options.cosmicAgeGyr ?? 13.8
      const scale = expansionScale(age)
      galaxies.material.uniforms.uExpansion.value = scale
      this.renderer.domElement.dataset.cosmicAgeGyr = age.toFixed(3)
      this.renderer.domElement.dataset.expansionScale = scale.toFixed(6)
    }
    galaxies.frustumCulled = false
    galaxies.name = 'comoving-galaxy-tracers'
    this.content.add(galaxies)
    this.renderer.domElement.dataset.cosmologyRepresentation =
      'flat-lcdm-distance-expansion'
  }

  private buildUniverse(object: CelestialObject) {
    if (object.visualization === 'dark-energy') {
      this.buildExpansion()
      return
    }
    if (object.id === 'laniakea') {
      this.buildLaniakea(object)
      return
    }
    this.fitRadius = 8.5
    this.content.add(this.buildCosmicWeb(object))
    const marker = new THREE.Object3D()
    this.content.add(marker)
    const id = object.id === 'universe' ? 'laniakea' : 'local-group'
    this.addLabel(objectById.get(id)!.name, id, marker, 16)
  }

  private buildCosmicWeb(
    object: CelestialObject,
    anchors: THREE.Vector3[] = [],
  ) {
    const densityView = object.visualization === 'dark-matter'
    const localWeb = object.id === 'laniakea'
    const scale = localWeb ? 6.4 / 8.5 : 1
    const random = seededRandom(hashId(densityView ? 'universe' : object.id))
    const threadRandom = seededRandom(25022)
    const voids = [
      { center: new THREE.Vector3(-3, -1.2, 1.1), radius: 1.9 },
      { center: new THREE.Vector3(1.7, 1.1, 1.6), radius: 1.75 },
      { center: new THREE.Vector3(3.8, -0.8, -1.8), radius: 1.5 },
      { center: new THREE.Vector3(-0.7, 2, -2.8), radius: 1.3 },
      { center: new THREE.Vector3(-4.6, 1.2, -2.5), radius: 1.2 },
      { center: new THREE.Vector3(0.1, -2.8, -1.3), radius: 1.15 },
    ]
    const nodes = anchors.map((anchor) => anchor.clone().divideScalar(scale))
    for (
      let attempt = 0;
      nodes.length < (localWeb ? 170 : 110) && attempt < 4000;
      attempt++
    ) {
      const point = new THREE.Vector3(
        (random() - 0.5) * 14,
        (random() - 0.5) * 9,
        (random() - 0.5) * 11,
      )
      if (Math.hypot(point.x / 7, point.y / 4.5, point.z / 5.5) > 1) continue
      if (
        voids.some(
          ({ center, radius }) => point.distanceTo(center) < radius + 0.25,
        )
      )
        continue
      if (nodes.some((node) => node.distanceToSquared(point) < 0.5)) continue
      nodes.push(point)
    }
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    const glowPositions: number[] = []
    const glowColors: number[] = []
    const glowSizes: number[] = []
    const threads: number[] = []
    const threadColors: number[] = []
    const connections = new Set<string>()
    const cool = new THREE.Color(localWeb ? '#628db9' : '#8cb9ce')
    const teal = new THREE.Color('#79b7b5')
    const warm = new THREE.Color(localWeb ? '#ffc16d' : '#efd0a1')
    const color = new THREE.Color()
    const closest = new THREE.Vector3()
    const displacement = new THREE.Vector3()
    const point = new THREE.Vector3()
    const gaussian = () =>
      Math.sqrt(-2 * Math.log(Math.max(random(), 1e-7))) *
      Math.cos(random() * Math.PI * 2)
    const insideVoid = (sample: THREE.Vector3) =>
      voids.some(
        ({ center, radius }) =>
          sample.distanceToSquared(center) < radius * radius,
      )
    nodes.forEach((node, nodeIndex) => {
      const nearest = nodes
        .map((neighbor, index) => ({
          neighbor,
          index,
          distance: neighbor.distanceTo(node),
        }))
        .filter(({ index }) => index !== nodeIndex)
        .sort((first, second) => first.distance - second.distance)
        .slice(0, localWeb ? 4 : 3)
      nearest.forEach(({ neighbor, index: neighborIndex, distance }) => {
        const key = `${Math.min(nodeIndex, neighborIndex)}:${Math.max(nodeIndex, neighborIndex)}`
        if (distance > 3.8 || connections.has(key)) return
        connections.add(key)
        const control = node
          .clone()
          .lerp(neighbor, 0.5)
          .add(
            new THREE.Vector3(
              random() - 0.5,
              random() - 0.5,
              random() - 0.5,
            ).multiplyScalar(distance * 0.35),
          )
        const segment = new THREE.Line3(node, neighbor)
        for (const { center, radius } of voids) {
          segment.closestPointToPoint(center, true, closest)
          displacement.copy(closest).sub(center)
          const clearance = displacement.length()
          if (clearance < radius + 0.2) {
            if (clearance < 1e-6) displacement.set(0, 1, 0)
            control.add(
              displacement
                .normalize()
                .multiplyScalar((radius + 0.2 - clearance) * 2.1),
            )
          }
        }
        const curve = new THREE.QuadraticBezierCurve3(node, control, neighbor)
        if (localWeb) {
          const direction = neighbor.clone().sub(node).normalize()
          const side = direction.clone().cross(new THREE.Vector3(0, 1, 0))
          if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
          side.normalize()
          const normal = side.clone().cross(direction).normalize()
          const previous = new THREE.Vector3()
          const threadPoint = new THREE.Vector3()
          for (
            let strand = 0;
            strand < (this.options.highQuality ? 6 : 3);
            strand++
          ) {
            const phase = threadRandom() * Math.PI * 2
            const spread = 0.025 + threadRandom() * 0.2
            for (let step = 0; step <= 56; step++) {
              const progress = step / 56
              curve.getPoint(progress, threadPoint)
              const envelope = Math.sin(progress * Math.PI)
              threadPoint
                .addScaledVector(
                  side,
                  envelope * spread * Math.sin(phase + progress * 9),
                )
                .addScaledVector(
                  normal,
                  envelope * spread * Math.cos(phase + progress * 7),
                )
              if (
                step > 0 &&
                !insideVoid(previous) &&
                !insideVoid(threadPoint)
              ) {
                threads.push(...previous.toArray(), ...threadPoint.toArray())
                color
                  .copy(cool)
                  .lerp(warm, Math.pow(Math.abs(progress - 0.5) * 2, 4) * 0.7)
                threadColors.push(
                  color.r,
                  color.g,
                  color.b,
                  color.r,
                  color.g,
                  color.b,
                )
              }
              previous.copy(threadPoint)
            }
          }
        }
        const samples = Math.ceil(
          distance * (this.options.highQuality ? 150 : 85),
        )
        for (let index = 0; index < samples; index++) {
          const progress = random()
          curve.getPoint(progress, point)
          const scatter =
            (0.035 + Math.pow(Math.abs(progress - 0.5) * 2, 3) * 0.09) *
            (index % 5 === 0 ? 2.5 : 1)
          point.add(
            new THREE.Vector3(
              gaussian(),
              gaussian(),
              gaussian(),
            ).multiplyScalar(scatter),
          )
          if (insideVoid(point)) continue
          positions.push(...point.toArray())
          color
            .copy(nodeIndex % 3 === 0 ? teal : cool)
            .lerp(warm, Math.pow(Math.abs(progress - 0.5) * 2, 5) * 0.45)
            .multiplyScalar(0.45 + random() * 0.5)
          colors.push(color.r, color.g, color.b)
          sizes.push(0.018 + Math.pow(random(), 3) * 0.065)
          if (index % 6 === 0) {
            glowPositions.push(...point.toArray())
            glowColors.push(color.r, color.g, color.b)
            glowSizes.push(0.2 + random() * 0.18)
          }
        }
      })
      const richness = 0.35 + random() * 0.65
      const members = Math.round(
        (this.options.highQuality ? 300 : 170) * richness,
      )
      for (let index = 0; index < members; index++) {
        const spread = 0.04 + Math.pow(random(), 1.8) * 0.28 * richness
        point
          .set(
            gaussian() * spread,
            gaussian() * spread * 0.8,
            gaussian() * spread,
          )
          .add(node)
        if (insideVoid(point)) continue
        positions.push(...point.toArray())
        color
          .copy(warm)
          .lerp(
            cool,
            localWeb
              ? Math.min(0.4, spread * 1.3)
              : Math.min(0.7, spread * 3),
          )
          .multiplyScalar(0.55 + random() * 0.45)
        colors.push(color.r, color.g, color.b)
        sizes.push(
          localWeb
            ? 0.034 + Math.pow(random(), 3) * 0.13
            : 0.024 + Math.pow(random(), 3) * 0.075,
        )
        if (index % 12 === 0) {
          glowPositions.push(...point.toArray())
          glowColors.push(color.r, color.g, color.b)
          glowSizes.push(
            localWeb ? 0.4 + richness * 0.35 : 0.28 + richness * 0.25,
          )
        }
      }
    })
    const web = this.volumeParticles(positions, colors, sizes, 0.65)
    web.material.blending = THREE.NormalBlending
    web.name = 'schematic-cosmic-filaments'
    const glow = this.volumeParticles(
      glowPositions,
      glowColors,
      glowSizes,
      0.045,
    )
    glow.material.blending = THREE.NormalBlending
    glow.name = 'unresolved-filament-light'
    if (densityView) {
      const beforeRender = glow.onBeforeRender
      glow.onBeforeRender = (...args) => {
        beforeRender.apply(glow, args)
        const gain = THREE.MathUtils.clamp(
          this.options.densityGain ?? 1,
          0.25,
          2,
        )
        glow.material.uniforms.uOpacity.value = 0.12 * gain
        web.material.uniforms.uOpacity.value = 0.65 * gain
        this.renderer.domElement.dataset.densityGain = gain.toFixed(3)
      }
      this.renderer.domElement.dataset.cosmologyRepresentation =
        'synthetic-dark-matter-density'
    }
    const field = new THREE.Group()
    field.name = localWeb
      ? 'laniakea-filament-density'
      : 'cosmic-filament-density'
    field.scale.setScalar(scale)
    field.add(web, glow)
    if (threads.length) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(threads, 3),
      )
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(threadColors, 3),
      )
      const strands = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.11,
          depthWrite: false,
        }),
      )
      strands.name = 'fine-filament-strands'
      field.add(strands)
    }
    if (localWeb) {
      this.renderer.domElement.dataset.laniakeaFilaments = String(
        connections.size,
      )
      this.renderer.domElement.dataset.laniakeaThreads = String(
        threads.length / 6,
      )
    } else {
      this.renderer.domElement.dataset.cosmicWebRepresentation =
        'curved-filaments-and-voids'
      this.renderer.domElement.dataset.cosmicWebVoids = String(voids.length)
      this.renderer.domElement.dataset.cosmicWebFilaments = String(
        connections.size,
      )
      this.renderer.domElement.dataset.cosmicWebParticles = String(
        sizes.length,
      )
    }
    return field
  }

  private mapContextFor(object: CelestialObject): string {
    if (['comet', 'asteroid', 'dwarf-planet'].includes(object.kind))
      return 'solar-system'
    if (
      object.id === 'nearby-stars' ||
      object.kind === 'exoplanet' ||
      (object.kind === 'star' && object.id !== 'sun')
    )
      return 'nearby-stars'
    if (object.body || ['sun', 'moon', 'solar-system'].includes(object.id))
      return 'solar-system'
    if (
      ['milky-way', 'local-group', 'universe', 'laniakea', 'virgo'].includes(
        object.id,
      )
    )
      return object.id
    if (object.kind === 'galaxy') return 'local-group'
    return object.id
  }

  private focusMapObject(object: CelestialObject, immediate = false) {
    this.ensureMapDestination(object)
    const destination = this.mapNodes.get(object.id)
    if (!destination || object.id === this.mapContext) {
      this.followNode = null
      this.reset(immediate)
      return
    }
    destination.node.getWorldPosition(this.targetLookAt)
    const distance = this.cameraDistance(
      destination.radius * (object.id === 'saturn' ? 2.9 : 1.5),
    )
    const approach = new THREE.Vector3(0.2, 0.25, 1)
      .normalize()
      .multiplyScalar(distance)
    this.targetCamera.copy(this.targetLookAt).add(approach)
    this.controls.minDistance = destination.radius * 1.1
    this.followNode = destination.node
    this.previousFocus.copy(this.targetLookAt)
    this.dollying = false
    this.flying = !immediate
    if (immediate) {
      this.camera.position.copy(this.targetCamera)
      this.controls.target.copy(this.targetLookAt)
      this.controls.update()
    }
  }

  private createWorldVisual(object: CelestialObject) {
    const parent = new THREE.Group()
    const previousContent = this.content
    const previousRadius = this.fitRadius
    this.content = parent
    this.buildingWorldVisual = true
    try {
      switch (object.scene) {
        case 'spacecraft':
          parent.add(this.spacecraft(object))
          break
        case 'planet':
          parent.add(this.planet(object, 1, true))
          break
        case 'star':
          parent.add(this.star(object, 1))
          break
        case 'comet':
          parent.add(this.comet(object, 1))
          break
        case 'black-hole':
          this.buildBlackHole(object)
          break
        case 'galaxy': {
          this.buildGalaxy(object)
          const galaxy = parent.getObjectByName('galaxy-volume')
          if (galaxy && object.id === 'milky-way')
            galaxy.rotation.set(0, Math.PI, 0)
          const duplicateMarkers: THREE.Object3D[] = []
          parent.traverse((node) => {
            if (node.userData.pointIds || node.userData.objectId)
              duplicateMarkers.push(node)
          })
          duplicateMarkers.forEach((node) => {
            node.removeFromParent()
            disposeGroup(node)
          })
          break
        }
        case 'nebula':
        case 'supernova':
          this.buildNebula(object)
          break
        case 'pulsar':
          this.buildPulsar(object)
          break
        case 'star-cluster':
          this.buildStarCluster(object)
          break
        case 'cluster':
          this.buildCluster(object)
          break
        case 'void':
          this.buildVoid()
          break
        case 'universe':
          this.buildUniverse(object)
          break
      }
    } finally {
      this.content = previousContent
      this.fitRadius = previousRadius
      this.buildingWorldVisual = false
    }
    this.spectralAppearance.bind(parent, object)
    return parent
  }

  private releaseWorldVisual(root: THREE.Group) {
    disposeModelAssets(root)
    const descendants = new Set<THREE.Object3D>()
    const materials = new Set<THREE.Material>()
    root.traverse((node) => {
      descendants.add(node)
      const material = (node as THREE.Mesh).material
      if (material)
        (Array.isArray(material) ? material : [material]).forEach((item) =>
          materials.add(item),
        )
    })
    this.rotating = this.rotating.filter(({ node }) => !descendants.has(node))
    this.billboards = this.billboards.filter((node) => !descendants.has(node))
    this.shaders = this.shaders.filter((material) => !materials.has(material))
    this.orbitLines = this.orbitLines.filter((node) => !descendants.has(node))
  }

  private activateContinuousMap(
    object: CelestialObject,
    view: ViewMode,
    immediate: boolean,
  ) {
    if (view !== 'map') {
      this.continuousMap?.dispose()
      this.continuousMap = null
      this.starfield.visible = true
      return false
    }
    this.selected = object
    this.view = view
    this.flying = false
    this.followNode = null
    if (!this.continuousMap) {
      this.labels.forEach(({ element }) => element.remove())
      this.labels = []
      this.entries = []
      this.rotating = []
      this.orbitLines = []
      this.shaders = []
      this.billboards = []
      this.minorCloud = null
      disposeGroup(this.content)
      this.content.clear()
      this.continuousMap = new ContinuousMap(
        this.camera,
        this.controls,
        this.host,
        this.labelHost,
        this.options,
        this.timestamp,
        (item) => this.createWorldVisual(item),
        (root) => this.releaseWorldVisual(root),
        this.onSelect,
      )
      this.content.add(this.continuousMap.root)
      this.renderer.domElement.dataset.mapGeneration = String(
        ++this.mapGeneration,
      )
      this.continuousMap.flyTo(object.id, true)
    } else this.continuousMap.flyTo(object.id, immediate)
    this.starfield.visible = false
    this.renderer.domElement.dataset.scene = object.id
    this.renderer.domElement.dataset.view = 'map'
    this.renderer.domElement.dataset.ready = 'true'
    this.renderer.domElement.dataset.mapContext = 'unified'
    this.updateRenderResolution()
    this.updateSpectrum()
    return true
  }

  private updateSpectrum() {
    const conceptual =
      this.selected.visualization === 'dark-matter' ||
      this.selected.visualization === 'dark-energy'
    const band =
      this.view === 'sky' || this.view === 'compare' || conceptual
        ? 'visible'
        : (this.options.spectrum ?? 'visible')
    this.spectralAppearance.setBand(
      band,
      this.content,
      this.options.radioExposure,
    )
    this.content.traverse((node) => {
      if (node.userData.spectralBands)
        node.visible = node.userData.spectralBands.includes(band)
    })
    this.starfield.visible =
      band === 'visible' &&
      this.view !== 'map' &&
      this.view !== 'sky' &&
      this.selected.kind !== 'void' &&
      !conceptual
    this.renderer.domElement.dataset.observationBand = band
  }

  setObject(object: CelestialObject, view: ViewMode, immediate = false) {
    this.renderer.setClearColor('#060809')
    this.controls.enablePan = view !== 'sky'
    this.camera.fov = view === 'sky' ? (this.options.skyFocus ? 2 : 65) : 43
    this.camera.updateProjectionMatrix()
    if (this.activateContinuousMap(object, view, immediate)) return
    const nextContext = view === 'map' ? this.mapContextFor(object) : null
    const reuseMap =
      nextContext !== null &&
      nextContext === this.mapContext &&
      this.view === 'map'
    this.selected = object
    this.view = view
    this.updateRenderResolution()
    if (reuseMap) {
      this.focusMapObject(object, immediate)
      this.renderer.domElement.dataset.scene = object.id
      return
    }
    this.mapContext = nextContext
    this.mapNodes.clear()
    this.pointCount = 0
    this.minorCloud = null
    this.activeDetail = null
    this.followNode = null
    this.targetLookAt.set(0, 0, 0)
    this.labels.forEach(({ element }) => element.remove())
    this.labels = []
    disposeGroup(this.content)
    this.content.clear()
    this.entries = []
    this.rotating = []
    this.orbitLines = []
    this.shaders = []
    this.billboards = []
    this.orbitPerspective = false
    this.skyLayer = null
    this.earthMoonPair = null
    const displayObject = nextContext
      ? (objectById.get(nextContext) ?? object)
      : object
    if (view === 'sky') {
      this.buildSky()
    } else if (view === 'compare') {
      this.buildComparison()
    } else if (nextContext === 'nearby-stars') {
      this.buildStellarMap()
    } else if (
      view === 'orbit' &&
      ['ephemeris', 'kepler'].includes(object.orbit.model)
    ) {
      this.buildSystem(object, true)
    } else {
      switch (displayObject.scene) {
        case 'spacecraft':
          this.fitRadius = 1.1
          this.content.add(this.spacecraft(displayObject))
          break
        case 'comet':
          this.fitRadius = 3.1
          this.content.add(this.comet(displayObject))
          break
        case 'planet':
          this.buildPlanet(displayObject)
          break
        case 'star':
          this.fitRadius = 2.2
          this.content.add(this.star(displayObject))
          break
        case 'system':
          this.buildSystem(displayObject, false)
          break
        case 'black-hole':
          this.buildBlackHole(displayObject)
          break
        case 'nebula':
        case 'supernova':
          this.buildNebula(displayObject)
          break
        case 'pulsar':
          this.buildPulsar(displayObject)
          break
        case 'star-cluster':
          this.buildStarCluster(displayObject)
          break
        case 'galaxy':
          this.buildGalaxy(displayObject)
          break
        case 'cluster':
          this.buildCluster(displayObject)
          break
        case 'void':
          this.buildVoid()
          this.starfield.visible = false
          break
        case 'universe':
          this.buildUniverse(displayObject)
          break
      }
    }
    this.controls.minDistance =
      object.scene === 'planet' && view === 'object'
        ? 1.8
        : this.fitRadius * 0.17
    this.controls.maxDistance = Math.max(
      25,
      this.fitRadius * 10,
      this.cameraDistance() * 1.1,
    )
    if (view === 'sky') {
      this.controls.minDistance = 0.08
      this.controls.maxDistance = 0.12
    }
    if (view === 'map') {
      this.controls.minDistance = 0.035
      this.controls.maxDistance = 220
      this.content.traverse((node) => {
        if (
          node.userData.objectId &&
          !this.mapNodes.has(node.userData.objectId)
        ) {
          const radius =
            (node as THREE.Mesh<THREE.SphereGeometry>).geometry?.parameters
              ?.radius ?? 0.4
          this.mapNodes.set(node.userData.objectId, { node, radius })
        }
      })
    }
    this.lastEphemeris = -Infinity
    this.orbitLines.forEach((line) => {
      line.visible = this.options.orbits
    })
    this.renderer.domElement.dataset.scene = object.id
    this.renderer.domElement.dataset.view = view
    this.renderer.domElement.dataset.ready = 'true'
    this.renderer.domElement.dataset.mapContext = nextContext ?? ''
    this.renderer.domElement.dataset.mapGeneration = String(
      ++this.mapGeneration,
    )
    this.renderer.domElement.dataset.mapObjects = String(
      this.mapNodes.size + this.pointCount,
    )
    if (view !== 'sky') this.spectralAppearance.bind(this.content, displayObject)
    this.updateSpectrum()
    if (view === 'map') this.focusMapObject(object, immediate)
    else this.reset(immediate)
  }

  setTime(timestamp: number) {
    this.timestamp = timestamp
    this.continuousMap?.setTime(timestamp)
    this.updateEarthMoon()
  }

  setOptions(options: SceneOptions) {
    const skyChanged =
      JSON.stringify(this.options.observer) !==
        JSON.stringify(options.observer) ||
      this.options.skyFocus !== options.skyFocus ||
      this.options.catalogRevision !== options.catalogRevision
    const comparisonChanged =
      JSON.stringify(this.options.comparison) !==
      JSON.stringify(options.comparison)
    const rulerChanged =
      Boolean(this.options.ruler) !== Boolean(options.ruler)
    const galaxyStyleChanged =
      this.options.galaxyStyle !== options.galaxyStyle
    const rebuild =
      (this.options.compressed !== options.compressed ||
        this.options.catalogRevision !== options.catalogRevision) &&
      (this.selected.scene === 'system' ||
        this.mapContext === 'solar-system' ||
        this.mapContext === 'nearby-stars')
    const refit = this.options.inspectorOpen !== options.inspectorOpen
    const uiChanged =
      Boolean(this.options.uiHidden) !== Boolean(options.uiHidden)
    const qualityChange = this.options.highQuality !== options.highQuality
    const spectrumChanged =
      this.options.spectrum !== options.spectrum ||
      this.options.radioExposure !== options.radioExposure
    const candidatesChanged =
      this.options.showCandidates !== options.showCandidates
    this.options = options
    if (spectrumChanged) this.updateSpectrum()
    if (galaxyStyleChanged)
      this.scene.traverse((node) => {
        if (node.userData.referenceOnly)
          node.visible = options.galaxyStyle === 'reference'
      })
    this.renderer.domElement.dataset.uiHidden = String(
      Boolean(options.uiHidden),
    )
    this.renderer.domElement.dataset.catalogReady = String(
      Boolean(options.catalogRevision),
    )
    this.controls.mouseButtons.LEFT =
      options.navigation === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    this.controls.mouseButtons.RIGHT =
      options.navigation === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN
    this.controls.touches.ONE =
      options.navigation === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE
    this.renderer.domElement.dataset.navigation =
      options.navigation ?? 'orbit'
    if (this.view === 'sky' && skyChanged) {
      this.setObject(this.selected, this.view, true)
      return
    }
    if (this.view === 'compare' && comparisonChanged) {
      this.setObject(this.selected, this.view, true)
      return
    }
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.setOptions(options)
      if (qualityChange || refit || uiChanged || rulerChanged)
        this.resize(uiChanged || rulerChanged)
      return
    }
    if (
      candidatesChanged &&
      this.selected.visualization === 'proxima-system'
    ) {
      this.setObject(this.selected, this.view, true)
      return
    }
    if (qualityChange) {
      this.updateRenderResolution()
      this.resize()
    }
    this.orbitLines.forEach((line) => {
      line.visible = options.orbits
    })
    if (rebuild) {
      this.mapContext = null
      this.setObject(this.selected, this.view)
    }
    if (refit) this.resize()
    else if (uiChanged) this.resize(true)
  }

  private cameraDistance(radius = this.fitRadius) {
    const { width, height } = this.host.getBoundingClientRect()
    const mobile = width < 760
    const availableWidth = this.options.uiHidden
      ? width * 0.94
      : mobile
        ? width - 76
        : width -
          (width < 1100 ? 220 : 252) -
          (this.options.inspectorOpen ? 330 : 54) -
          70
    const availableHeight = this.options.uiHidden
      ? height * 0.94
      : mobile
        ? Math.max(110, height - 278 - (this.view === 'map' ? 275 : 255))
        : height * 0.7
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    return (
      radius /
      (tangent * Math.min(availableWidth / height, availableHeight / height))
    )
  }

  reset(immediate = false) {
    if (this.view === 'sky') {
      const direction = this.options.skyFocus
        ? observerBody(
            this.options.skyFocus === 'Sun' ? Body.Sun : Body.Moon,
            new Date(this.timestamp),
            this.options.observer ?? defaultObserver,
          ).direction
        : horizontalDirection(180, 25)
      this.camera.position.fromArray(direction).multiplyScalar(-0.1)
      this.controls.target.set(0, 0, 0)
      this.camera.lookAt(this.controls.target)
      this.controls.update()
      this.flying = this.dollying = false
      this.renderer.domElement.dataset.flying = 'false'
      return
    }
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.reset()
      return
    }
    this.followNode = null
    this.dollying = false
    this.targetLookAt.set(0, 0, 0)
    const distance = this.cameraDistance()
    this.renderer.domElement.dataset.cameraFitDistance = String(distance)
    this.targetCamera.set(
      0,
      distance *
        (this.orbitPerspective
          ? 0.7
          : this.selected.scene === 'galaxy'
            ? 0.48
            : 0.04),
      distance *
        (this.orbitPerspective
          ? 0.714
          : this.selected.scene === 'galaxy'
            ? 0.877
            : 1),
    )
    this.flying = !immediate
    if (immediate) {
      this.camera.position.copy(this.targetCamera)
      this.controls.target.copy(this.targetLookAt)
      this.controls.update()
    }
  }

  zoom(factor: number) {
    this.renderer.domElement.dataset.lastZoomFactor = String(factor)
    if (this.view === 'sky') {
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * factor, 0.2, 90)
      this.camera.updateProjectionMatrix()
      return
    }
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.zoom(factor)
      return
    }
    const direction = (this.dollying ? this.targetCamera : this.camera.position)
      .clone()
      .sub(this.controls.target)
    const nextDistance = THREE.MathUtils.clamp(
      direction.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    this.targetCamera
      .copy(this.controls.target)
      .add(direction.setLength(nextDistance))
    this.targetLookAt.copy(this.controls.target)
    this.dollying = true
    this.flying = true
  }

  setMapScale(distancePc: number) {
    this.continuousMap?.setScale(distancePc)
  }

  followBody(id: string | null) {
    this.continuousMap?.setFollow(id)
  }

  toggleFollow(id: string) {
    this.continuousMap?.toggleFollow(id)
  }

  frameRuler() {
    this.continuousMap?.frameRuler()
  }

  capturePose(): CameraPose {
    return (
      this.continuousMap?.capturePose() ?? {
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
        up: this.camera.up.toArray(),
        fov: this.camera.fov,
      }
    )
  }

  restoreViewpoint(point: Viewpoint) {
    const object = objectById.get(point.objectId)
    if (!object) return
    this.timestamp = point.timestamp
    this.setObject(object, point.view, true)
    this.flying = this.dollying = false
    this.followNode = null
    this.clearMovement()
    const damping = this.controls.enableDamping
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.enableDamping = damping
    if (this.continuousMap) this.continuousMap.restorePose(point.camera)
    else {
      this.camera.fov = point.camera.fov ?? 43
      this.camera.updateProjectionMatrix()
      this.camera.up.fromArray(point.camera.up).normalize()
      this.camera.position.fromArray(point.camera.position)
      this.controls.target.fromArray(point.camera.target)
      this.camera.lookAt(this.controls.target)
      this.controls.update()
    }
    this.renderer.domElement.dataset.flying = 'false'
    this.renderer.domElement.dataset.cameraFov = String(this.camera.fov)
    this.renderer.domElement.dataset.viewpointApplied = point.name
  }

  screenshot() {
    const navigationQuality = this.navigationQuality
    this.navigationQuality = false
    this.updateRenderResolution(true)
    try {
      this.renderer.render(this.scene, this.camera)
      const link = document.createElement('a')
      link.href = this.renderer.domElement.toDataURL('image/png')
      link.download = `hello-world-${this.selected.id}-${new Date(this.timestamp).toISOString().slice(0, 10)}.png`
      link.click()
    } finally {
      this.navigationQuality = navigationQuality
      this.updateRenderResolution()
    }
  }

  private updateNavigationQuality(now: number) {
    this.viewOffset.copy(this.camera.position).sub(this.controls.target)
    const moved =
      this.controlActive ||
      (this.view !== 'map' && this.flying) ||
      (this.view === 'map' &&
        (this.pressedKeys.size > 0 ||
          this.renderer.domElement.dataset.flying === 'true')) ||
      this.viewOffset.distanceToSquared(this.previousViewOffset) >
        Math.max(1e-24, this.viewOffset.lengthSq() * 1e-8) ||
      1 - Math.abs(this.camera.quaternion.dot(this.previousViewRotation)) > 1e-8
    if (moved) this.lastCameraMotion = now
    this.previousViewOffset.copy(this.viewOffset)
    this.previousViewRotation.copy(this.camera.quaternion)
    const reduced =
      this.options.adaptiveQuality !== false &&
      (moved || now - this.lastCameraMotion < 300)
    if (reduced !== this.navigationQuality) {
      this.navigationQuality = reduced
      this.updateRenderResolution()
    }
  }

  private updateRenderResolution(fullQuality = false) {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    const blackHole = this.continuousMap
      ? this.continuousMap.nearBlackHole
      : this.selected.scene === 'black-hole'
    const budget = blackHole
      ? this.options.highQuality
        ? 640000
        : 360000
      : this.options.highQuality
        ? 5000000
        : 2000000
    const reduced =
      this.navigationQuality &&
      !fullQuality &&
      this.options.adaptiveQuality !== false
    const ratio =
      Math.min(
        window.devicePixelRatio,
        this.options.highQuality ? 2 : 1.25,
        Math.sqrt(budget / (width * height)),
      ) * (reduced ? 0.7 : 1)
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 0.001)
      this.renderer.setPixelRatio(ratio)
    this.renderer.domElement.dataset.renderQuality = reduced
      ? 'navigation'
      : 'full'
    this.renderer.domElement.dataset.renderPixelRatio = ratio.toFixed(3)
    this.scene.traverse((node) => {
      const material = (node as THREE.Points).material as
        THREE.ShaderMaterial | undefined
      if (material?.uniforms?.uPixelRatio)
        material.uniforms.uPixelRatio.value = ratio
    })
  }

  private resize(preserveCamera = false) {
    const { width, height } = this.host.getBoundingClientRect()
    if (!width || !height) return
    this.updateRenderResolution()
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    const mobile = width < 760
    const left = width < 1100 ? 220 : 252
    const right = this.options.inspectorOpen ? 330 : 54
    if (this.options.uiHidden) this.camera.clearViewOffset()
    else
      this.camera.setViewOffset(
        width,
        height,
        mobile ? 19 : (right - left) / 2,
        mobile
          ? this.options.ruler
            ? height * 0.18
            : (278 - (this.view === 'map' ? 275 : 255)) / 2
          : -height * 0.015,
        width,
        height,
      )
    this.camera.updateProjectionMatrix()
    this.renderer.domElement.dataset.cameraFov = String(this.camera.fov)
    if (preserveCamera || (this.continuousMap && this.view === 'map')) return
    if (this.view === 'map' && this.mapNodes.has(this.selected.id))
      this.focusMapObject(this.selected)
    else this.reset()
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.pointerDown.set(event.clientX, event.clientY)
    const panning =
      this.options.navigation === 'pan'
        ? event.button === 0
        : event.button === 2
    if (
      panning ||
      (event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey))
    )
      this.interruptFlight()
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (
      this.pointerDown.distanceTo(
        new THREE.Vector2(event.clientX, event.clientY),
      ) > 5
    )
      return
    const bounds = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.pick(pointer)
      return
    }
    this.raycaster.setFromCamera(pointer, this.camera)
    this.raycaster.params.Points.threshold = Math.max(
      0.025,
      this.controls.getDistance() * 0.0025,
    )
    const intersection = this.raycaster
      .intersectObjects(this.content.children, true)
      .find(
        (hit) =>
          hit.object.userData.objectId ||
          (hit.object.userData.pointIds && hit.index !== undefined),
      )
    if (intersection)
      this.onSelect(
        intersection.object.userData.objectId ??
          intersection.object.userData.pointIds[intersection.index!],
      )
  }

  private animate = (now: number) => {
    this.frame = 0
    if (this.disposed || this.contextLost || document.hidden) return
    const elapsed = Math.max(0, (now - (this.lastFrame || now)) / 1000)
    const delta = Math.min(elapsed, 0.05)
    this.lastFrame = now
    this.controls.dampingFactor = cameraDampingFactor(elapsed)
    if (
      this.view === 'sky' &&
      Math.abs(this.timestamp - this.lastSkyTime) > 30000 &&
      now - this.lastSkyFrame > 250
    ) {
      this.updateSky()
      this.lastSkyFrame = now
    }
    if (this.options.playing) this.visualTime += Math.min(elapsed, 0.2)
    this.renderer.domElement.dataset.visualTime = this.visualTime.toFixed(4)
    if (this.continuousMap && this.view === 'map') {
      const blackHoleBefore = this.continuousMap.nearBlackHole
      this.continuousMap.update(
        now,
        elapsed,
        document.querySelector('dialog[open]')
          ? new Set<string>()
          : this.pressedKeys,
      )
      if (blackHoleBefore !== this.continuousMap.nearBlackHole)
        this.updateRenderResolution()
      this.rotating.forEach(({ node, hours, speed, base }) => {
        node.rotation.y =
          base +
          (hours
            ? ((this.timestamp - initialEpoch) / (hours * 3_600_000)) *
              Math.PI *
              2
            : this.visualTime * (speed ?? 0.03))
      })
      this.shaders.forEach((shader) => {
        shader.uniforms.uTime.value = this.visualTime
      })
      this.billboards.forEach((node) =>
        node.quaternion.copy(this.camera.quaternion),
      )
      this.updateNavigationQuality(now)
      this.renderer.render(this.scene, this.camera)
      this.renderer.domElement.dataset.frame = String(Math.round(now))
      this.renderer.domElement.dataset.simulationTime = String(
        Math.round(this.timestamp),
      )
      this.renderer.domElement.dataset.cameraDistance = this.controls
        .getDistance()
        .toFixed(6)
      this.renderer.domElement.dataset.cameraTarget = this.controls.target
        .toArray()
        .join(',')
      this.scheduleFrame()
      return
    }
    if (this.flying) {
      const damping =
        1 - Math.exp(-Math.min(elapsed, 0.5) * (this.dollying ? 10 : 4))
      this.camera.position.lerp(this.targetCamera, damping)
      this.controls.target.lerp(this.targetLookAt, damping)
      if (
        this.camera.position.distanceTo(this.targetCamera) < 0.002 &&
        this.controls.target.distanceTo(this.targetLookAt) < 0.002
      ) {
        this.flying = false
        this.dollying = false
      }
    }
    this.rotating.forEach(({ node, hours, speed, base }) => {
      node.rotation.y =
        base +
        (hours
          ? ((this.timestamp - initialEpoch) / (hours * 3_600_000)) *
            Math.PI *
            2
          : this.visualTime * (speed ?? 0.03))
    })
    this.shaders.forEach((shader) => {
      shader.uniforms.uTime.value = this.visualTime
    })
    this.billboards.forEach((node) =>
      node.quaternion.copy(this.camera.quaternion),
    )
    if (Math.abs(this.timestamp - this.lastEphemeris) > 1_000) {
      const date = new Date(this.timestamp)
      this.entries.forEach(({ node, object, scale, compressed, parent }) => {
        const position = getPosition(object, date)
        node.visible = position.every(Number.isFinite)
        if (!node.visible) return
        node.position
          .fromArray(displayPosition(position, compressed))
          .multiplyScalar(scale)
        if (parent) node.position.add(parent.position)
      })
      this.lastEphemeris = this.timestamp
    }
    if (
      this.minorCloud &&
      Math.abs(this.timestamp - this.lastMinorUpdate) > DAY_MS * 2
    ) {
      const positions = this.minorCloud.points.geometry.attributes.position
      const date = new Date(this.timestamp)
      this.minorCloud.elements.forEach((elements, index) => {
        const physical = smallBodyPosition(elements, date)
        const position = displayPosition(physical, this.options.compressed).map(
          (value) => value * (this.options.compressed ? 1 : 0.42),
        )
        positions.setXYZ(
          index,
          ...(position.map((value) =>
            Number.isFinite(value) ? value : 1e7,
          ) as [number, number, number]),
        )
      })
      positions.needsUpdate = true
      this.minorCloud.points.geometry.computeBoundingSphere()
      this.lastMinorUpdate = this.timestamp
    }
    if (this.followNode) {
      const position = this.followNode.getWorldPosition(new THREE.Vector3())
      const offset = position.clone().sub(this.previousFocus)
      this.camera.position.add(offset)
      this.controls.target.add(offset)
      this.targetCamera.add(offset)
      this.targetLookAt.add(offset)
      this.previousFocus.copy(position)
    }
    const movement = new THREE.Vector3()
    if (this.view === 'map' && !document.querySelector('dialog[open]')) {
      const forward =
        Number(this.pressedKeys.has('KeyS')) -
        Number(this.pressedKeys.has('KeyW'))
      const right =
        Number(this.pressedKeys.has('KeyD')) -
        Number(this.pressedKeys.has('KeyA'))
      const up =
        Number(this.pressedKeys.has('KeyE')) -
        Number(this.pressedKeys.has('KeyQ'))
      const boost =
        this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')
          ? 3
          : 1
      movement
        .set(right, up, forward)
        .applyQuaternion(this.camera.quaternion)
        .multiplyScalar(
          Math.max(0.05, this.controls.getDistance() * 0.5) * boost,
        )
    }
    this.movementVelocity.lerp(movement, 1 - Math.exp(-delta * 9))
    const translation = this.movementVelocity.clone().multiplyScalar(delta)
    this.camera.position.add(translation)
    this.controls.target.add(translation)
    this.controls.update()
    this.updateNavigationQuality(now)
    this.renderer.render(this.scene, this.camera)
    const width = this.host.clientWidth
    const height = this.host.clientHeight
    const mobile = width < 760
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
    const sortedLabels = [...this.labels].sort(
      (first, second) =>
        Number(second.id === this.selected.id) -
        Number(first.id === this.selected.id),
    )
    sortedLabels.forEach(({ element, anchor, offset }) => {
      anchor.getWorldPosition(this.screenVector)
      this.screenVector.project(this.camera)
      const horizontal = (this.screenVector.x * 0.5 + 0.5) * width
      const vertical = (-this.screenVector.y * 0.5 + 0.5) * height
      const halfWidth = Math.min(
        180,
        (element.textContent?.length ?? 10) * 3.2 + 13,
      )
      const bounds = {
        left: horizontal - halfWidth,
        right: horizontal + halfWidth,
        top: vertical + offset - 2,
        bottom: vertical + offset + 23,
      }
      const inBounds =
        bounds.left > (mobile ? 16 : width < 1100 ? 235 : 267) &&
        bounds.right <
          width - (mobile ? 55 : this.options.inspectorOpen ? 398 : 70) &&
        bounds.top > (mobile ? 255 : 215) &&
        bounds.bottom < height - (mobile ? 275 : 185)
      const collision = occupied.some(
        (other) =>
          bounds.left < other.right + 4 &&
          bounds.right > other.left - 4 &&
          bounds.top < other.bottom + 4 &&
          bounds.bottom > other.top - 4,
      )
      const visible =
        this.options.labels &&
        (!anchor.userData.surfaceRegion ||
          anchor.getWorldPosition(new THREE.Vector3()).sub(anchor.parent!.getWorldPosition(new THREE.Vector3()))
            .dot(this.camera.position.clone().sub(anchor.parent!.getWorldPosition(new THREE.Vector3()))) > 0) &&
        inBounds &&
        !collision &&
        this.screenVector.z < 1 &&
        this.screenVector.z > -1
      element.style.display = visible ? '' : 'none'
      if (visible) occupied.push(bounds)
      element.style.transform = `translate(${horizontal}px, ${vertical + offset}px) translateX(-50%)`
    })
    this.renderer.domElement.dataset.cameraDistance = this.camera.position
      .distanceTo(this.controls.target)
      .toFixed(3)
    this.renderer.domElement.dataset.simulationTime = String(
      Math.round(this.timestamp),
    )
    this.renderer.domElement.dataset.frame = String(Math.round(now))
    this.renderer.domElement.dataset.cameraTarget = this.controls.target
      .toArray()
      .map((value) => value.toFixed(3))
      .join(',')
    this.renderer.domElement.dataset.flying = String(this.flying)
    this.scheduleFrame()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.continuousMap?.dispose()
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.controls.removeEventListener('start', this.handleControlStart)
    this.controls.removeEventListener('end', this.handleControlEnd)
    this.controls.dispose()
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.handlePointerDown,
      true,
    )
    this.renderer.domElement.removeEventListener(
      'pointerup',
      this.handlePointerUp,
    )
    this.renderer.domElement.removeEventListener(
      'wheel',
      this.handleWheel,
      true,
    )
    this.labelHost.removeEventListener('wheel', this.handleWheel, true)
    window.removeEventListener('keydown', this.handleMoveKey)
    window.removeEventListener('keyup', this.handleMoveKey)
    window.removeEventListener('blur', this.clearMovement)
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.handleContextLost,
    )
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    )
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    )
    this.labels.forEach(({ element }) => element.remove())
    disposeGroup(this.content)
    disposeGroup(this.starfield)
    this.textures.forEach((texture) => texture.dispose())
    this.modelData.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
