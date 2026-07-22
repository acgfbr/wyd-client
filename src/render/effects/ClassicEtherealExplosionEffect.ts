import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";

const PROJECTILE_POOL_LIMIT = 64;
const IMPACT_POOL_LIMIT = 64;
const TRAIL_POOL_LIMIT = 384;
const TRAIL_SPAWN_INTERVAL_SECONDS = 1 / 60;
const TRAIL_LIFETIME_SECONDS = 1;
const BEAM_RELEASE_SECONDS = 0.1;
const BEAM_WIDTH = 0.1;
const BEAM_START_PROGRESS = 0.2;
const MAX_ARROW_LIFETIME_SECONDS = 5;
const IMPACT_SHADE_LIFETIME_SECONDS = 0.8;
const IMPACT_BILLBOARD_LIFETIME_SECONDS = 0.7;
const EFFECT_FRAME_SECONDS = 0.08;
const EFFECT_FRAME_INDICES = [101, 102, 103, 104] as const;
const FORWARD = new THREE.Vector3(0, 0, -1);

type ProjectileState = "inactive" | "flying" | "releasing";

interface EtherealResources {
  readonly bladeGeometry: THREE.BufferGeometry;
  readonly bladeTexture: THREE.Texture;
  readonly auraGeometry: THREE.BufferGeometry;
  readonly auraFrames: readonly [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];
  readonly beamTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly impactTexture: THREE.Texture;
  readonly trailTexture: THREE.Texture;
}

interface EtherealProjectileVisual {
  readonly root: THREE.Group;
  readonly blade: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly aura: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly current: THREE.Vector3;
  readonly beamHead: THREE.Vector3;
  readonly beamTail: THREE.Vector3;
  readonly releaseHead: THREE.Vector3;
  readonly releaseTail: THREE.Vector3;
  state: ProjectileState;
  elapsed: number;
  duration: number;
  releaseElapsed: number;
  trailAccumulator: number;
  trailSequence: number;
  serial: number;
  onImpact: (() => void) | null;
}

interface EtherealImpactVisual {
  readonly root: THREE.Group;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly billboards: readonly [THREE.Sprite, THREE.Sprite];
  active: boolean;
  elapsed: number;
  serial: number;
}

interface EtherealTrailVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  baseScale: number;
  serial: number;
}

/**
 * Exact presentation of Huntress #86's TMArrow type 152, level 2.
 *
 * `origin` and `destination` are the actual 3D projectile points used by the
 * classic client. `onImpact` is resolved exactly once. Disabling/clearing the
 * FX resolves pending callbacks synchronously so presentation can never stall
 * combat damage.
 */
