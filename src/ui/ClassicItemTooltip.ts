import type {
  ClassicCommerceCarryEffect,
  ClassicCommerceItem,
} from "../game/commerce/ClassicCommerceCatalog";
import {
  classicItemGridFootprint,
  type InventoryItem,
  type InventoryItemClassicEffect,
  type PlayerSnapshot,
} from "../game/state/PlayerState";
import type {
  GameTooltipContent,
  GameTooltipLine,
  GameTooltipLineTone,
} from "./GameTooltip";

const CLASS_EFFECT = 18;
const LEVEL_EFFECT = 1;
const DAMAGE_EFFECT = 2;
const DEFENSE_EFFECT = 3;
const ATTACK_SPEED_EFFECT = 26;
const GRID_EFFECT = 33;
const REFINEMENT_EFFECT = 43;
const FIRST_REFINEMENT_COLOR_EFFECT = 115;
const LAST_REFINEMENT_COLOR_EFFECT = 126;
const MAX_CLASSIC_BODY_LINES = 13;

/** Exact order used by SGrid::OnMouseOver for normal item descriptions. */
const CLASSIC_EFFECT_ORDER = Object.freeze([
  2, 3, 4, 5, 45, 46, 44, 42, 47, 48, 54, 40, 29,
  49, 50, 51, 52, 11, 12, 13, 14, 26, 74, 7, 8, 9, 10,
  60, 62, 64, 65, 66, 53, 67, 68, 73, 78, 79, 80, 81, 82,
  84, 83,
]);

/** Portuguese labels recovered from Lang/PT/strdef.bin and SGrid::m_szParamString. */
const CLASSIC_EFFECT_LABELS: Readonly<Record<number, string>> = Object.freeze({
  2: "Aumento de Dano",
  3: "Defesa",
  4: "Aumento de HP máximo",
  5: "Aumento de MP máximo",
  7: "Força",
  8: "Inteligência",
  9: "Destreza",
  10: "Constituição",
  11: "Aprender Arma",
  12: "Confiança / Magia Branca / Elemental / Sobrevivência",
  13: "Trans / Magia Negra / Evocação / Troca",
  14: "Espada Mágica / Magia Especial / Natureza / Captura",
  26: "Aumento da Velocidade de Ataque",
  29: "Aumento da Velocidade de Movimento",
  40: "Índice de Evasão",
  42: "Crítico",
  44: "Economia de Mana",
  45: "Índice de aumento de HP máximo",
  46: "Índice de aumento de MP máximo",
  47: "Índice de regeneração de HP",
  48: "Índice de regeneração de MP",
  49: "Resistência a Fogo",
  50: "Resistência a Gelo",
  51: "Resistência a Sagrado",
  52: "Resistência a Relâmpago",
  53: "Defesa",
  54: "Aumento de Imunidades",
  60: "Ataque Mágico",
  62: "Número único",
  64: "Reiniciar Confiança / Magia Branca / Elemental / Sobrevivência",
  65: "Reiniciar Trans / Magia Negra / Evocação / Troca",
  66: "Reiniciar Espada Mágica / Magia Especial / Natureza / Captura",
  67: "Aumento de Dano",
  68: "Ataque Mágico",
  73: "Aumento de Dano",
  74: "Aumento de Aprendizagem de Skill",
  78: "Valor Crítico de Incubação",
  79: "Vitalidade",
  80: "HP",
  81: "Crescimento",
  82: "Ração",
  83: "Experiência da montaria",
  84: "Tempo de Espera para Incubação",
});

const CLASS_NAMES = Object.freeze([
  { mask: 1, key: "transknight", label: "TransKnight" },
  { mask: 2, key: "foema", label: "Foema" },
  { mask: 4, key: "beastmaster", label: "BeastMaster" },
  { mask: 8, key: "huntress", label: "Huntress" },
]);

export interface ClassicItemTooltipContext {
  readonly item: InventoryItem;
  readonly quantity: number;
  readonly metadata?: ClassicCommerceItem | null;
  readonly player?: PlayerSnapshot | null;
  readonly activeClassKey?: string;
}

export interface ClassicShopTooltipContext {
  readonly metadata: ClassicCommerceItem;
  readonly instanceEffects: readonly ClassicCommerceCarryEffect[];
  readonly staticPrice?: number;
}

