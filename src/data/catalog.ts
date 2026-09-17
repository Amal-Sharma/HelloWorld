import { Body } from 'astronomy-engine'
import {
  getExtendedObject,
  hasExtendedObject,
  searchExtendedCatalog,
} from './extendedCatalog'

export type ObjectKind =
  | 'planet'
  | 'exoplanet'
  | 'dwarf-planet'
  | 'comet'
  | 'asteroid'
  | 'moon'
  | 'star'
  | 'black-hole'
  | 'nebula'
  | 'supernova'
  | 'neutron-star'
  | 'quasar'
  | 'galaxy'
  | 'cluster'
  | 'star-cluster'
  | 'system'
  | 'universe'
export type SceneKind =
  | 'planet'
  | 'comet'
  | 'star'
  | 'black-hole'
  | 'nebula'
  | 'supernova'
  | 'pulsar'
  | 'galaxy'
  | 'cluster'
  | 'star-cluster'
  | 'system'
  | 'universe'

export interface OrbitalElements {
  semiMajorAxis: number
  eccentricity: number
  inclination: number
  ascendingNode: number
  perihelionArgument: number
  meanAnomaly: number
  epoch: number
  perihelionTime: number
  perihelionDistance: number
}

export interface OrbitData {
  parent: string
  period: string
  periodDays?: number
  semiMajorAxis?: number
  eccentricity?: number
  inclination?: number
  speed: string
  model: 'ephemeris' | 'kepler' | 'illustrative' | 'none'
  note: string
}

export interface CelestialObject {
  id: string
  name: string
  kind: ObjectKind
  scene: SceneKind
  classification: string
  subtitle: string
  description: string
  location: string
  distance: string
  color: string
  texture?: string
  parent?: string
  body?: Body
  radiusKm?: number
  rotationHours?: number
  galacticPosition?: [number, number, number]
  elements?: OrbitalElements
  jovianMoon?: 'io' | 'europa' | 'ganymede' | 'callisto'
  skyPosition?: {
    rightAscensionHours: number
    declinationDegrees: number
    distancePc: number
    radiusPc: number
  }
  facts: { label: string; value: string }[]
  orbit: OrbitData
  source: string
}

export const categories: { kind: ObjectKind; label: string }[] = [
  { kind: 'planet', label: 'Planets' },
  { kind: 'dwarf-planet', label: 'Dwarf planets' },
  { kind: 'comet', label: 'Comets' },
  { kind: 'asteroid', label: 'Asteroids' },
  { kind: 'exoplanet', label: 'Exoplanets' },
  { kind: 'moon', label: 'Moons' },
  { kind: 'star', label: 'Stars' },
  { kind: 'system', label: 'Solar systems' },
  { kind: 'black-hole', label: 'Black holes' },
  { kind: 'nebula', label: 'Nebulae' },
  { kind: 'supernova', label: 'Supernovae' },
  { kind: 'neutron-star', label: 'Neutron stars' },
  { kind: 'quasar', label: 'Quasars' },
  { kind: 'galaxy', label: 'Galaxies' },
  { kind: 'cluster', label: 'Groups & clusters' },
  { kind: 'star-cluster', label: 'Star clusters' },
  { kind: 'universe', label: 'Observable universe' },
]

const solarOrbit = (
  periodDays: number,
  semiMajorAxis: number,
  eccentricity: number,
  inclination: number,
  speed: string,
): OrbitData => ({
  parent: 'Sun',
  period: `${periodDays.toLocaleString('en-US')} days`,
  periodDays,
  semiMajorAxis,
  eccentricity,
  inclination,
  speed,
  model: 'ephemeris',
  note: 'Heliocentric positions computed with Astronomy Engine. Distances are in AU; body sizes are enlarged for visibility.',
})

const galacticOrbit = (parent = 'Milky Way'): OrbitData => ({
  parent,
  period: 'Not well constrained',
  speed: 'Not specified',
  model: 'illustrative',
  note: 'A member of its host galaxy. A reliable individual orbital solution is not available in this catalog; the context view is illustrative.',
})

const noOrbit = (note: string, parent = 'Not applicable'): OrbitData => ({
  parent,
  period: 'No single orbit',
  speed: 'Not applicable',
  model: 'none',
  note,
})

const planets = [
  {
    id: 'mercury',
    name: 'Mercury',
    body: Body.Mercury,
    color: '#acaba6',
    radius: 2439.7,
    mass: '3.30 x 10^23 kg',
    temperature: '167 C',
    day: 1407.6,
    period: 87.969,
    axis: 0.3871,
    eccentricity: 0.2056,
    inclination: 7.005,
    speed: '47.4 km/s',
    subtitle: 'A world of extremes.',
    description:
      'The smallest planet and the closest to the Sun. Its ancient, cratered surface swings from scorching daylight to intensely cold nights.',
    classification: 'Terrestrial planet',
  },
  {
    id: 'venus',
    name: 'Venus',
    body: Body.Venus,
    color: '#e6c68c',
    radius: 6051.8,
    mass: '4.87 x 10^24 kg',
    temperature: '464 C',
    day: -5832.5,
    period: 224.701,
    axis: 0.7233,
    eccentricity: 0.0068,
    inclination: 3.395,
    speed: '35.0 km/s',
    subtitle: 'Beautiful. Unforgiving.',
    description:
      'Wrapped in thick sulfuric-acid clouds, Venus has a crushing carbon-dioxide atmosphere. A runaway greenhouse effect makes it the hottest planet.',
    classification: 'Terrestrial planet',
  },
  {
    id: 'earth',
    name: 'Earth',
    body: Body.Earth,
    color: '#7fbbd8',
    radius: 6371,
    mass: '5.97 x 10^24 kg',
    temperature: '15 C',
    day: 23.9345,
    period: 365.256,
    axis: 1,
    eccentricity: 0.0167,
    inclination: 0,
    speed: '29.8 km/s',
    subtitle: 'Our pale blue dot.',
    description:
      'An ocean world beneath a thin veil of atmosphere. Earth is the only place in the universe known to harbor life, and the starting point of every human journey.',
    classification: 'Terrestrial planet',
  },
  {
    id: 'mars',
    name: 'Mars',
    body: Body.Mars,
    color: '#da8569',
    radius: 3389.5,
    mass: '6.42 x 10^23 kg',
    temperature: '-65 C',
    day: 24.6229,
    period: 686.98,
    axis: 1.5237,
    eccentricity: 0.0934,
    inclination: 1.85,
    speed: '24.1 km/s',
    subtitle: 'The next horizon.',
    description:
      'A cold desert with giant volcanoes, polar ice, and the traces of ancient rivers. Mars preserves evidence of a much wetter past.',
    classification: 'Terrestrial planet',
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    body: Body.Jupiter,
    color: '#d5baa1',
    radius: 69911,
    mass: '1.90 x 10^27 kg',
    temperature: '-110 C',
    day: 9.925,
    period: 4332.59,
    axis: 5.2028,
    eccentricity: 0.0489,
    inclination: 1.303,
    speed: '13.1 km/s',
    subtitle: 'King of the planets.',
    description:
      'More massive than all the other planets combined, Jupiter is a gas giant of swirling clouds. Its Great Red Spot is a storm larger than Earth.',
    classification: 'Gas giant',
  },
  {
    id: 'saturn',
    name: 'Saturn',
    body: Body.Saturn,
    color: '#e5d2a8',
    radius: 58232,
    mass: '5.68 x 10^26 kg',
    temperature: '-140 C',
    day: 10.7,
    period: 10759.22,
    axis: 9.5388,
    eccentricity: 0.0565,
    inclination: 2.485,
    speed: '9.7 km/s',
    subtitle: 'A world apart.',
    description:
      'Saturn wears a spectacular system of rings made mostly of ice. Beneath its muted cloud bands lies a giant world with a density lower than water.',
    classification: 'Gas giant',
  },
  {
    id: 'uranus',
    name: 'Uranus',
    body: Body.Uranus,
    color: '#9ed6da',
    radius: 25362,
    mass: '8.68 x 10^25 kg',
    temperature: '-195 C',
    day: -17.24,
    period: 30688.5,
    axis: 19.1914,
    eccentricity: 0.0457,
    inclination: 0.773,
    speed: '6.8 km/s',
    subtitle: 'The sideways planet.',
    description:
      'This pale cyan ice giant rotates almost on its side. Methane in its cold atmosphere absorbs red light and gives the planet its blue-green appearance.',
    classification: 'Ice giant',
  },
  {
    id: 'neptune',
    name: 'Neptune',
    body: Body.Neptune,
    color: '#658cd8',
    radius: 24622,
    mass: '1.02 x 10^26 kg',
    temperature: '-200 C',
    day: 16.11,
    period: 60182,
    axis: 30.0611,
    eccentricity: 0.0113,
    inclination: 1.77,
    speed: '5.4 km/s',
    subtitle: 'At the edge of sunlight.',
    description:
      'Dark, cold, and swept by supersonic winds, Neptune is the most distant major planet. Its atmosphere is mostly hydrogen and helium with a trace of methane.',
    classification: 'Ice giant',
  },
]

