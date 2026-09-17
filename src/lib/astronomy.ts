import {
  GeoMoon,
  HelioVector,
  JupiterMoons,
  MakeTime,
  RotateVector,
  Rotation_EQJ_ECL,
  Vector,
} from 'astronomy-engine'
import {
  kepler3,
  radius as orbitalRadius,
  trueAnomaly,
} from 'astronomia/kepler'
import { Elements } from 'astronomia/nearparabolic'
import type { CelestialObject, OrbitalElements } from '../data/catalog'

export type Position = [number, number, number]
export const DAY_MS = 86_400_000
export const MIN_DATE = Date.UTC(1900, 0, 1)
export const MAX_DATE = Date.UTC(2100, 11, 31, 23, 59, 59)
let jovianCache: {
  timestamp: number
  moons: ReturnType<typeof JupiterMoons>
} | null = null

export function clampTime(timestamp: number): number {
  return Number.isFinite(timestamp)
    ? Math.min(MAX_DATE, Math.max(MIN_DATE, timestamp))
    : Date.UTC(2026, 8, 16, 12)
}

export function getPosition(object: CelestialObject, date: Date): Position {
  if (object.elements) return smallBodyPosition(object.elements, date)
  if (object.jovianMoon) {
    if (jovianCache?.timestamp !== date.getTime())
      jovianCache = { timestamp: date.getTime(), moons: JupiterMoons(date) }
    const state = jovianCache.moons[object.jovianMoon]
    const ecliptic = RotateVector(
      Rotation_EQJ_ECL(),
      new Vector(state.x, state.y, state.z, state.t),
    )
    return [ecliptic.x, ecliptic.z, -ecliptic.y]
  }
  if (!object.body && object.id !== 'moon') return [0, 0, 0]
  const vector =
    object.id === 'moon' ? GeoMoon(date) : HelioVector(object.body!, date)
  const ecliptic = RotateVector(Rotation_EQJ_ECL(), vector)
  return [ecliptic.x, ecliptic.z, -ecliptic.y]
}

export function distanceAu(position: Position): number {
  return Math.hypot(...position)
}

export function displayPosition(
  position: Position,
  compressed = false,
): Position {
  const distance = distanceAu(position)
  if (!distance) return [0, 0, 0]
  const scale = compressed ? (2 + Math.log1p(distance) * 3.1) / distance : 1
  return position.map((coordinate) => coordinate * scale) as Position
}

export function sampleOrbit(
  object: CelestialObject,
  date: Date,
  segments = 180,
): Position[] {
  if (object.elements) {
    const elements = object.elements
    const extent =
      elements.eccentricity < 1
        ? Math.PI
        : Math.acos(-1 / elements.eccentricity) - 0.16
    return Array.from({ length: segments + 1 }, (_, index) => {
      const anomaly = -extent + (index / segments) * extent * 2
      const radius =
        (elements.perihelionDistance * (1 + elements.eccentricity)) /
        (1 + elements.eccentricity * Math.cos(anomaly))
      return orientOrbit(elements, anomaly, radius)
    })
  }
  if (
    !object.orbit.periodDays ||
    (!object.body && !object.jovianMoon && object.id !== 'moon')
  )
    return []
  return Array.from({ length: segments + 1 }, (_, index) =>
    getPosition(
      object,
      new Date(
        date.getTime() + (index / segments) * object.orbit.periodDays! * DAY_MS,
      ),
    ),
  )
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(timestamp)
}

function orientOrbit(
  elements: OrbitalElements,
  anomaly: number,
  radius: number,
): Position {
  const inclination = (elements.inclination * Math.PI) / 180
  const node = (elements.ascendingNode * Math.PI) / 180
  const argument = (elements.perihelionArgument * Math.PI) / 180 + anomaly
  return [
    radius *
      (Math.cos(node) * Math.cos(argument) -
        Math.sin(node) * Math.sin(argument) * Math.cos(inclination)),
    radius * Math.sin(argument) * Math.sin(inclination),
    -radius *
      (Math.sin(node) * Math.cos(argument) +
        Math.cos(node) * Math.sin(argument) * Math.cos(inclination)),
  ]
}

export function smallBodyPosition(
  elements: OrbitalElements,
  date: Date,
): Position {
  const julianDate = MakeTime(date).tt + 2451545
  if (elements.eccentricity < 1 && elements.semiMajorAxis > 0) {
    const meanMotion = 0.01720209895 / Math.pow(elements.semiMajorAxis, 1.5)
    const anomaly = kepler3(
      elements.eccentricity,
      (elements.meanAnomaly * Math.PI) / 180 +
        meanMotion * (julianDate - elements.epoch),
    )
    return orientOrbit(
      elements,
      trueAnomaly(anomaly, elements.eccentricity),
      orbitalRadius(anomaly, elements.eccentricity, elements.semiMajorAxis),
    )
  }
  const result = new Elements(
    elements.perihelionTime,
    elements.perihelionDistance,
    elements.eccentricity,
  ).anomalyDistance(julianDate)
  return result.err || result.ano === undefined || result.dist === undefined
    ? [NaN, NaN, NaN]
    : orientOrbit(elements, result.ano, result.dist)
}

export function secondsIntoDay(timestamp: number) {
  return Math.floor((((timestamp % DAY_MS) + DAY_MS) % DAY_MS) / 1000)
}

export function formatDistance(au: number): string {
  return au < 0.01
    ? `${Math.round(au * 149_597_870.7).toLocaleString('en-US')} km`
    : `${au.toFixed(3)} AU`
}
