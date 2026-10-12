(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const durations = { pace: 1400, spin: 1800, yorker: 1150 };
  function deliveryDuration(type) {
    if (!Object.hasOwn(durations, type)) throw new Error('Choose a valid delivery.');
    return durations[type];
  }
  function resolveDelivery(delivery) {
    const {type, timing, aim, seed} = delivery;
    deliveryDuration(type);
    if (timing !== null && (!Number.isFinite(timing) || Math.abs(timing) > 10000)) throw new Error('Invalid swing timing.');
    if (!Number.isFinite(aim) || aim < -1 || aim > 1 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Invalid shot.');
    const windowMs = {pace: 190, spin: 220, yorker: 160}[type];
    const quality = timing === null ? 0 : Math.max(0, 1 - Math.abs(timing) / windowMs);
    // Every delivery has a repeatable line and field: both online players get the same result.
    const onStumps = seed % 10 < 8;
    if (!quality) return {runs: 0, wicket: onStumps, quality, label: onStumps ? 'BOWLED!' : 'DOT BALL'};
    if (quality >= .84) return {runs: 6, wicket: false, quality, label: 'SIX!'};
    if (quality >= .57) return {runs: 4, wicket: false, quality, label: 'FOUR!'};
    const fielder = ((seed >>> 5) % 3 - 1) * .7;
    const nearFielder = Math.abs(aim - fielder) < .22;
    if (quality > .32 && nearFielder && (seed >>> 8) % 4 === 0) return {runs: 0, wicket: true, quality, label: 'CAUGHT!'};
    const runs = nearFielder ? 0 : quality > .38 ? 3 : quality > .2 ? 2 : 1;
    return {runs, wicket: false, quality, label: runs ? `${runs} RUN${runs === 1 ? '' : 'S'}` : 'DOT BALL'};
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
  const api = {createMatch, resolveDelivery, applyDelivery, startNextInnings, deliveryDuration, resultText};
  root.CricketEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
