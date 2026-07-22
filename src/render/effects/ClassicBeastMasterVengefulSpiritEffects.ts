import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const JUDGEMENT_POOL_LIMIT = 16;
const START_POOL_LIMIT = 40;
const MAX_AFFECTED_TARGETS = 5;

const JUDGEMENT_LIFETIME_SECONDS = 3;
const JUDGEMENT_CONTROLLER_LIFETIME_SECONDS = 0.6;
const JUDGEMENT_VISIBLE_FRACTION = 0.05;
const JUDGEMENT_OUTER_SCALE = 5.6;
const JUDGEMENT_CENTER_SCALE = 2.8;
const JUDGEMENT_BLUE = 0x3333ff;
const JUDGEMENT_GRAY = 0xaaaaaa;

const START_LIFETIME_SECONDS = 2;
const START_VISIBLE_FRACTION = 0.05;

export type BeastMasterVengefulSpiritFollowTarget = () => THREE.Vector3 | null;

export interface BeastMasterVengefulSpiritVisualTarget {
  readonly feet: THREE.Vector3;
  readonly followTarget?: BeastMasterVengefulSpiritFollowTarget;
}

interface VengefulSpiritResources {
  readonly startGeometry: THREE.BufferGeometry;
  readonly startTexture: THREE.Texture;
  readonly judgementTexture: THREE.Texture;
  readonly judgementCenterTexture: THREE.Texture;
}

interface JudgementVisual {
  readonly root: THREE.Group;
  readonly outerFast: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly outerSlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly center: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface StartVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly targetFeet: THREE.Vector3;
  active: boolean;
  elapsed: number;
  serial: number;
  followTarget: BeastMasterVengefulSpiritFollowTarget | null;
}

/**
 * Presentation-only port of BeastMaster #55, Espirito Vingador.
 *
 * `play` dispatches immediately, matching TMFieldScene's packet branch. The
 * caller owns target selection, damage, hit timing and every server decision.
 * The center is a snapshot; each type-5 TMEffectStart may optionally follow
 * its affected owner for the full two-second lifetime.
 */
export class ClassicBeastMasterVengefulSpiritEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #judgements: JudgementVisual[] = [];
  readonly #starts: StartVisual[] = [];
  #resources: VengefulSpiritResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-beastmaster-vengeful-spirit-effects";
    parent.add(this.object);
  }

  /** Loads model 703 plus retail effect textures 152, 418 and 419. */
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
        console.warn("Efeito clássico #55 Espirito Vingador indisponível.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /**
   * Starts Judgement type 3 at the primary target and EffectStart type 5 on
   * the first five valid affected targets. This method never applies damage.
   */
  play(
    centerFeet: THREE.Vector3,
    affectedTargets: readonly BeastMasterVengefulSpiritVisualTarget[],
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(centerFeet)
    ) {
      return false;
    }

    this.spawnJudgement(centerFeet);
    let spawnedTargets = 0;
    for (const target of affectedTargets) {
      if (!isFiniteVector(target.feet)) continue;
      this.spawnStart(target.feet, target.followTarget ?? null);
      spawnedTargets++;
      if (spawnedTargets >= MAX_AFFECTED_TARGETS) break;
    }
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    for (const visual of this.#judgements) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateJudgementVisual(visual);
    }
    for (const visual of this.#starts) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateStartVisual(visual);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const visual of this.#judgements) deactivateJudgement(visual);
    for (const visual of this.#starts) deactivateStart(visual);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const visual of this.#judgements) {
      visual.outerFast.material.dispose();
      visual.outerSlow.material.dispose();
      visual.center.material.dispose();
    }
    for (const visual of this.#starts) visual.mesh.material.dispose();
    this.#judgements.length = 0;
    this.#starts.length = 0;
    this.#planeGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private spawnJudgement(centerFeet: THREE.Vector3): void {
    const visual = this.acquireJudgement();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(centerFeet);
    // TMFieldScene passes pTarget->m_fHeight + .2 to TMSkillJudgement.
    visual.root.position.y += 0.2;
    visual.root.visible = true;
    visual.outerFast.visible = false;
    visual.outerSlow.visible = false;
    visual.center.visible = false;
    this.updateJudgementVisual(visual);
  }

  private acquireJudgement(): JudgementVisual {
    const free = this.#judgements.find((visual) => !visual.active);
    if (free) return free;
    if (this.#judgements.length < JUDGEMENT_POOL_LIMIT) {
      const resources = this.#resources!;
      const index = this.#judgements.length;
      const outerFast = createGroundPlane(
        this.#planeGeometry,
        resources.judgementTexture,
        `classic-beastmaster-vengeful-judgement-fast-${index}`,
      );
      const outerSlow = createGroundPlane(
        this.#planeGeometry,
        resources.judgementTexture,
        `classic-beastmaster-vengeful-judgement-slow-${index}`,
      );
      const center = createGroundPlane(
        this.#planeGeometry,
        resources.judgementCenterTexture,
        `classic-beastmaster-vengeful-judgement-center-${index}`,
      );
      outerFast.position.y = 0.31;
      outerSlow.position.y = 0.3;
      center.position.y = 0.3;
      outerFast.scale.set(JUDGEMENT_OUTER_SCALE, JUDGEMENT_OUTER_SCALE, 1);
      outerSlow.scale.set(JUDGEMENT_OUTER_SCALE, JUDGEMENT_OUTER_SCALE, 1);
      center.scale.set(JUDGEMENT_CENTER_SCALE, JUDGEMENT_CENTER_SCALE, 1);

      const root = new THREE.Group();
      root.name = `classic-beastmaster-vengeful-judgement-${index}`;
      root.visible = false;
      root.add(outerFast, outerSlow, center);
      const visual: JudgementVisual = {
        root,
        outerFast,
        outerSlow,
        center,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#judgements.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#judgements);
    deactivateJudgement(oldest);
    return oldest;
  }

  private updateJudgementVisual(visual: JudgementVisual): void {
    if (visual.elapsed >= JUDGEMENT_LIFETIME_SECONDS) {
      deactivateJudgement(visual);
      return;
    }

    const progress = visual.elapsed / JUDGEMENT_LIFETIME_SECONDS;
    const intensity = Math.max(0, Math.sin(progress * Math.PI));
    setBrightIntensity(visual.outerFast.material, JUDGEMENT_BLUE, intensity);
    setBrightIntensity(visual.outerSlow.material, JUDGEMENT_GRAY, intensity);
    setBrightIntensity(visual.center.material, JUDGEMENT_GRAY, intensity);
    visual.outerFast.rotation.z = visual.elapsed / 0.6 * Math.PI * 2;
    visual.outerSlow.rotation.z = visual.elapsed / 0.9 * Math.PI * 2;
    // The negative speed passed through an unsigned classic field wraps into
    // an effectively static center ring.
    visual.center.rotation.z = -visual.elapsed * 0.000_001;

    const visible = progress >= JUDGEMENT_VISIBLE_FRACTION;
    visual.outerFast.visible = visible
      && visual.elapsed < JUDGEMENT_CONTROLLER_LIFETIME_SECONDS;
    visual.center.visible = visible
      && visual.elapsed < JUDGEMENT_CONTROLLER_LIFETIME_SECONDS;
    // TMSkillJudgement overwrites this second 418 pointer; unlike the other
    // two layers, it survives the controller cleanup and completes all 3 s.
    visual.outerSlow.visible = visible;
  }

  private spawnStart(
    targetFeet: THREE.Vector3,
    followTarget: BeastMasterVengefulSpiritFollowTarget | null,
  ): void {
    const visual = this.acquireStart();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.followTarget = followTarget;
    visual.targetFeet.copy(targetFeet);
    visual.root.position.copy(targetFeet);
    visual.root.visible = true;
    this.updateStartVisual(visual);
  }

  private acquireStart(): StartVisual {
    const free = this.#starts.find((visual) => !visual.active);
    if (free) return free;
    if (this.#starts.length < START_POOL_LIMIT) {
      const index = this.#starts.length;
      const mesh = new THREE.Mesh(
        this.#resources!.startGeometry,
        createBrightMaterial(this.#resources!.startTexture),
      );
      mesh.name = `classic-beastmaster-vengeful-effect-start-type-5-${index}`;
      mesh.visible = false;
      mesh.renderOrder = 8;
      const root = new THREE.Group();
      root.name = `classic-beastmaster-vengeful-target-${index}`;
      root.visible = false;
      root.add(mesh);
      const visual: StartVisual = {
        root,
        mesh,
        targetFeet: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        serial: 0,
        followTarget: null,
      };
      this.#starts.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#starts);
    deactivateStart(oldest);
    return oldest;
  }

  private updateStartVisual(visual: StartVisual): void {
    if (visual.elapsed >= START_LIFETIME_SECONDS) {
      deactivateStart(visual);
      return;
    }
    this.refreshFollowedTarget(visual);

    const progress = visual.elapsed / START_LIFETIME_SECONDS;
    const intensity = Math.abs(Math.sin(progress * Math.PI));
    const horizontalScale = intensity * 0.5 + 0.3;
    visual.root.position.copy(visual.targetFeet);
    visual.mesh.visible = progress >= START_VISIBLE_FRACTION;
    // FrameMove computes m_fScaleV for type 5, but Render immediately resets
    // it to 1.0 before TMMesh::Render. After the converted rotation,
    // Scale(H, 1, H) is Three local Scale(H, H, 1).
    visual.mesh.scale.set(horizontalScale, horizontalScale, 1);
    // TMMesh contributes the fixed pitch; TMEffectStart passes its rotating
    // first angle plus a fixed +90-degree roll.
    visual.mesh.rotation.set(
      Math.PI / 2,
      -progress * Math.PI,
      Math.PI / 2,
      "YXZ",
    );
    visual.mesh.material.color.setRGB(intensity, intensity, intensity);
    visual.mesh.material.opacity = 1;
  }

  private refreshFollowedTarget(visual: StartVisual): void {
    if (!visual.followTarget) return;
    try {
      const followed = visual.followTarget();
      if (followed && isFiniteVector(followed)) visual.targetFeet.copy(followed);
    } catch {
      // Freeze at the last valid owner position if a presentation callback is
      // invalidated while the packet-time effect is still alive.
      visual.followTarget = null;
    }
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<VengefulSpiritResources> {
    const results = await Promise.allSettled([
      assets.loadModel(703),
      this.loadEffectTexture(assets, 152),
      this.loadEffectTexture(assets, 418),
      this.loadEffectTexture(assets, 419),
    ] as const);

    const loadedTextures = results.slice(1)
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => (
        result.status === "fulfilled"
      ))
      .map((result) => result.value);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const source = results[0].status === "fulfilled" ? results[0].value : null;
    if (failure || !source || loadedTextures.length !== 3) {
      for (const texture of loadedTextures) texture.dispose();
      throw failure?.reason ?? new Error("Modelo 703 ou texturas 152/418/419 ausentes");
    }

    let startGeometry: THREE.BufferGeometry | null = null;
    try {
      startGeometry = parseMsa(source.buffer).geometry;
      const [startTexture, judgementTexture, judgementCenterTexture] = loadedTextures;
      configureClassicGroundPlaneUvs(judgementTexture!);
      configureClassicGroundPlaneUvs(judgementCenterTexture!);
      return {
        startGeometry,
        startTexture: startTexture!,
        judgementTexture: judgementTexture!,
        judgementCenterTexture: judgementCenterTexture!,
      };
    } catch (error) {
      startGeometry?.dispose();
      for (const texture of loadedTextures) texture.dispose();
      throw error;
    }
  }

  private async loadEffectTexture(
    assets: ClassicAssetSource,
    index: 152 | 418 | 419,
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

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMaterial(texture));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 4;
  return mesh;
}

function createBrightMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
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
  return material;
}

function setBrightIntensity(
  material: THREE.MeshBasicMaterial,
  packedColor: number,
  intensity: number,
): void {
  material.color
    .setHex(packedColor & 0xffffff)
    .multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
  // EF_BRIGHT and EffectStart type 5 preserve texture alpha while fading RGB.
  material.opacity = 1;
}

function configureClassicGroundPlaneUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.02);
  texture.repeat.set(0.96, 0.96);
  texture.needsUpdate = true;
}

function deactivateJudgement(visual: JudgementVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.outerFast.visible = false;
  visual.outerSlow.visible = false;
  visual.center.visible = false;
}

function deactivateStart(visual: StartVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.followTarget = null;
  visual.root.visible = false;
  visual.mesh.visible = false;
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

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function disposeResources(resources: VengefulSpiritResources): void {
  resources.startGeometry.dispose();
  resources.startTexture.dispose();
  resources.judgementTexture.dispose();
  resources.judgementCenterTexture.dispose();
}