export const catalog: CelestialObject[] = [
  ...planets.map((planet): CelestialObject => ({
    id: planet.id,
    name: planet.name,
    kind: 'planet',
    scene: 'planet',
    classification: planet.classification,
    subtitle: planet.subtitle,
    description: planet.description,
    location: 'Solar System / Orion Arm',
    distance: `${planet.axis.toFixed(2)} AU from Sun`,
    color: planet.color,
    texture: `/textures/${planet.id}.jpg`,
    parent: 'solar-system',
    body: planet.body,
    radiusKm: planet.radius,
    rotationHours: planet.day,
    facts: [
      {
        label: 'Mean radius',
        value: `${planet.radius.toLocaleString('en-US')} km`,
      },
      { label: 'Mass', value: planet.mass },
      { label: 'Mean temperature', value: planet.temperature },
      {
        label: 'Rotation',
        value: `${Math.abs(planet.day).toLocaleString('en-US')} h`,
      },
    ],
    orbit: solarOrbit(
      planet.period,
      planet.axis,
      planet.eccentricity,
      planet.inclination,
      planet.speed,
    ),
    source: `https://science.nasa.gov/${planet.id === 'earth' ? 'earth' : planet.id}/`,
  })),
  {
    id: 'moon',
    name: 'The Moon',
    kind: 'moon',
    scene: 'planet',
    classification: 'Natural satellite',
    subtitle: 'Our constant companion.',
    description:
      'A heavily cratered world with vast basalt plains. The Moon is tidally locked to Earth, always turning approximately the same face toward our planet.',
    location: 'Earth / Solar System',
    distance: '384,400 km from Earth',
    color: '#c8c8c5',
    texture: '/textures/moon.jpg',
    parent: 'earth',
    radiusKm: 1737.4,
    rotationHours: 655.72,
    facts: [
      { label: 'Mean radius', value: '1,737.4 km' },
      { label: 'Mass', value: '7.35 x 10^22 kg' },
      { label: 'Surface gravity', value: '1.62 m/s^2' },
      { label: 'Rotation', value: '27.32 days' },
    ],
    orbit: {
      parent: 'Earth',
      period: '27.322 days',
      periodDays: 27.322,
      semiMajorAxis: 0.00257,
      eccentricity: 0.0549,
      inclination: 5.145,
      speed: '1.02 km/s',
      model: 'ephemeris',
      note: 'Geocentric lunar positions from Astronomy Engine. The distance and orbit are displayed with enlarged bodies.',
    },
    source: 'https://science.nasa.gov/moon/',
  },
  {
    id: 'sun',
    name: 'The Sun',
    kind: 'star',
    scene: 'star',
    classification: 'G2V main-sequence star',
    subtitle: 'The star that made us.',
    description:
      "A sphere of hot plasma powered by nuclear fusion. The Sun holds 99.86% of the Solar System's mass and supplies nearly all the energy that sustains life on Earth.",
    location: 'Orion Arm / Milky Way',
    distance: '149.6 million km from Earth',
    color: '#ffd790',
    texture: '/textures/sun.jpg',
    parent: 'milky-way',
    radiusKm: 695700,
    rotationHours: 609.12,
    facts: [
      { label: 'Mean radius', value: '695,700 km' },
      { label: 'Temperature', value: '5,772 K' },
      { label: 'Age', value: '4.6 billion yr' },
      { label: 'Spectral type', value: 'G2V' },
    ],
    orbit: {
      parent: 'Milky Way center',
      period: '~230 million years',
      speed: '~220 km/s',
      model: 'illustrative',
      note: 'The Sun orbits the Galactic center. The galactic path is a schematic, not a measured future trajectory.',
    },
    source: 'https://science.nasa.gov/sun/',
  },
  {
    id: 'proxima',
    name: 'Proxima Centauri',
    kind: 'star',
    scene: 'star',
    classification: 'M5.5V red dwarf',
    subtitle: 'The star next door.',
    description:
      'The nearest star to the Sun is a small, cool red dwarf in the Alpha Centauri system. It hosts at least two confirmed planets and produces frequent stellar flares.',
    location: 'Alpha Centauri / Milky Way',
    distance: '4.25 light-years',
    color: '#ff956e',
    parent: 'milky-way',
    radiusKm: 107280,
    rotationHours: 1992,
    facts: [
      { label: 'Radius', value: '0.154 solar' },
      { label: 'Temperature', value: '~3,042 K' },
      { label: 'Distance', value: '4.25 ly' },
      { label: 'Spectral type', value: 'M5.5V' },
    ],
    orbit: {
      parent: 'Alpha Centauri A & B',
      period: '~550,000 years',
      speed: 'Variable',
      model: 'illustrative',
      note: 'Proxima follows a very wide orbit around the Alpha Centauri binary. Its context is shown schematically.',
    },
    source: 'https://science.nasa.gov/exoplanets/',
  },
  {
    id: 'sirius',
    name: 'Sirius A',
    kind: 'star',
    scene: 'star',
    classification: 'A1V main-sequence star',
    subtitle: 'The brightest in our night.',
    description:
      "The brightest star in Earth's night sky is a hot, blue-white star. It shares a binary orbit with Sirius B, a faint white dwarf.",
    location: 'Canis Major / Milky Way',
    distance: '8.60 light-years',
    color: '#c6e5ff',
    parent: 'milky-way',
    radiusKm: 1190000,
    rotationHours: 120,
    facts: [
      { label: 'Radius', value: '1.71 solar' },
      { label: 'Temperature', value: '~9,940 K' },
      { label: 'Distance', value: '8.60 ly' },
      { label: 'Luminosity', value: '~25 solar' },
    ],
    orbit: {
      parent: 'Sirius A-B barycenter',
      period: '50.13 years',
      speed: 'Variable',
      eccentricity: 0.591,
      model: 'illustrative',
      note: 'Sirius A and its white dwarf companion orbit their common center of mass. The binary context is illustrative.',
    },
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'betelgeuse',
    name: 'Betelgeuse',
    kind: 'star',
    scene: 'star',
    classification: 'Red supergiant',
    subtitle: 'A star in its final act.',
    description:
      "A huge, variable red supergiant at Orion's shoulder. Betelgeuse is nearing the end of its life, but the timing of its eventual supernova is uncertain.",
    location: 'Orion / Milky Way',
    distance: '~550 light-years',
    color: '#ffa170',
    parent: 'milky-way',
    radiusKm: 530000000,
    rotationHours: 315576,
    facts: [
      { label: 'Radius', value: '~760 solar' },
      { label: 'Temperature', value: '~3,500 K' },
      { label: 'Distance', value: '~550 ly' },
      { label: 'Age', value: '~8-14 million yr' },
    ],
    orbit: galacticOrbit(),
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'solar-system',
    name: 'Solar System',
    kind: 'system',
    scene: 'system',
    classification: 'Planetary system',
    subtitle: 'Our celestial neighborhood.',
    description:
      'One star, eight planets, and countless smaller worlds. Explore the planets along their calculated heliocentric orbits, from Mercury to Neptune.',
    location: 'Orion Arm / Milky Way',
    distance: 'You are here',
    color: '#d5ecab',
    parent: 'milky-way',
    facts: [
      { label: 'Age', value: '4.6 billion yr' },
      { label: 'Planets', value: '8' },
      { label: 'Host star', value: 'The Sun' },
      { label: 'Galactic radius', value: '~26,000 ly' },
    ],
    orbit: {
      parent: 'Milky Way center',
      period: '~230 million years',
      speed: '~220 km/s',
      model: 'illustrative',
      note: "Planet positions use Astronomy Engine ephemerides. The Solar System's galactic orbit is schematic. Planet sizes are exaggerated, with a distance-compressed overview.",
    },
    source: 'https://science.nasa.gov/solar-system/',
  },
  {
    id: 'sagittarius-a',
    name: 'Sagittarius A*',
    kind: 'black-hole',
    scene: 'black-hole',
    classification: 'Supermassive black hole',
    subtitle: 'The heart of our galaxy.',
    description:
      'The compact object at the center of the Milky Way contains roughly four million solar masses. Its shadow was imaged by the Event Horizon Telescope in 2022.',
    location: 'Galactic Center / Milky Way',
    distance: '~26,000 light-years',
    color: '#ffb877',
    parent: 'milky-way',
    facts: [
      { label: 'Mass', value: '~4.3 million Suns' },
      { label: 'Event horizon radius', value: '~12.7 million km' },
      { label: 'Distance', value: '~26,000 ly' },
      { label: 'First shadow image', value: '2022' },
    ],
    orbit: noOrbit(
      'Located near the Galactic dynamical center. Nearby stars, including S2, orbit the black hole; it has no single cataloged orbit about another object.',
      'Galactic Center',
    ),
    source: 'https://science.nasa.gov/universe/black-holes/',
  },
  {
    id: 'm87-black-hole',
    name: 'M87*',
    kind: 'black-hole',
    scene: 'black-hole',
    classification: 'Supermassive black hole',
    subtitle: 'The first shadow ever seen.',
    description:
      'The central black hole of the giant elliptical galaxy M87. Its enormous relativistic jet and glowing ring made it the first black hole directly imaged by the EHT.',
    location: 'Messier 87 / Virgo Cluster',
    distance: '~55 million light-years',
    color: '#ffc17e',
    parent: 'virgo',
    facts: [
      { label: 'Mass', value: '~6.5 billion Suns' },
      { label: 'Horizon radius', value: '~19 billion km' },
      { label: 'Distance', value: '~55 million ly' },
      { label: 'First shadow image', value: '2019' },
    ],
    orbit: noOrbit(
      'M87* is near the center of its host galaxy. The luminous disk is accreting material, not a solid ring. This rendering is an artistic visualization.',
      'Messier 87',
    ),
    source: 'https://science.nasa.gov/universe/black-holes/',
  },
  {
    id: 'cygnus-x1',
    name: 'Cygnus X-1',
    kind: 'black-hole',
    scene: 'black-hole',
    classification: 'Stellar-mass black hole',
    subtitle: 'A dark companion.',
    description:
      'One of the first convincing black-hole candidates. It draws material from a blue supergiant companion, forming a hot, X-ray-emitting accretion disk.',
    location: 'Cygnus / Milky Way',
    distance: '~7,200 light-years',
    color: '#f4b885',
    parent: 'milky-way',
    facts: [
      { label: 'Mass', value: '~21 solar' },
      { label: 'Companion', value: 'HDE 226868' },
      { label: 'Distance', value: '~7,200 ly' },
      { label: 'Binary period', value: '5.6 days' },
    ],
    orbit: {
      parent: 'Binary barycenter',
      period: '5.6 days',
      speed: 'Variable',
      model: 'illustrative',
      note: 'The black hole and its supergiant companion orbit a shared center of mass. The accretion disk and binary context are artistic.',
    },
    source: 'https://science.nasa.gov/universe/black-holes/',
  },
  {
    id: 'orion',
    name: 'Orion Nebula',
    kind: 'nebula',
    scene: 'nebula',
    classification: 'Emission nebula / M42',
    subtitle: 'Where new suns are born.',
    description:
      'A vast stellar nursery lit by the hot young stars of the Trapezium. Within its glowing gas and dark dust, new stars and planetary systems are taking shape.',
    location: 'Orion / Milky Way',
    distance: '~1,344 light-years',
    color: '#d796d1',
    parent: 'milky-way',
    facts: [
      { label: 'Span', value: '~24 light-years' },
      { label: 'Distance', value: '~1,344 ly' },
      { label: 'Catalog', value: 'Messier 42' },
      { label: 'Type', value: 'Stellar nursery' },
    ],
    orbit: galacticOrbit(),
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42-the-orion-nebula/',
  },
  {
    id: 'carina',
    name: 'Carina Nebula',
    kind: 'nebula',
    scene: 'nebula',
    classification: 'Emission nebula / NGC 3372',
    subtitle: 'A landscape of starlight.',
    description:
      "A monumental cloud of gas and dust containing some of the Milky Way's most massive stars. Stellar winds sculpt its ridges, pillars, and dark cavities.",
    location: 'Carina / Milky Way',
    distance: '~7,500 light-years',
    color: '#dcac85',
    parent: 'milky-way',
    facts: [
      { label: 'Span', value: '~300 light-years' },
      { label: 'Distance', value: '~7,500 ly' },
      { label: 'Catalog', value: 'NGC 3372' },
      { label: 'Type', value: 'Stellar nursery' },
    ],
    orbit: galacticOrbit(),
    source: 'https://science.nasa.gov/mission/webb/',
  },
  {
    id: 'helix',
    name: 'Helix Nebula',
    kind: 'nebula',
    scene: 'nebula',
    classification: 'Planetary nebula / NGC 7293',
    subtitle: "A star's last exhalation.",
    description:
      'The expanding outer layers of a dying Sun-like star form a luminous shell around a white dwarf. Despite the name, planetary nebulae have nothing to do with planets.',
    location: 'Aquarius / Milky Way',
    distance: '~650 light-years',
    color: '#86d4cf',
    parent: 'milky-way',
    facts: [
      { label: 'Span', value: '~2.5 light-years' },
      { label: 'Distance', value: '~650 ly' },
      { label: 'Catalog', value: 'NGC 7293' },
      { label: 'Central object', value: 'White dwarf' },
    ],
    orbit: galacticOrbit(),
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'crab',
    name: 'Crab Nebula',
    kind: 'supernova',
    scene: 'supernova',
    classification: 'Supernova remnant / M1',
    subtitle: 'The echo of a stellar explosion.',
    description:
      'The expanding remnant of a supernova recorded on Earth in 1054. A rapidly spinning neutron star at its heart powers the glowing gas and energetic radiation.',
    location: 'Taurus / Milky Way',
    distance: '~6,500 light-years',
    color: '#86dfcd',
    parent: 'milky-way',
    facts: [
      { label: 'Span', value: '~11 light-years' },
      { label: 'Observed explosion', value: '1054 CE' },
      { label: 'Distance', value: '~6,500 ly' },
      { label: 'Central object', value: 'Crab Pulsar' },
    ],
    orbit: noOrbit(
      'The remnant expands outward rather than following a single closed orbit. It also participates in the overall motion of the Milky Way.',
      'Milky Way',
    ),
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-1-the-crab-nebula/',
  },
  {
    id: 'sn1987a',
    name: 'SN 1987A',
    kind: 'supernova',
    scene: 'supernova',
    classification: 'Type II supernova remnant',
    subtitle: 'A supernova in our lifetime.',
    description:
      'Light from this stellar explosion reached Earth in February 1987. Its shock wave now interacts with rings of material shed by the progenitor star.',
    location: 'Large Magellanic Cloud',
    distance: '~168,000 light-years',
    color: '#efac9e',
    parent: 'local-group',
    facts: [
      { label: 'Observed explosion', value: '23 Feb 1987' },
      { label: 'Distance', value: '~168,000 ly' },
      { label: 'Progenitor', value: 'Blue supergiant' },
      { label: 'Type', value: 'Core collapse' },
    ],
    orbit: noOrbit(
      'An expanding supernova remnant in the Large Magellanic Cloud. The shell is not an orbit; its visualization is illustrative.',
      'Large Magellanic Cloud',
    ),
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'crab-pulsar',
    name: 'Crab Pulsar',
    kind: 'neutron-star',
    scene: 'pulsar',
    classification: 'Pulsar / PSR B0531+21',
    subtitle: 'Thirty heartbeats a second.',
    description:
      'A city-sized neutron star left behind by the supernova of 1054. Its rotating magnetic field sweeps beams of radiation through space like a cosmic lighthouse.',
    location: 'Crab Nebula / Milky Way',
    distance: '~6,500 light-years',
    color: '#b0e7fa',
    parent: 'crab',
    radiusKm: 12,
    facts: [
      { label: 'Estimated radius', value: '~10-15 km' },
      { label: 'Spin period', value: '~33 ms' },
      { label: 'Distance', value: '~6,500 ly' },
      { label: 'Type', value: 'Neutron star' },
    ],
    orbit: noOrbit(
      'An isolated pulsar with no confirmed binary companion. The rotating light beams show spin, not an orbit. Rotation is greatly slowed in this view.',
      'Crab Nebula',
    ),
    source: 'https://science.nasa.gov/universe/stars/neutron-stars/',
  },
  {
    id: 'vela',
    name: 'Vela Pulsar',
    kind: 'neutron-star',
    scene: 'pulsar',
    classification: 'Pulsar / PSR B0833-45',
    subtitle: 'The remnant that still shines.',
    description:
      'A rapidly rotating neutron star surrounded by a pulsar wind nebula. Its jets and arcs reveal the interaction of charged particles and intense magnetic fields.',
    location: 'Vela / Milky Way',
    distance: '~960 light-years',
    color: '#afcafa',
    parent: 'milky-way',
    radiusKm: 12,
    facts: [
      { label: 'Spin period', value: '~89 ms' },
      { label: 'Age', value: '~11,000 years' },
      { label: 'Distance', value: '~960 ly' },
      { label: 'Type', value: 'Neutron star' },
    ],
    orbit: noOrbit(
      'An isolated neutron star. No companion orbit is represented; the slowed beams depict its rotation and are an artistic visualization.',
      'Milky Way',
    ),
    source: 'https://science.nasa.gov/universe/stars/neutron-stars/',
  },
  {
    id: '3c273',
    name: '3C 273',
    kind: 'quasar',
    scene: 'black-hole',
    classification: 'Radio-loud quasar',
    subtitle: 'A beacon across cosmic time.',
    description:
      'The first quasar identified, powered by material falling toward a supermassive black hole. Its brilliant nucleus can outshine the stars of its entire host galaxy.',
    location: 'Virgo constellation',
    distance: '~2.4 billion light-years',
    color: '#c4dfff',
    parent: 'universe',
    facts: [
      { label: 'Redshift', value: '0.158' },
      { label: 'Black hole mass', value: '~900 million Suns' },
      { label: 'Lookback time', value: '~2 billion yr' },
      { label: 'Identified', value: '1963' },
    ],
    orbit: noOrbit(
      'A quasar is an active galactic nucleus, not an object with a single orbit. Gas in the accretion disk orbits and falls toward the central black hole.',
      'Host galaxy nucleus',
    ),
    source: 'https://science.nasa.gov/universe/galaxies/active-galaxies/',
  },
  {
    id: 'ton618',
    name: 'TON 618',
    kind: 'quasar',
    scene: 'black-hole',
    classification: 'Hyperluminous quasar',
    subtitle: 'An almost unimaginable scale.',
    description:
      'An exceptionally luminous distant quasar containing an ultramassive black hole. Its mass estimates are uncertain and depend on models of its broad emission lines.',
    location: 'Canes Venatici constellation',
    distance: '~10.4 billion light-years lookback',
    color: '#ead5b3',
    parent: 'universe',
    facts: [
      { label: 'Estimated mass', value: '~40-66 billion Suns' },
      { label: 'Redshift', value: '2.219' },
      { label: 'Lookback time', value: '~10.4 billion yr' },
      { label: 'Type', value: 'Active nucleus' },
    ],
    orbit: noOrbit(
      'An active galactic nucleus. A single orbital period is not meaningful for the quasar as a whole. The disk and lensing here are an artistic approximation.',
      'Host galaxy nucleus',
    ),
    source: 'https://science.nasa.gov/universe/galaxies/active-galaxies/',
  },
  {
    id: 'milky-way',
    name: 'Milky Way',
    kind: 'galaxy',
    scene: 'galaxy',
    classification: 'Barred spiral galaxy',
    subtitle: 'An island of a hundred billion suns.',
    description:
      'Our home galaxy is a barred spiral with a bright central bulge and sweeping arms of stars, gas, and dust. The Sun lies in a smaller structure called the Orion Arm.',
    location: 'Local Group / Laniakea',
    distance: 'You are inside it',
    color: '#ddd9ce',
    parent: 'local-group',
    facts: [
      { label: 'Stellar disk diameter', value: '~100,000 ly' },
      { label: 'Stars', value: '~100-400 billion' },
      { label: 'Age', value: '~13 billion yr' },
      { label: 'Central black hole', value: 'Sagittarius A*' },
    ],
    orbit: {
      parent: 'Local Group barycenter',
      period: 'No simple closed orbit',
      speed: '~110 km/s toward M31',
      model: 'illustrative',
      note: 'Stars orbit within the galaxy, while the Milky Way and Andromeda move within the Local Group. Their future interaction is uncertain; no predictive galaxy orbit is drawn.',
    },
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'andromeda',
    name: 'Andromeda',
    kind: 'galaxy',
    scene: 'galaxy',
    classification: 'Spiral galaxy / M31',
    subtitle: 'Our grand spiral neighbor.',
    description:
      'The nearest large spiral galaxy to the Milky Way and the most distant object many people can see without a telescope. Andromeda and the Milky Way are approaching one another.',
    location: 'Local Group / Laniakea',
    distance: '~2.5 million light-years',
    color: '#e6d2b4',
    parent: 'local-group',
    facts: [
      { label: 'Disk diameter', value: '~152,000 ly' },
      { label: 'Stars', value: '~1 trillion' },
      { label: 'Distance', value: '~2.5 million ly' },
      { label: 'Catalog', value: 'Messier 31' },
    ],
    orbit: {
      parent: 'Local Group barycenter',
      period: 'Not a simple closed orbit',
      speed: '~110 km/s approach',
      model: 'illustrative',
      note: 'Andromeda approaches the Milky Way, but transverse motion and the influence of other galaxies complicate predictions. This catalog does not simulate their future encounter.',
    },
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31-the-andromeda-galaxy/',
  },
  {
    id: 'whirlpool',
    name: 'Whirlpool Galaxy',
    kind: 'galaxy',
    scene: 'galaxy',
    classification: 'Grand-design spiral / M51',
    subtitle: 'Gravity, written in starlight.',
    description:
      'A face-on spiral galaxy interacting with a smaller companion. Its striking arms trace lanes of dust and brilliant regions of recent star formation.',
    location: 'Canes Venatici constellation',
    distance: '~31 million light-years',
    color: '#b8d0e7',
    parent: 'virgo',
    facts: [
      { label: 'Diameter', value: '~76,000 ly' },
      { label: 'Distance', value: '~31 million ly' },
      { label: 'Catalog', value: 'Messier 51' },
      { label: 'Companion', value: 'NGC 5195' },
    ],
    orbit: {
      parent: 'M51 group',
      period: 'Not well constrained',
      speed: 'Not specified',
      model: 'illustrative',
      note: 'M51 interacts gravitationally with NGC 5195. The visual spiral is illustrative, not a reconstructed three-dimensional star catalog.',
    },
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-51-the-whirlpool-galaxy/',
  },
  {
    id: 'triangulum',
    name: 'Triangulum',
    kind: 'galaxy',
    scene: 'galaxy',
    classification: 'Spiral galaxy / M33',
    subtitle: 'The third great island.',
    description:
      'The third-largest galaxy in the Local Group is rich in star-forming regions. Its relatively small central bulge gives its loose spiral arms a delicate appearance.',
    location: 'Local Group / Laniakea',
    distance: '~2.7 million light-years',
    color: '#a5cadb',
    parent: 'local-group',
    facts: [
      { label: 'Diameter', value: '~60,000 ly' },
      { label: 'Distance', value: '~2.7 million ly' },
      { label: 'Stars', value: '~40 billion' },
      { label: 'Catalog', value: 'Messier 33' },
    ],
    orbit: galacticOrbit('Local Group'),
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'local-group',
    name: 'Local Group',
    kind: 'cluster',
    scene: 'cluster',
    classification: 'Galaxy group',
    subtitle: 'Our family of galaxies.',
    description:
      'A gravitationally bound group dominated by the Milky Way and Andromeda, with Triangulum and dozens of dwarf galaxies. It is a group, not a rich galaxy cluster.',
    location: 'Virgo Supercluster / Laniakea',
    distance: '~10 million ly across',
    color: '#d4e6ca',
    parent: 'laniakea',
    facts: [
      { label: 'Diameter', value: '~10 million ly' },
      { label: 'Members', value: '80+ galaxies' },
      { label: 'Dominant pair', value: 'Milky Way / M31' },
      { label: 'Type', value: 'Bound group' },
    ],
    orbit: noOrbit(
      "Member galaxies move in the group's gravitational field. There is no single shared orbital period. Positions in this overview are illustrative.",
      'Laniakea region',
    ),
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'virgo',
    name: 'Virgo Cluster',
    kind: 'cluster',
    scene: 'cluster',
    classification: 'Galaxy cluster',
    subtitle: 'A city of galaxies.',
    description:
      'The nearest large galaxy cluster, containing roughly 1,300 to 2,000 members. Hot intracluster gas and dark matter dominate much of its mass.',
    location: 'Virgo Supercluster / Laniakea',
    distance: '~54 million light-years',
    color: '#c6d9ef',
    parent: 'laniakea',
    facts: [
      { label: 'Members', value: '~1,300-2,000' },
      { label: 'Distance', value: '~54 million ly' },
      { label: 'Diameter', value: '~15 million ly' },
      { label: 'Central giant', value: 'Messier 87' },
    ],
    orbit: noOrbit(
      "Galaxies move within the cluster's shared gravitational potential with different trajectories. No unique cluster-wide orbit exists.",
      'Laniakea region',
    ),
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'laniakea',
    name: 'Laniakea',
    kind: 'cluster',
    scene: 'universe',
    classification: 'Supercluster / flow basin',
    subtitle: 'Immeasurable heaven.',
    description:
      'A vast region defined by the flow of galaxies toward a common gravitational basin. It contains the Milky Way but is not a single gravitationally bound structure.',
    location: 'Cosmic web',
    distance: '~520 million ly across',
    color: '#b1ded9',
    parent: 'universe',
    facts: [
      { label: 'Span', value: '~520 million ly' },
      { label: 'Galaxies', value: '~100,000' },
      { label: 'Defined', value: '2014' },
      { label: 'Type', value: 'Flow basin' },
    ],
    orbit: noOrbit(
      'A supercluster flow basin does not have a single orbit. Cosmic expansion and peculiar velocities govern large-scale motion; this network is schematic.',
    ),
    source:
      'https://science.nasa.gov/universe/galaxies/large-scale-structures/',
  },
  {
    id: 'universe',
    name: 'Observable Universe',
    kind: 'universe',
    scene: 'universe',
    classification: 'Cosmic horizon',
    subtitle: 'Everything the light can reach.',
    description:
      "The region of the universe whose light has had time to reach us. Space has expanded as that light traveled, making today's observable diameter much larger than its age in light-years.",
    location: 'The cosmic web',
    distance: '~93 billion ly across',
    color: '#d7e8cd',
    facts: [
      { label: 'Diameter today', value: '~93 billion ly' },
      { label: 'Age', value: '~13.8 billion yr' },
      { label: 'Composition', value: '~5% ordinary matter' },
      { label: 'Expansion', value: 'Accelerating' },
    ],
    orbit: noOrbit(
      'The universe does not orbit a center. This is an illustrative cosmic web, not a complete positional catalog. The observable horizon is centered on each observer.',
    ),
    source: 'https://science.nasa.gov/universe/overview/',
  },
]

