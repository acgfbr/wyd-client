import * as THREE from "three";

export class WydCamera {
  yaw = Math.PI * 0.25;
  pitch = Math.PI * 0.25;
  distance = 15;
  readonly #lookAt = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  rotate(deltaYaw: number, deltaPitch = 0): void {
    this.yaw += deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, 0.18, 1.05);
  }

  zoom(delta: number): void {
    const scaledDelta = delta * Math.max(1, this.distance * 0.08);
    this.distance = THREE.MathUtils.clamp(this.distance + scaledDelta, 3.5, 180);
  }

  update(target: THREE.Vector3, dt: number): void {
    const desiredTarget = new THREE.Vector3(target.x, target.y + 1, target.z);
    this.#lookAt.lerp(desiredTarget, 1 - Math.exp(-dt * 14));
    const horizontal = Math.cos(this.pitch) * this.distance * 1.2;
    const desiredPosition = new THREE.Vector3(
      this.#lookAt.x - Math.cos(this.yaw) * horizontal,
      this.#lookAt.y + Math.sin(this.pitch) * this.distance,
      this.#lookAt.z + Math.sin(this.yaw) * horizontal,
    );
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(this.#lookAt);
  }

  groundAxes(): { forward: THREE.Vector2; right: THREE.Vector2 } {
    const forward = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
    return { forward, right: new THREE.Vector2(-forward.y, forward.x) };
  }
}
