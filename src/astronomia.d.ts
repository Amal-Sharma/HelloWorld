declare module 'astronomia/kepler' {
  export function kepler3(eccentricity: number, meanAnomaly: number): number
  export function trueAnomaly(
    eccentricAnomaly: number,
    eccentricity: number,
  ): number
  export function radius(
    eccentricAnomaly: number,
    eccentricity: number,
    semiMajorAxis: number,
  ): number
}

declare module 'astronomia/nearparabolic' {
  export class Elements {
    constructor(
      perihelionTime: number,
      perihelionDistance: number,
      eccentricity: number,
    )
    anomalyDistance(julianDate: number): {
      ano?: number
      dist?: number
      err: Error | null
    }
  }
}
