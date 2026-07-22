export type AutoCombatMode = "off" | "physical" | "magic" | "support";
export type AutoCombatPositionMode = "continuous" | "fixed" | "stationary";

export const AUTO_COMBAT_MODES = ["off", "physical", "magic", "support"] as const satisfies readonly AutoCombatMode[];

/**
 * B_CCATTACK advances g_GameAuto in the retail client. The web runtime keeps
 * all four retail modes: 0/off, 1/MAutoAttack, 2/AutoSkillUse and 3/support.
 */
export function nextAutoCombatMode(mode: AutoCombatMode): AutoCombatMode {
  const index = AUTO_COMBAT_MODES.indexOf(mode);
  return AUTO_COMBAT_MODES[(index + 1) % AUTO_COMBAT_MODES.length] ?? "off";
}

export function isAutoCombatMode(value: string | undefined): value is AutoCombatMode {
  return AUTO_COMBAT_MODES.some((mode) => mode === value);
}

export const AUTO_COMBAT_POSITION_MODES = ["continuous", "fixed", "stationary"] as const satisfies readonly AutoCombatPositionMode[];

export function nextAutoCombatPositionMode(mode: AutoCombatPositionMode): AutoCombatPositionMode {
  const index = AUTO_COMBAT_POSITION_MODES.indexOf(mode);
  return AUTO_COMBAT_POSITION_MODES[(index + 1) % AUTO_COMBAT_POSITION_MODES.length] ?? "continuous";
}
