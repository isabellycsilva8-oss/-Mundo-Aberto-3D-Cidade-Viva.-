import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ======================= CONFIGURAÇÃO ======================= */
const N = 11, STEP = 58, BLOCK = 38, ROAD = 20, HALF = (N * STEP) / 2;   // cidade de ~640 m
const LINES = Array.from({ length: N + 1 }, (_, k) => (k - N / 2) * STEP); // eixos das ruas
const GARAGE = { x: 4 * STEP, z: -4 * STEP };
const GAS = { x: -4 * STEP, z: 3 * STEP };
const SPAWN = { x: 25, z: 0 };
const CYCLE = 180;                 // segundos de um dia completo
const GRAV = -28, JUMP = 11;
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const DAY = new THREE.Color(0x8fc3e6), NIGHT = new THREE.Color(0x070b18);
const FOOT = [[-1.3, -2.9], [1.3, -2.9], [-1.3, 2.9], [1.3, 2.9], [0, -2.9], [0, 2.9], [-1.3, 0], [1.3, 0]];

// Modelo 3D da Barbie (arquivo local)
const gltfLoader = new GLTFLoader();
let barbieCarModel = null;
let barbieModelLoading = true;

const CARS = [
  { name: 'Barbie Rosa', color: 0xff6fc1, len: 7.0, h: 0.95, cab: 0.8, spoiler: false, vmax: 50, acc: 18, brake: 40, rev: 14, grip: 7.0 },
];

/* ======================= MOTOR ======================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.FogExp2(0x8fc3e6, 0.0035);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('webgl-container').appendChild(renderer.domElement);
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const ambient = new THREE.AmbientLight(0xdbe3ea, 0.6);
const nightFill = new THREE.HemisphereLight(0x9bbcff, 0x263044, 0.2);
scene.add(nightFill);
const sun = new THREE.DirectionalLight(0xfff1e0, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 500 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
scene.add(ambient, sun, sun.target);

// faróis do carro do jogador (sempre 2 luzes, para não recompilar shaders ao trocar de carro)
const headlights = [0, 1].map(() => {
  const s = new THREE.SpotLight(0xfff3d6, 0, 70, Math.PI / 6, 0.5, 1);
  scene.add(s, s.target);
  return s;
});

const player = new THREE.Group();
scene.add(player);

/* ======================= MATERIAIS ======================= */
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
const M = {
  grass: mat(0x3d7a36, { roughness: 1 }),
  road: mat(0x2a2d33, { roughness: 0.9 }),
  walk: mat(0x9a9da4),
  asphalt: mat(0x3a3d44, { roughness: 0.95 }),
  yellow: new THREE.MeshBasicMaterial({ color: 0xf5b000 }),
  trunk: mat(0x4a2f1d),
  leaf: mat(0x1f5a2a),
  leaf2: mat(0x2f7a35),
  roof: mat(0x5b3a2e),
  metal: mat(0x2a2e36, { metalness: 0.7, roughness: 0.3 }),
  wood: mat(0x7a4a24),
  trash: mat(0x1f456e, { roughness: 0.4 }),
  lamp: mat(0xfff1c9, { emissive: 0xffd27a, emissiveIntensity: 0 }),
  red: mat(0xff2020, { emissive: 0xff0000, emissiveIntensity: 0.1 }),
  green: mat(0x20ff60, { emissive: 0x00ff40, emissiveIntensity: 0.1 }),
  sign: mat(0xffd400, { roughness: 0.5 }),
  pad: mat(0x555a63),
  pump: mat(0xd62828),
  grey: mat(0x6b717c),
  garRoof: mat(0x1c2430),
  glass: mat(0x101318, { roughness: 0.1, metalness: 0.9 }),
  dark: mat(0x111115, { roughness: 0.8 }),
  chrome: mat(0xffffff, { roughness: 0.1, metalness: 1 }),
  white: mat(0xffffff),
  headM: mat(0xffffff, { emissive: 0xe0f7ff, emissiveIntensity: 3 }),
  tailM: mat(0xff0011, { emissive: 0xcc0000, emissiveIntensity: 2 }),
  skin: mat(0xe0b08a),
};
const WALLS = [0xc9b79c, 0xa8b5c0, 0xe0d2b8, 0xb9866b].map(c => mat(c));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function facadeMat(wall, glow) {
  const c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = 256; c.height = e.height = 256;
  const g = c.getContext('2d'), l = e.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
  l.fillStyle = '#000'; l.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) {
    const x = 22 + q * 58, y = 22 + r * 58;
    g.fillStyle = glow; g.fillRect(x, y, 34, 34);
    l.fillStyle = Math.random() < 0.4 ? '#ffd27a' : '#000'; l.fillRect(x, y, 34, 34);
  }
  const tex = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  return new THREE.MeshStandardMaterial({
    map: tex(c), emissiveMap: tex(e), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4, metalness: 0.15,
  });
}
const FACADES = [facadeMat('#2a3442', '#7fd6ff'), facadeMat('#5a3b2a', '#ffd58a'), facadeMat('#c9ced6', '#2b3a4a')];

function signMat(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg; g.font = 'bold 72px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
}

