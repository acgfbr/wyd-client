export const FIELD_WORLD_SIZE = 128;
export const TILE_WORLD_SIZE = 2;
export const HEIGHT_SCALE = 0.1;

export interface WydPosition { readonly x: number; readonly y: number }

export function fieldAt(position: WydPosition): { column: number; row: number } {
  return { column: Math.floor(position.x / FIELD_WORLD_SIZE), row: Math.floor(position.y / FIELD_WORLD_SIZE) };
}

export function toScene(position: WydPosition, origin: WydPosition): { x: number; z: number } {
  return { x: position.x - origin.x, z: origin.y - position.y };
}

export function toWyd(x: number, z: number, origin: WydPosition): WydPosition {
  return { x: x + origin.x, y: origin.y - z };
}
