import * as THREE from "three";
import "./style.css";
import {
  BLOCKS,
  ITEMS,
  ALL_DEFINITIONS,
  HOTBAR_DEFAULT,
  RECIPES,
} from "./data.js";
import {
  SEA_LEVEL,
  hashSeed,
  noise2,
  biomeAt,
  terrainHeight,
  generatedBlock,
  keyOf,
  Inventory,
  canHarvest,
  breakSeconds,
  tickSurvival,
  serializeSave,
  parseSave,
  smelt,
} from "./sim.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#game");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x79b7dc);
scene.fog = new THREE.Fog(0x91bdd0, 25, 76);
const camera = new THREE.PerspectiveCamera(
  72,
  innerWidth / innerHeight,
  0.08,
  120,
);
camera.rotation.order = "YXZ";
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
scene.add(new THREE.HemisphereLight(0xc8eaff, 0x5b6455, 1.9));
const sun = new THREE.DirectionalLight(0xfff3d0, 2);
sun.position.set(35, 50, 20);
scene.add(sun);
const worldGroup = new THREE.Group();
const entityGroup = new THREE.Group();
const dropsGroup = new THREE.Group();
const projectileGroup = new THREE.Group();
scene.add(worldGroup, entityGroup, dropsGroup, projectileGroup);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const topGeo = new THREE.PlaneGeometry(1, 1);
topGeo.rotateX(-Math.PI / 2);
const baseGeo = new THREE.PlaneGeometry(224, 224);
baseGeo.rotateX(-Math.PI / 2);
const raycaster = new THREE.Raycaster();
raycaster.far = 6;
const center = new THREE.Vector2(0, 0);
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012)),
  new THREE.LineBasicMaterial({ color: 0x111111 }),
);
outline.visible = false;
scene.add(outline);

let seedText = "tidalcraft",
  seed = hashSeed(seedText),
  started = false,
  selected = 0,
  last = performance.now(),
  lastHud = 0,
  yaw = 0,
  pitch = 0,
  frameTimes = [],
  saveTimer = 0,
  breakState = null;
let modifications = new Map(),
  blockMeshes = [],
  entities = [],
  drops = [],
  projectiles = [],
  keys = {},
  chunks = new Set(),
  chunkCenter = "",
  difficulty = "normal";
let stations = new Map(),
  restoredEntities = null,
  carried = null;
const VIEW_DISTANCE = 6;
let player = {
  x: 0,
  y: 15,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  health: 20,
  hunger: 20,
  oxygen: 10,
  onGround: false,
  time: 6000,
  spawn: { x: 0, y: 15, z: 0 },
  dead: false,
};
let inventory = new Inventory();
HOTBAR_DEFAULT.forEach(
  (id, i) =>
    (inventory.slots[i] = {
      id,
      count: id === "wooden_pickaxe" || id === "trident" ? 1 : 32,
      durability: ITEMS[id]?.durability,
    }),
);
inventory.add("bread", 5);
inventory.add("arrow", 16);
inventory.add("wooden_hoe", 1, { durability: 59 });
inventory.add("wheat_seed", 8);