/* ======================= BATCH ESTÁTICO (performance) ======================= */
// Todo o cenário estático é unido em poucas malhas (uma por material).
const batches = new Map();
function put(m, geo, x, y, z, rx = 0, ry = 0, uv) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (uv) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]);
  }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, ONE));
  if (!batches.has(m)) batches.set(m, []);
  batches.get(m).push(g);
}
const box = (m, w, h, d, x, y, z, ry = 0, uv) => put(m, new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry, uv);
const solid = (list, x0, x1, z0, z1) => list.push({ x0, x1, z0, z1 });
function flushBatches() {
  for (const [m, arr] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(arr, false), m);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  batches.clear();
}

/* ======================= COLISORES ======================= */
const walkCol = [];   // a pé: prédios, árvores, postes, bancos...
const carCol = [];    // carros: quarteirões inteiros (carro só anda nas ruas) + limites do mapa
const trafficBoxes = [];
const mapBlocks = [];

function hitsWalk(x, z) {
  return walkCol.some(b => x + 0.5 > b.x0 && x - 0.5 < b.x1 && z + 0.5 > b.z0 && z - 0.5 < b.z1);
}
function hits(x, z, h, list) {
  const c = Math.cos(h), s = Math.sin(h);
  for (const [lx, lz] of FOOT) {
    const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1) return true;
    }
  }
  return false;
}

/* ======================= ELEMENTOS URBANOS ======================= */
function lampAt(x, z) {
  put(M.metal, new THREE.CylinderGeometry(0.1, 0.14, 5.5, 6), x, 2.75, z);
  box(M.lamp, 0.8, 0.25, 0.5, x, 5.6, z);
  solid(walkCol, x - 0.3, x + 0.3, z - 0.3, z + 0.3);
}
function treeAt(x, z) {
  put(M.trunk, new THREE.CylinderGeometry(0.25, 0.35, 3.5, 6), x, 1.75, z);
  put(Math.random() < 0.5 ? M.leaf : M.leaf2, new THREE.IcosahedronGeometry(2.1, 0), x, 4.6, z);
  solid(walkCol, x - 0.6, x + 0.6, z - 0.6, z + 0.6);
}
function benchAt(x, z) {
  box(M.wood, 2, 0.1, 0.6, x, 0.5, z);
  box(M.metal, 0.12, 0.5, 0.6, x - 0.8, 0.25, z);
  box(M.metal, 0.12, 0.5, 0.6, x + 0.8, 0.25, z);
  solid(walkCol, x - 1, x + 1, z - 0.3, z + 0.3);
}
function trashAt(x, z) {
  put(M.trash, new THREE.CylinderGeometry(0.3, 0.25, 0.8, 8), x, 0.4, z);
  solid(walkCol, x - 0.3, x + 0.3, z - 0.3, z + 0.3);
}
function signAt(x, z) {
  put(M.metal, new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), x, 1.3, z);
  box(M.sign, 1.2, 0.8, 0.06, x, 2.7, z + 0.1);
}
function signalAt(x, z) {
  put(M.metal, new THREE.CylinderGeometry(0.1, 0.12, 4.5, 6), x, 2.25, z);
  box(M.metal, 0.45, 1.2, 0.45, x, 4.5, z);
  box(M.red, 0.25, 0.25, 0.05, x, 4.8, z + 0.25);
  box(M.green, 0.25, 0.25, 0.05, x, 4.2, z + 0.25);
}

/* ======================= ZONAS DA CIDADE ======================= */
function block(cx, cz, w, d, h, m) {
  box(m, w, h, d, cx, h / 2, cz, 0, [(w + d) / 16, h / 9]);
  box(M.roof, w + 0.4, 0.4, d + 0.4, cx, h + 0.2, cz);
  solid(walkCol, cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2);
}
function towers(cx, cz) {
  const h = 45 + Math.random() * 50;
  block(cx, cz, 26, 26, h, pick(FACADES));
  if (Math.random() < 0.5) box(pick(FACADES), 15, 12, 15, cx, h + 6, cz, 0, [1, 1.3]);
}
function commercial(cx, cz) {
  block(cx, cz, 26, 26, 16 + Math.random() * 22, pick(FACADES));
}
function houses(cx, cz) {
  for (const dx of [-9, 9]) for (const dz of [-9, 9]) {
    const x = cx + dx, z = cz + dz, h = 5 + Math.random() * 3;
    box(pick(WALLS), 12, h, 12, x, h / 2, z);
    put(M.roof, new THREE.ConeGeometry(8.6, 3.2, 4), x, h + 1.6, z, 0, Math.PI / 4);
    solid(walkCol, x - 6, x + 6, z - 6, z + 6);
  }
}
function park(cx, cz) {
  box(M.grass, 36, 0.04, 36, cx, 0.32, cz);
  for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10], [0, -13]]) treeAt(cx + dx, cz + dz);
  benchAt(cx, cz + 13 * (Math.random() < 0.5 ? 1 : -1));
}
function lot(cx, cz) {
  box(M.asphalt, 36, 0.04, 36, cx, 0.32, cz);
  for (const [dx, dz] of [[-9, -9], [-9, 9], [9, -9], [9, 9]]) {
    const x = cx + dx, z = cz + dz;
    box(pick(WALLS), 2.2, 1, 4.2, x, 0.5, z);
    solid(walkCol, x - 1.1, x + 1.1, z - 2.1, z + 2.1);
  }
}
function garage(cx, cz) {
  box(M.garRoof, 26, 0.6, 9, cx, 6, cz);
  for (const dx of [-12, 12]) for (const dz of [-4, 4]) box(M.metal, 0.6, 6, 0.6, cx + dx, 3, cz + dz);
  box(M.grey, 26, 6, 0.5, cx, 3, cz - 4.6);
  solid(walkCol, cx - 13, cx + 13, cz - 4.85, cz - 4.35);
  put(signMat('GARAGEM', '#111827', '#ffd27a'), new THREE.PlaneGeometry(22, 2), cx, 5.2, cz + 4.55);
  for (let k = 0; k < 5; k++) box(M.pad, 4.4, 0.2, 8, cx - 10 + k * 5, 0.2, cz);
}
function gas(cx, cz) {
  box(M.pump, 16, 0.6, 10, cx, 5.2, cz);
  for (const dx of [-6, 6]) for (const dz of [-4, 4]) box(M.metal, 0.5, 5.2, 0.5, cx + dx, 2.6, cz + dz);
  for (const dx of [-3, 3]) {
    box(M.metal, 1, 1.4, 0.7, cx + dx, 0.7, cz);
    solid(walkCol, cx + dx - 0.6, cx + dx + 0.6, cz - 0.4, cz + 0.4);
  }
  put(signMat('POSTO', '#d62828', '#ffffff'), new THREE.PlaneGeometry(12, 1.8), cx, 4.4, cz + 5.05);
}

