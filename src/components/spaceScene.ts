import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { ContinuousMap } from './ContinuousMap'
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

export interface SceneOptions {
  orbits: boolean
  labels: boolean
  compressed: boolean
  playing: boolean
  highQuality: boolean
  inspectorOpen: boolean
  catalogRevision?: number
  navigation?: 'orbit' | 'pan'
}

export type ViewMode = 'map' | 'object' | 'orbit'

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
  private camera = new THREE.PerspectiveCamera(43, 1, 0.025, 500)
  private controls: OrbitControls
  private content = new THREE.Group()
  private continuousMap: ContinuousMap | null = null
  private buildingWorldVisual = false
  private starfield: THREE.Points
  private textures = new Map<string, THREE.Texture>()
  private loader = new THREE.TextureLoader()
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

  private handleControlStart = () => this.interruptFlight(true)

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
        Math.exp(THREE.MathUtils.clamp(event.deltaY * units * 0.0016, -40, 40)),
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
      path,
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
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vPosition))), 3.8);
          gl_FragColor = vec4(glowColor, rim * strength);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    return new THREE.Mesh(new THREE.SphereGeometry(radius, 72, 48), material)
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
    const group = new THREE.Group()
    const surfaceMap = object.texture
      ? this.texture(object.texture)
      : object.jovianMoon
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
      new THREE.SphereGeometry(radius, detailed ? 96 : 40, detailed ? 64 : 28),
      material,
    )
    surface.rotation.y = object.id === 'earth' ? 4.15 : 0.4
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
      this.rotating.push({ node: clouds, hours: 24.3, base: clouds.rotation.y })
    } else if (detailed && ['venus', 'neptune', 'uranus'].includes(object.id)) {
      group.add(this.atmosphere(radius * 1.02, object.color, 0.28))
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
        const length = Math.hypot(positions.getX(index), positions.getY(index))
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
    } else {
      group.rotation.z = object.id === 'uranus' ? -1.7 : -0.12
    }
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

  private buildSystem(object: CelestialObject, single: boolean) {
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
    this.fitRadius = single ? 7.8 : 14.2
    this.orbitPerspective = true
    const date = new Date(this.timestamp)
    bodies.forEach((planet) => {
      const scale = single
        ? 6 /
          Math.max(
            0.001,
            Math.abs(
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
        ? 0.24
        : ['jupiter', 'saturn'].includes(planet.id)
          ? 0.23
          : 0.11
      const model =
        planet.kind === 'comet'
          ? this.comet(planet, radius * 0.25)
          : this.planet(planet, radius, true)
      this.mapNodes.set(planet.id, { node: model, radius })
      const position = displayPosition(getPosition(planet, date), compressed)
      model.position.fromArray(position).multiplyScalar(scale)
      this.content.add(model)
      this.entries.push({ node: model, object: planet, scale, compressed })
      this.addLabel(planet.name, planet.id, model, 15)
      const points = sampleOrbit(planet, date, 220).map((point) =>
        new THREE.Vector3(...displayPosition(point, compressed)).multiplyScalar(
          scale,
        ),
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
        uniform float uTime, uActiveNucleus;
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
          vec3 warm = vec3(1.0, 0.6, 0.22);
          vec3 hot = vec3(1.0, 0.94, 0.78);
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
            if (previousHeight * nextHeight < 0.0) {
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
          radiance += vec3(1.0, 0.72, 0.39) * photonGlow * 0.025;
          float alpha = captured ? 1.0 : max(1.0 - transmission, photonGlow * 0.06);
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
    this.fitRadius = object.kind === 'quasar' ? 5.1 : 4.85
    const group = new THREE.Group()
    group.name = 'black-hole-lensing'
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      this.blackHoleMaterial(object.color, object.kind === 'quasar'),
    )
    image.name = 'ray-bent-accretion-disk'
    image.onBeforeRender = () => {
      image.material.uniforms.uSpaceInverse.value
        .copy(group.matrixWorld)
        .invert()
    }
    image.userData.objectId = object.id
    image.renderOrder = 3
    group.add(image)
    this.billboards.push(image)
    if (object.kind === 'quasar' || object.id === 'm87-black-hole') {
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

  private buildNebula(object: CelestialObject) {
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
    const shell = object.scene === 'supernova' || object.id === 'helix'
    for (let index = 0; index < 14500; index++) {
      const azimuth = random() * Math.PI * 2
      const vertical = random() * 2 - 1
      const radial = shell
        ? 1.7 + Math.pow(random(), 3) * 1.3
        : Math.pow(random(), 0.65) * 4
      const circular = Math.sqrt(1 - vertical * vertical)
      const wobble = 1 + Math.sin(azimuth * 5 + vertical * 8) * 0.22
      const horizontal = Math.cos(azimuth) * radial * circular * wobble
      const altitude = vertical * radial * (shell ? 0.78 : 0.55)
      const depth = Math.sin(azimuth) * radial * circular * 0.65
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
      colors.push(color.r, color.g, color.b)
      sizes.push(0.22 + random() * 0.47)
    }
    const cloud = this.particles(positions, colors, sizes, shell ? 0.09 : 0.058)
    this.content.add(cloud)
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
  ) {
    const points = this.particles(positions, colors, sizes, opacity)
    points.material.uniforms.uViewportHeight = { value: this.host.clientHeight }
    points.material.uniforms.uDiffuse = { value: diffuse ? 1 : 0 }
    points.material.vertexShader = `
      attribute float aSize;
      varying vec3 vColor;
      varying float vVisibility;
      uniform float uPixelRatio, uViewportHeight, uDiffuse;
      void main() {
        vColor = color;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float worldScale = length(modelMatrix[0].xyz);
        float projectedSize = aSize * worldScale * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(-viewPosition.z, 0.0001);
        float minimumSize = mix(2.8, 1.5, uDiffuse);
        vVisibility = pow(min(1.0, projectedSize / minimumSize), 2.0) * smoothstep(0.0, aSize * worldScale * 0.8, -viewPosition.z);
        gl_PointSize = clamp(projectedSize, minimumSize, mix(56.0, 110.0, uDiffuse)) * uPixelRatio;
        gl_Position = projectionMatrix * viewPosition;
      }
    `
    points.material.fragmentShader = `
      varying vec3 vColor;
      varying float vVisibility;
      uniform float uOpacity, uDiffuse;
      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float radius = length(point) * 2.0;
        if (radius > 1.0) discard;
        float core = exp(-radius * radius * 65.0);
        float halo = exp(-radius * radius * 5.0);
        float profile = mix(core * 1.45 + halo * 0.15, halo, uDiffuse);
        float edge = 1.0 - smoothstep(0.75, 1.0, radius);
        vec3 light = mix(vColor, mix(vColor, vec3(1.0), core * 0.1), 1.0 - uDiffuse);
        gl_FragColor = vec4(light, min(1.0, profile * uOpacity * vVisibility * edge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
    const normal = new THREE.Vector3()
    const sight = new THREE.Vector3()
    points.onBeforeRender = () => {
      points.material.uniforms.uViewportHeight.value = this.host.clientHeight
      points.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
      normal.set(0, 1, 0).transformDirection(points.matrixWorld)
      sight
        .setFromMatrixPosition(points.matrixWorld)
        .sub(this.camera.position)
        .normalize()
      const alignment = THREE.MathUtils.clamp(Math.abs(normal.dot(sight)), 0, 1)
      points.material.uniforms.uOpacity.value =
        opacity * (diffuse ? 0.55 : 1) * (0.16 + alignment * 0.84)
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
    const arms = object.id === 'triangulum' ? 3 : 2
    const barAngle = milkyWay ? 0.7 : 0
    const count = this.buildingWorldVisual
      ? 65000
      : this.options.highQuality
        ? 180000
        : 85000
    for (let index = 0; index < count; index++) {
      const bulge = index < count * 0.11
      const bar = milkyWay && index >= count * 0.11 && index < count * 0.24
      const radial = bulge
        ? Math.pow(random(), 1.5) * 1.15
        : 0.65 + Math.pow(random(), 0.8) * 4.7
      const arm = (Math.floor(random() * arms) * Math.PI * 2) / arms
      const angle = bulge
        ? random() * Math.PI * 2
        : barAngle +
          Math.log(Math.max(radial, 1.15) / 1.15) * 2.8 +
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
          : bulge || bar
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
    galaxy.rotation.x = milkyWay ? 0.42 : object.id === 'andromeda' ? 0.2 : 0.45
    galaxy.rotation.z = milkyWay ? -0.1 : -0.24
    const stellarDisk = milkyWay
      ? this.galaxyParticles(
          positions,
          colors,
          sizes.map((size) => size * 2.5),
          0.8,
        )
      : this.particles(positions, colors, sizes, 0.15)
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
      : this.particles.bind(this)
    const haze = makeHaze(
      positions.filter((_, index) => Math.floor(index / 3) % 8 === 0),
      hazeColors.filter((_, index) => Math.floor(index / 3) % 8 === 0),
      sizes.filter((_, index) => index % 8 === 0).map(() => 0.17),
      milkyWay ? 0.05 : 0.018,
    )
    galaxy.add(haze)
    if (!milkyWay) {
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
              (0.065 + radial * 0.009 + bulge * 0.5 + (thickDisk ? 0.19 : 0)) +
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
        galaxy.userData.particleDepth = maximumHeight * 2
        this.renderer.domElement.dataset.galaxyTextureReady = 'true'
        this.renderer.domElement.dataset.galaxyParticleDepth = (
          maximumHeight * 2
        ).toFixed(3)
        this.renderer.domElement.dataset.galaxyParticles = String(
          imageSizes.length,
        )
      }
      source.src = '/textures/milky-way-nasa.jpg'
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

  private buildCluster(object: CelestialObject) {
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
      if (galaxyIndex === 0) center = new THREE.Vector3(-2.4, -0.2, 0.5)
      if (galaxyIndex === 1) center = new THREE.Vector3(2.1, 1.3, -1)
      if (galaxyIndex === 2) center = new THREE.Vector3(3.1, -1.5, 0)
      const radius = galaxyIndex < 3 ? 0.7 : 0.08 + random() * 0.24
      const tilt = new THREE.Euler(random(), random() * 2, random() * 2)
      for (
        let pointIndex = 0;
        pointIndex < (galaxyIndex < 3 ? 1500 : 80);
        pointIndex++
      ) {
        const radial = Math.pow(random(), 1.1) * radius
        const angle =
          (radial / radius) * 5 +
          Math.floor(random() * 2) * Math.PI +
          (random() - 0.5) * 0.7
        const point = new THREE.Vector3(
          Math.cos(angle) * radial,
          (random() - 0.5) * radius * 0.15,
          Math.sin(angle) * radial,
        )
          .applyEuler(tilt)
          .add(center)
        positions.push(point.x, point.y, point.z)
        colors.push(0.9, 0.76 + random() * 0.2, 0.64 + random() * 0.3)
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
    this.content.add(this.particles(positions, colors, sizes, 0.9))
  }

  private buildUniverse(object: CelestialObject) {
    this.fitRadius = 8.5
    const random = seededRandom(hashId(object.id))
    const nodes = Array.from(
      { length: 100 },
      () =>
        new THREE.Vector3(
          (random() - 0.5) * 14,
          (random() - 0.5) * 9,
          (random() - 0.5) * 10,
        ),
    )
    const positions: number[] = []
    const colors: number[] = []
    const sizes: number[] = []
    nodes.forEach((node, nodeIndex) => {
      const nearest = nodes
        .map((neighbor, index) => ({
          neighbor,
          index,
          distance: neighbor.distanceTo(node),
        }))
        .filter(({ index }) => index > nodeIndex)
        .sort((first, second) => first.distance - second.distance)
        .slice(0, 3)
      nearest.forEach(({ neighbor, distance }) => {
        if (distance > 5) return
        for (let index = 0; index < 170; index++) {
          const progress = random()
          const point = node.clone().lerp(neighbor, progress)
          const scatter = 0.08 + Math.sin(progress * Math.PI) * 0.18
          point.add(
            new THREE.Vector3(
              (random() - 0.5) * scatter * 3,
              (random() - 0.5) * scatter * 3,
              (random() - 0.5) * scatter * 3,
            ),
          )
          positions.push(point.x, point.y, point.z)
          colors.push(
            0.5 + random() * 0.5,
            0.62 + random() * 0.3,
            0.63 + random() * 0.3,
          )
          sizes.push(0.028 + random() * 0.08)
        }
      })
      for (let index = 0; index < 180; index++) {
        const spread = Math.pow(random(), 2) * 0.65
        positions.push(
          node.x + (random() - 0.5) * spread,
          node.y + (random() - 0.5) * spread,
          node.z + (random() - 0.5) * spread,
        )
        colors.push(1, 0.88, 0.72)
        sizes.push(0.035 + random() * 0.075)
      }
    })
    const web = this.particles(positions, colors, sizes, 0.75)
    this.content.add(web)
    const marker = new THREE.Object3D()
    marker.position.copy(nodes[50])
    this.content.add(marker)
    const id = object.id === 'universe' ? 'laniakea' : 'local-group'
    this.addLabel(objectById.get(id)!.name, id, marker, 16)
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
        case 'universe':
          this.buildUniverse(object)
          break
      }
    } finally {
      this.content = previousContent
      this.fitRadius = previousRadius
      this.buildingWorldVisual = false
    }
    return parent
  }

  private releaseWorldVisual(root: THREE.Group) {
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
    return true
  }

  setObject(object: CelestialObject, view: ViewMode, immediate = false) {
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
    const displayObject = nextContext
      ? (objectById.get(nextContext) ?? object)
      : object
    if (nextContext === 'nearby-stars') {
      this.buildStellarMap()
    } else if (
      view === 'orbit' &&
      ['ephemeris', 'kepler'].includes(object.orbit.model)
    ) {
      this.buildSystem(object, true)
    } else {
      switch (displayObject.scene) {
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
        case 'universe':
          this.buildUniverse(displayObject)
          break
      }
    }
    this.controls.minDistance =
      object.scene === 'planet' && view === 'object'
        ? 1.8
        : this.fitRadius * 0.17
    this.controls.maxDistance = Math.max(25, this.fitRadius * 10)
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
    if (view === 'map') this.focusMapObject(object, immediate)
    else this.reset(immediate)
  }

  setTime(timestamp: number) {
    this.timestamp = timestamp
    this.continuousMap?.setTime(timestamp)
  }

  setOptions(options: SceneOptions) {
    const rebuild =
      (this.options.compressed !== options.compressed ||
        this.options.catalogRevision !== options.catalogRevision) &&
      (this.selected.scene === 'system' ||
        this.mapContext === 'solar-system' ||
        this.mapContext === 'nearby-stars')
    const refit = this.options.inspectorOpen !== options.inspectorOpen
    const qualityChange = this.options.highQuality !== options.highQuality
    this.options = options
    this.renderer.domElement.dataset.catalogReady = String(
      Boolean(options.catalogRevision),
    )
    this.controls.mouseButtons.LEFT =
      options.navigation === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    this.controls.mouseButtons.RIGHT =
      options.navigation === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN
    this.controls.touches.ONE =
      options.navigation === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE
    this.renderer.domElement.dataset.navigation = options.navigation ?? 'orbit'
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.setOptions(options)
      if (qualityChange || refit) this.resize()
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
  }

  private cameraDistance(radius = this.fitRadius) {
    const { width, height } = this.host.getBoundingClientRect()
    const mobile = width < 760
    const availableWidth = mobile
      ? width - 76
      : width -
        (width < 1100 ? 220 : 252) -
        (this.options.inspectorOpen ? 330 : 54) -
        70
    const availableHeight = mobile
      ? Math.max(110, height - 278 - (this.view === 'map' ? 275 : 255))
      : height * 0.7
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    return (
      radius /
      (tangent * Math.min(availableWidth / height, availableHeight / height))
    )
  }

  reset(immediate = false) {
    if (this.continuousMap && this.view === 'map') {
      this.continuousMap.reset()
      return
    }
    this.followNode = null
    this.dollying = false
    this.targetLookAt.set(0, 0, 0)
    const distance = this.cameraDistance()
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

  screenshot() {
    this.renderer.render(this.scene, this.camera)
    const link = document.createElement('a')
    link.href = this.renderer.domElement.toDataURL('image/png')
    link.download = `hello-world-${this.selected.id}-${new Date(this.timestamp).toISOString().slice(0, 10)}.png`
    link.click()
  }

  private updateRenderResolution() {
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
    const ratio = Math.min(
      window.devicePixelRatio,
      this.options.highQuality ? 2 : 1.25,
      Math.sqrt(budget / (width * height)),
    )
    this.renderer.setPixelRatio(ratio)
    this.scene.traverse((node) => {
      const material = (node as THREE.Points).material as
        THREE.ShaderMaterial | undefined
      if (material?.uniforms?.uPixelRatio)
        material.uniforms.uPixelRatio.value = ratio
    })
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect()
    if (!width || !height) return
    this.updateRenderResolution()
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    const mobile = width < 760
    const left = width < 1100 ? 220 : 252
    const right = this.options.inspectorOpen ? 330 : 54
    this.camera.setViewOffset(
      width,
      height,
      mobile ? 19 : (right - left) / 2,
      mobile ? (278 - (this.view === 'map' ? 275 : 255)) / 2 : -height * 0.015,
      width,
      height,
    )
    this.camera.updateProjectionMatrix()
    if (this.continuousMap && this.view === 'map') return
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
        node.position
          .fromArray(displayPosition(getPosition(object, date), compressed))
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
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
