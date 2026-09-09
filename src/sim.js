import { BLOCKS, ITEMS, RECIPES } from "./data.js";

export const SEA_LEVEL = 8;
export function hashSeed(value) {
  let h = 2166136261;
  for (const c of String(value)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function noise2(x, z, seed = 1) {
  let n =
    Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 69069);
  n = n ^ (n >>> 13);
  return (
    ((Math.imul(n, n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) /
    0x7fffffff
  );
}
export function smoothNoise(x, z, seed) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const s = (t) => t * t * (3 - 2 * t);
  const a = noise2(ix, iz, seed),
    b = noise2(ix + 1, iz, seed),
    c = noise2(ix, iz + 1, seed),
    d = noise2(ix + 1, iz + 1, seed);
  return a + (b - a) * s(fx) + (c - a + (d - c - b + a) * s(fx)) * s(fz);
}
export function biomeAt(x, z, seed) {
  const continental = smoothNoise(x / 55, z / 55, seed),
    temp = smoothNoise(x / 80, z / 80, seed + 7),
    rugged = smoothNoise(x / 30, z / 30, seed + 19);
  if (continental < 0.29)
    return temp < 0.32
      ? "frozen_ocean"
      : continental < 0.18
        ? "deep_ocean"
        : temp > 0.64
          ? "warm_ocean"
          : "ocean";
  if (rugged > 0.72) return "mountains";
  if (temp > 0.67) return "desert";
  if (temp < 0.28) return "snowy";
  return smoothNoise(x / 22, z / 22, seed + 33) > 0.53 ? "forest" : "plains";
}
export function terrainHeight(x, z, seed) {
  const b = biomeAt(x, z, seed),
    base = smoothNoise(x / 45, z / 45, seed + 101),
    detail = smoothNoise(x / 11, z / 11, seed + 211);
  if (b.includes("ocean"))
    return Math.floor((b === "deep_ocean" ? 1 : 4) + base * 3);
  if (b === "mountains") return Math.floor(10 + base * 12 + detail * 4);
  return Math.floor(8 + base * 4 + detail * 2);
}
export const keyOf = (x, y, z) =>
  `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
export function generatedBlock(x, y, z, seed) {
  if (y < 0) return "bedrock";
  const h = terrainHeight(x, z, seed),
    b = biomeAt(x, z, seed);
  if (y > h) return y <= SEA_LEVEL ? "water" : null;
  if (y === h) {
    if (b === "desert") return "sand";
    if (b === "snowy" || b === "frozen_ocean") return "snow";
    if (b.includes("ocean"))
      return b === "warm_ocean" && noise2(x, z, seed + 99) > 0.92
        ? "coral_red"
        : "sand";
    return "grass";
  }
  if (y > h - 3)
    return b === "desert"
      ? "sandstone"
      : b.includes("ocean")
        ? noise2(x, y + z, seed) > 0.75
          ? "clay"
          : "sand"
        : "dirt";
  const ore = noise2(x * 3 + y, z * 3 - y, seed + 77);
  if (y < 4 && ore > 0.985) return "diamond_ore";
  if (y < 7 && ore > 0.97) return "gold_ore";
  if (y < 10 && ore > 0.94) return "iron_ore";
  if (ore > 0.9) return "coal_ore";
  return "stone";
}

export class Inventory {
  constructor(slots = 36) {
    this.slots = Array(slots).fill(null);
  }
  count(id) {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }
  add(id, count = 1, meta = {}) {
    let left = count;
    for (const s of this.slots)
      if (s?.id === id && s.count < 64) {
        const d = Math.min(64 - s.count, left);
        s.count += d;
        left -= d;
        if (!left) return 0;
      }
    for (let i = 0; i < this.slots.length && left; i++)
      if (!this.slots[i]) {
        const d = Math.min(64, left);
        this.slots[i] = { id, count: d, ...meta };
        left -= d;
      }
    return left;
  }
  remove(id, count = 1) {
    if (this.count(id) < count) return false;
    for (let i = this.slots.length - 1; i >= 0 && count; i--) {
      const s = this.slots[i];
      if (s?.id === id) {
        const d = Math.min(s.count, count);
        s.count -= d;
        count -= d;
        if (!s.count) this.slots[i] = null;
      }
    }
    return true;
  }
  canCraft(recipe) {
    return Object.entries(recipe.in).every(([id, n]) => this.count(id) >= n);
  }
  craft(recipe) {
    if (!this.canCraft(recipe)) return false;
    for (const [id, n] of Object.entries(recipe.in)) this.remove(id, n);
    for (const [id, n] of Object.entries(recipe.out)) this.add(id, n);
    return true;
  }
  serialize() {
    return this.slots;
  }
  static from(data) {
    const i = new Inventory();
    if (Array.isArray(data))
      i.slots = data
        .slice(0, 36)
        .concat(Array(Math.max(0, 36 - data.length)).fill(null));
    return i;
  }
}

export function canHarvest(blockId, itemId) {
  const block = BLOCKS[blockId];
  if (!block?.tool) return true;
  const item = ITEMS[itemId];
  if (!item) return false;
  if (block.tool === "pickaxe") return item.tool === "pickaxe";
  if (block.tool === "stone_pickaxe")
    return item.tool === "pickaxe" && item.tier >= 2;
  if (block.tool === "iron_pickaxe")
    return item.tool === "pickaxe" && item.tier >= 3;
  return item.tool === block.tool;
}
export function breakSeconds(blockId, itemId) {
  const block = BLOCKS[blockId];
  const item = ITEMS[itemId];
  const correct = canHarvest(blockId, itemId);
  return block.hardness / (correct ? 1 + (item?.tier || 1) * 1.8 : 0.45);
}
export function tickSurvival(
  player,
  dt,
  { underwater = false, difficulty = "normal" } = {},
) {
  player.hunger = Math.max(0, player.hunger - dt * 0.005);
  if (underwater) player.oxygen = Math.max(0, player.oxygen - dt);
  else player.oxygen = Math.min(10, player.oxygen + dt * 3);
  if (player.oxygen === 0)
    player.health = Math.max(
      0,
      player.health - dt * (difficulty === "peaceful" ? 0 : 1),
    );
  if (player.hunger === 0)
    player.health = Math.max(
      difficulty === "normal" ? 1 : 0,
      player.health - dt * 0.2,
    );
  else if (player.hunger > 16 && player.health < 20)
    player.health = Math.min(20, player.health + dt * 0.05);
  return player;
}
export function growCrop(stage, ticks, light = 15) {
  return light >= 9 ? Math.min(7, stage + Math.floor(ticks / 1200)) : stage;
}
export const SMELTING = { raw_iron: "iron_ingot" };
export function smelt(inventory, input) {
  const output = SMELTING[input];
  if (!output || inventory.count(input) < 1 || inventory.count("coal") < 1)
    return false;
  inventory.remove(input, 1);
  inventory.remove("coal", 1);
  inventory.add(output, 1);
  return true;
}
export function tridentEffect(enchant, ctx) {
  if (enchant === "loyalty") return { returns: true };
  if (enchant === "riptide") return { launch: ctx.wet ? 18 : 0 };
  if (enchant === "channeling") return { lightning: !!ctx.thunder };
  if (enchant === "impaling") return { damage: ctx.aquatic ? 13 : 8 };
  return { damage: 8 };
}
export function serializeSave(state) {
  return JSON.stringify({
    version: 1,
    ...state,
    inventory: state.inventory.serialize(),
  });
}
export function parseSave(raw) {
  try {
    const d = JSON.parse(raw);
    if (d.version !== 1 || typeof d.seed !== "number" || !d.player)
      throw Error("invalid save");
    return { ...d, inventory: Inventory.from(d.inventory) };
  } catch {
    return null;
  }
}
export { RECIPES };