catalog.push({
  id: 'nearby-stars',
  name: 'Stellar Neighborhood',
  kind: 'system',
  scene: 'cluster',
  classification: 'Stellar map / HYG + NASA',
  subtitle: 'Real coordinates. Countless destinations.',
  description:
    'Cataloged stars and confirmed exoplanet hosts plotted from their galactic coordinates. The HYG positions refer to J2000; proper motion is not propagated. Distances can be compressed. Stars with unknown distances are not placed on the map.',
  location: 'Orion Arm / Milky Way',
  distance: 'Sun-centered stellar catalog',
  parent: 'milky-way',
  color: '#b7d7e3',
  facts: [
    { label: 'Star catalog', value: 'HYG v4.1' },
    { label: 'Planet catalog', value: 'NASA PSCompPars' },
    { label: 'Reference epoch', value: 'J2000' },
    { label: 'Map origin', value: 'Solar System' },
  ],
  orbit: noOrbit(
    'Stars have distinct velocities and galactic trajectories. This map plots catalog positions rather than a future dynamical simulation.',
    'Milky Way',
  ),
  source: 'https://github.com/astronexus/HYG-Database/tree/main/hyg',
})

const jovianMoons = [
  {
    id: 'io',
    name: 'Io',
    radius: 1821.6,
    axis: 421700,
    period: 1.769138,
    eccentricity: 0.0041,
    inclination: 0.036,
    color: '#e1c66e',
    temperature: '-143 C',
    description:
      'The most volcanically active world in the Solar System. Tidal flexing from Jupiter and neighboring moons heats its interior, feeding lava lakes, volcanic plumes, and sulfur-rich plains.',
  },
  {
    id: 'europa',
    name: 'Europa',
    radius: 1560.8,
    axis: 671034,
    period: 3.551181,
    eccentricity: 0.0094,
    inclination: 0.466,
    color: '#d4c6b3',
    temperature: '-160 C',
    description:
      'A fractured ice shell covers a global saltwater ocean. Tidal heating keeps liquid water beneath the surface, making Europa a key target in the search for habitable environments beyond Earth.',
  },
  {
    id: 'ganymede',
    name: 'Ganymede',
    radius: 2634.1,
    axis: 1070412,
    period: 7.154553,
    eccentricity: 0.0013,
    inclination: 0.177,
    color: '#a79d8d',
    temperature: '-163 C',
    description:
      'The largest moon in the Solar System is bigger than Mercury. Ancient dark terrain and brighter grooved regions cover an icy interior, and Ganymede generates its own magnetic field.',
  },
  {
    id: 'callisto',
    name: 'Callisto',
    radius: 2410.3,
    axis: 1882709,
    period: 16.689018,
    eccentricity: 0.0074,
    inclination: 0.192,
    color: '#928a7d',
    temperature: '-139 C',
    description:
      'A heavily cratered ice-and-rock world preserving billions of years of impacts. Callisto is the outermost Galilean moon and may contain a buried ocean beneath its ancient surface.',
  },
] as const