export function classicInventoryItemTooltip(context: ClassicItemTooltipContext): GameTooltipContent {
  const { item, quantity, metadata, player, activeClassKey } = context;
  if (!metadata) return fallbackInventoryTooltip(item, quantity);

  const lines: GameTooltipLine[] = [];
  appendRequirements(lines, metadata, player, activeClassKey);
  appendStaticEffects(lines, metadata);
  appendInstanceEffects(lines, item.classicInstanceEffects ?? [], metadata, item.refinement ?? 0);
  appendAncientGrade(lines, metadata, item.classicInstanceEffects ?? [], item.refinement ?? 0, item.ancient ?? false);
  appendRefinement(lines, item.refinement ?? 0, item.ancient ?? false);
  const footprint = classicItemGridFootprint(item);
  if ((footprint.width > 1 || footprint.height > 1) && lines.length < MAX_CLASSIC_BODY_LINES) {
    lines.push({ text: `Espaço : ${footprint.width} × ${footprint.height}`, tone: "muted" });
  }
  if (quantity > 1 && lines.length < MAX_CLASSIC_BODY_LINES) {
    lines.push({ text: `Quantidade : ${quantity} / ${item.maxStack}`, tone: "muted" });
  }

  return {
    title: classicItemTitle(item.name, item.refinement),
    lines: lines.slice(0, MAX_CLASSIC_BODY_LINES),
    tone: "item-common",
  };
}

export function classicShopItemTooltip(context: ClassicShopTooltipContext): GameTooltipContent {
  const { metadata, instanceEffects, staticPrice } = context;
  const lines: GameTooltipLine[] = [];
  appendRequirements(lines, metadata, null, undefined);
  const refinement = classicRefinement(instanceEffects);
  appendStaticEffects(lines, metadata);
  appendInstanceEffects(lines, instanceEffects, metadata, refinement);
  const ancient = metadata.name.toLocaleLowerCase("pt-BR").includes("anct") || metadata.grade > 0;
  appendAncientGrade(lines, metadata, instanceEffects, refinement, ancient);
  appendRefinement(lines, refinement, ancient);
  if (staticPrice !== undefined && lines.length < MAX_CLASSIC_BODY_LINES) {
    lines.push({ text: `Preço : ${formatNumber(staticPrice)}`, tone: "default" });
  }
  return {
    title: classicItemTitle(displayName(metadata.name), refinement),
    lines: lines.slice(0, MAX_CLASSIC_BODY_LINES),
    tone: "item-common",
  };
}

function fallbackInventoryTooltip(item: InventoryItem, quantity: number): GameTooltipContent {
  const lines: GameTooltipLine[] = [];
  if (item.heal !== undefined && item.heal > 0) lines.push({ text: `Recupera HP : ${item.heal}` });
  if (item.mana !== undefined && item.mana > 0) lines.push({ text: `Recupera MP : ${item.mana}` });
  if (item.refinement !== undefined && item.refinement > 0) {
    lines.push({ text: `Refinação : +${item.refinement}`, tone: "refinement" });
  }
  if (item.ancient) lines.push({ text: "Item Ancient", tone: "refinement" });
  const footprint = classicItemGridFootprint(item);
  if (footprint.width > 1 || footprint.height > 1) {
    lines.push({ text: `Espaço : ${footprint.width} × ${footprint.height}`, tone: "muted" });
  }
  if (quantity > 1) lines.push({ text: `Quantidade : ${quantity} / ${item.maxStack}`, tone: "muted" });
  if (item.description.trim()) lines.push({ text: item.description.trim(), tone: "muted" });
  return {
    title: classicItemTitle(item.name, item.refinement),
    lines: lines.slice(0, MAX_CLASSIC_BODY_LINES),
    tone: `item-${item.rarity}`,
  };
}

function appendRequirements(
  lines: GameTooltipLine[],
  metadata: ClassicCommerceItem,
  player: PlayerSnapshot | null | undefined,
  activeClassKey: string | undefined,
): void {
  const classMask = staticEffectValue(metadata, CLASS_EFFECT);
  if (classMask > 0 && classMask !== 255) {
    const allowed = CLASS_NAMES.filter((entry) => (classMask & entry.mask) !== 0);
    const satisfied = !activeClassKey || allowed.some((entry) => entry.key === activeClassKey);
    lines.push({
      text: `Classe : ${allowed.map((entry) => entry.label).join(" / ") || classMask}`,
      tone: satisfied ? "default" : "danger",
    });
  }

  const requirements = [
    ["Level necessário", metadata.requirements.level > 0 ? metadata.requirements.level + 1 : 0, player?.level],
    ["Força necessária", metadata.requirements.strength, player?.primaryAttributes.str],
    ["Inteligência necessária", metadata.requirements.intelligence, player?.primaryAttributes.int],
    ["Destreza necessária", metadata.requirements.dexterity, player?.primaryAttributes.dex],
    ["Constituição necessária", metadata.requirements.constitution, player?.primaryAttributes.con],
  ] as const;
  for (const [label, required, current] of requirements) {
    if (required <= 0 || lines.length >= MAX_CLASSIC_BODY_LINES) continue;
    lines.push({
      text: `${label} : ${required}`,
      tone: current === undefined || current >= required ? "default" : "danger",
    });
  }
}