function buildWorld() {
  // Chão e ruas (ruas com faixa central amarela)
  put(M.grass, new THREE.PlaneGeometry(1200, 1200), 0, -0.02, 0, -Math.PI / 2);
  const LEN = 2 * HALF + ROAD;
  for (const L of LINES) {
    put(M.road, new THREE.PlaneGeometry(ROAD, LEN), L, 0.02, 0, -Math.PI / 2);
    put(M.road, new THREE.PlaneGeometry(LEN, ROAD), 0, 0.02, L, -Math.PI / 2);
    put(M.yellow, new THREE.PlaneGeometry(0.3, LEN), L, 0.03, 0, -Math.PI / 2);
    put(M.yellow, new THREE.PlaneGeometry(LEN, 0.3), 0, 0.03, L, -Math.PI / 2);
  }
  // Limites do mapa (carro e pedestre)
  const W = HALF + 10;
  for (const s of [[-999, -W, -999, 999], [W, 999, -999, 999], [-999, 999, -999, -W], [-999, 999, W, 999]]) {
    solid(walkCol, ...s);
    solid(carCol, ...s);
  }

  // Quarteirões
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    const cx = i * STEP, cz = j * STEP, dist = Math.max(Math.abs(i), Math.abs(j));
    box(M.walk, BLOCK, 0.3, BLOCK, cx, 0.15, cz);
    solid(carCol, cx - BLOCK / 2, cx + BLOCK / 2, cz - BLOCK / 2, cz + BLOCK / 2);

    let col = '#3f6b3f';
    if (i === 0 && j === 0) { park(cx, cz); col = '#2f8f3f'; }             // praça central (spawn)
    else if (cx === GARAGE.x && cz === GARAGE.z) { garage(cx, cz); col = '#d4a72c'; }
    else if (cx === GAS.x && cz === GAS.z) { gas(cx, cz); col = '#d62828'; }
    else if (dist <= 2) { towers(cx, cz); col = '#4b5563'; }              // centro
    else if (dist <= 4) { commercial(cx, cz); col = '#6b7280'; }          // comercial
    else if ((i * 3 + j * 5 + 99) % 11 === 0) { park(cx, cz); col = '#2f8f3f'; }
    else if ((i + j + 20) % 4 === 0) { lot(cx, cz); col = '#333842'; }   // estacionamento
    else houses(cx, cz);                                                  // residencial
    mapBlocks.push({ x0: cx - BLOCK / 2, x1: cx + BLOCK / 2, z0: cz - BLOCK / 2, z1: cz + BLOCK / 2, c: col });

    // Mobiliário urbano
    lampAt(cx + 17, cz + 17);
    if (dist >= 2) treeAt(cx - 16, cz - 16);
    if (dist >= 3 && dist <= 4) benchAt(cx + 17, cz - 6);
    trashAt(cx - 17, cz + 8);
    signAt(cx + 17, cz - 17);
  }

  // Semáforos no centro
  for (const a of [4, 5, 6, 7]) for (const b of [4, 5, 6, 7]) signalAt(LINES[a] + 11, LINES[b] + 11);
}

