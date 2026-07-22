import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const METEOR_POOL_LIMIT = 64;
// One normal Inferno can retain roughly 550 trail sprites at 120 Hz. Keeping
// 1024 remains bounded while avoiding premature recycling on high-refresh UI.
const TRAIL_POOL_LIMIT = 1_024;
const IMPACT_POOL_LIMIT = 64;
const GROUND_FLASH_POOL_LIMIT = 64;
const SHADE_POOL_LIMIT = 64;

// The fallback start offset has length sqrt(3²+5²+3²) = sqrt(43). Retail
// truncates that length to uint(6) before multiplying by 100 ms: exactly 600 ms.
const METEOR_LIFETIME_SECONDS = 0.6;
const TRAIL_PRIMARY_LIFETIME_SECONDS = 1;
const TRAIL_SECONDARY_LIFETIME_SECONDS = 0.8;
const TRAIL_GROWTH_PER_SECOND = 1;
const IMPACT_LIFETIME_SECONDS = 0.999;
const IMPACT_FRAME_SECONDS = 0.111;
const IMPACT_GROWTH_PER_SECOND = 4;
const GROUND_FLASH_LIFETIME_SECONDS = 0.5;
const GROUND_FLASH_GROWTH_PER_SECOND = 10;
const SHADE_LIFETIME_SECONDS = 1.5;
const BILLBOARD_VISIBLE_FRACTION = 0.05;

const METEOR_ORANGE = 0xff7711;
const METEOR_YELLOW = 0xffff28;
const IMPACT_FRAME_INDICES = [33, 34, 35, 36, 37, 38, 39, 40, 41] as const;
const REQUIRED_TEXTURE_INDICES = [
  0,
  7,
  8,
  ...IMPACT_FRAME_INDICES,
  59,
] as const;

export type ClassicFoemaMeteorSkillIndex = 35 | 39;

type MeteorLevel = 0 | 4;
type RequiredTextureIndex = (typeof REQUIRED_TEXTURE_INDICES)[number];

interface ClassicFoemaMeteorResources {
  readonly primaryTrailTexture: THREE.Texture;
  readonly secondaryTrailTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly groundFlashTexture: THREE.Texture;
  readonly impactFrames: readonly THREE.Texture[];
  readonly verticallyFlippedImpactFrames: readonly THREE.Texture[];
}

interface MeteorVisual {
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  level: MeteorLevel;
  serial: number;
}

interface TrailVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScale: number;
  color: number;
  bright: boolean;
  serial: number;
}

interface ImpactVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  baseScaleX: number;
  baseScaleY: number;
  serial: number;
}

interface GroundFlashVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  color: number;
  serial: number;
}

interface ShadeVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  color: number;
  serial: number;
}

/**
 * Presentation-only port of Foema #35 Meteor Storm and normal #39 Inferno.
 *
 * Public positions are target feet in Three.js world space. The retail +1 Y
 * target offset, diagonal start, corner layout and per-meteor delays are all
 * applied internally. Gameplay, damage, targeting and sounds 160/152 remain
 * with the caller. The packet-104 `bomb` variant of #39 is intentionally not
 * part of this renderer.
 */
export class ClassicFoemaMeteorEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #meteors: MeteorVisual[] = [];
  readonly #meteorUpdateOrder: MeteorVisual[] = [];
  readonly #trails: TrailVisual[] = [];
  readonly #impacts: ImpactVisual[] = [];
  readonly #groundFlashes: GroundFlashVisual[] = [];
  readonly #shades: ShadeVisual[] = [];
  #resources: ClassicFoemaMeteorResources | null = null;
  #preload: Promise<void> | null = null;
  #clockSeconds = 0;
  #lastTrailEmissionAt = Number.NEGATIVE_INFINITY;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-meteor-effects";
    parent.add(this.object);
  }

  /** Loads retail EffectTextureList entries 0, 7, 8, 33..41 and 59. */
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
      })
      .catch((error: unknown) => {
        console.warn("Efeitos clássicos #35/#39 da Foema indisponíveis.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Dispatches one retail skill visual at the packet-time target snapshot. */
  play(classicIndex: ClassicFoemaMeteorSkillIndex, targetFeet: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(targetFeet)
      || (classicIndex !== 35 && classicIndex !== 39)
    ) {
      return false;
    }

    if (classicIndex === 35) {
      this.spawnMeteor(targetFeet.x, targetFeet.y, targetFeet.z, 0, 0);
      return true;
    }

    // TMFieldScene creates the four corners first, in this exact order, then
    // the center. Classic +Z is scene -Z, hence the inverted row offsets.
    const corners = [
      [-1.8, 1.8, 0],
      [1.8, 1.8, 0.2],
      [-1.8, -1.8, 0.4],
      [1.8, -1.8, 0.6],
    ] as const;
    for (const [offsetX, offsetZ, delay] of corners) {
      this.spawnMeteor(
        targetFeet.x + offsetX,
        targetFeet.y,
        targetFeet.z + offsetZ,
        4,
        delay,
      );
    }
    this.spawnMeteor(targetFeet.x, targetFeet.y, targetFeet.z, 4, 0.27);
    return true;
  }

  playMeteorStorm(targetFeet: THREE.Vector3): boolean {
    return this.play(35, targetFeet);
  }

  playInferno(targetFeet: THREE.Vector3): boolean {
    return this.play(39, targetFeet);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    // Existing children advance before controllers emit this frame. Newly
    // created trails and impacts therefore start at retail elapsed time zero.
    this.updateTrails(delta);
    this.updateImpacts(delta);
    this.updateGroundFlashes(delta);
    this.updateShades(delta);
    this.updateMeteors(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const meteor of this.#meteors) deactivateMeteor(meteor);
    this.#meteorUpdateOrder.length = 0;
    for (const trail of this.#trails) deactivateTrail(trail);
    for (const impact of this.#impacts) deactivateImpact(impact);
    for (const flash of this.#groundFlashes) deactivateGroundFlash(flash);
    for (const shade of this.#shades) deactivateShade(shade);
    this.#lastTrailEmissionAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const trail of this.#trails) trail.sprite.material.dispose();
    for (const impact of this.#impacts) impact.sprite.material.dispose();
    for (const flash of this.#groundFlashes) flash.mesh.material.dispose();
    for (const shade of this.#shades) shade.mesh.material.dispose();
    this.#meteors.length = 0;
    this.#trails.length = 0;
    this.#impacts.length = 0;
    this.#groundFlashes.length = 0;
    this.#shades.length = 0;
    this.#planeGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private spawnMeteor(
    targetX: number,
    targetFeetY: number,
    targetZ: number,
    level: MeteorLevel,
    delaySeconds: number,
  ): void {
    const meteor = this.acquireMeteor();
    meteor.active = true;
    meteor.elapsed = -delaySeconds;
    meteor.level = level;
    meteor.serial = ++this.#serial;
    meteor.target.set(targetX, targetFeetY + 1, targetZ);
    // TMSkillMeteorStorm's zero-start fallback is target +(3,+5,-3).
    // Reflecting classic Z into scene space changes the last term to +3.
    meteor.start.set(targetX + 3, targetFeetY + 6, targetZ + 3);
    meteor.position.copy(meteor.start);
  }

  private acquireMeteor(): MeteorVisual {
    const free = this.#meteors.find((meteor) => !meteor.active);
    if (free) return free;
    if (this.#meteors.length < METEOR_POOL_LIMIT) {
      const meteor: MeteorVisual = {
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        level: 0,
        serial: 0,
      };
      this.#meteors.push(meteor);
      return meteor;
    }
    const oldest = oldestBySerial(this.#meteors);
    deactivateMeteor(oldest);
    return oldest;
  }

  private updateMeteors(delta: number): void {
    this.#meteorUpdateOrder.length = 0;
    for (const meteor of this.#meteors) {
      if (meteor.active) this.#meteorUpdateOrder.push(meteor);
    }
    // EffectContainer::AddChild inserts at the head, so retail advances the
    // newest MeteorStorm first. This order decides who receives the shared
    // 2/4-particle burst when multiple Inferno controllers are alive.
    this.#meteorUpdateOrder.sort((left, right) => right.serial - left.serial);
    for (const meteor of this.#meteorUpdateOrder) {
      meteor.elapsed += delta;
      if (meteor.elapsed < 0) continue;

      if (meteor.elapsed >= METEOR_LIFETIME_SECONDS) {
        // The destructor uses the last sampled flight Y, not target Y. This is
        // observable after a long frame and is intentionally preserved.
        this.spawnImpact(meteor);
        deactivateMeteor(meteor);
        continue;
      }

      const progress = meteor.elapsed / METEOR_LIFETIME_SECONDS;
      meteor.position.lerpVectors(meteor.start, meteor.target, progress);
      const totalEffects = this.consumeSharedTrailBurst();
      for (let index = 0; index < totalEffects; index++) {
        this.spawnTrailPair(meteor.position, index);
      }
    }
  }

  private consumeSharedTrailBurst(): 1 | 2 | 4 {
    const elapsed = this.#clockSeconds - this.#lastTrailEmissionAt;
    const count = elapsed < 0.02 ? 1 : elapsed < 0.03 ? 2 : 4;
    // Retail's function-static timestamp is shared by every MeteorStorm.
    this.#lastTrailEmissionAt = this.#clockSeconds;
    return count;
  }

  private spawnTrailPair(position: THREE.Vector3, burstIndex: number): void {
    const random = classicRandomStep(++this.#randomSerial, 5);
    const baseScale = 0.4 + random * 0.1;
    this.spawnTrail({
      positionX: position.x + random * 0.01,
      positionY: position.y - 0.7 + random * 0.01,
      // Classic +Z becomes scene -Z.
      positionZ: position.z - random * 0.01,
      lifetime: TRAIL_PRIMARY_LIFETIME_SECONDS,
      baseScale,
      color: METEOR_ORANGE,
      bright: true,
      secondary: false,
    });
    this.spawnTrail({
      positionX: position.x - 0.01,
      positionY: position.y - 0.5,
      positionZ: position.z + 0.01,
      lifetime: TRAIL_SECONDARY_LIFETIME_SECONDS,
      baseScale,
      color: burstIndex === 3 ? METEOR_YELLOW : METEOR_ORANGE,
      bright: burstIndex !== 3,
      secondary: true,
    });
  }

  private spawnTrail(options: {
    readonly positionX: number;
    readonly positionY: number;
    readonly positionZ: number;
    readonly lifetime: number;
    readonly baseScale: number;
    readonly color: number;
    readonly bright: boolean;
    readonly secondary: boolean;
  }): void {
    const resources = this.#resources!;
    const trail = this.acquireTrail();
    trail.active = true;
    trail.elapsed = 0;
    trail.lifetime = options.lifetime;
    trail.baseScale = options.baseScale;
    trail.color = options.color;
    trail.bright = options.bright;
    trail.serial = ++this.#serial;
    trail.basePosition.set(options.positionX, options.positionY, options.positionZ);
    setMaterialMap(
      trail.sprite.material,
      options.secondary ? resources.secondaryTrailTexture : resources.primaryTrailTexture,
    );
    setClassicSpriteBlend(trail.sprite.material, options.bright);
    this.updateTrailVisual(trail);
  }

  private acquireTrail(): TrailVisual {
    const free = this.#trails.find((trail) => !trail.active);
    if (free) return free;
    if (this.#trails.length < TRAIL_POOL_LIMIT) {
      const sprite = createClassicSprite(
        this.#resources!.primaryTrailTexture,
        `classic-foema-meteor-trail-${this.#trails.length}`,
      );
      const trail: TrailVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        baseScale: 0.4,
        color: METEOR_ORANGE,
        bright: true,
        serial: 0,
      };
      this.#trails.push(trail);
      this.object.add(sprite);
      return trail;
    }
    const oldest = oldestBySerial(this.#trails);
    deactivateTrail(oldest);
    return oldest;
  }

  private updateTrails(delta: number): void {
    for (const trail of this.#trails) {
      if (!trail.active) continue;
      trail.elapsed += delta;
      this.updateTrailVisual(trail);
    }
  }

  private updateTrailVisual(trail: TrailVisual): void {
    if (trail.elapsed >= trail.lifetime) {
      deactivateTrail(trail);
      return;
    }

    const progress = trail.elapsed / trail.lifetime;
    const scale = trail.baseScale + trail.elapsed * TRAIL_GROWTH_PER_SECOND;
    trail.sprite.scale.set(scale, scale, 1);
    trail.sprite.position.copy(trail.basePosition);
    // m_bStickGround does not sample terrain; it raises the centered quad by
    // half of its current vertical scale.
    trail.sprite.position.y += scale / 2;
    trail.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    trail.sprite.material.color.setHex(trail.color).multiplyScalar(fade);
    // EF_BRIGHT selects texture alpha. EF_NONEBRIGHT modulates both packed RGB
    // and packed alpha, represented here by color plus material opacity.
    trail.sprite.material.opacity = trail.bright ? 1 : fade;
  }

  private spawnImpact(meteor: MeteorVisual): void {
    this.spawnImpactBillboard(meteor);
    this.spawnGroundFlash(meteor);
    this.spawnShade(meteor);
  }

  private spawnImpactBillboard(meteor: MeteorVisual): void {
    const impact = this.acquireImpact();
    impact.active = true;
    impact.elapsed = 0;
    impact.baseScaleX = meteor.level === 0 ? 3.5 : 1.5;
    impact.baseScaleY = meteor.level === 0 ? -1.5 : 1.5;
    impact.serial = ++this.#serial;
    impact.sprite.position.set(
      meteor.target.x,
      meteor.position.y - 1.5,
      meteor.target.z,
    );
    setMaterialMap(impact.sprite.material, this.#resources!.impactFrames[0]!);
    this.updateImpactVisual(impact);
  }

  private acquireImpact(): ImpactVisual {
    const free = this.#impacts.find((impact) => !impact.active);
    if (free) return free;
    if (this.#impacts.length < IMPACT_POOL_LIMIT) {
      const sprite = createClassicSprite(
        this.#resources!.impactFrames[0]!,
        `classic-foema-meteor-impact-${this.#impacts.length}`,
      );
      sprite.renderOrder = 9;
      const impact: ImpactVisual = {
        sprite,
        active: false,
        elapsed: 0,
        baseScaleX: 1.5,
        baseScaleY: 1.5,
        serial: 0,
      };
      this.#impacts.push(impact);
      this.object.add(sprite);
      return impact;
    }
    const oldest = oldestBySerial(this.#impacts);
    deactivateImpact(oldest);
    return oldest;
  }

  private updateImpacts(delta: number): void {
    for (const impact of this.#impacts) {
      if (!impact.active) continue;
      impact.elapsed += delta;
      this.updateImpactVisual(impact);
    }
  }

  private updateImpactVisual(impact: ImpactVisual): void {
    if (impact.elapsed >= IMPACT_LIFETIME_SECONDS) {
      deactivateImpact(impact);
      return;
    }

    const progress = impact.elapsed / IMPACT_LIFETIME_SECONDS;
    const frameIndex = Math.min(
      IMPACT_FRAME_INDICES.length - 1,
      Math.floor(impact.elapsed / IMPACT_FRAME_SECONDS),
    );
    const signedScaleY = impact.baseScaleY + impact.elapsed * IMPACT_GROWTH_PER_SECOND;
    // Three's Sprite shader takes the length of its scale columns, discarding
    // the negative sign. The mirrored frame preserves retail's initial
    // vertical flip while the signed object scale still collapses through 0.
    const frames = signedScaleY < 0
      ? this.#resources!.verticallyFlippedImpactFrames
      : this.#resources!.impactFrames;
    setMaterialMap(impact.sprite.material, frames[frameIndex]!);
    impact.sprite.material.color.setHex(0xffffff);
    impact.sprite.material.opacity = 1;
    impact.sprite.scale.set(
      impact.baseScaleX + impact.elapsed * IMPACT_GROWTH_PER_SECOND,
      signedScaleY,
      1,
    );
    impact.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
  }

  private spawnGroundFlash(meteor: MeteorVisual): void {
    const flash = this.acquireGroundFlash();
    flash.active = true;
    flash.elapsed = 0;
    flash.color = meteor.level === 0 ? 0xffffff : METEOR_ORANGE;
    flash.serial = ++this.#serial;
    flash.mesh.position.set(
      meteor.target.x,
      meteor.target.y - 0.6,
      meteor.target.z,
    );
    this.updateGroundFlashVisual(flash);
  }

  private acquireGroundFlash(): GroundFlashVisual {
    const free = this.#groundFlashes.find((flash) => !flash.active);
    if (free) return free;
    if (this.#groundFlashes.length < GROUND_FLASH_POOL_LIMIT) {
      const mesh = createBrightGroundPlane(
        this.#planeGeometry,
        this.#resources!.groundFlashTexture,
        `classic-foema-meteor-ground-flash-${this.#groundFlashes.length}`,
        Math.PI / 4,
        6,
      );
      const flash: GroundFlashVisual = {
        mesh,
        active: false,
        elapsed: 0,
        color: 0xffffff,
        serial: 0,
      };
      this.#groundFlashes.push(flash);
      this.object.add(mesh);
      return flash;
    }
    const oldest = oldestBySerial(this.#groundFlashes);
    deactivateGroundFlash(oldest);
    return oldest;
  }

  private updateGroundFlashes(delta: number): void {
    for (const flash of this.#groundFlashes) {
      if (!flash.active) continue;
      flash.elapsed += delta;
      this.updateGroundFlashVisual(flash);
    }
  }

  private updateGroundFlashVisual(flash: GroundFlashVisual): void {
    if (flash.elapsed >= GROUND_FLASH_LIFETIME_SECONDS) {
      deactivateGroundFlash(flash);
      return;
    }

    const progress = flash.elapsed / GROUND_FLASH_LIFETIME_SECONDS;
    const scale = 0.01 + flash.elapsed * GROUND_FLASH_GROWTH_PER_SECOND;
    flash.mesh.scale.set(scale, scale, 1);
    flash.mesh.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    setBrightIntensity(flash.mesh.material, flash.color, Math.sin(progress * Math.PI));
  }

  private spawnShade(meteor: MeteorVisual): void {
    const shade = this.acquireShade();
    shade.active = true;
    shade.elapsed = 0;
    shade.color = METEOR_ORANGE;
    shade.serial = ++this.#serial;
    shade.mesh.position.set(
      meteor.target.x,
      // TMShade conforms its grid to terrain at +0.05. A flat target-feet
      // snapshot is the renderer-local equivalent without a terrain sampler.
      meteor.target.y - 1 + 0.05,
      meteor.target.z,
    );
    const size = meteor.level === 0 ? 8 : 4;
    shade.mesh.scale.set(size, size, 1);
    shade.mesh.visible = true;
    setBrightIntensity(shade.mesh.material, shade.color, 0);
  }

  private acquireShade(): ShadeVisual {
    const free = this.#shades.find((shade) => !shade.active);
    if (free) return free;
    if (this.#shades.length < SHADE_POOL_LIMIT) {
      const mesh = createBrightGroundPlane(
        this.#planeGeometry,
        this.#resources!.shadeTexture,
        `classic-foema-meteor-shade-${this.#shades.length}`,
        0,
        5,
      );
      const shade: ShadeVisual = {
        mesh,
        active: false,
        elapsed: 0,
        color: METEOR_ORANGE,
        serial: 0,
      };
      this.#shades.push(shade);
      this.object.add(mesh);
      return shade;
    }
    const oldest = oldestBySerial(this.#shades);
    deactivateShade(oldest);
    return oldest;
  }

  private updateShades(delta: number): void {
    for (const shade of this.#shades) {
      if (!shade.active) continue;
      shade.elapsed += delta;
      if (shade.elapsed >= SHADE_LIFETIME_SECONDS) {
        deactivateShade(shade);
        continue;
      }
      const progress = shade.elapsed / SHADE_LIFETIME_SECONDS;
      setBrightIntensity(shade.mesh.material, shade.color, Math.sin(progress * Math.PI));
    }
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<ClassicFoemaMeteorResources> {
    const results = await Promise.allSettled(
      REQUIRED_TEXTURE_INDICES.map((index) => this.loadEffectTexture(assets, index)),
    );
    const loaded = new Map<RequiredTextureIndex, THREE.Texture>();
    let failure: unknown = null;
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      const textureIndex = REQUIRED_TEXTURE_INDICES[index]!;
      if (result.status === "fulfilled") loaded.set(textureIndex, result.value);
      else if (failure === null) failure = result.reason;
    }
    if (failure !== null || loaded.size !== REQUIRED_TEXTURE_INDICES.length) {
      for (const texture of loaded.values()) texture.dispose();
      throw failure ?? new Error("Texturas clássicas 0/7/8/33..41/59 incompletas");
    }

    try {
      const requireTexture = (index: RequiredTextureIndex): THREE.Texture => {
        const texture = loaded.get(index);
        if (!texture) throw new Error(`Textura de efeito ${index} não carregada`);
        return texture;
      };
      const primaryTrailTexture = requireTexture(0);
      const shadeTexture = requireTexture(7);
      const groundFlashTexture = requireTexture(8);
      const secondaryTrailTexture = requireTexture(59);
      const impactFrames = IMPACT_FRAME_INDICES.map((index) => requireTexture(index));

      configureClassicBillboardUvs(primaryTrailTexture, false);
      configureClassicBillboardUvs(secondaryTrailTexture, false);
      configureClassicGroundPlaneUvs(groundFlashTexture);
      for (const frame of impactFrames) configureClassicBillboardUvs(frame, true);
      const verticallyFlippedImpactFrames = impactFrames.map((frame, index) => {
        const flipped = frame.clone();
        flipped.name = `${frame.name || `effect-${IMPACT_FRAME_INDICES[index]!}`}-vertical-flip`;
        flipped.offset.set(0, 0);
        flipped.repeat.set(1, 1);
        flipped.needsUpdate = true;
        return flipped;
      });

      return {
        primaryTrailTexture,
        secondaryTrailTexture,
        shadeTexture,
        groundFlashTexture,
        impactFrames,
        verticallyFlippedImpactFrames,
      };
    } catch (error) {
      for (const texture of loaded.values()) texture.dispose();
      throw error;
    }
  }

  private async loadEffectTexture(
    assets: ClassicAssetSource,
    index: RequiredTextureIndex,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createClassicSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.visible = false;
  sprite.renderOrder = 7;
  return sprite;
}

function createBrightGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
  rotation: number,
  renderOrder: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.visible = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

function setClassicSpriteBlend(material: THREE.SpriteMaterial, bright: boolean): void {
  const destination = bright ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  if (material.blendDst === destination && material.blendDstAlpha === destination) return;
  material.blendDst = destination;
  material.blendDstAlpha = destination;
  material.needsUpdate = true;
}

function setMaterialMap(
  material: THREE.SpriteMaterial | THREE.MeshBasicMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setBrightIntensity(
  material: THREE.SpriteMaterial | THREE.MeshBasicMaterial,
  color: number,
  intensity: number,
): void {
  material.color
    .setHex(color & 0xffffff)
    .multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
  // EF_BRIGHT preserves texture alpha and carries its fade in diffuse RGB.
  material.opacity = 1;
}

function configureClassicBillboardUvs(texture: THREE.Texture, fullFrame: boolean): void {
  texture.offset.set(fullFrame ? 0 : 0.02, fullFrame ? 1 : 0.98);
  texture.repeat.set(fullFrame ? 1 : 0.96, fullFrame ? -1 : -0.96);
  texture.needsUpdate = true;
}

function configureClassicGroundPlaneUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.02);
  texture.repeat.set(0.96, 0.96);
  texture.needsUpdate = true;
}

function deactivateMeteor(meteor: MeteorVisual): void {
  meteor.active = false;
  meteor.elapsed = 0;
}

function deactivateTrail(trail: TrailVisual): void {
  trail.active = false;
  trail.elapsed = 0;
  trail.sprite.visible = false;
}

function deactivateImpact(impact: ImpactVisual): void {
  impact.active = false;
  impact.elapsed = 0;
  impact.sprite.visible = false;
}

function deactivateGroundFlash(flash: GroundFlashVisual): void {
  flash.active = false;
  flash.elapsed = 0;
  flash.mesh.visible = false;
}

function deactivateShade(shade: ShadeVisual): void {
  shade.active = false;
  shade.elapsed = 0;
  shade.mesh.visible = false;
}

function oldestBySerial<T extends { serial: number }>(entries: readonly T[]): T {
  const first = entries[0];
  if (!first) throw new Error("Pool clássico vazio");
  let oldest = first;
  for (let index = 1; index < entries.length; index++) {
    const candidate = entries[index]!;
    if (candidate.serial < oldest.serial) oldest = candidate;
  }
  return oldest;
}

/** Deterministic stand-in for the classic client's sequential rand() call. */
function classicRandomStep(serial: number, modulus: number): number {
  const seed = Math.imul(serial, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function disposeResources(resources: ClassicFoemaMeteorResources): void {
  const textures = new Set<THREE.Texture>([
    resources.primaryTrailTexture,
    resources.secondaryTrailTexture,
    resources.shadeTexture,
    resources.groundFlashTexture,
    ...resources.impactFrames,
    ...resources.verticallyFlippedImpactFrames,
  ]);
  for (const texture of textures) texture.dispose();
}