function pixelTexture(id, color) {
  const base = new THREE.Color(color),
    data = new Uint8Array(16 * 16 * 4),
    s = hashSeed(id);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4,
        n = (noise2(x, y, s) - 0.5) * 0.22,
        band =
          (id === "log" && x % 5 === 0) ||
          (id.includes("planks") && y % 4 === 0)
            ? -0.18
            : 0;
      data[i] = Math.max(0, Math.min(255, (base.r + n + band) * 255));
      data[i + 1] = Math.max(0, Math.min(255, (base.g + n + band) * 255));
      data[i + 2] = Math.max(0, Math.min(255, (base.b + n + band) * 255));
      data[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
function materialFor(id) {
  const d = BLOCKS[id];
  return new THREE.MeshLambertMaterial({
    map: pixelTexture(id, d.color),
    transparent: !!d.transparent,
    opacity: id === "water" ? 0.62 : d.transparent ? 0.82 : 1,
    depthWrite: id !== "water",
    flatShading: true,
  });
}
const materials = new Map(
  Object.keys(BLOCKS).map((id) => [id, materialFor(id)]),
);
function actualBlock(x, y, z) {
  const k = keyOf(x, y, z);
  return modifications.has(k)
    ? modifications.get(k)
    : generatedBlock(Math.floor(x), Math.floor(y), Math.floor(z), seed);
}
function buildWorld() {
  while (worldGroup.children.length) worldGroup.remove(worldGroup.children[0]);
  blockMeshes = [];
  chunks.clear();
  const px = Math.floor(player.x / 16),
    pz = Math.floor(player.z / 16),
    byType = {},
    surfaces = {};
  chunkCenter = `${px},${pz}`;
  const base = new THREE.Mesh(baseGeo, materials.get("stone"));
  base.position.set(player.x, -0.49, player.z);
  worldGroup.add(base);
  for (let cz = pz - VIEW_DISTANCE; cz <= pz + VIEW_DISTANCE; cz++)
    for (let cx = px - VIEW_DISTANCE; cx <= px + VIEW_DISTANCE; cx++) {
      chunks.add(`${cx},${cz}`);
      for (let z = cz * 16; z < cz * 16 + 16; z++)
        for (let x = cx * 16; x < cx * 16 + 16; x++) {
          const h = terrainHeight(x, z, seed);
          let surfaceY = h,
            id = actualBlock(x, surfaceY, z);
          while (!id && surfaceY > h - 5) id = actualBlock(x, --surfaceY, z);
          const nearPlayer =
            Math.abs(x - player.x) <= 32 && Math.abs(z - player.z) <= 32;
          if (id) {
            if (nearPlayer) (byType[id] ??= []).push({ x, y: surfaceY, z });
            else
              (surfaces[id] ??= []).push({
                x,
                y: surfaceY + 0.501,
                z,
                blockY: surfaceY,
              });
          }
          if (h < SEA_LEVEL) {
            const water = actualBlock(x, SEA_LEVEL, z);
            if (water) {
              if (nearPlayer)
                (byType[water] ??= []).push({ x, y: SEA_LEVEL, z });
              else
                (surfaces[water] ??= []).push({
                  x,
                  y: SEA_LEVEL + 0.501,
                  z,
                  blockY: SEA_LEVEL,
                });
            }
          }
          addFeature(byType, x, h, z);
        }
    }
  for (const [key, id] of modifications) {
    if (!id) continue;
    const [x, y, z] = key.split(",").map(Number);
    if (
      Math.abs(Math.floor(x / 16) - px) <= VIEW_DISTANCE &&
      Math.abs(Math.floor(z / 16) - pz) <= VIEW_DISTANCE
    )
      (byType[id] ??= []).push({ x, y, z });
  }
  for (const [id, poses] of Object.entries(surfaces)) {
    const mesh = new THREE.InstancedMesh(
        topGeo,
        materials.get(id),
        poses.length,
      ),
      o = new THREE.Object3D();
    poses.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.userData = {
      id,
      poses: poses.map((p) => ({ x: p.x, y: p.blockY, z: p.z })),
    };
    mesh.instanceMatrix.needsUpdate = true;
    worldGroup.add(mesh);
    blockMeshes.push(mesh);
  }
  for (const [id, poses] of Object.entries(byType)) {
    const mesh = new THREE.InstancedMesh(
      boxGeo,
      materials.get(id),
      poses.length,
    );
    const o = new THREE.Object3D();
    poses.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.userData = { id, poses };
    mesh.instanceMatrix.needsUpdate = true;
    worldGroup.add(mesh);
    blockMeshes.push(mesh);
  }
  $("#world-label").textContent =
    `${seedText} · ${chunks.size} chunks · view ${VIEW_DISTANCE}`;
}
function add(by, id, x, y, z) {
  (by[id] ??= []).push({ x, y, z });
}
function addFeature(by, x, h, z) {
  const b = biomeAt(x, z, seed),
    n = noise2(x, z, seed + 500);
  if (b === "forest" && n > 0.992) {
    for (let y = 1; y < 5; y++) add(by, "log", x, h + y, z);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (Math.abs(dx) + Math.abs(dz) < 4)
          add(
            by,
            "leaves",
            x + dx,
            h + 4 + (Math.abs(dx) + Math.abs(dz) < 2 ? 1 : 0),
            z + dz,
          );
  }
  if (b === "desert" && n > 0.995)
    for (let y = 1; y < 4; y++) add(by, "cactus", x, h + y, z);
  if (b.includes("ocean") && n > 0.988) {
    const id =
      b === "warm_ocean"
        ? ["coral_red", "coral_blue", "coral_yellow"][Math.floor(n * 100) % 3]
        : "kelp";
    for (let y = h + 1; y < Math.min(SEA_LEVEL, h + 4); y++)
      add(by, id, x, y, z);
  }
  if (b === "frozen_ocean" && n > 0.994)
    for (let y = SEA_LEVEL + 1; y < SEA_LEVEL + 5; y++) add(by, "ice", x, y, z);
  if (b === "ocean" && n > 0.9985) {
    for (let dx = -3; dx <= 3; dx++) add(by, "shipwood", x + dx, h + 1, z);
    add(by, "treasure", x, h + 2, z);
  }
  if (b === "deep_ocean" && n > 0.998) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2)
          add(by, "prismarine", x + dx, h + 1, z + dz);
  }
}

