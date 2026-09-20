export function expansionScale(ageGyr: number) {
  const age = Number.isFinite(ageGyr)
    ? Math.min(30, Math.max(1, ageGyr))
    : 13.8
  const hubblePerGyr = (67.4 / 3.085677581491367e19) * 31557600e9
  const rate = 1.5 * hubblePerGyr * Math.sqrt(0.685)
  return Math.pow(Math.sinh(rate * age) / Math.sinh(rate * 13.8), 2 / 3)
}
