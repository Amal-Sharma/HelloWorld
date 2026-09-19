import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import sharp from 'sharp'

const moons = [
  {
    id: 'titan',
    target: '606',
    model:
      'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/t/Titan_1_5150.glb',
  },
  {
    id: 'enceladus',
    target: '602',
    model:
      'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/e/Enceladus_1_504.glb',
  },
]
const output = {}
await mkdir(new URL('../public/textures/', import.meta.url), {
  recursive: true,
})
for (const moon of moons) {
  const query = new URL('https://ssd.jpl.nasa.gov/api/horizons.api')
  query.searchParams.set('format', 'json')
  for (const [key, value] of Object.entries({
    COMMAND: moon.target,
    CENTER: '500@699',
    EPHEM_TYPE: 'ELEMENTS',
    START_TIME: '2026-09-16',
    STOP_TIME: '2026-09-17',
    STEP_SIZE: '1d',
    OUT_UNITS: 'AU-D',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    CSV_FORMAT: 'YES',
  }))
    query.searchParams.set(key, `'${value}'`)
  const response = await fetch(query, { signal: AbortSignal.timeout(60000) })
  assert(response.ok)
  const payload = await response.json()
  assert(!payload.error, payload.error)
  const text = payload.result.split('$$SOE')[1]?.split('$$EOE')[0]
  assert(text)
  const row = parse(text.trim(), { trim: true, skip_empty_lines: true })[0]
  const elements = {
    semiMajorAxis: Number(row[11]),
    eccentricity: Number(row[2]),
    inclination: Number(row[4]),
    ascendingNode: Number(row[5]),
    perihelionArgument: Number(row[6]),
    epoch: Number(row[0]),
    meanAnomaly: Number(row[9]),
    perihelionTime: Number(row[7]),
    perihelionDistance: Number(row[3]),
    meanMotionDegreesPerDay: Number(row[8]),
  }
  assert(Object.values(elements).every(Number.isFinite))
  assert(
    elements.semiMajorAxis > 0 &&
      elements.eccentricity >= 0 &&
      elements.eccentricity < 1,
  )
  const assetResponse = await fetch(moon.model, {
    signal: AbortSignal.timeout(90000),
  })
  assert(assetResponse.ok)
  const model = Buffer.from(await assetResponse.arrayBuffer())
  assert.equal(model.toString('ascii', 0, 4), 'glTF')
  const manifest = JSON.parse(
    model.toString('utf8', 20, 20 + model.readUInt32LE(12)),
  )
  const textureIndex = manifest.materials.find(
    (material) => material.pbrMetallicRoughness?.baseColorTexture,
  )?.pbrMetallicRoughness.baseColorTexture.index
  assert(Number.isInteger(textureIndex))
  const image = manifest.images[manifest.textures[textureIndex].source]
  assert(image.mimeType === 'image/png' || image.mimeType === 'image/jpeg')
  const view = manifest.bufferViews[image.bufferView]
  const binaryOffset = 20 + model.readUInt32LE(12) + 8
  const sourceTexture = model.subarray(
    binaryOffset + (view.byteOffset ?? 0),
    binaryOffset + (view.byteOffset ?? 0) + view.byteLength,
  )
  const pipeline = sharp(sourceTexture).resize({
    width: 2048,
    height: 1024,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const texture = await (
    image.mimeType === 'image/png'
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.jpeg({ quality: 90 })
  ).toBuffer()
  const filename = `${moon.id}-nasa.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`
  await writeFile(
    new URL(`../public/textures/${filename}`, import.meta.url),
    texture,
  )
  output[moon.id] = {
    elements,
    periodDays: Number(row[13]),
    texture: `/textures/${filename}`,
    query: query.href,
    model: moon.model,
    source: `https://science.nasa.gov/resource/${moon.id}-3d-model/`,
    credit:
      'NASA VTAD; base-color map extracted from the published GLB and resized to at most 2048 x 1024',
  }
  console.log(
    `${moon.id}: ${(elements.semiMajorAxis * 149597870.7).toFixed(0)} km orbital radius, ${output[moon.id].periodDays.toFixed(4)} days; ${(texture.length / 1024 ** 2).toFixed(2)} MiB texture`,
  )
}
await writeFile(
  new URL('../src/data/saturn-moons.json', import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`,
)