function spawnEntities() {
  while (entityGroup.children.length)
    entityGroup.remove(entityGroup.children[0]);
  entities = [];
  const types = [
    "pig",
    "cow",
    "sheep",
    "chicken",
    "zombie",
    "spider",
    "creeper",
    "dolphin",
    "cod",
    "salmon",
    "tropical_fish",
    "pufferfish",
  ];
  for (let i = 0; i < 30; i++) {
    const a = noise2(i, 7, seed) * Math.PI * 2,
      r = 8 + noise2(i, 8, seed) * 28,
      x = player.x + Math.cos(a) * r,
      z = player.z + Math.sin(a) * r,
      b = biomeAt(x, z, seed),
      aquatic = b.includes("ocean");
    let type = types[(i + seed) % types.length];
    if (aquatic) type = types[7 + (i % 5)];
    else if (type.includes("fish") || type === "dolphin") type = types[i % 7];
    const hostile = ["zombie", "spider", "creeper"].includes(type);
    const colors = {
      pig: 0xe79a9a,
      cow: 0x634434,
      sheep: 0xe8e5db,
      chicken: 0xe8e8df,
      zombie: 0x4d8d55,
      spider: 0x342b2a,
      creeper: 0x56a949,
      dolphin: 0x6995a5,
      cod: 0x9a7951,
      salmon: 0xb76150,
      tropical_fish: 0xf4b64d,
      pufferfish: 0xb9a24a,
    };
    const geo = new THREE.BoxGeometry(
        type === "chicken" ? 0.6 : type.includes("fish") ? 1.1 : 1,
        type === "spider" ? 0.45 : type.includes("fish") ? 0.55 : 1.2,
        type === "spider" ? 1.3 : 0.65,
      ),
      m = new THREE.MeshLambertMaterial({ color: colors[type] });
    const mesh = new THREE.Mesh(geo, m);
    const y = aquatic
      ? Math.max(2, SEA_LEVEL - 2)
      : terrainHeight(x, z, seed) + 1;
    mesh.position.set(x, y, z);
    entityGroup.add(mesh);
    entities.push({
      type,
      hostile,
      mesh,
      hp: hostile ? 12 : 8,
      phase: i,
      speed: 0.4 + noise2(i, 2, seed) * 0.5,
    });
  }
  if (restoredEntities) {
    restoredEntities.slice(0, entities.length).forEach((saved, i) => {
      entities[i].mesh.position.set(saved.x, saved.y, saved.z);
      entities[i].hp = saved.hp;
    });
    restoredEntities = null;
  }
}
function updateEntities(dt) {
  const night = player.time > 13000 && player.time < 23000;
  for (const e of entities) {
    const dx = player.x - e.mesh.position.x,
      dz = player.z - e.mesh.position.z,
      dist = Math.hypot(dx, dz),
      aquatic = [
        "dolphin",
        "cod",
        "salmon",
        "tropical_fish",
        "pufferfish",
      ].includes(e.type);
    if (e.hostile && night && dist < 14) {
      e.mesh.position.x += (dx / dist) * e.speed * dt;
      e.mesh.position.z += (dz / dist) * e.speed * dt;
      if (dist < 1.4 && difficulty !== "peaceful") {
        player.health -= dt * (difficulty === "hard" ? 2 : 1);
        if (e.type === "creeper" && dist < 1.1) explode(e);
      }
    } else {
      e.phase += dt * 0.5;
      e.mesh.position.x += Math.cos(e.phase) * e.speed * dt * 0.25;
      e.mesh.position.z += Math.sin(e.phase) * e.speed * dt * 0.25;
    }
    if (aquatic) e.mesh.position.y = SEA_LEVEL - 2 + Math.sin(e.phase * 2);
    else
      e.mesh.position.y =
        terrainHeight(e.mesh.position.x, e.mesh.position.z, seed) + 0.8;
    if (e.type === "pufferfish") e.mesh.scale.setScalar(dist < 3 ? 1.5 : 1);
    if (e.type === "zombie" && !night)
      e.mesh.material.emissive.setHex(0x5b2100);
  }
}
function explode(e) {
  const p = e.mesh.position;
  for (let x = -2; x <= 2; x++)
    for (let y = -1; y <= 2; y++)
      for (let z = -2; z <= 2; z++)
        if (x * x + y * y + z * z < 6)
          modifications.set(keyOf(p.x + x, p.y + y, p.z + z), null);
  entityGroup.remove(e.mesh);
  entities = entities.filter((v) => v !== e);
  player.health -= 5;
  toast("爬行者爆炸改变了地形");
  buildWorld();
}

