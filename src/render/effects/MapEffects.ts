import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import type { ModelLibrary } from "../objects/ModelLibrary";
import { EffectTextureLibrary } from "./EffectTextureLibrary";
import { MapMeshEffects } from "./MapMeshEffects";

interface BillboardDefinition {
  readonly firstTexture: number;
  readonly frameCount: number;
  readonly frameTime: number;
  readonly color: number;
  readonly opacity: number;
}

interface GroundShadeDefinition {
  readonly color: number;
  readonly opacity: number;
}

const billboardDefinitions: Readonly<Record<number, BillboardDefinition>> = {
  501: { firstTexture: 11, frameCount: 8, frameTime: 80, color: 0xeecc00, opacity: 0xee / 255 },
  502: { firstTexture: 61, frameCount: 6, frameTime: 80, color: 0xffffff, opacity: 1 },
  503: { firstTexture: 101, frameCount: 8, frameTime: 80, color: 0x5500ff, opacity: 1 },
  504: { firstTexture: 56, frameCount: 1, frameTime: 80, color: 0xff0000, opacity: 1 },
  505: { firstTexture: 79, frameCount: 1, frameTime: 80, color: 0x330000, opacity: 0.55 },
};

// TMObjectContainer.cpp: col[nTexIndex][1], used by TMShade(5, 7, 1).
const groundShadeDefinitions: Readonly<Record<number, GroundShadeDefinition>> = {
  501: { color: 0x331100, opacity: 0x33 / 255 },
  502: { color: 0x331100, opacity: 0x33 / 255 },
  // The classic literal for type 503 is 0x00011033 (zero alpha), therefore it
  // intentionally contributes no visible ground shade.
  503: { color: 0x011033, opacity: 0 },
};

const OWNED_GROUND_SHADE = "classicOwnedGroundShade";
const OWNED_HOUSE_PARTICLES = "classicOwnedHouseParticles";
const HOUSE_FOUNTAIN_PARTICLE_TYPES = new Set([195, 273, 274, 697, 699, 1993]);
const HOUSE_WATERFALL_PARTICLE_TYPES = new Set([292, 490, 1526, 2005]);
const HOUSE_GATE_PARTICLE_TYPE = 607;

interface HouseParticle {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly phase: number;
  readonly cycle: number;
  readonly lifetime: number;
  readonly size: number;
  readonly growth: number;
  readonly rise: number;
}

export class MapEffects {
  readonly object = new THREE.Group();
  readonly #textures: EffectTextureLibrary;
  readonly #meshEffects: MapMeshEffects;
  readonly #fieldGroups = new Map<string, THREE.Group>();
  readonly #generations = new Map<string, number>();

