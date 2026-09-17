import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse } from 'csv-parse/sync'

const require = createRequire(import.meta.url)
const { RotateVector, Rotation_EQJ_GAL, Vector } = require('astronomy-engine')
const output = new URL('../public/data/', import.meta.url)
const epoch = new Date('2000-01-01T12:00:00Z')
const rotation = Rotation_EQJ_GAL()
const retrievedAt = new Date().toISOString()
const number = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null
const round = (value) => Number(value.toFixed(5))

async function request(url, format = 'json') {
  console.log(`Fetching ${new URL(url).hostname}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return format === 'json' ? response.json() : response.text()
}

function galacticPosition(ra, dec, distance) {
  if (!(distance > 0 && distance < 100000)) return [null, null, null]
  const rightAscension = (ra * Math.PI) / 180
  const declination = (dec * Math.PI) / 180
  const vector = new Vector(
    distance * Math.cos(declination) * Math.cos(rightAscension),
    distance * Math.cos(declination) * Math.sin(rightAscension),
    distance * Math.sin(declination),
    epoch,
  )
  const result = RotateVector(rotation, vector)
  return [round(result.x), round(result.y), round(result.z)]
}

await mkdir(output, { recursive: true })

const planetUrl = new URL('https://exoplanetarchive.ipac.caltech.edu/TAP/sync')
planetUrl.searchParams.set(
  'query',
  'select pl_name,hostname,ra,dec,sy_dist,pl_orbper,pl_orbsmax,pl_orbeccen,pl_orbincl,pl_rade,pl_bmasse,pl_eqt,discoverymethod,disc_year from pscomppars order by pl_name',
)
planetUrl.searchParams.set('format', 'json')
const planetData = await request(planetUrl)
if (!Array.isArray(planetData) || planetData.length < 5000)
  throw new Error(
    'Unexpected exoplanet response; existing snapshot was not replaced.',
  )
const planets = planetData.map((planet) => [
  planet.pl_name,
  planet.hostname,
  ...galacticPosition(planet.ra, planet.dec, number(planet.sy_dist)),
  number(planet.sy_dist),
  number(planet.pl_orbper),
  number(planet.pl_orbsmax),
  number(planet.pl_orbeccen),
  number(planet.pl_orbincl),
  number(planet.pl_rade),
  number(planet.pl_bmasse),
  number(planet.pl_eqt),
  planet.discoverymethod,
  number(planet.disc_year),
])
await writeFile(
  new URL('exoplanets.json', output),
  JSON.stringify({ source: planetUrl.href, retrievedAt, rows: planets }),
)
console.log(`Confirmed exoplanets: ${planets.length}`)

const fields = [
  'spkid',
  'full_name',
  'diameter',
  'a',
  'e',
  'i',
  'om',
  'w',
  'ma',
  'epoch',
  'tp',
  'q',
  'per',
]
const minorBodies = []
const bodySources = []
for (const kind of ['c', 'a']) {
  const url = new URL('https://ssd-api.jpl.nasa.gov/sbdb_query.api')
  url.searchParams.set('fields', fields.join(','))
  url.searchParams.set('sb-kind', kind)
  url.searchParams.set('full-prec', 'true')
  if (kind === 'a') {
    url.searchParams.set('limit', '5000')
    url.searchParams.set('sort', '-diameter')
  }
  const data = await request(url)
  if (
    !Array.isArray(data.data) ||
    !Array.isArray(data.fields) ||
    data.data.length < 100
  )
    throw new Error(
      'Unexpected JPL response; existing minor-body snapshot was not replaced.',
    )
  const indices = fields.map((field) => data.fields.indexOf(field))
  if (indices.some((index) => index < 0))
    throw new Error('JPL response is missing required fields')
  for (const row of data.data) {
    const ordered = indices.map((index) => row[index])
    minorBodies.push([
      String(ordered[0]),
      String(ordered[1]).trim(),
      kind,
      ...ordered.slice(2).map(number),
    ])
  }
  bodySources.push({
    url: url.href,
    available: Number(data.count),
    imported: data.data.length,
  })
  console.log(
    `${kind === 'c' ? 'Comets' : 'Largest minor planets'}: ${data.data.length}`,
  )
}
for (const designation of ['134340', '136199', '136108', '136472']) {
  const url = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api')
  url.searchParams.set('sstr', designation)
  url.searchParams.set('phys-par', '1')
  url.searchParams.set('full-prec', 'true')
  const data = await request(url)
  if (!data.object?.spkid || !Array.isArray(data.orbit?.elements)) throw new Error(`Missing dwarf-planet orbit: ${designation}`)
  if (minorBodies.some((row) => row[0] === String(data.object.spkid))) continue
  const elements = Object.fromEntries(data.orbit.elements.map((element) => [element.name, number(element.value)]))
  const diameter = number(data.phys_par?.find((parameter) => parameter.name === 'diameter')?.value)
  minorBodies.push([String(data.object.spkid), data.object.fullname, 'a', diameter, elements.a, elements.e, elements.i, elements.om, elements.w, elements.ma, number(data.orbit.epoch), elements.tp, elements.q, elements.per])
  bodySources.push({ url: url.href, available: 1, imported: 1 })
  console.log(`Dwarf planet: ${data.object.fullname}`)
}
await writeFile(
  new URL('minor-bodies.json', output),
  JSON.stringify({ sources: bodySources, retrievedAt, rows: minorBodies }),
)

const starUrl =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv'
const starData = parse(await request(starUrl, 'text'), {
  columns: true,
  skip_empty_lines: true,
})
if (starData.length < 100000)
  throw new Error(
    'Unexpected HYG response; existing star snapshot was not replaced.',
  )
const stars = starData
  .filter((star) => star.id !== '0')
  .map((star) => {
    const distance = number(star.dist)
    const validDistance = distance > 0 && distance < 100000 ? distance : null
    const name =
      star.proper ||
      star.bf?.trim() ||
      star.gl ||
      (star.hip ? `HIP ${star.hip}` : `HYG ${star.id}`)
    const aliases = [
      star.hip && `HIP ${star.hip}`,
      star.hd && `HD ${star.hd}`,
      star.gl,
      star.bf,
      star.con,
    ]
      .filter(Boolean)
      .join(' ')
    return [
      String(star.id),
      name,
      aliases,
      ...galacticPosition(
        Number(star.ra) * 15,
        Number(star.dec),
        validDistance,
      ),
      number(star.mag),
      star.spect || '',
      validDistance,
    ]
  })
await writeFile(
  new URL('stars.json', output),
  JSON.stringify({
    source: starUrl,
    retrievedAt,
    license: 'CC BY-SA 4.0',
    attribution: 'HYG v4.1 by David Nash / Astronomy Nexus',
    rows: stars,
  }),
)
const metadata = {
  retrievedAt,
  exoplanets: planets.length,
  comets: minorBodies.filter((body) => body[2] === 'c').length,
  minorPlanets: minorBodies.filter((body) => body[2] === 'a').length,
  stars: stars.length,
  starsWithDistances: stars.filter((star) => star[8] !== null).length,
  scope:
    'All rows in the NASA PSCompPars and JPL comet responses; HYG v4.1 stars; 5,000 minor planets ranked by diameter plus explicit dwarf-planet records. Not a complete inventory of the Milky Way.',
}
await writeFile(
  new URL('metadata.json', output),
  JSON.stringify(metadata, null, 2),
)
console.log(JSON.stringify(metadata, null, 2))