function collides(x, y, z) {
  const r = 0.3;
  for (const dx of [-r, r])
    for (const dz of [-r, r])
      for (const dy of [0, 0.9, 1.75]) {
        const id = actualBlock(
          Math.floor(x + dx + 0.5),
          Math.floor(y + dy + 0.5),
          Math.floor(z + dz + 0.5),
        );
        if (id && !BLOCKS[id]?.liquid && !BLOCKS[id]?.transparent) return true;
      }
  return false;
}
function updatePlayer(dt) {
  const underwater =
    player.y < SEA_LEVEL - 0.2 &&
    actualBlock(player.x, player.y + 1, player.z) === "water";
  const speed =
      (keys.ShiftLeft ? 7.2 : keys.KeyC ? 2.1 : 4.3) * (underwater ? 0.72 : 1),
    fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const len = Math.hypot(fwd, side) || 1,
    sy = Math.sin(yaw),
    cy = Math.cos(yaw);
  player.vx = ((side * cy - fwd * sy) / len) * speed;
  player.vz = ((fwd * cy + side * sy) / len) * speed;
  if (underwater) {
    player.vy += (keys.Space ? 8 : -1.4) * dt;
    player.vy *= 0.9;
  } else player.vy -= 22 * dt;
  if (keys.Space && player.onGround) {
    player.vy = 8;
    player.onGround = false;
  }
  let nx = player.x + player.vx * dt;
  if (!collides(nx, player.y, player.z)) player.x = nx;
  else if (!collides(nx, player.y + 0.55, player.z))
    ((player.y += 0.55), (player.x = nx));
  let nz = player.z + player.vz * dt;
  if (!collides(player.x, player.y, nz)) player.z = nz;
  let ny = player.y + player.vy * dt;
  if (!collides(player.x, ny, player.z)) {
    player.y = ny;
    player.onGround = false;
  } else {
    if (player.vy < 0) player.onGround = true;
    player.vy = 0;
  }
  if (player.y < 0) {
    damage(99);
    respawn();
  }
  tickSurvival(player, dt, { underwater, difficulty });
  $("#underwater").style.opacity = underwater ? 1 : 0;
  $("#oxygen-row").style.display = underwater ? "block" : "none";
  camera.position.set(
    player.x,
    player.y + 1.62 - (keys.KeyC ? 0.35 : 0),
    player.z,
  );
  camera.rotation.set(pitch, yaw, 0);
  if (player.health <= 0 && !player.dead) {
    player.dead = true;
    for (const s of inventory.slots)
      if (s) spawnDrop(player.x, player.y + 1, player.z, s.id, s.count);
    inventory = new Inventory();
    toast("你死了 — 正在重生");
    setTimeout(respawn, 1700);
  }
  const currentChunk = `${Math.floor(player.x / 16)},${Math.floor(player.z / 16)}`;
  if (currentChunk !== chunkCenter) buildWorld();
}
function damage(n) {
  player.health = Math.max(0, player.health - n);
}
function respawn() {
  Object.assign(player, {
    ...player.spawn,
    vx: 0,
    vy: 0,
    vz: 0,
    health: 20,
    hunger: 20,
    oxygen: 10,
    dead: false,
  });
}
function spawnDrop(x, y, z, id, count = 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.28, 0.28),
    new THREE.MeshLambertMaterial({ color: BLOCKS[id]?.color || 0xf3d26b }),
  );
  mesh.position.set(x, y, z);
  dropsGroup.add(mesh);
  drops.push({ mesh, id, count, age: 0 });
}
function updateDrops(dt) {
  for (const d of [...drops]) {
    d.age += dt;
    d.mesh.rotation.y += dt * 2;
    d.mesh.position.y += Math.sin(d.age * 3) * 0.001;
    const dist = d.mesh.position.distanceTo(camera.position);
    if (dist < 1.7) {
      const left = inventory.add(d.id, d.count);
      if (!left) {
        dropsGroup.remove(d.mesh);
        drops = drops.filter((x) => x !== d);
        toast(`拾取 ${ALL_DEFINITIONS[d.id]?.name || d.id}`);
        renderHud();
      }
    }
  }
  updateProjectiles(dt);
}
function throwWeapon(id) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const mesh = new THREE.Mesh(
    id === "trident"
      ? new THREE.CylinderGeometry(0.06, 0.06, 1.2, 5)
      : new THREE.BoxGeometry(0.08, 0.08, 0.55),
    new THREE.MeshLambertMaterial({
      color: id === "trident" ? 0x72b9b5 : 0x6d5635,
    }),
  );
  mesh.position.copy(camera.position).add(dir.clone());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  projectileGroup.add(mesh);
  projectiles.push({ mesh, id, dir, age: 0 });
  const slot = inventory.slots[selected];
  if (slot?.durability) slot.durability--;
  if (id === "bow") inventory.remove("arrow", 1);
  renderHud();
}
function updateProjectiles(dt) {
  for (const p of [...projectiles]) {
    p.age += dt;
    const returning = p.id === "trident" && p.age > 0.65;
    if (returning) {
      const d = camera.position.clone().sub(p.mesh.position),
        distance = d.length();
      p.mesh.position.add(d.normalize().multiplyScalar(dt * 18));
      if (distance < 1) {
        projectileGroup.remove(p.mesh);
        projectiles = projectiles.filter((x) => x !== p);
        continue;
      }
    } else
      p.mesh.position.add(
        p.dir.clone().multiplyScalar(dt * (p.id === "trident" ? 18 : 25)),
      );
    for (const e of entities) {
      if (e.mesh.position.distanceTo(p.mesh.position) < 0.8) {
        const aquatic = [
          "dolphin",
          "cod",
          "salmon",
          "tropical_fish",
          "pufferfish",
        ].includes(e.type);
        e.hp -= p.id === "trident" ? (aquatic ? 13 : 8) : 5;
        e.mesh.material.emissive.setHex(0xffffff);
        if (e.hp <= 0) {
          spawnDrop(
            e.mesh.position.x,
            e.mesh.position.y,
            e.mesh.position.z,
            aquatic ? "bread" : "raw_iron",
          );
          entityGroup.remove(e.mesh);
          entities = entities.filter((x) => x !== e);
        }
        if (p.id !== "trident") p.age = 99;
        break;
      }
    }
    if (p.age > 3) {
      projectileGroup.remove(p.mesh);
      projectiles = projectiles.filter((x) => x !== p);
    }
  }
}

