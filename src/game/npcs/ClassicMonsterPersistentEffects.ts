import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import type { ClassicSkinnedInstanceLease } from "./ClassicSkinnedAssetLibrary";
import type { MonsterCatalog, MonsterTemplate } from "./MonsterCatalog";

const MAX_INSTANCES_PER_TEXTURE = 512;
const CLASSIC_BILLBOARD_CYCLE_SECONDS = 0.08;

interface TempPoint {
  readonly bone: number;
  readonly offset?: readonly [number, number, number];
}

interface PersistentBillboard {
  readonly point: number;
  readonly texture: number;
  readonly cycleCount: number;
  readonly color: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

interface EmittedBillboard {
  readonly texture: number;
  readonly position: THREE.Vector3;
  readonly startScaleX: number;
  readonly startScaleY: number;
  readonly scaleVelocity: number;
  readonly verticalDistance: number;
  readonly lifeSeconds: number;
  readonly color: number;
  readonly bright?: boolean;
  ageSeconds: number;
}

/**
 * Exact CFrame::UpdateFrames points used by TMHuman::RenderEffect for the
 * creature skeletons present in this corpus. Array indices are m_vecTempPos.
 */
const TEMP_POINTS: Readonly<Record<number, Readonly<Record<number, TempPoint>>>> = {
  0: {
    0: { bone: 8, offset: [0.4, 0.2, 0] },
    1: { bone: 7 },
    2: { bone: 29 },
    3: { bone: 34 },
    6: { bone: 19 },
    7: { bone: 25 },
    8: { bone: 8, offset: [0.16, 0.079, 0.035] },
    9: { bone: 8, offset: [0.16, 0.079, -0.035] },
    10: { bone: 8, offset: [0.07, 0.1, 0] },
  },
  1: {
    0: { bone: 8, offset: [0.4, 0.2, 0] },
    1: { bone: 7 },
    2: { bone: 29 },
    3: { bone: 34 },
    6: { bone: 18 },
    7: { bone: 24 },
    8: { bone: 8, offset: [0.16, 0.079, 0.035] },
    9: { bone: 8, offset: [0.16, 0.079, -0.035] },
    10: { bone: 8, offset: [0.07, 0.1, 0] },
  },
  2: {
    0: { bone: 8, offset: [0, 0.2, 0] },
    1: { bone: 27 },
    2: { bone: 32 },
    6: { bone: 15 },
    7: { bone: 21 },
  },
  4: {
    0: { bone: 8, offset: [-0.5, 0, 0] },
    1: { bone: 25 },
    2: { bone: 31 },
    6: { bone: 12 },
    7: { bone: 18 },
  },
  6: {
    0: { bone: 18, offset: [0, 0.5, 0.5] },
  },
  7: {
    0: { bone: 6 },
    1: { bone: 7 },
    2: { bone: 12 },
    3: { bone: 18 },
    4: { bone: 23 },
    5: { bone: 28 },
  },
  8: {
    0: { bone: 33 },
    1: { bone: 34 },
    2: { bone: 35 },
    3: { bone: 40 },
    4: { bone: 41 },
    5: { bone: 42 },
    6: { bone: 5 },
  },
  20: {
    0: { bone: 8 },
    1: { bone: 9 },
    2: { bone: 13 },
    3: { bone: 16 },
    4: { bone: 11 },
    5: { bone: 18 },
    6: { bone: 24 },
    7: { bone: 31 },
    8: { bone: 7, offset: [0.05, 0.37, 0.1] },
    9: { bone: 7, offset: [0.05, 0.37, -0.1] },
  },
  25: {
    0: { bone: 6 },
  },
  26: {
    0: { bone: 14, offset: [0.25, 0.15, 0] },
    1: { bone: 22, offset: [0.25, 0.15, 0] },
  },
  28: {
    0: { bone: 10 },
  },
  29: {
    0: { bone: 8 },
  },
};

/** One global instanced pass per active effect texture, independent of mob count. */
export class ClassicMonsterPersistentEffects {
  readonly object = new THREE.Group();
  readonly #batches = new Map<string, BillboardBatch>();
  readonly #world = new THREE.Vector3();
  readonly #local = new THREE.Vector3();
  readonly #offset = new THREE.Vector3();
  readonly #inverseRoot = new THREE.Matrix4();
  readonly #particles: EmittedBillboard[] = [];
  #enabled = true;
  #timeSeconds = 0;