function appendStaticEffects(
  lines: GameTooltipLine[],
  metadata: ClassicCommerceItem,
): void {
  for (const effect of CLASSIC_EFFECT_ORDER) {
    if (lines.length >= MAX_CLASSIC_BODY_LINES) return;
    let value = staticEffectValue(metadata, effect);
    if (value === 0) continue;
    if (effect === ATTACK_SPEED_EFFECT && value === 1) value = 10;
    lines.push({ text: formatEffect(effect, value), tone: "default" });
  }
}

function appendInstanceEffects(
  lines: GameTooltipLine[],
  effects: readonly InventoryItemClassicEffect[],
  metadata: ClassicCommerceItem,
  refinement: number,
): void {
  if (isMountItem(metadata)) return;
  const grouped = new Map<number, number>();
  for (const effect of effects) {
    if (!effect.effect || effect.effect === GRID_EFFECT || isRefinementEffect(effect.effect)) continue;
    grouped.set(effect.effect, (grouped.get(effect.effect) ?? 0) + effect.value);
  }
  for (const effect of CLASSIC_EFFECT_ORDER) {
    if (lines.length >= MAX_CLASSIC_BODY_LINES) return;
    let value = grouped.get(effect) ?? 0;
    if (value === 0) continue;
    if (effect === ATTACK_SPEED_EFFECT && value === 1) value = 10;
    const refined = applyClassicRefinement(value, refinement, effect);
    const rendered = refined === value
      ? formatEffect(effect, value)
      : `${formatEffect(effect, value)} (${formatEffectValue(effect, refined)})`;
    lines.push({
      text: rendered,
      tone: classicOptionTone(metadata.position, effect, value),
    });
    grouped.delete(effect);
  }
  for (const [effect, value] of grouped) {
    if (lines.length >= MAX_CLASSIC_BODY_LINES) return;
    lines.push({
      text: `${CLASSIC_EFFECT_LABELS[effect] ?? `Efeito ${effect}`} : ${value}`,
      tone: classicOptionTone(metadata.position, effect, value),
    });
  }
}

function appendAncientGrade(
  lines: GameTooltipLine[],
  metadata: ClassicCommerceItem,
  effects: readonly InventoryItemClassicEffect[],
  refinement: number,
  ancient: boolean,
): void {
  if (!ancient || metadata.grade <= 0 || lines.length >= MAX_CLASSIC_BODY_LINES) return;
  const sancEffect = effects.find((effect) => isRefinementEffect(effect.effect));
  const sancValue = sancEffect?.value ?? 0;
  const classicSanc = refinement - 9;
  const mult = metadata.grade >= 5 && metadata.grade <= 8 ? 2 : 1;
  let text: string | null = null;

  if (refinement >= 10 && sancValue >= 230 && classicSanc > 0) {
    const sancCalc = (sancValue - 230) % 4;
    if (sancCalc === 0) text = `Absorção de Dano : ${8 * mult}%`;
    if (sancCalc === 1) text = `Dano de Perfuração : ${mult * 40 * classicSanc}`;
    if (sancCalc === 2) text = `Velocidade de Skill : ${2 * mult}%`;
    if (sancCalc === 3) text = `Dano Adicional : ${mult * 40 * classicSanc}`;
  } else {
    if (metadata.grade === 5) text = "Absorção de Dano : 8%";
    if (metadata.grade === 6) text = "Dano de Perfuração : 40";
    if (metadata.grade === 7) text = "Velocidade de Skill : 2%";
    if (metadata.grade === 8) text = "Dano Adicional : 40";
  }

  if (text) lines.push({ text, tone: "refinement" });
}

function appendRefinement(
  lines: GameTooltipLine[],
  refinement: number,
  ancient: boolean,
): void {
  if (refinement > 0 && lines.length < MAX_CLASSIC_BODY_LINES) {
    lines.push({ text: `Refinação : +${refinement}`, tone: "refinement" });
  }
  if (ancient && lines.length < MAX_CLASSIC_BODY_LINES) {
    lines.push({ text: "Item Ancient", tone: "refinement" });
  }
}

function staticEffectValue(metadata: ClassicCommerceItem, effect: number): number {
  let value = 0;
  for (const candidate of metadata.effects) {
    if (candidate.effect === effect) value += candidate.value;
  }
  return value;
}