/* ======================= CARROS (modelo paramétrico) ======================= */
function buildCar(idx) {
  const c = CARS[idx];
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = new THREE.Group();
  g.add(body);
  const paint = mat(c.color, { roughness: 0.18, metalness: 0.6 });
  const L = c.len, base = 0.25;
  const m = (geo, mt, x, y, z) => {
    const o = new THREE.Mesh(geo, mt);
    o.position.set(x, y, z);
    o.castShadow = true;
    body.add(o);
    return o;
  };
  m(new THREE.BoxGeometry(2.6, c.h, L), paint, 0, base + c.h / 2, 0);                       // carroceria
  m(new THREE.BoxGeometry(2.2, c.cab, 2.5), M.glass, 0, base + c.h + c.cab / 2, -0.4);      // cabine
  m(new THREE.BoxGeometry(2.1, 0.1, 2.2), paint, 0, base + c.h + c.cab + 0.05, -0.4);       // teto
  m(new THREE.BoxGeometry(1.8, 0.3, 0.1), M.dark, 0, base + c.h * 0.5, L / 2 + 0.02);       // grade
  for (const sx of [-0.95, 0.95]) {
    m(new THREE.BoxGeometry(0.5, 0.16, 0.1), M.headM, sx, base + c.h * 0.6, L / 2 + 0.04);  // faróis
    m(new THREE.BoxGeometry(0.6, 0.16, 0.1), M.tailM, sx, base + c.h * 0.6, -L / 2 - 0.03); // lanternas
  }
  m(new THREE.BoxGeometry(2.2, 0.08, 0.08), M.chrome, 0, base + 0.2, -L / 2 - 0.1);         // escapamento
  if (c.stripe) for (const sx of [-0.25, 0.25]) m(new THREE.BoxGeometry(0.42, 0.02, L), M.white, sx, base + c.h + 0.01, 0);
  if (c.spoiler) {
    m(new THREE.BoxGeometry(2.3, 0.06, 0.4), paint, 0, base + c.h + 0.45, -L / 2 + 0.25);
    for (const sx of [-0.9, 0.9]) m(new THREE.BoxGeometry(0.08, 0.4, 0.08), M.dark, sx, base + c.h + 0.2, -L / 2 + 0.25);
  }

  // Rodas: steer (esterça) -> spin (gira)
  const wr = 0.55, wz = L / 2 - 1.2, wheels = [];
  const tireG = new THREE.CylinderGeometry(wr, wr, 0.4, 16); tireG.rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.42, 10); rimG.rotateZ(Math.PI / 2);
  const tireM = mat(0x151515, { roughness: 0.9 });
  const rimM = mat(c.wedge ? 0xd4af37 : 0x101012, { roughness: 0.3, metalness: 0.8 });
  for (const [x, z, front] of [[-1.28, wz, true], [1.28, wz, true], [-1.28, -wz, false], [1.28, -wz, false]]) {
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.set(x, wr, z);
    steer.add(spin);
    spin.add(new THREE.Mesh(tireG, tireM), new THREE.Mesh(rimG, rimM));
    g.add(steer);
    wheels.push({ steer, spin, front });
  }
  return { group: g, body, wheels };
}

/* ======================= ESTADO DO JOGADOR / CARRO ======================= */
const keys = {};
let carIdx = 0, car = null, isPlayerInCar = false, canEnterCar = false;
const phys = { h: 0, vx: 0, vz: 0, sp: 0, steer: 0, hp: 100, pitch: 0, roll: 0 };
let garageOpen = false, gameTime = 0, night = 0;
let camAX = 0, camAY = 0.25, rightDown = false, lastMX = 0, lastMY = 0;
let isJumping = false, vy = 0;
let mixer = null, mixerReady = false, currentAction = '';
const anims = new Map();

const elCarName = document.getElementById('car-name');
const elHp = document.getElementById('hp-bar');
const elSpeed = document.getElementById('speedometer');
const elClock = document.getElementById('clock');
const elPromptCar = document.getElementById('interaction-prompt');
const elPromptGarage = document.getElementById('garage-prompt');
const elGarage = document.getElementById('garage');

function applyBarbieModel(targetCar) {
  if (!barbieCarModel || !targetCar || carIdx !== 0) return;
  if (targetCar.barbieVisual) targetCar.group.remove(targetCar.barbieVisual);

  // Esconde o modelo simples e usa o GLB real como visual do carro.
  targetCar.body.visible = false;
  targetCar.wheels.forEach(w => { w.steer.visible = false; });

  const visual = barbieCarModel.clone(true);
  visual.name = 'BarbieCorvette3D';
  // O modelo já está orientado com a frente no mesmo sentido da física do carro.
  // Não giramos 180 graus para evitar que ele ande de costas.
  visual.rotation.y = 0;
  visual.scale.setScalar(1);
  visual.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(visual);
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z);
  if (horizontal > 0) visual.scale.multiplyScalar(CARS[0].len / horizontal);
  visual.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(visual);
  visual.position.y -= fitted.min.y;
  visual.position.y += 0.08;

  visual.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach(m => {
          if (m.color) m.color.set(0xffffff); // não tinge a textura original
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          if ('roughness' in m) m.roughness = 0.3;
          if ('metalness' in m) m.metalness = 0.12;
          m.needsUpdate = true;
        });
      }
    }
  });
  targetCar.group.add(visual);
  targetCar.barbieVisual = visual;
}

function spawnCar(idx, initial = false) {
  const old = car;
  const inCar = !!old && isPlayerInCar;
  const pos = old ? old.group.position.clone() : null;
  if (old) scene.remove(old.group);
  car = buildCar(idx);
  carIdx = idx;
  scene.add(car.group);
  applyBarbieModel(car);
  if (initial) {
    car.group.position.set(SPAWN.x, 0, SPAWN.z);
    phys.h = 0;
  } else if (inCar) {
    car.group.position.copy(pos);                      // mesma posição e direção
  } else {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
    car.group.position.set(player.position.x + f.x * 6, 0, player.position.z + f.z * 6);
    phys.h = Math.atan2(f.x, f.z);
    phys.vx = phys.vz = phys.sp = 0;
  }
  phys.hp = 100;
  phys.steer = 0;
}

