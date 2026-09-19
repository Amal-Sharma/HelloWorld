import {
  Body,
  HelioVector,
  MakeTime,
  RotateVector,
  Rotation_ECL_EQJ,
  Rotation_EQJ_GAL,
  Vector,
} from 'astronomy-engine'
import type { CelestialObject } from '../data/catalog'
import { getPosition } from './astronomy'
import type { Position } from './astronomy'

export const AU_PER_PARSEC = 206264.80624709636
export const KM_PER_PARSEC = 3.085677581491367e13
export const LIGHT_YEARS_PER_PARSEC = 3.261563777
export const OBSERVABLE_RADIUS_PC = 14.26e9
export const LIGHT_SPEED_KM_S = 299792.458

export interface DistanceMeasurement {
  fromId: string
  toId: string
  distancePc: number | null
  lightSeconds: number | null
  basis: 'calculated' | 'catalog' | 'cosmological'
  unavailable: string | null
}

export function measurePositions(first: Position, second: Position) {
  if (!first.every(Number.isFinite) || !second.every(Number.isFinite))
    return null
  const distancePc = Math.hypot(
    ...first.map((coordinate, index) => coordinate - second[index]),
  )
  return {
    distancePc,
    lightSeconds: (distancePc * KM_PER_PARSEC) / LIGHT_SPEED_KM_S,
  }
}

export function formatLightTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unavailable'
  const [duration, unit] =
    seconds < 60
      ? [seconds, 's']
      : seconds < 3600
        ? [seconds / 60, 'min']
        : seconds < 86400
          ? [seconds / 3600, 'h']
          : seconds < 31557600
            ? [seconds / 86400, 'days']
            : [seconds / 31557600, seconds === 31557600 ? 'year' : 'years']
  return `${duration.toLocaleString('en-US', { maximumSignificantDigits: 4 })} ${unit}`
}

export function formatRulerDistance(parsecs: number): string {
  if (parsecs * AU_PER_PARSEC >= 0.01 && parsecs < 0.02)
    return `${(parsecs * AU_PER_PARSEC).toLocaleString('en-US', { maximumSignificantDigits: 5 })} AU`
  return formatWorldDistance(parsecs)
}

const epoch = MakeTime(new Date('2000-01-01T12:00:00Z'))
const galacticRotation = Rotation_EQJ_GAL()
const eclipticRotation = Rotation_ECL_EQJ()

export function eclipticToWorld(positionAu: Position): Position {
  const equatorial = RotateVector(
    eclipticRotation,
    new Vector(positionAu[0], -positionAu[2], positionAu[1], epoch),
  )
  const galactic = RotateVector(galacticRotation, equatorial)
  return [
    galactic.x / AU_PER_PARSEC,
    galactic.z / AU_PER_PARSEC,
    -galactic.y / AU_PER_PARSEC,
  ]
}

export function catalogToWorld(positionPc: Position): Position {
  return [positionPc[0], positionPc[2], -positionPc[1]]
}

export function solarPositionPc(object: CelestialObject, date: Date): Position {
  const position = eclipticToWorld(getPosition(object, date))
  if (object.id !== 'moon' && !object.jovianMoon && !object.saturnianMoon)
    return position
  const primary = RotateVector(
    galacticRotation,
    HelioVector(
      object.saturnianMoon
        ? Body.Saturn
        : object.jovianMoon
          ? Body.Jupiter
          : Body.Earth,
      date,
    ),
  )
  return [
    position[0] + primary.x / AU_PER_PARSEC,
    position[1] + primary.z / AU_PER_PARSEC,
    position[2] - primary.y / AU_PER_PARSEC,
  ]
}

export function skyPositionPc(
  rightAscensionHours: number,
  declinationDegrees: number,
  distancePc: number,
): Position {
  const azimuth = (rightAscensionHours * Math.PI) / 12
  const altitude = (declinationDegrees * Math.PI) / 180
  const vector = new Vector(
    Math.cos(azimuth) * Math.cos(altitude) * distancePc,
    Math.sin(azimuth) * Math.cos(altitude) * distancePc,
    Math.sin(altitude) * distancePc,
    epoch,
  )
  const galactic = RotateVector(galacticRotation, vector)
  return [galactic.x, galactic.z, -galactic.y]
}

export function renderUnitPc(distancePc: number): number {
  return (
    10 **
    Math.max(
      -15,
      Math.min(10, Math.floor(Math.log10(Math.max(distancePc, 1e-14) / 8))),
    )
  )
}

export function relativePosition(
  positionPc: Position,
  originPc: Position,
  unitPc: number,
): Position {
  return positionPc.map(
    (coordinate, index) => (coordinate - originPc[index]) / unitPc,
  ) as Position
}

export function absolutePosition(
  position: Position,
  originPc: Position,
  unitPc: number,
): Position {
  return position.map(
    (coordinate, index) => originPc[index] + coordinate * unitPc,
  ) as Position
}

export function formatWorldDistance(parsecs: number): string {
  const absolute = Math.abs(parsecs)
  if (absolute * KM_PER_PARSEC < 1)
    return `${(parsecs * KM_PER_PARSEC * 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} m`
  if (absolute < 0.00001)
    return `${(parsecs * KM_PER_PARSEC).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
  if (absolute < 0.02)
    return `${(parsecs * AU_PER_PARSEC).toLocaleString('en-US', { maximumFractionDigits: 2 })} AU`
  const lightYears = parsecs * LIGHT_YEARS_PER_PARSEC
  if (absolute < 1000)
    return `${lightYears.toLocaleString('en-US', { maximumFractionDigits: 2 })} ly`
  if (absolute < 1e6) return `${(lightYears / 1000).toFixed(2)} thousand ly`
  if (absolute < 1e9) return `${(lightYears / 1e6).toFixed(2)} million ly`
  return `${(lightYears / 1e9).toFixed(2)} billion ly`
}
