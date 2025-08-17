const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const holeNumberEl = document.getElementById("hole-number");
const strokesEl = document.getElementById("strokes");
const totalStrokesEl = document.getElementById("total-strokes");
const transitionOverlay = document.getElementById("transition-overlay");

const GRAVITY = 0.15;
const AIR_FRICTION = 0.995;
const GROUND_FRICTION = 0.99;
const BOUNCE_DAMPING = 0.55;
const POWER_MULTIPLIER = 0.09;
const MAX_POWER = 22;
const BALL_RADIUS = 5;
const HOLE_WIDTH = 16;
const HOLE_DEPTH = 20;

let gameWidth, gameHeight;
let ball, terrain, hole, waterHazards, particles, cacti;
let lastBallPosition = { x: 0, y: 0 };
let lastFrameTime = 0;

let gameState = "AIMING";
let strokes = 0;
let totalStrokes = 0;
let holeNumber = 1;
let levelSeed = Math.random();
let aimStartPos = null;
let currentAimPos = null;

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
  terrain = [];
  waterHazards = [];
  particles = [];
  cacti = [];

  const segments = 8 + Math.floor(levelSeed * 6);
  let lastY = gameHeight * (0.6 + ((levelSeed * 10) % 1) * 0.2);
  terrain.push({ x: 0, y: lastY });

  for (let i = 1; i < segments; i++) {
    const x = (i / segments) * gameWidth + (Math.random() - 0.5) * 50;
    const y = lastY + (Math.random() - 0.5) * gameHeight * 0.4;
    lastY = y;
    terrain.push({
      x: x,
      y: Math.max(gameHeight * 0.3, Math.min(gameHeight * 0.9, y)),
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
      ? flatEnoughSegments[
          Math.floor(Math.random() * flatEnoughSegments.length)
        ]
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
  const holeX = p1_hole.x + segWidth * 0.2 + Math.random() * (segWidth * 0.6);
  hole = {
    x: holeX,
    y: getTerrainY(holeX),
    width: HOLE_WIDTH,
    depth: HOLE_DEPTH,
  };

  const startX = gameWidth * 0.1;
  const startSegmentIndex = terrain.findIndex((p) => p.x > startX) - 1;

  if (holeNumber > 1 && Math.random() < 0.45) {
    const potentialIndices = [];
    for (let i = 1; i < terrain.length - 2; i++) {
      if (
        i !== segmentIndex &&
        i !== segmentIndex - 1 &&
        i !== segmentIndex + 1 &&
        i !== startSegmentIndex &&
        i !== startSegmentIndex - 1
      ) {
        potentialIndices.push(i);
      }
    }
    if (potentialIndices.length > 0) {
      const hazardIndex =
        potentialIndices[Math.floor(Math.random() * potentialIndices.length)];
      const p1 = terrain[hazardIndex];
      const p2 = terrain[hazardIndex + 1];
      const waterY = Math.max(p1.y, p2.y);
      terrain[hazardIndex].y = waterY;
      terrain[hazardIndex + 1].y = waterY;
      waterHazards.push({ x1: p1.x, x2: p2.x, y: waterY });
    }
  }
  // ** Replace the existing cactus generation logic with this block **
  const flatSegments = [];
  for (let i = 0; i < terrain.length - 1; i++) {
    const p1 = terrain[i];
    const p2 = terrain[i + 1];
    if (p1.y === p2.y && p2.x - p1.x > 50) {
      flatSegments.push({ startX: p1.x, endX: p2.x, y: p1.y });
    }
  }

  if (flatSegments.length > 0) {
    const numCacti = 5 + Math.floor(Math.random() * 5);
    let placedCacti = 0;
    let attempts = 0; // Failsafe to prevent infinite loops
    while (placedCacti < numCacti && attempts < 100) {
      attempts++;
      const segment =
        flatSegments[Math.floor(Math.random() * flatSegments.length)];

      const segmentWidth = segment.endX - segment.startX;
      const x = segment.startX + Math.random() * segmentWidth;
      const y = segment.y;

      if (Math.abs(x - hole.x) < 50 || x < 100) {
        continue;
      }

      // Check if the cactus is in a water hazard
      let isInWater = false;
      for (const water of waterHazards) {
        if (x > water.x1 && x < water.x2) {
          isInWater = true;
          break;
        }
      }
      if (isInWater) {
        continue;
      }

      // If all checks pass, place the cactus
      placedCacti++;
      const scale = 0.5 + Math.random() * 0.7;
      const shade = 80 + Math.floor(scale * 100);
      const color = `rgb(${shade - 20}, ${shade}, ${shade - 30})`;
      cacti.push({ x, y, scale, color, seed: Math.floor(x) });
    }
    cacti.sort((a, b) => a.scale - b.scale);
  }
  ball = new Ball(startX, getTerrainY(startX) - BALL_RADIUS);
  lastBallPosition = { x: ball.x, y: ball.y };
  strokes = 0;
}

function getTerrainY(x) {
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
  const aspectRatio = 16 / 9;
  let newWidth = container.clientWidth;
  let newHeight = container.clientHeight;
  if (newWidth / newHeight > aspectRatio) newWidth = newHeight * aspectRatio;
  else newHeight = newWidth / aspectRatio;
  canvas.width = newWidth;
  canvas.height = newHeight;
  gameWidth = newWidth;
  gameHeight = newHeight;
  generateLevel();
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
}

function handleCollisions() {
  for (const water of waterHazards) {
    if (
      ball.x > water.x1 &&
      ball.x < water.x2 &&
      ball.y + ball.radius > water.y
    ) {
      createSplash(ball.x, water.y);
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
    applyPenaltyAndReset();
    return;
  }
}

function startNextLevel() {
  gameState = "TRANSITIONING";
  transitionOverlay.style.opacity = 1;
  setTimeout(() => {
    holeNumber++;
    levelSeed = Math.random();
    generateLevel();
    updateUI();
    transitionOverlay.style.opacity = 0;
    gameState = "AIMING";
  }, 500);
}

function updateUI() {
  holeNumberEl.textContent = `Hole: ${holeNumber}`;
  strokesEl.textContent = `Strokes: ${strokes}`;
  totalStrokesEl.textContent = `Total: ${totalStrokes}`;
}

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
  const sky = ctx.createLinearGradient(0, 0, 0, gameHeight * 0.8);
  sky.addColorStop(0, "#87CEEB");
  sky.addColorStop(1, "#FAD7A0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, gameWidth, gameHeight);

  for (const cactus of cacti) {
    drawSaguaro(
      ctx,
      cactus.x,
      cactus.y,
      cactus.scale,
      cactus.color,
      cactus.seed,
    );
  }

  ctx.fillStyle = "black";
  ctx.fillRect(hole.x, hole.y, hole.width, hole.depth);

  ctx.beginPath();
  ctx.moveTo(0, gameHeight);
  ctx.lineTo(0, terrain[0].y);

  for (let i = 0; i < terrain.length; i++) {
    const p = terrain[i];
    if (i > 0 && p.x > hole.x && terrain[i - 1].x < hole.x) {
      ctx.lineTo(hole.x, hole.y);
      ctx.lineTo(hole.x, hole.y + hole.depth);
      ctx.lineTo(hole.x + hole.width, hole.y + hole.depth);
      ctx.lineTo(hole.x + hole.width, hole.y);
    }
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(gameWidth, gameHeight);
  ctx.closePath();
  ctx.fillStyle = "#c2b280";
  ctx.fill();

  ctx.fillStyle = "rgba(65, 105, 225, 0.9)";
  for (const water of waterHazards) {
    ctx.fillRect(water.x1, water.y, water.x2 - water.x1, gameHeight);
  }

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
  const power = Math.min(dist, 100);

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(angle + Math.PI);
  ctx.strokeStyle = "white";
  ctx.fillStyle = "white";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(ball.radius + 5, 0);
  ctx.lineTo(ball.radius + 5 + power, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ball.radius + 5 + power, 0);
  ctx.lineTo(ball.radius + power, -5);
  ctx.lineTo(ball.radius + power, 5);
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

    if (isOnGround && speed < 0.3) {
      gameState = "AIMING";
      ball.vx = 0;
      ball.vy = 0;
      ball.y = getTerrainY(ball.x) - ball.radius;
    }
  } else if (gameState === "IN_HOLE") {
    ball.vy += GRAVITY * 1.5 * dt_scaler;
    ball.y += ball.vy * dt_scaler;
    ball.x = ball.x * 0.95 + (hole.x + hole.width / 2) * 0.05;
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

  strokes++;
  totalStrokes++;
  updateUI();
  lastBallPosition = { x: ball.x, y: ball.y };
  const power = Math.min(dist * POWER_MULTIPLIER, MAX_POWER);
  const angle = Math.atan2(dy, dx);
  ball.vx = -Math.cos(angle) * power;
  ball.vy = -Math.sin(angle) * power;
  gameState = "BALL_MOVING";
}

function drawSaguaro(ctx, x, y, scale, color = "#4a6341", seed = 1) {
  const random = () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, -scale);

  const trunkWidth = 18;
  const trunkHeight = 100 + random() * 40;
  const mainColor = color;
  const ribColor = "rgba(0,0,0,0.15)";

  const armConfiguration = Math.floor(random() * 4);
  const hasLeftArm = armConfiguration === 1 || armConfiguration === 3;
  const hasRightArm = armConfiguration === 2 || armConfiguration === 3;

  ctx.fillStyle = mainColor;
  ctx.lineWidth = 2;

  // Right Arm
  if (hasRightArm) {
    const armWidth = 12 + random() * 5;
    const armStartY = trunkHeight * (0.25 + random() * 0.4);
    const armBendX = 15 + random() * 20;
    const armTopY = armStartY + trunkHeight * 0.4 + random() * 30;
    ctx.beginPath();
    ctx.moveTo(trunkWidth / 2, armStartY - armWidth);
    ctx.quadraticCurveTo(
      trunkWidth / 2 + armBendX,
      armStartY - armWidth,
      trunkWidth / 2 + armBendX,
      armStartY,
    );
    ctx.lineTo(trunkWidth / 2 + armBendX, armTopY);
    ctx.arc(
      trunkWidth / 2 + armBendX - armWidth / 2,
      armTopY,
      armWidth / 2,
      0,
      Math.PI,
    );
    ctx.lineTo(trunkWidth / 2 + armBendX - armWidth, armStartY);
    ctx.quadraticCurveTo(trunkWidth / 2, armStartY, trunkWidth / 2, armStartY);
    ctx.closePath();
    ctx.fill();
  }

  // Left Arm (Corrected)
  if (hasLeftArm) {
    const armWidth = 12 + random() * 5;
    const armStartY = trunkHeight * (0.3 + random() * 0.4);
    const armBendX = 15 + random() * 20;
    const armTopY = armStartY + trunkHeight * 0.35 + random() * 30;
    ctx.beginPath();
    ctx.moveTo(-trunkWidth / 2, armStartY - armWidth);
    ctx.quadraticCurveTo(
      -trunkWidth / 2 - armBendX,
      armStartY - armWidth,
      -trunkWidth / 2 - armBendX,
      armStartY,
    );
    ctx.lineTo(-trunkWidth / 2 - armBendX, armTopY);
    // This arc was the source of the bug. The start and end angles were swapped.
    ctx.arc(
      -trunkWidth / 2 - armBendX + armWidth / 2,
      armTopY,
      armWidth / 2,
      Math.PI,
      0,
    );
    ctx.lineTo(-trunkWidth / 2 - armBendX + armWidth, armStartY);
    ctx.quadraticCurveTo(
      -trunkWidth / 2,
      armStartY,
      -trunkWidth / 2,
      armStartY,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Trunk
  ctx.beginPath();
  ctx.moveTo(-trunkWidth / 2, 0);
  ctx.lineTo(-trunkWidth / 2, trunkHeight);
  ctx.arc(0, trunkHeight, trunkWidth / 2, Math.PI, 0);
  ctx.lineTo(trunkWidth / 2, 0);
  ctx.closePath();
  ctx.fill();

  // Ribs
  ctx.strokeStyle = ribColor;
  const numRibs = 4;
  for (let i = 1; i <= numRibs; i++) {
    const xPos = -trunkWidth / 2 + (trunkWidth * i) / (numRibs + 1);
    ctx.beginPath();
    ctx.moveTo(xPos, 5);
    ctx.lineTo(xPos, trunkHeight);
    ctx.stroke();
  }

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

resizeCanvas();
updateUI();
requestAnimationFrame(gameLoop);