  constructor(
    assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    models: ModelLibrary,
    private readonly heightAt: (position: WydPosition) => number,
  ) {
    this.#textures = new EffectTextureLibrary(assets);
    this.#meshEffects = new MapMeshEffects(models, origin);
    this.object.name = "map-effects";
    this.object.add(this.#meshEffects.object);
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const group = new THREE.Group();
    group.name = `effects-${key}`;
    this.#fieldGroups.set(key, group);
    this.object.add(group);
    const effects = records.filter((record) => (
      record.type in billboardDefinitions
      || (record.type >= 511 && record.type <= 518)
      || record.type === 1846
      || record.type === 2035
    ));
    const houseParticleRecords = records.filter((record) => (
      HOUSE_FOUNTAIN_PARTICLE_TYPES.has(record.type)
      || HOUSE_WATERFALL_PARTICLE_TYPES.has(record.type)
      || record.type === HOUSE_GATE_PARTICLE_TYPE
    ));
    const isCurrent = () => (
      this.#generations.get(key) === generation && this.#fieldGroups.get(key) === group
    );
    await Promise.all([
      this.#meshEffects.addBlock(column, row, records),
      this.addHouseParticleBatches(column, row, houseParticleRecords, group, isCurrent),
      ...effects.map((record) => this.addRecord(column, row, record, group, isCurrent)),
    ]);
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#meshEffects.removeBlock(column, row);
    const group = this.#fieldGroups.get(key);
    if (!group) return;
    this.#fieldGroups.delete(key);
    this.object.remove(group);
    group.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.onBeforeRender = () => undefined;
        child.material.dispose();
        return;
      }
      if (child instanceof THREE.Points && child.userData[OWNED_HOUSE_PARTICLES]) {
        child.onBeforeRender = () => undefined;
        child.geometry.dispose();
        child.material.dispose();
        return;
      }
      if (child instanceof THREE.Mesh && child.userData[OWNED_GROUND_SHADE]) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  dispose(): void {
    const keys = [...this.#fieldGroups.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    this.#meshEffects.dispose();
    this.#textures.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }

  setEnabled(enabled: boolean): void {
    this.object.visible = enabled;
  }

  private async addRecord(
    column: number,
    row: number,
    record: MapObjectRecord,
    target: THREE.Group,
    isCurrent: () => boolean,
  ): Promise<void> {
    const mapPosition = {
      x: column * FIELD_WORLD_SIZE + record.localX,
      y: row * FIELD_WORLD_SIZE + record.localY,
    };
    const scene = toScene(mapPosition, this.origin);
    const position = new THREE.Vector3(scene.x, record.height, scene.z);

    if (record.type >= 511 && record.type <= 518) {
      if (!isCurrent()) return;
      const light = new THREE.PointLight(0xffe36b, 2.1, 5, 1.6);
      light.position.copy(position);
      light.name = `map-light-${record.type}`;
      target.add(light);
      return;
    }

    if (record.type === 2035) {
      const [portalTexture, coreTexture] = await Promise.all([
        this.#textures.load(423),
        this.#textures.load(424),
      ]);
      if (!isCurrent()) return;
      if (portalTexture) {
        const portal = createSprite([portalTexture], 80, 0xffffff, 1);
        portal.position.copy(position);
        portal.position.y += 3.5699999;
        portal.scale.set(1.7, 3.5999999, 1);
        portal.renderOrder = 3;
        portal.name = "map-effect-2035-portal";
        target.add(portal);
      }
      if (coreTexture) {
        const core = createSprite([coreTexture], 80, 0xffffff, 1);
        core.position.copy(position);
        core.position.y += 0.5;
        core.scale.set(1, 1, 1);
        core.renderOrder = 3;
        core.name = "map-effect-2035-core";
        target.add(core);
      }
      return;
    }

    if (record.type === 1846) {
      const [glowTexture, fireFrames] = await Promise.all([
        this.#textures.load(2),
        this.#textures.sequence(11, 8),
      ]);
      if (!isCurrent()) return;
      // TMObjectContainer creates twelve fire/glow pairs at radius 3 and a
      // second ring of eight glows at radius 2.25 around the effect mesh.
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI * 2 / 12;
        const ringPosition = position.clone().add(new THREE.Vector3(
          0.5 + Math.cos(angle) * 3,
          2.9000001,
          -Math.sin(angle) * 3,
        ));
        if (glowTexture) {
          const glow = createSprite([glowTexture], 80, 0x553300, 0x55 / 255);
          glow.position.copy(ringPosition);
          glow.scale.set(2.8, 2.8, 1);
          glow.renderOrder = 2;
          glow.name = "map-effect-1846-lower-glow";
          target.add(glow);
        }
        if (fireFrames.length > 0) {
          const fire = createSprite(fireFrames, 80, 0xeecc00, 0xee / 255);
          fire.position.copy(ringPosition);
          fire.scale.set(1, 1, 1);
          fire.renderOrder = 3;
          fire.name = "map-effect-1846-fire";
          target.add(fire);
        }
      }
      if (glowTexture) {
        for (let index = 0; index < 8; index++) {
          const angle = index * Math.PI * 2 / 8;
          const glow = createSprite([glowTexture], 80, 0x553300, 0x55 / 255);
          glow.position.copy(position).add(new THREE.Vector3(
            0.5 + Math.cos(angle) * 2.25,
            4.6500001,
            -Math.sin(angle) * 2.25,
          ));
          glow.scale.set(2.8, 2.8, 1);
          glow.renderOrder = 2;
          glow.name = "map-effect-1846-upper-glow";
          target.add(glow);
        }
      }
      return;
    }

    const definition = billboardDefinitions[record.type];
    if (!definition) return;
    const shadeDefinition = groundShadeDefinitions[record.type];
    const [frames, glowTexture, shadeTexture] = await Promise.all([
      this.#textures.sequence(definition.firstTexture, definition.frameCount),
      record.type <= 503 ? this.#textures.load(2) : Promise.resolve(null),
      shadeDefinition?.opacity ? this.#textures.load(7) : Promise.resolve(null),
    ]);
    if (frames.length === 0 || !isCurrent()) return;

    if (shadeDefinition && shadeTexture && shadeDefinition.opacity > 0) {
      target.add(createGroundShade(
        mapPosition,
        this.origin,
        this.heightAt,
        shadeTexture,
        shadeDefinition,
        record.type,
      ));
    }

    if (glowTexture) {
      const glow = createSprite([glowTexture], 1000, record.type === 503 ? 0x330055 : 0x553300, record.type === 503 ? 0.8 : 0.34);
      glow.position.copy(position);
      glow.scale.set(record.scaleH * 2.8, record.scaleV * 2.8, 1);
      glow.renderOrder = 1;
      target.add(glow);
    }

    const sprite = createSprite(frames, definition.frameTime, definition.color, definition.opacity);
    sprite.position.copy(position);
    sprite.scale.set(record.scaleH, record.scaleV, 1);
    sprite.renderOrder = 2;
    sprite.name = `map-effect-${record.type}`;
    target.add(sprite);

    // Green fire is rendered twice in the original: a large colored flame and
    // a smaller white-hot core slightly below it.
    if (record.type === 503) {
      const core = createSprite(frames, definition.frameTime, 0xffffff, 1, 37);
      core.position.copy(position);
      core.position.y -= record.scaleV * 0.2;
      core.scale.set(record.scaleH * 0.5, record.scaleV * 0.5, 1);
      core.renderOrder = 3;
      target.add(core);
    }

    if (record.type === 504) installPulse(sprite, record.scaleH, record.scaleV);
  }

  private async addHouseParticleBatches(
    column: number,
    row: number,
    records: readonly MapObjectRecord[],
    target: THREE.Group,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (records.length === 0) return;
    const waterRecords = records.filter((record) => record.type !== HOUSE_GATE_PARTICLE_TYPE);
    const gateRecords = records.filter((record) => record.type === HOUSE_GATE_PARTICLE_TYPE);
    const normalGateRecords = gateRecords.filter(() => !isDungeonTwo(column, row));
    const dungeonGateRecords = gateRecords.filter(() => isDungeonTwo(column, row));
    const [splashTexture, gateTexture, gateCoreTexture] = await Promise.all([
      waterRecords.length > 0 || dungeonGateRecords.length > 0
        ? this.#textures.load(151)
        : Promise.resolve(null),
      normalGateRecords.length > 0 ? this.#textures.load(0) : Promise.resolve(null),
      gateRecords.length > 0 ? this.#textures.load(56) : Promise.resolve(null),
    ]);
    if (!isCurrent()) return;

    if (splashTexture && waterRecords.length > 0) {
      const particles = createHouseWaterParticles(column, row, waterRecords, this.origin);
      if (particles.length > 0) {
        target.add(createHouseParticlePoints(
          particles,
          splashTexture,
          0xffffff,
          0.86,
          false,
          "map-effect-house-water-splashes",
        ));
      }
    }

    for (const [profileRecords, texture, color, additive, name] of [
      [normalGateRecords, gateTexture, 0x00aaff, true, "map-effect-607-energy"],
      [dungeonGateRecords, splashTexture, 0xffffff, false, "map-effect-607-dungeon-energy"],
    ] as const) {
      if (!texture || profileRecords.length === 0) continue;
      const { billboards } = createGateParticles(column, row, profileRecords, this.origin);
      if (billboards.length > 0) {
        target.add(createHouseParticlePoints(
          billboards,
          texture,
          color,
          additive ? 0.72 : 0.82,
          additive,
          name,
        ));
      }
    }

    if (gateCoreTexture && gateRecords.length > 0) {
      const { cores } = createGateParticles(column, row, gateRecords, this.origin);
      if (cores.length > 0) {
        target.add(createHouseParticlePoints(
          cores,
          gateCoreTexture,
          0x005588,
          0.76,
          true,
          "map-effect-607-particles",
        ));
      }
    }
  }
}

function createHouseWaterParticles(
  column: number,
  row: number,
  records: readonly MapObjectRecord[],
  origin: WydPosition,
): HouseParticle[] {
  const particles: HouseParticle[] = [];
  const nozzleAngles = [-1.3463968, 0, Math.PI / 2, Math.PI, Math.PI * 1.5, 5.1050882] as const;
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    if (!record) continue;
    const worldX = column * FIELD_WORLD_SIZE + record.localX;
    const worldY = row * FIELD_WORLD_SIZE + record.localY;

    if (HOUSE_FOUNTAIN_PARTICLE_TYPES.has(record.type)) {
      let firstNozzle = 1;
      let nozzleCount = 5;
      let length = 1.8;
      let angleOffset = 0;
      if (record.type === 274) {
        firstNozzle = 0;
        nozzleCount = 1;
        length = 1;
      } else if (record.type === 195) {
        firstNozzle = 0;
        nozzleCount = 4;
        length = 0.8;
      } else if (record.type === 697) {
        firstNozzle = 0;
        nozzleCount = 1;
        length = -1;
      } else if (record.type === 699) {
        firstNozzle = 0;
        nozzleCount = 4;
        length = 1;
      } else if (record.type === 1993) {
        firstNozzle = 0;
        nozzleCount = 4;
        length = 1.5;
        angleOffset = Math.PI / 4;
      }
      appendWaterEmitterParticles({
        particles,
        column,
        row,
        recordIndex,
        record,
        origin,
        worldX,
        worldY,
        nozzleAngles,
        firstNozzle,
        nozzleCount,
        length,
        angleOffset,
        interval: 0.2,
        count: 8,
        baseSize: 0.12,
        sizeUnit: 0.15,
        jitterUnit: 0.05,
        height: record.height + 0.3,
      });
      continue;
    }

    if (!HOUSE_WATERFALL_PARTICLE_TYPES.has(record.type)) continue;
    const large = record.type === 1526 || record.type === 2005;
    const count = large ? 4 : 2;
    const interval = large ? 0.3 : 0.1;
    const slots = Math.ceil(1.5 / interval);
    const length = record.type === 2005 ? 2.5 : large ? 4 : 3.2;
    const detail = record.type === 2005 ? 6.4 : large ? 1 : 0;
    const baseSize = large ? 0.8 : 0.4;
    for (let slot = 0; slot < slots; slot++) {
      const random = Math.floor(hash01(column * 17.31 + row * 29.17 + recordIndex * 11.3 + slot * 7.9) * 5);
      for (let nozzle = 0; nozzle < count; nozzle++) {
        const angle = detail * 0.3 + record.angle - nozzle * (large ? 0.2 : 0.1) + Math.PI / 2;
        const logicalX = worldX - Math.cos(angle) * length - random * (record.type === 1526 ? 0.15 : 0.05);
        const logicalY = worldY + Math.sin(angle) * length - random * (record.type === 1526 ? 0.15 : 0.05);
        const scene = toScene({ x: logicalX, y: logicalY }, origin);
        const waterfallHeight = record.type === 1526
          ? record.height + (column === 9 && row === 28 ? 0 : -1.9)
          : record.height + 0.3;
        particles.push({
          x: scene.x,
          y: waterfallHeight,
          z: scene.z,
          phase: slot * interval,
          cycle: slots * interval,
          lifetime: 1.5,
          size: random * 0.15 + baseSize + nozzle * 0.3,
          growth: 0.5,
          rise: 0,
        });
      }
    }
  }
  return particles;
}

function appendWaterEmitterParticles(options: {
  readonly particles: HouseParticle[];
  readonly column: number;
  readonly row: number;
  readonly recordIndex: number;
  readonly record: MapObjectRecord;
  readonly origin: WydPosition;
  readonly worldX: number;
  readonly worldY: number;
  readonly nozzleAngles: readonly number[];
  readonly firstNozzle: number;
  readonly nozzleCount: number;
  readonly length: number;
  readonly angleOffset: number;
  readonly interval: number;
  readonly count: number;
  readonly baseSize: number;
  readonly sizeUnit: number;
  readonly jitterUnit: number;
  readonly height: number;
}): void {
  const cycle = options.count * options.interval;
  for (let slot = 0; slot < options.count; slot++) {
    const random = Math.floor(hash01(
      options.column * 17.31
      + options.row * 29.17
      + options.recordIndex * 11.3
      + slot * 7.9,
    ) * 5);
    for (let offset = 0; offset < options.nozzleCount; offset++) {
      const nozzle = options.firstNozzle + offset;
      const nozzleAngle = options.nozzleAngles[nozzle];
      if (nozzleAngle === undefined) continue;
      const angle = options.record.angle + options.angleOffset + nozzleAngle;
      const logicalX = options.worldX - Math.cos(angle) * options.length - random * options.jitterUnit;
      const logicalY = options.worldY + Math.sin(angle) * options.length - random * options.jitterUnit;
      const scene = toScene({ x: logicalX, y: logicalY }, options.origin);
      options.particles.push({
        x: scene.x,
        y: options.height,
        z: scene.z,
        phase: slot * options.interval,
        cycle,
        lifetime: 1.5,
        size: random * options.sizeUnit + options.baseSize,
        growth: 0.5,
        rise: 0,
      });
    }
  }
}

function createGateParticles(
  column: number,
  row: number,
  records: readonly MapObjectRecord[],
  origin: WydPosition,
): { readonly billboards: HouseParticle[]; readonly cores: HouseParticle[] } {
  const billboards: HouseParticle[] = [];
  const cores: HouseParticle[] = [];
  const interval = 0.2;
  const slots = 10;
  const cycle = slots * interval;
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    if (!record) continue;
    const worldX = column * FIELD_WORLD_SIZE + record.localX;
    const worldY = row * FIELD_WORLD_SIZE + record.localY;
    for (let slot = 0; slot < slots; slot++) {
      for (let copy = 0; copy < 5; copy++) {
        const seed = hash01(column * 71.3 + row * 31.9 + recordIndex * 17.1 + slot * 5.7 + copy * 2.3);
        const random = Math.floor(seed * 10) - 5;
        const scene = toScene({
          x: worldX + random * 0.05,
          y: worldY + random * 0.05,
        }, origin);
        billboards.push({
          x: scene.x,
          y: record.height + 1,
          z: scene.z,
          phase: slot * interval,
          cycle,
          lifetime: random * 0.1 + 1.5,
          size: Math.max(0.2, Math.abs(random * 0.6 + 1.5)),
          growth: 0.1,
          rise: 1.5,
        });
        const coreScene = toScene({ x: worldX, y: worldY }, origin);
        cores.push({
          x: coreScene.x,
          y: record.height + 1,
          z: coreScene.z,
          phase: slot * interval,
          cycle,
          lifetime: 1,
          size: 0.42,
          growth: 0.18,
          rise: 0.6,
        });
      }
    }
  }
  return { billboards, cores };
}

