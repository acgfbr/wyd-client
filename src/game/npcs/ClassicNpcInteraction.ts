import type { ClassicNpcInteractionKind } from "./ClassicMonsterGameplay";
import type { MonsterTemplate } from "./MonsterCatalog";

const MIX_HEAD_ITEMS = new Set([54, 55, 56, 68]);

/**
 * Reads STRUCT_MOB_OLD.CurrentScore.Reserved directly from npcdb. The classic
 * MSG_CreateMob transports the complete STRUCT_SCORE, OnPacketCreateMob copies
 * it to TMHuman::m_stScore, and every interaction branch inspects its low
 * nibble. `currentScore[3]` keeps older generated catalogs compatible.
 */
export function classicNpcInteractionCode(
  template: Pick<MonsterTemplate, "currentScore" | "currentScoreReserved">,
): number {
  const reserved = template.currentScoreReserved ?? template.currentScore?.[3];
  return (Number.isFinite(reserved) ? Math.trunc(reserved ?? 0) : 0) & 0x0f;
}

/** Equip[0] becomes TMHuman::m_sHeadIndex in the classic MOB look packet. */
export function classicNpcHeadItemIndex(
  template: Pick<MonsterTemplate, "equipment">,
): number {
  const head = template.equipment?.[0];
  return Number.isFinite(head) ? Math.max(0, Math.trunc(head ?? 0)) : 0;
}

/**
 * Mirrors the observable branch order in TMFieldScene::MouseClick_NPC.
 *
 * Known decompilation/data ambiguities:
 * - interaction code 3 first enters the shop branch; a later skill-master
 *   branch for the same code is therefore unreachable in the recovered C++.
 * - heads 51 and 67 select different mission/mix/message flows according to
 *   Field coordinates and server state, which a template-only snapshot cannot
 *   resolve; they are exposed as `special`.
 * - codes 5..7 are merchant-like in TMHuman::IsMerchant, but their concrete
 *   handling is packet/region dependent, so they are also `special`.
 */
export function classifyClassicNpcInteraction(
  interactionCode: number,
  headItemIndex: number,
): ClassicNpcInteractionKind {
  const code = interactionCode & 0x0f;

  if (code === 1 || code === 3) return "shop";
  if (code === 2 && headItemIndex !== 51) return "cargo";
  if (MIX_HEAD_ITEMS.has(headItemIndex)) return "mix";
  if (headItemIndex === 57) return "premium";
  if (headItemIndex === 51 || headItemIndex === 67) return "special";
  if (code === 4 || (code >= 8 && code <= 15)) return "quest";
  if (code >= 5 && code <= 7) return "special";
  return "none";
}