catalog.push(
  ...jovianMoons.map((moon): CelestialObject => ({
    id: moon.id,
    name: moon.name,
    kind: 'moon',
    scene: 'planet',
    jovianMoon: moon.id,
    classification: 'Galilean moon',
    subtitle: `A world in Jupiter's family.`,
    description: moon.description,
    location: 'Jupiter / Solar System',
    distance: `${moon.axis.toLocaleString('en-US')} km from Jupiter`,
    color: moon.color,
    parent: 'jupiter',
    radiusKm: moon.radius,
    rotationHours: moon.period * 24,
    facts: [
      {
        label: 'Mean radius',
        value: `${moon.radius.toLocaleString('en-US')} km`,
      },
      { label: 'Mean temperature', value: moon.temperature },
      { label: 'Rotation', value: 'Tidally locked' },
      { label: 'Host planet', value: 'Jupiter' },
    ],
    orbit: {
      parent: 'Jupiter',
      period: `${moon.period} days`,
      periodDays: moon.period,
      semiMajorAxis: moon.axis / 149597870.7,
      eccentricity: moon.eccentricity,
      inclination: moon.inclination,
      speed: `${((2 * Math.PI * moon.axis) / (moon.period * 86400)).toFixed(2)} km/s`,
      model: 'ephemeris',
      note: "Jovicentric positions from Astronomy Engine, added to Jupiter's heliocentric position in the unified map. The listed mean inclination is relative to Jupiter's equator. Surface appearance is illustrative.",
    },
    source: `https://science.nasa.gov/jupiter/moons/${moon.id}/`,
  })),
)