function target() {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  let blockHit = null,
    previous = null;
  for (let distance = 0.15; distance <= 6; distance += 0.12) {
    const point = camera.position.clone().addScaledVector(direction, distance),
      position = {
        x: Math.floor(point.x + 0.5),
        y: Math.floor(point.y + 0.5),
        z: Math.floor(point.z + 0.5),
      },
      id = actualBlock(position.x, position.y, position.z);
    if (id && !BLOCKS[id]?.liquid) {
      const normal = previous
        ? new THREE.Vector3(
            previous.x - position.x,
            previous.y - position.y,
            previous.z - position.z,
          )
        : direction.clone().negate().round();
      blockHit = {
        object: { userData: { poses: [position] } },
        instanceId: 0,
        point,
        face: { normal },
        distance,
      };
      break;
    }
    previous = position;
  }
  let entityHit = null;
  for (const entity of entities) {
    const relative = entity.mesh.position.clone().sub(camera.position),
      distance = relative.dot(direction);
    if (distance <= 0 || distance > 6 || distance >= (blockHit?.distance ?? 7))
      continue;
    const perpendicular = relative
      .clone()
      .sub(direction.clone().multiplyScalar(distance))
      .length();
    if (perpendicular < 0.85 && (!entityHit || distance < entityHit.distance))
      entityHit = { object: entity.mesh, distance };
  }
  return entityHit || blockHit;
}
function actPlace() {
  const hit = target();
  if (!hit || entityGroup.children.includes(hit.object)) return;
  const base = hit.object.userData.poses[hit.instanceId],
    p = new THREE.Vector3(
      base.x + hit.face.normal.x,
      base.y + hit.face.normal.y,
      base.z + hit.face.normal.z,
    );
  const slot = inventory.slots[selected];
  if (!slot || !BLOCKS[slot.id] || BLOCKS[slot.id].liquid)
    return toast("选择一个可放置方块");
  if (
    collides(p.x, p.y, p.z) ||
    (Math.hypot(p.x - player.x, p.z - player.z) < 0.7 &&
      Math.abs(p.y - player.y) < 2)
  )
    return toast("此处不能放置");
  modifications.set(keyOf(p.x, p.y, p.z), slot.id);
  if (slot.id === "chest" || slot.id === "furnace")
    stations.set(keyOf(p.x, p.y, p.z), { type: slot.id, slots: [] });
  slot.count--;
  if (!slot.count) inventory.slots[selected] = null;
  buildWorld();
  renderHud();
}
function actUse() {
  const slot = inventory.slots[selected],
    hit = target();
  if (!slot) return;
  if (slot.id === "bread" || BLOCKS[slot.id]?.food) {
    player.hunger = Math.min(
      20,
      player.hunger + (ITEMS[slot.id]?.food || BLOCKS[slot.id].food),
    );
    slot.count--;
    if (!slot.count) inventory.slots[selected] = null;
    toast("恢复饥饿值");
    return renderHud();
  }
  const ent = hit && entities.find((e) => e.mesh === hit.object);
  if (
    ent &&
    slot.id === "bucket" &&
    ["cod", "salmon", "tropical_fish", "pufferfish"].includes(ent.type)
  ) {
    inventory.remove("bucket", 1);
    inventory.add("fish_bucket", 1, { fish: ent.type });
    entityGroup.remove(ent.mesh);
    entities = entities.filter((e) => e !== ent);
    toast(`捕获 ${ent.type}`);
    return renderHud();
  }
  if (slot.id === "trident") {
    const wet = player.y < SEA_LEVEL;
    if (wet && keys.ShiftLeft) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      player.vx = dir.x * 18;
      player.vy = dir.y * 18 + 6;
      player.vz = dir.z * 18;
      toast("激流：向前突进");
    } else {
      throwWeapon("trident");
      toast("忠诚三叉戟已投掷");
    }
    return;
  }
  if (slot.id === "bow") {
    if (inventory.count("arrow")) throwWeapon("bow");
    else toast("没有箭");
    return;
  }
  if (!hit || ent) return actPlace();
  const pos = hit.object.userData.poses[hit.instanceId],
    id = actualBlock(pos.x, pos.y, pos.z);
  if (slot.id === "wooden_hoe" && ["grass", "dirt"].includes(id)) {
    modifications.set(keyOf(pos.x, pos.y, pos.z), "farmland");
    slot.durability--;
    buildWorld();
    toast("土地已耕作");
    return renderHud();
  }
  if (
    ["wheat_seed", "carrot", "potato"].includes(slot.id) &&
    id === "farmland"
  ) {
    const crop = slot.id === "wheat_seed" ? "wheat" : slot.id;
    modifications.set(keyOf(pos.x, pos.y + 1, pos.z), crop);
    slot.count--;
    if (!slot.count) inventory.slots[selected] = null;
    buildWorld();
    toast("已种植");
    return renderHud();
  }
  if (id === "furnace") {
    toast(
      smelt(inventory, "raw_iron") ? "熔炼完成：铁锭 +1" : "需要粗铁和煤炭",
    );
    return renderHud();
  }
  if (id === "bed") {
    player.spawn = { x: pos.x, y: pos.y + 1, z: pos.z };
    if (player.time > 13000 && player.time < 23000) player.time = 1000;
    toast("已设置重生点并跳过夜晚");
    return;
  }
  actPlace();
}
function startBreak() {
  const hit = target();
  if (!hit) return;
  const ent = entities.find((e) => e.mesh === hit.object);
  if (ent) {
    attack(ent);
    return;
  }
  const pos = hit.object.userData.poses[hit.instanceId];
  if (!pos) return;
  const id = actualBlock(pos.x, pos.y, pos.z);
  if (id === "water" || id === "bedrock") return;
  breakState = {
    pos,
    id,
    start: performance.now(),
    duration: breakSeconds(id, inventory.slots[selected]?.id) * 1000,
  };
}
function finishBreak() {
  if (!breakState) return;
  const elapsed = performance.now() - breakState.start;
  if (elapsed >= breakState.duration) {
    const { id, pos } = breakState,
      item = inventory.slots[selected]?.id;
    modifications.set(keyOf(pos.x, pos.y, pos.z), null);
    stations.delete(keyOf(pos.x, pos.y, pos.z));
    if (canHarvest(id, item)) {
      const drop = BLOCKS[id].drop || id;
      spawnDrop(pos.x, pos.y + 0.3, pos.z, drop);
    }
    if (inventory.slots[selected]?.durability) {
      inventory.slots[selected].durability--;
      if (inventory.slots[selected].durability <= 0) {
        inventory.slots[selected] = null;
        toast("工具损坏");
      }
    }
    buildWorld();
    renderHud();
  }
  breakState = null;
}
function attack(e) {
  const slot = inventory.slots[selected],
    damage = slot?.id === "trident" ? 8 : slot?.id?.includes("axe") ? 6 : 2;
  e.hp -= damage;
  e.mesh.material.emissive.setHex(0xffffff);
  setTimeout(() => e.mesh?.material?.emissive?.setHex(0), 90);
  e.mesh.position.add(
    new THREE.Vector3(
      e.mesh.position.x - player.x,
      0.2,
      e.mesh.position.z - player.z,
    )
      .normalize()
      .multiplyScalar(0.7),
  );
  if (e.hp <= 0) {
    spawnDrop(
      e.mesh.position.x,
      e.mesh.position.y,
      e.mesh.position.z,
      e.type === "sheep"
        ? "wool"
        : e.type.includes("fish")
          ? "bread"
          : "raw_iron",
      1,
    );
    entityGroup.remove(e.mesh);
    entities = entities.filter((x) => x !== e);
    toast(`${e.type} 被击败`);
  }
}

