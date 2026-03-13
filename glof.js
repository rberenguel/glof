import { get, set } from "./idb-keyval.js";
import { initHaptic, triggerHaptic, triggerHapticError } from "./haptic.js";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const orientationWarning = document.getElementById("orientation-warning");
const menuOverlay = document.getElementById("menu-overlay");

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}
function isLandscape() {
  if (window.screen.orientation)
    return window.screen.orientation.type.includes("landscape");
  return window.innerWidth > window.innerHeight;
}
const MASTER_SEED = 42;
const strokesEl = document.getElementById("strokes");
const totalStrokesEl = document.getElementById("total-strokes");
const transitionOverlay = document.getElementById("transition-overlay");

const GRAVITY = 0.15;
const AIR_FRICTION = 0.995;
const GROUND_FRICTION = 0.99;
const BOUNCE_DAMPING = 0.55;
const POWER_MULTIPLIER = 0.09;
const MAX_DRAG_RATIO = 0.15; // fraction of canvas width
const BALL_RADIUS = 3;
const HOLE_WIDTH = 16;
const HOLE_DEPTH = 20;

let gameWidth, gameHeight;
let ball,
  terrain,
  hole,
  waterHazards,
  particles,
  cacti,
  boulders,
  deadTrees,
  mesas,
  skulls;
let backgroundCanvas, backgroundCtx;
let lastBallPosition = { x: 0, y: 0 };
let lastFrameTime = 0;

let gameState = "AIMING";
let strokes = 0;
let totalStrokes = 0;
let holeNumber = 1;
let holesInOne = 0;
let ballsInWater = 0;
let ballsOutOfBounds = 0;
let aimStartPos = null;
let currentAimPos = null;

