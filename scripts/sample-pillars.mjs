import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  Mesh,
  Vector3,
} from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'

const source = 'https://science.nasa.gov/3d-resources/pillars-of-creation/'
const asset =
  'https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/printable/pillars-of-creation/Pillars%20of%20Creation%20(full).stl'
const response = await fetch(asset, { signal: AbortSignal.timeout(90_000) })
assert(response.ok, `Pillars geometry HTTP ${response.status}`)
const original = new STLLoader().parse(await response.arrayBuffer())
assert(original.attributes.position.count > 3000)
original.rotateX(-Math.PI / 2)
original.computeBoundingBox()
const printingBaseHeight =
  original.boundingBox.min.y +
  original.boundingBox.getSize(new Vector3()).y * 0.26
const vertices = original.attributes.position
const pillarVertices = []
for (let index = 0; index < vertices.count; index += 3) {
  if (
    [index, index + 1, index + 2].some(
      (vertex) => vertices.getY(vertex) <= printingBaseHeight,
    )
  )
    continue
  for (const vertex of [index, index + 1, index + 2])
    pillarVertices.push(
      vertices.getX(vertex),
      vertices.getY(vertex),
      vertices.getZ(vertex),
    )
}
assert(pillarVertices.length > 9000)
const geometry = new BufferGeometry()
geometry.setAttribute('position', new Float32BufferAttribute(pillarVertices, 3))
geometry.computeVertexNormals()
original.dispose()
geometry.center()
geometry.computeBoundingBox()
const dimensions = geometry.boundingBox.getSize(new Vector3())
geometry.scale(
  ...Array(3).fill(7.6 / Math.max(dimensions.x, dimensions.y, dimensions.z)),
)
const sampler = new MeshSurfaceSampler(new Mesh(geometry))
  .setRandomGenerator(() => MathUtils.seededRandom())
  .build()
MathUtils.seededRandom(10748)
const position = new Vector3()
const normal = new Vector3()
const positions = []
const illumination = []
const light = new Vector3(-0.5, 0.85, 0.45).normalize()
for (let index = 0; index < 48000; index++) {
  sampler.sample(position, normal)
  positions.push(
    ...position.toArray().map((value) => Math.round(value * 10000) / 10000),
  )
  illumination.push(Math.round((normal.dot(light) * 0.5 + 0.5) * 255))
}
assert.equal(positions.length, illumination.length * 3)
assert(positions.every(Number.isFinite))
const output = JSON.stringify({
  source,
  asset,
  credit:
    'Leah Hustak and Ralf Crawford / Space Telescope Science Institute; NASA 3D Resources',
  description:
    'Area-weighted samples from the NASA-hosted STL reconstruction. Lower 26% printing pedestal and basal support region removed, rotated from Z-up to Y-up, centered and uniformly scaled. Particle emission and color are illustrative, not measured gas density.',
  positions,
  illumination,
})
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../public/models/pillars-particles.json', import.meta.url),
  `${output}\n`,
)
geometry.dispose()
console.log(
  `Pillars: 48,000 samples; ${(Buffer.byteLength(output) / 1024 ** 2).toFixed(2)} MiB; original dimensions ${dimensions
    .toArray()
    .map((value) => value.toFixed(2))
    .join(' x ')}`,
)