function resetCar() {
  car.group.position.set(SPAWN.x, 0, SPAWN.z);
  Object.assign(phys, { h: 0, vx: 0, vz: 0, sp: 0, steer: 0, hp: 100 });
}

function toggleCar() {
  if (!isPlayerInCar && canEnterCar) {
    isPlayerInCar = true;
    player.visible = false;
  } else if (isPlayerInCar && Math.abs(phys.sp) < 6) {
    isPlayerInCar = false;
    player.visible = true;
    const o = new THREE.Vector3(-3, 0, 0).applyAxisAngle(UP, phys.h);
    player.position.set(car.group.position.x + o.x, 0, car.group.position.z + o.z);
  }
}

function toggleGarage(force) {
  garageOpen = force ?? !garageOpen;
  elGarage.classList.toggle('hidden', !garageOpen);
}

/* ======================= FÍSICA DO CARRO ======================= */
function updateCar(dt) {
  const C = CARS[carIdx], P = car.group.position;
  const h = phys.h, cs = Math.cos(h), sn = Math.sin(h);
  let sp = phys.vx * sn + phys.vz * cs;     // velocidade para frente
  let lat = phys.vx * cs - phys.vz * sn;    // velocidade lateral (derrapagem)

  const up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown;
  const lf = keys.KeyA || keys.ArrowLeft, rt = keys.KeyD || keys.ArrowRight;
  const hb = keys.Space;
  const vmax = phys.hp < 30 ? C.vmax * 0.5 : C.vmax;

  // aceleração progressiva, frenagem, ré e freio de mão
  if (up) sp += C.acc * Math.max(0.12, 1 - Math.max(0, sp) / vmax) * dt;
  else if (dn) sp = sp > 1 ? sp - C.brake * dt : Math.max(-C.rev, sp - C.acc * 0.4 * dt);
  else sp -= sp * Math.min(1, 0.3 * dt);
  if (hb) sp -= sp * Math.min(1, 2.5 * dt);
  sp = Math.max(-C.rev, Math.min(vmax, sp));

  // direção suavizada, com giro que depende da velocidade
  phys.steer += (((lf ? 0.5 : 0) - (rt ? 0.5 : 0)) - phys.steer) * Math.min(1, 6 * dt);
  const spd = Math.abs(sp), dir = sp < 0 ? -1 : 1;
  phys.h += phys.steer * Math.min(1, spd / 6) * dir * (2.6 / (1 + spd / 35)) * dt;

  // inércia: velocidade mundial reprojetada no novo rumo; a lateral aos poucos some (grip)
  const vx0 = sp * sn + lat * cs, vz0 = sp * cs - lat * sn;
  const nh = phys.h, ncs = Math.cos(nh), nsn = Math.sin(nh);
  let nsp = vx0 * nsn + vz0 * ncs;
  let nlat = vx0 * ncs - vz0 * nsn;
  nlat *= Math.exp(-(hb ? 1.1 : C.grip) * dt);
  phys.vx = nsn * nsp + ncs * nlat;
  phys.vz = ncs * nsp - nsn * nlat;
  phys.sp = nsp;

  // movimento com colisão (desliza na parede quando possível)
  const obst = carCol.concat(trafficBoxes);
  const nx = P.x + phys.vx * dt, nz = P.z + phys.vz * dt;
  if (!hits(nx, nz, phys.h, obst)) {
    P.x = nx; P.z = nz;
  } else {
    const impact = Math.hypot(phys.vx, phys.vz);
    if (!hits(nx, P.z, phys.h, obst)) P.x = nx;
    else if (!hits(P.x, nz, phys.h, obst)) P.z = nz;
    if (impact > 5) phys.hp = Math.max(0, phys.hp - (impact - 5) * 1.5);
    phys.vx *= -0.25; phys.vz *= -0.25;
    phys.sp *= 0.2;
  }

  // rodas, inclinação e suspensão visual
  const wspin = (phys.sp * dt) / 0.55;
  for (const w of car.wheels) {
    w.spin.rotation.x += wspin;
    if (w.front) w.steer.rotation.y = phys.steer;
  }
  phys.pitch += ((up ? -0.035 : dn ? 0.05 : 0) - phys.pitch) * Math.min(1, 4 * dt);
  phys.roll += ((-phys.steer * 0.25 * Math.min(1, spd / 25)) - phys.roll) * Math.min(1, 5 * dt);
  car.group.rotation.set(phys.pitch, phys.h, phys.roll);
  car.body.position.y = Math.sin(gameTime * 14) * 0.006 * Math.min(1, spd / 30);
  P.y = 0;

  // faróis seguem o carro
  car.group.updateMatrixWorld(true);
  const L = C.len / 2;
  headlights.forEach((hl, i) => {
    const sx = i ? 0.95 : -0.95;
    hl.position.set(sx, 0.9, L);
    car.group.localToWorld(hl.position);
    hl.target.position.set(sx * 1.2, 0, L + 22);
    car.group.localToWorld(hl.target.position);
    hl.intensity = night * 6;
  });
}