const deepSky: {
  id: string
  name: string
  kind: ObjectKind
  scene: SceneKind
  type: string
  ra: number
  dec: number
  distance: number
  radius: number
  color: string
  parent: string
  description: string
  source: string
}[] = [
  {
    id: 'pleiades',
    name: 'Pleiades',
    kind: 'star-cluster',
    scene: 'star-cluster',
    type: 'Open star cluster / M45',
    ra: 3.79,
    dec: 24.12,
    distance: 136,
    radius: 4,
    color: '#9acafa',
    parent: 'milky-way',
    description:
      "A young cluster of hot blue stars crossing a cloud of interstellar dust. The blue reflection nebulosity is illuminated dust, not material left over from the cluster's birth.",
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'omega-centauri',
    name: 'Omega Centauri',
    kind: 'star-cluster',
    scene: 'star-cluster',
    type: 'Globular star cluster / NGC 5139',
    ra: 13.446,
    dec: -47.48,
    distance: 5240,
    radius: 23,
    color: '#ffe1b0',
    parent: 'milky-way',
    description:
      'A massive, ancient stellar system containing millions of stars. Its multiple stellar populations suggest a complex history, possibly as the stripped core of a dwarf galaxy.',
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'hercules-cluster',
    name: 'Hercules Globular Cluster',
    kind: 'star-cluster',
    scene: 'star-cluster',
    type: 'Globular star cluster / M13',
    ra: 16.695,
    dec: 36.46,
    distance: 6800,
    radius: 22,
    color: '#e5d3b5',
    parent: 'milky-way',
    description:
      "Hundreds of thousands of old stars form a dense spherical cluster in the Milky Way's halo. Stellar orbits within the cluster differ from one another; there is no single common orbit.",
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-13-the-hercules-cluster/',
  },
  {
    id: 'eagle-nebula',
    name: 'Eagle Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Emission nebula / M16',
    ra: 18.313,
    dec: -13.79,
    distance: 1750,
    radius: 10.5,
    color: '#d5a28d',
    parent: 'milky-way',
    description:
      'Young stars illuminate this star-forming cloud, home to the Pillars of Creation. Dense columns of gas and dust are sculpted by ultraviolet radiation and stellar winds.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-16-the-eagle-nebula/',
  },
  {
    id: 'lagoon-nebula',
    name: 'Lagoon Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Emission nebula / M8',
    ra: 18.062,
    dec: -24.38,
    distance: 1250,
    radius: 16,
    color: '#e79aa5',
    parent: 'milky-way',
    description:
      'A luminous cloud of ionized gas, dark dust lanes, and young stars in Sagittarius. Its bright central regions are energized by massive stars forming within the nebula.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-8-the-lagoon-nebula/',
  },
  {
    id: 'trifid-nebula',
    name: 'Trifid Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Emission and reflection nebula / M20',
    ra: 18.042,
    dec: -23.03,
    distance: 1250,
    radius: 3.2,
    color: '#cda1dc',
    parent: 'milky-way',
    description:
      'Dark dust lanes divide a glowing red emission cloud, while nearby dust reflects blue starlight. The Trifid combines several distinct nebular processes in one star-forming region.',
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'horsehead-nebula',
    name: 'Horsehead Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Dark nebula / Barnard 33',
    ra: 5.683,
    dec: -2.46,
    distance: 422,
    radius: 1.05,
    color: '#b88c88',
    parent: 'milky-way',
    description:
      "A dense, cold cloud seen in silhouette against glowing gas in Orion. Radiation from nearby stars illuminates and erodes the cloud's edge.",
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'ring-nebula',
    name: 'Ring Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Planetary nebula / M57',
    ra: 18.893,
    dec: 33.03,
    distance: 790,
    radius: 0.4,
    color: '#88d6d0',
    parent: 'milky-way',
    description:
      'The expanding envelope of a dying Sun-like star forms a bright barrel-shaped shell. A hot central white dwarf ionizes the surrounding gas; the familiar ring is a projection of its three-dimensional structure.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-57-the-ring-nebula/',
  },
  {
    id: 'dumbbell-nebula',
    name: 'Dumbbell Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Planetary nebula / M27',
    ra: 19.993,
    dec: 22.72,
    distance: 410,
    radius: 0.55,
    color: '#91d9c5',
    parent: 'milky-way',
    description:
      'An expanding shell of gas shed by an evolved star. Its bright lobes trace ionized material surrounding a compact white dwarf.',
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'rosette-nebula',
    name: 'Rosette Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Emission nebula / NGC 2237',
    ra: 6.533,
    dec: 4.95,
    distance: 1600,
    radius: 20,
    color: '#e29aab',
    parent: 'milky-way',
    description:
      'A vast star-forming cloud surrounds the young cluster NGC 2244. Powerful winds from massive stars have opened a cavity through the center of the glowing gas.',
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'cassiopeia-a',
    name: 'Cassiopeia A',
    kind: 'supernova',
    scene: 'supernova',
    type: 'Core-collapse supernova remnant',
    ra: 23.391,
    dec: 58.8,
    distance: 3400,
    radius: 2.5,
    color: '#d5b68b',
    parent: 'milky-way',
    description:
      'A young supernova remnant with expanding knots of heavy elements, shock-heated gas, and a compact central neutron star. Its ejecta trace a stellar explosion whose light reached Earth roughly three centuries ago.',
    source: 'https://science.nasa.gov/universe/stars/',
  },
  {
    id: 'veil-nebula',
    name: 'Veil Nebula',
    kind: 'supernova',
    scene: 'supernova',
    type: 'Supernova remnant / Cygnus Loop',
    ra: 20.75,
    dec: 30.7,
    distance: 735,
    radius: 18,
    color: '#9fcfd3',
    parent: 'milky-way',
    description:
      'Delicate filaments mark the shock front of an ancient supernova. The expanding blast wave collides with surrounding interstellar gas, producing glowing arcs across the Cygnus Loop.',
    source: 'https://science.nasa.gov/universe/nebulae/',
  },
  {
    id: 'large-magellanic-cloud',
    name: 'Large Magellanic Cloud',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Barred irregular dwarf galaxy',
    ra: 5.392,
    dec: -69.76,
    distance: 49970,
    radius: 7000,
    color: '#b5c7e6',
    parent: 'local-group',
    description:
      'A nearby satellite galaxy of the Milky Way, rich in young stars and star-forming nebulae. Its asymmetric stellar bar and gas clouds have been shaped by gravitational interactions.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'small-magellanic-cloud',
    name: 'Small Magellanic Cloud',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Irregular dwarf galaxy',
    ra: 0.879,
    dec: -72.83,
    distance: 61700,
    radius: 3500,
    color: '#b0c8df',
    parent: 'local-group',
    description:
      'An irregular companion of the Milky Way and the Large Magellanic Cloud. Its structure and streams of gas reflect a long history of tidal interaction.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'tarantula-nebula',
    name: 'Tarantula Nebula',
    kind: 'nebula',
    scene: 'nebula',
    type: 'Giant star-forming region / 30 Doradus',
    ra: 5.645,
    dec: -69.1,
    distance: 49970,
    radius: 100,
    color: '#d4b6c6',
    parent: 'large-magellanic-cloud',
    description:
      'One of the most energetic stellar nurseries in the Local Group. Massive young stars in the Large Magellanic Cloud sculpt its complex cavities and luminous filaments.',
    source: 'https://science.nasa.gov/mission/webb/',
  },
  {
    id: 'bodes-galaxy',
    name: "Bode's Galaxy",
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Spiral galaxy / M81',
    ra: 9.926,
    dec: 69.065,
    distance: 3630000,
    radius: 13700,
    color: '#d5c7ae',
    parent: 'universe',
    description:
      'A grand spiral galaxy in Ursa Major with a bright central bulge and sweeping dust lanes. M81 interacts gravitationally with neighboring galaxies, including the starburst galaxy M82.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-81-bodes-galaxy/',
  },
  {
    id: 'cigar-galaxy',
    name: 'Cigar Galaxy',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Starburst galaxy / M82',
    ra: 9.931,
    dec: 69.68,
    distance: 3530000,
    radius: 5600,
    color: '#d8a1a4',
    parent: 'universe',
    description:
      'Intense star formation drives a galactic wind above and below this nearly edge-on galaxy. Its close interaction with M81 has helped trigger its active central starburst.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-82-the-cigar-galaxy/',
  },
  {
    id: 'sombrero-galaxy',
    name: 'Sombrero Galaxy',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Lenticular / spiral galaxy / M104',
    ra: 12.666,
    dec: -11.62,
    distance: 9550000,
    radius: 15000,
    color: '#eadac0',
    parent: 'universe',
    description:
      "A brilliant central bulge and broad dark dust ring create the Sombrero's distinctive silhouette. Its halo contains a large population of globular star clusters.",
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-104-the-sombrero-galaxy/',
  },
  {
    id: 'pinwheel-galaxy',
    name: 'Pinwheel Galaxy',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Face-on spiral galaxy / M101',
    ra: 14.054,
    dec: 54.349,
    distance: 6400000,
    radius: 26000,
    color: '#b7cfed',
    parent: 'universe',
    description:
      'A large face-on spiral with asymmetric arms and giant star-forming regions. Its extended disk offers a broad view of how gas, dust, and young stars trace spiral structure.',
    source:
      'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-101-the-pinwheel-galaxy/',
  },
  {
    id: 'centaurus-a',
    name: 'Centaurus A',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Peculiar active galaxy / NGC 5128',
    ra: 13.425,
    dec: -43.02,
    distance: 3800000,
    radius: 18500,
    color: '#dbc6a8',
    parent: 'universe',
    description:
      'A prominent dust lane crosses an elliptical stellar halo. Its active supermassive black hole powers jets and vast radio lobes, and the galaxy likely bears the imprint of a past merger.',
    source: 'https://science.nasa.gov/universe/galaxies/active-galaxies/',
  },
  {
    id: 'messier-87',
    name: 'Messier 87',
    kind: 'galaxy',
    scene: 'galaxy',
    type: 'Giant elliptical galaxy',
    ra: 12.514,
    dec: 12.391,
    distance: 16800000,
    radius: 18000,
    color: '#e6d4b9',
    parent: 'virgo',
    description:
      'A giant elliptical galaxy near the center of the Virgo Cluster. Its enormous population of stars and globular clusters surrounds M87*, the black hole first imaged by the Event Horizon Telescope.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'fornax-cluster',
    name: 'Fornax Cluster',
    kind: 'cluster',
    scene: 'cluster',
    type: 'Galaxy cluster',
    ra: 3.636,
    dec: -35.45,
    distance: 20000000,
    radius: 700000,
    color: '#cfdfeb',
    parent: 'universe',
    description:
      'A nearby galaxy cluster dominated by the elliptical galaxy NGC 1399. Its member galaxies move within a shared gravitational potential and a hot intracluster medium.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'coma-cluster',
    name: 'Coma Cluster',
    kind: 'cluster',
    scene: 'cluster',
    type: 'Rich galaxy cluster / Abell 1656',
    ra: 12.992,
    dec: 27.98,
    distance: 100000000,
    radius: 3000000,
    color: '#c4d4e5',
    parent: 'universe',
    description:
      'Thousands of galaxies inhabit this rich cluster. Their rapid motions and the gravity required to bind them provided early evidence for the presence of dark matter.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
  {
    id: 'perseus-cluster',
    name: 'Perseus Cluster',
    kind: 'cluster',
    scene: 'cluster',
    type: 'Galaxy cluster / Abell 426',
    ra: 3.33,
    dec: 41.51,
    distance: 73000000,
    radius: 2500000,
    color: '#c4d7e9',
    parent: 'universe',
    description:
      'A massive cluster filled with hot, X-ray-emitting gas. Activity from the central galaxy NGC 1275 inflates cavities in the gas and sends pressure waves through the intracluster medium.',
    source: 'https://science.nasa.gov/universe/galaxies/',
  },
]

catalog.push(
  ...deepSky.map((item): CelestialObject => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    scene: item.scene,
    classification: item.type,
    subtitle: item.type.split(' / ')[0],
    description: item.description,
    location: `${item.parent === 'universe' ? 'Extragalactic space' : item.parent.replaceAll('-', ' ')} / J2000 sky position`,
    distance: `~${(item.distance * 3.26156).toLocaleString('en-US', { maximumSignificantDigits: 3 })} light-years`,
    color: item.color,
    parent: item.parent,
    skyPosition: {
      rightAscensionHours: item.ra,
      declinationDegrees: item.dec,
      distancePc: item.distance,
      radiusPc: item.radius,
    },
    facts: [
      {
        label: 'Distance',
        value: `~${item.distance.toLocaleString('en-US')} pc`,
      },
      {
        label: 'Approximate span',
        value: `${(item.radius * 2 * 3.26156).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ly`,
      },
      { label: 'Right ascension', value: `${item.ra} h` },
      { label: 'Declination', value: `${item.dec} deg` },
    ],
    orbit: noOrbit(
      'The map uses an approximate reference distance and J2000 direction. Internal stars and gas have individual motions; no single precise orbit applies to this extended object. Shape and depth are illustrative.',
      item.parent === 'milky-way'
        ? 'Milky Way'
        : 'Local gravitational environment',
    ),
    source: item.source,
  })),
)
objectReference('m87-black-hole', 'messier-87')
objectReference('sn1987a', 'large-magellanic-cloud')