function renderHud() {
  const pips = (n, max, klass = "") =>
    Array.from(
      { length: max },
      (_, i) =>
        `<span class="pip ${klass} ${i >= Math.ceil(n / 2) ? "off" : ""}">♥</span>`,
    ).join("");
  $("#health").innerHTML = pips(player.health, 10);
  $("#hunger").innerHTML = pips(player.hunger, 10, "food");
  $("#oxygen").innerHTML = pips(player.oxygen * 2, 10, "oxygen");
  $("#hotbar").innerHTML = inventory.slots
    .slice(0, 9)
    .map(
      (s, i) =>
        `<button class="slot ${i === selected ? "selected" : ""}" data-slot="${i}">${s ? `<span class="cube-icon" style="background:#${(BLOCKS[s.id]?.color || 0x9b9b9b).toString(16).padStart(6, "0")}"></span><small>${s.count}</small><em>${i + 1}</em>${s.durability ? `<span class="durability"><i style="width:${(s.durability / (ITEMS[s.id].durability || 1)) * 100}%"></i></span>` : ""}` : `<em>${i + 1}</em>`}</button>`,
    )
    .join("");
  document.querySelectorAll("[data-slot]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = +b.dataset.slot;
        renderHud();
      }),
  );
  const s = inventory.slots[selected];
  $("#held").style.background =
    `#${(BLOCKS[s?.id]?.color || 0x6d7479).toString(16).padStart(6, "0")}`;
}
function renderInventory() {
  $("#inventory").innerHTML = inventory.slots
    .map(
      (s, i) =>
        `<button class="inv-slot" data-inv="${i}">${s ? `<span>${ALL_DEFINITIONS[s.id]?.name || s.id}</span><b>${s.count}</b>` : ""}</button>`,
    )
    .join("");
  $("#recipes").innerHTML = RECIPES.map(
    (r, i) =>
      `<button class="recipe" data-recipe="${i}" ${inventory.canCraft(r) ? "" : "disabled"}><span>${r.name}<small>${Object.entries(
        r.in,
      )
        .map(([id, n]) => `${ALL_DEFINITIONS[id]?.name || id}×${n}`)
        .join(" · ")}</small></span><b>制作</b></button>`,
  ).join("");
  document.querySelectorAll("[data-recipe]").forEach(
    (b) =>
      (b.onclick = () => {
        if (inventory.craft(RECIPES[+b.dataset.recipe])) {
          toast(`已制作 ${RECIPES[+b.dataset.recipe].name}`);
          renderHud();
          renderInventory();
        }
      }),
  );
  document.querySelectorAll("[data-inv]").forEach((button) => {
    button.oncontextmenu = (event) => event.preventDefault();
    button.onmousedown = (event) => {
      const index = Number(button.dataset.inv),
        slot = inventory.slots[index];
      if (event.button === 0) {
        if (!carried) {
          carried = slot;
          inventory.slots[index] = null;
        } else if (!slot) {
          inventory.slots[index] = carried;
          carried = null;
        } else if (slot.id === carried.id && slot.count < 64) {
          const moved = Math.min(64 - slot.count, carried.count);
          slot.count += moved;
          carried.count -= moved;
          if (!carried.count) carried = null;
        } else {
          inventory.slots[index] = carried;
          carried = slot;
        }
      } else if (event.button === 2) {
        if (!carried && slot) {
          const take = Math.ceil(slot.count / 2);
          carried = { ...slot, count: take };
          slot.count -= take;
          if (!slot.count) inventory.slots[index] = null;
        } else if (carried) {
          if (!slot) {
            inventory.slots[index] = { ...carried, count: 1 };
            carried.count--;
          } else if (slot.id === carried.id && slot.count < 64) {
            slot.count++;
            carried.count--;
          }
          if (!carried.count) carried = null;
        }
      }
      renderHud();
      renderInventory();
    };
  });
  $("#carried").textContent = carried
    ? `手持：${ALL_DEFINITIONS[carried.id]?.name || carried.id} ×${carried.count}`
    : "手持：无（左键交换，右键拆分/单放）";
}
function updateTarget() {
  const h = target();
  if (!h) {
    outline.visible = false;
    $("#target-label").textContent = "";
    return;
  }
  const ent = entities.find((e) => e.mesh === h.object);
  if (ent) {
    outline.visible = false;
    $("#target-label").textContent = ent.type;
    return;
  }
  const p = h.object.userData.poses[h.instanceId];
  if (!p) return;
  outline.visible = true;
  outline.position.set(p.x, p.y, p.z);
  const id = actualBlock(p.x, p.y, p.z),
    progress = breakState
      ? Math.min(
          100,
          ((performance.now() - breakState.start) / breakState.duration) * 100,
        )
      : 0;
  $("#target-label").textContent =
    `${BLOCKS[id]?.name || id}${breakState ? ` ${progress | 0}%` : ""}`;
}
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 1800);
}