/* ======================= PERSONAGEM A PÉ ======================= */
function setAction(name) {
  if (currentAction === name || !mixerReady) return;
  const to = anims.get(name);
  if (!to) return;
  const from = anims.get(currentAction);
  if (name === 'Jump') { to.setLoop(THREE.LoopOnce); to.clampWhenFinished = true; }
  to.reset().play();
  if (from) from.crossFadeTo(to, 0.2, true);
  currentAction = name;
}

function updateFoot(dt) {
  const d = new THREE.Vector3();
  if (keys.KeyW || keys.ArrowUp) d.z -= 1;
  if (keys.KeyS || keys.ArrowDown) d.z += 1;
  if (keys.KeyA || keys.ArrowLeft) d.x -= 1;
  if (keys.KeyD || keys.ArrowRight) d.x += 1;
  const run = keys.ShiftLeft || keys.ShiftRight;

  if (d.lengthSq() > 0) {
    d.normalize();
    const a = Math.atan2(d.x, d.z) + camAX;
    player.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(UP, a), Math.min(1, 10 * dt));
    const s = (run ? 16 : 8) * dt;
    const mx = Math.sin(a) * s, mz = Math.cos(a) * s;
    if (!hitsWalk(player.position.x + mx, player.position.z)) player.position.x += mx;
    if (!hitsWalk(player.position.x, player.position.z + mz)) player.position.z += mz;
    if (!isJumping) setAction(run ? 'Running' : 'Walking');
  } else if (!isJumping) setAction('Idle');

  if (isJumping || player.position.y > 0) {
    vy += GRAV * dt;
    player.position.y += vy * dt;
    if (player.position.y <= 0) { player.position.y = 0; isJumping = false; vy = 0; }
  }
}

function jump() {
  if (isJumping) return;
  isJumping = true;
  vy = JUMP;
  setAction('Jump');
}

function loadCharacter() {
  const hide = () => document.getElementById('loading-screen').classList.add('hidden');
  new GLTFLoader().load(
    'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    gltf => {
      const model = gltf.scene;
      model.scale.setScalar(0.6);
      model.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      player.add(model);
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach(cl => anims.set(cl.name, mixer.clipAction(cl)));
      mixerReady = true;
      setAction('Idle');
      hide();
    },
    undefined,
    () => {
      // fallback se o modelo remoto não carregar
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 1.5, 8), mat(0x00f0ff));
      body.position.y = 0.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), mat(0xffffff));
      head.position.y = 1.8;
      player.add(body, head);
      hide();
    }
  );
  setTimeout(hide, 6000);
}

/* ======================= TRÂNSITO E PEDESTRES ======================= */
const dummy = new THREE.Object3D();

function nextLine(t, s) {
  let best = null, bd = Infinity;
  for (const L of LINES) {
    const d = (L - t) * s;
    if (d > 0 && d < bd) { bd = d; best = L; }
  }
  return best;
}

const TRAFFIC = Array.from({ length: 22 }, () => ({
  axisZ: Math.random() < 0.5,
  line: LINES[Math.floor(Math.random() * (N + 1))],
  sign: Math.random() < 0.5 ? 1 : -1,
  t: (Math.random() * 2 - 1) * HALF,
  v: 9 + Math.random() * 7,
  cur: 0,
}));
const tBody = new THREE.InstancedMesh(
  new THREE.BoxGeometry(2.2, 0.9, 4.4).translate(0, 0.7, 0),
  mat(0xffffff, { roughness: 0.3, metalness: 0.5 }), TRAFFIC.length
);
const tCab = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1.9, 0.6, 2.2).translate(0, 1.25, -0.2), M.glass, TRAFFIC.length
);
TRAFFIC.forEach((_, i) => tBody.setColorAt(i, new THREE.Color().setHSL(Math.random(), 0.5, 0.45)));
tBody.castShadow = tCab.castShadow = true;
tBody.frustumCulled = tCab.frustumCulled = false;
scene.add(tBody, tCab);

