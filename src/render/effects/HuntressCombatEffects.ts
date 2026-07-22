import * as THREE from "three";

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

export class HuntressCombatEffects {
  readonly object = new THREE.Group();
  readonly #arrows: FlyingArrow[] = [];
  readonly #bursts: ExpandingBurst[] = [];
  readonly #shaftGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.9, 5);
  readonly #tipGeometry = new THREE.ConeGeometry(0.075, 0.22, 6);
  readonly #materials = new Map<number, { shaft: THREE.MeshBasicMaterial; tip: THREE.MeshBasicMaterial }>();
  #enabled = true;

  constructor() {
    this.object.name = "huntress-combat-effects";
  }

  shoot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    onImpact: () => void,
    count = 1,
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
        duration: Math.max(0.12, distance / 29),
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
    for (const impact of impacts) impact();
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