function save() {
  const data = serializeSave({
    seed,
    seedText,
    player,
    inventory,
    modifications: [...modifications],
    difficulty,
    entities: entities.map((e) => ({
      type: e.type,
      x: e.mesh.position.x,
      y: e.mesh.position.y,
      z: e.mesh.position.z,
      hp: e.hp,
    })),
    stations: [...stations],
  });
  localStorage.setItem("tidalcraft-save-v1", data);
  toast("世界已保存");
}
function load() {
  const raw = localStorage.getItem("tidalcraft-save-v1");
  if (!raw) return false;
  const d = parseSave(raw);
  if (!d) {
    $("#load-note").textContent = "存档损坏，已安全回退；可创建新世界。";
    return false;
  }
  seed = d.seed;
  seedText = d.seedText || String(seed);
  player = d.player;
  inventory = d.inventory;
  modifications = new Map(d.modifications || []);
  difficulty = d.difficulty || "normal";
  stations = new Map(d.stations || []);
  restoredEntities = d.entities || null;
  $("#seed").value = seedText;
  $("#load-note").textContent = "发现本地存档，将从上次位置继续。";
  return true;
}
function begin(fresh = false) {
  difficulty = $("#difficulty").value;
  if (fresh) {
    localStorage.removeItem("tidalcraft-save-v1");
    seedText = $("#seed").value || "tidalcraft";
    seed = hashSeed(seedText);
    modifications = new Map();
    player = {
      x: 0,
      y: terrainHeight(0, 0, seed) + 3,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      health: 20,
      hunger: 20,
      oxygen: 10,
      onGround: false,
      time: 6000,
      spawn: { x: 0, y: terrainHeight(0, 0, seed) + 3, z: 0 },
      dead: false,
    };
    inventory = new Inventory();
    HOTBAR_DEFAULT.forEach(
      (id, i) =>
        (inventory.slots[i] = {
          id,
          count: id === "wooden_pickaxe" || id === "trident" ? 1 : 32,
          durability: ITEMS[id]?.durability,
        }),
    );
    inventory.add("bread", 5);
    inventory.add("arrow", 16);
    inventory.add("wooden_hoe", 1, { durability: 59 });
    inventory.add("wheat_seed", 8);
  } else if (!localStorage.getItem("tidalcraft-save-v1")) {
    seedText = $("#seed").value;
    seed = hashSeed(seedText);
    player.y = terrainHeight(0, 0, seed) + 3;
    player.spawn.y = player.y;
  }
  buildWorld();
  spawnEntities();
  renderHud();
  $("#menu").classList.add("hidden");
  frameTimes = [];
  last = performance.now();
  started = true;
  canvas.requestPointerLock();
}

