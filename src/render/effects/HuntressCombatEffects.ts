import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CRITICAL_CORE_LIFETIME = 0.2;
const CRITICAL_PARTICLE_LIFETIME = 0.3;
const CRITICAL_BILLBOARD_LIFETIME = 0.6;
const CRITICAL_POOL_LIMIT = 24;
const CRITICAL_PARTICLE_COUNT = 50;
const CRITICAL_RED = 0x883333;
const CRITICAL_CORE = 0xffcccc;

interface FlyingArrow {
  readonly object: THREE.Group;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly duration: number;
  readonly onImpact: (() => void) | null;
  elapsed: number;
}

interface ExpandingBurst {
  readonly mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly duration: number;
  elapsed: number;
}

interface ClassicCriticalResources {
  readonly meshGeometry: THREE.BufferGeometry;
  readonly planeGeometry: THREE.PlaneGeometry;
  readonly coreTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly billboardTexture: THREE.Texture;
  readonly particleTexture: THREE.Texture;
}

interface ClassicCriticalVisual {
  readonly group: THREE.Group;
  readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly billboards: readonly [
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  ];
  readonly particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly particlePositions: THREE.BufferAttribute;
  readonly particleDirections: Float32Array;
  active: boolean;
  elapsed: number;
  serial: number;
}

export class HuntressCombatEffects {
  readonly object = new THREE.Group();
  readonly #arrows: FlyingArrow[] = [];
  readonly #bursts: ExpandingBurst[] = [];
  readonly #shaftGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.9, 5);
  readonly #tipGeometry = new THREE.ConeGeometry(0.075, 0.22, 6);
  readonly #materials = new Map<number, { shaft: THREE.MeshBasicMaterial; tip: THREE.MeshBasicMaterial }>();
  readonly #criticalVisuals: ClassicCriticalVisual[] = [];
  #criticalResources: ClassicCriticalResources | null = null;
  #criticalPreload: Promise<void> | null = null;
  #criticalSerial = 0;
  #enabled = true;

  constructor() {
    this.object.name = "huntress-combat-effects";
  }

  /**
   * Preloads the exact assets used by TMArrow's classic critical impact.
   * A failed optional effect never blocks combat: criticalImpact falls back
   * to the existing procedural burst and a later call may retry the preload.
   */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#criticalResources) return;
    if (this.#criticalPreload) return this.#criticalPreload;
    const job = this.loadClassicCriticalResources(assets)
      .then((resources) => {
        this.#criticalResources = resources;
      })
      .catch((error: unknown) => {
        console.warn("Impacto crítico clássico indisponível; usando fallback.", error);
      })
      .finally(() => {
        this.#criticalPreload = null;
      });
    this.#criticalPreload = job;
    return job;
  }

