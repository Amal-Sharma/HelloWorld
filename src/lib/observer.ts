import {
  Body,
  Constellation,
  Equator,
  EquatorFromVector,
  GeoVector,
  Horizon,
  MakeTime,
  Observer,
  ObserverVector,
  RotateVector,
  Rotation_EQJ_EQD,
  Rotation_GAL_EQJ,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  SearchTransit,
  Vector,
} from 'astronomy-engine'
import type { StarRow } from '../data/extendedCatalog'
import { MAX_DATE } from './astronomy'

export interface ObserverSite {
  latitude: number
  longitude: number
  elevation: number
  constellations: boolean
}
export const defaultObserver: ObserverSite = {
  latitude: 51.4779,
  longitude: 0,
  elevation: 46,
  constellations: true,
}
export const observerPresets = [
  { name: 'Greenwich', ...defaultObserver },
  {
    name: 'New Delhi',
    latitude: 28.6139,
    longitude: 77.209,
    elevation: 216,
    constellations: true,
  },
  {
    name: 'New York',
    latitude: 40.7128,
    longitude: -74.006,
    elevation: 10,
    constellations: true,
  },
  {
    name: 'Sydney',
    latitude: -33.8688,
    longitude: 151.2093,
    elevation: 58,
    constellations: true,
  },
  {
    name: 'Dallas',
    latitude: 32.7767,
    longitude: -96.797,
    elevation: 131,
    constellations: true,
  },
]

export function validObserver(site: ObserverSite): boolean {
  return (
    [site.latitude, site.longitude, site.elevation].every(Number.isFinite) &&
    Math.abs(site.latitude) <= 90 &&
    Math.abs(site.longitude) <= 180 &&
    site.elevation >= -500 &&
    site.elevation <= 10000
  )
}

export function horizontalDirection(
  azimuth: number,
  altitude: number,
): [number, number, number] {
  const longitude = (azimuth * Math.PI) / 180
  const latitude = (altitude * Math.PI) / 180
  return [
    Math.sin(longitude) * Math.cos(latitude),
    Math.sin(latitude),
    -Math.cos(longitude) * Math.cos(latitude),
  ]
}

export function observerBody(body: Body, date: Date, site: ObserverSite) {
  const observer = new Observer(site.latitude, site.longitude, site.elevation)
  const equatorial = Equator(body, date, observer, true, true)
  const horizon = Horizon(
    date,
    observer,
    equatorial.ra,
    equatorial.dec,
    'normal',
  )
  return {
    body,
    distanceAu: equatorial.dist,
    altitude: horizon.altitude,
    azimuth: horizon.azimuth,
    direction: horizontalDirection(horizon.azimuth, horizon.altitude),
  }
}

export function earthShadow(date: Date, site: ObserverSite) {
  const sun = GeoVector(Body.Sun, date, false)
  const moon = GeoVector(Body.Moon, date, false)
  const sunDistance = Math.hypot(sun.x, sun.y, sun.z)
  const unit = [
    -sun.x / sunDistance,
    -sun.y / sunDistance,
    -sun.z / sunDistance,
  ]
  const depth = moon.x * unit[0] + moon.y * unit[1] + moon.z * unit[2]
  if (depth <= 0) return null
  const shadow = RotateVector(
    Rotation_EQJ_EQD(date),
    new Vector(
      unit[0] * depth,
      unit[1] * depth,
      unit[2] * depth,
      MakeTime(date),
    ),
  )
  const observer = new Observer(site.latitude, site.longitude, site.elevation)
  const surface = ObserverVector(date, observer, true)
  const equatorial = EquatorFromVector(
    new Vector(
      shadow.x - surface.x,
      shadow.y - surface.y,
      shadow.z - surface.z,
      MakeTime(date),
    ),
  )
  const horizon = Horizon(
    date,
    observer,
    equatorial.ra,
    equatorial.dec,
    'normal',
  )
  const umbraKm = 6378.137 - (depth / sunDistance) * (695700 - 6378.137)
  const penumbraKm = 6378.137 + (depth / sunDistance) * (695700 + 6378.137)
  return {
    direction: horizontalDirection(horizon.azimuth, horizon.altitude),
    umbraRadians: Math.max(0, umbraKm) / (equatorial.dist * 149597870.7),
    penumbraRadians: penumbraKm / (equatorial.dist * 149597870.7),
  }
}

