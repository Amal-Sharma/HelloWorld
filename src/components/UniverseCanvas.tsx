import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { CelestialObject } from '../data/catalog'
import { SpaceScene } from './spaceScene'
import type { SceneOptions, ViewMode } from './spaceScene'
import type { MapTelemetry } from './ContinuousMap'
import type { CameraPose, Viewpoint } from '../lib/viewpoints'

export interface SceneCommand {
  action:
    | 'zoom-in'
    | 'zoom-out'
    | 'reset'
    | 'screenshot'
    | 'scale'
    | 'follow'
    | 'toggle-follow'
    | 'frame-ruler'
    | 'capture-view'
    | 'restore-view'
  serial: number
  distancePc?: number
  bodyId?: string | null
  viewpoint?: Viewpoint
}

interface Props {
  object: CelestialObject
  view: ViewMode
  timestamp: number
  options: SceneOptions
  command: SceneCommand | null
  onSelect: (id: string) => void
  onNotice: (message: string) => void
  onMapPosition?: (position: MapTelemetry) => void
  onNavigate?: () => void
  onCaptureView?: (pose: CameraPose) => void
}

export default function UniverseCanvas({
  object,
  view,
  timestamp,
  options,
  command,
  onSelect,
  onNotice,
  onMapPosition,
  onNavigate,
  onCaptureView,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const labelHost = useRef<HTMLDivElement>(null)
  const scene = useRef<SpaceScene | null>(null)
  const [error, setError] = useState<string | null>(null)
  const select = useEffectEvent(onSelect)
  const notify = useEffectEvent(onNotice)
  const positionChanged = useEffectEvent((position: MapTelemetry) =>
    onMapPosition?.(position),
  )
  const navigated = useEffectEvent(() => onNavigate?.())
  const captured = useEffectEvent((pose: CameraPose) => onCaptureView?.(pose))
  const initialOptions = useRef(options)

  useEffect(() => {
    const container = host.current!
    const contextError = (event: Event) =>
      setError((event as CustomEvent<string>).detail)
    const contextRestored = () => setError(null)
    const assetError = (event: Event) =>
      notify((event as CustomEvent<string>).detail)
    container.addEventListener('scene-error', contextError)
    container.addEventListener('scene-restored', contextRestored)
    container.addEventListener('asset-error', assetError)
    const mapPosition = (event: Event) =>
      positionChanged((event as CustomEvent<MapTelemetry>).detail)
    const mapNotice = (event: Event) =>
      notify((event as CustomEvent<string>).detail)
    container.addEventListener('map-position', mapPosition)
    container.addEventListener('map-notice', mapNotice)
    const mapNavigation = () => navigated()
    container.addEventListener('map-navigation', mapNavigation)
    try {
      scene.current = new SpaceScene(
        container,
        labelHost.current!,
        initialOptions.current,
        (id) => select(id),
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'This browser could not initialize WebGL.',
      )
    }
    return () => {
      container.removeEventListener('scene-error', contextError)
      container.removeEventListener('scene-restored', contextRestored)
      container.removeEventListener('asset-error', assetError)
      container.removeEventListener('map-position', mapPosition)
      container.removeEventListener('map-notice', mapNotice)
      container.removeEventListener('map-navigation', mapNavigation)
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  useEffect(() => {
    scene.current?.setObject(object, view)
  }, [object, view])
  useEffect(() => {
    scene.current?.setTime(timestamp)
  }, [timestamp])
  useEffect(() => {
    scene.current?.setOptions(options)
  }, [options])
  useEffect(() => {
    if (!command || !scene.current) return
    if (command.action === 'zoom-in') scene.current.zoom(0.77)
    if (command.action === 'zoom-out') scene.current.zoom(1.3)
    if (command.action === 'reset') scene.current.reset()
    if (command.action === 'frame-ruler') scene.current.frameRuler()
    if (command.action === 'capture-view') captured(scene.current.capturePose())
    if (command.action === 'restore-view' && command.viewpoint)
      scene.current.restoreViewpoint(command.viewpoint)
    if (command.action === 'scale' && command.distancePc !== undefined)
      scene.current.setMapScale(command.distancePc)
    if (command.action === 'follow')
      scene.current.followBody(command.bodyId ?? null)
    if (command.action === 'toggle-follow' && command.bodyId)
      scene.current.toggleFollow(command.bodyId)
    if (command.action === 'screenshot') {
      try {
        scene.current.screenshot()
        notify('Image captured')
      } catch {
        notify('The image could not be captured in this browser.')
      }
    }
  }, [command])

  return (
    <>
      <div className="universe-canvas" ref={host} />
      <div className="scene-label-layer" ref={labelHost} />
      {error && (
        <div className="graphics-error" role="alert">
          <AlertTriangle size={28} />
          <h2>3D rendering unavailable</h2>
          <p>{error}</p>
          <p>The object catalog and orbital data are still available.</p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            <RotateCcw size={16} /> Reload view
          </button>
        </div>
      )}
    </>
  )
}
