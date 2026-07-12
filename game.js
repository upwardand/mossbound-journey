(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const statusEl = document.querySelector("#status");
  const muteButton = document.querySelector("#muteButton");
  const fullscreenButton = document.querySelector("#fullscreenButton");
  const touchControls = document.querySelector(".touch-controls");
  const gameShell = document.querySelector(".game-shell");
  const W = 320;
  const H = 180;
  const RENDER_SCALE = canvas.width / W;
  const TILE = 16;
  const GRAVITY = 430;
  const FEATHER_DURATION = 16;
  const SHIELD_DURATION = 12;
  const keys = new Set();
  const pressed = new Set();

  function viewportIsLandscape() {
    const viewport = window.visualViewport;
    const width = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
    const height = viewport?.height || document.documentElement.clientHeight || window.innerHeight;
    return width > height;
  }

  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = true;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (value, target, amount) =>
    value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function roundedPath(x, y, w, h, radius = 4) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRounded(x, y, w, h, radius, fill, stroke = null, lineWidth = 1) {
    roundedPath(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  const SAVE_KEY = "mossbound-journey-save-v3";

  function readProgress() {
    try {
      if (typeof localStorage === "undefined") return { current: 0, unlocked: 0, totalCoins: 0, completed: false };
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (!saved || !Number.isInteger(saved.current)) return { current: 0, unlocked: 0, totalCoins: 0, completed: false };
      return {
        current: clamp(saved.current, 0, 9),
        unlocked: saved.completed ? 9 : clamp(Number.isInteger(saved.unlocked) ? saved.unlocked : saved.current, 0, 9),
        totalCoins: Math.max(0, Number(saved.totalCoins) || 0),
        completed: Boolean(saved.completed),
      };
    } catch {
      return { current: 0, unlocked: 0, totalCoins: 0, completed: false };
    }
  }

  let progress = readProgress();

  function saveProgress(current, savedCoins, completed = false) {
    const nextCurrent = clamp(current, 0, 9);
    const unlocked = completed ? 9 : Math.max(progress.unlocked || 0, nextCurrent);
    progress = { current: nextCurrent, unlocked, totalCoins: Math.max(0, savedCoins), completed };
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
    } catch {
      // The game still works when storage is blocked by the browser.
    }
  }

  class SoundBox {
    constructor() {
      this.context = null;
      this.muted = false;
      this.musicTimer = null;
      this.musicStep = 0;
      this.scene = 0;
    }

    wake() {
      if (this.muted) return;
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.context = new AudioContext();
      }
      if (this.context?.state === "suspended") this.context.resume();
      this.startMusic();
    }

    tone(freq, duration, type = "square", volume = 0.035, slide = 0) {
      if (this.muted) return;
      this.wake();
      if (!this.context) return;
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(this.context.destination);
      osc.start(now);
      osc.stop(now + duration);
    }

    setScene(scene) {
      this.scene = Math.max(0, scene);
      this.musicStep = 0;
    }

    startMusic() {
      if (this.musicTimer) return;
      this.musicTimer = setInterval(() => this.musicTick(), 210);
    }

    musicTick() {
      if (this.muted || !this.context || this.context.state !== "running") return;
      const songs = [
        [261.6, 329.6, 392, 523.3, 392, 329.6, 293.7, 392],
        [220, 261.6, 329.6, 392, 329.6, 261.6, 246.9, 329.6],
        [196, 246.9, 293.7, 392, 293.7, 246.9, 220, 293.7],
        [174.6, 220, 261.6, 349.2, 261.6, 220, 196, 261.6],
      ];
      const melody = songs[Math.floor(this.scene / 3) % songs.length];
      const step = this.musicStep % melody.length;
      this.tone(melody[step], 0.2, step % 2 ? "triangle" : "sine", 0.014);
      if (step % 2 === 0) this.tone(melody[step] / 2, 0.32, "triangle", 0.008);
      if (step % 4 === 0) this.tone(melody[step] * 1.5, 0.38, "sine", 0.005);
      if (step === 0 || step === 4) this.tone(70 + (this.scene % 3) * 8, 0.1, "square", 0.009, -12);
      this.musicStep += 1;
    }

    play(name) {
      if (name === "jump") this.tone(220, 0.12, "square", 0.035, 180);
      if (name === "coin") {
        this.tone(740, 0.08, "square", 0.025, 180);
        setTimeout(() => this.tone(980, 0.1, "square", 0.022, 120), 55);
      }
      if (name === "stomp") this.tone(150, 0.1, "square", 0.04, -55);
      if (name === "dash") {
        this.tone(180, 0.12, "sawtooth", 0.035, 420);
        setTimeout(() => this.tone(520, 0.08, "square", 0.018, -120), 45);
      }
      if (name === "bounce") this.tone(260, 0.16, "sine", 0.035, 380);
      if (name === "break") this.tone(95, 0.14, "square", 0.028, -35);
      if (name === "bossHit") this.tone(90, 0.18, "sawtooth", 0.05, -25);
      if (name === "hit") this.tone(120, 0.3, "sawtooth", 0.045, -70);
      if (name === "checkpoint") {
        [440, 554, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, "square", 0.025), i * 80));
      }
      if (name === "powerup") {
        [392, 523, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.13, "sine", 0.028, 60), i * 65));
      }
      if (name === "win") {
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "square", 0.03), i * 110));
      }
    }
  }

  const sound = new SoundBox();

  function createGrid(width, height) {
    return Array.from({ length: height }, () => Array(width).fill(0));
  }

  function block(grid, x, y, w, h, type = 1) {
    for (let ty = y; ty < y + h; ty += 1) {
      for (let tx = x; tx < x + w; tx += 1) {
        if (grid[ty]?.[tx] !== undefined) grid[ty][tx] = type;
      }
    }
  }

  function lineCoins(target, x, y, count, gap = 1) {
    for (let i = 0; i < count; i += 1) target.push({ x: (x + i * gap) * TILE + 5, y: y * TILE + 5, w: 6, h: 7, got: false });
  }

  function arcCoins(target, x, y) {
    [[0, 1], [1, 0], [2, -0.5], [3, 0], [4, 1]].forEach(([dx, dy]) => {
      target.push({ x: (x + dx) * TILE + 5, y: (y + dy) * TILE + 5, w: 6, h: 7, got: false });
    });
  }

  function powerupAt(type, tileX, tileY) {
    return { type, x: tileX * TILE + 3, y: tileY * TILE + 3, w: 10, h: 10, got: false };
  }

  function buildLevelOne() {
    const width = 126;
    const height = 12;
    const grid = createGrid(width, height);
    [[0, 18], [21, 38], [41, 66], [69, 96], [99, 126]].forEach(([a, b]) => block(grid, a, 10, b - a, 2, 1));
    block(grid, 8, 8, 4, 1, 2);
    block(grid, 15, 7, 3, 1, 2);
    block(grid, 23, 8, 5, 1, 2);
    block(grid, 32, 6, 5, 1, 2);
    block(grid, 44, 8, 4, 1, 2);
    block(grid, 51, 7, 3, 1, 2);
    block(grid, 57, 5, 5, 1, 2);
    block(grid, 71, 8, 3, 1, 2);
    block(grid, 77, 6, 5, 1, 2);
    block(grid, 88, 8, 6, 1, 2);
    block(grid, 102, 7, 4, 1, 2);
    block(grid, 109, 5, 5, 1, 2);
    block(grid, 117, 8, 4, 1, 2);

    const coins = [];
    lineCoins(coins, 8, 7, 4);
    arcCoins(coins, 18, 7);
    lineCoins(coins, 32, 5, 5);
    lineCoins(coins, 44, 7, 4);
    arcCoins(coins, 63, 7);
    lineCoins(coins, 77, 5, 5);
    lineCoins(coins, 89, 7, 5);
    arcCoins(coins, 97, 7);
    lineCoins(coins, 109, 4, 5);
    lineCoins(coins, 117, 7, 4);

    return {
      name: "苔风原野",
      subtitle: "MOSSWIND MEADOW",
      skyMode: "day",
      width,
      height,
      grid,
      spawn: { x: 2 * TILE, y: 10 * TILE - 14 },
      goal: { x: 122 * TILE + 4, y: 7 * TILE, w: 12, h: 48 },
      checkpoint: { x: 70 * TILE + 3, y: 8 * TILE, w: 10, h: 32, active: false },
      coins,
      powerups: [
        powerupAt("feather", 3, 9),
        powerupAt("shield", 45, 7),
        powerupAt("heart", 72, 7),
        powerupAt("feather", 103, 6),
        powerupAt("shield", 119, 7),
      ],
      spikes: [25, 26, 53, 54, 83, 84, 85, 105, 106].map((x) => ({ x: x * TILE, y: 10 * TILE - 7, w: 16, h: 7 })),
      enemies: [
        { x: 12 * TILE, y: 146, dir: 1 },
        { x: 29 * TILE, y: 146, dir: -1 },
        { x: 46 * TILE, y: 114, dir: 1 },
        { x: 63 * TILE, y: 146, dir: -1 },
        { x: 80 * TILE, y: 82, dir: 1 },
        { x: 92 * TILE, y: 146, dir: -1 },
        { x: 112 * TILE, y: 66, dir: 1 },
      ],
      palette: {
        skyTop: "#183653",
        skyBottom: "#5d8f83",
        far: "#254f62",
        mid: "#326a61",
        leaf: "#84a94b",
        soil: "#684b3b",
        soilDark: "#3d3440",
        brick: "#8e6650",
      },
    };
  }

  function buildLevelTwo() {
    const width = 118;
    const height = 12;
    const grid = createGrid(width, height);
    [[0, 14], [17, 31], [34, 47], [50, 72], [75, 91], [94, 118]].forEach(([a, b]) => block(grid, a, 10, b - a, 2, 3));
    block(grid, 6, 7, 4, 1, 4);
    block(grid, 19, 8, 4, 1, 4);
    block(grid, 25, 5, 4, 1, 4);
    block(grid, 36, 7, 5, 1, 4);
    block(grid, 43, 4, 3, 1, 4);
    block(grid, 52, 8, 4, 1, 4);
    block(grid, 59, 6, 5, 1, 4);
    block(grid, 68, 4, 3, 1, 4);
    block(grid, 77, 8, 4, 1, 4);
    block(grid, 84, 5, 5, 1, 4);
    block(grid, 96, 7, 3, 1, 4);
    block(grid, 103, 5, 5, 1, 4);
    block(grid, 111, 8, 4, 1, 4);

    const coins = [];
    lineCoins(coins, 6, 6, 4);
    arcCoins(coins, 12, 7);
    lineCoins(coins, 25, 4, 4);
    arcCoins(coins, 30, 6);
    lineCoins(coins, 43, 3, 3);
    lineCoins(coins, 59, 5, 5);
    lineCoins(coins, 68, 3, 3);
    arcCoins(coins, 72, 6);
    lineCoins(coins, 84, 4, 5);
    arcCoins(coins, 91, 7);
    lineCoins(coins, 103, 4, 5);
    lineCoins(coins, 111, 7, 4);

    return {
      name: "月影遗迹",
      subtitle: "MOONLIT RELICS",
      skyMode: "night",
      width,
      height,
      grid,
      spawn: { x: 2 * TILE, y: 10 * TILE - 14 },
      goal: { x: 114 * TILE + 4, y: 7 * TILE, w: 12, h: 48 },
      checkpoint: { x: 76 * TILE + 3, y: 8 * TILE, w: 10, h: 32, active: false },
      coins,
      powerups: [
        powerupAt("feather", 3, 9),
        powerupAt("shield", 37, 6),
        powerupAt("heart", 78, 7),
        powerupAt("feather", 97, 6),
        powerupAt("shield", 112, 7),
      ],
      spikes: [10, 11, 21, 22, 39, 40, 55, 56, 80, 81, 97, 98, 99, 108, 109].map((x) => ({ x: x * TILE, y: 10 * TILE - 7, w: 16, h: 7 })),
      enemies: [
        { x: 5 * TILE, y: 146, dir: 1 },
        { x: 20 * TILE, y: 114, dir: -1 },
        { x: 27 * TILE, y: 66, dir: 1 },
        { x: 38 * TILE, y: 98, dir: -1 },
        { x: 62 * TILE, y: 82, dir: 1 },
        { x: 79 * TILE, y: 114, dir: -1 },
        { x: 87 * TILE, y: 66, dir: 1 },
        { x: 101 * TILE, y: 146, dir: -1 },
        { x: 113 * TILE, y: 114, dir: 1 },
      ],
      palette: {
        skyTop: "#171b3d",
        skyBottom: "#4b4167",
        far: "#292a52",
        mid: "#3b385f",
        leaf: "#6f76a8",
        soil: "#554967",
        soilDark: "#2b2942",
        brick: "#777093",
      },
    };
  }

  function buildConfiguredLevel(config) {
    const height = 12;
    const grid = createGrid(config.width, height);
    config.floor.forEach(([start, end]) => block(grid, start, 10, end - start, 2, config.groundType));
    config.platforms.forEach(([x, y, width, type = config.platformType]) => block(grid, x, y, width, 1, type));

    const coins = [];
    config.coinRuns.forEach(([kind, x, y, count = 0, gap = 1]) => {
      if (kind === "arc") arcCoins(coins, x, y);
      else lineCoins(coins, x, y, count, gap);
    });
    const pickupAnchors = [
      config.platforms[0],
      config.platforms[Math.floor(config.platforms.length * 0.28)],
      config.platforms[Math.floor(config.platforms.length * 0.52)],
      config.platforms[Math.floor(config.platforms.length * 0.76)],
      config.platforms[Math.max(0, config.platforms.length - 2)],
    ];
    const powerups = ["feather", "shield", "heart", "feather", "shield"].map((type, index) => {
      if (index === 0) return powerupAt("feather", 3, 9);
      const [x, y, width] = pickupAnchors[index];
      return powerupAt(type, x + Math.floor(width / 2), y - 1);
    });

    return {
      name: config.name,
      subtitle: config.subtitle,
      skyMode: config.skyMode,
      width: config.width,
      height,
      grid,
      spawn: { x: 2 * TILE, y: 10 * TILE - 14 },
      goal: { x: (config.width - 4) * TILE + 4, y: 7 * TILE, w: 12, h: 48 },
      checkpoint: { x: config.checkpoint * TILE + 3, y: 8 * TILE, w: 10, h: 32, active: false },
      coins,
      powerups,
      spikes: config.spikes.map((x) => ({ x: x * TILE, y: 10 * TILE - 7, w: 16, h: 7 })),
      enemies: config.enemies.map(([x, supportY, dir]) => ({ x: x * TILE, y: supportY * TILE - 11, dir })),
      palette: config.palette,
    };
  }

  const extraLevelConfigs = [
    {
      name: "幽蓝洞窟",
      subtitle: "AZURE GROTTO",
      skyMode: "cave",
      width: 120,
      checkpoint: 58,
      groundType: 3,
      platformType: 4,
      floor: [[0, 17], [20, 35], [38, 54], [57, 75], [78, 95], [98, 120]],
      platforms: [[6, 7, 4], [14, 5, 3], [22, 8, 5], [31, 6, 4], [41, 8, 4], [49, 5, 5], [59, 7, 4], [67, 4, 5], [80, 8, 5], [90, 6, 4], [101, 8, 4], [109, 5, 5]],
      coinRuns: [["line", 6, 6, 4], ["arc", 15, 7], ["line", 22, 7, 5], ["line", 31, 5, 4], ["arc", 36, 7], ["line", 49, 4, 5], ["line", 59, 6, 4], ["line", 67, 3, 5], ["arc", 74, 7], ["line", 90, 5, 4], ["line", 101, 7, 4], ["line", 109, 4, 5]],
      spikes: [10, 11, 27, 28, 43, 44, 62, 63, 83, 84, 91, 92, 104, 105],
      enemies: [[12, 10, 1], [24, 8, -1], [33, 6, 1], [47, 10, -1], [52, 5, 1], [61, 7, -1], [70, 4, 1], [82, 8, -1], [93, 10, 1], [111, 5, -1]],
      palette: { skyTop: "#0e2438", skyBottom: "#24506a", far: "#18384e", mid: "#21536a", leaf: "#49b7a7", soil: "#385570", soilDark: "#1d2d46", brick: "#557896", enemy: "#46b7a4", enemyLight: "#8ce5d2" },
    },
    {
      name: "赤铜工坊",
      subtitle: "COPPER WORKS",
      skyMode: "sunset",
      width: 122,
      checkpoint: 63,
      groundType: 3,
      platformType: 2,
      floor: [[0, 19], [22, 39], [42, 58], [61, 80], [83, 101], [104, 122]],
      platforms: [[7, 8, 5], [15, 6, 3], [24, 7, 4], [33, 5, 5], [44, 8, 5], [53, 6, 4], [64, 8, 4], [72, 5, 5], [85, 7, 4], [94, 4, 5], [106, 8, 4], [113, 6, 5]],
      coinRuns: [["line", 7, 7, 5], ["arc", 17, 7], ["line", 24, 6, 4], ["line", 33, 4, 5], ["arc", 39, 7], ["line", 53, 5, 4], ["line", 64, 7, 4], ["line", 72, 4, 5], ["arc", 79, 7], ["line", 94, 3, 5], ["line", 106, 7, 4], ["line", 113, 5, 5]],
      spikes: [12, 13, 25, 26, 46, 47, 66, 67, 76, 77, 88, 89, 108, 109],
      enemies: [[10, 8, 1], [17, 10, -1], [26, 7, 1], [35, 5, -1], [47, 8, 1], [56, 6, -1], [67, 8, 1], [75, 5, -1], [87, 7, 1], [97, 4, -1], [115, 6, 1]],
      palette: { skyTop: "#4b2637", skyBottom: "#bf6945", far: "#69364a", mid: "#83433d", leaf: "#d28b45", soil: "#70483d", soilDark: "#352d39", brick: "#a96342", enemy: "#d06746", enemyLight: "#f2a765" },
    },
    {
      name: "浮云高墙",
      subtitle: "CLOUD RAMPART",
      skyMode: "day",
      width: 124,
      checkpoint: 64,
      groundType: 3,
      platformType: 4,
      floor: [[0, 15], [18, 33], [36, 51], [54, 70], [73, 89], [92, 107], [110, 124]],
      platforms: [[5, 7, 5], [13, 4, 4], [20, 8, 4], [28, 5, 5], [38, 7, 4], [47, 4, 4], [57, 8, 5], [67, 5, 4], [76, 7, 5], [86, 4, 3], [95, 8, 4], [103, 5, 5], [113, 7, 5]],
      coinRuns: [["line", 5, 6, 5], ["line", 13, 3, 4], ["arc", 15, 7], ["line", 28, 4, 5], ["arc", 34, 7], ["line", 47, 3, 4], ["line", 57, 7, 5], ["line", 67, 4, 4], ["arc", 71, 7], ["line", 86, 3, 3], ["line", 103, 4, 5], ["line", 113, 6, 5]],
      spikes: [10, 11, 22, 23, 40, 41, 59, 60, 78, 79, 97, 98, 115, 116],
      enemies: [[7, 7, 1], [22, 8, -1], [30, 5, 1], [40, 7, -1], [49, 4, 1], [59, 8, -1], [69, 5, 1], [79, 7, -1], [87, 4, 1], [97, 8, -1], [105, 5, 1], [116, 7, -1]],
      palette: { skyTop: "#3d7ea3", skyBottom: "#a3c7b7", far: "#527f9c", mid: "#6d9b9c", leaf: "#d5d6aa", soil: "#6f7890", soilDark: "#39445d", brick: "#9ba2af", enemy: "#e39a57", enemyLight: "#ffd092" },
    },
    {
      name: "晶辉矿井",
      subtitle: "CRYSTAL MINES",
      skyMode: "cave",
      width: 126,
      checkpoint: 70,
      groundType: 3,
      platformType: 4,
      floor: [[0, 18], [21, 37], [40, 57], [60, 77], [80, 98], [101, 126]],
      platforms: [[6, 8, 4], [14, 5, 4], [23, 7, 5], [33, 4, 4], [43, 8, 4], [51, 6, 5], [63, 8, 4], [71, 4, 5], [83, 7, 4], [91, 5, 5], [104, 8, 4], [112, 5, 5], [120, 8, 3]],
      coinRuns: [["line", 6, 7, 4], ["line", 14, 4, 4], ["arc", 18, 7], ["line", 33, 3, 4], ["line", 43, 7, 4], ["line", 51, 5, 5], ["arc", 57, 7], ["line", 71, 3, 5], ["line", 83, 6, 4], ["line", 91, 4, 5], ["arc", 98, 7], ["line", 112, 4, 5], ["line", 120, 7, 3]],
      spikes: [11, 12, 25, 26, 45, 46, 53, 54, 65, 66, 85, 86, 93, 94, 106, 107, 121],
      enemies: [[8, 8, 1], [16, 5, -1], [25, 7, 1], [35, 4, -1], [45, 8, 1], [54, 6, -1], [65, 8, 1], [74, 4, -1], [85, 7, 1], [94, 5, -1], [106, 8, 1], [115, 5, -1], [121, 8, 1]],
      palette: { skyTop: "#181c3f", skyBottom: "#3d3970", far: "#262754", mid: "#343363", leaf: "#8b6fc2", soil: "#4f4975", soilDark: "#242440", brick: "#716b99", enemy: "#aa67ce", enemyLight: "#e0a2f2" },
    },
    {
      name: "余烬王城",
      subtitle: "EMBER CITADEL",
      skyMode: "sunset",
      width: 128,
      checkpoint: 69,
      groundType: 3,
      platformType: 2,
      floor: [[0, 16], [19, 35], [38, 55], [58, 74], [77, 94], [97, 113], [116, 128]],
      platforms: [[6, 7, 4], [13, 5, 3], [21, 8, 5], [31, 5, 4], [41, 7, 5], [51, 4, 4], [61, 8, 4], [69, 5, 5], [80, 7, 4], [89, 4, 4], [99, 8, 5], [109, 5, 4], [118, 7, 5]],
      coinRuns: [["line", 6, 6, 4], ["arc", 15, 7], ["line", 21, 7, 5], ["line", 31, 4, 4], ["line", 41, 6, 5], ["line", 51, 3, 4], ["arc", 56, 7], ["line", 69, 4, 5], ["line", 80, 6, 4], ["line", 89, 3, 4], ["arc", 94, 7], ["line", 109, 4, 4], ["line", 118, 6, 5]],
      spikes: [9, 10, 23, 24, 33, 34, 43, 44, 63, 64, 71, 72, 82, 83, 101, 102, 120, 121],
      enemies: [[8, 7, 1], [14, 5, -1], [23, 8, 1], [33, 5, -1], [44, 7, 1], [53, 4, -1], [63, 8, 1], [72, 5, -1], [82, 7, 1], [91, 4, -1], [101, 8, 1], [111, 5, -1], [121, 7, 1]],
      palette: { skyTop: "#381b2b", skyBottom: "#a94338", far: "#57243a", mid: "#713039", leaf: "#e26d3f", soil: "#674039", soilDark: "#2d2731", brick: "#9b4b3b", enemy: "#e34d48", enemyLight: "#ff9b62" },
    },
    {
      name: "霜风绝岭",
      subtitle: "FROSTWIND PEAK",
      skyMode: "snow",
      width: 130,
      checkpoint: 71,
      groundType: 3,
      platformType: 4,
      floor: [[0, 17], [20, 36], [39, 56], [59, 76], [79, 96], [99, 115], [118, 130]],
      platforms: [[5, 8, 5], [14, 5, 4], [22, 7, 4], [31, 4, 5], [42, 8, 4], [50, 5, 5], [62, 7, 4], [70, 4, 5], [82, 8, 4], [90, 5, 4], [101, 7, 5], [111, 4, 4], [120, 7, 5]],
      coinRuns: [["line", 5, 7, 5], ["line", 14, 4, 4], ["arc", 18, 7], ["line", 31, 3, 5], ["line", 42, 7, 4], ["line", 50, 4, 5], ["arc", 57, 7], ["line", 70, 3, 5], ["line", 82, 7, 4], ["line", 90, 4, 4], ["arc", 96, 7], ["line", 111, 3, 4], ["line", 120, 6, 5]],
      spikes: [11, 12, 24, 25, 44, 45, 52, 53, 64, 65, 84, 85, 92, 93, 103, 104, 122, 123],
      enemies: [[7, 8, 1], [16, 5, -1], [24, 7, 1], [34, 4, -1], [44, 8, 1], [53, 5, -1], [64, 7, 1], [73, 4, -1], [84, 8, 1], [92, 5, -1], [103, 7, 1], [113, 4, -1], [123, 7, 1]],
      palette: { skyTop: "#496581", skyBottom: "#b8cad1", far: "#66839b", mid: "#8199a7", leaf: "#e2eef0", soil: "#718092", soilDark: "#3a465b", brick: "#9aa9b8", enemy: "#6199b9", enemyLight: "#b9e4ee" },
    },
    {
      name: "虚空长桥",
      subtitle: "VOID CAUSEWAY",
      skyMode: "night",
      width: 132,
      checkpoint: 76,
      groundType: 3,
      platformType: 4,
      floor: [[0, 15], [18, 34], [37, 53], [56, 72], [75, 91], [94, 110], [113, 132]],
      platforms: [[5, 7, 4], [12, 4, 4], [20, 8, 4], [28, 5, 5], [39, 7, 4], [47, 4, 4], [58, 8, 5], [68, 5, 4], [77, 7, 5], [87, 4, 4], [96, 8, 4], [105, 5, 5], [116, 7, 4], [124, 4, 4]],
      coinRuns: [["line", 5, 6, 4], ["line", 12, 3, 4], ["arc", 15, 7], ["line", 28, 4, 5], ["line", 39, 6, 4], ["line", 47, 3, 4], ["arc", 53, 7], ["line", 68, 4, 4], ["line", 77, 6, 5], ["line", 87, 3, 4], ["arc", 91, 7], ["line", 105, 4, 5], ["line", 116, 6, 4], ["line", 124, 3, 4]],
      spikes: [8, 9, 22, 23, 30, 31, 41, 42, 60, 61, 70, 71, 79, 80, 98, 99, 107, 108, 118, 119],
      enemies: [[7, 7, 1], [14, 4, -1], [22, 8, 1], [31, 5, -1], [41, 7, 1], [49, 4, -1], [61, 8, 1], [70, 5, -1], [80, 7, 1], [89, 4, -1], [98, 8, 1], [108, 5, -1], [118, 7, 1], [126, 4, -1]],
      palette: { skyTop: "#0d1029", skyBottom: "#29264e", far: "#19183c", mid: "#282552", leaf: "#7166a3", soil: "#3d385f", soilDark: "#1b1a32", brick: "#5b5680", enemy: "#7655b7", enemyLight: "#bd91ed" },
    },
    {
      name: "星冠天城",
      subtitle: "STAR-CROWN KEEP",
      skyMode: "night",
      width: 136,
      checkpoint: 70,
      groundType: 3,
      platformType: 2,
      floor: [[0, 18], [21, 38], [41, 58], [61, 78], [81, 98], [101, 118], [121, 136]],
      platforms: [[6, 7, 4], [14, 4, 4], [23, 8, 5], [33, 5, 4], [43, 7, 5], [53, 4, 4], [63, 8, 4], [72, 5, 5], [83, 7, 4], [92, 4, 5], [103, 8, 5], [113, 5, 4], [123, 7, 5], [130, 4, 3]],
      coinRuns: [["line", 6, 6, 4], ["line", 14, 3, 4], ["arc", 18, 7], ["line", 23, 7, 5], ["line", 33, 4, 4], ["line", 43, 6, 5], ["line", 53, 3, 4], ["arc", 58, 7], ["line", 72, 4, 5], ["line", 83, 6, 4], ["line", 92, 3, 5], ["arc", 98, 7], ["line", 103, 7, 5], ["line", 113, 4, 4], ["line", 123, 6, 5], ["line", 130, 3, 3]],
      spikes: [9, 10, 25, 26, 35, 36, 45, 46, 55, 56, 65, 66, 74, 75, 85, 86, 94, 95, 105, 106, 115, 116, 125, 126],
      enemies: [[8, 7, 1], [16, 4, -1], [25, 8, 1], [35, 5, -1], [45, 7, 1], [55, 4, -1], [65, 8, 1], [75, 5, -1], [85, 7, 1], [95, 4, -1], [105, 8, 1], [115, 5, -1], [125, 7, 1], [131, 4, -1]],
      palette: { skyTop: "#17142f", skyBottom: "#4e315c", far: "#282044", mid: "#3c2b55", leaf: "#c2946c", soil: "#58425f", soilDark: "#251f39", brick: "#8b5d68", enemy: "#c85d8b", enemyLight: "#f6a0be" },
    },
  ];

  const levelBuilders = [
    buildLevelOne,
    buildLevelTwo,
    ...extraLevelConfigs.map((config) => () => buildConfiguredLevel(config)),
  ];

  const levelNames = ["苔风原野", "月影遗迹", "幽蓝洞窟", "赤铜工坊", "浮云高墙", "晶辉矿井", "余烬王城", "霜风绝岭", "虚空长桥", "星冠天城"];

  const stageRules = [
    { mechanic: "冲刺起步", moving: 0, crumble: 0, bounce: 2 },
    { mechanic: "碎裂石桥", moving: 0, crumble: 2, bounce: 1 },
    { mechanic: "洞窟守卫", moving: 1, crumble: 1, bounce: 1, boss: true },
    { mechanic: "齿轮升降台", moving: 3, crumble: 1, bounce: 1 },
    { mechanic: "云墙追逐战", moving: 2, crumble: 2, bounce: 2, wind: 18 },
    { mechanic: "矿井巨兽", moving: 2, crumble: 2, bounce: 1, boss: true },
    { mechanic: "熔火机关阵", moving: 3, crumble: 3, bounce: 2 },
    { mechanic: "冰面疾走", moving: 2, crumble: 2, bounce: 2, slippery: true },
    { mechanic: "虚空极限冲刺", moving: 4, crumble: 3, bounce: 2, wind: -16 },
    { mechanic: "星冠最终决战", moving: 3, crumble: 3, bounce: 2, boss: true },
  ];

  function platformRuns(candidate) {
    const runs = [];
    for (let y = 4; y <= 8; y += 1) {
      let x = 0;
      while (x < candidate.width) {
        if (!candidate.grid[y][x] || candidate.grid[y - 1]?.[x]) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < candidate.width && candidate.grid[y][x] && !candidate.grid[y - 1]?.[x]) x += 1;
        if (x - start >= 3) runs.push({ x: start, y, width: Math.min(5, x - start) });
      }
    }
    return runs;
  }

  function safeFloorTile(candidate, target) {
    for (let offset = 0; offset < 18; offset += 1) {
      for (const sign of [1, -1]) {
        const tile = clamp(Math.round(target + offset * sign), 3, candidate.width - 6);
        const dangerous = candidate.spikes.some((spike) => Math.abs(spike.x / TILE - tile) < 2);
        if (candidate.grid[10][tile] && !dangerous) return tile;
      }
    }
    return 4;
  }

  function decorateLevel(candidate, index) {
    const rule = stageRules[index];
    const runs = platformRuns(candidate);
    candidate.mechanic = rule.mechanic;
    candidate.wind = rule.wind || 0;
    candidate.slippery = Boolean(rule.slippery);
    candidate.movingPlatforms = [];
    candidate.crumblePlatforms = [];
    candidate.bouncePads = [];

    const movingRuns = runs.filter((_, i) => i % 3 === 1).slice(0, rule.moving);
    for (const [i, run] of movingRuns.entries()) {
      for (let x = run.x; x < run.x + run.width; x += 1) candidate.grid[run.y][x] = 0;
      candidate.movingPlatforms.push({
        x: run.x * TILE,
        y: run.y * TILE,
        baseX: run.x * TILE,
        baseY: run.y * TILE,
        w: run.width * TILE,
        h: 7,
        axis: i % 2 ? "y" : "x",
        range: i % 2 ? 20 : 28,
        speed: 1.2 + index * 0.05 + i * 0.18,
        phase: i * 1.7,
        dx: 0,
        dy: 0,
      });
    }

    const used = new Set(movingRuns.map((run) => `${run.x}:${run.y}`));
    const crumbleRuns = runs.filter((run, i) => i % 3 !== 1 && !used.has(`${run.x}:${run.y}`)).slice(0, rule.crumble);
    for (const run of crumbleRuns) {
      const width = Math.min(4, run.width);
      for (let x = run.x; x < run.x + width; x += 1) candidate.grid[run.y][x] = 0;
      candidate.crumblePlatforms.push({ x: run.x * TILE, y: run.y * TILE, w: width * TILE, h: 7, timer: -1, broken: false, respawn: 0 });
    }

    for (let i = 0; i < rule.bounce; i += 1) {
      const tile = safeFloorTile(candidate, candidate.width * ((i + 1) / (rule.bounce + 1)));
      candidate.bouncePads.push({ x: tile * TILE, y: 10 * TILE - 5, w: 16, h: 5, pulse: i * 1.3 });
    }

    candidate.enemies = candidate.enemies.map((enemy, i) => ({
      ...enemy,
      type: index >= 2 && i % 5 === 2 ? "flyer" : index >= 1 && i % 4 === 1 ? "hopper" : index >= 4 && i % 6 === 3 ? "charger" : "walker",
    }));

    candidate.boss = rule.boss ? {
      x: (candidate.width - 12) * TILE,
      y: 10 * TILE - 27,
      spawnX: (candidate.width - 12) * TILE,
      spawnY: 10 * TILE - 27,
      w: 25,
      h: 27,
      vx: 0,
      vy: 0,
      grounded: false,
      facing: -1,
      hp: index === 9 ? 6 : 4,
      maxHp: index === 9 ? 6 : 4,
      walkSpeed: index === 9 ? 26 : 22,
      chargeSpeed: index === 9 ? 58 : 48,
      jumpInterval: index === 9 ? 1.35 : index === 5 ? 1.55 : 1.65,
      stunDuration: index === 9 ? 0.72 : 0.85,
      hurt: 0,
      jumpTimer: 0.8,
      active: false,
      defeated: false,
    } : null;
    return candidate;
  }

  function resetBossEncounter(boss = level?.boss, restoreHealth = false) {
    if (!boss || boss.defeated) return;
    boss.x = boss.spawnX;
    boss.y = boss.spawnY;
    boss.vx = 0;
    boss.vy = 0;
    boss.grounded = false;
    boss.facing = -1;
    if (restoreHealth) boss.hp = boss.maxHp;
    boss.hurt = 0;
    boss.jumpTimer = Math.min(0.9, boss.jumpInterval * 0.65);
    boss.active = false;
  }

  function validateLevelDefinitions() {
    if (levelBuilders.length !== 10) throw new Error(`Expected 10 levels, received ${levelBuilders.length}`);
    levelBuilders.forEach((build, index) => {
      const candidate = build();
      const checkpointTile = Math.floor(candidate.checkpoint.x / TILE);
      const goalTile = Math.floor(candidate.goal.x / TILE);
      const checkpointIsSafe = candidate.spikes.every((spike) => Math.abs(Math.floor(spike.x / TILE) - checkpointTile) >= 2);
      const firstFeather = candidate.powerups.find((powerup) => powerup.type === "feather");
      const firstFeatherIsSafe = firstFeather
        && candidate.spikes.every((spike) => !overlaps(firstFeather, spike))
        && candidate.enemies.every((enemy) => Math.abs(enemy.x - firstFeather.x) > 18 || Math.abs(enemy.y - firstFeather.y) > 14);
      const valid = candidate.grid.length === candidate.height
        && candidate.grid.every((row) => row.length === candidate.width)
        && candidate.grid[10][checkpointTile] > 0
        && candidate.grid[10][goalTile] > 0
        && checkpointIsSafe
        && firstFeatherIsSafe
        && candidate.coins.length > 0
        && candidate.powerups.length >= 5
        && candidate.enemies.length > 0;
      if (!valid) throw new Error(`Invalid level definition at stage ${index + 1}`);
      const enhanced = decorateLevel(build(), index);
      const rule = stageRules[index];
      const enhancedValid = enhanced.movingPlatforms.length === rule.moving
        && enhanced.crumblePlatforms.length === rule.crumble
        && enhanced.bouncePads.length === rule.bounce
        && Boolean(enhanced.boss) === Boolean(rule.boss)
        && enhanced.enemies.every((enemy) => ["walker", "hopper", "flyer", "charger"].includes(enemy.type));
      if (!enhancedValid) throw new Error(`Invalid enhanced mechanics at stage ${index + 1}`);
      if (enhanced.boss) {
        const remainingHp = enhanced.boss.hp - 1;
        enhanced.boss.x -= 100;
        enhanced.boss.y += 80;
        enhanced.boss.hp = remainingHp;
        enhanced.boss.active = true;
        resetBossEncounter(enhanced.boss);
        const resetValid = enhanced.boss.x === enhanced.boss.spawnX
          && enhanced.boss.y === enhanced.boss.spawnY
          && enhanced.boss.hp === remainingHp
          && !enhanced.boss.active;
        if (!resetValid) throw new Error(`Invalid boss reset at stage ${index + 1}`);
      }
    });
  }

  validateLevelDefinitions();
  const titlePalette = {
    skyTop: "#183653",
    skyBottom: "#5d8f83",
    far: "#254f62",
    mid: "#326a61",
  };
  let level;
  let levelIndex = 0;
  let player;
  let cameraX = 0;
  let cameraLookAhead = 0;
  let shake = 0;
  let state = "title";
  let stateTimer = 0;
  let totalCoins = 0;
  let levelCoins = 0;
  let lives = 3;
  let particles = [];
  let motes = [];
  let time = 0;
  let bannerTimer = 0;
  let score = 0;
  let combo = 0;
  let comboTimer = 0;
  let deathsThisLevel = 0;
  let levelStartTime = 0;
  let clearRank = "C";
  let selectedLevel = 0;

  function makePlayer(x, y) {
    return {
      x,
      y,
      w: 11,
      h: 14,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: false,
      coyote: 0,
      jumpBuffer: 0,
      jumpHold: 0,
      airJumps: 0,
      hasFeather: false,
      featherTimer: 0,
      shield: false,
      shieldTimer: 0,
      invincible: 0,
      dashTimer: 0,
      dashCooldown: 0,
      runCycle: 0,
      spawnX: x,
      spawnY: y,
    };
  }

  function loadLevel(index) {
    levelIndex = index;
    level = decorateLevel(levelBuilders[index](), index);
    player = makePlayer(level.spawn.x, level.spawn.y);
    level.enemies = level.enemies.map((enemy, i) => ({
      ...enemy,
      w: 13,
      h: 11,
      vx: 0,
      vy: 0,
      grounded: false,
      alive: true,
      squish: 0,
      seed: i * 1.7,
      hopTimer: 0.5 + (i % 4) * 0.3,
      baseY: enemy.y,
      originX: enemy.x,
    }));
    cameraX = 0;
    cameraLookAhead = 0;
    levelCoins = 0;
    particles = [];
    motes = Array.from({ length: 36 }, (_, i) => ({
      x: (i * 83) % (level.width * TILE),
      y: 20 + ((i * 47) % 125),
      speed: 2 + (i % 5),
      phase: i * 0.8,
    }));
    bannerTimer = 2.2;
    combo = 0;
    comboTimer = 0;
    deathsThisLevel = 0;
    levelStartTime = time;
    sound.setScene(index);
    announce(`第 ${index + 1} 关：${level.name}`);
  }

  function startGame(forceNew = false) {
    const continueSavedGame = !forceNew && !progress.completed;
    const startIndex = continueSavedGame ? progress.current : 0;
    totalCoins = continueSavedGame ? progress.totalCoins : 0;
    score = 0;
    lives = 3;
    saveProgress(startIndex, totalCoins, false);
    loadLevel(startIndex);
    state = "playing";
    sound.wake();
  }

  function retryCurrentStage() {
    const savedTotal = Math.max(0, totalCoins - levelCoins);
    lives = 3;
    loadLevel(levelIndex);
    totalCoins = savedTotal;
    saveProgress(levelIndex, savedTotal, false);
    state = "playing";
    sound.wake();
  }

  function openLevelSelect(preferred = progress.current) {
    selectedLevel = clamp(preferred, 0, progress.unlocked);
    state = "levelselect";
    stateTimer = 0;
    sound.setScene(selectedLevel);
    announce(`选择关卡，已解锁至第 ${progress.unlocked + 1} 关`);
  }

  function startSelectedLevel(index = selectedLevel) {
    if (index < 0 || index > progress.unlocked) return;
    selectedLevel = index;
    lives = 3;
    saveProgress(index, totalCoins, progress.completed);
    loadLevel(index);
    state = "playing";
    sound.wake();
  }

  function levelButtonRect(index) {
    return {
      x: 24 + (index % 5) * 56,
      y: 61 + Math.floor(index / 5) * 42,
      w: 48,
      h: 32,
    };
  }

  function isSolid(tx, ty) {
    if (tx < 0 || tx >= level.width) return true;
    if (ty < 0 || ty >= level.height) return false;
    return level.grid[ty][tx] > 0;
  }

  function moveActor(actor, dx, dy) {
    actor.x += dx;
    if (dx !== 0) {
      const left = Math.floor(actor.x / TILE);
      const right = Math.floor((actor.x + actor.w - 0.01) / TILE);
      const top = Math.floor(actor.y / TILE);
      const bottom = Math.floor((actor.y + actor.h - 0.01) / TILE);
      for (let ty = top; ty <= bottom; ty += 1) {
        for (let tx = left; tx <= right; tx += 1) {
          if (!isSolid(tx, ty)) continue;
          if (dx > 0) actor.x = tx * TILE - actor.w;
          else actor.x = (tx + 1) * TILE;
          actor.vx = 0;
        }
      }
    }

    actor.grounded = false;
    actor.y += dy;
    if (dy !== 0) {
      const left = Math.floor(actor.x / TILE);
      const right = Math.floor((actor.x + actor.w - 0.01) / TILE);
      const top = Math.floor(actor.y / TILE);
      const bottom = Math.floor((actor.y + actor.h - 0.01) / TILE);
      for (let ty = top; ty <= bottom; ty += 1) {
        for (let tx = left; tx <= right; tx += 1) {
          if (!isSolid(tx, ty)) continue;
          if (dy > 0) {
            actor.y = ty * TILE - actor.h;
            actor.grounded = true;
          } else {
            actor.y = (ty + 1) * TILE;
          }
          actor.vy = 0;
        }
      }
    }
  }

  function updateSpecialPlatforms(dt) {
    for (const platform of level.movingPlatforms) {
      const oldX = platform.x;
      const oldY = platform.y;
      const wave = Math.sin(time * platform.speed + platform.phase);
      platform.x = platform.baseX + (platform.axis === "x" ? wave * platform.range : 0);
      platform.y = platform.baseY + (platform.axis === "y" ? wave * platform.range : 0);
      platform.dx = platform.x - oldX;
      platform.dy = platform.y - oldY;
    }
    for (const platform of level.crumblePlatforms) {
      if (platform.broken) {
        platform.respawn -= dt;
        if (platform.respawn <= 0) {
          platform.broken = false;
          platform.timer = -1;
        }
      } else if (platform.timer >= 0) {
        platform.timer -= dt;
        if (platform.timer <= 0) {
          platform.broken = true;
          platform.respawn = 2.8;
          sound.play("break");
          addParticles(platform.x + platform.w / 2, platform.y, level.palette.brick, 12, 55);
        }
      }
    }
  }

  function resolveSpecialPlatforms(actor, previousBottom) {
    const surfaces = [
      ...level.movingPlatforms,
      ...level.crumblePlatforms.filter((platform) => !platform.broken),
    ];
    if (actor.vy >= 0) {
      for (const platform of surfaces) {
        const currentBottom = actor.y + actor.h;
        const horizontal = actor.x + actor.w > platform.x + 2 && actor.x < platform.x + platform.w - 2;
        if (!horizontal || previousBottom > platform.y + 5 || currentBottom < platform.y) continue;
        actor.y = platform.y - actor.h;
        actor.vy = 0;
        actor.grounded = true;
        if (platform.dx) actor.x += platform.dx;
        if (Object.prototype.hasOwnProperty.call(platform, "timer") && platform.timer < 0) platform.timer = 0.55;
        break;
      }
    }

    if (actor !== player || actor.vy < 0) return;
    for (const pad of level.bouncePads) {
      const horizontal = actor.x + actor.w > pad.x + 2 && actor.x < pad.x + pad.w - 2;
      if (!horizontal || previousBottom > pad.y + 5 || actor.y + actor.h < pad.y) continue;
      actor.y = pad.y - actor.h;
      actor.vy = -270;
      actor.grounded = false;
      sound.play("bounce");
      addParticles(pad.x + 8, pad.y, "#9ff3c6", 10, 55);
      break;
    }
  }

  function addParticles(x, y, color, count = 6, force = 45) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = force * (0.35 + Math.random() * 0.75);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        color,
        size: Math.random() > 0.5 ? 2 : 1,
      });
    }
  }

  function damagePlayer() {
    if (player.invincible > 0 || state !== "playing") return;
    if (player.shield) {
      player.shield = false;
      player.shieldTimer = 0;
      player.invincible = 1;
      sound.play("checkpoint");
      shake = 0.14;
      addParticles(player.x + 5, player.y + 7, "#7ddff2", 14, 60);
      announce("护盾抵挡了一次伤害");
      return;
    }
    lives -= 1;
    deathsThisLevel += 1;
    combo = 0;
    comboTimer = 0;
    sound.play("hit");
    shake = 0.28;
    addParticles(player.x + 5, player.y + 7, "#ef6375", 12, 75);
    if (lives <= 0) {
      state = "gameover";
      stateTimer = 0;
      announce(`第 ${levelIndex + 1} 关挑战失败，按回车重试本关`);
      return;
    }
    resetBossEncounter();
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.vx = 0;
    player.vy = 0;
    player.invincible = 1.5;
    cameraLookAhead = 0;
    cameraX = clamp(player.x - W * 0.35, 0, level.width * TILE - W);
  }

  function updatePlayer(dt) {
    const left = keys.has("ArrowLeft") || keys.has("KeyA");
    const right = keys.has("ArrowRight") || keys.has("KeyD");
    const jumpHeld = keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");
    const jumpPressed = pressed.has("Space") || pressed.has("ArrowUp") || pressed.has("KeyW");
    const dashPressed = pressed.has("ShiftLeft") || pressed.has("ShiftRight") || pressed.has("KeyJ");
    const axis = Number(right) - Number(left);

    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    if (dashPressed && player.dashCooldown <= 0) {
      player.dashTimer = 0.15;
      player.dashCooldown = 0.58;
      player.vx = player.facing * 215;
      player.vy = 0;
      player.invincible = Math.max(player.invincible, 0.17);
      sound.play("dash");
      addParticles(player.x + player.w / 2, player.y + player.h / 2, "#ffe08a", 12, 75);
      shake = Math.max(shake, 0.08);
    }

    if (jumpPressed) player.jumpBuffer = 0.13;
    else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

    if (player.grounded) {
      player.coyote = 0.1;
      player.airJumps = player.hasFeather ? 1 : 0;
      player.jumpHold = 0;
    }
    else player.coyote = Math.max(0, player.coyote - dt);

    const previousBottom = player.y + player.h;
    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      moveActor(player, player.vx * dt, 0);
      addParticles(player.x + player.w / 2 - player.facing * 5, player.y + player.h / 2, "#f7cf72", 1, 18);
    } else {
      const targetSpeed = axis * 88;
      const accel = player.grounded ? (level.slippery ? 260 : 680) : 380;
      player.vx = approach(player.vx, targetSpeed, accel * dt);
      if (!axis) player.vx = approach(player.vx, 0, (player.grounded ? (level.slippery ? 95 : 780) : 115) * dt);
      if (axis) player.facing = axis;

      const groundJump = player.coyote > 0;
      const airJump = !groundJump && player.airJumps > 0;
      if (player.jumpBuffer > 0 && (groundJump || airJump)) {
        if (airJump) player.airJumps -= 1;
        player.vy = airJump ? -190 : -205;
        player.jumpHold = airJump ? 0.2 : 0.28;
        player.grounded = false;
        player.coyote = 0;
        player.jumpBuffer = 0;
        sound.play("jump");
        addParticles(player.x + 6, player.y + player.h, airJump ? "#8de5e3" : "#d8c59f", airJump ? 8 : 4, airJump ? 38 : 25);
      }

      if (jumpHeld && player.jumpHold > 0 && player.vy < 0) {
        player.vy -= 230 * dt;
        player.jumpHold = Math.max(0, player.jumpHold - dt);
      } else if (!jumpHeld) {
        player.jumpHold = 0;
        if (player.vy < -55) player.vy += 480 * dt;
      }
      if (!player.grounded && level.wind) player.vx += level.wind * dt;
      player.vy = Math.min(player.vy + GRAVITY * dt, 245);
      moveActor(player, player.vx * dt, player.vy * dt);
    }
    resolveSpecialPlatforms(player, previousBottom);

    player.runCycle += Math.abs(player.vx) * dt * 0.14;
    player.invincible = Math.max(0, player.invincible - dt);
    if (player.featherTimer > 0) {
      player.featherTimer = Math.max(0, player.featherTimer - dt);
      if (player.featherTimer === 0) {
        player.hasFeather = false;
        player.airJumps = 0;
        announce("风羽效果结束");
      }
    }
    if (player.shieldTimer > 0) {
      player.shieldTimer = Math.max(0, player.shieldTimer - dt);
      if (player.shieldTimer === 0) {
        player.shield = false;
        announce("星盾效果结束");
      }
    }
    if (player.y > level.height * TILE + 35) damagePlayer();

    for (const spike of level.spikes) {
      const hitbox = { x: spike.x + 3, y: spike.y + 2, w: spike.w - 6, h: spike.h - 2 };
      if (overlaps(player, hitbox)) damagePlayer();
    }

    for (const coin of level.coins) {
      if (!coin.got && overlaps(player, coin)) {
        coin.got = true;
        levelCoins += 1;
        totalCoins += 1;
        combo = Math.min(9, combo + 1);
        comboTimer = 2.4;
        score += 10 * combo;
        sound.play("coin");
        addParticles(coin.x + 3, coin.y + 3, "#ffd45a", 8, 46);
      }
    }

    for (const powerup of level.powerups) {
      if (powerup.got || !overlaps(player, powerup)) continue;
      powerup.got = true;
      sound.play("powerup");
      if (powerup.type === "feather") {
        player.hasFeather = true;
        player.featherTimer = FEATHER_DURATION;
        player.airJumps = 1;
        announce(`获得风羽：${FEATHER_DURATION} 秒内可以二段跳`);
        addParticles(powerup.x + 5, powerup.y + 5, "#b8f3ef", 16, 58);
      } else if (powerup.type === "shield") {
        player.shield = true;
        player.shieldTimer = SHIELD_DURATION;
        announce(`获得星盾：${SHIELD_DURATION} 秒内抵挡一次伤害`);
        addParticles(powerup.x + 5, powerup.y + 5, "#7ddff2", 16, 58);
      } else {
        lives = Math.min(3, lives + 1);
        announce(lives === 3 ? "获得生命果：生命已恢复" : "获得生命果");
        addParticles(powerup.x + 5, powerup.y + 5, "#f58b98", 16, 58);
      }
    }

    if (!level.checkpoint.active && overlaps(player, level.checkpoint)) {
      level.checkpoint.active = true;
      player.spawnX = level.checkpoint.x - 2;
      player.spawnY = level.checkpoint.y + level.checkpoint.h - player.h;
      sound.play("checkpoint");
      announce("检查点已点亮");
      addParticles(level.checkpoint.x + 5, level.checkpoint.y + 4, "#6ff0d2", 16, 55);
    }

    if (overlaps(player, level.goal) && !level.boss?.defeated && level.boss) {
      announce("星门被守卫封锁，先击败首领");
    } else if (overlaps(player, level.goal)) {
      state = "levelclear";
      stateTimer = 0;
      player.vx = 0;
      const coinRatio = levelCoins / Math.max(1, level.coins.length);
      const elapsed = time - levelStartTime;
      clearRank = coinRatio >= 0.8 && deathsThisLevel === 0 && elapsed < 95 ? "S" : coinRatio >= 0.55 && deathsThisLevel <= 1 ? "A" : coinRatio >= 0.3 ? "B" : "C";
      score += { S: 1000, A: 650, B: 350, C: 150 }[clearRank];
      sound.play("win");
      if (levelIndex < levelBuilders.length - 1) saveProgress(levelIndex + 1, totalCoins, progress.completed);
      else saveProgress(0, totalCoins, true);
      announce(`第 ${levelIndex + 1} 关完成`);
    }
  }

  function updateEnemies(dt) {
    for (const enemy of level.enemies) {
      if (!enemy.alive) {
        enemy.squish -= dt;
        continue;
      }

      if (enemy.type === "flyer") {
        enemy.x += enemy.dir * 23 * dt;
        enemy.y = enemy.baseY - 18 + Math.sin(time * 3.2 + enemy.seed) * 11;
        if (Math.abs(enemy.x - enemy.originX) > 42) enemy.dir *= -1;
      } else {
        const nearby = Math.abs(player.x - enemy.x) < 72 && Math.abs(player.y - enemy.y) < 28;
        const speed = enemy.type === "charger" && nearby ? 58 : 26;
        if (enemy.type === "charger" && nearby) enemy.dir = player.x < enemy.x ? -1 : 1;
        enemy.vx = enemy.dir * speed;
        if (enemy.type === "hopper") {
          enemy.hopTimer -= dt;
          if (enemy.grounded && enemy.hopTimer <= 0) {
            enemy.vy = -145;
            enemy.hopTimer = 1.1 + (enemy.seed % 0.5);
          }
        }
        enemy.vy = Math.min(enemy.vy + GRAVITY * dt, 200);
        const beforeX = enemy.x;
        moveActor(enemy, enemy.vx * dt, enemy.vy * dt);
        if (Math.abs(enemy.x - beforeX) < 0.01) enemy.dir *= -1;

        if (enemy.grounded) {
          const probeX = enemy.dir > 0 ? enemy.x + enemy.w + 2 : enemy.x - 2;
          const probeY = enemy.y + enemy.h + 2;
          if (!isSolid(Math.floor(probeX / TILE), Math.floor(probeY / TILE))) enemy.dir *= -1;
        }
      }

      if (overlaps(player, enemy) && (player.invincible <= 0 || player.dashTimer > 0)) {
        const stomp = player.vy > 35 && player.y + player.h - enemy.y < 8;
        const dashHit = player.dashTimer > 0;
        if (stomp || dashHit) {
          enemy.alive = false;
          enemy.squish = 0.3;
          if (stomp) player.vy = -115;
          sound.play(dashHit ? "dash" : "stomp");
          combo = Math.min(9, combo + 2);
          comboTimer = 2.8;
          score += dashHit ? 140 : 100;
          addParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#95d45a", 8, 48);
          shake = 0.1;
        } else {
          damagePlayer();
        }
      }
    }
  }

  function updateBoss(dt) {
    const boss = level.boss;
    if (!boss || boss.defeated) return;
    boss.hurt = Math.max(0, boss.hurt - dt);
    if (!boss.active) {
      if (Math.abs(player.x - boss.x) < 210) {
        boss.active = true;
        announce("首领出现！冲刺或踩击可以造成伤害");
      } else return;
    }

    boss.facing = player.x < boss.x ? -1 : 1;
    boss.jumpTimer -= dt;
    boss.vx = boss.facing * (boss.jumpTimer < 0.35 ? boss.chargeSpeed : boss.walkSpeed);
    if (boss.grounded && boss.jumpTimer <= 0) {
      boss.vy = -175;
      boss.jumpTimer = boss.jumpInterval;
    }
    boss.vy = Math.min(boss.vy + GRAVITY * dt, 230);
    moveActor(boss, boss.vx * dt, boss.vy * dt);

    if (!overlaps(player, boss) || boss.hurt > 0) return;
    const stomp = player.vy > 35 && player.y + player.h - boss.y < 10;
    const dashHit = player.dashTimer > 0;
    if (stomp || dashHit) {
      boss.hp -= 1;
      boss.hurt = boss.stunDuration;
      player.vy = stomp ? -145 : -70;
      player.dashTimer = 0;
      sound.play("bossHit");
      shake = 0.25;
      score += 250;
      addParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, "#ffbd73", 20, 85);
      if (boss.hp <= 0) {
        boss.defeated = true;
        score += 1200;
        sound.play("win");
        announce("首领已击败，星门解锁！");
        addParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, "#ffe788", 40, 110);
      }
    } else {
      damagePlayer();
    }
  }

  function updateParticles(dt) {
    for (const particle of particles) {
      particle.life -= dt;
      particle.vy += 120 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    particles = particles.filter((particle) => particle.life > 0);
  }

  function update(dt) {
    time += dt;
    stateTimer += dt;
    bannerTimer = Math.max(0, bannerTimer - dt);
    shake = Math.max(0, shake - dt);
    comboTimer = Math.max(0, comboTimer - dt);
    if (comboTimer === 0) combo = 0;

    if (pressed.has("KeyP") && ["playing", "paused"].includes(state)) {
      state = state === "playing" ? "paused" : "playing";
      announce(state === "paused" ? "游戏暂停" : "继续游戏");
    }

    if (pressed.has("KeyR") && ["playing", "paused"].includes(state)) {
      const savedTotal = totalCoins - levelCoins;
      loadLevel(levelIndex);
      totalCoins = savedTotal;
      state = "playing";
    }

    if (pressed.has("KeyL") && ["title", "victory"].includes(state)) openLevelSelect();

    if (state === "levelselect") {
      const previousSelection = selectedLevel;
      if (pressed.has("ArrowLeft") || pressed.has("KeyA")) selectedLevel = Math.max(0, selectedLevel - 1);
      if (pressed.has("ArrowRight") || pressed.has("KeyD")) selectedLevel = Math.min(progress.unlocked, selectedLevel + 1);
      if (pressed.has("ArrowUp") || pressed.has("KeyW")) selectedLevel = Math.max(0, selectedLevel - 5);
      if (pressed.has("ArrowDown") || pressed.has("KeyS")) selectedLevel = Math.min(progress.unlocked, selectedLevel + 5);
      if (selectedLevel !== previousSelection) sound.setScene(selectedLevel);
    }

    if (state === "playing") {
      updateSpecialPlatforms(dt);
      updatePlayer(dt);
      updateEnemies(dt);
      updateBoss(dt);
      const desiredLookAhead = clamp(player.vx * 0.22, -18, 18);
      cameraLookAhead = lerp(cameraLookAhead, desiredLookAhead, 1 - Math.pow(0.08, dt));
      const focusX = player.x + player.w / 2 + cameraLookAhead;
      const screenFocus = focusX - cameraX;
      const leftDeadZone = W * 0.34;
      const rightDeadZone = W * 0.58;
      let cameraTarget = cameraX;
      if (screenFocus < leftDeadZone) cameraTarget = focusX - leftDeadZone;
      else if (screenFocus > rightDeadZone) cameraTarget = focusX - rightDeadZone;
      cameraTarget = clamp(cameraTarget, 0, level.width * TILE - W);
      cameraX = lerp(cameraX, cameraTarget, 1 - Math.pow(0.035, dt));
    } else if (state === "levelclear" && stateTimer > 2.15) {
      if (levelIndex < levelBuilders.length - 1) {
        openLevelSelect(levelIndex + 1);
      } else {
        state = "victory";
        stateTimer = 0;
        announce("通关成功！按回车进入选关");
      }
    }

    updateParticles(dt);
    if (pressed.has("Enter") || pressed.has("Space")) {
      if (state === "title") startGame(false);
      else if (state === "gameover") retryCurrentStage();
      else if (state === "victory") openLevelSelect(9);
      else if (state === "levelselect") startSelectedLevel();
    }
    pressed.clear();
  }

  function drawPixelText(text, x, y, size = 8, color = "#fff", align = "left") {
    ctx.font = `700 ${size}px "Microsoft YaHei", "Trebuchet MS", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(10, 22, 36, 0.48)";
    ctx.shadowBlur = Math.max(1, size * 0.18);
    ctx.shadowOffsetY = 0.8;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawBackground() {
    const p = level?.palette || titlePalette;
    const skyMode = state === "title" ? "day" : (level?.skyMode || "day");
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, p.skyTop);
    gradient.addColorStop(1, p.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const night = skyMode === "night";
    if (skyMode === "cave") {
      ctx.fillStyle = p.far;
      for (let i = 0; i < 9; i += 1) {
        const x = i * 43 - 12;
        const height = 12 + (i % 4) * 8;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + 12, height * 0.55, x + 12, height);
        ctx.quadraticCurveTo(x + 13, height * 0.55, x + 24, 0);
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 12; i += 1) {
        const cx = (i * 67 + 19) % W;
        const cy = 23 + ((i * 29) % 78);
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 5);
        glow.addColorStop(0, "rgba(154, 255, 240, .8)");
        glow.addColorStop(1, "rgba(126, 231, 223, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (night) {
      const moonGlow = ctx.createRadialGradient(260, 29, 4, 260, 29, 25);
      moonGlow.addColorStop(0, "rgba(255, 250, 219, .95)");
      moonGlow.addColorStop(0.44, "rgba(236, 231, 204, .72)");
      moonGlow.addColorStop(1, "rgba(220, 229, 255, 0)");
      ctx.fillStyle = moonGlow;
      ctx.beginPath();
      ctx.arc(260, 29, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f4edcf";
      ctx.beginPath();
      ctx.arc(260, 29, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(178, 191, 225, .8)";
      for (let i = 0; i < 18; i += 1) {
        const radius = i % 4 === 0 ? 1.15 : 0.65;
        ctx.beginPath();
        ctx.arc((i * 53 + 17) % W, 14 + ((i * 31) % 70), radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const sunColor = skyMode === "sunset" ? "255, 174, 86" : "255, 227, 145";
      const sunGlow = ctx.createRadialGradient(258, 29, 5, 258, 29, 30);
      sunGlow.addColorStop(0, `rgba(${sunColor}, 1)`);
      sunGlow.addColorStop(0.42, `rgba(${sunColor}, .65)`);
      sunGlow.addColorStop(1, `rgba(${sunColor}, 0)`);
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(258, 29, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${sunColor})`;
      ctx.beginPath();
      ctx.arc(258, 29, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    const farOffset = Math.floor(cameraX * 0.1);
    ctx.fillStyle = p.far;
    for (let x = -50; x < W + 70; x += 70) {
      const px = x - (farOffset % 70);
      const peak = 70 + ((x / 70) % 2) * 12;
      ctx.beginPath();
      ctx.moveTo(px - 8, 140);
      ctx.quadraticCurveTo(px + 10, 108, px + 30, peak);
      ctx.quadraticCurveTo(px + 49, 108, px + 70, 140);
      ctx.closePath();
      ctx.fill();
    }

    const midOffset = Math.floor(cameraX * 0.23);
    ctx.fillStyle = p.mid;
    for (let x = -35; x < W + 60; x += 45) {
      const px = x - (midOffset % 45);
      const peak = 100 + ((x / 45) % 3) * 7;
      ctx.beginPath();
      ctx.moveTo(px - 5, 158);
      ctx.quadraticCurveTo(px + 7, 124, px + 21, peak);
      ctx.quadraticCurveTo(px + 32, 125, px + 50, 158);
      ctx.closePath();
      ctx.fill();
    }

    if (["day", "sunset", "snow"].includes(skyMode)) {
      ctx.fillStyle = skyMode === "sunset" ? "rgba(240, 203, 178, .72)" : "rgba(239, 247, 231, .72)";
      for (let i = 0; i < 5; i += 1) {
        const cloudX = ((i * 91 - cameraX * (0.04 + i * 0.003) + time * 1.3) % 420 + 420) % 420 - 50;
        const cloudY = 25 + (i % 3) * 19;
        ctx.beginPath();
        ctx.ellipse(cloudX + 13, cloudY + 2, 15, 4.5, 0, 0, Math.PI * 2);
        ctx.ellipse(cloudX + 8, cloudY, 7, 6, 0, 0, Math.PI * 2);
        ctx.ellipse(cloudX + 17, cloudY - 2, 9, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (skyMode === "snow") {
      ctx.fillStyle = "#f1f7f4bb";
      for (let i = 0; i < 24; i += 1) {
        const snowX = Math.floor(((i * 47 - cameraX * 0.08 + time * (4 + i % 3)) % 350 + 350) % 350) - 15;
        const snowY = Math.floor(((i * 31 + time * (8 + i % 4)) % 170));
        ctx.beginPath();
        ctx.arc(snowX, snowY, i % 5 === 0 ? 1.1 : 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawTile(type, tx, ty) {
    const x = tx * TILE - cameraX;
    const y = ty * TILE - 12;
    const p = level.palette;
    if (type === 1) {
      const soil = ctx.createLinearGradient(x, y, x, y + TILE);
      soil.addColorStop(0, p.soil);
      soil.addColorStop(1, p.soilDark);
      ctx.fillStyle = soil;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "rgba(255, 255, 255, .08)";
      ctx.beginPath();
      ctx.arc(x + 5, y + 9, 1.2, 0, Math.PI * 2);
      ctx.arc(x + 12, y + 13, 0.8, 0, Math.PI * 2);
      ctx.fill();
      if (!isSolid(tx, ty - 1)) {
        ctx.fillStyle = p.leaf;
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.quadraticCurveTo(x + 4, y - 1, x + 8, y + 2);
        ctx.quadraticCurveTo(x + 12, y - 1, x + 16, y + 3);
        ctx.lineTo(x + 16, y + 5);
        ctx.lineTo(x, y + 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(245, 255, 205, .45)";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y + 1.8);
        ctx.quadraticCurveTo(x + 7, y - 0.5, x + 16, y + 2);
        ctx.stroke();
      }
    } else if (type === 2) {
      const brick = ctx.createLinearGradient(x, y, x, y + TILE);
      brick.addColorStop(0, p.brick);
      brick.addColorStop(1, p.soil);
      fillRounded(x + 0.35, y + 0.35, TILE - 0.7, TILE - 0.7, 2.2, brick, "rgba(28, 31, 45, .3)", 0.7);
      ctx.strokeStyle = "rgba(36, 32, 42, .3)";
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 8);
      ctx.lineTo(x + 15, y + 8);
      ctx.moveTo(x + 8, y + 1);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 4, y + 8);
      ctx.lineTo(x + 4, y + 15);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 239, 206, .25)";
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + 7, y + 2);
      ctx.stroke();
    } else {
      const stone = ctx.createLinearGradient(x, y, x, y + TILE);
      stone.addColorStop(0, p.brick);
      stone.addColorStop(0.28, p.soil);
      stone.addColorStop(1, p.soilDark);
      fillRounded(x + 0.3, y + 0.3, TILE - 0.6, TILE - 0.6, 2.8, stone, "rgba(225, 236, 241, .18)", 0.7);
      ctx.fillStyle = "rgba(255, 255, 255, .14)";
      ctx.beginPath();
      ctx.ellipse(x + 6, y + 4, 4.2, 1.1, -0.1, 0, Math.PI * 2);
      ctx.ellipse(x + 9, y + 9, 3.2, 0.8, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWorld() {
    const minX = Math.max(0, Math.floor(cameraX / TILE));
    const maxX = Math.min(level.width - 1, Math.ceil((cameraX + W) / TILE));
    for (let ty = 0; ty < level.height; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        const type = level.grid[ty][tx];
        if (type) drawTile(type, tx, ty);
      }
    }

    for (const mote of motes) {
      const x = mote.x - cameraX * 0.65;
      if (x < -2 || x > W + 2) continue;
      const y = mote.y + Math.sin(time * mote.speed + mote.phase) * 3 - 12;
      ctx.fillStyle = levelIndex === 0 ? "#d8ef9a88" : "#b8c4ff77";
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const platform of level.movingPlatforms) drawSpecialPlatform(platform, "moving");
    for (const platform of level.crumblePlatforms) if (!platform.broken) drawSpecialPlatform(platform, "crumble");
    for (const pad of level.bouncePads) drawBouncePad(pad);
    for (const spike of level.spikes) drawSpikes(spike);
    for (const coin of level.coins) if (!coin.got) drawCoin(coin);
    for (const powerup of level.powerups) if (!powerup.got) drawPowerup(powerup);
    drawCheckpoint(level.checkpoint);
    drawGoal(level.goal);
    for (const enemy of level.enemies) drawEnemy(enemy);
    drawBoss(level.boss);

    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x - cameraX, particle.y - 12, particle.size * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawPlayer();
  }

  function drawSpecialPlatform(platform, kind) {
    const x = platform.x - cameraX;
    const y = platform.y - 12;
    if (x + platform.w < -8 || x > W + 8) return;
    const warning = kind === "crumble" && platform.timer >= 0;
    ctx.save();
    if (warning) ctx.translate((Math.random() - 0.5) * 1.8, 0);
    const fill = kind === "moving" ? "#5ba8ae" : warning ? "#d7835d" : "#a36f58";
    fillRounded(x, y, platform.w, platform.h, 3, fill, "rgba(242, 255, 238, .55)", 0.8);
    ctx.fillStyle = kind === "moving" ? "rgba(169,255,241,.65)" : "rgba(255,226,183,.5)";
    for (let px = x + 6; px < x + platform.w - 3; px += 12) ctx.fillRect(px, y + 2, 5, 1);
    ctx.restore();
  }

  function drawBouncePad(pad) {
    const x = pad.x - cameraX;
    const y = pad.y - 12;
    const pulse = 1 + Math.sin(time * 7 + pad.pulse) * 0.12;
    ctx.save();
    ctx.translate(x + 8, y + 4);
    ctx.scale(1, pulse);
    fillRounded(-8, -4, 16, 5, 2.5, "#55d39a", "#d6ffe7", 0.8);
    ctx.fillStyle = "#f7e879";
    ctx.beginPath();
    ctx.moveTo(-4, -1);
    ctx.lineTo(0, -4);
    ctx.lineTo(4, -1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBoss(boss) {
    if (!boss || boss.defeated) return;
    const x = boss.x - cameraX;
    const y = boss.y - 12;
    if (x < -40 || x > W + 40) return;
    ctx.save();
    if (boss.hurt > 0 && Math.floor(boss.hurt * 18) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(10, 18, 31, .3)";
    ctx.beginPath();
    ctx.ellipse(x + boss.w / 2, y + boss.h, 16, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(x, y, x, y + boss.h);
    body.addColorStop(0, level.palette.enemyLight || "#ffc078");
    body.addColorStop(1, level.palette.enemy || "#b84d62");
    fillRounded(x, y + 4, boss.w, boss.h - 4, 10, body, "rgba(255,240,190,.55)", 1);
    ctx.fillStyle = "#fff7dc";
    ctx.beginPath();
    ctx.arc(x + 7, y + 13, 3, 0, Math.PI * 2);
    ctx.arc(x + 18, y + 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#36283d";
    ctx.beginPath();
    ctx.arc(x + 7 + boss.facing, y + 13, 1.2, 0, Math.PI * 2);
    ctx.arc(x + 18 + boss.facing, y + 13, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6d067";
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 6);
    ctx.lineTo(x + 7, y - 1);
    ctx.lineTo(x + 11, y + 6);
    ctx.lineTo(x + 15, y - 3);
    ctx.lineTo(x + 20, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (boss.active) {
      fillRounded(104, 27, 112, 9, 4, "rgba(20,25,39,.8)", "rgba(255,226,154,.38)", 0.6);
      ctx.fillStyle = "#ef756e";
      ctx.fillRect(108, 30, 104 * (boss.hp / boss.maxHp), 3);
      drawPixelText("首领", 160, 28, 5, "#fff0c3", "center");
    }
  }

  function drawSpikes(spike) {
    const x = spike.x - cameraX;
    const y = spike.y - 12;
    const metal = ctx.createLinearGradient(x, y, x, y + 8);
    metal.addColorStop(0, "#f2f5ef");
    metal.addColorStop(0.55, levelIndex === 0 ? "#b7c8c4" : "#b9bfd6");
    metal.addColorStop(1, "#687486");
    ctx.fillStyle = metal;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + i * 4 + 0.2, y + 7);
      ctx.quadraticCurveTo(x + i * 4 + 1.4, y + 2, x + i * 4 + 2.1, y);
      ctx.quadraticCurveTo(x + i * 4 + 3, y + 2.5, x + i * 4 + 3.8, y + 7);
      ctx.closePath();
      ctx.fill();
    }
    fillRounded(x, y + 6.2, 16, 2, 1, "#677181");
  }

  function drawCoin(coin) {
    const x = coin.x - cameraX;
    const y = coin.y - 12 + Math.sin(time * 5 + coin.x) * 1.5;
    const phase = Math.abs(Math.sin(time * 6 + coin.x));
    const width = Math.max(1.4, 6 * phase);
    const glow = ctx.createRadialGradient(x + 3, y + 3.5, 0, x + 3, y + 3.5, 8);
    glow.addColorStop(0, "rgba(255, 225, 105, .38)");
    glow.addColorStop(1, "rgba(255, 213, 90, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x + 3, y + 3.5, 8, 0, Math.PI * 2);
    ctx.fill();
    const gold = ctx.createLinearGradient(x, y, x + 6, y + 7);
    gold.addColorStop(0, "#fff3a2");
    gold.addColorStop(0.45, "#ffd15f");
    gold.addColorStop(1, "#d68b2f");
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 3.5, width / 2, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 250, 202, .75)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function drawPowerup(powerup) {
    const x = powerup.x - cameraX;
    const y = powerup.y - 12 + Math.sin(time * 3.5 + powerup.x * 0.03) * 2;
    const colors = {
      feather: ["#d7fffa", "#67d8da"],
      shield: ["#c9f4ff", "#4fa8db"],
      heart: ["#ffd2d8", "#ef7183"],
    }[powerup.type];
    const glow = ctx.createRadialGradient(x + 5, y + 5, 1, x + 5, y + 5, 12);
    glow.addColorStop(0, `${colors[0]}99`);
    glow.addColorStop(1, `${colors[1]}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x + 5, y + 5, 12, 0, Math.PI * 2);
    ctx.fill();
    fillRounded(x, y, 10, 10, 5, "rgba(26, 50, 66, .76)", `${colors[0]}bb`, 0.8);

    if (powerup.type === "feather") {
      ctx.fillStyle = colors[0];
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 6.5);
      ctx.quadraticCurveTo(x + 2.8, y + 1.6, x + 7.8, y + 1.7);
      ctx.quadraticCurveTo(x + 7, y + 6.3, x + 3.3, y + 8.4);
      ctx.quadraticCurveTo(x + 5.2, y + 5.6, x + 6.4, y + 3.2);
      ctx.quadraticCurveTo(x + 4.3, y + 5.1, x + 2, y + 6.5);
      ctx.fill();
      ctx.strokeStyle = colors[1];
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(x + 2.2, y + 8.2);
      ctx.lineTo(x + 7.2, y + 2.4);
      ctx.stroke();
    } else if (powerup.type === "shield") {
      ctx.fillStyle = colors[1];
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 1.7);
      ctx.lineTo(x + 8.1, y + 3);
      ctx.lineTo(x + 7.6, y + 6.8);
      ctx.quadraticCurveTo(x + 5, y + 9, x + 2.4, y + 6.8);
      ctx.lineTo(x + 1.9, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = colors[0];
      ctx.lineWidth = 0.7;
      ctx.stroke();
    } else {
      drawHeart(x + 0.5, y + 1, true);
    }
  }

  function drawCheckpoint(point) {
    const x = point.x - cameraX;
    const y = point.y - 12;
    ctx.strokeStyle = "#4b4250";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 5.5, y + 1);
    ctx.lineTo(x + 5.5, y + point.h);
    ctx.stroke();
    const flagColor = point.active ? "#63e2c3" : "#807985";
    ctx.fillStyle = flagColor;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 2);
    ctx.quadraticCurveTo(x + 13, y, x + 16, y + 4);
    ctx.quadraticCurveTo(x + 12, y + 8, x + 6, y + 7);
    ctx.closePath();
    ctx.fill();
    if (point.active) {
      ctx.shadowColor = "#6ff0d2";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "#c7fff0";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
  }

  function drawGoal(goal) {
    const x = goal.x - cameraX;
    const y = goal.y - 12;
    const pulse = 0.72 + Math.sin(time * 5) * 0.14;
    const aura = ctx.createRadialGradient(x + 6, y + 22, 2, x + 6, y + 22, 23);
    aura.addColorStop(0, `rgba(255, 241, 164, ${pulse})`);
    aura.addColorStop(1, "rgba(255, 221, 102, 0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 22, 23, 31, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4d405b";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + 47);
    ctx.lineTo(x + 1.5, y + 9);
    ctx.quadraticCurveTo(x + 6, y - 1, x + 11.5, y + 9);
    ctx.lineTo(x + 11.5, y + 47);
    ctx.stroke();
    const portal = ctx.createLinearGradient(x + 3, y + 4, x + 9, y + 38);
    portal.addColorStop(0, "rgba(255, 252, 213, .95)");
    portal.addColorStop(0.5, "rgba(255, 211, 93, .82)");
    portal.addColorStop(1, "rgba(255, 169, 82, .3)");
    ctx.strokeStyle = portal;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 37);
    ctx.lineTo(x + 5, y + 11);
    ctx.quadraticCurveTo(x + 6.5, y + 6, x + 8, y + 11);
    ctx.lineTo(x + 8, y + 37);
    ctx.stroke();
  }

  function drawEnemy(enemy) {
    const x = enemy.x - cameraX;
    const y = enemy.y - 12;
    if (x < -20 || x > W + 20) return;
    if (!enemy.alive) {
      if (enemy.squish > 0) {
        ctx.fillStyle = level.palette.enemy || "#6fa84f";
        ctx.globalAlpha = clamp(enemy.squish / 0.3, 0, 1);
        ctx.beginPath();
        ctx.ellipse(x + 6.5, y + 10, 7, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }
    const bob = enemy.grounded ? Math.sin(time * 8 + enemy.seed) : 0;
    ctx.fillStyle = "rgba(20, 30, 40, .22)";
    ctx.beginPath();
    ctx.ellipse(x + 6.5, y + 11.5, 6.8, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(x, y + bob, x, y + 12);
    body.addColorStop(0, level.palette.enemyLight || (levelIndex === 0 ? "#a8d767" : "#b9a2dc"));
    body.addColorStop(1, level.palette.enemy || (levelIndex === 0 ? "#6fa84f" : "#866fb0"));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + 10.5);
    ctx.quadraticCurveTo(x + 1.4, y + 3 + bob, x + 5.1, y + 1.3 + bob);
    ctx.quadraticCurveTo(x + 8.4, y - 0.2 + bob, x + 11.6, y + 4.2 + bob);
    ctx.quadraticCurveTo(x + 13.4, y + 7 + bob, x + 12.4, y + 10.5);
    ctx.quadraticCurveTo(x + 9.5, y + 12.4, x + 6.5, y + 10.8);
    ctx.quadraticCurveTo(x + 3.5, y + 12.4, x + 0.5, y + 10.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, .28)";
    ctx.beginPath();
    ctx.ellipse(x + 4.7, y + 3.4 + bob, 2.2, 1.1, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f9f0";
    ctx.beginPath();
    ctx.ellipse(x + 4.1, y + 6 + bob, 1.55, 1.8, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 9.1, y + 6 + bob, 1.55, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#273344";
    ctx.beginPath();
    ctx.arc(x + 4.4, y + 6.25 + bob, 0.65, 0, Math.PI * 2);
    ctx.arc(x + 8.8, y + 6.25 + bob, 0.65, 0, Math.PI * 2);
    ctx.fill();
    if (enemy.type === "flyer") {
      ctx.fillStyle = "rgba(207,245,255,.72)";
      ctx.beginPath();
      ctx.ellipse(x - 1, y + 5, 4, 2, -0.5, 0, Math.PI * 2);
      ctx.ellipse(x + 14, y + 5, 4, 2, 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.type === "hopper") {
      ctx.strokeStyle = "#fff0b5";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 2);
      ctx.lineTo(x + 1, y - 2);
      ctx.moveTo(x + 10, y + 2);
      ctx.lineTo(x + 12, y - 2);
      ctx.stroke();
    } else if (enemy.type === "charger") {
      ctx.fillStyle = "#f3d078";
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 5);
      ctx.lineTo(x - 3, y + 2);
      ctx.lineTo(x + 1, y + 8);
      ctx.moveTo(x + 12, y + 5);
      ctx.lineTo(x + 16, y + 2);
      ctx.lineTo(x + 12, y + 8);
      ctx.fill();
    }
  }

  function drawHeroFigure(x, y, scale = 1, flip = false, step = 0) {
    ctx.save();
    ctx.translate(flip ? x + 11 * scale : x, y);
    ctx.scale(flip ? -scale : scale, scale);
    ctx.fillStyle = "rgba(17, 28, 43, .22)";
    ctx.beginPath();
    ctx.ellipse(5.8, 14, 5.5, 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    fillRounded(2.1, 10.3, 3.2, 3.8, 1.4, "#263950");
    fillRounded(7.1, 10.4 + step * 0.35, 3.1, 3.6 - step * 0.25, 1.4, "#263950");
    ctx.fillStyle = "#cb5b59";
    ctx.beginPath();
    ctx.moveTo(3.3, 5.7);
    ctx.quadraticCurveTo(0.4, 7.2, -0.6, 11.8);
    ctx.quadraticCurveTo(1.6, 10.7, 4.2, 11.2);
    ctx.closePath();
    ctx.fill();
    const coat = ctx.createLinearGradient(3, 5, 10, 13);
    coat.addColorStop(0, "#527aa2");
    coat.addColorStop(1, "#304f78");
    fillRounded(2.7, 5.4, 7.6, 7.4, 2.5, coat, "rgba(22, 43, 66, .4)", 0.5);
    ctx.fillStyle = "#efc38b";
    ctx.beginPath();
    ctx.ellipse(6.6, 4.2, 4.1, 3.7, -0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6a4148";
    ctx.beginPath();
    ctx.moveTo(2.5, 4.2);
    ctx.quadraticCurveTo(2.6, -0.3, 7, 0.2);
    ctx.quadraticCurveTo(10.9, 0.5, 10.6, 4.1);
    ctx.quadraticCurveTo(8.8, 2.6, 7.6, 1.8);
    ctx.quadraticCurveTo(5.2, 3.1, 2.5, 4.2);
    ctx.fill();
    ctx.fillStyle = "#233044";
    ctx.beginPath();
    ctx.arc(8.6, 4.2, 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c24e52";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(2.5, 6.6);
    ctx.quadraticCurveTo(4.8, 7.7, 8.4, 6.8);
    ctx.stroke();
    ctx.fillStyle = "#ffd266";
    ctx.beginPath();
    ctx.arc(9.2, 7.5, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    if (player.invincible > 0 && Math.floor(player.invincible * 14) % 2 === 0) return;
    const x = player.x - cameraX;
    const y = player.y - 12;
    const step = player.grounded && Math.abs(player.vx) > 8 ? Math.floor(player.runCycle) % 2 : 0;
    if (player.hasFeather) {
      ctx.fillStyle = "rgba(205, 255, 249, .72)";
      ctx.beginPath();
      ctx.ellipse(x + 1.4, y + 8, 3.5, 1.8, -0.7, 0, Math.PI * 2);
      ctx.ellipse(x + 10.4, y + 8, 3.5, 1.8, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.shield) {
      ctx.strokeStyle = "rgba(126, 224, 244, .78)";
      ctx.lineWidth = 1.1;
      ctx.shadowColor = "#72dff0";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.ellipse(x + 5.5, y + 7, 8, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
    drawHeroFigure(x, y, 1, player.facing < 0, step);
  }

  function drawHeart(x, y, filled) {
    ctx.fillStyle = filled ? "#f06d7e" : "rgba(133, 145, 157, .42)";
    ctx.beginPath();
    ctx.moveTo(x + 4.5, y + 8.5);
    ctx.bezierCurveTo(x + 3.6, y + 7.4, x, y + 5.2, x, y + 2.5);
    ctx.bezierCurveTo(x, y - 0.2, x + 3.5, y - 0.7, x + 4.5, y + 1.5);
    ctx.bezierCurveTo(x + 5.7, y - 0.7, x + 9, y - 0.2, x + 9, y + 2.5);
    ctx.bezierCurveTo(x + 9, y + 5.2, x + 5.5, y + 7.4, x + 4.5, y + 8.5);
    ctx.fill();
    if (filled) {
      ctx.fillStyle = "rgba(255,255,255,.42)";
      ctx.beginPath();
      ctx.ellipse(x + 2.6, y + 1.8, 1.15, 0.7, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud() {
    if (!["playing", "paused", "levelclear"].includes(state)) return;
    fillRounded(5, 5, 145, 18, 7, "rgba(18, 34, 50, .72)", "rgba(223, 241, 242, .22)", 0.7);
    for (let i = 0; i < 3; i += 1) drawHeart(10 + i * 11.5, 10, i < lives);
    drawPixelText(`● ${String(levelCoins).padStart(2, "0")}/${level.coins.length}`, 49, 10, 7, "#ffd979");
    drawPixelText(`${levelIndex + 1} / ${levelBuilders.length}`, 142, 10, 7, "#e7f1f5", "right");
    if (player.hasFeather) {
      fillRounded(154, 7, 37, 14, 6, "rgba(56, 124, 137, .72)", "rgba(197, 255, 248, .42)", 0.6);
      drawPixelText(`风羽 ${Math.ceil(player.featherTimer)}`, 172.5, 10, 6, "#d8fff9", "center");
    }
    if (player.shield) {
      const shieldX = player.hasFeather ? 195 : 154;
      fillRounded(shieldX, 7, 37, 14, 6, "rgba(55, 105, 151, .76)", "rgba(183, 235, 255, .46)", 0.6);
      drawPixelText(`星盾 ${Math.ceil(player.shieldTimer)}`, shieldX + 18.5, 10, 6, "#d8f4ff", "center");
    }
    fillRounded(270, 7, 45, 14, 6, "rgba(40, 48, 69, .78)", "rgba(255, 224, 151, .35)", 0.6);
    ctx.fillStyle = player.dashCooldown <= 0 ? "#f7d873" : "#6f7f91";
    ctx.fillRect(275, 17, 35 * (1 - player.dashCooldown / 0.58), 1.5);
    drawPixelText(player.dashCooldown <= 0 ? "冲刺 READY" : "冲刺", 292.5, 9, 5, "#fff0bd", "center");
    drawPixelText(`SCORE ${score}`, 315, 25, 5, "#dce8ee", "right");
    if (combo > 1 && comboTimer > 0) drawPixelText(`COMBO ×${combo}`, W / 2, 27, 7, "#ffda74", "center");
  }

  function drawOverlay() {
    if (bannerTimer > 0 && state === "playing") {
      const alpha = Math.min(1, bannerTimer, 2.2 - bannerTimer);
      ctx.globalAlpha = clamp(alpha * 2, 0, 1);
      fillRounded(71, 63, 178, 40, 10, "rgba(18, 34, 50, .82)", "rgba(228, 244, 241, .28)", 0.8);
      drawPixelText(`STAGE ${levelIndex + 1}`, W / 2, 70, 8, "#f1c75b", "center");
      drawPixelText(level.name, W / 2, 82, 12, "#fff4da", "center");
      drawPixelText(`${level.subtitle} · ${level.mechanic}`, W / 2, 96, 5, "#9fb3c7", "center");
      ctx.globalAlpha = 1;
    }

    if (state === "paused") {
      shade();
      panel(82, 60, 156, 57);
      drawPixelText("PAUSED", W / 2, 70, 16, "#ffe38a", "center");
      drawPixelText("按 P 继续", W / 2, 98, 7, "#d3deea", "center");
    }

    if (state === "levelclear") {
      shade(0.35);
      panel(67, 57, 186, 66);
      drawPixelText("STAGE CLEAR!", W / 2, 66, 14, "#ffe071", "center");
      drawPixelText(`${level.name} 已通过`, W / 2, 90, 8, "#f5e7c4", "center");
      drawPixelText(`评价 ${clearRank}  ·  收集 ${levelCoins}/${level.coins.length}`, W / 2, 105, 7, clearRank === "S" ? "#ffe77f" : "#a9edcf", "center");
      drawPixelText(levelIndex < levelBuilders.length - 1 ? "下一关进度已保存" : "十关冒险记录完成", W / 2, 116, 5, "#b7c8d8", "center");
    }
  }

  function shade(alpha = 0.65) {
    ctx.fillStyle = `rgba(7, 10, 18, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function panel(x, y, w, h) {
    const glass = ctx.createLinearGradient(x, y, x, y + h);
    glass.addColorStop(0, "rgba(33, 52, 72, .94)");
    glass.addColorStop(1, "rgba(16, 27, 44, .96)");
    fillRounded(x, y, w, h, 12, glass, "rgba(216, 238, 240, .34)", 1);
    ctx.strokeStyle = "rgba(255, 255, 255, .08)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 5);
    ctx.lineTo(x + w - 12, y + 5);
    ctx.stroke();
  }

  function drawTitle() {
    drawBackground();
    const haze = ctx.createLinearGradient(0, 103, 0, H);
    haze.addColorStop(0, "rgba(22, 43, 59, 0)");
    haze.addColorStop(0.45, "rgba(20, 42, 51, .42)");
    haze.addColorStop(1, "rgba(13, 28, 35, .75)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 98, W, 82);
    ctx.fillStyle = "#496e55";
    ctx.beginPath();
    ctx.moveTo(0, 154);
    ctx.quadraticCurveTo(58, 146, 121, 153);
    ctx.quadraticCurveTo(202, 161, 320, 151);
    ctx.lineTo(320, 180);
    ctx.lineTo(0, 180);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#91b86b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 153);
    ctx.quadraticCurveTo(58, 145, 121, 152);
    ctx.quadraticCurveTo(202, 160, 320, 150);
    ctx.stroke();

    drawHeroFigure(38, 119, 2.15, false, 0);

    drawPixelText("苔原小勇者", W / 2, 27, 24, "#fff0bf", "center");
    drawPixelText("Mossbound Journey", W / 2, 58, 10, "#f58d91", "center");
    drawPixelText("跨越十境，点亮星门", W / 2, 78, 8, "#e6f0e8", "center");
    const pulse = Math.floor(time * 2) % 2 ? "#fff0ba" : "#f1be54";
    fillRounded(99, 99, 122, 21, 10, "rgba(22, 42, 58, .58)", "rgba(255, 229, 155, .3)", 0.7);
    const startLabel = progress.completed
      ? "再次冒险"
      : progress.current > 0
        ? `继续第 ${progress.current + 1} 关`
        : "按 ENTER / 点击开始";
    drawPixelText(startLabel, W / 2, 105, 8, pulse, "center");
    const touchMode = window.matchMedia("(max-width: 700px), (pointer: coarse) and (max-width: 760px)").matches;
    fillRounded(69, 127, 182, 31, 10, "rgba(20, 39, 54, .48)", "rgba(220, 240, 237, .18)", 0.6);
    drawPixelText(touchMode ? "左右移动 · 跳跃 · 冲刺" : "A / D 移动 · 空格跳跃 · SHIFT 冲刺", W / 2, 133, 7, "#eef5f2", "center");
    drawPixelText("踩怪、冲刺击破敌人 · 每三关挑战首领 · L 选关", W / 2, 147, 6, "#c6d8dc", "center");
  }

  function drawLevelSelect() {
    drawBackground();
    shade(0.4);
    panel(12, 10, 296, 160);
    drawPixelText(progress.completed ? "十境巡游" : "关卡选择", W / 2, 20, 16, "#ffe184", "center");
    drawPixelText(`已解锁 ${progress.unlocked + 1} / 10`, W / 2, 42, 7, "#a9edcf", "center");

    for (let index = 0; index < levelBuilders.length; index += 1) {
      const rect = levelButtonRect(index);
      const unlocked = index <= progress.unlocked;
      const selected = index === selectedLevel;
      const fill = !unlocked
        ? "rgba(45, 52, 67, .72)"
        : selected
          ? "rgba(190, 131, 64, .9)"
          : "rgba(48, 82, 99, .82)";
      const stroke = selected ? "rgba(255, 233, 157, .9)" : "rgba(208, 232, 235, .25)";
      fillRounded(rect.x, rect.y, rect.w, rect.h, 7, fill, stroke, selected ? 1.2 : 0.7);
      drawPixelText(unlocked ? `STAGE ${index + 1}` : "LOCKED", rect.x + rect.w / 2, rect.y + 6, 5, unlocked ? "#dcebf0" : "#7f8998", "center");
      drawPixelText(unlocked ? String(index + 1).padStart(2, "0") : "—", rect.x + rect.w / 2, rect.y + 14, 10, unlocked ? "#fff0bd" : "#626b78", "center");
    }

    drawPixelText(levelNames[selectedLevel], W / 2, 142, 8, "#fff2cf", "center");
    drawPixelText("方向键选择 · ENTER 开始 · 手机直接点击", W / 2, 157, 5, "#aebfcd", "center");
  }

  function drawEndScreen(victory) {
    drawBackground();
    shade(0.42);
    panel(48, 35, 224, 112);
    if (victory) {
      drawPixelText("冒 险 完 成", W / 2, 49, 18, "#ffe184", "center");
      drawPixelText("TINY HERO, BIG JOURNEY", W / 2, 74, 7, "#9fe4cf", "center");
      drawPixelText(`总星币  ◆ ${totalCoins}`, W / 2, 93, 10, "#ffd45a", "center");
      drawPixelText("十座星门重新发出了光", W / 2, 113, 7, "#dce5ef", "center");
    } else {
      drawPixelText("GAME OVER", W / 2, 51, 20, "#ef7180", "center");
      drawPixelText(`第 ${levelIndex + 1} 关重新整备`, W / 2, 84, 8, "#dce5ef", "center");
      drawPixelText(`已收集  ◆ ${totalCoins}`, W / 2, 101, 8, "#ffd45a", "center");
    }
    const pulse = Math.floor(time * 2) % 2 ? "#fff0ba" : "#f1be54";
    drawPixelText(victory ? "按 ENTER 进入选关" : "按 ENTER 重试本关", W / 2, 132, 7, pulse, "center");
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 5), Math.round((Math.random() - 0.5) * 4));
    if (state === "title") {
      drawTitle();
    } else if (state === "levelselect") {
      drawLevelSelect();
    } else if (state === "gameover") {
      drawEndScreen(false);
    } else if (state === "victory") {
      drawEndScreen(true);
    } else {
      drawBackground();
      drawWorld();
      drawHud();
      drawOverlay();
    }
    ctx.restore();
  }

  function announce(message) {
    statusEl.textContent = message;
  }

  function normalizeKey(event) {
    return event.code === "Space" ? "Space" : event.code;
  }

  window.addEventListener("keydown", (event) => {
    const key = normalizeKey(event);
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "ShiftLeft", "ShiftRight"].includes(key)) event.preventDefault();
    if (!keys.has(key)) pressed.add(key);
    keys.add(key);
    sound.wake();
  });

  window.addEventListener("keyup", (event) => keys.delete(normalizeKey(event)));
  window.addEventListener("blur", () => keys.clear());

  function canvasCoordinates(event) {
    return {
      x: event.offsetX * (W / canvas.clientWidth),
      y: event.offsetY * (H / canvas.clientHeight),
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.focus();
    sound.wake();
    if (state === "levelselect") {
      const point = canvasCoordinates(event);
      for (let index = 0; index <= progress.unlocked; index += 1) {
        const rect = levelButtonRect(index);
        if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
          startSelectedLevel(index);
          break;
        }
      }
    } else if (state === "title") startGame(false);
    else if (state === "gameover") retryCurrentStage();
    else if (state === "victory") openLevelSelect(9);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  gameShell.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
  gameShell.addEventListener("gesturestart", (event) => event.preventDefault());
  gameShell.addEventListener("contextmenu", (event) => event.preventDefault());
  touchControls.addEventListener("pointerdown", (event) => event.preventDefault());

  document.querySelectorAll(".touch-key").forEach((button) => {
    const key = button.dataset.key;
    const down = (event) => {
      event.preventDefault();
      if (!keys.has(key)) pressed.add(key);
      keys.add(key);
      button.classList.add("is-down");
      sound.wake();
    };
    const up = (event) => {
      event.preventDefault();
      keys.delete(key);
      button.classList.remove("is-down");
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  });

  muteButton.addEventListener("click", () => {
    sound.muted = !sound.muted;
    muteButton.textContent = `音乐：${sound.muted ? "关" : "开"}`;
    if (!sound.muted) {
      sound.wake();
      sound.play("coin");
    }
  });

  function activeFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  async function lockLandscape() {
    try {
      if (window.screen?.orientation?.lock) await window.screen.orientation.lock("landscape");
    } catch {
      if (!viewportIsLandscape()) announce("请手动将手机旋转为横屏");
    }
  }

  async function enterGameFullscreen() {
    const target = gameShell;
    try {
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: "hide" });
      else if (target.webkitRequestFullscreen) await Promise.resolve(target.webkitRequestFullscreen());
      else {
        announce("当前浏览器无法自动全屏，请手动旋转手机");
        return;
      }
      await lockLandscape();
    } catch {
      announce("无法进入全屏，请允许全屏权限后重试");
    }
  }

  async function exitGameFullscreen() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await Promise.resolve(document.webkitExitFullscreen());
      if (window.screen?.orientation?.unlock) window.screen.orientation.unlock();
    } catch {
      announce("请使用浏览器的返回手势退出全屏");
    }
  }

  async function toggleGameFullscreen() {
    if (activeFullscreenElement()) await exitGameFullscreen();
    else await enterGameFullscreen();
  }

  function syncFullscreenButton() {
    fullscreenButton.textContent = activeFullscreenElement() ? "退出全屏" : "全屏";
    if (!activeFullscreenElement() && window.screen?.orientation?.unlock) {
      try { window.screen.orientation.unlock(); } catch { /* Unsupported on this browser. */ }
    }
  }

  fullscreenButton.addEventListener("click", toggleGameFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);

  let previous = performance.now();
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