export function solarObscuration(date: Date, site: ObserverSite): number {
  const sun = observerBody(Body.Sun, date, site)
  const moon = observerBody(Body.Moon, date, site)
  const sunRadius = 695700 / (sun.distanceAu * 149597870.7)
  const moonRadius = 1737.4 / (moon.distanceAu * 149597870.7)
  const separation = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        sun.direction.reduce(
          (sum, value, index) => sum + value * moon.direction[index],
          0,
        ),
      ),
    ),
  )
  if (separation >= sunRadius + moonRadius) return 0
  if (separation <= Math.abs(sunRadius - moonRadius))
    return Math.min(1, (moonRadius / sunRadius) ** 2)
  const first = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        (separation ** 2 + sunRadius ** 2 - moonRadius ** 2) /
          (2 * separation * sunRadius),
      ),
    ),
  )
  const second = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        (separation ** 2 + moonRadius ** 2 - sunRadius ** 2) /
          (2 * separation * moonRadius),
      ),
    ),
  )
  const area =
    sunRadius ** 2 * first +
    moonRadius ** 2 * second -
    0.5 *
      Math.sqrt(
        Math.max(
          0,
          (-separation + sunRadius + moonRadius) *
            (separation + sunRadius - moonRadius) *
            (separation - sunRadius + moonRadius) *
            (separation + sunRadius + moonRadius),
        ),
      )
  return Math.min(1, Math.max(0, area / (Math.PI * sunRadius ** 2)))
}

export function observerStars(rows: StarRow[], date: Date, site: ObserverSite) {
  const epoch = MakeTime(new Date('2000-01-01T12:00:00Z'))
  const galactic = Rotation_GAL_EQJ()
  const precession = Rotation_EQJ_EQD(date)
  const observer = new Observer(site.latitude, site.longitude, site.elevation)
  return rows
    .filter(
      (row) =>
        row[3] !== null &&
        row[4] !== null &&
        row[5] !== null &&
        (row[6] ?? 99) < 6.5,
    )
    .sort((first, second) => (first[6] ?? 99) - (second[6] ?? 99))
    .slice(0, 2400)
    .map((row) => {
      const vector = RotateVector(
        galactic,
        new Vector(row[3]!, row[4]!, row[5]!, epoch),
      )
      const j2000 = EquatorFromVector(vector)
      const ofDate = EquatorFromVector(RotateVector(precession, vector))
      const horizon = Horizon(date, observer, ofDate.ra, ofDate.dec, 'normal')
      return {
        name: row[1],
        magnitude: row[6] ?? 6,
        spectrum: row[7],
        altitude: horizon.altitude,
        direction: horizontalDirection(horizon.azimuth, horizon.altitude),
        constellation: Constellation(j2000.ra, j2000.dec).name,
      }
    })
}

export interface SkyEvent {
  id: string
  label: string
  kind: 'solar' | 'lunar' | 'transit'
  body: Body
  peak: number
  start: number
  finish: number
  altitude: number
  obscuration?: number
  site: ObserverSite
}

export function upcomingEvents(date: Date, site: ObserverSite): SkyEvent[] {
  if (!validObserver(site)) return []
  const observer = new Observer(site.latitude, site.longitude, site.elevation)
  const solar = SearchLocalSolarEclipse(date, observer)
  const lunar = SearchLunarEclipse(date)
  const events: SkyEvent[] = [
    {
      id: `solar-${solar.peak.time.ut}`,
      label: `${solar.kind} solar eclipse`,
      kind: 'solar',
      body: Body.Sun,
      peak: solar.peak.time.date.getTime(),
      start: solar.partial_begin.time.date.getTime(),
      finish: solar.partial_end.time.date.getTime(),
      altitude: solar.peak.altitude,
      obscuration: solar.obscuration,
      site,
    },
    {
      id: `lunar-${lunar.peak.ut}`,
      label: `${lunar.kind} lunar eclipse`,
      kind: 'lunar',
      body: Body.Moon,
      peak: lunar.peak.date.getTime(),
      start: lunar.peak.date.getTime() - lunar.sd_penum * 60000,
      finish: lunar.peak.date.getTime() + lunar.sd_penum * 60000,
      altitude: observerBody(Body.Moon, lunar.peak.date, site).altitude,
      obscuration: lunar.obscuration,
      site,
    },
  ]
  for (const body of [Body.Mercury, Body.Venus]) {
    const transit = SearchTransit(body, date)
    events.push({
      id: `${body}-${transit.peak.ut}`,
      label: `${body} transit`,
      kind: 'transit',
      body,
      peak: transit.peak.date.getTime(),
      start: transit.start.date.getTime(),
      finish: transit.finish.date.getTime(),
      altitude: observerBody(Body.Sun, transit.peak.date, site).altitude,
      site,
    })
  }
  return events
    .filter((event) => event.peak <= MAX_DATE)
    .sort((first, second) => first.peak - second.peak)
}
