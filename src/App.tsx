import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Compass,
  Crosshair,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  Grid2X2,
  Hand,
  Info,
  LocateFixed,
  Maximize,
  Menu,
  Minimize,
  Minus,
  Orbit,
  PanelLeftClose,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Ruler,
  Satellite,
  Search,
  Settings2,
  Sparkles,
  Star,
  Telescope,
  X,
  Zap,
} from 'lucide-react'
import UniverseCanvas from './components/UniverseCanvas'
import DistanceRuler from './components/DistanceRuler'
import {
  readSharedViewpoint,
  readViewpoints,
  viewpointUrl,
} from './lib/viewpoints'
import type { CameraPose, Viewpoint } from './lib/viewpoints'
import { physicalRadius, scientificConfidence } from './lib/scienceTools'
import { defaultObserver } from './lib/observer'
import type { ObserverSite, SkyEvent } from './lib/observer'
import type { SceneCommand } from './components/UniverseCanvas'
import type { GalaxyStyle, ViewMode } from './components/spaceScene'
import type { MapTelemetry } from './components/ContinuousMap'
import {
  catalog,
  categories,
  earth,
  getAncestry,
  objectById,
  searchCatalog,
} from './data/catalog'
import type { CelestialObject, ObjectKind } from './data/catalog'
import {
  hasExtendedObject,
  loadExtendedCatalog,
  searchExtendedCatalog,
} from './data/extendedCatalog'
import type { CatalogMetadata } from './data/extendedCatalog'
import {
  clampTime,
  DAY_MS,
  distanceAu,
  formatDate,
  formatDistance,
  getPosition,
  sampleOrbit,
  secondsIntoDay,
} from './lib/astronomy'
import './App.css'

const kindIcons: Record<ObjectKind, typeof Globe2> = {
  planet: Globe2,
  exoplanet: Globe2,
  'rogue-planet': Globe2,
  spacecraft: Satellite,
  'dwarf-planet': CircleDot,
  comet: Sparkles,
  asteroid: Circle,
  moon: Circle,
  star: Star,
  'black-hole': CircleDot,
  nebula: Sparkles,
  supernova: Zap,
  'neutron-star': Radio,
  quasar: Telescope,
  galaxy: Orbit,
  cluster: Grid2X2,
  'star-cluster': Sparkles,
  void: Circle,
  system: Orbit,
  universe: Compass,
}

const tourStops = [
  'earth',
  'saturn',
  'solar-system',
  'sun',
  'orion',
  'crab-pulsar',
  'sagittarius-a',
  'milky-way',
  'andromeda',
  'local-group',
  '3c273',
  'universe',
]
const timeSpeeds = [
  { value: 1000 / DAY_MS, label: 'Real time' },
  { value: 1 / 1440, label: '1 minute / sec' },
  { value: 1 / 24, label: '1 hour / sec' },
  { value: 1, label: '1 day / sec' },
  { value: 10, label: '10 days / sec' },
  { value: 100, label: '100 days / sec' },
  { value: 365.25, label: '1 year / sec' },
]

function readSaved(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem('atlas-bookmarks') ||
        '["earth","saturn","sagittarius-a","andromeda"]',
    )
    return Array.isArray(value)
      ? value.filter(
          (id): id is string =>
            typeof id === 'string' &&
            (objectById.has(id) || /^(exo:|hyg-|sb:)/.test(id)),
        )
      : []
  } catch {
    return []
  }
}

function IconButton({
  label,
  children,
  active,
  className = '',
  ...props
}: {
  label: string
  children: ReactNode
  active?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  )
}

function ObjectThumb({
  object,
  small = false,
}: {
  object: CelestialObject
  small?: boolean
}) {
  const Icon = kindIcons[object.kind]
  return (
    <span
      className={`object-thumb thumb-${object.scene} ${small ? 'small' : ''}`}
      style={{ '--object-color': object.color } as CSSProperties}
    >
      {object.texture ? (
        <img
          src={
            object.texture.startsWith('/') && !object.texture.startsWith('//')
              ? `${import.meta.env.BASE_URL}${object.texture.slice(1)}`
              : object.texture
          }
          alt=""
          loading="lazy"
        />
      ) : (
        <Icon size={small ? 15 : 20} strokeWidth={1.25} />
      )}
      {object.id === 'saturn' && <span className="thumb-ring" />}
    </span>
  )
}

function OrbitDiagram({
  object,
  timestamp,
}: {
  object: CelestialObject
  timestamp: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const path = useRef<{
    id: string
    points: [number, number, number][]
  } | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const width = 272
    const height = 152
    const ratio = Math.min(window.devicePixelRatio, 2)
    canvas.width = width * ratio
    canvas.height = height * ratio
    context.scale(ratio, ratio)
    context.clearRect(0, 0, width, height)
    const date = new Date(timestamp)
    const currentPosition = getPosition(object, date)
    const ephemeris =
      ['ephemeris', 'kepler'].includes(object.orbit.model) &&
      currentPosition.every(Number.isFinite)
    if (ephemeris && path.current?.id !== object.id)
      path.current = { id: object.id, points: sampleOrbit(object, date, 120) }
    context.strokeStyle = '#ffffff08'
    context.lineWidth = 1
    for (let horizontal = 8; horizontal < width; horizontal += 22) {
      context.beginPath()
      context.moveTo(horizontal, 0)
      context.lineTo(horizontal, height)
      context.stroke()
    }
    for (let vertical = 10; vertical < height; vertical += 22) {
      context.beginPath()
      context.moveTo(0, vertical)
      context.lineTo(width, vertical)
      context.stroke()
    }
    const centerX = width / 2
    const centerY = height / 2 - 1
    context.strokeStyle = '#75898180'
    context.setLineDash([3, 4])
    if (ephemeris) {
      const scale =
        91 /
        Math.max(...path.current!.points.map((point) => Math.hypot(...point)))
      context.beginPath()
      path.current!.points.forEach((point, index) => {
        const horizontal = centerX + point[0] * scale
        const vertical = centerY + point[2] * scale * 0.52
        if (index === 0) context.moveTo(horizontal, vertical)
        else context.lineTo(horizontal, vertical)
      })
      context.stroke()
      const position = currentPosition
      const horizontal = centerX + position[0] * scale
      const vertical = centerY + position[2] * scale * 0.52
      context.setLineDash([])
      context.beginPath()
      context.moveTo(centerX, centerY)
      context.lineTo(horizontal, vertical)
      context.strokeStyle = '#cce4a631'
      context.stroke()
      context.beginPath()
      context.arc(horizontal, vertical, 4.5, 0, Math.PI * 2)
      context.fillStyle = '#d7edac'
      context.shadowBlur = 12
      context.shadowColor = '#cfe9a7'
      context.fill()
      context.shadowBlur = 0
      context.font = '10px "IBM Plex Mono"'
      context.fillStyle = '#c2c8c3'
      context.textAlign = horizontal > centerX ? 'right' : 'left'
      context.fillText(
        object.name,
        horizontal + (horizontal > centerX ? -10 : 10),
        vertical - 10,
      )
    } else {
      for (
        let index = 0;
        object.orbit.model !== 'none' && !object.trajectory && index < 3;
        index++
      ) {
        context.beginPath()
        context.ellipse(
          centerX,
          centerY,
          36 + index * 27,
          17 + index * 13,
          -0.14,
          0,
          Math.PI * 2,
        )
        context.stroke()
      }
      context.font = '10px "IBM Plex Mono"'
      context.fillStyle = '#89948e'
      context.textAlign = 'center'
      context.fillText(
        object.trajectory
          ? 'OUTSIDE EPHEMERIS COVERAGE'
          : object.orbit.model === 'none'
            ? 'NO SINGLE ORBIT'
            : 'ILLUSTRATIVE CONTEXT',
        centerX,
        height - 12,
      )
    }
    context.setLineDash([])
    if (object.orbit.model === 'none' || (object.trajectory && !ephemeris))
      return
    context.beginPath()
    context.arc(centerX, centerY, 5, 0, Math.PI * 2)
    context.fillStyle = object.id === 'moon' ? '#89bedb' : '#e8c891'
    context.shadowBlur = 15
    context.shadowColor = context.fillStyle
    context.fill()
    context.shadowBlur = 0
  }, [object, timestamp])
  return (
    <canvas
      ref={canvasRef}
      className="orbit-diagram"
      role="img"
      aria-label={`${object.name} ${object.orbit.model === 'ephemeris' ? 'calculated orbital position' : 'orbital context illustration'}`}
    />
  )
}