function classicRefinement(effects: readonly InventoryItemClassicEffect[]): number {
  const effect = effects.find((candidate) => isRefinementEffect(candidate.effect));
  if (!effect) return 0;
  let value = effect.value;
  if (value < 230) value %= 10;
  else value -= 220;
  if (value >= 10 && value <= 35) value = Math.trunc((value - 10) / 4) + 10;
  return Math.max(0, value);
}

function isRefinementEffect(effect: number): boolean {
  return effect === REFINEMENT_EFFECT
    || (effect >= FIRST_REFINEMENT_COLOR_EFFECT && effect <= LAST_REFINEMENT_COLOR_EFFECT);
}

function applyClassicRefinement(value: number, refinement: number, effect: number): number {
  if (refinement <= 0 || isRefinementInvariant(effect)) return value;
  if (refinement <= 10) return Math.trunc(value * (refinement + 10) / 10);
  const multiplier = [0, 220, 250, 280, 320, 370, 400][refinement - 10];
  if (multiplier === undefined) return value;
  // Preserve the two integer divisions performed by BASE_GetItemAbility.
  return Math.trunc(Math.trunc(multiplier * 10 * value / 100) / 10);
}

function isRefinementInvariant(effect: number): boolean {
  return effect === 17
    || effect === CLASS_EFFECT
    || effect === 21
    || effect === 27
    || effect === LEVEL_EFFECT
    || (effect >= 22 && effect <= 25)
    || effect === 38
    || effect === 47
    || effect === 48
    || effect === 78
    || effect === 84
    || effect === 86
    || effect === 87
    || effect === 88
    || effect === 112
    || effect === 113;
}

function formatEffect(effect: number, value: number): string {
  return `${CLASSIC_EFFECT_LABELS[effect] ?? `Efeito ${effect}`} : ${formatEffectValue(effect, value)}`;
}

function formatEffectValue(effect: number, value: number): string {
  if (effect === 40 || effect === 42) return `${Math.trunc(value / 10)}.${Math.abs(value % 10)}%`;
  if (effect === 26 || effect === 45 || effect === 46 || effect === 60 || effect === 68) return `${value}%`;
  return String(value);
}

function classicOptionTone(position: number, effect: number, value: number): GameTooltipLineTone {
  if (position >= 64) {
    if (position !== 64 && position !== 128 && position !== 192) return "option-common";
    if (effect === DAMAGE_EFFECT || effect === 73 || effect === 67) {
      return thresholdTone(value, 45, 54);
    }
    if (effect === 60 || effect === 68 || effect === 26 || effect === 74) {
      return thresholdTone(value, 20, 24);
    }
    return "option-common";
  }
  if (effect === 60 || effect === 68) {
    if (position === 2) return thresholdTone(value, 12, 14);
    return value < 6 ? "option-common" : value === 6 ? "option-good" : "option-superior";
  }
  if (effect === 42 || effect === 71) return thresholdTone(value, 50, 59);
  if (effect === 26 || effect === 74) {
    return value < 12 ? "option-common" : value === 12 ? "option-good" : "option-superior";
  }
  if (effect === DEFENSE_EFFECT || effect === 53 || effect === 72) {
    const threshold = position === 16 ? 30 : 15;
    return value < threshold ? "option-common" : value === threshold ? "option-good" : "option-superior";
  }
  if (effect === DAMAGE_EFFECT || effect === 73 || effect === 67) {
    if (position === 32) return thresholdTone(value, 24, 30);
    return value < 18 ? "option-common" : value === 18 ? "option-good" : "option-superior";
  }
  if (effect === 4 || effect === 45 || effect === 69) {
    return value < 40 ? "option-common" : value === 40 ? "option-good" : "option-superior";
  }
  return "option-common";
}

function thresholdTone(value: number, goodMin: number, goodMax: number): GameTooltipLineTone {
  if (value < goodMin) return "option-common";
  if (value <= goodMax) return "option-good";
  return "option-superior";
}

function classicItemTitle(name: string, refinement: number | undefined): string {
  const clean = displayName(name).replace(/\s+\+\d+\s*$/u, "");
  return refinement && refinement > 0 ? `${clean} +${refinement}` : clean;
}

function isMountItem(metadata: ClassicCommerceItem): boolean {
  return metadata.index >= 2330 && metadata.index <= 2389;
}

function displayName(name: string): string {
  return name.replaceAll("_", " ").trim() || "Item sem nome";
}

function formatNumber(value: number): string {
  return Math.trunc(value).toLocaleString("pt-BR");
}