function createHouseParticlePoints(
  particles: readonly HouseParticle[],
  texture: THREE.Texture,
  color: number,
  opacity: number,
  additive: boolean,
  name: string,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const count = particles.length;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const cycles = new Float32Array(count);
  const lifetimes = new Float32Array(count);
  const sizes = new Float32Array(count);
  const growth = new Float32Array(count);
  const rise = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const particle = particles[index];
    if (!particle) continue;
    positions[index * 3] = particle.x;
    positions[index * 3 + 1] = particle.y;
    positions[index * 3 + 2] = particle.z;
    phases[index] = particle.phase;
    cycles[index] = particle.cycle;
    lifetimes[index] = particle.lifetime;
    sizes[index] = particle.size;
    growth[index] = particle.growth;
    rise[index] = particle.rise;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("particlePhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("particleCycle", new THREE.BufferAttribute(cycles, 1));
  geometry.setAttribute("particleLifetime", new THREE.BufferAttribute(lifetimes, 1));
  geometry.setAttribute("particleSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("particleGrowth", new THREE.BufferAttribute(growth, 1));
  geometry.setAttribute("particleRise", new THREE.BufferAttribute(rise, 1));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 5;
  const time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    name: `WYD ${name}`,
    uniforms: {
      time,
      spriteMap: { value: texture },
      tint: { value: new THREE.Color(color) },
      opacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      attribute float particlePhase;
      attribute float particleCycle;
      attribute float particleLifetime;
      attribute float particleSize;
      attribute float particleGrowth;
      attribute float particleRise;
      varying float vFade;
      void main() {
        float age = mod(time + particlePhase, particleCycle);
        float progress = clamp(age / particleLifetime, 0.0, 1.0);
        float active = 1.0 - step(particleLifetime, age);
        vec3 animated = position;
        animated.y += particleRise * age;
        vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
        float size = max(0.05, particleSize + particleGrowth * age);
        gl_PointSize = clamp((118.0 * size) / max(1.0, -mvPosition.z), 1.0, 42.0);
        gl_Position = projectionMatrix * mvPosition;
        vFade = active * sin(progress * 3.14159265);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D spriteMap;
      uniform vec3 tint;
      uniform float opacity;
      varying float vFade;
      void main() {
        vec2 uv = vec2(0.02 + gl_PointCoord.x * 0.96, 0.98 - gl_PointCoord.y * 0.96);
        vec4 sampleColor = texture2D(spriteMap, uv);
        float sourceAlpha = max(sampleColor.a, dot(sampleColor.rgb, vec3(0.333333)));
        float alpha = sourceAlpha * vFade * opacity;
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(tint * max(sampleColor.rgb, vec3(0.35)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.renderOrder = 5;
  points.userData[OWNED_HOUSE_PARTICLES] = true;
  points.onBeforeRender = () => {
    time.value = performance.now() / 1_000;
  };
  return points;
}

function isDungeonTwo(column: number, row: number): boolean {
  return row > 25 && column > 8 && column < 16;
}

function hash01(value: number): number {
  return Math.abs(Math.sin(value * 12.9898 + 78.233) * 43_758.5453) % 1;
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

function createGroundShade(
  center: WydPosition,
  origin: WydPosition,
  heightAt: (position: WydPosition) => number,
  texture: THREE.Texture,
  definition: GroundShadeDefinition,
  type: number,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // TMShade(5, ...): a 5x5 grid snapped to WYD's two-unit terrain lattice.
  const grid = 5;
  const gridOriginX = Math.trunc(center.x / 2) - Math.trunc(grid / 2);
  const gridOriginY = Math.trunc(center.y / 2) - Math.trunc(grid / 2);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= grid; y++) {
    for (let x = 0; x <= grid; x++) {
      const worldX = (gridOriginX + x) * 2;
      const worldY = (gridOriginY + y) * 2;
      const scene = toScene({ x: worldX, y: worldY }, origin);
      positions.push(scene.x, heightAt({ x: worldX, y: worldY }) + 0.05, scene.z);
      // Texture 7 is radial. These normalized coordinates reproduce the same
      // ten-unit footprint as TMShade without relying on texture wrapping.
      uvs.push(x / grid, 1 - y / grid);
    }
  }
  const stride = grid + 1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = x + y * stride;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: definition.color,
    opacity: definition.opacity,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const shade = new THREE.Mesh(geometry, material);
  shade.name = `map-effect-${type}-ground-shade`;
  shade.renderOrder = 1;
  shade.userData[OWNED_GROUND_SHADE] = true;
  return shade;
}

function createSprite(
  frames: readonly THREE.Texture[],
  frameTime: number,
  color: number,
  opacity: number,
  phaseOffset = 0,
): THREE.Sprite {
  for (const frame of frames) configureClassicBillboardUvs(frame);
  const material = new THREE.SpriteMaterial({
    map: frames[0],
    color,
    opacity,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  const phase = phaseOffset + Math.floor(Math.random() * Math.max(1, frames.length * frameTime));
  sprite.onBeforeRender = () => {
    const frame = Math.floor((performance.now() + phase) / frameTime) % frames.length;
    if (material.map !== frames[frame]) material.map = frames[frame]!;
  };
  return sprite;
}

/**
 * DDSLoader keeps compressed DirectDraw surfaces in their native top-left
 * orientation (`flipY = false`). Three's shared Sprite geometry, however,
 * assigns V=0 to its lower vertices. The classic TMEffectBillBoard does the
 * opposite: lower vertices sample V=.98 and upper vertices sample V=.02.
 *
 * Reproduce that mapping through the texture matrix instead of changing the
 * DDS itself. Besides fixing vertically inverted flames, the .02 inset keeps
 * compressed edge texels from bleeding exactly as the original quad did.
 */
function configureClassicBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
}

function installPulse(sprite: THREE.Sprite, scaleX: number, scaleY: number): void {
  const animateFrames = sprite.onBeforeRender;
  sprite.onBeforeRender = (...args) => {
    animateFrames(...args);
    const pulse = 0.85 + Math.sin(performance.now() * Math.PI / 1500) * 0.15;
    sprite.scale.set(scaleX * pulse, scaleY * pulse, 1);
  };
}