const ExplorationTools = lazy(() => import('./components/ExplorationTools'))

function App() {
  const [selectedId, setSelectedId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('object')
    return id && objectById.has(id) ? id : 'solar-system'
  })
  const [view, setView] = useState<ViewMode>(() => {
    const parameters = new URLSearchParams(window.location.search)
    const requested = parameters.get('view')
    if (requested === 'sky' || requested === 'compare') return requested
    const target = objectById.get(parameters.get('object') ?? 'solar-system')
    if (requested === 'orbit')
      return target && !['ephemeris', 'kepler'].includes(target.orbit.model)
        ? 'object'
        : 'orbit'
    return requested === 'object' ? 'object' : 'map'
  })
  const [query, setQuery] = useState('')
  const [catalogMetadata, setCatalogMetadata] =
    useState<CatalogMetadata | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [resultLimit, setResultLimit] = useState(24)
  const [scope, setScope] = useState<'all' | 'nearby' | 'deep'>('all')
  const [activeTab, setActiveTab] = useState<'explore' | 'saved' | 'journey'>(
    'explore',
  )
  const [expanded, setExpanded] = useState<ObjectKind[]>(['planet'])
  const [bookmarks, setBookmarks] = useState(readSaved)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showInspector, setShowInspector] = useState(true)
  const [mobileDetails, setMobileDetails] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'overview' | 'orbit'>(
    'overview',
  )
  const [orbits, setOrbits] = useState(true)
  const [labels, setLabels] = useState(true)
  const [uiHidden, setUiHidden] = useState(false)
  const [compressed, setCompressed] = useState(true)
  const [highQuality, setHighQuality] = useState(true)
  const [adaptiveQuality, setAdaptiveQuality] = useState(true)
  const [galacticDust, setGalacticDust] = useState(true)
  const [rulerOpen, setRulerOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [comparison, setComparison] = useState(['earth', 'jupiter', 'sun'])
  const [observer, setObserver] = useState<ObserverSite>(defaultObserver)
  const [skyFocus, setSkyFocus] = useState<'Sun' | 'Moon' | null>(null)
  const [activeEvent, setActiveEvent] = useState<SkyEvent | null>(null)
  const [viewpoints, setViewpoints] = useState(readViewpoints)
  const [shareUrl, setShareUrl] = useState('')
  const captureRequest = useRef({ name: '', share: false })
  const sharedStartup = useRef(readSharedViewpoint(window.location.hash))
  const [rulerEndpoints, setRulerEndpoints] = useState<[string, string]>([
    'earth',
    'sun',
  ])
  const [galaxyStyle, setGalaxyStyle] = useState<GalaxyStyle>(() => {
    try {
      return localStorage.getItem('hello-world-galaxy-style') === 'original'
        ? 'original'
        : 'reference'
    } catch {
      return 'reference'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('hello-world-galaxy-style', galaxyStyle)
    } catch {
      return
    }
  }, [galaxyStyle])
  const [navigation, setNavigation] = useState<'orbit' | 'pan'>('orbit')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(() =>
    Boolean(document.fullscreenElement),
  )
  const [timestamp, setTimestamp] = useState(Date.UTC(2026, 8, 16, 12))
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1 / 24)
  const [command, setCommand] = useState<SceneCommand | null>(null)
  const [mapPosition, setMapPosition] = useState<MapTelemetry | null>(null)
  const [notice, setNotice] = useState('')
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const sourcesRef = useRef<HTMLDialogElement>(null)
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const simulationRef = useRef(timestamp)
  const startupDestination = useRef(
    new URLSearchParams(window.location.search).get('object'),
  )
  useEffect(() => {
    const updateFullscreen = () =>
      setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () =>
      document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])
  const destination = objectById.get(selectedId) ?? earth
  const object =
    view === 'map' && mapPosition?.focusedId
      ? (objectById.get(mapPosition.focusedId) ?? destination)
      : destination
  const matches = searchCatalog(query, scope, resultLimit)
  const extendedMatches = searchExtendedCatalog(query, scope, resultLimit)
  const totalDestinations =
    catalog.length +
    (catalogMetadata
      ? catalogMetadata.stars +
        catalogMetadata.exoplanets +
        catalogMetadata.comets +
        catalogMetadata.minorPlanets
      : 0)
  const ancestry = getAncestry(object.id)
  const canShowOrbit =
    ['ephemeris', 'kepler'].includes(object.orbit.model) &&
    getPosition(object, new Date(timestamp)).every(Number.isFinite)
  const hasSaved = bookmarks.includes(object.id)
  const confidence = scientificConfidence(object)
  const following = view === 'map' && Boolean(mapPosition?.followingId)
  const canFollow =
    view === 'map' &&
    !['system', 'universe'].includes(object.kind) &&
    !['local-group', 'laniakea'].includes(object.id)
  const savedMatches = bookmarks
    .map((id) => objectById.get(id))
    .filter((item): item is CelestialObject => {
      if (!item) return false
      const local =
        Boolean(item.body || item.elements || item.trajectory) ||
        ['moon', 'solar-system'].includes(item.id)
      return (
        (scope === 'all' || (scope === 'nearby' ? local : !local)) &&
        `${item.name} ${item.classification}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
    })
  const positionUnavailable =
    (Boolean(object.trajectory) && !canShowOrbit) ||
    (hasExtendedObject(object.id) &&
      !object.galacticPosition &&
      ['star', 'exoplanet'].includes(object.kind))
  const mapFocus = mapPosition?.focusedId
    ? objectById.get(mapPosition.focusedId)
    : undefined
  const sceneTitle =
    view === 'compare'
      ? 'True-scale comparison'
      : view === 'sky'
        ? (activeEvent?.label ?? 'Sky from Earth')
        : view === 'map'
          ? (mapFocus?.name ?? mapPosition?.region ?? 'Solar System')
          : object.name

  function notify(message: string) {
    setNotice(message)
    if (noticeTimeout.current) clearTimeout(noticeTimeout.current)
    noticeTimeout.current = setTimeout(() => setNotice(''), 3400)
  }

  function selectObject(id: string) {
    const next = objectById.get(id)
    if (!next) return
    cancelStartupNavigation()
    const nextView = view === 'orbit' ? 'map' : view
    setSelectedId(id)
    setView(nextView)
    setInspectorTab('overview')
    setShowSidebar(false)
    setExpanded((current) =>
      current.includes(next.kind) ? current : [...current, next.kind],
    )
    updateLocation(id, nextView)
  }

  function updateLocation(id: string, nextView: ViewMode) {
    const url = new URL(window.location.href)
    url.hash = ''
    url.searchParams.set('object', id)
    url.searchParams.set('view', nextView)
    window.history.replaceState(null, '', url)
  }

  function cancelStartupNavigation() {
    startupDestination.current = null
    sharedStartup.current = null
  }

  function storeViews(next: Viewpoint[]) {
    setViewpoints(next)
    try {
      localStorage.setItem('hello-world-viewpoints', JSON.stringify(next))
    } catch {
      notify('View saved for this session. Browser storage is unavailable.')
    }
  }

  function captureView(pose: CameraPose) {
    const point: Viewpoint = {
      version: 1,
      name: (captureRequest.current.name.trim() || `${sceneTitle} view`).slice(
        0,
        80,
      ),
      objectId: selectedId,
      view,
      timestamp,
      comparison: view === 'compare' ? comparison : undefined,
      observer: view === 'sky' ? observer : undefined,
      skyFocus: view === 'sky' ? skyFocus : undefined,
      camera: pose,
      layers: { orbits, labels, compressed, galacticDust, galaxyStyle },
    }
    if (captureRequest.current.share)
      setShareUrl(viewpointUrl(point, window.location.href))
    else {
      storeViews([point, ...viewpoints].slice(0, 30))
      notify('Viewpoint saved')
    }
  }

  function restoreView(point: Viewpoint) {
    if (!objectById.has(point.objectId)) {
      notify('This viewpoint object is not available in the catalog.')
      return
    }
    if (
      point.comparison?.some((id) => {
        const item = objectById.get(id)
        return !item || !physicalRadius(item)
      })
    ) {
      notify('A compared body has no usable radius in this catalog.')
      return
    }
    cancelStartupNavigation()
    setSelectedId(point.objectId)
    setView(point.view)
    if (point.comparison) setComparison(point.comparison)
    if (point.observer) {
      setObserver(point.observer)
      setSkyFocus(point.skyFocus ?? null)
      setActiveEvent(null)
    }
    setDate(point.timestamp)
    setPlaying(false)
    setOrbits(point.layers.orbits)
    setLabels(point.layers.labels)
    setCompressed(point.layers.compressed)
    setGalacticDust(point.layers.galacticDust)
    setGalaxyStyle(point.layers.galaxyStyle)
    setCommand((current) => ({
      action: 'restore-view',
      serial: (current?.serial ?? 0) + 1,
      viewpoint: point,
    }))
    window.history.replaceState(
      null,
      '',
      viewpointUrl(point, window.location.href),
    )
  }
  function observe(site: ObserverSite, event?: SkyEvent) {
    cancelStartupNavigation()
    setToolsOpen(false)
    setObserver(site)
    setActiveEvent(event ?? null)
    setSkyFocus(event ? (event.kind === 'lunar' ? 'Moon' : 'Sun') : null)
    if (event) {
      setDate(event.peak)
      setPlaying(false)
    } else setSpeed(1 / 1440)
    setSelectedId('earth')
    setView('sky')
    updateLocation('earth', 'sky')
  }
  const restoreShared = useEffectEvent(() => {
    const point = sharedStartup.current
    if (point) restoreView(point)
  })

  function visitMission(id: string, time: number, overview: boolean) {
    cancelStartupNavigation()
    setDate(time)
    setPlaying(false)
    setSelectedId(id)
    setView(overview ? 'orbit' : 'map')
    setSkyFocus(null)
    updateLocation(id, overview ? 'orbit' : 'map')
    if (overview) setToolsOpen(false)
  }

  function sendCommand(action: SceneCommand['action'], distancePc?: number) {
    if (action !== 'screenshot') cancelStartupNavigation()
    setCommand((current) => ({
      action,
      serial: (current?.serial ?? 0) + 1,
      distancePc,
    }))
  }

  function setInspectionView(next: ViewMode) {
    cancelStartupNavigation()
    if (next !== 'map') setSelectedId(object.id)
    setView(next)
    updateLocation(next === 'map' ? selectedId : object.id, next)
  }

  function toggleFollow() {
    cancelStartupNavigation()
    setCommand((current) => ({
      action: 'toggle-follow',
      serial: (current?.serial ?? 0) + 1,
      bodyId: object.id,
    }))
  }

  function setDate(value: number) {
    const clamped = clampTime(value)
    simulationRef.current = clamped
    setTimestamp(clamped)
  }

  function toggleBookmark() {
    const next = hasSaved
      ? bookmarks.filter((id) => id !== object.id)
      : [...bookmarks, object.id]
    setBookmarks(next)
    try {
      localStorage.setItem('atlas-bookmarks', JSON.stringify(next))
    } catch {
      notify('Saved for this session. Browser storage is unavailable.')
    }
  }

  function stepTour(index: number) {
    const clamped = Math.min(tourStops.length - 1, Math.max(0, index))
    setTourIndex(clamped)
    selectObject(tourStops[clamped])
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      notify('Fullscreen is not available in this browser.')
    }
  }

  function toggleUi() {
    setUiHidden((current) => !current)
    setSettingsOpen(false)
    setShowSidebar(false)
    setMobileDetails(false)
    setSourcesOpen(false)
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      setToolsOpen(false)
      setRulerOpen(false)
      setUiHidden(false)
      setSettingsOpen(false)
      setShowSidebar(false)
      setMobileDetails(false)
      setSourcesOpen(false)
      return
    }
    if (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.isContentEditable ||
      document.querySelector('dialog[open]')
    )
      return
    const unmodified = !event.altKey && !event.ctrlKey && !event.metaKey
    if (event.key.toLowerCase() === 'h' && unmodified && !event.repeat) {
      event.preventDefault()
      toggleUi()
    }
    if (event.key.toLowerCase() === 'o' && unmodified && !event.repeat)
      setOrbits((current) => !current)
    if (event.key === '/' && !uiHidden) {
      event.preventDefault()
      setShowSidebar(true)
      searchRef.current?.focus()
    }
    if (event.code === 'Space' && !['BUTTON', 'A'].includes(target.tagName)) {
      event.preventDefault()
      setPlaying((current) => !current)
    }
    if (event.key === '+' || event.key === '=') sendCommand('zoom-in')
    if (event.key === '-') sendCommand('zoom-out')
    if (event.key.toLowerCase() === 'r') sendCommand('reset')
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    let active = true
    setCatalogError(false)
    loadExtendedCatalog()
      .then((metadata) => {
        if (!active) return
        setCatalogMetadata(metadata)
        if (sharedStartup.current) {
          restoreShared()
          return
        }
        const id = startupDestination.current
        startupDestination.current = null
        if (id && objectById.has(id)) setSelectedId(id)
      })
      .catch(() => {
        if (active) setCatalogError(true)
      })
    return () => {
      active = false
    }
  }, [catalogAttempt])

  useEffect(() => {
    setResultLimit(24)
  }, [query, scope])

  useEffect(() => {
    let last = performance.now()
    if (!playing) return
    const interval = setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min((now - last) / 1000, 0.2)
      last = now
      if (document.hidden) return
      const next = clampTime(simulationRef.current + elapsed * speed * DAY_MS)
      if (next === simulationRef.current) setPlaying(false)
      simulationRef.current = next
      setTimestamp(next)
    }, 66)
    return () => clearInterval(interval)
  }, [playing, speed])

  useEffect(() => {
    if (sourcesOpen) sourcesRef.current?.showModal()
    else sourcesRef.current?.close()
  }, [sourcesOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const close = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node))
        setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [settingsOpen])

  useEffect(
    () => () => {
      if (noticeTimeout.current) clearTimeout(noticeTimeout.current)
    },
    [],
  )

  const currentDistance = canShowOrbit
    ? formatDistance(distanceAu(getPosition(object, new Date(timestamp))))
    : object.distance

  function renderObjectButton(item: CelestialObject) {
    return (
      <button
        key={item.id}
        className={`catalog-object ${selectedId === item.id ? 'selected' : ''}`}
        onClick={() => selectObject(item.id)}
        aria-pressed={selectedId === item.id}
      >
        <ObjectThumb object={item} small />
        <span>{item.name}</span>
        {selectedId === item.id ? (
          <span className="selected-indicator" />
        ) : (
          <ChevronRight size={13} className="row-arrow" />
        )}
      </button>
    )
  }

  return (
    <main
      className={`observatory ${view === 'map' ? 'map-mode' : ''} ${showInspector ? '' : 'inspector-hidden'} ${showSidebar ? 'sidebar-open' : ''} ${uiHidden ? 'ui-hidden' : ''} ${rulerOpen && view === 'map' ? 'ruler-open' : ''} ${toolsOpen ? 'tools-open' : ''} ${view === 'sky' || view === 'compare' ? 'science-view' : ''}`}
    >
      <UniverseCanvas
        object={destination}
        view={view}
        timestamp={timestamp}
        options={{
          orbits,
          labels: labels && !uiHidden,
          uiHidden,
          compressed,
          playing,
          highQuality,
          adaptiveQuality,
          comparison,
          observer,
          skyFocus,
          ruler:
            rulerOpen && view === 'map' && !uiHidden ? rulerEndpoints : null,
          galaxyStyle,
          galacticDust,
          inspectorOpen: showInspector && view !== 'sky' && view !== 'compare',
          catalogRevision: catalogMetadata ? 1 : 0,
          navigation,
        }}
        command={command}
        onSelect={selectObject}
        onNotice={notify}
        onMapPosition={setMapPosition}
        onNavigate={cancelStartupNavigation}
        onCaptureView={captureView}
      />
      <div className="scene-vignette" />
      {toolsOpen && (
        <Suspense
          fallback={
            <section className="exploration-tools" role="status">
              Loading tools...
            </section>
          }
        >
          <ExplorationTools
            views={viewpoints}
            shareUrl={shareUrl}
            onNotice={notify}
            onClose={() => setToolsOpen(false)}
            onRestore={restoreView}
            comparison={comparison}
            onCompare={(ids, show) => {
              setComparison(ids)
              if (show) {
                setInspectionView('compare')
                setToolsOpen(false)
              }
            }}
            observer={observer}
            timestamp={timestamp}
            onObserve={observe}
            activeEvent={activeEvent}
            onMission={visitMission}
            onEventTime={(time) => {
              if (activeEvent) observe(activeEvent.site, activeEvent)
              setDate(time)
              setPlaying(false)
              setToolsOpen(false)
              setCommand((current) => ({
                action: 'reset',
                serial: (current?.serial ?? 0) + 1,
              }))
            }}
            onDelete={(index) =>
              storeViews(
                viewpoints.filter((_, itemIndex) => index !== itemIndex),
              )
            }
            onCapture={(name, share) => {
              captureRequest.current = { name, share }
              setPlaying(false)
              sendCommand('capture-view')
            }}
          />
        </Suspense>
      )}
      <header className="topbar">
        <div className="brand-wrap">
          <IconButton
            label="Open object catalog"
            className="mobile-menu"
            onClick={() => setShowSidebar((current) => !current)}
          >
            <Menu size={20} />
          </IconButton>
          <a
            className="brand"
            href="?object=earth"
            onClick={(event) => {
              event.preventDefault()
              selectObject('earth')
            }}
            aria-label="Hello World home"
          >
            <Orbit size={28} strokeWidth={1.3} />
            <span>
              Hello World<span className="brand-period">.</span>
            </span>
          </a>
          <span className="brand-caption">UNIVERSE EXPLORER</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            title="Exploration tools"
            aria-label="Exploration tools"
            className={toolsOpen ? 'selected' : ''}
            onClick={() => {
              setToolsOpen((current) => !current)
              setRulerOpen(false)
              setShowSidebar(false)
              setSettingsOpen(false)
            }}
          >
            <Telescope size={15} />
            <span>Tools</span>
          </button>
          <button
            className={activeTab === 'explore' ? 'selected' : ''}
            aria-label="Explore"
            title="Explore"
            onClick={() => {
              setActiveTab('explore')
              setTourIndex(null)
            }}
          >
            <Compass size={15} />
            <span>Explore</span>
          </button>
          <button
            className={activeTab === 'saved' ? 'selected' : ''}
            aria-label="Saved destinations"
            title="Saved destinations"
            onClick={() => {
              setActiveTab('saved')
              setQuery('')
              setScope('all')
              setShowSidebar(true)
            }}
          >
            <Bookmark size={15} />
            <span>Saved</span>
            <span className="nav-count">{bookmarks.length}</span>
          </button>
          <button
            className={activeTab === 'journey' ? 'selected' : ''}
            aria-label="Journey"
            title="Journey"
            onClick={() => {
              setActiveTab('journey')
              stepTour(0)
            }}
          >
            <Telescope size={15} />
            <span>Journey</span>
          </button>
        </nav>
        <div className="header-actions">
          <span className="live-status">
            <span /> SYSTEM ONLINE
          </span>
          <IconButton
            label="Data and image credits"
            onClick={() => setSourcesOpen(true)}
          >
            <Info size={17} />
          </IconButton>
        </div>
      </header>
      {showSidebar && (
        <button
          className="mobile-scrim"
          aria-label="Close object catalog"
          onClick={() => setShowSidebar(false)}
        />
      )}
      <aside
        className={`catalog-sidebar ${showSidebar ? 'open' : ''}`}
        aria-label="Object catalog"
      >
        <div className="catalog-heading">
          <span>
            {activeTab === 'saved'
              ? 'YOUR COLLECTION'
              : 'THE OBSERVABLE UNIVERSE'}
          </span>
          <IconButton
            label="Close object catalog"
            className="mobile-close"
            onClick={() => setShowSidebar(false)}
          >
            <PanelLeftClose size={16} />
          </IconButton>
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            ref={searchRef}
            placeholder="Find a world, a star..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search celestial objects"
          />
          {query ? (
            <IconButton label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </IconButton>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        <div
          className="catalog-scopes"
          role="tablist"
          aria-label="Catalog distance"
        >
          {(['all', 'nearby', 'deep'] as const).map((item) => (
            <button
              role="tab"
              aria-selected={scope === item}
              className={scope === item ? 'active' : ''}
              key={item}
              onClick={() => setScope(item)}
            >
              {item === 'all'
                ? 'All objects'
                : item === 'nearby'
                  ? 'Nearby'
                  : 'Deep sky'}
            </button>
          ))}
        </div>
        <div className="catalog-scroll">
          {activeTab === 'saved' ? (
            <div className="saved-list">
              <div className="list-heading">
                SAVED OBJECTS <span>{bookmarks.length}</span>
              </div>
              {savedMatches.map(renderObjectButton)}
              {savedMatches.length === 0 && (
                <div className="empty-state">
                  <Bookmark size={24} />
                  <p>No saved objects{query ? ' found' : ''}.</p>
                </div>
              )}
            </div>
          ) : (
            categories.map((category) => {
              const items = matches.filter(
                (item) => item.kind === category.kind,
              )
              if (!items.length) return null
              const CategoryIcon = kindIcons[category.kind]
              const open = expanded.includes(category.kind) || Boolean(query)
              return (
                <div className="catalog-category" key={category.kind}>
                  <button
                    className={`category-heading ${open ? 'expanded' : ''}`}
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((current) =>
                        current.includes(category.kind)
                          ? current.filter((item) => item !== category.kind)
                          : [...current, category.kind],
                      )
                    }
                  >
                    <CategoryIcon size={16} />
                    <span>{category.label}</span>
                    <span className="category-count">
                      {(
                        items.filter((item) => !hasExtendedObject(item.id))
                          .length + (extendedMatches.counts[category.kind] ?? 0)
                      ).toLocaleString('en-US')}
                    </span>
                    <ChevronDown size={13} />
                  </button>
                  {open && (
                    <div className="category-objects">
                      {items.map(renderObjectButton)}
                      {(extendedMatches.counts[category.kind] ?? 0) >
                        resultLimit && (
                        <button
                          className="catalog-more"
                          onClick={() =>
                            setResultLimit((current) => current + 40)
                          }
                        >
                          Show more {category.label.toLowerCase()}
                          <ChevronDown size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
          {matches.length === 0 && (
            <div className="empty-state">
              <Search size={24} />
              <p>No objects found.</p>
              <button
                className="text-button"
                onClick={() => {
                  setQuery('')
                  setScope('all')
                }}
              >
                Clear filters <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="catalog-footer">
          <span className="catalog-dot" />
          <span>
            {catalogError
              ? 'Extended catalog unavailable'
              : catalogMetadata
                ? `${totalDestinations.toLocaleString('en-US')} catalog entries`
                : 'Loading astronomical catalogs...'}
          </span>
          {catalogError && (
            <button
              onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
              title="Retry catalog loading"
              aria-label="Retry catalog loading"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            onClick={() => setSourcesOpen(true)}
            title="Catalog sources"
            aria-label="Catalog sources"
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
        <button className="home-location" onClick={() => selectObject('earth')}>
          <span className="location-icon">
            <LocateFixed size={18} />
          </span>
          <span>
            <small>HOME COORDINATES</small>
            <strong>Earth, Solar System</strong>
          </span>
          <ArrowUpRight size={15} />
        </button>
      </aside>
      <section className="scene-top" aria-label="Current location">
        <div className="breadcrumbs">
          <button
            onClick={() => selectObject('universe')}
            aria-label="Observable universe"
          >
            <Compass size={13} />
          </button>
          {ancestry.slice(-3).map((ancestor, index) => (
            <span key={ancestor.id}>
              {index > 0 || ancestry.length > 3 ? (
                <ChevronRight size={11} />
              ) : null}
              <button
                className={ancestor.id === object.id ? 'current' : ''}
                onClick={() => selectObject(ancestor.id)}
              >
                {ancestor.name}
              </button>
            </span>
          ))}
        </div>
        <div className="scene-mode">
          <div
            className="segmented-control"
            role="tablist"
            aria-label="Scene view"
          >
            <button
              role="tab"
              aria-selected={view === 'map'}
              className={view === 'map' ? 'active' : ''}
              onClick={() => setInspectionView('map')}
            >
              <Compass size={14} />
              3D map
            </button>
            <button
              role="tab"
              aria-selected={view === 'object'}
              className={view === 'object' ? 'active' : ''}
              onClick={() => setInspectionView('object')}
            >
              <Globe2 size={14} />
              Close-up
            </button>
            <button
              role="tab"
              aria-selected={view === 'orbit'}
              className={view === 'orbit' ? 'active' : ''}
              disabled={!canShowOrbit}
              title={
                canShowOrbit
                  ? 'Calculated orbital view'
                  : 'Orbital context is available in the object details'
              }
              onClick={() => {
                setInspectionView('orbit')
                setInspectorTab('orbit')
              }}
            >
              <Orbit size={14} />
              Orbit
            </button>
          </div>
          <div
            className="camera-navigation"
            role="group"
            aria-label="Drag behavior"
          >
            <IconButton
              label="Orbit camera"
              active={navigation === 'orbit'}
              onClick={() => setNavigation('orbit')}
            >
              <Orbit size={14} />
            </IconButton>
            <IconButton
              label="Pan map"
              active={navigation === 'pan'}
              onClick={() => setNavigation('pan')}
            >
              <Hand size={14} />
            </IconButton>
          </div>
          <span className="render-status">
            <span /> LIVE RENDER
          </span>
        </div>
        {view === 'map' && (
          <div className="continuous-scale" aria-label="Live map scale">
            <span>{mapPosition?.region ?? 'Solar System'}</span>
            <input
              type="range"
              aria-label="Map scale"
              min="-12"
              max="10.2"
              step="0.025"
              value={Math.log10(
                Math.max(mapPosition?.distancePc ?? 0.0009, 1e-12),
              )}
              onChange={(event) =>
                sendCommand('scale', 10 ** Number(event.target.value))
              }
            />
            <output>{mapPosition?.span ?? '190 AU'}</output>
          </div>
        )}
      </section>
      <div className="scene-heading" key={sceneTitle}>
        <span className="eyebrow">
          <span className="tiny-cross">+</span>
          {view === 'sky'
            ? 'EARTH OBSERVER / ALT-AZ'
            : view === 'compare'
              ? 'PHYSICAL RADII / LINEAR SCALE'
              : view === 'map'
                ? (mapFocus?.classification.toUpperCase() ??
                  'SUN-CENTERED GALACTIC FRAME')
                : object.classification.toUpperCase()}
        </span>
        <h1>{sceneTitle}</h1>
        <p>
          {view === 'sky'
            ? `${observer.latitude.toFixed(4)} deg, ${observer.longitude.toFixed(4)} deg`
            : view === 'compare'
              ? 'Reference radii; illustrative spacing'
              : positionUnavailable && view === 'map'
                ? '3D position unavailable / distance not constrained'
                : view === 'map'
                  ? (mapFocus?.subtitle ??
                    mapPosition?.span ??
                    'Metric coordinates')
                  : object.subtitle}
        </p>
      </div>
      <div className="scene-coordinate">
        <span>{view === 'map' ? 'GALACTIC XYZ / PC' : 'FOCUS LOCKED'}</span>
        <div>
          <Crosshair size={13} />
          {view === 'map'
            ? (mapPosition?.coordinates ?? '0 / 0 / 0')
            : object.id === 'earth'
              ? '03 / SOLAR SYSTEM'
              : `${String(catalog.findIndex((item) => item.id === object.id) + 1).padStart(2, '0')} / ${object.kind.replaceAll('-', ' ').toUpperCase()}`}
        </div>
        {view === 'map' && (
          <small className="nearest-object">
            Nearest: {mapPosition?.nearest ?? 'Sun'}
          </small>
        )}
      </div>
      <div className="viewer-tools" role="toolbar" aria-label="Camera controls">
        {view === 'map' && (
          <IconButton
            label="Distance ruler"
            active={rulerOpen}
            aria-pressed={rulerOpen}
            onClick={() => {
              setRulerOpen((current) => !current)
              setSettingsOpen(false)
              setShowSidebar(false)
            }}
          >
            <Ruler size={18} />
          </IconButton>
        )}
        <IconButton
          label={uiHidden ? 'Show UI' : 'Hide UI'}
          className="ui-toggle"
          active={uiHidden}
          aria-pressed={uiHidden}
          onClick={toggleUi}
        >
          {uiHidden ? <Eye size={18} /> : <EyeOff size={18} />}
        </IconButton>
        {view === 'map' && (
          <IconButton
            label={
              following
                ? `Stop following ${objectById.get(mapPosition!.followingId!)?.name ?? 'body'}`
                : `Follow ${object.name}`
            }
            active={following}
            aria-pressed={following}
            disabled={!canFollow && !following}
            onClick={toggleFollow}
          >
            <LocateFixed size={18} />
          </IconButton>
        )}
        <IconButton label="Zoom in" onClick={() => sendCommand('zoom-in')}>
          <Plus size={18} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => sendCommand('zoom-out')}>
          <Minus size={18} />
        </IconButton>
        <span className="tool-divider" />
        <IconButton label="Reset camera" onClick={() => sendCommand('reset')}>
          <Crosshair size={18} />
        </IconButton>
        <IconButton
          label="Capture image"
          onClick={() => sendCommand('screenshot')}
        >
          <Camera size={17} />
        </IconButton>
        <IconButton
          label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          active={isFullscreen}
          aria-pressed={isFullscreen}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </IconButton>
      </div>
      {rulerOpen && view === 'map' && (
        <DistanceRuler
          endpoints={rulerEndpoints}
          measurement={mapPosition?.measurement ?? null}
          onChange={setRulerEndpoints}
          onFrame={() => sendCommand('frame-ruler')}
          onClose={() => setRulerOpen(false)}
        />
      )}
      <div className="view-layers">
        {view === 'map' && (
          <button
            className={`follow-control ${following ? 'enabled' : ''}`}
            role="switch"
            aria-label="Follow selected body"
            aria-checked={following}
            disabled={!canFollow && !following}
            onClick={toggleFollow}
          >
            <LocateFixed size={14} />
            <span>{following ? 'Following' : 'Follow'}</span>
            <span className="mini-toggle" />
          </button>
        )}
        <button
          className={orbits ? 'enabled' : ''}
          role="switch"
          aria-label="Solar-system orbits"
          title="All cataloged solar-system orbits"
          aria-checked={orbits}
          onClick={() => setOrbits((current) => !current)}
        >
          <Orbit size={14} />
          <span>Orbits</span>
          <span className="mini-toggle" />
        </button>
        <button
          className={labels ? 'enabled' : ''}
          role="switch"
          aria-label="Labels"
          title="Object names"
          aria-checked={labels}
          onClick={() => setLabels((current) => !current)}
        >
          <Eye size={14} />
          <span>Labels</span>
          <span className="mini-toggle" />
        </button>
        <div className="settings-wrap" ref={settingsRef}>
          <IconButton
            label="Display settings"
            active={settingsOpen}
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <Settings2 size={16} />
          </IconButton>
          {settingsOpen && (
            <div className="settings-popover">
              <div className="popover-heading">
                DISPLAY{' '}
                <IconButton
                  label="Close display settings"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={14} />
                </IconButton>
              </div>
              <label>
                <span>All solar-system orbits</span>
                <input
                  type="checkbox"
                  checked={orbits}
                  onChange={(event) => setOrbits(event.target.checked)}
                />
              </label>
              <label>
                <span>Object names</span>
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(event) => setLabels(event.target.checked)}
                />
              </label>
              <label>
                <span>High resolution</span>
                <input
                  type="checkbox"
                  checked={highQuality}
                  onChange={(event) => setHighQuality(event.target.checked)}
                />
              </label>
              <label>
                <span>Adaptive rendering</span>
                <input
                  type="checkbox"
                  checked={adaptiveQuality}
                  onChange={(event) => setAdaptiveQuality(event.target.checked)}
                />
              </label>
              <div className="setting-label">Milky Way style</div>
              <label>
                <span>Galactic dust</span>
                <input
                  type="checkbox"
                  checked={galacticDust && galaxyStyle === 'reference'}
                  disabled={galaxyStyle !== 'reference'}
                  onChange={(event) => setGalacticDust(event.target.checked)}
                />
              </label>
              <div
                className="segmented-control"
                role="group"
                aria-label="Milky Way style"
              >
                <button
                  className={galaxyStyle === 'original' ? 'active' : ''}
                  aria-pressed={galaxyStyle === 'original'}
                  onClick={() => setGalaxyStyle('original')}
                >
                  Original
                </button>
                <button
                  className={galaxyStyle === 'reference' ? 'active' : ''}
                  aria-pressed={galaxyStyle === 'reference'}
                  onClick={() => setGalaxyStyle('reference')}
                >
                  Reference
                </button>
              </div>
              {view !== 'map' && (
                <>
                  <div className="setting-label">Solar-system distances</div>
                  <div className="segmented-control">
                    <button
                      className={compressed ? 'active' : ''}
                      onClick={() => setCompressed(true)}
                    >
                      Compressed
                    </button>
                    <button
                      className={!compressed ? 'active' : ''}
                      onClick={() => setCompressed(false)}
                    >
                      Proportional
                    </button>
                  </div>
                  <span className="setting-footnote">
                    Body sizes are enlarged.
                  </span>
                </>
              )}
              {view === 'map' && (
                <span className="setting-footnote">
                  Sun-centered coordinates / parsecs
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="scale-indicator">
        <div className="scale-line" />
        <span>
          {view === 'map'
            ? (mapPosition?.span ?? 'METRIC WORLD')
            : view === 'orbit'
              ? 'AU / HELIOCENTRIC'
              : object.scene === 'planet'
                ? 'LOCAL SPACE'
                : object.scene === 'universe'
                  ? 'COSMIC SCALE'
                  : 'DEEP SPACE'}
        </span>
      </div>
      {showInspector ? (
        <aside
          className={`object-inspector ${mobileDetails ? 'mobile-expanded' : ''}`}
          aria-label="Object information"
        >
          <div className="inspector-top">
            <span>OBJECT DETAILS</span>
            <div>
              <IconButton
                label={hasSaved ? 'Remove bookmark' : 'Save object'}
                active={hasSaved}
                onClick={toggleBookmark}
              >
                <Bookmark size={16} fill={hasSaved ? 'currentColor' : 'none'} />
              </IconButton>
              <IconButton
                label="Close object details"
                onClick={() => {
                  if (window.innerWidth < 760) setMobileDetails(false)
                  else setShowInspector(false)
                }}
              >
                <X size={16} />
              </IconButton>
            </div>
          </div>
          <button
            className="mobile-object-summary"
            onClick={() => setMobileDetails((current) => !current)}
            aria-label={`Show details for ${object.name}`}
          >
            <ObjectThumb object={object} />
            <span>
              <strong>{object.name}</strong>
              <small>{object.classification}</small>
            </span>
            <ChevronDown size={18} />
          </button>
          <div className="inspector-content">
            <div className="object-identity">
              <ObjectThumb object={object} />
              <div>
                <h2>{object.name}</h2>
                <span>{object.classification}</span>
              </div>
            </div>
            <div className="object-location">
              <LocateFixed size={12} />
              {object.location}
            </div>
            <dl
              className="confidence-badges"
              aria-label="Scientific confidence"
            >
              {Object.entries(confidence).map(([kind, value]) => (
                <div key={kind}>
                  <dt>{kind}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div
              className="inspector-tabs"
              role="tablist"
              aria-label="Object details"
            >
              <button
                role="tab"
                aria-selected={inspectorTab === 'overview'}
                className={inspectorTab === 'overview' ? 'active' : ''}
                onClick={() => setInspectorTab('overview')}
              >
                Overview
              </button>
              <button
                role="tab"
                aria-selected={inspectorTab === 'orbit'}
                className={inspectorTab === 'orbit' ? 'active' : ''}
                onClick={() => setInspectorTab('orbit')}
              >
                Orbital data
                <ArrowUpRight size={12} />
              </button>
            </div>
            {inspectorTab === 'overview' ? (
              <>
                <p className="object-description">{object.description}</p>
                <div className="object-facts">
                  {object.facts.map((fact) => (
                    <div key={fact.label}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="orbit-data-table">
                <div>
                  <span>Primary</span>
                  <strong>{object.orbit.parent}</strong>
                </div>
                <div>
                  <span>Orbital period</span>
                  <strong>{object.orbit.period}</strong>
                </div>
                <div>
                  <span>Mean speed</span>
                  <strong>{object.orbit.speed}</strong>
                </div>
                {object.orbit.semiMajorAxis !== undefined && (
                  <div>
                    <span>Semi-major axis</span>
                    <strong>{object.orbit.semiMajorAxis} AU</strong>
                  </div>
                )}
                {object.orbit.eccentricity !== undefined && (
                  <div>
                    <span>Eccentricity</span>
                    <strong>{object.orbit.eccentricity}</strong>
                  </div>
                )}
                {object.orbit.inclination !== undefined && (
                  <div>
                    <span>Inclination</span>
                    <strong>{object.orbit.inclination} deg</strong>
                  </div>
                )}
              </div>
            )}
            <div className="orbit-section">
              <div className="section-label">
                <span>ORBITAL {canShowOrbit ? 'PATH' : 'CONTEXT'}</span>
                <span
                  className={`data-badge ${canShowOrbit ? 'computed' : ''}`}
                >
                  <span />
                  {canShowOrbit
                    ? 'COMPUTED'
                    : object.orbit.model === 'none'
                      ? 'CONTEXT'
                      : 'SCHEMATIC'}
                </span>
              </div>
              <OrbitDiagram object={object} timestamp={timestamp} />
              <div className="orbit-summary">
                <span>
                  {canShowOrbit ? 'Orbital period' : 'Reference frame'}
                  <strong>
                    {canShowOrbit ? object.orbit.period : object.orbit.parent}
                  </strong>
                </span>
                <span>
                  {canShowOrbit ? 'Orbital speed' : 'Motion'}
                  <strong>
                    {canShowOrbit
                      ? object.orbit.speed
                      : object.orbit.model === 'none'
                        ? 'No single orbit'
                        : 'Illustrative'}
                  </strong>
                </span>
              </div>
            </div>
            {inspectorTab === 'orbit' && (
              <p className="science-note">{object.orbit.note}</p>
            )}
            <div className="distance-row">
              <Radio size={15} />
              <span>
                {canShowOrbit
                  ? `Distance from ${object.orbit.parent}`
                  : 'Distance / extent'}
                <strong>{currentDistance}</strong>
              </span>
            </div>
            <button
              className="primary-button inspector-action"
              onClick={() => {
                if (canShowOrbit) {
                  setInspectionView(view === 'orbit' ? 'object' : 'orbit')
                  setInspectorTab(view === 'orbit' ? 'overview' : 'orbit')
                } else if (object.parent) selectObject(object.parent)
                else selectObject('local-group')
                setMobileDetails(false)
              }}
            >
              {canShowOrbit ? <Orbit size={16} /> : <Expand size={16} />}
              {canShowOrbit
                ? view === 'orbit'
                  ? 'Return to object'
                  : 'Explore orbit'
                : object.parent
                  ? 'Explore surrounding space'
                  : 'Visit the Local Group'}
              <ArrowUpRight size={16} />
            </button>
            <a
              className="source-link"
              href={object.source}
              target="_blank"
              rel="noreferrer"
            >
              Source / Reference data
              <ExternalLink size={11} />
            </a>
            {object.coordinateSource && (
              <a
                className="source-link"
                href={object.coordinateSource}
                target="_blank"
                rel="noreferrer"
              >
                Coordinates / Ephemeris source <ExternalLink size={11} />
              </a>
            )}
            {object.model && (
              <a
                className="source-link"
                href={object.model.source}
                target="_blank"
                rel="noreferrer"
              >
                3D asset / {object.model.credit} <ExternalLink size={11} />
              </a>
            )}
          </div>
        </aside>
      ) : (
        <IconButton
          label="Open object details"
          className="open-inspector"
          onClick={() => setShowInspector(true)}
        >
          <Info size={19} />
        </IconButton>
      )}
      {tourIndex !== null && (
        <div className="journey-bar">
          <Telescope size={18} />
          <div>
            <small>THE GRAND TOUR</small>
            <span>
              {tourIndex + 1} / {tourStops.length}{' '}
              <span className="tour-title">{object.name}</span>
            </span>
          </div>
          <IconButton
            label="Previous tour stop"
            disabled={tourIndex === 0}
            onClick={() => stepTour(tourIndex - 1)}
          >
            <ChevronLeft size={17} />
          </IconButton>
          <IconButton
            label="Next tour stop"
            disabled={tourIndex === tourStops.length - 1}
            onClick={() => stepTour(tourIndex + 1)}
          >
            <ChevronRight size={17} />
          </IconButton>
          <IconButton
            label="End journey"
            onClick={() => {
              setTourIndex(null)
              setActiveTab('explore')
            }}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
      <div className="timeline">
        <div className="time-heading">
          <span className="time-state">
            <span className={playing ? 'running' : ''} />
            SIMULATION TIME
          </span>
          <span className="time-zone">UTC</span>
        </div>
        <div className="timeline-controls">
          <div className="playback-controls">
            <IconButton
              label="Step back one day"
              onClick={() => setDate(timestamp - DAY_MS)}
            >
              <ChevronLeft size={17} />
            </IconButton>
            <IconButton
              label={playing ? 'Pause simulation' : 'Play simulation'}
              className="play-button"
              onClick={() => setPlaying((current) => !current)}
            >
              {playing ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
            </IconButton>
            <IconButton
              label="Step forward one day"
              onClick={() => setDate(timestamp + DAY_MS)}
            >
              <ChevronRight size={17} />
            </IconButton>
          </div>
          <div className="time-divider" />
          <label className="date-control">
            <span>{formatDate(timestamp)}</span>
            <input
              aria-label="Simulation date"
              type="date"
              min="1900-01-01"
              max="2100-12-31"
              value={new Date(timestamp).toISOString().slice(0, 10)}
              onChange={(event) => {
                if (event.target.value)
                  setDate(new Date(`${event.target.value}T12:00:00Z`).getTime())
              }}
            />
          </label>
          <span className="clock-time">
            {new Date(timestamp).toISOString().slice(11, 19)}
          </span>
          <label className="speed-control">
            <AudioLines size={14} />
            <select
              aria-label="Simulation speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {timeSpeeds.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <IconButton
            label="Reset to current date"
            onClick={() => setDate(Date.now())}
          >
            <RotateCcw size={15} />
          </IconButton>
        </div>
        <div className="time-track">
          <input
            aria-label="Time of day"
            type="range"
            min="0"
            max="86399"
            step="1"
            value={secondsIntoDay(timestamp)}
            onChange={(event) =>
              setDate(
                Math.floor(timestamp / DAY_MS) * DAY_MS +
                  Number(event.target.value) * 1000,
              )
            }
          />
          <div className="time-ticks">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          ASTRONOMY ENGINE<span className="status-separator">/</span>3D
          SIMULATION
        </span>
        <span className="model-note">
          {view === 'map'
            ? 'One metric world / distance-based detail / enhanced markers'
            : object.scene === 'planet' && view === 'object'
              ? 'Surface maps + illustrative lighting'
              : canShowOrbit && view === 'orbit'
                ? 'Calculated positions / enlarged bodies'
                : object.scene === 'system'
                  ? `${compressed ? 'Compressed' : 'Proportional'} distances / enlarged bodies`
                  : 'Artistic reconstruction / illustrative scale'}
        </span>
        <button onClick={() => setSourcesOpen(true)}>
          DATA & CREDITS
          <ArrowUpRight size={11} />
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      <dialog
        className="sources-dialog"
        ref={sourcesRef}
        onCancel={() => setSourcesOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSourcesOpen(false)
        }}
      >
        <div className="dialog-inner">
          <div className="dialog-heading">
            <span className="eyebrow">HELLO WORLD / DATA & CREDITS</span>
            <IconButton
              label="Close data and credits"
              onClick={() => setSourcesOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </div>
          <h2>A window into the universe.</h2>
          <p>
            {totalDestinations.toLocaleString('en-US')} catalog entries,
            including HYG stars, confirmed exoplanets, comets, and minor
            planets. This is not a complete inventory of the galaxy. Values have
            uncertainties; this is an educational map, not a navigation
            instrument.
          </p>
          <h3>Astronomical model</h3>
          <p>
            Planet, Moon, and Galilean satellite positions are calculated with{' '}
            <a
              href="https://github.com/cosinekitty/astronomy"
              target="_blank"
              rel="noreferrer"
            >
              Astronomy Engine
            </a>{' '}
            using the selected UTC date. The supported date range is 1900-2100.
            The continuous map uses a single Sun-centered Galactic coordinate
            frame in parsecs. A floating render origin preserves local detail as
            you travel; it does not change catalog distances. Planet and lunar
            motion follows the selected date. Marker sizes are enhanced, unknown
            stellar radii are illustrative, and exoplanet points locate host
            stars rather than invented orbital phases. Individual close-up and
            orbit views use illustrative sizes. Planet rotation uses an
            illustrative initial orientation.
          </p>
          <h3>Imagery & rendering</h3>
          <p>
            Voyager geometry is provided by NASA Visualization Technology
            Applications and Development (VTAD). Its heliocentric positions use
            locally bundled, bounded NASA/JPL Horizons mission snapshots, with
            interpolation between samples and no extrapolation. Model attitude
            and lighting are illustrative. The Pillars of Creation particles are
            derived from the NASA-hosted reconstruction by Leah Hustak and Ralf
            Crawford, Space Telescope Science Institute. Printing supports and
            the lower basal section were removed; emission colors are
            illustrative. These assets follow the{' '}
            <a
              href="https://www.nasa.gov/nasa-brand-center/images-and-media/"
              target="_blank"
              rel="noreferrer"
            >
              NASA media-use guidelines
            </a>
            . No NASA endorsement is implied.
          </p>
          <p>
            Rogue-planet candidates are isolated substellar objects with
            uncertain formation histories; their infrared-inspired clouds and
            nominal radii are illustrative. Dormant black holes have no bright
            disk or jets; their background stars are schematic. The Bootes Void
            is a galaxy underdensity, not an empty sphere or black hole, and its
            depicted galaxy distribution is not a survey.
          </p>
          <p>
            Planet texture maps by{' '}
            <a
              href="https://www.solarsystemscope.com/textures/"
              target="_blank"
              rel="noreferrer"
            >
              Solar System Scope
            </a>
            , based on NASA data, under{' '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            . Maps are wrapped onto spheres with simulated lighting. Nebulae,
            galaxies, black-hole lensing, jets, and cosmic structures are
            artistic reconstructions, not photographs or relativistic
            simulations.
          </p>
          <p>
            Io, Europa, Ganymede, and Callisto follow calculated
            Jupiter-centered orbits; their surface patterns are illustrative.
            Solar prominences, plasma ejections, and granulation are time-scaled
            visual effects, not live solar-weather observations. Black-hole
            motion represents accretion flow and jet pulses, not a visible solid
            surface or measured spin.
          </p>
          <h3>Sources</h3>
          <p>
            The Milky Way's particle density and colors are sampled from the{' '}
            <a
              href="https://science.nasa.gov/photojournal/our-milky-way-gets-a-makeover-artist-concept/"
              target="_blank"
              rel="noreferrer"
            >
              NASA/JPL-Caltech PIA10748 artist's concept
            </a>
            , arranged as glowing stars in a warped 3D disk, central bulge, and
            sparse halo, without a flat image surface. Courtesy
            NASA/JPL-Caltech, under the{' '}
            <a
              href="https://www.jpl.nasa.gov/jpl-image-use-policy/"
              target="_blank"
              rel="noreferrer"
            >
              JPL image use policy
            </a>
            . This is an illustration, not an external photograph of our galaxy.
            Black-hole views use approximate non-spinning ray bending,
            illustrative plasma emission, and simplified color shifts, not a
            full relativistic accretion simulation.
          </p>
          <p>
            Snapshot:{' '}
            {catalogMetadata
              ? formatDate(new Date(catalogMetadata.retrievedAt).getTime())
              : 'loading'}
            .{' '}
            <a
              href="https://exoplanetarchive.ipac.caltech.edu/"
              target="_blank"
              rel="noreferrer"
            >
              NASA Exoplanet Archive
            </a>
            : {catalogMetadata?.exoplanets.toLocaleString('en-US') ?? '...'}{' '}
            confirmed planets.{' '}
            <a
              href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html"
              target="_blank"
              rel="noreferrer"
            >
              JPL SBDB
            </a>
            : {catalogMetadata?.comets.toLocaleString('en-US') ?? '...'} comets
            and {catalogMetadata?.minorPlanets.toLocaleString('en-US') ?? '...'}{' '}
            minor planets, including all five recognized dwarf planets.
            Minor-body paths use two-body propagation and are not full JPL
            ephemerides.
          </p>
          <p>
            <a
              href="https://github.com/astronexus/HYG-Database/tree/main/hyg"
              target="_blank"
              rel="noreferrer"
            >
              HYG v4.1, David Nash / Astronomy Nexus
            </a>
            : {catalogMetadata?.stars.toLocaleString('en-US') ?? '...'} stars.
            The transformed star snapshot is licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>
            . Only stars with usable distances are mapped. Exoplanet markers
            show host-star coordinates; their surface appearances are
            illustrative.
          </p>
          <p>
            Physical reference values draw on{' '}
            <a
              href="https://science.nasa.gov/solar-system/"
              target="_blank"
              rel="noreferrer"
            >
              NASA Science
            </a>{' '}
            and standard astronomical estimates. Each object includes a
            reference link. Some values, especially distant black-hole masses,
            are uncertain.
          </p>
          <div className="dialog-footer">
            <Orbit size={20} />
            <span>Made for the curious.</span>
            <button
              className="primary-button"
              onClick={() => setSourcesOpen(false)}
            >
              Back to the universe
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </dialog>
    </main>
  )
}

export default App
