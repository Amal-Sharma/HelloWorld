import { MAX_DATE, MIN_DATE } from './astronomy'
import { validObserver } from './observer'
import type { ObserverSite } from './observer'
import { isObservationBand } from './spectrum'
import type { ObservationBand } from './spectrum'

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov?: number
}

export interface Viewpoint {
  version: 1
  name: string
  objectId: string
  view: 'map' | 'object' | 'orbit' | 'compare' | 'sky'
  comparison?: string[]
  observer?: ObserverSite
  skyFocus?: 'Sun' | 'Moon' | null
  model?: { cosmicAgeGyr: number; densityGain: number; showCandidates: boolean }
  timestamp: number
  camera: CameraPose
  layers: {
    orbits: boolean
    labels: boolean
    compressed: boolean
    galacticDust: boolean
    stellarGlints?: boolean
    spectrum?: ObservationBand
    radioExposure?: number
    galaxyStyle: 'original' | 'reference'
  }
}

export function parseViewpoint(value: unknown): Viewpoint | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Partial<Viewpoint>
  const vector = (point: unknown): point is [number, number, number] =>
    Array.isArray(point) &&
    point.length === 3 &&
    point.every(
      (coordinate) =>
        typeof coordinate === 'number' &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= 5e10,
    )
  if (
    data.version !== 1 ||
    typeof data.name !== 'string' ||
    data.name.length > 80 ||
    typeof data.objectId !== 'string' ||
    !data.objectId ||
    data.objectId.length > 256 ||
    !['map', 'object', 'orbit', 'compare', 'sky'].includes(data.view ?? '') ||
    typeof data.timestamp !== 'number' ||
    !Number.isFinite(data.timestamp) ||
    data.timestamp < MIN_DATE ||
    data.timestamp > MAX_DATE ||
    !data.camera ||
    !vector(data.camera.position) ||
    !vector(data.camera.target) ||
    !vector(data.camera.up) ||
    Math.hypot(...data.camera.up) < 0.5 ||
    Math.hypot(...data.camera.up) > 2 ||
    Math.hypot(
      ...data.camera.position.map(
        (coordinate, index) => coordinate - data.camera!.target[index],
      ),
    ) === 0 ||
    !data.layers ||
    !['orbits', 'labels', 'compressed', 'galacticDust'].every(
      (key) =>
        typeof data.layers![key as keyof Viewpoint['layers']] === 'boolean',
    ) ||
    !['original', 'reference'].includes(data.layers.galaxyStyle) ||
    (data.layers.stellarGlints !== undefined &&
      typeof data.layers.stellarGlints !== 'boolean') ||
    (data.layers.spectrum !== undefined && !isObservationBand(data.layers.spectrum)) ||
    (data.layers.radioExposure !== undefined &&
      (!Number.isFinite(data.layers.radioExposure) || data.layers.radioExposure < 1 || data.layers.radioExposure > 8)) ||
    (data.model !== undefined && (!data.model ||
      !Number.isFinite(data.model.cosmicAgeGyr) || data.model.cosmicAgeGyr < 1 || data.model.cosmicAgeGyr > 30 ||
      !Number.isFinite(data.model.densityGain) || data.model.densityGain < 0.25 || data.model.densityGain > 2 ||
      typeof data.model.showCandidates !== 'boolean')) ||
    (data.camera.fov !== undefined &&
      (!Number.isFinite(data.camera.fov) ||
        data.camera.fov < 0.1 ||
        data.camera.fov > 100)) ||
    (data.view === 'sky' &&
      (!data.observer ||
        !validObserver(data.observer) ||
        typeof data.observer.constellations !== 'boolean')) ||
    (data.skyFocus !== undefined &&
      data.skyFocus !== null &&
      data.skyFocus !== 'Sun' &&
      data.skyFocus !== 'Moon') ||
    (data.view === 'compare' &&
      (!Array.isArray(data.comparison) ||
        data.comparison.length < 2 ||
        data.comparison.length > 3 ||
        !data.comparison.every(
          (id) => typeof id === 'string' && id.length < 256,
        )))
  )
    return null
  return {
    version: 1,
    name: data.name.trim() || 'Viewpoint',
    objectId: data.objectId,
    view: data.view!,
    timestamp: data.timestamp,
    ...(data.model ? { model: { ...data.model } } : {}),
    comparison: data.view === 'compare' ? [...data.comparison!] : undefined,
    observer: data.view === 'sky' ? { ...data.observer! } : undefined,
    skyFocus: data.view === 'sky' ? (data.skyFocus ?? null) : undefined,
    camera: {
      position: [...data.camera.position],
      target: [...data.camera.target],
      up: [...data.camera.up],
      ...(data.camera.fov !== undefined ? { fov: data.camera.fov } : {}),
    },
    layers: {
      orbits: data.layers.orbits,
      labels: data.layers.labels,
      compressed: data.layers.compressed,
      galacticDust: data.layers.galacticDust,
      stellarGlints: data.layers.stellarGlints ?? true,
      spectrum: data.layers.spectrum ?? 'visible',
      radioExposure: data.layers.radioExposure ?? 3,
      galaxyStyle: data.layers.galaxyStyle,
    },
  }
}

export function readSharedViewpoint(hash: string): Viewpoint | null {
  if (!hash.startsWith('#view=') || hash.length > 12000) return null
  try {
    return parseViewpoint(JSON.parse(decodeURIComponent(hash.slice(6))))
  } catch {
    return null
  }
}

export function viewpointUrl(viewpoint: Viewpoint, location: string): string {
  const url = new URL(location)
  url.searchParams.set('object', viewpoint.objectId)
  url.searchParams.set('view', viewpoint.view)
  url.hash = `view=${encodeURIComponent(JSON.stringify(viewpoint))}`
  return url.href
}

export function readViewpoints(): Viewpoint[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem('hello-world-viewpoints') ?? '[]',
    )
    return Array.isArray(saved)
      ? saved
          .slice(0, 30)
          .map(parseViewpoint)
          .filter((item): item is Viewpoint => item !== null)
      : []
  } catch {
    return []
  }
}
