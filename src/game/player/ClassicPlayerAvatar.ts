import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";

const HUNTRESS_VARIANT = 69;
const HUNTRESS_ACTIONS = [
  "STAND01", "STAND02", "WALK", "RUN", "ATTACK1", "ATTACK2",
  "SKILL01", "SKILL02", "SKILL03", "STRIKE", "DIE", "DEAD",
  "MSTND01", "MWALK", "MRUN", "MATT1", "MATT2",
  "MSKIL01", "MSKIL02", "MSKIL03", "MSTRIKE", "MDIE", "MDEAD",
] as const;

export interface ClassicAvatarAction {
  readonly name: string;
  readonly durationSeconds: number;
}

export class ClassicPlayerAvatar {
  readonly object: THREE.Group;
  readonly templateKey: string;
  readonly #lease: ClassicSkinnedInstanceLease;
  readonly #weapon: THREE.Group | null;
  #effectTime = 0;
  #effectsEnabled = true;
  #released = false;

  private constructor(lease: ClassicSkinnedInstanceLease, weapon: THREE.Group | null) {
    this.#lease = lease;
    this.#weapon = weapon;
    this.templateKey = "Huntress_Waha_Skytalos";
    this.object = lease.model.object;
    this.object.name = "classic-player-huntress-skytalos";
    lease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: 0.9,
      mirrorModelZ: true,
    });
  }

  static async load(assets: ClassicAssetSource): Promise<ClassicPlayerAvatar | null> {
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin: 1,
      parts: Array.from({ length: 6 }, (_, index) => {
        const part = index + 1;
        const base = `ch02${String(part).padStart(2, "0")}${HUNTRESS_VARIANT}`;
        return {
          name: `huntress-part-${part}`,
          mesh: `player/meshes/${base}.msh`,
          texture: `player/textures/${base}.dds`,
          alpha: part === 2 ? "A" : "C",
        };
      }),
      actions: HUNTRESS_ACTIONS,
      initialAction: "STAND01",
      actionVariant: 1,
    });
    if (!lease) return null;
    const weapon = await attachSkytalos(assets, lease).catch(() => null);
    return new ClassicPlayerAvatar(lease, weapon);
  }

  setYaw(yaw: number): void {
    if (!this.#released) this.#lease.model.setClassicTransform({ yaw });
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    const aura = this.#weapon?.getObjectByName("skytalos-ancient-aura");
    if (aura) aura.visible = enabled;
  }

  play(actions: readonly string[], restart = false): ClassicAvatarAction | null {
    if (this.#released) return null;
    for (const name of actions) {
      if (!this.#lease.model.play(name, restart)) continue;
      return {
        name,
        durationSeconds: this.#lease.actionDurationSeconds(name) ?? 0,
      };
    }
    return null;
  }

  update(deltaSeconds: number): void {
    if (this.#released) return;
    this.#lease.model.update(deltaSeconds);
    this.#effectTime += deltaSeconds;
    if (this.#weapon && this.#effectsEnabled) {
      const pulse = 0.13 + (Math.sin(this.#effectTime * 5.2) * 0.5 + 0.5) * 0.14;
      const aura = this.#weapon.getObjectByName("skytalos-ancient-aura") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
      if (aura) aura.material.opacity = pulse;
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (this.#weapon) disposeStaticGroup(this.#weapon);
    this.#lease.release();
  }
}

async function attachSkytalos(
  assets: ClassicAssetSource,
  lease: ClassicSkinnedInstanceLease,
): Promise<THREE.Group> {
  const meshResponse = await fetch(assets.dataUrl("player/meshes/bow16.msa"));
  if (!meshResponse.ok) throw new Error("MSA do Skytalos indisponível");
  const model = parseMsa(await meshResponse.arrayBuffer());
  const texture = await new DDSLoader().loadAsync(assets.dataUrl("player/textures/bow16.dds"));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const materials = Array.from({ length: Math.max(1, model.textureNames.length) }, () => (
    new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.25 })
  ));
  const bow = new THREE.Mesh(model.geometry, materials);
  bow.name = "weapon-skytalos-plus-15-ancient-item-826";
  bow.userData.itemIndex = 826;
  bow.userData.refinement = 15;
  bow.userData.ancient = true;
  bow.castShadow = true;
  bow.frustumCulled = false;

  const aura = new THREE.Mesh(
    model.geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: 0x69f2e4,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  aura.name = "skytalos-ancient-aura";
  aura.scale.setScalar(1.025);
  aura.renderOrder = 3;


  // Bows are rendered from the second ch02 hand frame. In the original table
  // g_dwHandIndex[1][1] is bone 24; bone 18 is the string/right hand and makes
  // the bow cross the body. The ch02 CFrame branch uses a 180-degree roll.
  const holder = new THREE.Group();
  holder.name = "right-hand-skytalos-anchor";
  holder.rotation.order = "YXZ";
  holder.rotation.set(THREE.MathUtils.degToRad(-10), THREE.MathUtils.degToRad(-15), Math.PI);
  holder.position.set(-0.07, -0.01, 0);
  holder.add(bow, aura);
  (lease.model.bones[24] ?? lease.model.object).add(holder);
  return holder;
}

function disposeStaticGroup(group: THREE.Group): void {
  const textures = new Set<THREE.Texture>();
  group.removeFromParent();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      if (textured.map) textures.add(textured.map);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}