export class ClassicEtherealExplosionEffect {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new DDSLoader();
  readonly #projectiles: EtherealProjectileVisual[] = [];
  readonly #impacts: EtherealImpactVisual[] = [];
  readonly #trails: EtherealTrailVisual[] = [];
  readonly #impactPlaneGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackBladeGeometry = createFallbackBladeGeometry();
  readonly #fallbackAuraGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.68, 8, 1, true);
  readonly #fallbackGlow = createFallbackGlowTexture();
  #resources: EtherealResources | null = null;
  #preload: Promise<void> | null = null;
  #clockSeconds = 0;
  #serial = 0;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.#owner = scene;
    this.object.name = "classic-huntress-ethereal-explosion";
    scene.add(this.object);
  }

  /** Loads meshes 28/863 and retail effect/model textures once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }
        this.#resources = resources;
        for (const visual of this.#projectiles) this.applyProjectileAssets(visual);
        for (const visual of this.#impacts) this.applyImpactAssets(visual);
        for (const visual of this.#trails) this.applyTrailAssets(visual);
      })
      .catch((error: unknown) => {
        console.warn("Explosão Etérea clássica indisponível; usando fallback 3D.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  playEtherealExplosion(
    origin: THREE.Vector3,
    destination: THREE.Vector3,
    onImpact: () => void,
  ): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(origin) || !isFiniteVector(destination)) {
      onImpact();
      return;
    }

    const distance = origin.distanceTo(destination);
    // TMArrow truncates fLength before multiplying and clamps its lifetime to
    // [1, 5000] ms. Level 2 type 152 uses exactly 70 ms per whole unit.
    const durationMilliseconds = Math.min(
      MAX_ARROW_LIFETIME_SECONDS * 1_000,
      Math.max(1, Math.floor(distance) * 70),
    );
    const duration = durationMilliseconds / 1_000;
    const acquired = this.acquireProjectileVisual();
    const visual = acquired.visual;
    visual.from.copy(origin);
    visual.to.copy(destination);
    visual.current.copy(origin);
    visual.beamHead.copy(origin);
    visual.beamTail.copy(origin);
    visual.releaseHead.copy(origin);
    visual.releaseTail.copy(origin);
    visual.state = "flying";
    visual.elapsed = 0;
    visual.duration = duration;
    visual.releaseElapsed = 0;
    visual.trailAccumulator = 0;
    visual.trailSequence = 0;
    visual.serial = ++this.#serial;
    visual.onImpact = onImpact;
    visual.root.visible = true;
    visual.blade.visible = true;
    visual.aura.visible = true;
    visual.beam.visible = false;
    this.orientProjectile(visual);
    this.applyProjectileAssets(visual);
    this.updateProjectilePosition(visual, 0);
    this.spawnTrail(visual.current, visual.serial + visual.trailSequence++);
    acquired.evictedImpact?.();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    for (const visual of this.#projectiles) {
      if (visual.state === "flying") this.updateFlyingProjectile(visual, delta);
      else if (visual.state === "releasing") this.updateReleasingProjectile(visual, delta);
    }
    for (const visual of this.#impacts) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateImpactVisual(visual);
    }
    for (const visual of this.#trails) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateTrailVisual(visual);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  /** Clears presentation and resolves every pending gameplay impact. */
  clear(): void {
    const pendingImpacts: Array<() => void> = [];
    for (const visual of this.#projectiles) {
      if (visual.onImpact) pendingImpacts.push(visual.onImpact);
      deactivateProjectile(visual);
    }
    for (const visual of this.#impacts) deactivateImpact(visual);
    for (const visual of this.#trails) deactivateTrail(visual);
    for (const impact of pendingImpacts) impact();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.object.removeFromParent();

    for (const visual of this.#projectiles) {
      visual.blade.material.dispose();
      visual.aura.material.dispose();
      visual.beam.material.dispose();
      visual.beam.geometry.dispose();
    }
    for (const visual of this.#impacts) {
      visual.shade.material.dispose();
      for (const billboard of visual.billboards) billboard.material.dispose();
    }
    for (const visual of this.#trails) visual.sprite.material.dispose();
    this.#projectiles.length = 0;
    this.#impacts.length = 0;
    this.#trails.length = 0;
    this.#impactPlaneGeometry.dispose();
    this.#fallbackBladeGeometry.dispose();
    this.#fallbackAuraGeometry.dispose();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.#owner.remove(this.object);
  }

  private acquireProjectileVisual(): {
    visual: EtherealProjectileVisual;
    evictedImpact: (() => void) | null;
  } {
    const free = this.#projectiles.find((visual) => visual.state === "inactive");
    if (free) return { visual: free, evictedImpact: null };
    if (this.#projectiles.length < PROJECTILE_POOL_LIMIT) {
      const visual = this.createProjectileVisual();
      this.#projectiles.push(visual);
      this.object.add(visual.root);
      return { visual, evictedImpact: null };
    }

    const oldest = oldestVisual(this.#projectiles);
    const evictedImpact = oldest.onImpact;
    deactivateProjectile(oldest);
    return { visual: oldest, evictedImpact };
  }

  private createProjectileVisual(): EtherealProjectileVisual {
    const root = new THREE.Group();
    root.name = `classic-ethereal-arrow-${this.#projectiles.length}`;
    root.visible = false;

    const bladeMaterial = new THREE.MeshBasicMaterial({
      color: 0x9a9a9a,
      transparent: true,
      opacity: 1,
      alphaTest: 0.2,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const blade = new THREE.Mesh(this.#fallbackBladeGeometry, bladeMaterial);
    blade.name = "classic-ethereal-mesh-863-sword01";
    blade.renderOrder = 7;
    root.add(blade);

    const auraMaterial = createBrightMaterial(this.#fallbackGlow, 0x001020);
    const aura = new THREE.Mesh(this.#fallbackAuraGeometry, auraMaterial);
    aura.name = "classic-ethereal-effect-mesh-28";
    aura.scale.setScalar(2);
    aura.renderOrder = 8;
    root.add(aura);

    const beamMaterial = createBrightMaterial(this.#fallbackGlow, 0x777777);
    beamMaterial.opacity = 0;
    const beam = new THREE.Mesh(createBeamGeometry(), beamMaterial);
    beam.name = "classic-ethereal-beam-texture-410";
    beam.frustumCulled = false;
    beam.renderOrder = 6;
    beam.visible = false;
    root.add(beam);

    return {
      root,
      blade,
      aura,
      beam,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      current: new THREE.Vector3(),
      beamHead: new THREE.Vector3(),
      beamTail: new THREE.Vector3(),
      releaseHead: new THREE.Vector3(),
      releaseTail: new THREE.Vector3(),
      state: "inactive",
      elapsed: 0,
      duration: 0.001,
      releaseElapsed: 0,
      trailAccumulator: 0,
      trailSequence: 0,
      serial: 0,
      onImpact: null,
    };
  }

  private applyProjectileAssets(visual: EtherealProjectileVisual): void {
    const resources = this.#resources;
    visual.blade.geometry = resources?.bladeGeometry ?? this.#fallbackBladeGeometry;
    setMaterialMap(visual.blade.material, resources?.bladeTexture ?? null);
    visual.blade.material.color.setHex(resources ? 0x9a9a9a : 0x79bfff);
    visual.aura.geometry = resources?.auraGeometry ?? this.#fallbackAuraGeometry;
    const frame = Math.floor((this.#clockSeconds % (EFFECT_FRAME_SECONDS * 4)) / EFFECT_FRAME_SECONDS);
    setMaterialMap(visual.aura.material, resources?.auraFrames[frame] ?? this.#fallbackGlow);
    setMaterialMap(visual.beam.material, resources?.beamTexture ?? this.#fallbackGlow);
  }

  private orientProjectile(visual: EtherealProjectileVisual): void {
    const flatDirection = visual.to.clone().sub(visual.from);
    flatDirection.y = 0;
    if (flatDirection.lengthSq() <= 1e-10) flatDirection.copy(FORWARD);
    else flatDirection.normalize();
    visual.blade.quaternion.setFromUnitVectors(FORWARD, flatDirection);
    visual.aura.quaternion.copy(visual.blade.quaternion);
    // TMEffectMesh receives m_fAngle + 180° while sword01 receives m_fAngle - 90°.
    visual.aura.rotateY(Math.PI);
  }

  private updateFlyingProjectile(visual: EtherealProjectileVisual, delta: number): void {
    visual.elapsed += delta;
    const progress = Math.min(1, visual.elapsed / visual.duration);
    this.updateProjectilePosition(visual, progress);

    const frame = Math.floor((this.#clockSeconds % (EFFECT_FRAME_SECONDS * 4)) / EFFECT_FRAME_SECONDS);
    setMaterialMap(visual.aura.material, this.#resources?.auraFrames[frame] ?? this.#fallbackGlow);

    visual.trailAccumulator += delta;
    let emitted = 0;
    while (visual.trailAccumulator >= TRAIL_SPAWN_INTERVAL_SECONDS && emitted < 6) {
      visual.trailAccumulator -= TRAIL_SPAWN_INTERVAL_SECONDS;
      this.spawnTrail(visual.current, visual.serial + visual.trailSequence++);
      emitted++;
    }

    if (progress < 1) return;
    this.beginProjectileImpact(visual);
  }

  private updateProjectilePosition(visual: EtherealProjectileVisual, progress: number): void {
    visual.current.lerpVectors(visual.from, visual.to, progress);
    // TMArrow.cpp:528 — sin(progress * 180° * 4) * 0.1.
    visual.current.y += Math.sin(progress * Math.PI * 4) * 0.1;
    visual.blade.position.copy(visual.current);
    visual.aura.position.copy(visual.current);

    visual.beamHead.copy(visual.current);
    visual.beamTail.lerpVectors(visual.from, visual.to, progress / 3);
    updateBeamGeometry(visual.beam.geometry, visual.beamHead, visual.beamTail, BEAM_WIDTH);
    visual.beam.visible = progress > BEAM_START_PROGRESS;
    // The retail beam is born with arrowLifetime + 2000 ms and m_nFade=1.
    const beamProgress = visual.elapsed / (visual.duration + 2);
    visual.beam.material.opacity = Math.max(0, Math.sin(Math.min(1, beamProgress) * Math.PI));
  }

  private beginProjectileImpact(visual: EtherealProjectileVisual): void {
    this.playImpact(visual.to);
    visual.blade.visible = false;
    visual.aura.visible = false;
    visual.releaseHead.copy(visual.beamHead);
    visual.releaseTail.copy(visual.beamTail);
    visual.state = "releasing";
    visual.releaseElapsed = 0;

    const impact = visual.onImpact;
    visual.onImpact = null;
    impact?.();
    this.updateReleaseBeam(visual);
  }

  private updateReleasingProjectile(visual: EtherealProjectileVisual, delta: number): void {
    visual.releaseElapsed += delta;
    if (visual.releaseElapsed >= BEAM_RELEASE_SECONDS) {
      deactivateProjectile(visual);
      return;
    }
    this.updateReleaseBeam(visual);
  }

  private updateReleaseBeam(visual: EtherealProjectileVisual): void {
    const progress = Math.min(1, visual.releaseElapsed / BEAM_RELEASE_SECONDS);
    visual.beamHead.copy(visual.releaseHead);
    visual.beamTail.lerpVectors(visual.releaseTail, visual.releaseHead, progress);
    updateBeamGeometry(visual.beam.geometry, visual.beamHead, visual.beamTail, BEAM_WIDTH);
    const shortenedLifetime = visual.duration + BEAM_RELEASE_SECONDS;
    const fadeProgress = Math.min(1, (visual.duration + visual.releaseElapsed) / shortenedLifetime);
    visual.beam.material.opacity = Math.max(0, Math.sin(fadeProgress * Math.PI));
  }

  private playImpact(position: THREE.Vector3): void {
    const visual = this.acquireImpactVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(position);
    visual.root.visible = true;
    this.applyImpactAssets(visual);
    this.updateImpactVisual(visual);
  }

  private acquireImpactVisual(): EtherealImpactVisual {
    const free = this.#impacts.find((visual) => !visual.active);
    if (free) return free;
    if (this.#impacts.length < IMPACT_POOL_LIMIT) {
      const visual = this.createImpactVisual();
      this.#impacts.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestVisual(this.#impacts);
    deactivateImpact(oldest);
    return oldest;
  }

  private createImpactVisual(): EtherealImpactVisual {
    const root = new THREE.Group();
    root.name = `classic-ethereal-impact-${this.#impacts.length}`;
    root.visible = false;

    const shade = new THREE.Mesh(
      this.#impactPlaneGeometry,
      createBrightMaterial(this.#fallbackGlow, 0x003377),
    );
    shade.name = "classic-ethereal-impact-shade-texture-7";
    shade.rotation.x = -Math.PI / 2;
    // FieldScene aims arrows at actorHeight + .5; TMShade projects back onto ground.
    shade.position.y = -0.465;
    shade.scale.set(4, 4, 1);
    shade.renderOrder = 4;
    root.add(shade);

    const white = createBrightSprite(this.#fallbackGlow, 0xffffff, "classic-ethereal-impact-white");
    const blue = createBrightSprite(this.#fallbackGlow, 0x003377, "classic-ethereal-impact-blue");
    root.add(white, blue);
    return { root, shade, billboards: [white, blue], active: false, elapsed: 0, serial: 0 };
  }

  private applyImpactAssets(visual: EtherealImpactVisual): void {
    const shadeTexture = this.#resources?.shadeTexture ?? this.#fallbackGlow;
    const impactTexture = this.#resources?.impactTexture ?? this.#fallbackGlow;
    setMaterialMap(visual.shade.material, shadeTexture);
    for (const billboard of visual.billboards) setMaterialMap(billboard.material, impactTexture);
  }

  private updateImpactVisual(visual: EtherealImpactVisual): void {
    if (visual.elapsed >= IMPACT_SHADE_LIFETIME_SECONDS) {
      deactivateImpact(visual);
      return;
    }

    const shadeProgress = Math.min(1, visual.elapsed / IMPACT_SHADE_LIFETIME_SECONDS);
    visual.shade.visible = true;
    visual.shade.material.opacity = Math.max(0, Math.sin(shadeProgress * Math.PI));
    const billboardProgress = Math.min(1, visual.elapsed / IMPACT_BILLBOARD_LIFETIME_SECONDS);
    const billboardOpacity = Math.max(0, Math.sin(billboardProgress * Math.PI));
    for (let index = 0; index < visual.billboards.length; index++) {
      const billboard = visual.billboards[index]!;
      billboard.visible = visual.elapsed < IMPACT_BILLBOARD_LIFETIME_SECONDS;
      billboard.material.opacity = billboardOpacity;
      // TMEffectBillBoard scale velocity .001 units/ms = +1 unit/s.
      const baseScale = index * 0.2 + 0.5;
      billboard.scale.setScalar(baseScale + visual.elapsed);
    }
  }

  private spawnTrail(position: THREE.Vector3, sequence: number): void {
    const visual = this.acquireTrailVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.baseScale = (Math.abs(sequence) % 5) * 0.2 + 0.2;
    visual.sprite.position.copy(position);
    visual.sprite.position.y -= 0.5;
    visual.sprite.scale.setScalar(visual.baseScale);
    visual.sprite.material.opacity = 0;
    visual.sprite.visible = true;
    this.applyTrailAssets(visual);
  }

  private acquireTrailVisual(): EtherealTrailVisual {
    const free = this.#trails.find((visual) => !visual.active);
    if (free) return free;
    if (this.#trails.length < TRAIL_POOL_LIMIT) {
      const sprite = createBrightSprite(this.#fallbackGlow, 0xaaaaee, `classic-ethereal-trail-${this.#trails.length}`);
      const visual = { sprite, active: false, elapsed: 0, baseScale: 0.2, serial: 0 };
      this.#trails.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestVisual(this.#trails);
    deactivateTrail(oldest);
    return oldest;
  }

  private applyTrailAssets(visual: EtherealTrailVisual): void {
    setMaterialMap(visual.sprite.material, this.#resources?.trailTexture ?? this.#fallbackGlow);
  }

  private updateTrailVisual(visual: EtherealTrailVisual): void {
    if (visual.elapsed >= TRAIL_LIFETIME_SECONDS) {
      deactivateTrail(visual);
      return;
    }
    const progress = visual.elapsed / TRAIL_LIFETIME_SECONDS;
    visual.sprite.material.opacity = Math.max(0, Math.sin(progress * Math.PI));
    visual.sprite.scale.setScalar(visual.baseScale + visual.elapsed);
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<EtherealResources> {
    const [auraSource, bladeSource] = await Promise.all([assets.loadModel(28), assets.loadModel(863)]);
    if (!auraSource || !bladeSource) throw new Error("Modelos clássicos 28/863 ausentes do manifesto");
    const bladeTextureFile = bladeSource.textures[0];
    if (!bladeTextureFile) throw new Error("Textura sword01 do modelo 863 ausente do manifesto");

    const loadedTextures: THREE.Texture[] = [];
    let bladeGeometry: THREE.BufferGeometry | null = null;
    let auraGeometry: THREE.BufferGeometry | null = null;
    try {
      const textureIndices = [0, 7, 56, ...EFFECT_FRAME_INDICES, 410] as const;
      const textureResults = await Promise.allSettled([
        ...textureIndices.map((index) => this.loadEffectTexture(assets, index)),
        this.loadDds(assets.dataUrl(bladeTextureFile)),
      ]);
      for (const result of textureResults) {
        if (result.status === "fulfilled") loadedTextures.push(result.value);
      }
      const failure = textureResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
      const textures = textureResults.map(
        (result) => (result as PromiseFulfilledResult<THREE.Texture>).value,
      );
      const effectTextures = textures.slice(0, textureIndices.length);
      const bladeTexture = textures.at(-1)!;
      bladeGeometry = parseMsa(bladeSource.buffer).geometry;
      auraGeometry = parseMsa(auraSource.buffer).geometry;

      const [trailTexture, shadeTexture, impactTexture, frame101, frame102, frame103, frame104, beamTexture] = effectTextures;
      configureClassicBillboardUvs(trailTexture!);
      configureClassicBillboardUvs(impactTexture!);
      return {
        bladeGeometry,
        bladeTexture,
        auraGeometry,
        auraFrames: [frame101!, frame102!, frame103!, frame104!],
        beamTexture: beamTexture!,
        shadeTexture: shadeTexture!,
        impactTexture: impactTexture!,
        trailTexture: trailTexture!,
      };
    } catch (error) {
      bladeGeometry?.dispose();
      auraGeometry?.dispose();
      for (const texture of loadedTextures) texture.dispose();
      throw error;
    }
  }

  private async loadEffectTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    return this.loadDds(url);
  }

  private async loadDds(url: string): Promise<THREE.Texture> {
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createBeamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0.02, 0.98, 0.98, 0.98, 0.98, 0.02, 0.02, 0.02,
    0.02, 0.98, 0.98, 0.98, 0.98, 0.02, 0.02, 0.02,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

function updateBeamGeometry(
  geometry: THREE.BufferGeometry,
  head: THREE.Vector3,
  tail: THREE.Vector3,
  width: number,
): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  position.setXYZ(0, head.x, head.y - width, head.z);
  position.setXYZ(1, tail.x, tail.y - width, tail.z);
  position.setXYZ(2, tail.x, tail.y + width, tail.z);
  position.setXYZ(3, head.x, head.y + width, head.z);
  position.setXYZ(4, head.x - width, head.y, head.z);
  position.setXYZ(5, tail.x - width, tail.y, tail.z);
  position.setXYZ(6, tail.x + width, tail.y, tail.z);
  position.setXYZ(7, head.x + width, head.y, head.z);
  position.needsUpdate = true;
}

function createBrightMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

function createBrightSprite(texture: THREE.Texture, color: number, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.renderOrder = 8;
  return sprite;
}

function setMaterialMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture | null,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function deactivateProjectile(visual: EtherealProjectileVisual): void {
  visual.state = "inactive";
  visual.elapsed = 0;
  visual.releaseElapsed = 0;
  visual.onImpact = null;
  visual.root.visible = false;
  visual.blade.visible = false;
  visual.aura.visible = false;
  visual.beam.visible = false;
  visual.beam.material.opacity = 0;
}

function deactivateImpact(visual: EtherealImpactVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.shade.visible = false;
  visual.shade.material.opacity = 0;
  for (const billboard of visual.billboards) {
    billboard.visible = false;
    billboard.material.opacity = 0;
  }
}

function deactivateTrail(visual: EtherealTrailVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
  visual.sprite.material.opacity = 0;
}

function oldestVisual<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

function configureClassicBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
}

function createFallbackBladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(0.09, 0.045, 0.68);
  geometry.translate(0, 0, -0.22);
  return geometry;
}

function createFallbackGlowTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const intensity = Math.max(0, 1 - Math.hypot(dx, dy));
      const value = Math.round(255 * intensity * intensity);
      const offset = (x + y * size) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = value;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "classic-ethereal-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeResources(resources: EtherealResources): void {
  resources.bladeGeometry.dispose();
  resources.auraGeometry.dispose();
  const textures = new Set<THREE.Texture>([
    resources.bladeTexture,
    resources.beamTexture,
    resources.shadeTexture,
    resources.impactTexture,
    resources.trailTexture,
    ...resources.auraFrames,
  ]);
  for (const texture of textures) texture.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