function objectReference(id: string, parent: string) {
  const object = catalog.find((item) => item.id === id)
  if (object) object.parent = parent
}

class CatalogRegistry extends Map<string, CelestialObject> {
  override get(id: string) {
    return super.get(id) ?? getExtendedObject(id)
  }
  override has(id: string) {
    return super.has(id) || hasExtendedObject(id)
  }
}
export const objectById = new CatalogRegistry(
  catalog.map((object) => [object.id, object]),
)
export const earth = objectById.get('earth')!
export const solarPlanets = catalog.filter(
  (object) => object.kind === 'planet' && object.body,
)

export function getAncestry(id: string): CelestialObject[] {
  const ancestors: CelestialObject[] = []
  const visited = new Set<string>()
  let current = objectById.get(id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    ancestors.unshift(current)
    current = current.parent ? objectById.get(current.parent) : undefined
  }
  return ancestors
}

export function searchCatalog(
  query: string,
  scope: 'all' | 'nearby' | 'deep' = 'all',
  limit = 24,
): CelestialObject[] {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/black\s*hole/g, 'black hole')
    .replace(/tsar/g, 'quasar')
  const curated = catalog.filter((object) => {
    const nearby =
      Boolean(object.body || object.jovianMoon) ||
      ['moon', 'solar-system'].includes(object.id)
    if (scope === 'nearby' && !nearby) return false
    if (scope === 'deep' && nearby) return false
    return `${object.name} ${object.classification} ${object.kind.replaceAll('-', ' ')} ${object.location}`
      .toLowerCase()
      .includes(normalized)
  })
  return [
    ...curated,
    ...searchExtendedCatalog(normalized, scope, limit).objects,
  ]
}