  constructor(
    private readonly assets: ClassicAssetSource,
    private readonly catalog: MonsterCatalog,
  ) {
    this.object.name = "classic-monster-persistent-effects";
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.object.visible = enabled;
  }

  beginFrame(timeSeconds: number, deltaSeconds: number): void {
    this.#timeSeconds = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    for (const batch of this.#batches.values()) batch.beginFrame();
    const parent = this.object.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.#inverseRoot.copy(parent.matrixWorld).invert();
    } else {
      this.#inverseRoot.identity();
    }
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    for (let index = this.#particles.length - 1; index >= 0; index--) {
      const particle = this.#particles[index]!;
      particle.ageSeconds += delta;
      if (particle.ageSeconds >= particle.lifeSeconds) {
        this.#particles.splice(index, 1);
        continue;
      }
      this.writeParticle(particle);
    }
  }

  addActor(
    template: MonsterTemplate,
    body: ClassicSkinnedInstanceLease,
    scale: number,
    animationPhaseSeconds: number,
  ): void {
    if (!this.#enabled || !template.visual) return;
    const definitions = persistentBillboards(template, this.catalog, scale);
    const points = TEMP_POINTS[template.visual.skin];
    if (!definitions.length || !points) return;
    for (const definition of definitions) {
      const point = points[definition.point];
      if (!point || !this.resolvePoint(body, point, this.#local)) continue;
      const frame = definition.cycleCount > 1
        ? Math.floor(
          (this.#timeSeconds + animationPhaseSeconds) / CLASSIC_BILLBOARD_CYCLE_SECONDS,
        ) % definition.cycleCount
        : 0;
      this.batch(definition.texture + frame, true).write(
        this.#local,
        definition.scaleX,
        definition.scaleY,
        definition.color,
      );
    }
  }

  emitActor(
    template: MonsterTemplate,
    body: ClassicSkinnedInstanceLease,
    scale: number,
    randomState: number,
  ): number {
    if (!this.#enabled || !template.visual) return randomState;
    const visual = template.visual;
    const characterClass = visual.itemClass;
    const face = visual.parts.find((part) => part[0] === 1);
    const coat = visual.parts.find((part) => part[0] === 3);
    const faceMesh = face?.[2] ?? 0;
    const faceSkin = face?.[3] ?? 0;
    const coatMesh = coat?.[2] ?? 0;
    const hasMantua = (template.equipment?.[15 * 7] ?? 0) > 0;
    let state = randomState;
    const spawn = (
      point: number,
      options: Omit<EmittedBillboard, "position" | "ageSeconds">,
      jitter = 0.25,
    ): void => {
      state = randomStep(state);
      const jitterX = ((state & 0xff) % 10 - 5) * jitter;
      state = randomStep(state);
      const jitterZ = ((state & 0xff) % 10 - 5) * jitter;
      this.emitAtPoint(body, visual.skin, point, options, jitterX, jitterZ);
    };

    if (characterClass === 16 && faceMesh === 6) {
      for (let point = 1; point < 8; point++) {
        spawn(point, {
          texture: 0,
          startScaleX: 1.5 * scale,
          startScaleY: 1.5 * scale,
          scaleVelocity: 1,
          verticalDistance: 0,
          lifeSeconds: 2.5,
          color: 0x00aa66,
        }, 0.05);
      }
    } else if (characterClass === 16 && faceMesh === 0 && faceSkin === 1) {
      spawn(0, {
        texture: 0,
        startScaleX: 0.1 * scale,
        startScaleY: 0.1 * scale,
        scaleVelocity: 1,
        verticalDistance: 0,
        lifeSeconds: 2.5,
        color: 0xaaaaaa,
      }, 0.05);
    } else if (characterClass === 30 && (faceMesh === 0 || faceMesh === 1 || faceMesh === 2)) {
      spawn(0, {
        texture: 0,
        startScaleX: 0.005 * scale,
        startScaleY: 0.005 * scale,
        scaleVelocity: 1,
        verticalDistance: 0,
        lifeSeconds: 2.5,
        color: 0xaaaaaa,
      }, 0.05);
    } else if (
      (characterClass === 30 && faceMesh === 4)
      || (characterClass === 38 && coatMesh === 14 && !hasMantua)
    ) {
      const base = characterClass === 38 ? 2 : 1;
      for (let index = 0; index < 2; index++) {
        spawn(index + base, {
          texture: 0,
          startScaleX: 0.1,
          startScaleY: 0.1,
          scaleVelocity: 1,
          verticalDistance: 0,
          lifeSeconds: 1.5 + index * 0.4,
          color: 0xff6666,
        }, 0.05);
      }
    } else if (characterClass === 22 || characterClass === 27) {
      state = randomStep(state);
      const variant = state % 5;
      spawn(0, {
        texture: 0,
        startScaleX: variant * 0.01 + 0.01,
        startScaleY: variant * 0.03 + 0.01,
        scaleVelocity: 0.1,
        verticalDistance: -1,
        lifeSeconds: 1.5,
        color: characterClass === 27 ? 0xffdd88 : 0xffffcc,
      }, 0.02);
    } else if (characterClass === 28 && faceMesh === 2) {
      for (let index = 0; index < 6; index++) {
        state = randomStep(state);
        const variant = state % 5;
        const options = {
          texture: 0,
          startScaleX: variant * 0.1 + 0.2 * scale,
          startScaleY: variant * 0.1 + 0.2 * scale,
          scaleVelocity: 1,
          verticalDistance: -1,
          lifeSeconds: 1.5 + index * 0.4,
          color: 0x00ff00,
          bright: false,
        } as const;
        if (index % 2) {
          spawn(0, options, 0);
        } else {
          this.emitAtObject(body, options, 1);
        }
      }
    } else if (
      characterClass === 25
      && ((faceMesh === 3 && faceSkin === 8) || faceMesh === 12)
    ) {
      for (let index = 0; index < 2; index++) {
        state = randomStep(state);
        const variant = state % 3;
        const travel = index * 0.3 * variant;
        body.model.object.updateWorldMatrix(true, false);
        body.model.object.getWorldPosition(this.#world);
        this.#local.copy(this.#world).applyMatrix4(this.#inverseRoot);
        this.#local.x += travel;
        this.#local.y += 1.6 * scale - travel;
        this.#local.z += travel;
        this.pushParticle({
          texture: 89,
          position: this.#local.clone(),
          startScaleX: variant * 0.1 + 1.2 * scale,
          startScaleY: scale + 0.3,
          scaleVelocity: 0.5,
          verticalDistance: -2,
          lifeSeconds: 2.4 + index * 0.6,
          color: 0xffffff,
          bright: false,
          ageSeconds: 0,
        });
      }
    } else if (characterClass === 32 && faceMesh === 1 && faceSkin === 0) {
      for (let point = 0; point < 6; point++) {
        spawn(point, {
          texture: 119,
          startScaleX: scale + 0.1,
          startScaleY: scale + 0.3,
          scaleVelocity: 0.1,
          verticalDistance: 0,
          lifeSeconds: 3,
          color: 0xffffff,
          bright: false,
        }, 0);
      }
    } else if (characterClass === 21 && faceMesh === 4) {
      for (let repeat = 0; repeat < 2; repeat++) {
        for (let point = 1; point <= 2; point++) {
          spawn(point, {
            texture: 0,
            startScaleX: 0.1,
            startScaleY: 0.1,
            scaleVelocity: 1,
            verticalDistance: 0,
            lifeSeconds: 1.5 + repeat * 0.4,
            color: 0xffaa66,
          }, 0.05);
        }
      }
    } else if (characterClass === 25 && faceMesh === 3 && scale > 1.1751) {
      for (let index = 0; index < 2; index++) {
        spawn(index + 1, {
          texture: 0,
          startScaleX: 0.1,
          startScaleY: 0.1,
          scaleVelocity: 1,
          verticalDistance: 0,
          lifeSeconds: 1.5 + index * 0.4,
          color: 0xff6666,
        }, 0.05);
      }
    } else if (characterClass === 16 && faceMesh === 7) {
      // This branch uses owner position/height rather than m_vecTempPos.
      body.model.object.updateWorldMatrix(true, false);
      body.model.object.getWorldPosition(this.#world);
      this.#local.copy(this.#world).applyMatrix4(this.#inverseRoot);
      this.#local.y += 0.2;
      state = randomStep(state);
      this.#local.x += ((state & 0xff) % 10 - 5) * 0.05;
      state = randomStep(state);
      this.#local.z += ((state & 0xff) % 10 - 5) * 0.05;
      this.pushParticle({
        texture: 0,
        position: this.#local.clone(),
        startScaleX: 0.1,
        startScaleY: 0.1,
        scaleVelocity: 1,
        verticalDistance: 0,
        lifeSeconds: 1.5,
        color: 0xff8800,
        ageSeconds: 0,
      });
    }
    return state;
  }

  endFrame(): void {
    for (const batch of this.#batches.values()) batch.endFrame();
  }

  dispose(): void {
    for (const batch of this.#batches.values()) batch.dispose();
    this.#batches.clear();
    this.#particles.length = 0;
    this.object.removeFromParent();
    this.object.clear();
  }

  private batch(textureIndex: number, bright: boolean): BillboardBatch {
    const key = `${textureIndex}:${bright ? "bright" : "default"}`;
    const cached = this.#batches.get(key);
    if (cached) return cached;
    const created = new BillboardBatch(this.assets, textureIndex, bright);
    this.#batches.set(key, created);
    this.object.add(created.object);
    return created;
  }

  private resolvePoint(
    body: ClassicSkinnedInstanceLease,
    point: TempPoint,
    target: THREE.Vector3,
  ): boolean {
    const bone = body.model.bones[point.bone];
    if (!bone) return false;
    bone.updateWorldMatrix(true, false);
    this.#offset.fromArray(point.offset ?? [0, 0, 0]);
    this.#world.copy(this.#offset);
    bone.localToWorld(this.#world);
    target.copy(this.#world).applyMatrix4(this.#inverseRoot);
    return true;
  }

  private emitAtPoint(
    body: ClassicSkinnedInstanceLease,
    skin: number,
    pointIndex: number,
    options: Omit<EmittedBillboard, "position" | "ageSeconds">,
    jitterX: number,
    jitterZ: number,
  ): void {
    const point = TEMP_POINTS[skin]?.[pointIndex];
    if (!point || !this.resolvePoint(body, point, this.#local)) return;
    this.#local.x += jitterX;
    this.#local.z += jitterZ;
    this.pushParticle({
      ...options,
      position: this.#local.clone(),
      ageSeconds: 0,
    });
  }

  private emitAtObject(
    body: ClassicSkinnedInstanceLease,
    options: Omit<EmittedBillboard, "position" | "ageSeconds">,
    height: number,
  ): void {
    body.model.object.updateWorldMatrix(true, false);
    body.model.object.getWorldPosition(this.#world);
    this.#local.copy(this.#world).applyMatrix4(this.#inverseRoot);
    this.#local.y += height;
    this.pushParticle({
      ...options,
      position: this.#local.clone(),
      ageSeconds: 0,
    });
  }

  private pushParticle(particle: EmittedBillboard): void {
    if (this.#particles.length >= 2_048) this.#particles.shift();
    this.#particles.push(particle);
    this.writeParticle(particle);
  }

  private writeParticle(particle: EmittedBillboard): void {
    const progress = particle.ageSeconds / particle.lifeSeconds;
    const position = this.#local.copy(particle.position);
    position.y += particle.verticalDistance * progress;
    const growth = particle.scaleVelocity * particle.ageSeconds;
    this.batch(particle.texture, particle.bright !== false).write(
      position,
      particle.startScaleX + growth,
      particle.startScaleY + growth,
      particle.color,
      Math.sin(progress * Math.PI),
    );
  }
}

class BillboardBatch {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly #centers = new Float32Array(MAX_INSTANCES_PER_TEXTURE * 3);
  readonly #scales = new Float32Array(MAX_INSTANCES_PER_TEXTURE * 2);
  readonly #colors = new Float32Array(MAX_INSTANCES_PER_TEXTURE * 3);
  readonly #opacities = new Float32Array(MAX_INSTANCES_PER_TEXTURE);
  readonly #centerAttribute: THREE.InstancedBufferAttribute;
  readonly #scaleAttribute: THREE.InstancedBufferAttribute;
  readonly #colorAttribute: THREE.InstancedBufferAttribute;
  readonly #opacityAttribute: THREE.InstancedBufferAttribute;
  #texture: THREE.Texture | null = null;
  #count = 0;

  constructor(assets: ClassicAssetSource, textureIndex: number, bright: boolean) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.#centerAttribute = new THREE.InstancedBufferAttribute(this.#centers, 3);
    this.#scaleAttribute = new THREE.InstancedBufferAttribute(this.#scales, 2);
    this.#colorAttribute = new THREE.InstancedBufferAttribute(this.#colors, 3);
    this.#opacityAttribute = new THREE.InstancedBufferAttribute(this.#opacities, 1);
    geometry.setAttribute("instanceCenter", this.#centerAttribute);
    geometry.setAttribute("instanceScale", this.#scaleAttribute);
    geometry.setAttribute("instanceColor", this.#colorAttribute);
    geometry.setAttribute("instanceOpacity", this.#opacityAttribute);
    geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: `
        attribute vec3 instanceCenter;
        attribute vec2 instanceScale;
        attribute vec3 instanceColor;
        attribute float instanceOpacity;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vec4 center = modelViewMatrix * vec4(instanceCenter, 1.0);
          center.xy += position.xy * instanceScale;
          gl_Position = projectionMatrix * center;
          vUv = vec2(0.02 + uv.x * 0.96, 0.98 - uv.y * 0.96);
          vColor = instanceColor;
          vOpacity = instanceOpacity;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          vec4 texel = texture2D(map, vUv);
          if (texel.a <= 0.003) discard;
          gl_FragColor = vec4(texel.rgb * vColor, texel.a * vOpacity);
        }
      `,
      transparent: true,
      blending: bright ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = `classic-monster-effect-${textureIndex}-${bright ? "bright" : "default"}`;
    this.object.frustumCulled = false;
    this.object.renderOrder = 8;
    this.object.visible = false;

    const url = assets.effectTextureUrl(textureIndex);
    if (url) {
      const loader = new ClassicDdsTextureLoader();
      void loader.loadAsync(url).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.#texture = texture;
        material.uniforms.map!.value = texture;
        material.needsUpdate = true;
        this.object.visible = this.#count > 0;
      }).catch(() => undefined);
    }
  }

  beginFrame(): void {
    this.#count = 0;
  }

  write(
    position: THREE.Vector3,
    scaleX: number,
    scaleY: number,
    colorValue: number,
    opacity = 1,
  ): void {
    if (this.#count >= MAX_INSTANCES_PER_TEXTURE) return;
    const slot = this.#count++;
    const center = slot * 3;
    this.#centers[center] = position.x;
    this.#centers[center + 1] = position.y;
    this.#centers[center + 2] = position.z;
    const scale = slot * 2;
    this.#scales[scale] = scaleX;
    this.#scales[scale + 1] = scaleY;
    this.#colors[center] = ((colorValue >>> 16) & 0xff) / 255;
    this.#colors[center + 1] = ((colorValue >>> 8) & 0xff) / 255;
    this.#colors[center + 2] = (colorValue & 0xff) / 255;
    this.#opacities[slot] = opacity;
  }

  endFrame(): void {
    this.object.geometry.instanceCount = this.#count;
    this.object.visible = this.#texture !== null && this.#count > 0;
    if (!this.#count) return;
    this.#centerAttribute.needsUpdate = true;
    this.#scaleAttribute.needsUpdate = true;
    this.#colorAttribute.needsUpdate = true;
    this.#opacityAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.#texture?.dispose();
    this.#texture = null;
  }
}

export function classicMonsterEmissionPeriod(
  template: MonsterTemplate,
  scale: number,
): number | null {
  const visual = template.visual;
  if (!visual) return null;
  const characterClass = visual.itemClass;
  const face = visual.parts.find((part) => part[0] === 1);
  const coat = visual.parts.find((part) => part[0] === 3);
  const faceMesh = face?.[2] ?? 0;
  const faceSkin = face?.[3] ?? 0;
  const coatMesh = coat?.[2] ?? 0;
  const hasMantua = (template.equipment?.[15 * 7] ?? 0) > 0;
  if (characterClass === 16 && faceMesh === 6) return 0.3;
  if (characterClass === 16 && faceMesh === 0 && faceSkin === 1) return 0.3;
  if (characterClass === 30 && (faceMesh === 0 || faceMesh === 1 || faceMesh === 2)) return 0.3;
  if (characterClass === 30 && faceMesh === 4) return 0.1;
  if (characterClass === 38 && coatMesh === 14 && !hasMantua) return 0.1;
  if (characterClass === 22 || characterClass === 27) return 1 / 60;
  if (characterClass === 28 && faceMesh === 2) return 1;
  if (characterClass === 25 && ((faceMesh === 3 && faceSkin === 8) || faceMesh === 12)) return 1;
  if (characterClass === 32 && faceMesh === 1 && faceSkin === 0) return 0.5;
  if (characterClass === 21 && faceMesh === 4) return 0.1;
  if (characterClass === 25 && faceMesh === 3 && scale > 1.1751) return 1;
  if (characterClass === 16 && faceMesh === 7) return 0.1;
  return null;
}

function randomStep(value: number): number {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0 || 1;
}

function persistentBillboards(
  template: MonsterTemplate,
  catalog: MonsterCatalog,
  scale: number,
): readonly PersistentBillboard[] {
  const visual = template.visual;
  if (!visual) return [];
  const characterClass = visual.itemClass;
  const face = visual.parts.find((part) => part[0] === 1);
  const helm = visual.parts.find((part) => part[0] === 2);
  const faceMesh = face?.[2] ?? 0;
  const faceSkin = face?.[3] ?? 0;
  const helmMesh = helm?.[2] ?? 0;
  const equipment = template.equipment ?? [];

  if (characterClass === 36 || characterClass === 37) {
    const skeletonType = helmMesh === 11 ? 1 : helmMesh === 10 ? 2 : characterClass === 37 ? 3 : 0;
    const colors = [0x005555, 0x885500, 0x550000, 0x005500] as const;
    const pointOrder = [8, 9, 1, 6, 7, 2, 3] as const;
    const scaleX = [0.2, 0.8, 0.2, 0.6, 0.8, 0.6, 0.8] as const;
    const scaleY = [0.3, 1, 0.3, 0.8, 1, 0.8, 1] as const;
    return pointOrder.flatMap((point, index) => (
      (index === 2 && (skeletonType === 1 || skeletonType === 2))
      || (index >= 5 && skeletonType !== 2)
        ? []
        : [{
          point,
          texture: 101,
          cycleCount: 8,
          color: colors[skeletonType]!,
          scaleX: scaleX[index]! * scale,
          scaleY: scaleY[index]! * scale,
        }]
    ));
  }
  if (characterClass === 34 || characterClass === 23 || (characterClass === 21 && faceMesh === 10)) {
    const count = characterClass === 23 ? 2 : 1;
    const texture = characterClass === 21 ? 60 : 71;
    const color = characterClass === 23 ? 0x33ff66 : characterClass === 21 ? 0xee8800 : 0xffaaff;
    return Array.from({ length: count }, (_, point) => ({
      point,
      texture,
      cycleCount: 1,
      color,
      scaleX: scale,
      scaleY: scale,
    }));
  }
  if (characterClass === 29 && faceMesh === 1) {
    return [{ point: 0, texture: 71, cycleCount: 1, color: 0xff00ff, scaleX: scale, scaleY: scale }];
  }
  if (characterClass === 32 && faceMesh === 2) {
    return Array.from({ length: 6 }, (_, point) => ({
      point,
      texture: 11,
      cycleCount: 8,
      color: 0xaa8800,
      scaleX: 1.2 * scale,
      scaleY: 1.8 * scale,
    }));
  }
  if (characterClass === 39) {
    return [6, 7, 2, 3].map((point, index) => ({
      point,
      texture: index < 2 ? 56 : 101,
      cycleCount: index < 2 ? 1 : 8,
      color: 0xff5500,
      scaleX: scale,
      scaleY: scale,
    }));
  }
  if (characterClass === 38 && (equipment[15 * 7] ?? 0) > 0) {
    const leftItem = catalog.item(equipment[6 * 7] ?? 0);
    const color = leftItem?.mesh === 930 ? 0x008855 : 0x005588;
    const points = [9, 1, 6, 7, 2, 3] as const;
    const scaleX = [0.2, 0.8, 0.6, 0.6, 0.8, 0.8] as const;
    const scaleY = [0.3, 1, 0.8, 0.8, 1, 1] as const;
    return points.map((point, index) => ({
      point,
      texture: 123,
      cycleCount: 1,
      color,
      scaleX: scaleX[index]! * scale,
      scaleY: scaleY[index]! * scale,
    }));
  }
  // Emerald Dragon's recovered constructor fills m_pEyeFire[8/9], while its
  // renderer reads m_pEyeFire2[1/2]. Preserve that inert branch; do not guess.
  if (characterClass === 16 && faceMesh === 0 && faceSkin === 1) return [];
  return [];
}
