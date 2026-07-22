/**
 * Retail constants for special skill #101, Força Espectral.
 *
 * SkillData marks it as a zero-cost passive. The classic client tests bit 29
 * of LearnedSkill[0], adds one cell to attack range and tags each outgoing
 * attack with DoubleCritical bit 3 so OnPacketAttack starts the weapon-owned
 * SForce visual. This offline client treats the passive as permanently learned.
 */
export const SPECTRAL_FORCE = Object.freeze({
  classicIndex: 101,
  pseudoItemIndex: 5101,
  skillBookItemIndex: 671,
  learnedSkillMask: 0x20000000,
  doubleCriticalFlag: 0x08,
  attackRangeBonus: 1,
  alwaysLearned: true,
  weaponEffectType: 2,
});

