import type { ClassicManifest } from "../assets/ClassicAssetSource";

export type ClassicFieldEntry = ClassicManifest["fields"][number];

export interface FieldRegion {
  readonly fields: readonly ClassicFieldEntry[];
  readonly containsArmia: boolean;
}

export interface ClassicMapIdentity {
  /** Nome apresentado ao jogador. */
  readonly name: string;
  /** Agrupamento canônico usado no seletor. */
  readonly region: string;
}

/*
 * Nomes confirmados no cliente clássico:
 *
 * - Basedef.cpp / g_pGuildZone: Armia, Azran, Erion e Nippleheim;
 * - Lang/PT/PotalPos.txt: Noatun, Dungeon Negro, Submundo, Deserto Kult e Kefra;
 * - tools/data/NPCGener.txt: Pergaminhos, Pesadelos, Carta de Duelo, Zona de Lan
 *   e o mapa isolado de Gelo.
 *
 * Os arquivos TRN restantes trazem literalmente "Field" no cabeçalho. Para eles
 * usamos "Campo clássico", sem atribuir um nome que não existe nos dados.
 */
const NAMED_FIELDS = new Map<string, ClassicMapIdentity>([
  ["16,16", { name: "Armia", region: "Mundo principal" }],
  ["19,13", { name: "Azran", region: "Mundo principal" }],
  ["19,15", { name: "Erion", region: "Mundo principal" }],
  ["8,13", { name: "Noatun", region: "Mundo principal" }],

  ["6,28", { name: "Carta de Duelo", region: "Carta de Duelo" }],
  ["8,2", { name: "Pesadelo M · Armia", region: "Pesadelo" }],
  ["10,2", { name: "Pesadelo N · Erion", region: "Pesadelo" }],
  ["8,27", { name: "Pergaminho N", region: "Pergaminhos" }],
  ["9,28", { name: "Pergaminho M", region: "Pergaminhos" }],
  ["10,27", { name: "Pergaminho A", region: "Pergaminhos" }],
  ["28,28", { name: "Zona de Lan N", region: "Zona de Lan" }],
  ["29,27", { name: "Zona de Lan M", region: "Zona de Lan" }],
  ["30,28", { name: "Zona de Lan A", region: "Zona de Lan" }],
  ["31,31", { name: "Gelo", region: "Gelo" }],
]);

const NIPPLEHEIM_FIELDS = new Set([
  "28,21",
  "27,22",
  "28,22",
  "29,22",
  "30,22",
  "27,23",
  "28,23",
  "29,23",
  "28,24",
]);

const KEFRA_FIELDS = new Set(["17,30", "18,30", "19,30", "17,31", "18,31", "19,31"]);

export function fieldKey(column: number, row: number): string {
  return `${column},${row}`;
}

/**
 * Agrupa os Fields que realmente compartilham uma borda na grade clássica.
 * Diagonais não são conexões: o cliente só faz streaming N/S/L/O.
 */
export function connectedFieldRegions(fields: readonly ClassicFieldEntry[]): readonly FieldRegion[] {
  const entries = new Map(fields.map((field) => [fieldKey(field.column, field.row), field]));
  const pending = new Set(entries.keys());
  const regions: FieldRegion[] = [];

  while (pending.size > 0) {
    const first = pending.values().next().value as string;
    const queue = [first];
    const connected: ClassicFieldEntry[] = [];
    pending.delete(first);

    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) continue;
      const field = entries.get(key);
      if (!field) continue;
      connected.push(field);

      const neighbours = [
        fieldKey(field.column - 1, field.row),
        fieldKey(field.column + 1, field.row),
        fieldKey(field.column, field.row - 1),
        fieldKey(field.column, field.row + 1),
      ];
      for (const neighbour of neighbours) {
        if (!pending.delete(neighbour)) continue;
        queue.push(neighbour);
      }
    }

    connected.sort((a, b) => a.row - b.row || a.column - b.column);
    regions.push({
      fields: connected,
      containsArmia: connected.some((field) => field.column === 16 && field.row === 16),
    });
  }

  regions.sort((a, b) => {
    if (a.containsArmia !== b.containsArmia) return a.containsArmia ? -1 : 1;
    if (a.fields.length !== b.fields.length) return b.fields.length - a.fields.length;
    const firstA = a.fields[0];
    const firstB = b.fields[0];
    if (!firstA || !firstB) return 0;
    return firstA.row - firstB.row || firstA.column - firstB.column;
  });
  return regions;
}

export function formatFieldName(column: number, row: number): string {
  return `Field ${String(column).padStart(2, "0")} · ${String(row).padStart(2, "0")}`;
}

export function fieldMapIdentity(column: number, row: number): ClassicMapIdentity {
  const key = fieldKey(column, row);
  const named = NAMED_FIELDS.get(key);
  if (named) return named;

  if (NIPPLEHEIM_FIELDS.has(key)) return { name: "Nippleheim", region: "Nippleheim" };
  if (KEFRA_FIELDS.has(key)) return { name: "Kefra", region: "Kefra" };

  // O cliente seleciona a trilha de Submundo exatamente neste intervalo.
  if (column > 8 && column < 16 && row > 25) {
    return { name: "Submundo", region: "Submundo" };
  }

  // PotalPos situa os três pisos do Dungeon Negro nestes Fields.
  if (column <= 8 && row >= 29) {
    return { name: "Dungeon Negro", region: "Dungeon Negro" };
  }

  // A mesma janela é usada por TMGround/TMFieldScene para o Deserto Kult.
  if (column >= 7 && column <= 12 && row >= 11 && row <= 14) {
    return { name: "Deserto Kult", region: "Deserto Kult" };
  }

  // Os mapas de Pesadelo compartilham este modo temporizado no cliente.
  if (column > 1 && column < 11 && row < 5) {
    return { name: "Pesadelo", region: "Pesadelo" };
  }

  // Limites do conjunto de Fields que forma o mundo exterior principal.
  if (column >= 13 && column <= 20 && row >= 9 && row <= 17) {
    return { name: "Mundo principal", region: "Mundo principal" };
  }

  return { name: "Campo clássico", region: "Campos clássicos" };
}

export function formatMapOptionName(column: number, row: number): string {
  return `${fieldMapIdentity(column, row).name} — ${formatFieldName(column, row)}`;
}

export function formatRegionTitle(region: FieldRegion): string {
  if (region.containsArmia) return "Mundo principal · Armia, Azran, Erion e Noatun";

  const names = [...new Set(region.fields.map((field) => fieldMapIdentity(field.column, field.row).region))];
  const canonical = names.filter((name) => name !== "Campos clássicos");
  if (canonical.length === 0) return "Campos clássicos";
  if (canonical.length <= 3) return canonical.join(" · ");
  return `${canonical.slice(0, 3).join(" · ")} +${canonical.length - 3}`;
}
