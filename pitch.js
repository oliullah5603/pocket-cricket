/* The playing field and animation layer for Pocket Cricket. */
(function () {
  'use strict';

  const W = 720;
  const H = 380;
  const CENTER = { x: 360, y: 218 };
  const CONTACT = { x: 360, y: 280 };
  const BOUNDARY = { rx: 304, ry: 145 };
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
      this.onAim = callbacks.onAim || (() => {});
      this.onCharge = callbacks.onCharge || (() => {});
      this.onBowlAim = callbacks.onBowlAim || (() => {});
      this.onBowl = callbacks.onBowl || (() => {});
      this._bowlingMode = false;
      this._bowlingDragging = false;
      this._bowlingAim = { type: 'pace', line: 0, length: .6, speed: .65 };
      this._aim = 0;
      this._angle = -Math.PI / 2;
      this._power = .76;
      this._charging = false;
      this._pointerId = null;
      this._paused = false;
      this._fielders = window.CricketEngine?.fielders?.(0) || FIELDERS;
      this._delivery = null;
      this._sceneDelivery = null;
      this._shot = null;
      this._result = null;
      this._bowled = false;
      this._caught = false;
      this._missed = false;
      this._elapsed = 0;
      this._start = 0;
      this._duration = 1900;
      this._releaseAt = 780;
      this._interactive = true;
      this._frameId = null;
      this._destroyed = false;
      this._staticLayer = null;
      this._staticKey = '';
      this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
      this._tick = this._tick.bind(this);
      this._resize = this._resize.bind(this);
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.aspectRatio = 'auto';
      canvas.style.touchAction = 'none';
      this._pointerMove = event => {
        if (this._pointerId !== null && event.pointerId !== this._pointerId) return;
        if (this._bowlingMode && !this.active && !this._paused) {
          if (this._bowlingDragging) this._updateBowlDrag(event);
          else this._bowlAimFromPointer(event);
          return;
        }
        this._aimFromPointer(event);
      };
      this._pointerDown = event => {
        if (event.button > 0 || event.isPrimary === false || this._paused) return;
        if (this._bowlingMode && !this.active) {
          event.preventDefault();
          this._bowlAimFromPointer(event);
          this._bowlingAnchor = this.clientToLogical(event.clientX, event.clientY);
          this._bowlingDragging = true;
          this.setBowlingAim({ speed: .65 });
          this._pointerId = event.pointerId;
          try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic events may not support capture. */ }
          return;
        }
        if (!this.active || !this._interactive || this._shot) return;
        event.preventDefault();
        this._aimFromPointer(event);
        if (this.startCharge()) {
          this._pointerId = event.pointerId;
          try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Capture can be unavailable on synthetic events. */ }
        }
      };
      this._pointerUp = event => {
        if (this._pointerId !== event.pointerId) return;
        event.preventDefault();
        if (this._bowlingDragging) {
          this._updateBowlDrag(event);
          this._bowlingDragging = false;
          this._releasePointer();
          const aim = this.bowlingAim;
          this.onBowl(aim);
          this._draw();
          return;
        }
        this._aimFromPointer(event);
        this._releasePointer();
        this._bowlingDragging = false;
        if (this._charging) this.releaseShot();
      };
      this._pointerCancel = event => {
        if (this._pointerId !== event.pointerId) return;
        this._releasePointer();
        this._bowlingDragging = false;
        this._cancelCharge();
        if (!this.active || this._paused) this._draw();
      };
      canvas.addEventListener?.('pointermove', this._pointerMove);
      canvas.addEventListener?.('pointerdown', this._pointerDown);
      canvas.addEventListener?.('pointerup', this._pointerUp);
      canvas.addEventListener?.('pointercancel', this._pointerCancel);
      this._observer = typeof ResizeObserver === 'function' ? new ResizeObserver(this._resize) : null;
      this._observer?.observe(canvas);
      const hudRoot = canvas.parentElement;
      this._observer?.observe(hudRoot?.querySelector?.('.bottom-hud') || canvas);
      this._observer?.observe(hudRoot?.querySelector?.('.score-hud') || canvas);
      this._observer?.observe(hudRoot?.querySelector?.('.top-hud') || canvas);
      window.addEventListener('resize', this._resize);
      this._resize();
    }

    get active() { return this._delivery !== null; }
    get paused() { return this._paused; }
    get bowlingAim() { return { ...this._bowlingAim }; }
    get shotAim() {
      const power = this._effectivePower();
      return { angle: this._angle, power, shot: window.CricketEngine?.shotName?.(this._angle, power) || (power >= .72 ? 'Lofted drive' : 'Grounded drive') };
    }

    startDelivery(delivery = {}, options = {}) {
      if (this._destroyed) return;
      this._cancelCharge();
      this._bowlingDragging = false;
      this._releasePointer();
      this._paused = false;
      this._delivery = { ...delivery, type: ['pace', 'spin', 'yorker'].includes(delivery.type) ? delivery.type : 'pace' };
      const bowling = window.CricketEngine?.bowlingOptions?.(this._delivery) || { line: this._delivery.line ?? 0, length: this._delivery.length ?? .6, speed: this._delivery.speed ?? .65 };
      Object.assign(this._delivery, bowling);
      this._sceneDelivery = this._delivery;
      this._fielders = window.CricketEngine?.fielders?.(this._delivery.seed || 0) || FIELDERS;
      const engineDuration = window.CricketEngine?.deliveryDuration?.(this._delivery.type, this._delivery.speed);
      this._duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : ({ pace: 1900, spin: 2250, yorker: 1750 }[this._delivery.type]);
      this._releaseAt = { pace: 780, spin: 840, yorker: 740 }[this._delivery.type];
      this._interactive = options.interactive !== false;
      this._shot = null;
      this._result = null;
      this._bowled = false;
      this._caught = false;
      this._missed = false;
      this._elapsed = 0;
      this._start = performance.now();
      this._finishAt = Infinity;
      this._catchAt = Infinity;
      this._hitAt = this._duration + 50;
      this._target = null;
      this._nearestFielder = -1;
      this.onProgress(0);
      this.onAim(this.shotAim);
      this._resize();
      this._requestFrame();
    }

    setBowlingMode(enabled) {
      const mode = Boolean(enabled);
      if (mode === this._bowlingMode) return;
      this._bowlingMode = mode;
      if (!mode && this._bowlingDragging) { this._bowlingDragging = false; this._releasePointer(); }
      this.onBowlAim(this.bowlingAim);
      this._resize();
    }

    setBowlingType(type) {
      if (!['pace', 'spin', 'yorker'].includes(type)) return;
      this._bowlingAim.type = type;
      this.setBowlingAim({ length: { pace: .6, spin: .35, yorker: .95 }[type] });
    }

    setBowlingAim(aim = {}) {
      for (const [key, min, max] of [['line', -1, 1], ['length', 0, 1], ['speed', .25, 1]]) {
        if (Number.isFinite(aim[key])) this._bowlingAim[key] = clamp(aim[key], min, max);
      }
      this.onBowlAim(this.bowlingAim);
      if (!this.active || this._paused) this._draw();
    }

    _bowlAimFromPointer(event) {
      const point = this.clientToLogical(event.clientX, event.clientY);
      this.setBowlingAim({ line: (point.x - 360) / 24, length: (point.y - 208) / 65 });
    }

    _updateBowlDrag(event) {
      const point = this.clientToLogical(event.clientX, event.clientY);
      this.setBowlingAim({ speed: .65 + (point.y - this._bowlingAnchor.y) / 70 * .35 });
    }

    setAim(aim) {
      this._aim = clamp(Number(aim) || 0, -1, 1);
      this.setShotAim({ angle: -Math.PI / 2 + this._aim * Math.PI * .78, power: this._power });
    }

    setShotAim({ angle = this._angle, power = this._power } = {}) {
      if (Number.isFinite(angle)) this._angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      if (Number.isFinite(power)) this._power = clamp(power, .15, 1);
      this._aim = clamp((this._angle + Math.PI / 2) / (Math.PI * .78), -1, 1);
      this.onAim(this.shotAim);
      if (!this.active || this._paused) this._draw();
    }

    clientToLogical(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: this._view.width, height: this._view.height };
      return {
        x: ((clientX - rect.left) * this._view.width / Math.max(1, rect.width) - this._view.offsetX) / this._view.scale,
        y: ((clientY - rect.top) * this._view.height / Math.max(1, rect.height) - this._view.offsetY) / this._view.scale,
      };
    }

    _aimFromPointer(event) {
      const point = this.clientToLogical(event.clientX, event.clientY);
      const dx = point.x - CONTACT.x, dy = point.y - CONTACT.y;
      if (Math.hypot(dx, dy) < 5) return;
      const angle = Math.atan2(dy, dx);
      const boundary = this._boundaryPoint(angle, 1);
      const distance = Math.hypot(boundary.x - CONTACT.x, boundary.y - CONTACT.y);
      this.setShotAim({ angle, power: clamp(Math.hypot(dx, dy) / distance, .15, 1) });
    }

    _effectivePower() {
      const now = this._paused ? this._pauseAt : performance.now();
      return clamp(this._power + (this._charging ? clamp((now - this._chargeAt) / 600, 0, 1) * .2 : 0), .15, 1);
    }

    startCharge() {
      if (!this.active || this._paused || !this._interactive || this._shot || this._charging) return false;
      this._charging = true;
      this._chargeAt = performance.now();
      this.onCharge({ power: this._effectivePower(), charging: true });
      this._requestFrame();
      return true;
    }

    _cancelCharge() {
      const charging = this._charging;
      this._charging = false;
      if (charging) this.onCharge({ power: this._power, charging: false });
    }

    cancelCharge() {
      this._cancelCharge();
      this._bowlingDragging = false;
      this._releasePointer();
      if (!this.active || this._paused) this._draw();
    }

    _releasePointer() {
      if (this._pointerId === null) return;
      try { this.canvas.releasePointerCapture?.(this._pointerId); } catch (_) { /* The browser may already have released it. */ }
      this._pointerId = null;
    }

    releaseShot() {
      if (!this.active || this._paused || !this._interactive || this._shot) {
        this._cancelCharge();
        return null;
      }
      const shot = { timing: performance.now() - this._start - this._duration, angle: this._angle, power: this._effectivePower(), aim: this._aim };
      this._cancelCharge();
      this._releasePointer();
      this._setShot(shot);
      this.onSwing({ ...shot });
      return shot;
    }

    swing() {
      return this.releaseShot();
    }

    // CPU and remote shots are scheduled against this delivery's local clock.
    showShot(shot = {}) {
      if (!this.active || this._shot) return null;
      return this._setShot(shot);
    }

    reset() {
      this._cancelCharge();
      this._bowlingDragging = false;
      this._releasePointer();
      if (this._frameId !== null) cancelAnimationFrame(this._frameId);
      this._frameId = null;
      this._paused = false;
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

    pause() {
      if (this._paused || !this.active) return;
      this._pauseAt = performance.now();
      this._elapsed = this._pauseAt - this._start;
      this._paused = true;
      this._cancelCharge();
      this._releasePointer();
      if (this._frameId !== null) cancelAnimationFrame(this._frameId);
      this._frameId = null;
      this._draw();
    }

    resume() {
      if (!this._paused) return;
      this._start += performance.now() - this._pauseAt;
      this._paused = false;
      if (this.active) this._requestFrame();
    }

    destroy() {
      this.reset();
      this._destroyed = true;
      this._observer?.disconnect();
      window.removeEventListener('resize', this._resize);
      this.canvas.removeEventListener?.('pointermove', this._pointerMove);
      this.canvas.removeEventListener?.('pointerdown', this._pointerDown);
      this.canvas.removeEventListener?.('pointerup', this._pointerUp);
      this.canvas.removeEventListener?.('pointercancel', this._pointerCancel);
    }

    _resize() {
      const width = Math.max(1, this.canvas.clientWidth || W);
      const height = Math.max(1, this.canvas.clientHeight || width * H / W);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      const canvasRect = this.canvas.getBoundingClientRect?.() || { top: 0 };
      const hudRoot = this.canvas.parentElement;
      const controlsRect = hudRoot?.querySelector?.('.bottom-hud')?.getBoundingClientRect?.();
      const scoreRect = hudRoot?.querySelector?.('.score-hud')?.getBoundingClientRect?.();
      const headerRect = hudRoot?.querySelector?.('.top-hud')?.getBoundingClientRect?.();
      const controlsTop = controlsRect && controlsRect.height > 0 ? controlsRect.top - canvasRect.top : height;
      const hasControls = controlsTop > 0 && controlsTop < height;
      const hudBottom=Math.max(scoreRect?.height>0 ? scoreRect.bottom-canvasRect.top : 0,headerRect?.height>0 ? headerRect.bottom-canvasRect.top : 0);
      const sceneTop = hasControls ? Math.max(12,hudBottom+10) : 0;
      const sceneBottom = hasControls ? Math.max(sceneTop + 30, controlsTop - 14) : height;
      const bowlingZoom=this._bowlingMode && !this.active;
      const fieldTop=bowlingZoom?86:hasControls?73:0,fieldBottom=bowlingZoom?350:hasControls?363:H;
      const fieldWidth=bowlingZoom?168:W;
      const scale = Math.min((width - (hasControls ? 16 : 0)) / fieldWidth, (sceneBottom - sceneTop) / (fieldBottom-fieldTop));
      this._view = { width, height, dpr, scale, sceneTop, sceneBottom, bowlingZoom, offsetX: width/2-360*scale, offsetY: sceneTop + (sceneBottom - sceneTop - (fieldBottom-fieldTop) * scale) / 2-fieldTop*scale };
      this._buildStaticLayer();
      this._draw();
    }

    _requestFrame() {
      if (!this._destroyed && !this._paused && this._frameId === null) this._frameId = requestAnimationFrame(this._tick);
    }

    _setShot(input) {
      const shot = {
        timing: typeof input.timing === 'number' && Number.isFinite(input.timing) ? input.timing : null,
        aim: clamp(Number(input.aim) || 0, -1, 1),
        angle: Number.isFinite(input.angle) ? Math.atan2(Math.sin(input.angle), Math.cos(input.angle)) : -Math.PI / 2 + clamp(Number(input.aim) || 0, -1, 1) * Math.PI * .78,
        power: Number.isFinite(input.power) ? clamp(input.power, .15, 1) : .76,
      };
      const result = window.CricketEngine.resolveDelivery({ ...this._delivery, ...shot });
      this._shot = shot;
      this._result = result;
      this._aim = this._shot.aim;
      this._angle = this._shot.angle;
      this._power = this._shot.power;
      this._swingAt = this._shot.timing === null ? Infinity : this._duration + clamp(this._shot.timing, -this._duration, 400);
      this._result = this._result || { runs: 0, wicket: false, quality: 0, label: 'Dot ball' };
      this._caught = this._result.fielding === 'caught' || Boolean(this._result.wicket && /caught/i.test(this._result.label || ''));
      this._bowled = Boolean(this._result.wicket && !this._caught);
      this._missed = this._shot.timing === null || this._result.quality === 0;
      this._hitAt = Math.max(this._duration + 50, this._swingAt === Infinity ? 0 : this._swingAt + 35);
      this._flightDuration = this._bowled || this._missed ? 650 : Math.round(950 + clamp(this._result.distance || 0, 0, 1.4) * 400 + (this._result.elevation || 0) * 300);
      this._returnDuration = this._caught || this._bowled || this._missed || this._result.runs >= 4 ? 0 : 460;
      this._catchAt = this._hitAt + this._flightDuration;
      this._finishAt = this._catchAt + (this._caught ? 360 : this._returnDuration + 160);
      this._target = this._shotTarget(this._result);
      let best = Infinity;
      this._fielders.forEach((fielder, index) => {
        const distance = Math.hypot(fielder.x - this._target.x, fielder.y - this._target.y);
        if (distance < best) { best = distance; this._nearestFielder = index; }
      });
      if (Number.isInteger(result.fielderIndex) && result.fielderIndex >= 0 && result.fielderIndex < this._fielders.length) this._nearestFielder = result.fielderIndex;
      this.onAim(this.shotAim);
      this._requestFrame();
      return this._result;
    }

    _tick(now) {
      this._frameId = null;
      if (!this.active || this._destroyed || this._paused) return;
      this._elapsed = now - this._start;
      this.onProgress(clamp(this._elapsed / this._duration, 0, 1));
      if (this._charging) this.onCharge({ power: this._effectivePower(), charging: true });
      if (!this._shot && this._interactive && this._elapsed >= this._duration + 220) {
        const shot = { timing: null, aim: this._aim, angle: this._angle, power: this._effectivePower() };
        this._cancelCharge();
        this._releasePointer();
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

    _shotTarget(result) {
      if (this._bowled) return { x: 362, y: 303 };
      if (this._missed) return { x: this._contactPoint().x, y: 328 };
      return this._boundaryPoint(Number.isFinite(result.angle) ? result.angle : this._shot.angle, Number.isFinite(result.distance) ? result.distance : .3);
    }

    _boundaryPoint(angle, factor = 1) {
      if (window.CricketEngine?.boundaryPoint) return window.CricketEngine.boundaryPoint(angle, factor);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // Intersect the shot ray with the elliptical boundary.
      const ox = CONTACT.x - CENTER.x;
      const oy = CONTACT.y - CENTER.y;
      const a = dx * dx / (BOUNDARY.rx ** 2) + dy * dy / (BOUNDARY.ry ** 2);
      const b = 2 * (ox * dx / (BOUNDARY.rx ** 2) + oy * dy / (BOUNDARY.ry ** 2));
      const c = ox * ox / (BOUNDARY.rx ** 2) + oy * oy / (BOUNDARY.ry ** 2) - 1;
      const distance = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
      return { x: CONTACT.x + dx * distance * factor, y: CONTACT.y + dy * distance * factor };
    }

    _contactPoint() {
      return { x: CONTACT.x + clamp(Number(this._sceneDelivery?.line) || 0, -1, 1) * 12, y: CONTACT.y };
    }

    deliveryPhase(elapsed = this._elapsed) {
      const type=this._sceneDelivery?.type || this._bowlingAim.type;
      const releaseAt={pace:780,spin:840,yorker:740}[type];
      const runEnd=releaseAt*.59,gatherEnd=releaseAt*.75,plantEnd=releaseAt*.87;
      const t=Math.max(0,elapsed),scale=1.02;
      let phase,bodyY,stride=0,rightElbow,rightHand,leftElbow,leftHand,frontFoot;
      const rightShoulder={x:4.6,y:-7};
      if(t<runEnd){
        phase='run-up';const p=t/runEnd;bodyY=lerp(104,133,smooth(p));stride=Math.sin(p*Math.PI*6)*.82;
        rightElbow={x:7.2,y:1+stride*2};rightHand={x:7.7,y:6.7+stride*4};
        leftElbow={x:-7.1,y:1-stride*2};leftHand={x:-7.7,y:6.7-stride*4};
        frontFoot={x:-3.5-stride*3.4,y:21-stride*1.7};
      }else if(t<gatherEnd){
        phase='gather';const p=(t-runEnd)/(gatherEnd-runEnd),q=smooth(p);bodyY=lerp(133,139,q)-Math.sin(p*Math.PI)*2.3;
        rightElbow={x:lerp(7.2,14.5,q),y:lerp(1,-8.5,q)};
        rightHand={x:lerp(7.7,26.3,q),y:lerp(6.7,-10.3,q)};
        leftElbow={x:lerp(-7.1,-6.5,q),y:lerp(1,-10,q)};leftHand={x:lerp(-7.7,-2,q),y:lerp(6.7,-18,q)};
        frontFoot={x:lerp(-3.5,-5,q),y:lerp(21,25,q)};
      }else if(t<releaseAt){
        phase=t<plantEnd?'front-foot':'overarm';const p=(t-gatherEnd)/(releaseAt-gatherEnd),q=smooth(p);bodyY=lerp(139,147,q);
        const angle=lerp(-.15,-Math.PI/2,q);
        rightElbow={x:rightShoulder.x+Math.cos(angle)*10,y:rightShoulder.y+Math.sin(angle)*10};
        rightHand={x:rightShoulder.x+Math.cos(angle)*22,y:rightShoulder.y+Math.sin(angle)*22};
        leftElbow={x:lerp(-6.5,-8,q),y:lerp(-10,-2,q)};leftHand={x:lerp(-2,-7,q),y:lerp(-18,7,q)};
        frontFoot={x:-5,y:25};
      }else{
        const p=clamp((t-releaseAt)/430,0,1),q=smooth(p);phase=p<1?'follow-through':'set';bodyY=147+Math.sin(p*Math.PI)*4;
        const angle=lerp(-Math.PI/2,1.02,q);
        rightElbow={x:lerp(rightShoulder.x+Math.cos(angle)*10,7.2,q),y:lerp(rightShoulder.y+Math.sin(angle)*10,1,q)};
        rightHand={x:lerp(rightShoulder.x+Math.cos(angle)*22,7.7,q),y:lerp(rightShoulder.y+Math.sin(angle)*22,6.7,q)};
        leftElbow={x:-7.1,y:1};leftHand={x:-7.7,y:6.7};frontFoot={x:lerp(-5,-3.5,q),y:lerp(25,21,q)};
      }
      const position={x:361,y:bodyY};
      const absolute=point=>({x:position.x+point.x*scale,y:position.y+point.y*scale});
      return {phase,releaseAt,position,stride,rightShoulder:absolute(rightShoulder),rightElbow:absolute(rightElbow),rightHand:absolute(rightHand),leftElbow:absolute(leftElbow),leftHand:absolute(leftHand),frontFoot:absolute(frontFoot),released:t>=releaseAt};
    }

    _incomingPosition(elapsed) {
      const release=this.deliveryPhase(this._releaseAt);
      const p = clamp((elapsed - this._releaseAt) / (this._duration - this._releaseAt), 0, 1);
      const type = this._sceneDelivery?.type || 'pace';
      const side = ((this._sceneDelivery?.seed || 1) & 1) ? 1 : -1;
      const contact=this._contactPoint(),bouncePoint={x:360+this._sceneDelivery.line*24,y:208+this._sceneDelivery.length*65};
      const releaseHeight=Math.max(43,release.frontFoot.y-release.rightHand.y),releaseGroundY=release.rightHand.y+releaseHeight;
      const bounce=clamp((bouncePoint.y-releaseGroundY)/(contact.y-releaseGroundY),.32,.95);
      const before=p<=bounce,local=before?p/bounce:(p-bounce)/(1-bounce);
      const apex=type==='spin'?24:14;
      const height=before?Math.max(0,releaseHeight+apex*local-(releaseHeight+apex)*local*local):Math.sin(local*Math.PI)*(type==='yorker'?3.5:type==='spin'?12:8);
      const x=before?lerp(release.rightHand.x,bouncePoint.x,local):lerp(bouncePoint.x,contact.x,local);
      const curve=type==='spin' && !before?Math.sin(local*Math.PI)*12*side:Math.sin(local*Math.PI)*(before?1.8:.8)*side;
      return {x:x+curve,y:lerp(releaseGroundY,contact.y,p),height,p,bounce,bouncePoint};
    }

    _hitPosition(progress) {
      const p = clamp(progress, 0, 1);
      const contact=this._contactPoint();
      if (this._bowled || this._missed) return { x: lerp(contact.x, this._target.x, p), y: lerp(contact.y, this._target.y, p), height: Math.sin(p * Math.PI) * (this._missed && this._sceneDelivery.length<.35?18:4) };
      const elevation = clamp(Number(this._result.elevation) || 0, 0, 1);
      const travel = elevation > .35 ? smooth(p) : ease(p);
      const height = elevation > .18 ? Math.sin(p * Math.PI) * (16 + elevation * 100) + (this._caught ? smooth(p) * 12 : 0) : Math.max(0, Math.sin(p * Math.PI * 5)) * (1 - p) * 5;
      return { x: lerp(contact.x, this._target.x, travel), y: lerp(contact.y, this._target.y, travel), height };
    }

    ballStateAt(elapsed = this._elapsed) {
      if(!this._sceneDelivery && !this._bowlingMode) return {owner:'none',phase:'idle',position:null,visibleCount:0};
      if((this._bowlingMode && !this.active) || (!this._shot && elapsed<this._releaseAt) || (this._sceneDelivery && elapsed<this._releaseAt)){
        const pose=this.deliveryPhase(this._bowlingMode && !this.active?0:elapsed);
        return {owner:'bowler',phase:pose.phase,position:{x:pose.rightHand.x,y:pose.rightHand.y,height:0},visibleCount:1};
      }
      if(!this._shot || elapsed<this._hitAt)return {owner:'flight',phase:'delivery',position:this._incomingPosition(elapsed),visibleCount:1};
      const flightP=clamp((elapsed-this._hitAt)/this._flightDuration,0,1);
      if(this._caught && elapsed>=this._catchAt)return {owner:'fielder',phase:'caught',fielderIndex:this._nearestFielder,position:{x:this._target.x,y:this._target.y,height:11.5},visibleCount:1};
      if(this._returnDuration>0 && elapsed>=this._hitAt+this._flightDuration){
        const p=clamp((elapsed-this._hitAt-this._flightDuration)/this._returnDuration,0,1);
        return {owner:'return',phase:'fielding-return',position:{x:lerp(this._target.x,360,p),y:lerp(this._target.y,182,p),height:Math.sin(p*Math.PI)*29+(1-p)*9},visibleCount:1};
      }
      return {owner:'hit-flight',phase:this._bowled?'bowled':this._missed?'miss':'shot',position:this._hitPosition(flightP),visibleCount:1};
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

    _drawBackdrop() {
      const ctx = this.ctx;
      const view = this._view;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      const backdrop = ctx.createLinearGradient(0, 0, 0, view.height);
      backdrop.addColorStop(0, '#252c38'); backdrop.addColorStop(.32, '#263e38'); backdrop.addColorStop(1, '#102b29');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, view.width, view.height);
      const ambience = ctx.createRadialGradient(view.width * .5, view.offsetY + 215 * view.scale, 1, view.width * .5, view.offsetY + 215 * view.scale, Math.max(view.width, view.height) * .64);
      ambience.addColorStop(0, 'rgba(177,190,136,.12)'); ambience.addColorStop(1, 'rgba(8,24,25,0)');
      ctx.fillStyle = ambience; ctx.fillRect(0, 0, view.width, view.height);
    }

    _buildStaticLayer() {
      if (typeof document === 'undefined' || !document.createElement) return;
      const view = this._view;
      const key = [this.canvas.width, this.canvas.height, view.scale, view.offsetX, view.offsetY].join(':');
      if (this._staticLayer && this._staticKey === key) return;
      const layer = document.createElement('canvas');
      layer.width = this.canvas.width; layer.height = this.canvas.height;
      const context = layer.getContext('2d');
      if (!context) return;
      const current = this.ctx;
      this.ctx = context;
      try {
        this._drawBackdrop();
        context.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.offsetX * view.dpr, view.offsetY * view.dpr);
        context.lineCap = 'round'; context.lineJoin = 'round';
        this._drawStadium();
        this._drawGrass();
        this._drawPitchSurface();
        this._staticLayer = layer;
        this._staticKey = key;
      } finally { this.ctx = current; }
    }

    _draw() {
      if (!this.ctx || !this._view) return;
      const ctx = this.ctx;
      const view = this._view;
      if (this._staticLayer) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this._staticLayer, 0, 0);
      } else this._drawBackdrop();
      ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.offsetX * view.dpr, view.offsetY * view.dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (!this._staticLayer) {
        this._drawStadium();
        this._drawGrass();
        this._drawPitchSurface();
      }
      this._drawPitch();
      this._drawAim();
      this._drawFielders();
      this._drawPlayers();
      if (this._sceneDelivery || this._bowlingMode) this._drawBall();
      this._drawOverlay();
    }

    _drawStadium() {
      const ctx = this.ctx;
      this._ellipse(362, 224, 347, 175, 'rgba(2,14,17,.4)');
      const terrace = ctx.createLinearGradient(0,47,0,389);
      terrace.addColorStop(0,'#404951'); terrace.addColorStop(.52,'#263434'); terrace.addColorStop(1,'#313b3a');
      this._ellipse(CENTER.x, CENTER.y, 340, 171, terrace, '#5b625f', .8);
      this._ellipse(CENTER.x, CENTER.y, 332, 166, '#273436', '#74776b', .7);
      for (let row = 0; row < 10; row++) {
        const rx = 312 + row * 2.6;
        const ry = 152 + row * 1.7;
        this._ellipse(CENTER.x,CENTER.y,rx,ry,null,'rgba(142,154,144,.17)',.5);
        for (let i = 0; i < 180; i++) {
          const angle = Math.PI * 2 * i / 180 + (row % 2) * .010;
          const x = CENTER.x + Math.cos(angle) * rx;
          const y = CENTER.y + Math.sin(angle) * ry;
          const color = i % 17 < 2 ? '#af8975' : i % 7 === 0 ? '#b5b7aa' : i % 4 === 0 ? '#537789' : row % 2 ? '#6a746b' : '#77857b';
          this._ellipse(x, y - .4, .58, .58, i % 3 ? '#a59682' : '#756557');
          ctx.fillStyle=color; ctx.fillRect(x-.75,y,.75+(i%2)*.5,1.05);
        }
      }
      this._ellipse(CENTER.x,CENTER.y,311,151,null,'#9c9d88',.9);
      // Signboards follow the far boundary without competing with the HUD.
      [-2.70, -2.25, -1.58, -.91, -.44].forEach((angle, index) => {
        const x = CENTER.x + Math.cos(angle) * 312;
        const y = CENTER.y + Math.sin(angle) * 149;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(149 * Math.cos(angle), -312 * Math.sin(angle)));
        ctx.fillStyle = index % 2 ? '#d9dcd4' : '#273f55'; ctx.fillRect(-26, -3.3, 52, 6.6);
        ctx.fillStyle = index % 2 ? '#314c61' : '#e8ede7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 4.3px system-ui, sans-serif';
        ctx.fillText(index % 2 ? 'THE NIGHT SESSION' : 'POCKET CRICKET', 0, 0); ctx.restore();
      });
      [[45, 80], [675, 80], [15, 250], [705, 250]].forEach(([x, y], index) => {
        ctx.save();
        const glow = ctx.createRadialGradient(x, y, 1, x, y, 49);
        glow.addColorStop(0, 'rgba(232,242,237,.29)'); glow.addColorStop(1, 'rgba(232,242,237,0)');
        ctx.fillStyle = glow; ctx.fillRect(x - 49, y - 49, 98, 98);
        const footY = y + (index < 2 ? 58 : 47);
        this._line(x - 2, y + 3, x - 5, footY, '#748681', 1.3);
        this._line(x + 2, y + 3, x + 5, footY, '#748681', 1.3);
        for (let i=1;i<4;i++) {
          const yy=lerp(y+6,footY,i/4);
          this._line(x-4,yy,x+4,yy+8,'#526a64',.6);
          this._line(x+4,yy,x-4,yy+8,'#526a64',.6);
        }
        ctx.fillStyle = '#5b6868'; ctx.fillRect(x - 13, y - 8, 26, 12);
        for (let i = 0; i < 12; i++) this._ellipse(x - 9 + (i % 4) * 6, y - 5.8 + Math.floor(i / 4) * 3.8, 1.55, 1.1, '#edf1e8');
        ctx.restore();
      });
    }

    _drawGrass() {
      const ctx = this.ctx;
      this._ellipse(CENTER.x, CENTER.y, 309, 150, '#888d73');
      this._ellipse(CENTER.x, CENTER.y, 307, 148, '#284d31');
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(CENTER.x, CENTER.y, BOUNDARY.rx, BOUNDARY.ry, 0, 0, Math.PI * 2);
      ctx.clip();
      const grass = ctx.createLinearGradient(0, 73, 0, 363);
      grass.addColorStop(0, '#527345'); grass.addColorStop(.53, '#416c3a');
      grass.addColorStop(1, '#315a34');
      ctx.fillStyle = grass;
      ctx.fillRect(40, 70, 640, 298);
      ctx.fillStyle = 'rgba(173, 195, 131, .075)';
      for (let x = -260; x < W + 250; x += 65) {
        ctx.beginPath();
        ctx.moveTo(x, 70); ctx.lineTo(x + 32, 70); ctx.lineTo(x + 175, 366); ctx.lineTo(x + 143, 366);
        ctx.closePath(); ctx.fill();
      }
      // Grass texture remains stable between animation frames.
      for (let i = 0; i < 3600; i++) {
        const x = 43 + ((i * 137 + 19) % 638);
        const y = 74 + ((i * 97 + 53) % 289);
        ctx.fillStyle = i % 4 ? 'rgba(200,212,156,.055)' : 'rgba(20,47,28,.10)';
        ctx.fillRect(x, y, .3 + (i % 3) * .3, .4 + (i % 2) * .4);
      }
      const glow = ctx.createRadialGradient(360, 215, 4, 360, 215, 270);
      glow.addColorStop(0, 'rgba(237,237,188,.12)'); glow.addColorStop(1, 'rgba(237,237,188,0)');
      ctx.fillStyle = glow; ctx.fillRect(45, 70, 630, 300);
      const beam=ctx.createLinearGradient(0,80,0,330);
      beam.addColorStop(0,'rgba(225,239,224,.08)'); beam.addColorStop(1,'rgba(225,239,224,0)');
      ctx.fillStyle=beam;
      [[36,80,65,80,490,360,270,306],[655,80,684,80,450,306,230,360]].forEach(points=>{
        ctx.beginPath(); ctx.moveTo(points[0],points[1]); for(let i=2;i<points.length;i+=2)ctx.lineTo(points[i],points[i+1]); ctx.closePath();ctx.fill();
      });
      ctx.setLineDash([3, 7]);
      this._ellipse(360, 228, 191, 94, null, 'rgba(227,232,210,.27)', .75);
      ctx.setLineDash([]);
      ctx.restore();
      this._ellipse(CENTER.x+1, CENTER.y+1, BOUNDARY.rx, BOUNDARY.ry, null, 'rgba(17,39,22,.32)', 1.9);
      this._ellipse(CENTER.x, CENTER.y, BOUNDARY.rx, BOUNDARY.ry, null, '#d9dbca', 1.2);
      // Small rope markers along the boundary.
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16;
        this._ellipse(CENTER.x + Math.cos(a) * BOUNDARY.rx, CENTER.y + Math.sin(a) * BOUNDARY.ry, 1.15, .6, '#e7e7d4');
      }
    }

    _drawBowlingAim() {
      const ctx=this.ctx,aim=this._bowlingAim,target={x:360+aim.line*24,y:208+aim.length*65};
      ctx.save();ctx.lineCap='round';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='rgba(19,42,48,.14)';ctx.fillRect(332,205,56,71);
      ctx.setLineDash([2,3]);ctx.strokeStyle='rgba(223,235,224,.48)';ctx.lineWidth=.65;ctx.strokeRect(332,205,56,71);
      [224,245,264].forEach(y=>this._line(334,y,386,y,'rgba(223,235,224,.20)',.5));ctx.setLineDash([]);
      const release=this.deliveryPhase(0).rightHand;
      ctx.setLineDash([2,4]);this._line(release.x,release.y,target.x,target.y,'rgba(249,198,112,.43)',.8);ctx.setLineDash([]);
      this._ellipse(target.x,target.y,10,5,'rgba(238,175,82,.14)','#e7b563',1.35);
      this._ellipse(target.x,target.y,4,2,null,'#e8c181',.85);
      this._line(target.x-14,target.y,target.x-7,target.y,'#efd4a0',.85);
      this._line(target.x+7,target.y,target.x+14,target.y,'#efd4a0',.85);
      this._line(target.x,target.y-9,target.x,target.y-4,'#efd4a0',.85);
      this._line(target.x,target.y+4,target.x,target.y+9,'#efd4a0',.85);
      ctx.font='700 7px system-ui,sans-serif';ctx.fillStyle='#e2eadc';ctx.fillText(aim.type.toUpperCase(),360,198);
      ctx.font='500 5.6px system-ui,sans-serif';ctx.fillStyle='#d3ded1';
      ctx.textAlign='right';ctx.fillText('SHORT',328,211);ctx.fillText('FULL',328,270);
      ctx.textAlign='center';ctx.fillStyle='#e8c181';ctx.font='700 6px system-ui,sans-serif';
      ctx.fillText(`${Math.round(aim.speed*100)}%`,406,198);
      ctx.fillStyle='rgba(8,33,36,.47)';ctx.fillRect(403,205,6,66);
      ctx.fillStyle='#d8be82';ctx.fillRect(404,270-64*aim.speed,4,64*aim.speed);
      this._line(402,271,410,271,'#899f94',.6);
      ctx.font='600 5.4px system-ui,sans-serif';ctx.fillStyle='#d4ded0';ctx.fillText(this._bowlingDragging?'RELEASE TO BOWL':'AIM · PULL DOWN · RELEASE',360,316);
      ctx.restore();
    }

    _drawAim() {
      if(this._bowlingMode && !this.active){this._drawBowlingAim();return;}
      if (this._shot && this._elapsed >= this._hitAt) return;
      const ctx = this.ctx;
      const power = this._effectivePower();
      const angle = this._angle;
      const target = this._boundaryPoint(angle, power);
      const color = power >= .72 ? '#fbb562' : '#dafa8a';
      const radius = Math.hypot(target.x - CONTACT.x, target.y - CONTACT.y);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(CONTACT.x, CONTACT.y);
      ctx.arc(CONTACT.x, CONTACT.y, radius, angle - .075, angle + .075);
      ctx.closePath();
      ctx.fillStyle = power >= .72 ? 'rgba(250,183,91,.10)' : 'rgba(209,241,134,.09)';
      ctx.fill();
      ctx.setLineDash([3, 6]);
      this._line(CONTACT.x, CONTACT.y, target.x, target.y, power >= .72 ? 'rgba(251,181,98,.65)' : 'rgba(215,247,160,.65)', 1.3);
      ctx.setLineDash([]);
      this._ellipse(target.x, target.y, this._charging ? 11 : 9, this._charging ? 11 : 9, 'rgba(5,31,27,.18)', color, 1.3);
      this._ellipse(target.x, target.y, 2, 2, color);
      this._line(target.x - 14, target.y, target.x - 7, target.y, color, 1.2);
      this._line(target.x + 7, target.y, target.x + 14, target.y, color, 1.2);
      this._line(target.x, target.y - 14, target.x, target.y - 7, color, 1.2);
      this._line(target.x, target.y + 7, target.x, target.y + 14, color, 1.2);
      ctx.font = '700 7px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(power * 100)}%`, target.x, target.y - 21);
      if (this.active && this._interactive && Math.abs(this._elapsed - this._duration) < 180) {
        const strength = 1 - Math.abs(this._elapsed - this._duration) / 180;
        this._ellipse(CONTACT.x, CONTACT.y, 11 + strength * 5, 6 + strength * 3, `rgba(221,255,147,${strength * .15})`, `rgba(220,250,145,${strength * .85})`, 1.8);
      }
      ctx.restore();
    }

    _drawPitchSurface() {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(337, 154); ctx.lineTo(389, 154); ctx.lineTo(401, 310); ctx.lineTo(328, 310); ctx.closePath();
      ctx.fillStyle = 'rgba(15,37,21,.2)'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(336, 152); ctx.lineTo(384, 152); ctx.lineTo(396, 306); ctx.lineTo(324, 306);
      ctx.closePath();
      const sand = ctx.createLinearGradient(0, 152, 0, 306);
      sand.addColorStop(0, '#a49171'); sand.addColorStop(.5, '#bdab86'); sand.addColorStop(1, '#cebf9b');
      ctx.fillStyle = sand; ctx.fill();
      ctx.strokeStyle = 'rgba(37,55,32,.22)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.moveTo(336,152); ctx.lineTo(384,152); ctx.lineTo(396,306); ctx.lineTo(324,306); ctx.closePath(); ctx.clip();
      for (let i = 0; i < 900; i++) {
        const x = 326 + ((i * 137 + 11) % 68), y = 153 + ((i * 97 + 21) % 153);
        ctx.fillStyle = i % 4 ? 'rgba(93,74,47,.07)' : 'rgba(245,229,194,.14)';
        ctx.fillRect(x, y, .8 + (i % 2) * .4, .4 + (i % 3) * .3);
      }
      ctx.fillStyle = 'rgba(85,73,54,.055)'; ctx.fillRect(351,171,18,121);
      this._line(355,195,356,246,'rgba(120,96,64,.07)',1);
      this._line(363,202,362,256,'rgba(120,96,64,.055)',1);
      this._ellipse(348,285,7,3.7,'rgba(100,78,48,.095)');
      this._ellipse(372,187,5,2.7,'rgba(100,78,48,.075)');
      ctx.restore();
      this._line(327, 174, 393, 174, '#eee9d6', 1.45);
      this._line(326, 188, 394, 188, '#eee9d6', 1.05);
      this._line(316, 280, 404, 280, '#f4efdd', 1.65);
      this._line(318, 296, 402, 296, '#eee9d6', 1.3);
      this._line(337, 174, 337, 193, '#eee9d6', 1.1);
      this._line(383, 174, 383, 193, '#eee9d6', 1.1);
      this._line(330, 272, 330, 297, '#f4efdd', 1.15);
      this._line(390, 272, 390, 297, '#f4efdd', 1.15);
    }

    _drawPitch() {
      this._drawStumps(360, 174, .85, false);
      this._drawStumps(360, 298, 1, Boolean(this._bowled && this._elapsed > this._hitAt + 240));
      if (this.active && this._elapsed < this._hitAt) {
        const {p,bounce,bouncePoint}=this._incomingPosition(this._elapsed);
        this._ellipse(bouncePoint.x,bouncePoint.y,5.2,2.8,'rgba(218,220,180,.04)','rgba(233,228,192,.19)',.65);
        if(p>bounce && p<bounce+.05)this._ellipse(bouncePoint.x,bouncePoint.y,4+(p-bounce)*70,2+(p-bounce)*30,null,`rgba(210,194,156,${.25-(p-bounce)*4})`,.6);
      }
    }

    _drawStumps(x, y, scale, broken) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      if (broken) {
        const p = clamp((this._elapsed - this._hitAt - 240) / 380, 0, 1);
        [-1, 0, 1].forEach((side, index) => {
          ctx.save(); ctx.translate(side * 4 + side * p * 10, p * (index + 1) * 4);
          ctx.rotate(side * p * 1.2 + p * .4);
          this._line(0, 1, 0, -9, '#d9c8a0', 1.45); ctx.restore();
        });
        this._line(-5 - p * 13, -11 - Math.sin(p * Math.PI) * 14, 0 - p * 13, -11 - Math.sin(p * Math.PI) * 14, '#ffb25b', 2);
        this._line(2 + p * 12, -11 - Math.sin(p * Math.PI) * 18, 6 + p * 12, -10 - Math.sin(p * Math.PI) * 18, '#ffb25b', 2);
      } else {
        [-4, 0, 4].forEach((offset) => {
          this._line(offset+.5,2,offset+.5,-8,'rgba(38,44,25,.3)',1.8);
          this._line(offset,1,offset,-9,'#e5d7b7',1.45);
          this._line(offset-.3,-1,offset-.3,-8,'#f1e6cd',.35);
        });
        this._line(-5, -10, 5, -10, '#ddc79d', 1.2);
      }
      ctx.restore();
    }

    _drawFielders() {
      const hitProgress = this._shot && this._elapsed >= this._hitAt ? clamp((this._elapsed - this._hitAt) / this._flightDuration, 0, 1) : 0;
      this._fielders.forEach((fielder, index) => {
        let x = fielder.x, y = fielder.y;
        if (hitProgress > 0 && !this._bowled && index === this._nearestFielder) {
          const chase = this._result.runs >= 6 ? .20 : this._result.runs === 4 ? .76 : 1;
          const movement = smooth(hitProgress) * chase;
          x = lerp(x, this._target.x, movement);
          y = lerp(y, this._target.y, movement);
        }
        const rotation = hitProgress > 0 && this._target ? Math.atan2(this._target.y - y, this._target.x - x) + Math.PI / 2 : Math.atan2(CONTACT.y - y, CONTACT.x - x) + Math.PI / 2;
        const stride = hitProgress > 0 && index === this._nearestFielder ? Math.sin(hitProgress * Math.PI * 9) * .8 : 0;
        const collecting=index===this._nearestFielder && hitProgress>.76 && this._result?.runs<4;
        const returnP=this._returnDuration ? clamp((this._elapsed-this._hitAt-this._flightDuration)/this._returnDuration,0,1) : 0;
        this._drawPlayer(x, y, .88 + clamp((y-90)/270,0,1)*.18, rotation, '#f0924f', stride,
          returnP>0 && index===this._nearestFielder ? Math.sin(returnP*Math.PI)*1.45 : 0,
          {index,keeper:index===8,catch:this._caught && collecting,crouch:collecting && !this._caught ? (1-smooth(returnP))*3.8 : 0});
      });
    }

    _drawPlayer(x, y, scale, facingAngle, jersey, stride = 0, arm = 0, pose = {}) {
      const ctx = this.ctx;
      const facing = Math.sin(facingAngle) < -.01 ? -1 : 1;
      const lift = Math.sin(arm), crouch=(pose.crouch||0)+(pose.keeper?1.6:0);
      const skin=['#bd987b','#d3b092','#9b785e','#cda585'][(pose.index||0)%4];
      const accent=jersey==='#f0924f'?'#304f70':'#66798a';
      const leftKnee={x:-2.9+stride*1.2,y:12+stride*1.8};
      const rightKnee={x:2.9-stride*1.2,y:12-stride*1.8};
      const leftFoot={x:-3.5-stride*3.4,y:21-stride*1.7};
      const rightFoot={x:3.5+stride*3.4,y:21+stride*1.7};
      if(pose.bowlingJoints)Object.assign(leftFoot,{x:(pose.bowlingJoints.frontFoot.x-x)/scale,y:(pose.bowlingJoints.frontFoot.y-y)/scale});
      ctx.save(); ctx.translate(x+6*scale,y+20*scale);ctx.rotate(.32);
      ctx.shadowColor='rgba(5,21,17,.15)';ctx.shadowBlur=2.8*scale;
      this._ellipse(4*scale,0,12*scale,2.4*scale,'rgba(7,28,20,.17)');ctx.restore();
      this._ellipse(x,y+21*scale,6*scale,1.4*scale,'rgba(9,29,20,.18)');
      // Jointed limbs and a small shaded head retain natural human proportions.
      // Facing affects the profile and cap brim; figures remain upright.
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      const limb=(a,b,width,cloth=true)=>{
        const shade=ctx.createLinearGradient(a.x-width/2,a.y,b.x+width/2,b.y);
        shade.addColorStop(0,cloth?'#f3f1e8':skin);shade.addColorStop(.45,cloth?'#e1e3da':skin);shade.addColorStop(1,cloth?'#aeb9b1':'#8e715b');
        this._line(a.x,a.y,b.x,b.y,shade,width);
      };
      limb({x:-2.5,y:4+crouch},leftKnee,3.35);limb(leftKnee,{x:leftFoot.x,y:leftFoot.y-1.7},2.85);
      limb({x:2.5,y:4+crouch},rightKnee,3.35);limb(rightKnee,{x:rightFoot.x,y:rightFoot.y-1.7},2.85);
      this._line(leftFoot.x-1,leftFoot.y,leftFoot.x+2.2,leftFoot.y,'#c7ceca',2.5);
      this._line(rightFoot.x-1,rightFoot.y,rightFoot.x+2.2,rightFoot.y,'#c7ceca',2.5);
      this._line(leftFoot.x-1,leftFoot.y+.8,leftFoot.x+2.4,leftFoot.y+.8,'#4c5d59',.65);
      this._line(rightFoot.x-1,rightFoot.y+.8,rightFoot.x+2.4,rightFoot.y+.8,'#4c5d59',.65);
      if(pose.batter){
        [[leftKnee,leftFoot],[rightKnee,rightFoot]].forEach(([knee,foot])=>{
          limb({x:knee.x,y:knee.y-1},{x:foot.x,y:foot.y-2.2},3.8);
          for(let i=0;i<3;i++){
            const t=(i+1)/4,px=lerp(knee.x,foot.x,t),py=lerp(knee.y,foot.y-2,t);
            this._line(px-1.5,py,px+1.5,py,'rgba(100,116,110,.26)',.45);
          }
        });
      }
      const shoulderY=-7+crouch;
      const leftElbow={x:pose.batter?-5:-7.1,y:pose.catch?-4:pose.batter?-1:1+crouch-stride*1.5};
      const rightElbow={x:pose.batter?5:7.2-lift*1.7,y:pose.catch?-4:pose.batter?-1:1+crouch-lift*16+stride*1.5};
      const leftHand=pose.catch?{x:-2.4,y:-11.5}:pose.batter?{x:2+(pose.handOffset||0),y:-4}:{x:-7.7,y:6.7+crouch-stride*2};
      const rightHand=pose.catch?{x:2.4,y:-11.5}:pose.batter?{x:4+(pose.handOffset||0),y:-4}:{x:7.7-lift*5,y:6.7+crouch-lift*34+stride*2};
      if(pose.bowlingJoints){
        const local=p=>({x:(p.x-x)/scale,y:(p.y-y)/scale});
        Object.assign(leftElbow,local(pose.bowlingJoints.leftElbow));Object.assign(leftHand,local(pose.bowlingJoints.leftHand));
        Object.assign(rightElbow,local(pose.bowlingJoints.rightElbow));Object.assign(rightHand,local(pose.bowlingJoints.rightHand));
      }
      if(pose.keeper && !pose.catch){leftHand.x=-4.8;rightHand.x=4.8;leftHand.y=6+crouch;rightHand.y=6+crouch;}
      limb({x:-4.6,y:shoulderY},leftElbow,2.8);limb(leftElbow,leftHand,2.05,false);
      limb({x:4.6,y:shoulderY},rightElbow,2.8);limb(rightElbow,rightHand,2.05,false);
      const shirt=ctx.createLinearGradient(-5,-7,6,5);
      shirt.addColorStop(0,'#f0f1e9');shirt.addColorStop(.38,'#e8ebe3');shirt.addColorStop(1,'#a5b6ad');
      ctx.beginPath();
      ctx.moveTo(-4.8,shoulderY);ctx.quadraticCurveTo(-6,-5+crouch,-4.5,3+crouch);
      ctx.lineTo(-3.8,6+crouch);ctx.quadraticCurveTo(0,6.8+crouch,3.8,6+crouch);
      ctx.lineTo(4.5,3+crouch);ctx.quadraticCurveTo(6,-5+crouch,4.8,shoulderY);ctx.closePath();ctx.fillStyle=shirt;ctx.fill();
      this._line(-4.8,shoulderY,-5.2,-2+crouch,accent,.85);
      this._line(4.8,shoulderY,5.2,-2+crouch,accent,.85);
      this._line(-1.8,-7+crouch,0,-5.6+crouch,'#a6b4ae',.6);this._line(0,-5.6+crouch,1.8,-7+crouch,'#a6b4ae',.6);
      this._line(-3.8,5.8+crouch,3.8,5.8+crouch,'#748d85',.6);
      this._line(1.4,-3+crouch,1.8,3.8+crouch,'rgba(118,136,127,.23)',.5);
      this._ellipse(2.7,-3.8+crouch,.65,.9,accent);
      this._line(0,-8+crouch,0,-12+crouch,skin,2.15);
      const face=ctx.createLinearGradient(-3,-15,3,-12);face.addColorStop(0,skin);face.addColorStop(1,'#8c705a');
      this._ellipse(facing*.35,-15+crouch,2.85,3.55,face);
      const cap=ctx.createLinearGradient(-3,-19,4,-14);cap.addColorStop(0,'#38526d');cap.addColorStop(1,'#142c45');
      if(pose.batter){
        this._ellipse(0,-17+crouch,3.55,2.9,cap);
        this._line(facing*2.4,-15.4+crouch,facing*5.5,-14.8+crouch,'#142b41',1.05);
        this._line(facing*5.4,-14.5+crouch,facing*5.2,-10.8+crouch,'#7e9196',.5);
        this._line(facing*2.1,-12.6+crouch,facing*5.3,-12.6+crouch,'#879b9d',.45);
        this._line(facing*1.7,-10.9+crouch,facing*5.2,-10.9+crouch,'#879b9d',.45);
      } else {
        this._ellipse(0,-17.6+crouch,3.15,1.7,cap);
        this._line(facing*1.1,-16.9+crouch,facing*4.8,-16.8+crouch,'#213c56',1);
      }
      const gloves=pose.batter||pose.keeper||pose.catch;
      if(gloves){
        [leftHand,rightHand].forEach(hand=>{
          ctx.beginPath();ctx.moveTo(hand.x-1,hand.y-1.9);ctx.lineTo(hand.x+1,hand.y-1.9);ctx.lineTo(hand.x+1.6,hand.y-.8);ctx.lineTo(hand.x+1.5,hand.y+1.6);ctx.lineTo(hand.x-1.4,hand.y+1.6);ctx.lineTo(hand.x-1.6,hand.y-.8);ctx.closePath();ctx.fillStyle='#d6dcd4';ctx.fill();
          this._line(hand.x-.9,hand.y+.4,hand.x+.9,hand.y+.4,'#849590',.45);
        });
      }else{this._ellipse(leftHand.x,leftHand.y,1,1.15,skin);this._ellipse(rightHand.x,rightHand.y,1,1.15,skin);}
      ctx.restore();
    }

    _drawPlayers() {
      const bowlingPose=this.deliveryPhase(this._bowlingMode && !this.active?0:this._sceneDelivery?this._elapsed:1250);
      this._drawPlayer(bowlingPose.position.x,bowlingPose.position.y,1.02,Math.PI,'#f0924f',bowlingPose.stride,0,{index:2,bowlingJoints:bowlingPose});
      const hitProgress = this._shot && this._elapsed >= this._hitAt ? clamp((this._elapsed - this._hitAt) / this._flightDuration, 0, 1) : 0;
      const running = hitProgress > 0 && !this._result.wicket && this._result.runs > 0 && this._result.runs < 4;
      const runP = running ? .5 - Math.cos(hitProgress * Math.PI * Math.min(this._result.runs, 3)) * .5 : 0;
      const batterY = running ? lerp(288, 188, runP) : 288;
      const partnerY = running ? lerp(188, 288, runP) : 188;
      this._drawPlayer(374, partnerY, .94, running && Math.sin(hitProgress * Math.PI * this._result.runs) < 0 ? 0 : Math.PI, '#f7efce', running ? Math.sin(hitProgress * 30) : 0,0,{index:1,batter:true});
      const handOffset=running?0:this._contactPoint().x-CONTACT.x;
      this._drawPlayer(347, batterY, 1.08, 0, '#f7efce', running ? Math.sin(hitProgress * 30) : 0,0,{index:3,batter:true,handOffset:handOffset/1.08});
      const ctx = this.ctx;
      ctx.save(); ctx.translate(347+handOffset, batterY - 5);
      let batAngle = -1.05;
      if (this._shot && this._swingAt !== Infinity) {
        const swingP = clamp((this._elapsed - this._swingAt) / 290, 0, 1);
        if (this._elapsed >= this._swingAt) {
          const strike = ease(clamp(swingP / .4, 0, 1));
          const follow = ease(clamp((swingP - .4) / .6, 0, 1));
          batAngle = swingP < .4 ? lerp(-1.65, -.28, strike) : lerp(-.28, this._shot.angle, follow);
        }
      }
      if (running) batAngle = .8;
      ctx.rotate(batAngle);
      this._line(0,0,10,0,'#33463f',1.7);
      const willow=ctx.createLinearGradient(9,-2,27,2);
      willow.addColorStop(0,'#d3c39e');willow.addColorStop(.45,'#e0d3b4');willow.addColorStop(1,'#ae9872');
      ctx.beginPath();ctx.moveTo(9,-1.4);ctx.lineTo(14,-2.1);ctx.lineTo(28,-1.7);ctx.quadraticCurveTo(30,0,28,1.7);ctx.lineTo(14,2.1);ctx.lineTo(9,1.4);ctx.closePath();ctx.fillStyle=willow;ctx.fill();
      this._line(14,-.8,27,-.5,'rgba(245,236,207,.55)',.5);
      this._line(15,-1.5,15,1.5,'#5d7782',.7);
      this._line(17,-1.5,17,1.5,'#7e969c',.55);
      this._ellipse(2,-.2,1.65,1.8,'#ecede3');
      ctx.restore();
    }

    _drawBall() {
      const state=this.ballStateAt(this._elapsed);
      if(!state.visibleCount || !state.position)return;
      const pos=state.position,moving=['flight','hit-flight','return'].includes(state.owner);
      if(moving && !this._reducedMotion){
        let previous=null;
        for(let i=4;i>=0;i--){
          const sample=this.ballStateAt(Math.max(0,this._elapsed-i*14));
          if(sample.owner!==state.owner || !sample.position){previous=null;continue;}
          const point={x:sample.position.x,y:sample.position.y-sample.position.height};
          if(previous)this._line(previous.x,previous.y,point.x,point.y,`rgba(231,237,224,${.055+(4-i)*.015})`,.8);
          previous=point;
        }
      }
      if(moving)this._ellipse(pos.x+3,pos.y+2,3.1+pos.height*.02,1.35,`rgba(12,29,20,${.29-pos.height*.002})`);
      let radius=state.owner==='bowler'||state.owner==='fielder'?2.15:this._result?.runs>=6?3.55:3;
      if(state.owner==='flight')radius=2.15+.85*this._incomingPosition(this._elapsed).p;
      if(state.owner==='hit-flight' && this._caught)radius=lerp(3,2.15,clamp(((this._elapsed-this._hitAt)/this._flightDuration-.82)/.18,0,1));
      this._paintBall(pos,radius);
    }

    _paintBall(pos,radius) {
      const ctx=this.ctx;
      const ballY=pos.y-pos.height;
      const leather=ctx.createRadialGradient(pos.x-1.1,ballY-1.3,.1,pos.x,ballY,radius);
      leather.addColorStop(0,'#fffdf2');leather.addColorStop(.56,'#e8e8d9');leather.addColorStop(1,'#b4bbad');
      this._ellipse(pos.x,ballY,radius,radius,leather);
      ctx.save();ctx.translate(pos.x,ballY);ctx.rotate(this._elapsed*.003);
      ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.clip();
      [-.65,.65].forEach(offset=>{
        ctx.beginPath();ctx.moveTo(-1.45+offset,-2.5);ctx.bezierCurveTo(1.6+offset,-1.2,-1.5+offset,1.3,1.45+offset,2.5);ctx.strokeStyle='#9d574d';ctx.lineWidth=.4;ctx.stroke();
      });
      this._ellipse(-.9,-1.2,.55,.38,'rgba(255,255,249,.7)');ctx.restore();
    }

    _drawOverlay() {
      const ctx = this.ctx;
      const labelAt=this._caught?this._catchAt+15:this._hitAt+140;
      if (!this._shot || this._elapsed < labelAt || (this._bowlingMode && !this.active)) return;
      const runs = this._result.runs || 0;
      const label = String(this._result.label || (this._caught ? 'CAUGHT!' : this._bowled ? 'BOWLED!' : runs === 6 ? 'SIX!' : runs === 4 ? 'FOUR!' : runs ? `${runs} RUN${runs === 1 ? '' : 'S'}` : 'DOT BALL'));
      const t = clamp((this._elapsed-labelAt)/(this._caught?140:250),0,1);
      ctx.save();
      ctx.globalAlpha = smooth(t);
      ctx.font = `800 ${runs >= 4 || this._result.wicket ? 22 : 16}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 24, 15, .6)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = this._result.wicket ? '#ffb077' : '#e1f393';
      ctx.fillText(label, 360, 80 - (1 - ease(t)) * 8);
      ctx.font = '600 7px system-ui, sans-serif';
      ctx.fillStyle = '#e3eccc';
      ctx.fillText(`${this._result.shot || this.shotAim.shot}  ·  ${Math.round(this._shot.power * 100)}% POWER`, 360, 97);
      ctx.restore();
    }
  }

  window.CricketPitch = CricketPitch;
})();
