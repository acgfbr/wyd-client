import * as THREE from "three";

export class WydCamera {
  yaw = Math.PI * 0.25;
  pitch = Math.PI * 0.25;
  distance = 15;
  readonly #lookAt = new THREE.Vector3();
  #quakeRemaining = 0;
  #quakeDuration = 0;
  #quakeStrength = 0;
  #quakePhase = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  rotate(deltaYaw: number, deltaPitch = 0): void {
    this.yaw += deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaPitch, 0.18, 1.05);
  }

  zoom(delta: number): void {
    const scaledDelta = delta * Math.max(1, this.distance * 0.08);
    this.distance = THREE.MathUtils.clamp(this.distance + scaledDelta, 3.5, 180);
  }

  quake(strength = 1, durationSeconds = 0.18): void {
    this.#quakeStrength = Math.max(this.#quakeStrength, Math.max(0, strength));
    this.#quakeDuration = Math.max(0.01, durationSeconds);
    this.#quakeRemaining = Math.max(this.#quakeRemaining, this.#quakeDuration);
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
    if (this.#quakeRemaining > 0) {
      this.#quakeRemaining = Math.max(0, this.#quakeRemaining - dt);
      this.#quakePhase += dt * 71;
      const envelope = this.#quakeRemaining / this.#quakeDuration;
      const amplitude = this.#quakeStrength * 0.045 * envelope;
      desiredPosition.x += Math.sin(this.#quakePhase) * amplitude;
      desiredPosition.y += Math.sin(this.#quakePhase * 1.73) * amplitude * 0.55;
      desiredPosition.z += Math.cos(this.#quakePhase * 1.31) * amplitude;
      if (this.#quakeRemaining === 0) this.#quakeStrength = 0;
    }
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(this.#lookAt);
  }

  groundAxes(): { forward: THREE.Vector2; right: THREE.Vector2 } {
    const forward = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
    return { forward, right: new THREE.Vector2(-forward.y, forward.x) };
  }
}
