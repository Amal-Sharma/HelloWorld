import type { CelestialObject, ObjectKind } from '../data/catalog'

export const observationBands = [
  { id: 'radio', label: 'Radio', wavelength: 0.21, color: '#dd8da8' },
  { id: 'infrared', label: 'Infrared', wavelength: 10e-6, color: '#ee9c58' },
  { id: 'visible', label: 'Visible', wavelength: 550e-9, color: '#ffffff' },
  {
    id: 'ultraviolet',
    label: 'Ultraviolet',
    wavelength: 150e-9,
    color: '#94a5ff',
  },
  { id: 'xray', label: 'X-ray', wavelength: 1e-9, color: '#70d5e7' },
  { id: 'gamma', label: 'Gamma ray', wavelength: 1e-12, color: '#e8da78' },
] as const

export type ObservationBand = (typeof observationBands)[number]['id']
export type EmissionComponent =
  'photosphere' | 'dust' | 'hot-gas' | 'nonthermal'
type SpectralObject = {
  kind: ObjectKind
  id?: string
  temperatureK?: number
  blackHole?: CelestialObject['blackHole']
}

export function isObservationBand(value: unknown): value is ObservationBand {
  return observationBands.some((band) => band.id === value)
}

export function thermalResponse(temperatureK: number, wavelengthM: number) {
  if (
    !Number.isFinite(temperatureK) ||
    temperatureK <= 0 ||
    !Number.isFinite(wavelengthM) ||
    wavelengthM <= 0
  )
    return 0
  const energy = 0.01438776877 / (wavelengthM * temperatureK)
  if (energy > 700) return 0
  const peak = 3.920690394
  const logarithm = 4 * Math.log(energy) - Math.log(Math.expm1(energy))
  const normalization = 4 * Math.log(peak) - Math.log(Math.expm1(peak))
  return Math.min(1, Math.exp(logarithm - normalization))
}

const representativeTemperature: Record<string, number> = {
  sun: 5772,
  proxima: 3042,
  sirius: 9940,
  betelgeuse: 3500,
  mercury: 440,
  venus: 737,
  earth: 288,
  moon: 250,
  mars: 210,
  jupiter: 165,
  saturn: 134,
  uranus: 76,
  neptune: 72,
}

export function spectralResponse(
  object: SpectralObject,
  band: ObservationBand,
  component?: EmissionComponent,
): number {
  if (object.kind === 'void') return 0
  if (band === 'visible') return 1
  const index = observationBands.findIndex((item) => item.id === band)
  const response = (weights: number[]) => weights[index]
  if (component === 'dust') return response([0.15, 1.3, 1, 0.02, 0, 0])
  if (component === 'hot-gas') return response([0.1, 0.04, 1, 0.55, 1.3, 0])
  if (component === 'nonthermal')
    return response([1.1, 0.1, 1, 0.3, 0.85, 1.2])
  if (component === 'photosphere') {
    const temperature =
      object.temperatureK ??
      representativeTemperature[object.id ?? ''] ??
      5800
    const thermal = thermalResponse(
      temperature,
      observationBands[index].wavelength,
    )
    return thermal < 1e-6 ? 0 : Math.min(1.3, Math.sqrt(thermal) * 1.6)
  }
  if (object.kind === 'neutron-star')
    return response([0.8, 0.015, 1, 0.6, 1.2, 1.1])
  if (object.kind === 'supernova')
    return response([0.8, 0.65, 1, 0.3, 1.2, 0.65])
  if (object.kind === 'black-hole' || object.kind === 'quasar') {
    if (object.blackHole?.accreting === false) return 0
    return response([
      0.5,
      0.55,
      1,
      1.1,
      1.2,
      object.kind === 'quasar' || object.blackHole?.jets ? 0.8 : 0,
    ])
  }
  if (object.kind === 'nebula') return response([0.22, 1.2, 1, 0.25, 0, 0])
  if (object.kind === 'galaxy' || object.kind === 'universe')
    return response([0.35, 1.1, 1, 0.55, 0.15, 0.06])
  if (object.kind === 'cluster') return response([0.1, 0.4, 1, 0.1, 1.1, 0])
  const temperature =
    object.temperatureK ??
    representativeTemperature[object.id ?? ''] ??
    (object.kind === 'white-dwarf'
      ? 15000
      : object.kind === 'star' || object.kind === 'star-cluster'
        ? 5800
        : 250)
  const thermal = thermalResponse(
    temperature,
    observationBands[index].wavelength,
  )
  return thermal < 1e-6 ? 0 : Math.min(1.3, Math.sqrt(thermal) * 1.6)
}

export function spectralSummary(
  object: CelestialObject,
  band: ObservationBand,
) {
  if (band === 'visible') return 'Illustrative visible light'
  if (object.kind === 'void') return 'No intrinsic emission'
  return spectralResponse(object, band) === 0
    ? 'No emission modeled in this band'
    : 'Illustrative emission / relative exposure'
}
