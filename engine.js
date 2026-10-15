(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const durations = { pace: 2220, spin: 2570, yorker: 2070 };
  const releases = {pace: 1100, spin: 1160, yorker: 1060};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const geometry = {width: 720, height: 380, center: {x: 360, y: 218}, contact: {x: 360, y: 280}, boundary: {rx: 304, ry: 145}};
  const fielderPositions = [
    {x: 182, y: 117}, {x: 494, y: 108}, {x: 591, y: 199},
    {x: 530, y: 284}, {x: 184, y: 280}, {x: 110, y: 201},
    {x: 271, y: 187}, {x: 453, y: 205}, {x: 360, y: 324},
  ];
  const normalizeAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const validAngle = angle => Number.isFinite(angle) && angle >= -Math.PI && angle <= Math.PI;
  const validPower = power => Number.isFinite(power) && power >= 0 && power <= 1;
  function fieldGeometry() { return clone(geometry); }
  function boundaryPoint(angle, distance = 1) {
    if (!validAngle(angle) || !Number.isFinite(distance) || distance < 0 || distance > 1.2) throw new Error('Invalid field direction.');
    const {contact, center, boundary} = geometry;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const ox = contact.x - center.x, oy = contact.y - center.y;
    const a = dx * dx / boundary.rx ** 2 + dy * dy / boundary.ry ** 2;
    const b = 2 * (ox * dx / boundary.rx ** 2 + oy * dy / boundary.ry ** 2);
    const c = ox * ox / boundary.rx ** 2 + oy * oy / boundary.ry ** 2 - 1;
    const radius = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    return {x: contact.x + dx * radius * distance, y: contact.y + dy * radius * distance};
  }
  function fielders(seed = 0) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid field seed.');
    let random = (seed ^ 0x9e3779b9) >>> 0;
    const jitter = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) / 4294967296 - .5; };
    return fielderPositions.map((fielder, index) => {
      const x = fielder.x + jitter() * 16, y = fielder.y + jitter() * 10;
      const angle = Math.atan2(y - geometry.contact.y, x - geometry.contact.x);
      const edge = boundaryPoint(angle);
      const radius = Math.hypot(x - geometry.contact.x, y - geometry.contact.y) / Math.hypot(edge.x - geometry.contact.x, edge.y - geometry.contact.y);
      return {index, x, y, angle, radius};
    });
  }
  function shotName(angle, power) {
    if (!validAngle(angle) || !validPower(power)) throw new Error('Invalid shot direction or power.');
    const sector = (Math.round((angle + Math.PI / 2) / (Math.PI / 4)) + 8) % 8;
    const ground = ['Straight drive', 'Cover drive', 'Square cut', 'Leg glance', 'Fine glance', 'Leg glance', 'Square drive', 'On drive'];
    const loft = ['Straight loft', 'Lofted cover drive', 'Lofted cut', 'Pull shot', 'Ramp shot', 'Hook shot', 'Lofted square drive', 'Lofted on drive'];
    return (power >= .72 ? loft : ground)[sector];
  }
  function bowlingOptions(options = {}) {
    const line = options.line === undefined ? 0 : options.line, length = options.length === undefined ? .6 : options.length, speed = options.speed === undefined ? .65 : options.speed;
    if (!Number.isFinite(line) || line < -1 || line > 1 || !Number.isFinite(length) || length < 0 || length > 1 || !Number.isFinite(speed) || speed < .25 || speed > 1) throw new Error('Invalid bowling target or power.');
    return {line, length, speed};
  }
  function deliveryDuration(type, speed = .65) {
    if (!Object.hasOwn(durations, type)) throw new Error('Choose a valid delivery.');
    bowlingOptions({speed});
    return Math.round(releases[type] + (durations[type] - releases[type]) * (1.52 - .8 * speed));
  }
  function resolveDelivery(delivery) {
    const {type, timing, seed} = delivery;
    const bowling = bowlingOptions(delivery);
    deliveryDuration(type, bowling.speed);
    if (timing !== null && (!Number.isFinite(timing) || Math.abs(timing) > 10000)) throw new Error('Invalid swing timing.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid shot seed.');
    // Older saved deliveries used aim [-1,1]. New shots can point around the entire oval.
    let angle = delivery.angle;
    if (angle === undefined) {
      if (!Number.isFinite(delivery.aim) || delivery.aim < -1 || delivery.aim > 1) throw new Error('Invalid shot direction.');
      angle = normalizeAngle(-Math.PI / 2 + delivery.aim * Math.PI * .78);
    }
    const power = delivery.power === undefined ? .8 : delivery.power;
    if (!validAngle(angle) || !validPower(power)) throw new Error('Invalid shot direction or power.');
    const windowMs = {pace: 190, spin: 220, yorker: 160}[type] * (1.26 - .4 * bowling.speed);
    const quality = timing === null ? 0 : Math.max(0, 1 - Math.abs(timing) / windowMs);
    const onStumps = Math.abs(bowling.line) < .72 && bowling.length >= .35 && seed % 10 < 8;
    const shot = shotName(angle, power);
    const elevation = power <= .45 ? 0 : clamp((power - .45) / .55, 0, 1);
    const base = {runs: 0, wicket: false, label: 'DOT BALL', quality, angle, power, distance: 0, elevation, shot, fielding: 'miss', ...bowling};
    if (!quality) return {...base, wicket: onStumps, label: onStumps ? 'BOWLED!' : 'DOT BALL', elevation: 0};
    // Power gives reach; timing gives a clean strike. A perfectly timed tap remains a tap.
    const distance = clamp(power * (.25 + .9 * quality) * 1.35, 0, 1.2);
    if (distance < .025) return {...base, distance, elevation: 0};
    const edge = boundaryPoint(angle), dx = Math.cos(angle), dy = Math.sin(angle);
    const boundaryRadius = Math.hypot(edge.x - geometry.contact.x, edge.y - geometry.contact.y);
    const travel = distance * boundaryRadius;
    const lofted = power >= .72;
    const clearsRope = lofted && quality >= .78 && distance >= 1;
    const defenders = fielders(seed).map(fielder => {
      const fx = fielder.x - geometry.contact.x, fy = fielder.y - geometry.contact.y;
      return {...fielder, along: fx * dx + fy * dy, across: Math.abs(fx * dy - fy * dx)};
    });
    if (lofted && !clearsRope) {
      // A mishit hanging over a fielder can be caught. A clean six clears their reach.
      const catcher = defenders.filter(f => f.along > 12 && f.along <= travel + 26 && f.along >= travel * .4 && f.across < 18 + (1 - quality) * 22).sort((a, b) => a.across - b.across)[0];
      if (catcher) return {...base, wicket: true, label: 'CAUGHT!', distance: clamp(catcher.along / boundaryRadius, 0, 1.2), fielding: 'caught', fielderIndex: catcher.index};
    }
    if (!lofted) {
      const stopper = defenders.filter(f => f.along > 8 && f.along <= travel + 9 && f.across < 13 + (1 - quality) * 13).sort((a, b) => a.along - b.along)[0];
      if (stopper) {
        const stoppedDistance = clamp(stopper.along / boundaryRadius, 0, 1.2);
        const runs = power > .4 && quality > .28 && stoppedDistance > .2 ? 1 : 0;
        return {...base, runs, label: runs ? '1 RUN' : 'DOT BALL', distance: stoppedDistance, fielding: 'stopped', fielderIndex: stopper.index};
      }
    }
    if (distance >= 1) return {...base, runs: clearsRope ? 6 : 4, label: clearsRope ? 'SIX!' : 'FOUR!', distance: clearsRope ? Math.max(1.03, distance) : 1.025, elevation: clearsRope ? elevation : .18, fielding: 'boundary'};
    const runs = distance >= .65 ? 3 : distance >= .36 ? 2 : distance >= .1 ? 1 : 0;
    return {...base, runs, label: runs ? `${runs} RUN${runs === 1 ? '' : 'S'}` : 'DOT BALL', distance};
  }
  function createMatch({names = ['You', 'Computer'], overs = 2, wickets = 3, batFirst = 0} = {}) {
    if (![1, 2, 5].includes(overs) || ![1, 3, 5].includes(wickets) || ![0, 1].includes(batFirst)) throw new Error('Invalid match settings.');
    if (!Array.isArray(names) || names.length !== 2 || names.some(n => typeof n !== 'string' || !n.trim() || n.length > 24)) throw new Error('Enter two team names.');
    return {players: names.map(n => n.trim()), overs, wicketLimit: wickets, innings: 0, batter: batFirst,
      scores: [{runs: 0, wickets: 0, balls: 0}, {runs: 0, wickets: 0, balls: 0}],
      phase: 'playing', ball: 0, history: [], lastBall: null, winner: null, target: null};
  }
  function applyDelivery(state, delivery) {
    if (state.phase !== 'playing') throw new Error('This innings is not in play.');
    const outcome = resolveDelivery(delivery);
    const next = clone(state);
    const score = next.scores[next.batter];
    next.ball++;
    score.balls++;
    score.runs += outcome.runs;
    score.wickets += Number(outcome.wicket);
    next.lastBall = {...delivery, ...outcome, id: next.ball, innings: next.innings, batter: next.batter, over: `${Math.floor((score.balls - 1) / 6)}.${(score.balls - 1) % 6 + 1}`};
    next.history.push(next.lastBall);
    if (next.innings === 1 && score.runs >= next.target) {
      next.phase = 'finished';
      next.winner = next.batter;
    } else if (score.balls >= next.overs * 6 || score.wickets >= next.wicketLimit) {
      if (next.innings === 0) next.phase = 'innings-break';
      else {
        next.phase = 'finished';
        const other = next.scores[1 - next.batter].runs;
        next.winner = score.runs === other ? -1 : score.runs > other ? next.batter : 1 - next.batter;
      }
    }
    return next;
  }
  function startNextInnings(state) {
    if (state.phase !== 'innings-break') throw new Error('Finish the first innings first.');
    const next = clone(state);
    next.target = next.scores[next.batter].runs + 1;
    next.batter = 1 - next.batter;
    next.innings = 1;
    next.phase = 'playing';
    next.lastBall = null;
    return next;
  }
  function resultText(state) {
    if (state.phase !== 'finished') return '';
    if (state.winner === -1) return 'Match tied!';
    const chasing = state.batter === state.winner;
    const margin = chasing ? state.wicketLimit - state.scores[state.winner].wickets : state.scores[state.winner].runs - state.scores[1 - state.winner].runs;
    return `${state.players[state.winner]} won by ${margin} ${chasing ? 'wicket' : 'run'}${margin === 1 ? '' : 's'}!`;
  }
  const api = {createMatch, resolveDelivery, applyDelivery, startNextInnings, deliveryDuration, bowlingOptions, resultText, fieldGeometry, boundaryPoint, fielders, shotName};
  root.CricketEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
