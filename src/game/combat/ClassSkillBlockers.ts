/**
 * Client-visible reasons why an imported, non-passive SkillData record cannot
 * be executed honestly by the current offline runtime.
 *
 * These are not runtime definitions. The skill catalog and coverage audit use
 * this boundary list so unknown server rules never become invented frontend
 * gameplay.
 */
export const CLASSIC_SKILL_RUNTIME_BLOCKERS: Readonly<Record<number, string>> = Object.freeze({
  31: "exige um jogador aliado morto e confirmação autoritativa de renascimento",
  42: "exige grupo, consentimento, restrições de mapa e teleporte do servidor",
  221: "o affect PvP e sua duração efetiva são aceitos pelo servidor",
  223: "registro master sem instance, tick, affect ou renderer no cliente recuperado",
  226: "redução de resistência e aplicação do affect são fórmulas do servidor",
  229: "InstanceValue 9 só é convertido em entidade pelo servidor via MSG_CreateMob",
  241: "registro master sem instance, tick, affect ou renderer no cliente recuperado",
  246: "Affect 47 e o dano periódico de Bleeding pertencem ao servidor",
});
