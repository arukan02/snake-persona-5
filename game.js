/* ============================================================
   PHANTOM SNAKE — game logic
   Vanilla JS, canvas 2D, no dependencies, no external assets.
   All art is drawn procedurally; all sound is synthesised.
   ============================================================ */
(() => {
  'use strict';

  // ---------------------------------------------------------- config
  const GRID        = 24;     // cells per side
  const START_LEN   = 4;
  const TICK_SLOW   = 135;    // ms per step at score 0
  const TICK_FAST   = 62;     // floor
  const SPEED_RAMP  = 420;    // score needed to reach the floor
  const CHAIN_WINDOW = 2600;  // ms to keep a chain alive
  const CHAIN_MAX   = 8;

  const CUTINS = [
    'ALL-OUT!', 'TAKE IT!', 'NICE!', 'SHOWTIME!', 'STOLEN!',
    'BATON PASS!', 'CRITICAL!', 'ONE MORE!',
  ];

  const DIRS = {
    up:    { x:  0, y: -1 },
    down:  { x:  0, y:  1 },
    left:  { x: -1, y:  0 },
    right: { x:  1, y:  0 },
  };

  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  // ---------------------------------------------------------- dom
  const canvas  = document.getElementById('game');
  const ctx     = canvas.getContext('2d');
  const frame   = document.getElementById('frame');
  const elScore = document.getElementById('score');
  const elBest  = document.getElementById('best');
  const elChain = document.getElementById('chain');
  const overlay = document.getElementById('overlay');
  const oTitle  = document.getElementById('overlayTitle');
  const oBody   = document.getElementById('overlayBody');
  const startBtn = document.getElementById('startBtn');
  const cutin    = document.getElementById('cutin');
  const cutinText = document.getElementById('cutinText');

  const CELL = canvas.width / GRID;

  // ---------------------------------------------------------- state
  const state = {
    phase: 'title',        // title | playing | paused | over
    snake: [],             // [{x,y}] head first
    dir: 'right',
    queued: [],            // buffered direction inputs
    food: { x: 0, y: 0 },
    score: 0,
    best: 0,
    chain: 1,
    lastEatAt: 0,
    lastStepAt: 0,
    particles: [],
    foodPulse: 0,
  };

  // ---------------------------------------------------------- audio
  let actx = null;

  function audio() {
    if (actx === null) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { actx = new AC(); }
    }
    return actx;
  }

  function blip(freq, dur, type = 'square', gain = 0.06) {
    const ac = audio();
    if (!ac) { return; }
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  const sfx = {
    eat:  (chain) => blip(420 + chain * 70, 0.12, 'square'),
    turn: ()      => blip(180, 0.04, 'triangle', 0.025),
    dead: ()      => { blip(150, 0.4, 'sawtooth', 0.09); blip(74, 0.7, 'square', 0.07); },
    start: ()     => { blip(330, 0.09); setTimeout(() => blip(495, 0.14), 90); },
  };

  // ---------------------------------------------------------- helpers
  const randCell = () => Math.floor(Math.random() * GRID);

  function occupied(x, y) {
    return state.snake.some((s) => s.x === x && s.y === y);
  }

  function placeFood() {
    if (state.snake.length >= GRID * GRID) { return; }
    let x, y, guard = 0;
    do {
      x = randCell();
      y = randCell();
      guard += 1;
    } while (occupied(x, y) && guard < 4000);
    state.food = { x, y };
    state.foodPulse = 0;
  }

  function tickInterval() {
    const t = Math.min(1, state.score / SPEED_RAMP);
    return TICK_SLOW - (TICK_SLOW - TICK_FAST) * t;
  }

  function loadBest() {
    try {
      state.best = parseInt(localStorage.getItem('phantom-snake-best') || '0', 10) || 0;
    } catch (e) {
      state.best = 0;
    }
  }

  function saveBest() {
    try { localStorage.setItem('phantom-snake-best', String(state.best)); }
    catch (e) { /* private mode — score simply won't persist */ }
  }

  function popValue(el) {
    el.classList.remove('pop');
    void el.offsetWidth;          // force reflow so the animation restarts
    el.classList.add('pop');
  }

  function paintHud() {
    elScore.textContent = String(state.score);
    elBest.textContent  = String(state.best);
    elChain.textContent = 'x' + state.chain;
  }

  // ---------------------------------------------------------- lifecycle
  function reset() {
    const mid = Math.floor(GRID / 2);
    state.snake = [];
    for (let i = 0; i < START_LEN; i += 1) {
      state.snake.push({ x: mid - i, y: mid });
    }
    state.dir = 'right';
    state.queued = [];
    state.score = 0;
    state.chain = 1;
    state.lastEatAt = 0;
    state.particles = [];
    placeFood();
    paintHud();
  }

  function start() {
    reset();
    state.phase = 'playing';
    state.lastStepAt = performance.now();
    overlay.classList.add('hidden');
    sfx.start();
  }

  function showOverlay(title, bodyHtml, btnLabel) {
    oTitle.textContent = title;
    oBody.innerHTML = bodyHtml;
    startBtn.textContent = btnLabel;
    overlay.classList.remove('hidden');
  }

  function gameOver() {
    state.phase = 'over';
    sfx.dead();
    frame.classList.remove('shake');
    void frame.offsetWidth;
    frame.classList.add('shake');

    const beat = state.score > state.best;
    if (beat) { state.best = state.score; saveBest(); }
    paintHud();

    showOverlay(
      beat ? 'NEW RECORD' : 'HEIST FAILED',
      beat
        ? `You stole <b>${state.score}</b> — a new personal best.`
        : `Final take: <b>${state.score}</b>. Best still stands at <b>${state.best}</b>.`,
      'RUN IT AGAIN',
    );
  }

  function togglePause() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      showOverlay('LAYING LOW', 'The heist is on hold. Nobody saw you.', 'RESUME');
    } else if (state.phase === 'paused') {
      state.phase = 'playing';
      state.lastStepAt = performance.now();
      overlay.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------- effects
  function burst(cx, cy, n, hue) {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.4 + Math.random() * 3.6;
      state.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: 2 + Math.random() * 4,
        hue,
      });
    }
  }

  function flashCutin(chain) {
    cutinText.textContent = chain > 1
      ? CUTINS[Math.min(CUTINS.length - 1, chain)] + ' x' + chain
      : CUTINS[0];
    cutin.classList.remove('go');
    void cutin.offsetWidth;
    cutin.classList.add('go');
  }

  // ---------------------------------------------------------- step
  function step(now) {
    // apply one buffered turn per step so fast taps can't reverse the snake
    while (state.queued.length) {
      const next = state.queued.shift();
      if (next !== state.dir && next !== OPPOSITE[state.dir]) {
        state.dir = next;
        sfx.turn();
        break;
      }
    }

    const d = DIRS[state.dir];
    const head = { x: state.snake[0].x + d.x, y: state.snake[0].y + d.y };

    // walls
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      burst(state.snake[0].x + 0.5, state.snake[0].y + 0.5, 26, 'red');
      gameOver();
      return;
    }

    // self (the tail cell is about to move away, so it is not a collision)
    const ignoreTail = state.snake.length - 1;
    for (let i = 0; i < state.snake.length; i += 1) {
      if (i === ignoreTail) { continue; }
      if (state.snake[i].x === head.x && state.snake[i].y === head.y) {
        burst(head.x + 0.5, head.y + 0.5, 26, 'red');
        gameOver();
        return;
      }
    }

    state.snake.unshift(head);

    if (head.x === state.food.x && head.y === state.food.y) {
      state.chain = (now - state.lastEatAt < CHAIN_WINDOW && state.lastEatAt > 0)
        ? Math.min(CHAIN_MAX, state.chain + 1)
        : 1;
      state.lastEatAt = now;
      state.score += 10 * state.chain;

      burst(head.x + 0.5, head.y + 0.5, 18, 'white');
      flashCutin(state.chain);
      sfx.eat(state.chain);
      popValue(elScore);
      if (state.chain > 1) { popValue(elChain); }
      paintHud();
      placeFood();
    } else {
      state.snake.pop();
    }

    // chain decays if you dawdle
    if (state.chain > 1 && now - state.lastEatAt > CHAIN_WINDOW) {
      state.chain = 1;
      paintHud();
    }
  }

  // ---------------------------------------------------------- draw
  function drawField() {
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // halftone dots
    ctx.fillStyle = 'rgba(225, 5, 20, 0.14)';
    const gap = CELL / 2;
    for (let y = gap / 2; y < canvas.height; y += gap) {
      for (let x = gap / 2; x < canvas.width; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // faint cell grid
    ctx.strokeStyle = 'rgba(244, 241, 234, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(canvas.width, i * CELL);
      ctx.stroke();
    }

    // corner slashes
    ctx.fillStyle = 'rgba(225, 5, 20, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(CELL * 3, 0); ctx.lineTo(0, CELL * 3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(canvas.width, canvas.height);
    ctx.lineTo(canvas.width - CELL * 3, canvas.height);
    ctx.lineTo(canvas.width, canvas.height - CELL * 3);
    ctx.closePath(); ctx.fill();
  }

  function drawFood(t) {
    state.foodPulse += 0.06;
    const pulse = 1 + Math.sin(state.foodPulse) * 0.1;
    const cx = state.food.x * CELL + CELL / 2;
    const cy = state.food.y * CELL + CELL / 2;
    const s  = CELL * 0.82 * pulse;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.22 + Math.sin(t / 700) * 0.06);

    // calling card
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = '#e10514';
    ctx.fillRect(-s / 2, -s / 2, s, s * 0.26);

    // mark
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.06);
    ctx.lineTo(s * 0.26, s * 0.3);
    ctx.lineTo(-s * 0.26, s * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawSnake() {
    for (let i = state.snake.length - 1; i >= 0; i -= 1) {
      const seg = state.snake[i];
      const cx = seg.x * CELL + CELL / 2;
      const cy = seg.y * CELL + CELL / 2;
      const head = i === 0;
      const taper = 1 - (i / Math.max(1, state.snake.length)) * 0.32;
      const s = CELL * (head ? 0.96 : 0.82) * taper;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);          // diamonds

      if (head) {
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.fillStyle = '#e10514';
        ctx.fillRect(-s / 2, -s / 2, s, s / 2);
      } else {
        ctx.fillStyle = i % 2 === 0 ? '#e10514' : '#8c0009';
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeStyle = 'rgba(10,10,10,0.9)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();

      // mask eyes on the head, oriented with travel
      if (head) {
        const d = DIRS[state.dir];
        ctx.fillStyle = '#0a0a0a';
        const off = CELL * 0.17;
        const px = cx + d.x * CELL * 0.12;
        const py = cy + d.y * CELL * 0.12;
        const ex = d.x !== 0 ? 0 : off;
        const ey = d.x !== 0 ? off : 0;
        ctx.beginPath();
        ctx.arc(px - ex, py - ey, CELL * 0.085, 0, Math.PI * 2);
        ctx.arc(px + ex, py + ey, CELL * 0.085, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.x += p.vx * 0.16;
      p.y += p.vy * 0.16;
      p.vy += 0.06;
      p.life -= 0.028;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.hue === 'white' ? '#f4f1ea' : '#e10514';
      ctx.translate(p.x * CELL, p.y * CELL);
      ctx.rotate(p.life * 5);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  function draw(t) {
    drawField();
    drawFood(t);
    drawSnake();
    drawParticles();
  }

  // ---------------------------------------------------------- loop
  function loop(now) {
    if (state.phase === 'playing' && now - state.lastStepAt >= tickInterval()) {
      state.lastStepAt = now;
      step(now);
    }
    draw(now);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------- input
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right',
  };

  function pushDir(dir) {
    if (state.phase !== 'playing') { return; }
    if (state.queued.length < 3) { state.queued.push(dir); }
  }

  window.addEventListener('keydown', (e) => {
    const dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      pushDir(dir);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (state.phase === 'title' || state.phase === 'over') { start(); }
      else { togglePause(); }
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      start();
    }
  }, { passive: false });

  startBtn.addEventListener('click', () => {
    if (state.phase === 'paused') { togglePause(); } else { start(); }
  });

  // touch: swipe
  let tStart = null;
  frame.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    tStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  frame.addEventListener('touchend', (e) => {
    if (!tStart) { return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - tStart.x;
    const dy = t.clientY - tStart.y;
    tStart = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { return; }
    pushDir(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up'));
  }, { passive: true });

  // ---------------------------------------------------------- boot
  loadBest();
  reset();
  showOverlay(
    'SHOWTIME',
    'Steal every calling card. Chain them fast for a <b>x8</b> multiplier. '
    + 'Walls and your own tail end the heist.',
    'START THE HEIST',
  );
  requestAnimationFrame(loop);

  // test/debug handle — lets an automated harness drive the game
  window.PhantomSnake = { state, start, step, pushDir, togglePause, DIRS, GRID };
})();
