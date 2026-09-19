import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

const endpoint = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const modelUrl =
  'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/v/Voyager.glb'
const missions = [
  {
    id: 'voyager-1',
    target: '-31',
    start: '1977-09-06',
    encounters: ['1979-03-05', '1980-11-12'],
  },
  {
    id: 'voyager-2',
    target: '-32',
    start: '1977-08-21',
    encounters: ['1979-07-09', '1981-08-26', '1986-01-24', '1989-08-25'],
  },
  {
    id: 'new-horizons',
    target: '-98',
    start: '2006-01-20',
    encounters: ['2007-02-28', '2015-07-14', '2019-01-01'],
  },
]
const trajectories = {}

for (const mission of missions) {
  const ranges = [
    {
      start: mission.start,
      stop: '2030-01-01',
      steps: String(
        Math.ceil(
          (Date.parse('2030-01-01') - Date.parse(mission.start)) / 86400000 / 4,
        ),
      ),
    },
    ...mission.encounters.map((encounter) => ({
      start: new Date(Date.parse(encounter) - 2 * 86400000)
        .toISOString()
        .slice(0, 10),
      stop: new Date(Date.parse(encounter) + 2 * 86400000)
        .toISOString()
        .slice(0, 10),
      steps: '96',
    })),
  ]
  const collected = new Map()
  const queries = []
  for (const range of ranges) {
    const url = new URL(endpoint)
    url.searchParams.set('format', 'json')
    const parameters = {
      COMMAND: mission.target,
      CENTER: '500@10',
      EPHEM_TYPE: 'VECTORS',
      START_TIME: range.start,
      STOP_TIME: range.stop,
      STEP_SIZE: range.steps,
      REF_SYSTEM: 'ICRF',
      REF_PLANE: 'ECLIPTIC',
      TIME_TYPE: 'UT',
      OUT_UNITS: 'AU-D',
      VEC_TABLE: '1',
      VEC_CORR: 'NONE',
      CSV_FORMAT: 'YES',
      OBJ_DATA: 'YES',
    }
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, `'${value}'`)
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    assert(response.ok, `Horizons HTTP ${response.status}`)
    const payload = await response.json()
    assert.equal(payload.signature?.version, '1.2')
    assert(!payload.error, payload.error)
    const table = payload.result?.split('$$SOE')[1]?.split('$$EOE')[0]
    assert(table, `Missing Horizons vectors for ${mission.id}`)
    const samples = parse(table.trim(), {
      trim: true,
      skip_empty_lines: true,
    }).map((row) => [
      Math.round((Number(row[0]) - 2440587.5) * 86_400_000),
      Number(Number(row[2]).toFixed(11)),
      Number(Number(row[3]).toFixed(11)),
      Number(Number(row[4]).toFixed(11)),
    ])
    assert.equal(samples.length, Number(range.steps) + 1)
    assert(samples.every((row) => row.every(Number.isFinite)))
    assert.equal(samples[0][0], Date.parse(range.start))
    assert.equal(samples.at(-1)[0], Date.parse(range.stop))
    assert(
      samples.every((row, index) => !index || row[0] > samples[index - 1][0]),
    )
    for (const sample of samples) collected.set(sample[0], sample)
    queries.push(url.href)
  }
  const samples = [...collected.values()].sort(
    (first, second) => first[0] - second[0],
  )
  trajectories[mission.id] = {
    target: mission.target,
    queries,
    samples,
  }
  console.log(`${mission.id}: ${samples.length} heliocentric ecliptic vectors`)
}

const response = await fetch(modelUrl, { signal: AbortSignal.timeout(60_000) })
assert(response.ok, `Voyager model HTTP ${response.status}`)
const model = Buffer.from(await response.arrayBuffer())
assert.equal(model.toString('ascii', 0, 4), 'glTF')
assert.equal(model.readUInt32LE(4), 2)
assert.equal(model.readUInt32LE(8), model.length)
const manifest = JSON.parse(
  model.toString('utf8', 20, 20 + model.readUInt32LE(12)),
)
assert((manifest.buffers ?? []).every((buffer) => !buffer.uri))
assert((manifest.images ?? []).every((image) => !image.uri))
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true })
await writeFile(new URL('../public/models/voyager.glb', import.meta.url), model)
const newHorizons = await fetch(
  'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/n/New_Horizons.glb',
  { signal: AbortSignal.timeout(60000) },
)
assert(newHorizons.ok)
const newHorizonsModel = Buffer.from(await newHorizons.arrayBuffer())
assert.equal(newHorizonsModel.toString('ascii', 0, 4), 'glTF')
await writeFile(
  new URL('../public/models/new-horizons.glb', import.meta.url),
  newHorizonsModel,
)
await mkdir(new URL('../src/data/trajectories/', import.meta.url), {
  recursive: true,
})
for (const [id, trajectory] of Object.entries(trajectories))
  await writeFile(
    new URL(`../src/data/trajectories/${id}.json`, import.meta.url),
    `${JSON.stringify({
      source: 'NASA/JPL Horizons',
      retrieved: new Date().toISOString(),
      frame: 'Heliocentric geometric ICRF / J2000 ecliptic',
      units: 'UTC Unix milliseconds; x, y, z in AU',
      interpolation:
        'Linear between at most four-day samples, with hourly samples within two days of major flybys; no extrapolation',
      ...trajectory,
    })}\n`,
  )
console.log(
  `NASA VTAD Voyager model: ${(model.length / 1024 ** 2).toFixed(2)} MiB, self-contained GLB`,
)
