import { Color } from 'three'
import type { Material, Object3D, Mesh } from 'three'
import type { CelestialObject } from '../data/catalog'
import { observationBands, spectralResponse } from '../lib/spectrum'
import type { EmissionComponent, ObservationBand } from '../lib/spectrum'

interface MaterialState {
  object: CelestialObject
  component?: EmissionComponent
  blend: { value: number }
  gain: { value: number }
  color: { value: Color }
}

export class SpectralAppearance {
  private band: ObservationBand = 'visible'
  private radioExposure = 3
  private materials = new WeakMap<Material, MaterialState>()

  bind(root: Object3D, object: CelestialObject) {
    if (
      object.visualization === 'dark-matter' ||
      object.visualization === 'dark-energy'
    )
      return
    root.traverse((node) => {
      if (
        node.type === 'Line' ||
        node.type === 'LineSegments' ||
        node.userData.spectralAnnotation
      )
        return
      const target = (node as Mesh).material
      if (!target) return
      let component: EmissionComponent | undefined
      let ancestor: Object3D | null = node
      while (ancestor) {
        if (ancestor.userData.emissionComponent) {
          component = ancestor.userData.emissionComponent
          break
        }
        if (ancestor === root) break
        ancestor = ancestor.parent
      }
      for (const material of Array.isArray(target) ? target : [target]) {
        if (this.materials.has(material)) continue
        const state: MaterialState = {
          object,
          component,
          blend: { value: 0 },
          gain: { value: 1 },
          color: { value: new Color() },
        }
        const previousCompile = material.onBeforeCompile
        const previousKey = material.customProgramCacheKey()
        material.onBeforeCompile = (shader, renderer) => {
          previousCompile.call(material, shader, renderer)
          shader.uniforms.uObservationBlend = state.blend
          shader.uniforms.uObservationGain = state.gain
          shader.uniforms.uObservationColor = state.color
          shader.fragmentShader =
            `uniform float uObservationBlend, uObservationGain;
            uniform vec3 uObservationColor;\n${shader.fragmentShader}`.replace(
              '#include <tonemapping_fragment>',
              `if (uObservationBlend > 0.5) {
              if (uObservationGain < 0.000001) discard;
              float signal = max(0.0, dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
              gl_FragColor.rgb = mix(uObservationColor, vec3(0.94), smoothstep(0.5, 2.0, signal)) * signal * uObservationGain;
              gl_FragColor.a *= min(1.0, uObservationGain * 3.0);
            }
            #include <tonemapping_fragment>`,
            )
        }
        material.customProgramCacheKey = () => `${previousKey}|observation-v1`
        this.materials.set(material, state)
        this.updateState(state)
        material.needsUpdate = true
      }
    })
  }

  setBand(band: ObservationBand, root: Object3D, radioExposure = 3) {
    this.band = band
    this.radioExposure = Number.isFinite(radioExposure)
      ? Math.max(1, Math.min(8, radioExposure)) : 3
    root.traverse((node) => {
      const target = (node as Mesh).material
      if (!target) return
      for (const material of Array.isArray(target) ? target : [target]) {
        const state = this.materials.get(material)
        if (state) this.updateState(state)
      }
    })
  }

  private updateState(state: MaterialState) {
    state.blend.value = this.band === 'visible' ? 0 : 1
    state.gain.value = spectralResponse(
      state.object,
      this.band,
      state.component,
    ) * (this.band === 'radio' ? this.radioExposure : 1)
    state.color.value.set(
      observationBands.find((item) => item.id === this.band)!.color,
    )
  }
}