  shoot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    onImpact: () => void,
    count = 1,
    millisecondsPerUnit?: number,
  ): void {
    // Effects are presentation only: with g_bHideEffect active the hit still
    // resolves, without allocating or advancing projectile meshes.
    if (!this.#enabled) {
      onImpact();
      return;
    }
    const arrows = Math.max(1, Math.min(5, Math.trunc(count)));
    for (let index = 0; index < arrows; index++) {
      const spread = (index - (arrows - 1) / 2) * 0.13;
      const destination = to.clone().add(new THREE.Vector3(spread, Math.abs(spread) * 0.25, -spread * 0.45));
      const direction = destination.clone().sub(from);
      const distance = direction.length();
      if (distance <= 1e-5) continue;
      direction.divideScalar(distance);
      const materials = this.materials(color);
      const group = new THREE.Group();
      const shaft = new THREE.Mesh(this.#shaftGeometry, materials.shaft);
      const tip = new THREE.Mesh(this.#tipGeometry, materials.tip);
      tip.position.y = 0.55;
      group.add(shaft, tip);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      group.position.copy(from);
      this.object.add(group);
      this.#arrows.push({
        object: group,
        from: from.clone(),
        to: destination,
        // TMArrow type 151 truncates the distance to an integer and assigns
        // 50 ms per unit. Other provisional skill arrows retain their current
        // tuning until each original effect is ported independently.
        duration: millisecondsPerUnit === undefined
          ? Math.max(0.12, distance / 29)
          : Math.max(0.001, Math.floor(distance) * millisecondsPerUnit / 1_000),
        onImpact: index === 0 ? onImpact : null,
        elapsed: 0,
      });
    }
  }

  burst(position: THREE.Vector3, color: number, radius = 2.5): void {
    if (!this.#enabled) return;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.58, 36), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y += 0.08;
    mesh.scale.setScalar(0.25);
    mesh.userData.targetRadius = radius;
    this.object.add(mesh);
    this.#bursts.push({ mesh, duration: 0.55, elapsed: 0 });
  }

  /** Recreates TMArrow's mesh 531 + shade/particle/cross critical impact. */
  criticalImpact(position: THREE.Vector3): void {
    if (!this.#enabled) return;
    const resources = this.#criticalResources;
    if (!resources) {
      this.burst(position, 0xffc554, 1.1);
      return;
    }

    const serial = ++this.#criticalSerial;
    const visual = this.acquireCriticalVisual(resources);
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = serial;
    visual.group.visible = true;
    visual.group.position.copy(position);
    // criticalImpact intentionally only needs an impact point. A stable
    // per-hit yaw keeps repeated hits from looking mechanically identical.
    visual.group.rotation.set(0, (serial * 2.399963229728653) % (Math.PI * 2), 0);

    visual.core.visible = true;
    visual.core.scale.setScalar(0.5);
    visual.core.material.opacity = 0;
    visual.shade.visible = true;
    visual.shade.material.opacity = 0;
    for (const billboard of visual.billboards) {
      billboard.visible = true;
      billboard.scale.setScalar(3);
      billboard.material.opacity = 0;
    }
    visual.particles.visible = true;
    visual.particles.material.opacity = 0;
    this.updateCriticalParticlePositions(visual, 0);
  }

  update(deltaSeconds: number): void {
    if (!this.#enabled) return;
    for (let index = this.#arrows.length - 1; index >= 0; index--) {
      const arrow = this.#arrows[index]!;
      arrow.elapsed += deltaSeconds;
      const progress = Math.min(1, arrow.elapsed / arrow.duration);
      arrow.object.position.lerpVectors(arrow.from, arrow.to, progress);
      arrow.object.position.y += Math.sin(progress * Math.PI) * 0.035;
      if (progress < 1) continue;
      arrow.object.removeFromParent();
      this.#arrows.splice(index, 1);
      arrow.onImpact?.();
    }
    for (let index = this.#bursts.length - 1; index >= 0; index--) {
      const burst = this.#bursts[index]!;
      burst.elapsed += deltaSeconds;
      const progress = Math.min(1, burst.elapsed / burst.duration);
      const radius = Number(burst.mesh.userData.targetRadius ?? 2.5);
      burst.mesh.scale.setScalar(0.25 + radius * progress);
      burst.mesh.material.opacity = (1 - progress) * 0.86;
      if (progress < 1) continue;
      burst.mesh.removeFromParent();
      burst.mesh.geometry.dispose();
      burst.mesh.material.dispose();
      this.#bursts.splice(index, 1);
    }
    for (const visual of this.#criticalVisuals) {
      if (!visual.active) continue;
      this.updateCriticalVisual(visual, deltaSeconds);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (enabled) return;

    // Resolve pending gameplay before dropping its presentation objects.
    const impacts = this.#arrows
      .map((arrow) => arrow.onImpact)
      .filter((impact): impact is () => void => impact !== null);
    for (const arrow of this.#arrows.splice(0)) arrow.object.removeFromParent();
    for (const burst of this.#bursts.splice(0)) {
      burst.mesh.removeFromParent();
      burst.mesh.geometry.dispose();
      burst.mesh.material.dispose();
    }
    for (const visual of this.#criticalVisuals) this.deactivateCriticalVisual(visual);
    for (const impact of impacts) impact();
  }

  dispose(): void {
    this.setEnabled(false);
    this.#shaftGeometry.dispose();
    this.#tipGeometry.dispose();
    for (const material of this.#materials.values()) {
      material.shaft.dispose();
      material.tip.dispose();
    }
    this.#materials.clear();
    for (const visual of this.#criticalVisuals.splice(0)) disposeCriticalVisual(visual);
    if (this.#criticalResources) {
      this.#criticalResources.meshGeometry.dispose();
      this.#criticalResources.planeGeometry.dispose();
      this.#criticalResources.coreTexture.dispose();
      this.#criticalResources.shadeTexture.dispose();
      this.#criticalResources.billboardTexture.dispose();
      this.#criticalResources.particleTexture.dispose();
      this.#criticalResources = null;
    }
    this.object.removeFromParent();
    this.object.clear();
  }

  private async loadClassicCriticalResources(assets: ClassicAssetSource): Promise<ClassicCriticalResources> {
    const loader = new ClassicDdsTextureLoader();
    const texture = async (index: number): Promise<THREE.Texture> => {
      const url = assets.effectTextureUrl(index);
      if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
      const loaded = await loader.loadAsync(url);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = 4;
      loaded.needsUpdate = true;
      return loaded;
    };
    const source = await assets.loadModel(531);
    if (!source) throw new Error("Modelo de efeito 531 ausente do manifesto");
    const loadedTextures = await Promise.allSettled([
      texture(229),
      texture(118),
      texture(230),
      texture(231),
    ]);
    const successfulTextures = loadedTextures.filter(
      (result): result is PromiseFulfilledResult<THREE.Texture> => result.status === "fulfilled",
    );
    if (successfulTextures.length !== loadedTextures.length) {
      for (const result of successfulTextures) result.value.dispose();
      const failure = loadedTextures.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw failure?.reason ?? new Error("Falha desconhecida ao carregar texturas do impacto crítico");
    }
    const coreTexture = successfulTextures[0]!.value;
    const shadeTexture = successfulTextures[1]!.value;
    const billboardTexture = successfulTextures[2]!.value;
    const particleTexture = successfulTextures[3]!.value;
    let model;
    try {
      model = parseMsa(source.buffer);
    } catch (error) {
      for (const result of successfulTextures) result.value.dispose();
      throw error;
    }
    return {
      meshGeometry: model.geometry,
      planeGeometry: new THREE.PlaneGeometry(1, 1),
      coreTexture,
      shadeTexture,
      billboardTexture,
      particleTexture,
    };
  }

  private acquireCriticalVisual(resources: ClassicCriticalResources): ClassicCriticalVisual {
    const free = this.#criticalVisuals.find((visual) => !visual.active);
    if (free) return free;
    if (this.#criticalVisuals.length < CRITICAL_POOL_LIMIT) {
      const created = createCriticalVisual(resources, this.#criticalVisuals.length);
      this.#criticalVisuals.push(created);
      this.object.add(created.group);
      return created;
    }
    // Bound GPU/CPU resources even under an attack storm. Recycle the oldest
    // live entry instead of allocating a permanent object for every hit.
    let oldest = this.#criticalVisuals[0]!;
    for (const visual of this.#criticalVisuals) {
      if (visual.serial < oldest.serial) oldest = visual;
    }
    this.deactivateCriticalVisual(oldest);
    return oldest;
  }

  private updateCriticalVisual(visual: ClassicCriticalVisual, deltaSeconds: number): void {
    visual.elapsed += Math.max(0, deltaSeconds);

    const coreProgress = Math.min(1, visual.elapsed / CRITICAL_CORE_LIFETIME);
    if (coreProgress < 1) {
      const alpha = Math.sin(coreProgress * Math.PI);
      const scale = coreProgress < 0.2
        ? 0.5 + coreProgress * 5
        : 1.5 + Math.sin((coreProgress - 0.2) * Math.PI * 0.5);
      visual.core.visible = true;
      visual.core.scale.setScalar(scale);
      visual.core.material.opacity = alpha * 0.5;
      visual.shade.visible = true;
      visual.shade.material.opacity = alpha;
    } else {
      visual.core.visible = false;
      visual.shade.visible = false;
    }

    const particleProgress = Math.min(1, visual.elapsed / CRITICAL_PARTICLE_LIFETIME);
    if (particleProgress < 1) {
      visual.particles.visible = true;
      visual.particles.material.opacity = particleProgress < 0.3
        ? particleProgress / 0.3
        : Math.max(0, 1 - (particleProgress - 0.3) / 0.7);
      this.updateCriticalParticlePositions(visual, particleProgress);
    } else {
      visual.particles.visible = false;
    }

    const billboardProgress = Math.min(1, visual.elapsed / CRITICAL_BILLBOARD_LIFETIME);
    if (billboardProgress < 1) {
      const alpha = Math.sin(billboardProgress * Math.PI);
      const scale = 3 + visual.elapsed * 2;
      const [first, second] = visual.billboards;
      first.visible = true;
      second.visible = true;
      first.scale.setScalar(scale);
      second.scale.setScalar(scale);
      first.material.opacity = alpha;
      second.material.opacity = alpha;
      // TMEffectBillBoard particle types 14/15 rotate in opposite directions.
      first.rotation.set(0, 0, 0.05 + billboardProgress * Math.PI * 0.1);
      second.rotation.set(0, Math.PI / 2, -0.05 - billboardProgress * Math.PI * 0.1);
    } else {
      this.deactivateCriticalVisual(visual);
    }
  }

  private updateCriticalParticlePositions(visual: ClassicCriticalVisual, progress: number): void {
    // Particle type 13 moves rapidly for the first 20%, then leaves a short
    // trailing push for the remainder of its 300 ms lifetime.
    const distance = progress < 0.2 ? progress * 10 : 2 + progress * 0.3;
    const positions = visual.particlePositions.array as Float32Array;
    for (let index = 0; index < CRITICAL_PARTICLE_COUNT; index++) {
      const offset = index * 3;
      positions[offset] = visual.particleDirections[offset]! * distance;
      positions[offset + 1] = visual.particleDirections[offset + 1]! * distance;
      positions[offset + 2] = visual.particleDirections[offset + 2]! * distance;
    }
    visual.particlePositions.needsUpdate = true;
  }

  private deactivateCriticalVisual(visual: ClassicCriticalVisual): void {
    visual.active = false;
    visual.group.visible = false;
    visual.core.visible = false;
    visual.shade.visible = false;
    visual.particles.visible = false;
    visual.billboards[0].visible = false;
    visual.billboards[1].visible = false;
  }

  private materials(color: number): { shaft: THREE.MeshBasicMaterial; tip: THREE.MeshBasicMaterial } {
    let entry = this.#materials.get(color);
    if (!entry) {
      entry = {
        shaft: new THREE.MeshBasicMaterial({ color, toneMapped: false }),
        tip: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), toneMapped: false }),
      };
      this.#materials.set(color, entry);
    }
    return entry;
  }
}

function disposeCriticalVisual(visual: ClassicCriticalVisual): void {
  visual.group.removeFromParent();
  visual.core.material.dispose();
  visual.shade.material.dispose();
  visual.billboards[0].material.dispose();
  visual.billboards[1].material.dispose();
  visual.particles.geometry.dispose();
  visual.particles.material.dispose();
  visual.group.clear();
}

function createCriticalVisual(resources: ClassicCriticalResources, poolIndex: number): ClassicCriticalVisual {
  const group = new THREE.Group();
  group.name = `classic-critical-impact-${poolIndex}`;
  group.visible = false;

  const coreMaterial = additiveMaterial(resources.coreTexture, CRITICAL_CORE, 0.5);
  const core = new THREE.Mesh(resources.meshGeometry, coreMaterial);
  core.name = "classic-critical-core-531";
  // TMMesh applies the common -90° DirectX pitch plus a +90° roll. parseMsa
  // reflects Z for Three's right-handed coordinates, reversing that pitch.
  core.rotation.set(Math.PI / 2, 0, Math.PI / 2, "YXZ");
  core.renderOrder = 8;

  const shadeMaterial = additiveMaterial(resources.shadeTexture, CRITICAL_RED);
  const shade = new THREE.Mesh(resources.planeGeometry, shadeMaterial);
  shade.name = "classic-critical-shade-118";
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -0.8;
  shade.scale.setScalar(5.5);
  shade.renderOrder = 7;

  const firstBillboardMaterial = additiveMaterial(resources.billboardTexture, CRITICAL_RED);
  const secondBillboardMaterial = additiveMaterial(resources.billboardTexture, CRITICAL_RED);
  const firstBillboard = new THREE.Mesh(resources.planeGeometry, firstBillboardMaterial);
  const secondBillboard = new THREE.Mesh(resources.planeGeometry, secondBillboardMaterial);
  firstBillboard.name = "classic-critical-cross-230-a";
  secondBillboard.name = "classic-critical-cross-230-b";
  firstBillboard.renderOrder = 9;
  secondBillboard.renderOrder = 9;

  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new THREE.BufferAttribute(new Float32Array(CRITICAL_PARTICLE_COUNT * 3), 3);
  particlePositions.setUsage(THREE.DynamicDrawUsage);
  particleGeometry.setAttribute("position", particlePositions);
  const particleDirections = classicParticleDirections(poolIndex);
  const particleMaterial = new THREE.PointsMaterial({
    map: resources.particleTexture,
    color: CRITICAL_RED,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    size: 0.38,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = "classic-critical-particles-231";
  particles.frustumCulled = false;
  particles.renderOrder = 10;

  group.add(shade, core, firstBillboard, secondBillboard, particles);
  return {
    group,
    core,
    shade,
    billboards: [firstBillboard, secondBillboard],
    particles,
    particlePositions,
    particleDirections,
    active: false,
    elapsed: 0,
    serial: 0,
  };
}

function additiveMaterial(texture: THREE.Texture, color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function classicParticleDirections(seed: number): Float32Array {
  const directions = new Float32Array(CRITICAL_PARTICLE_COUNT * 3);
  let state = (0x9e3779b9 ^ Math.imul(seed + 1, 0x85ebca6b)) >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = 0; index < CRITICAL_PARTICLE_COUNT; index++) {
    const offset = index * 3;
    const angle = random() * Math.PI * 2;
    const elevation = (random() - 0.35) * Math.PI * 0.72;
    const speed = 0.28 + random() * 0.72;
    const horizontal = Math.cos(elevation) * speed;
    directions[offset] = Math.cos(angle) * horizontal;
    directions[offset + 1] = Math.sin(elevation) * speed;
    directions[offset + 2] = Math.sin(angle) * horizontal;
  }
  return directions;
}
