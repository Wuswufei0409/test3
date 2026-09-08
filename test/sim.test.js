import {describe,it,expect} from 'vitest';
import {hashSeed,biomeAt,terrainHeight,generatedBlock,Inventory,canHarvest,breakSeconds,growCrop,tickSurvival,tridentEffect,serializeSave,parseSave,RECIPES} from '../src/sim.js';

describe('deterministic world',()=>{
  it('repeats terrain for the same seed',()=>{const s=hashSeed('aquatic-140');const a=Array.from({length:30},(_,i)=>[biomeAt(i*7,i*-3,s),terrainHeight(i*7,i*-3,s),generatedBlock(i,2,i,s)]);expect(a).toEqual(Array.from({length:30},(_,i)=>[biomeAt(i*7,i*-3,s),terrainHeight(i*7,i*-3,s),generatedBlock(i,2,i,s)]))});
  it('changes terrain between seeds',()=>{const heights=s=>Array.from({length:12},(_,i)=>terrainHeight(51+i*13,18-i*7,hashSeed(s)));expect(heights('a')).not.toEqual(heights('b'))});
});

describe('inventory and progression',()=>{
  it('stacks, splits, removes and handles full storage',()=>{const i=new Inventory(2);expect(i.add('stone',70)).toBe(0);expect(i.slots).toEqual([{id:'stone',count:64},{id:'stone',count:6}]);expect(i.remove('stone',65)).toBe(true);expect(i.count('stone')).toBe(5);expect(i.add('dirt',70)).toBe(6)});
  it('crafts wood to stone to iron tools from config',()=>{const i=new Inventory();i.add('log',6);i.add('cobble',3);i.add('iron_ingot',3);for(const id of['planks','planks','planks','planks','stick','stick','crafting_table','wooden_pickaxe','stone_pickaxe','iron_pickaxe']){const r=RECIPES.find(x=>x.id===id);expect(i.craft(r),id).toBe(true)}expect(i.count('iron_pickaxe')).toBe(1)});
  it('enforces mining tiers and changes speed',()=>{expect(canHarvest('iron_ore','wooden_pickaxe')).toBe(false);expect(canHarvest('iron_ore','stone_pickaxe')).toBe(true);expect(canHarvest('diamond_ore','stone_pickaxe')).toBe(false);expect(breakSeconds('stone','iron_pickaxe')).toBeLessThan(breakSeconds('stone','wooden_pickaxe'))});
});

describe('survival, farming and aquatic mechanics',()=>{
  it('depletes oxygen then applies drowning damage',()=>{const p={health:20,hunger:20,oxygen:1};tickSurvival(p,2,{underwater:true,difficulty:'normal'});expect(p.oxygen).toBe(0);expect(p.health).toBeLessThan(20)});
  it('grows crops only in enough light',()=>{expect(growCrop(1,3600,15)).toBe(4);expect(growCrop(1,3600,5)).toBe(1)});
  it('verifies four trident effects deterministically',()=>{expect(tridentEffect('loyalty',{}).returns).toBe(true);expect(tridentEffect('riptide',{wet:true}).launch).toBe(18);expect(tridentEffect('channeling',{thunder:true}).lightning).toBe(true);expect(tridentEffect('impaling',{aquatic:true}).damage).toBe(13)});
});

describe('save safety',()=>{
  it('round trips world state',()=>{const inventory=new Inventory();inventory.add('stone',12);const state={seed:42,player:{x:1,y:2,z:3},inventory,modifications:[['1,2,3',null]]};const parsed=parseSave(serializeSave(state));expect(parsed.seed).toBe(42);expect(parsed.inventory.count('stone')).toBe(12)});
  it('rejects corrupt saves safely',()=>{expect(parseSave('{bad')).toBeNull();expect(parseSave('{"version":99}')).toBeNull()});
});
