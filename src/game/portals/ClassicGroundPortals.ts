/**
 * One entry from the 7.54 client's `g_TeleportTable`.
 *
 * `x` and `y` identify the ground trigger itself. They are not the teleport
 * destination. The destination, confirmation result, and authoritative price
 * charge belong to the server-side flow and are deliberately not implemented
 * by this module.
 */
export interface ClassicGroundPortal {
  readonly x: number;
  readonly y: number;
  readonly price: number;
  readonly messageStringId: number;
  /** Exact Portuguese label from the local 7.54 `Interface/Messages.txt`. */
  readonly labelPtBr?: string;
}

export const CLASSIC_GROUND_PORTAL_ATTRIBUTE_MASK = 0x10;
export const CLASSIC_GROUND_PORTAL_COORDINATE_MASK = 0xfffc;

/**
 * Faithful transcription of the 37-entry `g_TeleportTable` in
 * `TMProject/TMGlobal.h`. Labels are included only where the referenced ID was
 * confirmed in the local 7.54 `Interface/Messages.txt` table.
 */
export const CLASSIC_GROUND_PORTALS = [
  { x: 2116, y: 2100, price: 700, messageStringId: 209, labelPtBr: "Reino de Noatun" },
  { x: 2480, y: 1716, price: 700, messageStringId: 209, labelPtBr: "Reino de Noatun" },
  { x: 2456, y: 2016, price: 700, messageStringId: 209, labelPtBr: "Reino de Noatun" },
  { x: 3648, y: 3108, price: 0, messageStringId: 209, labelPtBr: "Reino de Noatun" },
  { x: 1044, y: 1724, price: 0, messageStringId: 125, labelPtBr: "Armia" },
  { x: 1044, y: 1716, price: 0, messageStringId: 126, labelPtBr: "Azran" },
  { x: 1044, y: 1708, price: 0, messageStringId: 173, labelPtBr: "Erion" },
  { x: 1048, y: 1764, price: 0, messageStringId: 210, labelPtBr: "Campo fora do Castelo de Noatun" },
  { x: 2140, y: 2068, price: 0, messageStringId: 213, labelPtBr: "Campo Armia" },
  { x: 2468, y: 1716, price: 0, messageStringId: 211, labelPtBr: "Campo Azran" },
  { x: 2364, y: 2284, price: 0, messageStringId: 212, labelPtBr: "Dungeon" },
  { x: 144, y: 3788, price: 0, messageStringId: 213, labelPtBr: "Campo Armia" },
  { x: 2668, y: 2156, price: 0, messageStringId: 212, labelPtBr: "Dungeon" },
  { x: 144, y: 3772, price: 0, messageStringId: 213, labelPtBr: "Campo Armia" },
  { x: 148, y: 3780, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 144, y: 3780, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 1004, y: 4028, price: 0, messageStringId: 214, labelPtBr: "Dungeon 1º Andar" },
  { x: 408, y: 4072, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 1004, y: 4064, price: 0, messageStringId: 214, labelPtBr: "Dungeon 1º Andar" },
  { x: 744, y: 3820, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 1004, y: 3992, price: 0, messageStringId: 214, labelPtBr: "Dungeon 1º Andar" },
  { x: 680, y: 4076, price: 0, messageStringId: 216, labelPtBr: "Dungeon 3º Andar" },
  { x: 916, y: 3820, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 876, y: 3872, price: 0, messageStringId: 216, labelPtBr: "Dungeon 3º Andar" },
  { x: 932, y: 3820, price: 0, messageStringId: 215, labelPtBr: "Dungeon 2º Andar" },
  { x: 188, y: 188, price: 0, messageStringId: 126, labelPtBr: "Azran" },
  { x: 2548, y: 1740, price: 1000, messageStringId: 322, labelPtBr: "Dungeon Abandonado" },
  { x: 1824, y: 1772, price: 0, messageStringId: 218, labelPtBr: "Submundo" },
  { x: 1172, y: 4080, price: 0, messageStringId: 211, labelPtBr: "Campo Azran" },
  { x: 1516, y: 3996, price: 0, messageStringId: 220, labelPtBr: "Submundo 2º Andar" },
  { x: 1304, y: 3816, price: 0, messageStringId: 219, labelPtBr: "Submundo 1º Andar" },
  { x: 2452, y: 1716, price: 0, messageStringId: 211, labelPtBr: "Campo Azran" },
  { x: 2452, y: 1988, price: 0, messageStringId: 211, labelPtBr: "Campo Azran" },
  { x: 3648, y: 3140, price: 700, messageStringId: 211, labelPtBr: "Campo Azran" },
  { x: 2480, y: 1648, price: 700, messageStringId: 301, labelPtBr: "Campo Nippleheim" },
  { x: 1052, y: 1708, price: 0, messageStringId: 321, labelPtBr: "Karden" },
  { x: 1056, y: 1724, price: 0, messageStringId: 485, labelPtBr: "Campo de Guerra de Reino" },
] as const satisfies readonly ClassicGroundPortal[];

function coordinateKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function buildPortalLookup(): ReadonlyMap<string, ClassicGroundPortal> {
  if (CLASSIC_GROUND_PORTALS.length !== 37) {
    throw new Error(`Invalid classic ground portal count: ${CLASSIC_GROUND_PORTALS.length}`);
  }

  const lookup = new Map<string, ClassicGroundPortal>();
  for (const portal of CLASSIC_GROUND_PORTALS) {
    if (
      !Number.isInteger(portal.x)
      || !Number.isInteger(portal.y)
      || !Number.isInteger(portal.price)
      || !Number.isInteger(portal.messageStringId)
      || portal.price < 0
      || portal.messageStringId < 0
    ) {
      throw new Error(`Invalid classic ground portal entry at ${portal.x}:${portal.y}`);
    }
    if (
      (portal.x & CLASSIC_GROUND_PORTAL_COORDINATE_MASK) !== portal.x
      || (portal.y & CLASSIC_GROUND_PORTAL_COORDINATE_MASK) !== portal.y
    ) {
      throw new Error(`Unaligned classic ground portal entry at ${portal.x}:${portal.y}`);
    }

    const key = coordinateKey(portal.x, portal.y);
    if (lookup.has(key)) {
      throw new Error(`Duplicate classic ground portal entry at ${key}`);
    }
    lookup.set(key, portal);
  }
  return lookup;
}

const CLASSIC_GROUND_PORTAL_LOOKUP = buildPortalLookup();

/** Mirrors `(int)position & 0xFFFC` from the 7.54 client. */
export function alignClassicGroundPortalCoordinate(position: number): number {
  return Math.trunc(position) & CLASSIC_GROUND_PORTAL_COORDINATE_MASK;
}

/**
 * Looks up the original table after aligning both coordinates exactly as the
 * classic client does. This function only recognizes a trigger; it never moves
 * the player.
 */
export function findClassicGroundPortalAt(
  positionX: number,
  positionY: number,
): ClassicGroundPortal | undefined {
  const x = alignClassicGroundPortalCoordinate(positionX);
  const y = alignClassicGroundPortalCoordinate(positionY);
  return CLASSIC_GROUND_PORTAL_LOOKUP.get(coordinateKey(x, y));
}

/** Mirrors the classic ground-portal attribute requirement: `attribute & 0x10`. */
export function hasClassicGroundPortalAttribute(attribute: number): boolean {
  return (Math.trunc(attribute) & CLASSIC_GROUND_PORTAL_ATTRIBUTE_MASK) !== 0;
}

/**
 * Pure trigger resolver: a table entry is returned only when the terrain has
 * the classic `0x10` attribute bit. Confirmation handling, destination choice,
 * charging, and the teleport itself remain server-side responsibilities.
 */
export function findTriggeredClassicGroundPortalAt(
  positionX: number,
  positionY: number,
  attribute: number,
): ClassicGroundPortal | undefined {
  if (!hasClassicGroundPortalAttribute(attribute)) return undefined;
  return findClassicGroundPortalAt(positionX, positionY);
}
