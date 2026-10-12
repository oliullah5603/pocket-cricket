/* The playing field and animation layer for Pocket Cricket. */
(function () {
  'use strict';

  const W = 720;
  const H = 380;
  const CENTER = { x: 360, y: 192 };
  const CONTACT = { x: 360, y: 268 };
  const BOUNDARY = { rx: 310, ry: 143 };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const FIELDERS = [
    { x: 182, y: 117 }, { x: 494, y: 108 }, { x: 591, y: 199 },
    { x: 530, y: 284 }, { x: 184, y: 280 }, { x: 110, y: 201 },
    { x: 271, y: 187 }, { x: 453, y: 205 }, { x: 360, y: 304 },
  ];

  class CricketPitch {
    constructor(canvas, callbacks = {}) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new TypeError('CricketPitch needs a canvas element.');
      }
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) throw new Error('This browser does not support canvas.');
      this.onSwing = callbacks.onSwing || (() => {});
      this.onFinish = callbacks.onFinish || (() => {});
      this.onProgress = callbacks.onProgress || (() => {});
      this._aim = 0;
      this._delivery = null;
      this._sceneDelivery = null;
      this._shot = null;
      this._result = null;
      this._bowled = false;
      this._caught = false;
      this._missed = false;
      this._elapsed = 0;
      this._start = 0;
      this._duration = 1400;
      this._interactive = true;
      this._frameId = null;
      this._destroyed = false;
      this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.aspectRatio = `${W} / ${H}`;
      this._observer = typeof ResizeObserver === 'function' ? new ResizeObserver(this._resize) : null;
      this._observer?.observe(canvas);
      window.addEventListener('resize', this._resize);
      this._resize();
    }

    get active() { return this._delivery !== null; }

    startDelivery(delivery = {}, options = {}) {
      if (this._destroyed) return;
      this._delivery = { ...delivery, type: ['pace', 'spin', 'yorker'].includes(delivery.type) ? delivery.type : 'pace' };
      this._sceneDelivery = this._delivery;
      const engineDuration = window.CricketEngine?.deliveryDuration?.(this._delivery.type);
      this._duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : ({ pace: 1400, spin: 1800, yorker: 1150 }[this._delivery.type]);
      this._interactive = options.interactive !== false;
      this._shot = null;
      this._result = null;
      this._bowled = false;
      this._caught = false;
      this._missed = false;
      this._elapsed = 0;
      this._start = performance.now();
      this._finishAt = Infinity;
      this._hitAt = this._duration + 50;
      this._target = null;
      this._nearestFielder = -1;
      this.onProgress(0);
      this._requestFrame();
    }

    setAim(aim) {
      this._aim = clamp(Number(aim) || 0, -1, 1);
      if (!this.active) this._draw();
    }

    swing() {
      if (!this.active || !this._interactive || this._shot) return null;
      const shot = { timing: performance.now() - this._start - this._duration, aim: this._aim };
      this._setShot(shot);
      this.onSwing({ ...shot });
      return shot;
    }

    // CPU and remote shots are scheduled against this delivery's local clock.
    showShot(shot = {}) {
      if (!this.active || this._shot) return null;
      return this._setShot(shot);
    }

    reset() {
      if (this._frameId !== null) cancelAnimationFrame(this._frameId);
      this._frameId = null;
      this._delivery = null;
      this._sceneDelivery = null;
      this._shot = null;
      this._result = null;
      this._bowled = false;
      this._caught = false;
      this._missed = false;
      this._elapsed = 0;
      this._target = null;
      this.onProgress(0);
      this._draw();
    }

    destroy() {
      this.reset();
      this._destroyed = true;
      this._observer?.disconnect();
      window.removeEventListener('resize', this._resize);
    }

    _resize() {
      const width = Math.max(1, this.canvas.clientWidth || W);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(width * H / W * dpr);
      this._scale = this.canvas.width / W;
      this._draw();
    }

    _requestFrame() {
      if (!this._destroyed && this._frameId === null) this._frameId = requestAnimationFrame(this._tick);
    }

    _setShot(input) {
      this._shot = {
        timing: typeof input.timing === 'number' && Number.isFinite(input.timing) ? input.timing : null,
        aim: clamp(Number(input.aim) || 0, -1, 1),
      };
      this._aim = this._shot.aim;
      this._swingAt = this._shot.timing === null ? Infinity : this._duration + clamp(this._shot.timing, -this._duration, 400);
      try {
        this._result = window.CricketEngine.resolveDelivery({ ...this._delivery, ...this._shot });
      } catch (error) {
        // Keep the field usable if it is previewed without the scoring script.
        const errorMs = this._shot.timing === null ? Infinity : Math.abs(this._shot.timing);
        this._result = errorMs > 180 ? { runs: 0, wicket: true, quality: 0, label: 'Bowled' } : { runs: errorMs < 50 ? 6 : errorMs < 100 ? 4 : 1, wicket: false, quality: 1 - errorMs / 200, label: 'Shot' };
      }
      this._result = this._result || { runs: 0, wicket: false, quality: 0, label: 'Dot ball' };
      this._caught = Boolean(this._result.wicket && /caught/i.test(this._result.label || ''));
      this._bowled = Boolean(this._result.wicket && !this._caught);
      this._missed = this._shot.timing === null || this._result.quality === 0;
      this._hitAt = Math.max(this._duration + 50, this._swingAt === Infinity ? 0 : this._swingAt + 35);
      this._flightDuration = this._bowled ? 590 : this._result.runs >= 4 ? 730 : 660;
      this._finishAt = this._hitAt + this._flightDuration + 80;
      this._target = this._shotTarget(this._shot.aim, this._result);
      let best = Infinity;
      FIELDERS.forEach((fielder, index) => {
        const distance = Math.hypot(fielder.x - this._target.x, fielder.y - this._target.y);
        if (distance < best) { best = distance; this._nearestFielder = index; }
      });
      this._requestFrame();
      return this._result;
    }

    _tick(now) {
      this._frameId = null;
      if (!this.active || this._destroyed) return;
      this._elapsed = now - this._start;
      this.onProgress(clamp(this._elapsed / this._duration, 0, 1));
      if (!this._shot && this._interactive && this._elapsed >= this._duration + 220) {
        const shot = { timing: null, aim: this._aim };
        this._setShot(shot);
        this.onSwing({ ...shot });
      }
      // A disconnected opponent must not leave an animation running forever.
      if (!this._shot && !this._interactive && this._elapsed > 10000) {
        this.reset();
        return;
      }
      this._draw();
      if (this._shot && this._elapsed >= this._finishAt) {
        const result = this._result;
        this._delivery = null;
        this.onFinish(result);
      }
      if (this.active) this._requestFrame();
    }

    _shotTarget(aim, result) {
      if (result.wicket && !/caught/i.test(result.label || '')) return { x: 362, y: 287 };
      if (result.quality === 0) return { x: 360, y: 303 };
      const angle = -Math.PI / 2 + aim * Math.PI * 0.78;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // Intersect the shot ray with the elliptical boundary.
      const ox = CONTACT.x - CENTER.x;
      const oy = CONTACT.y - CENTER.y;
      const a = dx * dx / (BOUNDARY.rx ** 2) + dy * dy / (BOUNDARY.ry ** 2);
      const b = 2 * (ox * dx / (BOUNDARY.rx ** 2) + oy * dy / (BOUNDARY.ry ** 2));
      const c = ox * ox / (BOUNDARY.rx ** 2) + oy * oy / (BOUNDARY.ry ** 2) - 1;
      const distance = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
      const factor = result.wicket ? .57 : result.runs >= 6 ? 1.025 : result.runs === 4 ? 0.995 : result.runs === 3 ? 0.77 : result.runs === 2 ? 0.60 : result.runs === 1 ? 0.39 : 0.17;
      return { x: CONTACT.x + dx * distance * factor, y: CONTACT.y + dy * distance * factor };
    }

    _incomingPosition(elapsed) {
      const p = clamp((elapsed - 190) / (this._duration - 190), 0, 1);
      const type = this._sceneDelivery?.type || 'pace';
      const side = ((this._sceneDelivery?.seed || 1) & 1) ? 1 : -1;
      const curve = type === 'spin' ? Math.sin(p * Math.PI) * 19 * side : Math.sin(p * Math.PI) * 3 * side;
      const bounce = type === 'yorker' ? 0.91 : 0.68;
      const height = p < bounce ? Math.sin(p / bounce * Math.PI) * 15 : Math.sin((p - bounce) / (1 - bounce) * Math.PI) * (type === 'yorker' ? 3 : 8);
      return { x: 360 + curve, y: lerp(134, CONTACT.y, p), height, p };
    }

    _hitPosition(progress) {
      const p = clamp(progress, 0, 1);
      if (this._bowled || this._missed) return { x: lerp(CONTACT.x, this._target.x, p), y: lerp(CONTACT.y, this._target.y, p), height: Math.sin(p * Math.PI) * 4 };
      const curve = this._shot.aim * Math.sin(p * Math.PI) * (this._result.runs >= 4 ? 13 : 5);
      const height = Math.sin(p * Math.PI) * (this._caught ? 36 : this._result.runs >= 6 ? 65 : this._result.runs >= 4 ? 20 : 8);
      return { x: lerp(CONTACT.x, this._target.x, ease(p)) + curve, y: lerp(CONTACT.y, this._target.y, ease(p)), height };
    }

    _ellipse(x, y, rx, ry, color, stroke, width = 1) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      if (color) { ctx.fillStyle = color; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
    }

    _line(x1, y1, x2, y2, color, width = 1) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    _draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.setTransform(this._scale || 1, 0, 0, this._scale || 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this._drawStadium();
      this._drawGrass();
      this._drawAim();
      this._drawPitch();
      this._drawFielders();
      this._drawPlayers();
      if (this._sceneDelivery) this._drawBall();
      this._drawOverlay();
    }

    _drawStadium() {
      const ctx = this.ctx;
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#102e2d');
      bg.addColorStop(1, '#061f21');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      this._ellipse(360, 193, 341, 166, '#193c39', '#32544c', 1);
      // Curved terraces, with the alternating seat colors of a small stadium.
      for (let row = 0; row < 5; row++) {
        const rx = 321 + row * 4;
        const ry = 151 + row * 3;
        for (let i = 0; i < 90; i++) {
          const angle = Math.PI * 2 * i / 90;
          const x = CENTER.x + Math.cos(angle) * rx;
          const y = CENTER.y + Math.sin(angle) * ry;
          const color = i % 13 < 3 ? '#f6a455' : i % 5 === 0 ? '#c5cf9b' : row % 2 ? '#44645c' : '#62816a';
          this._ellipse(x, y, 1.8, 1.1, color);
        }
      }
      // Four compact floodlight towers at the edges of the ground.
      [[51, 53], [669, 53], [44, 316], [676, 316]].forEach(([x, y]) => {
        this._line(x, y + 2, x, y + 28, '#395451', 3);
        ctx.fillStyle = '#234843';
        ctx.fillRect(x - 11, y - 6, 22, 9);
        for (let i = 0; i < 4; i++) this._ellipse(x - 7.5 + i * 5, y - 2, 1.6, 1.4, '#f5e6bc');
      });
    }

    _drawGrass() {
      const ctx = this.ctx;
      this._ellipse(360, 192, 317, 149, '#d8dcc0');
      this._ellipse(360, 192, 313, 145, '#184c37');
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(360, 192, 310, 142, 0, 0, Math.PI * 2);
      ctx.clip();
      const grass = ctx.createLinearGradient(0, 49, 0, 336);
      grass.addColorStop(0, '#316c3e');
      grass.addColorStop(1, '#194c32');
      ctx.fillStyle = grass;
      ctx.fillRect(40, 45, 640, 295);
      ctx.fillStyle = 'rgba(174, 218, 113, .07)';
      for (let x = -260; x < W + 250; x += 56) {
        ctx.beginPath();
        ctx.moveTo(x, 40); ctx.lineTo(x + 27, 40); ctx.lineTo(x + 227, 345); ctx.lineTo(x + 200, 345);
        ctx.closePath(); ctx.fill();
      }
      // Grass texture remains stable between animation frames.
      ctx.fillStyle = 'rgba(198, 218, 123, .10)';
      for (let i = 0; i < 290; i++) {
        const x = 43 + ((i * 137 + 19) % 638);
        const y = 48 + ((i * 97 + 53) % 289);
        ctx.fillRect(x, y, .8, 1.7);
      }
      ctx.setLineDash([4, 8]);
      this._ellipse(360, 202, 197, 88, null, 'rgba(237, 243, 204, .28)', 1.1);
      ctx.setLineDash([]);
      ctx.restore();
      this._ellipse(360, 192, 309, 141, null, 'rgba(247, 241, 197, .85)', 1.4);
      // Small rope markers along the boundary.
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16;
        this._ellipse(360 + Math.cos(a) * 310, 192 + Math.sin(a) * 143, 1.5, .85, '#dfedb3');
      }
    }

    _drawAim() {
      if (this._shot && this._elapsed >= this._hitAt) return;
      const ctx = this.ctx;
      const target = this._shotTarget(this._aim, { runs: 4, wicket: false });
      const angle = Math.atan2(target.y - CONTACT.y, target.x - CONTACT.x);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(CONTACT.x, CONTACT.y);
      ctx.arc(CONTACT.x, CONTACT.y, 93, angle - .11, angle + .11);
      ctx.closePath();
      ctx.fillStyle = 'rgba(204, 234, 102, .09)';
      ctx.fill();
      ctx.setLineDash([4, 7]);
      this._line(CONTACT.x, CONTACT.y, lerp(CONTACT.x, target.x, .87), lerp(CONTACT.y, target.y, .87), 'rgba(224, 243, 152, .32)', 1.2);
      ctx.setLineDash([]);
      this._ellipse(target.x, target.y, 5, 3, null, 'rgba(218, 240, 143, .45)', 1);
      ctx.restore();
    }

    _drawPitch() {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(339, 139); ctx.lineTo(381, 139); ctx.lineTo(391, 289); ctx.lineTo(329, 289);
      ctx.closePath();
      const sand = ctx.createLinearGradient(0, 140, 0, 289);
      sand.addColorStop(0, '#bda272'); sand.addColorStop(.5, '#ceba89'); sand.addColorStop(1, '#d9c79b');
      ctx.fillStyle = sand; ctx.fill();
      ctx.strokeStyle = 'rgba(17, 47, 28, .35)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(106, 80, 49, .12)';
      for (let i = 0; i < 45; i++) ctx.fillRect(341 + ((i * 7) % 36), 142 + ((i * 23) % 140), 1.5, 2.5);
      this._line(330, 153, 390, 153, '#fff7d8', 2);
      this._line(328, 166, 392, 166, '#fff7d8', 1.6);
      this._line(323, 263, 397, 263, '#fff7d8', 2.2);
      this._line(324, 277, 396, 277, '#fff7d8', 1.8);
      this._line(340, 153, 340, 171, '#fff7d8', 1.6);
      this._line(380, 153, 380, 171, '#fff7d8', 1.6);
      this._line(333, 255, 333, 278, '#fff7d8', 1.6);
      this._line(387, 255, 387, 278, '#fff7d8', 1.6);
      this._drawStumps(360, 153, .8, false);
      this._drawStumps(360, 280, 1, Boolean(this._bowled && this._elapsed > this._hitAt + 110));
      if (this.active && this._elapsed < this._hitAt) {
        const p = this._incomingPosition(this._elapsed).p;
        const bounce = this._sceneDelivery.type === 'yorker' ? .91 : .68;
        const bounceY = lerp(134, CONTACT.y, bounce);
        this._ellipse(360, bounceY, 7, 3.5, 'rgba(244, 244, 192, .08)', 'rgba(250, 240, 171, .28)', 1);
        if (p > bounce && p < bounce + .07) this._ellipse(360, bounceY, 6 + (p - bounce) * 70, 3 + (p - bounce) * 30, null, `rgba(239, 219, 156, ${.5 - (p - bounce) * 6})`, 1);
      }
    }

    _drawStumps(x, y, scale, broken) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      if (broken) {
        const p = clamp((this._elapsed - this._hitAt - 110) / 380, 0, 1);
        [-1, 0, 1].forEach((side, index) => {
          ctx.save(); ctx.translate(side * 4 + side * p * 10, p * (index + 1) * 4);
          ctx.rotate(side * p * 1.2 + p * .4);
          this._line(0, 1, 0, -9, '#f7f1d0', 2.1); ctx.restore();
        });
        this._line(-5 - p * 13, -11 - Math.sin(p * Math.PI) * 14, 0 - p * 13, -11 - Math.sin(p * Math.PI) * 14, '#ffb25b', 2);
        this._line(2 + p * 12, -11 - Math.sin(p * Math.PI) * 18, 6 + p * 12, -10 - Math.sin(p * Math.PI) * 18, '#ffb25b', 2);
      } else {
        [-4, 0, 4].forEach((offset) => this._line(offset, 1, offset, -9, '#faf2cf', 2.1));
        this._line(-5, -10, 5, -10, '#f1d990', 2);
      }
      ctx.restore();
    }

    _drawFielders() {
      const hitProgress = this._shot && this._elapsed >= this._hitAt ? clamp((this._elapsed - this._hitAt) / this._flightDuration, 0, 1) : 0;
      FIELDERS.forEach((fielder, index) => {
        let x = fielder.x, y = fielder.y;
        if (hitProgress > 0 && !this._bowled && index === this._nearestFielder) {
          const chase = this._result.runs >= 6 ? .25 : this._result.runs === 4 ? .66 : 1;
          const movement = smooth(hitProgress) * chase;
          x = lerp(x, this._target.x, movement);
          y = lerp(y, this._target.y, movement);
        }
        const rotation = hitProgress > 0 && this._target ? Math.atan2(this._target.y - y, this._target.x - x) + Math.PI / 2 : Math.atan2(CONTACT.y - y, CONTACT.x - x) + Math.PI / 2;
        const stride = hitProgress > 0 && index === this._nearestFielder ? Math.sin(hitProgress * Math.PI * 9) * .8 : 0;
        this._drawPlayer(x, y, y < 160 ? .96 : 1.05, rotation, '#f0924f', stride, this._caught && index === this._nearestFielder && hitProgress > .7 ? 1.4 : 0);
      });
    }

    _drawPlayer(x, y, scale, facingAngle, jersey, stride = 0, arm = 0) {
      const ctx = this.ctx;
      const facing = Math.sin(facingAngle) < -.01 ? -1 : 1;
      const lift = Math.sin(arm);
      const leftFoot = { x: -4 - stride * 1.6, y: 16 + stride * 1.6 };
      const rightFoot = { x: 4 + stride * 1.6, y: 16 - stride * 1.6 };
      this._ellipse(x + 1, y + 18 * scale, 9 * scale, 3.2 * scale, 'rgba(5, 29, 19, .36)');
      // Head, torso and legs stay upright on screen, including when a fielder
      // changes direction. Only the cap brim indicates which way they face.
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      this._line(-3.5, 5, leftFoot.x, leftFoot.y - 2, '#173b2d', 6.2);
      this._line(3.5, 5, rightFoot.x, rightFoot.y - 2, '#173b2d', 6.2);
      this._line(-3.5, 5, leftFoot.x, leftFoot.y - 2, '#fff9e4', 4.8);
      this._line(3.5, 5, rightFoot.x, rightFoot.y - 2, '#fff9e4', 4.8);
      this._line(leftFoot.x - 1.2, leftFoot.y, leftFoot.x + 2, leftFoot.y, '#132d27', 3.4);
      this._line(rightFoot.x - 1, rightFoot.y, rightFoot.x + 2.3, rightFoot.y, '#132d27', 3.4);
      this._line(-5, -5, -9, 1 + stride, jersey, 4.4);
      this._line(-9, 1 + stride, -10, 5 + stride, '#dcac7d', 3.2);
      this._line(5, -5, 8 + lift * 2, 1 - lift * 12, jersey, 4.4);
      this._line(8 + lift * 2, 1 - lift * 12, 10 + lift * 2, 5 - lift * 24, '#dcac7d', 3.2);
      this._ellipse(-10, 5 + stride, 2, 2.2, '#edc198');
      this._ellipse(10 + lift * 2, 5 - lift * 24, 2, 2.2, '#edc198');
      ctx.beginPath();
      ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(7, 6);
      ctx.quadraticCurveTo(0, 9, -7, 6); ctx.closePath();
      ctx.fillStyle = jersey; ctx.fill();
      ctx.strokeStyle = 'rgba(13, 43, 31, .55)'; ctx.lineWidth = .9; ctx.stroke();
      this._line(-6, 5, 6, 5, jersey === '#f0924f' ? '#ffd995' : '#9ead88', 1.4);
      this._line(-2.5, -7, 0, -4, '#fff4d9', 1.7);
      this._line(0, -4, 2.5, -7, '#fff4d9', 1.7);
      this._ellipse(3, -2, 1.1, 1.2, jersey === '#f0924f' ? '#fff6db' : '#e88946');
      this._line(0, -8, 0, -11, '#d9a77a', 3.7);
      this._ellipse(0, -14.5, 5, 5.1, '#edc198', '#754e37', .7);
      this._ellipse(-1.7, -14, .6, .7, '#24352c');
      this._ellipse(1.7, -14, .6, .7, '#24352c');
      this._line(-1, -11.9, 1, -11.9, '#995d43', .7);
      this._ellipse(0, -18, 5.5, 3.1, '#174236');
      this._line(-4, -18.3, 4, -18.3, jersey === '#f0924f' ? '#ffc77c' : '#bacaa5', 1);
      this._line(facing * 2, -16.9, facing * 7, -16.9, '#10382b', 2.4);
      ctx.restore();
    }

    _drawPlayers() {
      const deliveryProgress = this._sceneDelivery ? clamp(this._elapsed / 230, 0, 1) : 0;
      const bowlerY = this.active ? lerp(112, 124, smooth(deliveryProgress)) : 124;
      const bowlerArm = this.active && this._elapsed < 280 ? Math.sin(deliveryProgress * Math.PI) * 1.45 : 0;
      this._drawPlayer(361, bowlerY, 1.02, Math.PI, '#f0924f', this.active && this._elapsed < 210 ? Math.sin(deliveryProgress * 8) * .4 : 0, bowlerArm);
      const hitProgress = this._shot && this._elapsed >= this._hitAt ? clamp((this._elapsed - this._hitAt) / this._flightDuration, 0, 1) : 0;
      const running = hitProgress > 0 && !this._result.wicket && this._result.runs > 0 && this._result.runs < 4;
      const runP = running ? .5 - Math.cos(hitProgress * Math.PI * Math.min(this._result.runs, 3)) * .5 : 0;
      const batterY = running ? lerp(276, 165, runP) : 276;
      const partnerY = running ? lerp(161, 272, runP) : 161;
      this._drawPlayer(374, partnerY, .94, running && Math.sin(hitProgress * Math.PI * this._result.runs) < 0 ? 0 : Math.PI, '#f7efce', running ? Math.sin(hitProgress * 30) : 0);
      this._drawPlayer(347, batterY, 1.08, 0, '#f7efce', running ? Math.sin(hitProgress * 30) : 0);
      const ctx = this.ctx;
      ctx.save(); ctx.translate(347, batterY - 5);
      let batAngle = -1.05;
      if (this._shot && this._swingAt !== Infinity) {
        const swingP = clamp((this._elapsed - this._swingAt) / 290, 0, 1);
        if (this._elapsed >= this._swingAt) batAngle = lerp(-1.6, 1.4, ease(swingP));
      }
      if (running) batAngle = .8;
      ctx.rotate(batAngle);
      this._line(0, 0, 13, 0, '#8e6e45', 2.3);
      this._line(12, 0, 30, 0, '#e8c784', 5.8);
      this._line(15, -1, 28, -1, '#f9e4ae', 1.2);
      this._ellipse(1, 0, 2.2, 2.2, '#fff4d8');
      ctx.restore();
      // The batter's helmet and pads are clearer than a generic fielding sprite.
      this._ellipse(347, batterY - 19, 6, 3.8, '#173f35');
      this._line(352, batterY - 17, 353, batterY - 11, '#b6c7a1', 1.1);
      this._line(348, batterY - 11, 353, batterY - 11, '#b6c7a1', 1);
      if (!running) {
        this._line(342, batterY + 6, 342, batterY + 15, '#fff7de', 5.2);
        this._line(351, batterY + 6, 351, batterY + 15, '#fff7de', 5.2);
        [8, 11, 14].forEach(offset => {
          this._line(340, batterY + offset, 344, batterY + offset, '#d9dcc0', .7);
          this._line(349, batterY + offset, 353, batterY + offset, '#d9dcc0', .7);
        });
      }
    }

    _drawBall() {
      if (this._elapsed < 190) return;
      const afterHit = this._shot && this._elapsed >= this._hitAt;
      const hitP = afterHit ? clamp((this._elapsed - this._hitAt) / this._flightDuration, 0, 1) : 0;
      if (afterHit && this._caught && hitP >= .97) return;
      const pos = afterHit ? this._hitPosition(hitP) : this._incomingPosition(this._elapsed);
      const ctx = this.ctx;
      // A short fading trail communicates ball speed without hiding the contact.
      if (!this._reducedMotion) {
        for (let i = 4; i > 0; i--) {
          const previous = afterHit ? this._hitPosition(hitP - i * .027) : this._incomingPosition(this._elapsed - i * 19);
          this._ellipse(previous.x, previous.y - previous.height, 2.6 - i * .25, 2.6 - i * .25, `rgba(255, 234, 188, ${.2 - i * .033})`);
        }
      }
      this._ellipse(pos.x + 1, pos.y + 2, 3.7 + pos.height * .025, 1.8, `rgba(5, 28, 17, ${.33 - pos.height * .003})`);
      this._ellipse(pos.x, pos.y - pos.height, afterHit && this._result.runs >= 6 ? 3.8 : 3.3, afterHit && this._result.runs >= 6 ? 3.8 : 3.3, '#ffefd6', '#f08045', .9);
      this._line(pos.x - 1, pos.y - pos.height - 2, pos.x + 1, pos.y - pos.height + 2, '#d97441', .7);
      if (afterHit && hitP < .22 && !this._bowled && !this._missed) {
        const alpha = (1 - hitP / .22) * .75;
        this._ellipse(CONTACT.x, CONTACT.y, 5 + hitP * 66, 3 + hitP * 38, null, `rgba(237, 244, 157, ${alpha})`, 2);
      }
    }

    _drawOverlay() {
      const ctx = this.ctx;
      ctx.textBaseline = 'middle';
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.letterSpacing = '1px';
      ctx.fillStyle = '#cbd9bb';
      ctx.fillText('THE OVAL', 25, 22);
      ctx.letterSpacing = '0px';
      if (this.active) {
        this._ellipse(629, 21, 3, 3, '#d8f075');
        ctx.fillStyle = '#e2ecce';
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillText(this._interactive ? 'YOUR SHOT' : 'LIVE BALL', 638, 22);
      } else {
        ctx.fillStyle = '#7ea08b';
        ctx.fillText('EST. 2026', 640, 22);
      }
      if (!this._shot || this._elapsed < this._hitAt + 140) return;
      const runs = this._result.runs || 0;
      const label = String(this._result.label || (this._caught ? 'CAUGHT!' : this._bowled ? 'BOWLED!' : runs === 6 ? 'SIX!' : runs === 4 ? 'FOUR!' : runs ? `${runs} RUN${runs === 1 ? '' : 'S'}` : 'DOT BALL'));
      const t = clamp((this._elapsed - this._hitAt - 140) / 250, 0, 1);
      ctx.save();
      ctx.globalAlpha = smooth(t);
      ctx.font = `800 ${runs >= 4 || this._result.wicket ? 22 : 16}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 24, 15, .6)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = this._result.wicket ? '#ffb077' : '#e1f393';
      ctx.fillText(label, 360, 82 - (1 - ease(t)) * 8);
      ctx.restore();
    }
  }

  window.CricketPitch = CricketPitch;
})();