function updateTraffic(dt) {
  // semáforos: eixo Z verde entre 0-10s; eixo X verde entre 12-22s (de 24s)
  const ph = gameTime % 24, greenZ = ph < 10, greenX = ph >= 12 && ph < 22;
  trafficBoxes.length = 0;
  TRAFFIC.forEach((c, i) => {
    const green = c.axisZ ? greenZ : greenX;
    let target = c.v;
    const nl = nextLine(c.t, c.sign);
    if (!green && nl !== null) {
      const d = (nl - c.t) * c.sign;
      if (d < 14) target = Math.min(target, Math.max(0, d - 4) * 1.2);
    }
    for (const o of TRAFFIC) {
      if (o !== c && o.axisZ === c.axisZ && o.line === c.line && o.sign === c.sign) {
        const dd = (o.t - c.t) * c.sign;
        if (dd > 0 && dd < 10) target = Math.min(target, o.cur);
      }
    }
    c.cur += (target - c.cur) * Math.min(1, 3 * dt);
    c.t += c.sign * c.cur * dt;
    if (c.t * c.sign > HALF + 15) c.t = -c.sign * (HALF + 15);

    const off = c.sign > 0 ? 4 : -4;   // faixa à direita de cada sentido
    const x = c.axisZ ? c.line + off : c.t;
    const z = c.axisZ ? c.t : c.line + off;
    const ry = c.axisZ ? (c.sign > 0 ? 0 : Math.PI) : (c.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    trafficBoxes.push(c.axisZ
      ? { x0: x - 1.1, x1: x + 1.1, z0: z - 2.2, z1: z + 2.2 }
      : { x0: x - 2.2, x1: x + 2.2, z0: z - 1.1, z1: z + 1.1 });
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    tBody.setMatrixAt(i, dummy.matrix);
    tCab.setMatrixAt(i, dummy.matrix);
  });
  tBody.instanceMatrix.needsUpdate = tCab.instanceMatrix.needsUpdate = true;
}

const PEDS = Array.from({ length: 40 }, () => ({
  axisZ: Math.random() < 0.5,
  line: LINES[Math.floor(Math.random() * (N + 1))],
  sign: Math.random() < 0.5 ? 1 : -1,
  t: (Math.random() * 2 - 1) * HALF,
  v: 1.2 + Math.random() * 0.8,
  off: (Math.random() < 0.5 ? -1 : 1) * 11,
}));
const pBody = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.3, 0.3, 1.4, 6).translate(0, 0.7, 0), mat(0xffffff), PEDS.length
);
const pHead = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.25, 8, 6).translate(0, 1.55, 0), M.skin, PEDS.length
);
PEDS.forEach((_, i) => pBody.setColorAt(i, new THREE.Color().setHSL(Math.random(), 0.6, 0.5)));
pBody.castShadow = pHead.castShadow = true;
pBody.frustumCulled = pHead.frustumCulled = false;
scene.add(pBody, pHead);

function updatePeds(dt) {
  PEDS.forEach((p, i) => {
    p.t += p.sign * p.v * dt;
    if (Math.abs(p.t) > HALF) p.t = -p.sign * HALF;
    const x = p.axisZ ? p.line + p.off : p.t;
    const z = p.axisZ ? p.t : p.line + p.off;
    const ry = p.axisZ ? (p.sign > 0 ? 0 : Math.PI) : (p.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    pBody.setMatrixAt(i, dummy.matrix);
    pHead.setMatrixAt(i, dummy.matrix);
  });
  pBody.instanceMatrix.needsUpdate = pHead.instanceMatrix.needsUpdate = true;
}

/* ======================= GARAGEM (vitrine + painel) ======================= */
const showcase = [];
function buildShowcase() {
  CARS.forEach((_, i) => {
    const c = buildCar(i);
    const x = GARAGE.x - 10 + i * 5, z = GARAGE.z;
    c.group.position.set(x, 0.3, z);
    scene.add(c.group);
    showcase.push(c.group);
    solid(walkCol, x - 1.5, x + 1.5, z - 3, z + 3);
  });
}

const garageList = document.getElementById('garage-cars');
CARS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'car-btn';
  b.innerHTML = `<b>${c.name}</b><small>Tecla ${i + 1}</small>`;
  b.onclick = () => { spawnCar(i); toggleGarage(false); };
  garageList.appendChild(b);
});
document.getElementById('garage-close').onclick = () => toggleGarage(false);