// Creates a seeded pseudo-random number generator.
function createSeededRandom(seed) {
  let state = seed;
  return function () {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Ball {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = BALL_RADIUS;
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
  }
}

function generateLevel() {
  // Create a single random generator for this level, seeded by our master seed and the hole number.
  const random = createSeededRandom(MASTER_SEED + holeNumber);

  terrain = [];
  waterHazards = [];
  particles = [];
  cacti = [];
  boulders = [];
  deadTrees = [];
  mesas = [];
  skulls = [];

  const segments = 8 + Math.floor(random() * 6);
  let lastY = gameHeight * (0.7 + random() * 0.2);
  terrain.push({ x: 0, y: lastY });

  for (let i = 1; i < segments; i++) {
    const x = (i / segments) * gameWidth + (random() - 0.5) * 50;
    const y = lastY + (random() - 0.5) * gameHeight * 0.4;
    lastY = y;
    terrain.push({
      x: x,
      y: Math.max(gameHeight * 0.45, Math.min(gameHeight * 0.95, y)),
    });
  }
  terrain.push({ x: gameWidth, y: lastY });
  terrain.sort((a, b) => a.x - b.x);

  let flatEnoughSegments = [];
  for (let i = Math.floor(segments / 2); i < terrain.length - 1; i++) {
    const p1 = terrain[i];
    const p2 = terrain[i + 1];
    if (p2.x - p1.x < HOLE_WIDTH * 3) continue;
    const slope = Math.abs((p2.y - p1.y) / (p2.x - p1.x));
    if (slope < 0.15) flatEnoughSegments.push(i);
  }

  const segmentIndex =
    flatEnoughSegments.length > 0
      ? flatEnoughSegments[Math.floor(random() * flatEnoughSegments.length)]
      : Math.floor(segments / 2) + 1;

  if (segmentIndex > 0 && segmentIndex < terrain.length - 2) {
    const p0 = terrain[segmentIndex - 1];
    const p1 = terrain[segmentIndex];
    const p2 = terrain[segmentIndex + 1];
    const p3 = terrain[segmentIndex + 2];
    const flatY = (p1.y + p2.y) / 2;
    p1.y = flatY;
    p2.y = flatY;
    p0.y = (p0.y + flatY) / 2;
    p3.y = (p3.y + flatY) / 2;
  }

  const p1_hole = terrain[segmentIndex];
  const p2_hole = terrain[segmentIndex + 1];
  const segWidth = p2_hole.x - p1_hole.x;
  const holeX = p1_hole.x + segWidth * 0.2 + random() * (segWidth * 0.6);
  hole = {
    x: holeX,
    y: getTerrainY(holeX),
    width: HOLE_WIDTH,
    depth: HOLE_DEPTH,
  };

  const startX = gameWidth * 0.1;

  if (holeNumber > 1 && random() < 0.45) {
    const potentialIndices = [];
    for (let i = 1; i < terrain.length - 2; i++) {
      if (
        i !== segmentIndex &&
        i !== segmentIndex - 1 &&
        i !== segmentIndex + 1 &&
        i !== terrain.findIndex((p) => p.x > startX) - 1 &&
        i !== terrain.findIndex((p) => p.x > startX) - 2
      ) {
        potentialIndices.push(i);
      }
    }
    if (potentialIndices.length > 0) {
      const hazardIndex =
        potentialIndices[Math.floor(random() * potentialIndices.length)];
      const p1 = terrain[hazardIndex];
      const p2 = terrain[hazardIndex + 1];
      const waterY = Math.max(p1.y, p2.y);
      terrain[hazardIndex].y = waterY;
      terrain[hazardIndex + 1].y = waterY;
      waterHazards.push({ x1: p1.x, x2: p2.x, y: waterY + 6 });
    }
  }

  const cactusRng = createSeededRandom(MASTER_SEED + holeNumber + 1000);
  if (cactusRng() < 0.01) {
    let attempts = 0;
    while (cacti.length === 0 && attempts < 50) {
      attempts++;
      const x = gameWidth * (0.15 + cactusRng() * 0.7);
      if (Math.abs(x - hole.x) < 60 || Math.abs(x - startX) < 80) continue;
      let isInWater = false;
      for (const water of waterHazards) {
        if (x > water.x1 - 20 && x < water.x2 + 20) {
          isInWater = true;
          break;
        }
      }
      if (isInWater) continue;
      const y = getTerrainY(x);
      const scale = 0.4 + cactusRng() * 0.6;
      const shade = 80 + Math.floor(scale * 80);
      const color = `rgb(${shade - 20}, ${shade}, ${shade - 30})`;
      cacti.push({ x, y, scale, color, seed: MASTER_SEED + holeNumber * 137 });
    }
  }

  // Boulder placement — flat segments only
  const flatForBoulders = [];
  for (let i = 0; i < terrain.length - 1; i++) {
    const p1 = terrain[i],
      p2 = terrain[i + 1];
    if (Math.abs(p2.y - p1.y) < 6 && p2.x - p1.x > 40) {
      flatForBoulders.push(p1);
    }
  }
  const boulderRng = createSeededRandom(MASTER_SEED + holeNumber + 2000);
  if (flatForBoulders.length > 0 && boulderRng() < 0.015) {
    let boulderAttempts = 0;
    while (boulders.length === 0 && boulderAttempts < 50) {
      boulderAttempts++;
      const seg =
        flatForBoulders[Math.floor(boulderRng() * flatForBoulders.length)];
      const x =
        seg.x + boulderRng() * (terrain[terrain.indexOf(seg) + 1].x - seg.x);
      if (Math.abs(x - hole.x) < 50 || Math.abs(x - startX) < 60) continue;
      let isInWater = false;
      for (const w of waterHazards) {
        if (x > w.x1 - 15 && x < w.x2 + 15) {
          isInWater = true;
          break;
        }
      }
      if (isInWater) continue;
      const scale = 0.3 + boulderRng() * 0.4;
      boulders.push({
        x,
        y: getTerrainY(x),
        scale,
        seed: MASTER_SEED + holeNumber * 97,
      });
    }
  }

  // Dead tree placement
  const treeRng = createSeededRandom(MASTER_SEED + holeNumber + 3000);
  if (treeRng() < 0.005) {
    let treeAttempts = 0;
    while (deadTrees.length === 0 && treeAttempts < 50) {
      treeAttempts++;
      const x = gameWidth * (0.1 + treeRng() * 0.8);
      if (Math.abs(x - hole.x) < 50 || Math.abs(x - startX) < 60) continue;
      if (boulders.length > 0 && Math.abs(x - boulders[0].x) < 60) continue;
      let isInWater = false;
      for (const w of waterHazards) {
        if (x > w.x1 - 15 && x < w.x2 + 15) {
          isInWater = true;
          break;
        }
      }
      if (isInWater) continue;
      const scale = 0.4 + treeRng() * 0.5;
      deadTrees.push({
        x,
        y: getTerrainY(x),
        scale,
        seed: MASTER_SEED + holeNumber * 113,
      });
    }
  }

  // Mesa placement
  const mesaRng = createSeededRandom(MASTER_SEED + holeNumber + 4000);
  if (mesaRng() < 0.015)
    mesas.push({
      x: gameWidth * (0.2 + mesaRng() * 0.6),
      topY: gameHeight * (0.38 + mesaRng() * 0.15),
      width: gameWidth * (0.25 + mesaRng() * 0.25),
      height: gameHeight * (0.12 + mesaRng() * 0.08),
      seed: MASTER_SEED + holeNumber * 71,
    });

  // Skull placement — nearest flat segment to hole (centering forced for now)
  const skullRng = createSeededRandom(MASTER_SEED + holeNumber + 5000);
  if (holeNumber === 100 || holeNumber % 500 === 0) {
    const flatSegs = [];
    for (let i = 0; i < terrain.length - 1; i++) {
      const p1 = terrain[i],
        p2 = terrain[i + 1];
      if (Math.abs(p2.y - p1.y) < 6 && p2.x - p1.x > 30) flatSegs.push(p1);
    }
    flatSegs.sort((a, b) => {
      const ai = terrain.indexOf(a),
        bi = terrain.indexOf(b);
      const amidX = (a.x + terrain[ai + 1].x) / 2;
      const bmidX = (b.x + terrain[bi + 1].x) / 2;
      return Math.abs(amidX - hole.x) - Math.abs(bmidX - hole.x);
    });
    for (const seg of flatSegs) {
      console.log(flatSegs);
      const segIdx = terrain.indexOf(seg);
      const x = seg.x + 0.5 * (terrain[segIdx + 1].x - seg.x);
      console.log(x, hole.x, x, startX);
      //if (Math.abs(x - hole.x) < 20 || Math.abs(x - startX) < 40) continue;
      let isInWater = false;
      for (const w of waterHazards) {
        if (x > w.x1 - 15 && x < w.x2 + 15) {
          isInWater = true;
          break;
        }
      }
      if (isInWater) continue;
      const scale = 0.6 + skullRng() * 0.4;
      skulls.push({
        x,
        y: getTerrainY(x),
        scale,
        seed: MASTER_SEED + holeNumber * 59,
      });
      console.log(skulls);
      break;
    }
  }

  drawBackgroundLayer();
  ball = new Ball(startX, getTerrainY(startX) - BALL_RADIUS);
  lastBallPosition = { x: ball.x, y: ball.y };
  strokes = 0;
}

function getTerrainY(x) {
  const water = waterHazards.find((w) => x > w.x1 && x < w.x2);
  if (water) return water.y;
  if (x <= terrain[0].x) return terrain[0].y;
  if (x >= terrain[terrain.length - 1].x) return terrain[terrain.length - 1].y;
  const p1 = terrain.findLast((p) => p.x <= x);
  const p2 = terrain.find((p) => p.x > x);
  if (!p1 || !p2) return gameHeight;
  const slope = (p2.y - p1.y) / (p2.x - p1.x);
  return p1.y + slope * (x - p1.x);
}

function resizeCanvas() {
  const container = document.getElementById("game-container");
  let newWidth = container.clientWidth;
  let newHeight = container.clientHeight;
  canvas.width = newWidth;
  canvas.height = newHeight;
  gameWidth = newWidth;
  gameHeight = newHeight;

  // Create or resize the off-screen canvas to match the visible one
  if (!backgroundCanvas) {
    backgroundCanvas = document.createElement("canvas");
    backgroundCtx = backgroundCanvas.getContext("2d");
  }
  backgroundCanvas.width = newWidth;
  backgroundCanvas.height = newHeight;

  generateLevel();
}

function drawBoulder(ctx, x, y, scale, seed) {
  const rng = createSeededRandom(seed);
  ctx.save();
  ctx.globalAlpha = 1.0;
  const numPts = 7 + Math.floor(rng() * 3);
  const rx = (10 + rng() * 7) * scale;
  const ry = rx * (0.52 + rng() * 0.2);
  const cx = x;
  const cy = y - ry * 0.4;
  const pts = [];
  for (let i = 0; i < numPts; i++) {
    const angle = (i / numPts) * Math.PI * 2 - Math.PI / 2;
    const r = 0.78 + rng() * 0.44;
    pts.push({
      x: cx + Math.cos(angle) * rx * r,
      y: cy + Math.sin(angle) * ry * r,
    });
  }
  // Washed-out sandy tone to blend with background
  const base = 118 + Math.floor(rng() * 22);
  ctx.fillStyle = `rgb(${base + 5}, ${base - 3}, ${base - 14})`;
  ctx.beginPath();
  const start = {
    x: (pts[0].x + pts[numPts - 1].x) / 2,
    y: (pts[0].y + pts[numPts - 1].y) / 2,
  };
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < numPts; i++) {
    const next = pts[(i + 1) % numPts];
    ctx.quadraticCurveTo(
      pts[i].x,
      pts[i].y,
      (pts[i].x + next.x) / 2,
      (pts[i].y + next.y) / 2,
    );
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMesa(ctx, x, topY, width, height, seed) {
  const rng = createSeededRandom(seed);
  ctx.save();
  ctx.globalAlpha = 0.09 + rng() * 0.05;
  const rv = 160 + Math.floor(rng() * 18);
  const gv = 148 + Math.floor(rng() * 14);
  const bv = 165 + Math.floor(rng() * 18);
  ctx.fillStyle = `rgb(${rv}, ${gv}, ${bv})`;
  // Sides splay outward toward canvas bottom
  const splay = width * 0.5;
  // Slightly uneven top
  const topPts = [{ x: x - width / 2, y: topY }];
  const steps = 2 + Math.floor(rng() * 3);
  for (let i = 1; i < steps; i++) {
    topPts.push({
      x: x - width / 2 + (width * i) / steps,
      y: topY + rng() * height * 0.07,
    });
  }
  topPts.push({ x: x + width / 2, y: topY });
  ctx.beginPath();
  // Base spans full canvas height so it's rooted to the ground
  ctx.moveTo(x - width / 2 - splay, ctx.canvas.height);
  ctx.lineTo(topPts[0].x, topPts[0].y);
  for (let i = 1; i < topPts.length; i++) ctx.lineTo(topPts[i].x, topPts[i].y);
  ctx.lineTo(x + width / 2 + splay, ctx.canvas.height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDeadTree(ctx, x, y, scale, seed) {
  const rng = createSeededRandom(seed);
  ctx.save();
  const b = 58 + Math.floor(rng() * 28);
  ctx.strokeStyle = `rgb(${b + 22}, ${b}, ${b - 18})`;
  ctx.lineCap = "round";
  function branch(bx, by, angle, len, width, depth) {
    if (depth === 0 || len < 1.5) return;
    const ex = bx + Math.cos(angle) * len * scale;
    const ey = by + Math.sin(angle) * len * scale;
    ctx.lineWidth = Math.max(0.5, width);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const r = rng();
    if (r < 0.15) {
      // single continuation — bent
      branch(
        ex,
        ey,
        angle + (rng() - 0.5) * 0.7,
        len * (0.55 + rng() * 0.2),
        width * 0.72,
        depth - 1,
      );
    } else if (r < 0.75) {
      // two branches — asymmetric spreads
      branch(
        ex,
        ey,
        angle - (0.28 + rng() * 0.55),
        len * (0.45 + rng() * 0.28),
        width * 0.6,
        depth - 1,
      );
      branch(
        ex,
        ey,
        angle + (0.22 + rng() * 0.55),
        len * (0.42 + rng() * 0.28),
        width * 0.58,
        depth - 1,
      );
    } else {
      // three branches
      const s = 0.32 + rng() * 0.28;
      branch(
        ex,
        ey,
        angle - s - rng() * 0.2,
        len * (0.38 + rng() * 0.22),
        width * 0.55,
        depth - 1,
      );
      branch(
        ex,
        ey,
        angle + (rng() - 0.5) * 0.35,
        len * (0.42 + rng() * 0.2),
        width * 0.55,
        depth - 1,
      );
      branch(
        ex,
        ey,
        angle + s + rng() * 0.2,
        len * (0.38 + rng() * 0.22),
        width * 0.52,
        depth - 1,
      );
    }
  }
  const lean = (rng() - 0.5) * 0.28;
  branch(x, y, -Math.PI / 2 + lean, 28 + rng() * 14, 2.5 * scale, 4);
  ctx.restore();
}

function drawCowSkull(ctx, x, y, scale, seed) {
  const rng = createSeededRandom(seed);
  ctx.save();

  ctx.translate(x, y);
  ctx.rotate(rng());
  const W = 20 * scale; // half-width at cheeks
  const H = 24 * scale; // full height from snout base to cranium top
  const bone = 210 + Math.floor(rng() * 20);
  const boneColor = `rgb(${bone + 15}, ${bone + 8}, ${bone - 18})`;

  // Horns — emerge from upper skull, curve outward and upward
  const hornReach = (28 + rng() * 18) * scale;
  const hornLift = (18 + rng() * 14) * scale;
  ctx.strokeStyle = boneColor;
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(-W * 0.65, -H * 0.88);
  ctx.quadraticCurveTo(
    -W * 0.65 - hornReach * 0.5,
    -H - hornLift * 0.4,
    -W * 0.65 - hornReach,
    -H + hornLift * 0.2,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(W * 0.65, -H * 0.88);
  ctx.quadraticCurveTo(
    W * 0.65 + hornReach * 0.5,
    -H - hornLift * 0.4,
    W * 0.65 + hornReach,
    -H + hornLift * 0.2,
  );
  ctx.stroke();

  // Skull body — wide cranium, prominent cheekbones, long snout
  ctx.fillStyle = boneColor;
  ctx.beginPath();
  ctx.moveTo(0, 0); // snout tip
  ctx.bezierCurveTo(
    -W * 0.45,
    -H * 0.05,
    -W * 1.15,
    -H * 0.28,
    -W * 1.05,
    -H * 0.58,
  );
  ctx.bezierCurveTo(-W * 0.95, -H * 0.88, -W * 0.55, -H, 0, -H);
  ctx.bezierCurveTo(W * 0.55, -H, W * 0.95, -H * 0.88, W * 1.05, -H * 0.58);
  ctx.bezierCurveTo(W * 1.15, -H * 0.28, W * 0.45, -H * 0.05, 0, 0);
  ctx.closePath();
  ctx.fill();

  // Eye sockets
  const eyeRx = 6.5 * scale;
  const eyeRy = 8 * scale;
  const eyeX = W * 0.42;
  const eyeY = -H * 0.62;
  ctx.fillStyle = "rgba(25, 15, 5, 0.85)";
  ctx.beginPath();
  ctx.ellipse(-eyeX, eyeY, eyeRx, eyeRy, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(eyeX, eyeY, eyeRx, eyeRy, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Nasal cavity — two teardrop ovals
  ctx.fillStyle = "rgba(25, 15, 5, 0.65)";
  ctx.beginPath();
  ctx.ellipse(
    -W * 0.14,
    -H * 0.22,
    3.5 * scale,
    5.5 * scale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(W * 0.14, -H * 0.22, 3.5 * scale, 5.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBackgroundLayer() {
  // Draw Sky
  const sky = backgroundCtx.createLinearGradient(0, 0, 0, gameHeight * 0.8);
  sky.addColorStop(0, "#87CEEB");
  sky.addColorStop(1, "#FAD7A0");
  backgroundCtx.fillStyle = sky;
  backgroundCtx.fillRect(0, 0, gameWidth, gameHeight);

  // Draw Mesas
  for (const m of mesas)
    drawMesa(backgroundCtx, m.x, m.topY, m.width, m.height, m.seed);

  // Draw Boulders
  for (const b of boulders)
    drawBoulder(backgroundCtx, b.x, b.y, b.scale, b.seed);

  // Draw Cow Skulls
  for (const s of skulls)
    drawCowSkull(backgroundCtx, s.x, s.y, 0.3 * s.scale, s.seed);

  // Draw Dead Trees
  for (const t of deadTrees)
    drawDeadTree(backgroundCtx, t.x, t.y, t.scale, t.seed);

  // Draw Cacti
  for (const cactus of cacti) {
    drawSaguaro(
      backgroundCtx,
      cactus.x,
      cactus.y,
      cactus.scale,
      cactus.color,
      cactus.seed,
    );
  }

  // Draw Terrain
  backgroundCtx.beginPath();
  backgroundCtx.moveTo(0, gameHeight);
  backgroundCtx.lineTo(0, terrain[0].y);
  for (let i = 0; i < terrain.length; i++) {
    const p = terrain[i];
    if (i > 0 && p.x > hole.x && terrain[i - 1].x < hole.x) {
      backgroundCtx.lineTo(hole.x, hole.y);
      backgroundCtx.lineTo(hole.x, hole.y + hole.depth);
      backgroundCtx.lineTo(hole.x + hole.width, hole.y + hole.depth);
      backgroundCtx.lineTo(hole.x + hole.width, hole.y);
    }
    backgroundCtx.lineTo(p.x, p.y);
    const water = waterHazards.find((w) => w.x1 === p.x);
    if (water) {
      backgroundCtx.lineTo(p.x, water.y);
      backgroundCtx.lineTo(water.x2, water.y);
      backgroundCtx.lineTo(water.x2, p.y);
    }
  }
  backgroundCtx.lineTo(gameWidth, gameHeight);
  backgroundCtx.closePath();
  backgroundCtx.fillStyle = "#c2b280";
  backgroundCtx.fill();

  // Draw Water
  backgroundCtx.fillStyle = "rgba(65, 105, 225, 0.9)";
  for (const water of waterHazards) {
    backgroundCtx.fillRect(water.x1, water.y, water.x2 - water.x1, gameHeight);
  }

  // Draw Flag
  const poleX = hole.x + hole.width + 2;
  const poleTop = hole.y - 36;
  const flagW = 16;
  const flagH = 10;
  backgroundCtx.beginPath();
  backgroundCtx.moveTo(poleX, hole.y);
  backgroundCtx.lineTo(poleX, poleTop);
  backgroundCtx.strokeStyle = "#5a3e28";
  backgroundCtx.lineWidth = 1.5;
  backgroundCtx.stroke();
  backgroundCtx.beginPath();
  backgroundCtx.moveTo(poleX, poleTop);
  backgroundCtx.lineTo(poleX + flagW, poleTop + flagH / 2);
  backgroundCtx.lineTo(poleX, poleTop + flagH);
  backgroundCtx.closePath();
  backgroundCtx.fillStyle = "#c0392b";
  backgroundCtx.fill();
  backgroundCtx.fillStyle = "#f0e8d8";
  backgroundCtx.font = `bold ${Math.round(flagH * 0.75)}px Monoid, monospace`;
  backgroundCtx.textAlign = "center";
  backgroundCtx.textBaseline = "middle";
  backgroundCtx.fillText(holeNumber, poleX + flagW * 0.35, poleTop + flagH / 2);
}

function createSplash(x, y) {
  const particleCount = 10 + Math.floor(Math.random() * 5);
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.2 + Math.random() * 0.6;
    particles.push({
      type: "water",
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 20 + Math.random() * 15,
      color: "rgba(70, 130, 180, 0.8)",
      radius: Math.random() * 1.2 + 0.5,
    });
  }
}

function applyPenaltyAndReset() {
  strokes++;
  totalStrokes++;
  updateUI();
  ball.x = lastBallPosition.x;
  ball.y = lastBallPosition.y;
  ball.vx = 0;
  ball.vy = 0;
  gameState = "AIMING";
  saveState({ includeBall: true });
}

function handleCollisions() {
  for (const water of waterHazards) {
    if (
      ball.x > water.x1 &&
      ball.x < water.x2 &&
      ball.y + ball.radius > water.y
    ) {
      createSplash(ball.x, water.y);
      ballsInWater++;
      applyPenaltyAndReset();
      return;
    }
  }

  if (
    ball.x > hole.x &&
    ball.x < hole.x + hole.width &&
    ball.y + ball.radius > hole.y
  ) {
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (speed < 8) {
      if (strokes === 1) holesInOne++;
      gameState = "IN_HOLE";
      return;
    }
  }

  const terrainY = getTerrainY(ball.x);
  if (ball.y + ball.radius > terrainY) {
    ball.y = terrainY - ball.radius;

    const angle = getTerrainAngle(ball.x);
    const cos_a = Math.cos(angle);
    const sin_a = Math.sin(angle);

    let v_parallel = ball.vx * cos_a + ball.vy * sin_a;
    let v_normal = -ball.vx * sin_a + ball.vy * cos_a;

    if (v_normal > 0) {
      v_normal *= -BOUNCE_DAMPING;
    }

    ball.vx = v_parallel * cos_a - v_normal * sin_a;
    ball.vy = v_parallel * sin_a + v_normal * cos_a;
  }

  if (
    ball.y > gameHeight + ball.radius * 10 ||
    ball.x < -ball.radius ||
    ball.x > gameWidth + ball.radius
  ) {
    ballsOutOfBounds++;
    applyPenaltyAndReset();
    return;
  }
}

function startNextLevel() {
  gameState = "TRANSITIONING";
  transitionOverlay.style.opacity = 1;
  setTimeout(() => {
    holeNumber++;
    saveState();
    generateLevel();
    updateUI();
    transitionOverlay.style.opacity = 0;
    gameState = "AIMING";
  }, 500);
}

function updateUI() {
  strokesEl.textContent = strokes;
  totalStrokesEl.textContent = totalStrokes;
}

async function saveState({ includeBall = false } = {}) {
  await set("glof", {
    holeNumber,
    totalStrokes,
    holesInOne,
    strokes,
    ballsInWater,
    ballsOutOfBounds,
    ballX: includeBall ? ball.x / gameWidth : null,
  });
}

async function loadState() {
  const saved = await get("glof");
  if (!saved) return null;
  holeNumber = saved.holeNumber || 1;
  totalStrokes = saved.totalStrokes || 0;
  holesInOne = saved.holesInOne || 0;
  ballsInWater = saved.ballsInWater || 0;
  ballsOutOfBounds = saved.ballsOutOfBounds || 0;
  return { strokes: saved.strokes || 0, ballNX: saved.ballX };
}

function showMenu() {
  document.getElementById("menu-hole").textContent = `hole ${holeNumber}`;
  document.getElementById("menu-total").textContent =
    `total strokes: ${totalStrokes}`;
  document.getElementById("menu-hio").textContent =
    `holes in one: ${holesInOne}`;
  document.getElementById("menu-water").textContent =
    `balls in water: ${ballsInWater}`;
  document.getElementById("menu-oob").textContent =
    `out of bounds: ${ballsOutOfBounds}`;
  menuOverlay.style.display = "flex";
}

document.getElementById("info-panel").addEventListener("click", () => {
  triggerHaptic();
  showMenu();
});
menuOverlay.addEventListener("click", (e) => {
  if (e.target === menuOverlay) {
    triggerHaptic();
    menuOverlay.style.display = "none";
  }
});
document.getElementById("menu-reset").addEventListener("click", async () => {
  triggerHapticError();
  await set("glof", null);
  location.reload();
});

function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    if (p.life <= 0) {
      particles.splice(i, 1);
    } else {
      ctx.globalAlpha = p.life / 40;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }
}

function drawScene() {
  // 1. Slap the pre-rendered background onto the canvas in one fast operation.
  ctx.drawImage(backgroundCanvas, 0, 0);

  // 2. Draw the dynamic elements on top.
  updateAndDrawParticles();
  ball.draw();
  drawAimIndicator();
}

function drawAimIndicator() {
  if (gameState !== "AIMING" || !aimStartPos || !currentAimPos) return;
  const dx = currentAimPos.x - aimStartPos.x;
  const dy = currentAimPos.y - aimStartPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 10) return;

  const angle = Math.atan2(dy, dx);
  const maxDrag = gameWidth * MAX_DRAG_RATIO;
  const arrowLen = Math.min(dist, maxDrag);

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(angle + Math.PI);
  ctx.strokeStyle = "white";
  ctx.fillStyle = "white";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(ball.radius + 5, 0);
  ctx.lineTo(ball.radius + 5 + arrowLen, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ball.radius + 5 + arrowLen, 0);
  ctx.lineTo(ball.radius + arrowLen, -5);
  ctx.lineTo(ball.radius + arrowLen, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function getTerrainAngle(x) {
  if (x <= terrain[0].x || x >= terrain[terrain.length - 1].x) return 0;
  const p1 = terrain.findLast((p) => p.x <= x);
  const p2 = terrain.find((p) => p.x > x);
  if (!p1 || !p2) return 0;
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);
  if (isMobile() && !isLandscape()) {
    orientationWarning.style.display = "flex";
    return;
  }
  orientationWarning.style.display = "none";
  if (!lastFrameTime) {
    lastFrameTime = timestamp;
    return;
  }
  const deltaTime = (timestamp - lastFrameTime) / 1000;
  const dt_scaler = deltaTime * 60;
  lastFrameTime = timestamp;

  ctx.clearRect(0, 0, gameWidth, gameHeight);

  if (gameState === "BALL_MOVING") {
    ball.vy += GRAVITY * dt_scaler;

    const terrainY = getTerrainY(ball.x);
    const isOnGround = ball.y + ball.radius >= terrainY - 1;

    if (isOnGround) {
      // Decompose velocity to apply friction only along the rolling axis
      const angle = getTerrainAngle(ball.x);
      const cos_a = Math.cos(angle);
      const sin_a = Math.sin(angle);

      let v_parallel = ball.vx * cos_a + ball.vy * sin_a;
      let v_normal = -ball.vx * sin_a + ball.vy * cos_a;

      const frictionFactor = Math.pow(GROUND_FRICTION, dt_scaler);
      v_parallel *= frictionFactor;

      // Recombine velocity after applying friction
      ball.vx = v_parallel * cos_a - v_normal * sin_a;
      ball.vy = v_parallel * sin_a + v_normal * cos_a;
    } else {
      // In air, apply simple air friction
      const frictionFactor = Math.pow(AIR_FRICTION, dt_scaler);
      ball.vx *= frictionFactor;
      ball.vy *= frictionFactor;
    }

    ball.x += ball.vx * dt_scaler;
    ball.y += ball.vy * dt_scaler;

    handleCollisions();

    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    if (isOnGround && speed > 0.5 && Math.random() < 0.7) {
      particles.push({
        type: "sand",
        x: ball.x,
        y: ball.y + ball.radius,
        vx: -ball.vx * 0.1 + (Math.random() - 0.5) * 0.2,
        vy: -ball.vy * 0.1 + (Math.random() - 0.5) * 0.2,
        life: 15 + Math.random() * 15,
        color: "rgba(194, 178, 128, 0.7)",
        radius: Math.random() * 1.5 + 1,
      });
    }

    if (isOnGround && speed < 0.3 && gameState !== "IN_HOLE") {
      gameState = "AIMING";
      ball.vx = 0;
      ball.vy = 0;
      ball.y = getTerrainY(ball.x) - ball.radius;
      saveState({ includeBall: true });
    }
  } else if (gameState === "IN_HOLE") {
    ball.vy += GRAVITY * 1.5 * dt_scaler;
    ball.y += ball.vy * dt_scaler;
    if (ball.y > hole.y + hole.depth) startNextLevel();
  }

  drawScene();
}

function getEventPos(event) {
  const rect = canvas.getBoundingClientRect();
  let touch = null;
  if (event.type === "touchend" || event.type === "touchcancel")
    touch = event.changedTouches[0];
  else if (event.touches) touch = event.touches[0];
  const clientX = touch ? touch.clientX : event.clientX;
  const clientY = touch ? touch.clientY : event.clientY;
  if (clientX === undefined || clientY === undefined) return null;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function handleStart(event) {
  if (gameState !== "AIMING") return;
  event.preventDefault();
  aimStartPos = getEventPos(event);
  currentAimPos = aimStartPos;
}

function handleMove(event) {
  if (gameState !== "AIMING" || !aimStartPos) return;
  event.preventDefault();
  currentAimPos = getEventPos(event);
}

function handleEnd(event) {
  if (gameState !== "AIMING" || !aimStartPos) return;
  event.preventDefault();
  const aimEndPos = currentAimPos;
  if (!aimEndPos) {
    aimStartPos = null;
    currentAimPos = null;
    return;
  }
  const dx = aimEndPos.x - aimStartPos.x;
  const dy = aimEndPos.y - aimStartPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  aimStartPos = null;
  currentAimPos = null;
  if (dist < 10) return;

  triggerHaptic();
  strokes++;
  totalStrokes++;
  updateUI();
  lastBallPosition = { x: ball.x, y: ball.y };
  const maxDrag = gameWidth * MAX_DRAG_RATIO;
  const power = Math.min(dist, maxDrag) * POWER_MULTIPLIER;
  const angle = Math.atan2(dy, dx);
  ball.vx = -Math.cos(angle) * power;
  ball.vy = -Math.sin(angle) * power;
  gameState = "BALL_MOVING";
}

function drawSaguaro(ctx, x, y, scale, color = "#4a6341", seed = 1) {
  const rng = createSeededRandom(seed);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, -scale);

  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const trunkH = 80 + rng() * 40;
  const trunkW = 14;
  const armW = 10;
  const hasRight = rng() < 0.8;
  const hasLeft = rng() < 0.8;

  // Arms drawn first so trunk covers the junction
  if (hasRight) {
    const armY = trunkH * (0.3 + rng() * 0.25);
    const armOutX = trunkW / 2 + 16 + rng() * 18;
    const armTopY = armY + 22 + rng() * (trunkH * 0.35);
    ctx.lineWidth = armW;
    ctx.beginPath();
    ctx.moveTo(trunkW / 2 - 2, armY);
    ctx.lineTo(armOutX, armY);
    ctx.lineTo(armOutX, armTopY);
    ctx.stroke();
  }

  if (hasLeft) {
    const armY = trunkH * (0.3 + rng() * 0.25);
    const armOutX = -(trunkW / 2 + 16 + rng() * 18);
    const armTopY = armY + 22 + rng() * (trunkH * 0.35);
    ctx.lineWidth = armW;
    ctx.beginPath();
    ctx.moveTo(-trunkW / 2 + 2, armY);
    ctx.lineTo(armOutX, armY);
    ctx.lineTo(armOutX, armTopY);
    ctx.stroke();
  }

  // Trunk on top
  ctx.lineWidth = trunkW;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, trunkH);
  ctx.stroke();

  ctx.restore();
}
canvas.addEventListener("mousedown", handleStart);
canvas.addEventListener("mousemove", handleMove);
canvas.addEventListener("mouseup", handleEnd);
canvas.addEventListener("mouseleave", handleEnd);
canvas.addEventListener("touchstart", handleStart, { passive: false });
canvas.addEventListener("touchmove", handleMove, { passive: false });
canvas.addEventListener("touchend", handleEnd, { passive: false });
canvas.addEventListener("touchcancel", handleEnd, { passive: false });
window.addEventListener("resize", resizeCanvas);

loadState().then((saved) => {
  initHaptic();
  resizeCanvas();
  if (saved?.ballNX != null) {
    ball.x = saved.ballNX * gameWidth;
    ball.y = getTerrainY(ball.x) - BALL_RADIUS;
    strokes = saved.strokes;
  }
  updateUI();
  requestAnimationFrame(gameLoop);
});