function animate(now) {
  requestAnimationFrame(animate);
  const frameMs = now - last,
    dt = Math.min(0.05, frameMs / 1000);
  last = now;
  if (started && !player.dead) {
    updatePlayer(dt);
    updateEntities(dt);
    updateDrops(dt);
    updateTarget();
    player.time = (player.time + dt * 20) % 24000;
    const angle = (player.time / 24000) * Math.PI * 2 - Math.PI / 2;
    sun.position.set(Math.cos(angle) * 50, Math.sin(angle) * 50, 20);
    sun.intensity = Math.max(0.12, Math.sin(angle) * 1.8);
    const daylight = Math.max(0.08, (Math.sin(angle) + 0.25) / 1.25);
    scene.background.setRGB(
      0.12 + 0.35 * daylight,
      0.18 + 0.48 * daylight,
      0.25 + 0.55 * daylight,
    );
    scene.fog.color.copy(scene.background);
    frameTimes.push(frameMs);
    if (frameTimes.length > 300) frameTimes.shift();
    if (now - lastHud > 200) {
      lastHud = now;
      $("#fps").textContent =
        `FPS ${Math.round(1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length || 16))}`;
      $("#coords").textContent =
        `XYZ ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}`;
      $("#clock").textContent =
        `Day 1 · ${String((Math.floor(player.time / 1000) + 6) % 24).padStart(2, "0")}:00`;
      $("#biome").textContent = biomeAt(player.x, player.z, seed).replaceAll(
        "_",
        " ",
      );
      renderHud();
    }
    saveTimer += dt;
    if (saveTimer > 30) {
      saveTimer = 0;
      save();
    }
  }
  renderer.render(scene, camera);
}

window.__tidalcraft = {
  snapshot: () => {
    const sorted = [...frameTimes].sort((a, b) => a - b),
      avg = frameTimes.reduce((a, b) => a + b, 0) / (frameTimes.length || 1);
    return {
      started,
      chunks: chunks.size,
      blockTypes: blockMeshes.length,
      instances: blockMeshes.reduce((n, m) => n + m.count, 0),
      entities: entities.length,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      averageFps: 1000 / avg,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] || 0,
      samples: frameTimes.length,
    };
  },
};
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (/^Digit[1-9]$/.test(e.code)) {
    selected = +e.code.at(-1) - 1;
    renderHud();
  }
  if (e.code === "KeyE") {
    const open = $("#panel").classList.toggle("hidden");
    document.body.classList.toggle("panel-open", !open);
    if (!open) document.exitPointerLock();
    else canvas.requestPointerLock();
  }
  if (e.code === "KeyQ") {
    const s = inventory.slots[selected];
    if (s) {
      spawnDrop(player.x, player.y + 1, player.z, s.id, 1);
      s.count--;
      if (!s.count) inventory.slots[selected] = null;
      renderHud();
    }
  }
});
addEventListener("keyup", (e) => (keys[e.code] = false));
addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas) {
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(
      -Math.PI / 2 + 0.02,
      Math.min(Math.PI / 2 - 0.02, pitch - e.movementY * 0.0022),
    );
  }
});
canvas.addEventListener("mousedown", (e) => {
  if (document.pointerLockElement !== canvas)
    return canvas.requestPointerLock();
  if (e.button === 0) startBreak();
  if (e.button === 2) actPlace();
});
canvas.addEventListener("mouseup", (e) => {
  if (e.button === 0) finishBreak();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
$("#play").onclick = () => begin(false);
$("#new-world").onclick = () => begin(true);
$("#save-btn").onclick = save;
$("#close-panel").onclick = () => {
  document.body.classList.remove("panel-open");
  $("#panel").classList.add("hidden");
  canvas.requestPointerLock();
};
load();
requestAnimationFrame(animate);
addEventListener("keydown", (e) => {
  if (e.code === "KeyF" && document.pointerLockElement === canvas) actUse();
  if (e.code === "KeyE") setTimeout(renderInventory);
});