/* ======================= CÉU, DIA E NOITE ======================= */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sunDir = new THREE.Vector3(0.8, 1, 0.4).normalize();
function updateSky() {
  const t = (gameTime / CYCLE + 0.2) % 1;          // 0.25 = meio-dia
  const ang = t * Math.PI * 2, el = Math.sin(ang);
  const day = smooth(-0.15, 0.2, el);
  night = 1 - day;
  sunDir.set(Math.cos(ang) * 0.8, el, 0.4).normalize();
  sun.intensity = 0.35 + 2.1 * day;
  ambient.intensity = 0.45 + 0.55 * day;
  nightFill.intensity = 0.25 + 0.35 * night;
  scene.background.copy(new THREE.Color(0x111b32)).lerp(DAY, day);
  scene.fog.color.copy(scene.background);
  M.lamp.emissiveIntensity = 0.05 + 3 * night;
  for (const m of FACADES) m.emissiveIntensity = night * 1.2;
  const greenZ = gameTime % 24 < 10;
  M.red.emissiveIntensity = greenZ ? 0.1 : 2.5;
  M.green.emissiveIntensity = greenZ ? 2.5 : 0.1;
  const hour = Math.floor((t * 24 + 6) % 24), min = Math.floor((((t * 24 + 6) % 24) - hour) * 60);
  elClock.textContent = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/* ======================= CÂMERA ======================= */
function updateCamera(dt) {
  const inCar = isPlayerInCar;
  const tp = inCar ? car.group.position : player.position;
  if (inCar && !rightDown) {
    const d = Math.atan2(Math.sin(phys.h + Math.PI - camAX), Math.cos(phys.h + Math.PI - camAX));
    camAX += d * Math.min(1, 2.5 * dt);            // câmera acompanha a direção do carro
  }
  const dist = inCar ? 17 + Math.min(5, Math.abs(phys.sp) / 12) : 11;
  const cy = Math.cos(camAY);
  const want = new THREE.Vector3(
    tp.x + dist * Math.sin(camAX) * cy,
    tp.y + dist * Math.sin(camAY) + 2,
    tp.z + dist * Math.cos(camAX) * cy
  );
  camera.position.lerp(want, 1 - Math.exp(-8 * dt));
  camera.lookAt(tp.x, tp.y + 1.5, tp.z);
  const fov = 60 + (inCar ? Math.min(12, Math.abs(phys.sp) * 0.18) : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ======================= MINIMAPA ======================= */
const mctx = document.getElementById('minimap').getContext('2d');
const MM = 75, MR = 95;
const fwdV = new THREE.Vector3();
function playerHeading() {
  fwdV.set(0, 0, 1).applyQuaternion(player.quaternion);
  return Math.atan2(fwdV.x, fwdV.z);
}
function drawMinimap() {
  const c = mctx;
  const tp = isPlayerInCar ? car.group.position : player.position;
  const h = isPlayerInCar ? phys.h : playerHeading();
  const k = MM / MR, ch = Math.cos(h), sh = Math.sin(h);
  // mapa com a frente do jogador apontando para cima
  const S = (x, z) => {
    const dx = x - tp.x, dz = z - tp.z;
    return [MM + k * (dx * ch - dz * sh), MM - k * (dx * sh + dz * ch)];
  };
  c.save();
  c.clearRect(0, 0, 150, 150);
  c.beginPath(); c.arc(MM, MM, MM - 1, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#0b1020'; c.fillRect(0, 0, 150, 150);
  for (const b of mapBlocks) {
    const [x0, y0] = S(b.x0, b.z0), [x1, y1] = S(b.x1, b.z1);
    c.fillStyle = b.c;
    c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  c.strokeStyle = '#4b5563';
  c.lineWidth = ROAD * k;
  c.beginPath();
  for (const L of LINES) {
    let [a, b] = S(L, -HALF); let [d, e] = S(L, HALF);
    c.moveTo(a, b); c.lineTo(d, e);
    [a, b] = S(-HALF, L); [d, e] = S(HALF, L);
    c.moveTo(a, b); c.lineTo(d, e);
  }
  c.stroke();
  c.fillStyle = '#cbd5e1';
  for (const t of TRAFFIC) {
    const off = t.sign > 0 ? 4 : -4;
    const x = t.axisZ ? t.line + off : t.t, z = t.axisZ ? t.t : t.line + off;
    const [sx, sy] = S(x, z);
    c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }
  c.translate(MM, MM);
  c.fillStyle = isPlayerInCar ? '#ff2233' : '#ff0055';
  c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill();
  c.restore();
}

/* ======================= HUD ======================= */
function updateHUD() {
  elCarName.textContent = CARS[carIdx].name;
  elHp.style.width = phys.hp + '%';
  elSpeed.textContent = isPlayerInCar ? `${Math.round(Math.abs(phys.sp) * 3.6)} km/h` : '';
}
function checkNear() {
  if (isPlayerInCar) {
    elPromptCar.style.display = 'none';
    elPromptGarage.style.display = 'none';
    return;
  }
  canEnterCar = player.position.distanceTo(car.group.position) < 5;
  elPromptCar.style.display = canEnterCar ? 'block' : 'none';
  const nearGarage = Math.hypot(player.position.x - GARAGE.x, player.position.z - GARAGE.z) < 14;
  elPromptGarage.style.display = nearGarage ? 'block' : 'none';
}

/* ======================= ENTRADA ======================= */
const NAV_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
addEventListener('keydown', e => {
  if (NAV_KEYS.includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Space' && !isPlayerInCar) jump();
  if (e.code === 'KeyF') toggleCar();
  if (e.code === 'KeyG') toggleGarage();
  if (e.code === 'Escape') toggleGarage(false);
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'Digit1') spawnCar(0);
});
addEventListener('keyup', e => { keys[e.code] = false; });

addEventListener('mousedown', e => {
  if (e.button === 2) { rightDown = true; lastMX = e.clientX; lastMY = e.clientY; }
});
addEventListener('mouseup', e => { if (e.button === 2) rightDown = false; });
addEventListener('mousemove', e => {
  if (!rightDown) return;
  camAX -= (e.clientX - lastMX) * 0.005;
  camAY = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, camAY + (e.clientY - lastMY) * 0.005));
  lastMX = e.clientX; lastMY = e.clientY;
});

/* ======================= MODELO 3D DA BARBIE ======================= */
gltfLoader.load(
  './models/carro_chervolet_corvette_da_barbie_1956.glb',
  gltf => {
    barbieCarModel = gltf.scene;
    barbieModelLoading = false;
    if (car && carIdx === 0) applyBarbieModel(car);
  },
  undefined,
  error => {
    barbieModelLoading = false;
    console.warn('Não foi possível carregar o modelo 3D da Barbie. O modelo simples será usado.', error);
  }
);

/* ======================= INICIALIZAÇÃO E LOOP ======================= */
buildWorld();
flushBatches();
buildShowcase();
spawnCar(0, true);
player.position.set(0, 0, 0);
loadCharacter();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  gameTime += dt;

  if (garageOpen) for (const k in keys) keys[k] = false;
  if (mixer) mixer.update(dt);

  updateSky();
  updateTraffic(dt);
  updatePeds(dt);
  if (isPlayerInCar) updateCar(dt);
  else updateFoot(dt);
  checkNear();
  for (const g of showcase) g.rotation.y += dt * 0.5;

  const tp = isPlayerInCar ? car.group.position : player.position;
  sun.target.position.set(tp.x, 0, tp.z);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);

  updateCamera(dt);
  drawMinimap();
  updateHUD();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
