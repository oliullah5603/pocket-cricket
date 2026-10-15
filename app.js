(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const Engine = window.CricketEngine;
  function fitViewport() {
    const viewport = window.visualViewport;
    const width = Math.min(viewport?.width || window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    const height = Math.min(viewport?.height || window.innerHeight, window.innerHeight);
    $('stadium').style.setProperty('--game-width', `${Math.floor(width)}px`);
    $('stadium').style.setProperty('--game-height', `${Math.floor(height)}px`);
  }
  fitViewport();
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);
  const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const safeWrite = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const stats = safeRead('pocket-cricket-stats-v1', {games: 0, wins: 0, best: 0});
  let mode = 'cpu', match = null, pendingMatch = null, room = null, connected = false;
  let busy = false, currentDelivery = null, recorded = false, rematchRequested = false, paused = false;
  let timers = [], modalAction = null, modalCancel = null, previousFocus = null, toastTimer;
  let sound = safeRead('pocket-cricket-sound', false), audioContext, spaceHeld = false;
  let selectedBowlingType = 'pace', bowlingPending = false;
  const pauseReasons = new Set();
  let menuTab = 'match', returnToMenu = false;
  const pitch = new CricketPitch($('pitchCanvas'), {
    onSwing: shot => receiveSwing(shot),
    onFinish: () => finishBall(),
    onProgress: progress => { $('timingCursor').style.left = `${Math.min(100, Math.max(0, progress * 85))}%`; },
    onAim: updateShotReadout,
    onBowlAim: updateBowlingReadout,
    onBowl: aim => dispatchBowl(aim),
    onCharge: info => { if (match && !amBatting()) return; $('powerFill').style.width = `${Math.round(info.power * 100)}%`; $('powerValue').textContent = `${Math.round(info.power * 100)}%`; $('powerFill').classList.toggle('charging', info.charging); }
  });
  const randomUint = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
  const randomType = () => ['pace', 'spin', 'yorker'][randomUint() % 3];
  function later(fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function panelOpen() { return !$('gameMenu').hidden || !$('scorecard').hidden || !$('modal').hidden; }
  function pauseFor(reason, enabled) {
    enabled ? pauseReasons.add(reason) : pauseReasons.delete(reason);
    paused = mode !== 'online' && pauseReasons.size > 0;
    if (paused) { spaceHeld = false; pitch.setBowlingMode?.(false); pitch.pause?.(); }
    else pitch.resume?.();
  }
  function schedulePlay() { if (match?.phase === 'playing' && mode !== 'online' && amBatting() && !busy && !paused && !panelOpen()) later(startAutomaticBall, 800); }
  function selectMenuTab(tab) {
    menuTab = tab;
    for (const name of ['match', 'controls']) {
      const suffix = name === 'match' ? 'Match' : 'Controls';
      $('menuTab' + suffix).setAttribute('aria-selected', String(name === tab));
      $('menuTab' + suffix).classList.toggle('selected', name === tab);
      $('menuTab' + suffix).tabIndex = name === tab ? 0 : -1;
      $('menu' + suffix + 'Panel').hidden = name !== tab;
    }
  }
  function showMenu() { selectMenuTab(menuTab); $('gameMenu').hidden = false; pauseFor('menu', true); render(); $('menuClose').focus(); }
  function closeMenu() { $('gameMenu').hidden = true; pauseFor('menu', false); render(); schedulePlay(); }
  function showScorecard() {
    returnToMenu = !$('gameMenu').hidden;
    pauseFor('scorecard', true);
    $('gameMenu').hidden = true; pauseFor('menu', false);
    $('scorecard').hidden = false; render(); $('scorecardClose').focus();
  }
  function closeScorecard() {
    $('scorecard').hidden = true;
    if (returnToMenu) { $('gameMenu').hidden = false; pauseFor('menu', true); }
    pauseFor('scorecard', false); render();
    if (returnToMenu) $('scorecardButton').focus(); else schedulePlay();
    returnToMenu = false;
  }
  function closePanels() { $('gameMenu').hidden = $('scorecard').hidden = $('modal').hidden = true; returnToMenu = false; pauseReasons.clear(); paused = false; spaceHeld = false; pitch.resume?.(); }
  function updateShotReadout(shot) {
    if (match && !amBatting()) { updateBowlingReadout(busy ? currentDelivery : pitch.bowlingAim); return; }
    const angle = shot.angle ?? -Math.PI / 2;
    const power = shot.power ?? .7;
    $('powerFill').style.width = `${Math.round(power * 100)}%`;
    $('powerValue').textContent = `${Math.round(power * 100)}%`;
    $('shotName').textContent = shot.shot || Engine.shotName?.(angle, power) || 'Straight drive';
    $('shotAngle').textContent = `${Math.round(angle * 180 / Math.PI)}°`;
  }
  function updateBowlingReadout(aim = {}) {
    if (!match || amBatting()) return;
    aim ||= {};
    const {line, length, speed} = Engine.bowlingOptions(aim);
    const label = length < .3 ? 'Short' : length > .83 ? 'Full / yorker' : 'Good length';
    $('powerFill').style.width = `${Math.round(speed * 100)}%`;
    $('powerValue').textContent = `${Math.round(speed * 100)}%`;
    $('powerFill').classList.remove('charging');
    $('shotName').textContent = `${label} · ${selectedBowlingType === 'pace' && length < .3 ? 'BOUNCER' : selectedBowlingType.toUpperCase()}`;
    $('shotAngle').textContent = line < -.2 ? 'LEG' : line > .2 ? 'OFF' : 'MIDDLE';
  }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4200); }
  function tone(outcome) {
    if (!sound) return;
    try {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume();
      [outcome.wicket ? 130 : outcome.runs >= 4 ? 650 : 380, outcome.wicket ? 85 : outcome.runs >= 4 ? 880 : 480].forEach((freq, i) => {
        const osc = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime + i * .13;
        osc.type = outcome.wicket ? 'triangle' : 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.12, now + .01); gain.gain.exponentialRampToValueAtTime(.0001, now + .22);
        osc.connect(gain); gain.connect(audioContext.destination); osc.start(now); osc.stop(now + .25);
      });
    } catch {}
  }
  function updateSound() { $('soundButton').textContent = sound ? '♫' : '♪'; $('soundButton').setAttribute('aria-pressed', String(sound)); $('soundButton').setAttribute('aria-label', sound ? 'Turn sound off' : 'Turn sound on'); }
  function showModal({title, description, icon = '🏏', primary = 'Got it', action = hideModal, secondary, cancel}) {
    previousFocus = document.activeElement;
    $('modalTitle').textContent = title; $('modalDescription').textContent = description; $('modalIcon').textContent = icon;
    $('modalPrimary').textContent = primary; $('modalSecondary').textContent = secondary || '';
    $('modalSecondary').hidden = !secondary; modalAction = action; modalCancel = cancel || hideModal;
    $('modal').hidden = false; pauseFor('modal', true); $('modalPrimary').focus();
  }
  function hideModal() { $('modal').hidden = true; pauseFor('modal', false); modalAction = null; modalCancel = null; previousFocus?.focus(); schedulePlay(); }
  $('modalPrimary').onclick = () => { const fn = modalAction; hideModal(); fn?.(); };
  $('modalSecondary').onclick = () => { const fn = modalCancel; hideModal(); fn?.(); };
  function mySeat() { return mode === 'online' ? room?.seat ?? 0 : mode === 'local' ? match?.batter ?? 0 : 0; }
  function amBatting() { return !!match && match.batter === mySeat(); }
  function settings() { return {overs: Number($('oversSelect').value), wickets: 3, batFirst: Number($('batFirstSelect').value)}; }
  function playerName() { return $('playerName').value.trim() || 'You'; }
  function updateStats() { $('bestStat').innerHTML = `${stats.best} <small>runs</small>`; $('gamesStat').textContent = stats.games; $('winsStat').textContent = stats.wins; }
  function saveMatch() { if (mode !== 'online') safeWrite('pocket-cricket-save-v1', match?.phase !== 'finished' ? {mode, match} : null); }
  function setMode(next) {
    mode = next;
    document.querySelectorAll('[data-mode]').forEach(button => { const selected = button.dataset.mode === next; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    $('friendField').hidden = next !== 'local'; $('onlineFields').hidden = next !== 'online' || !!room;
    $('startButton').textContent = next === 'online' ? 'Create a room ↗' : 'Start a match ↗';
    $('modeHint').textContent = next === 'local' ? 'Take turns batting against automatic deliveries. Pass the device between innings.' : next === 'online' ? 'You bat, your friend bowls. Then switch. Play from two browsers or devices.' : 'Two innings. Three wickets. Endless “one more match”.';
    $('batFirstSelect').options[0].textContent = next === 'local' ? 'Player 1 bats first' : 'You bat first';
    $('batFirstSelect').options[1].textContent = next === 'local' ? 'Player 2 bats first' : 'You bowl first';
    if (!match) render();
  }
  function resetGame({leaveRoom = false} = {}) {
    bowlingPending = false;
    clearTimers(); pitch.reset(); busy = false; currentDelivery = null; pendingMatch = null; match = null; recorded = false; rematchRequested = false; paused = false;
    $('outcomeBadge').hidden = true; $('timingCursor').style.left = '0%'; $('fieldCaption').textContent = 'Good vibes. Great cover drives.';
    if (leaveRoom) { room?.leave(); room = null; connected = false; $('roomCard').hidden = true; $('onlineStatus').hidden = true; }
    $('modal').hidden = true; pauseReasons.clear(); paused = false; spaceHeld = false; render();
  }
  function lockSetup(locked) {
    document.querySelectorAll('[data-mode]').forEach(b => b.disabled = locked);
    ['playerName', 'friendName', 'oversSelect', 'batFirstSelect'].forEach(id => $(id).disabled = locked);
    $('startButton').disabled = locked;
    $('joinButton').disabled = locked;
    $('resumeButton').hidden = locked || !safeRead('pocket-cricket-save-v1', null);
  }
  function render() {
    const view = match || Engine.createMatch({names: room?.players?.length === 2 ? room.players : [playerName(), mode === 'local' ? $('friendName').value.trim() || 'Player 2' : mode === 'online' ? 'Your friend' : 'Computer'], ...settings()});
    view.players.forEach((name, i) => {
      $('name' + i).textContent = name;
      if (match && view.batter === i && view.phase !== 'finished') { const label = document.createElement('span'); label.textContent = 'BAT'; $('name' + i).append(' ', label); }
      $('score' + i).innerHTML = `${view.scores[i].runs}<span>/${view.scores[i].wickets}</span>`;
      $('overs' + i).textContent = `${Math.floor(view.scores[i].balls / 6)}.${view.scores[i].balls % 6} / ${view.overs} ${view.overs === 1 ? 'over' : 'overs'}`;
      $('team' + i).classList.toggle('active', view.batter === i && view.phase !== 'finished');
    });
    $('matchMode').textContent = mode === 'online' ? 'FRIENDLY ONLINE' : mode === 'local' ? 'LOCAL DERBY' : 'QUICK MATCH';
    $('inningsLabel').textContent = match ? `${view.innings === 0 ? '1st' : '2nd'} innings · ${view.overs} ${view.overs === 1 ? 'over' : 'overs'}` : `${view.overs} ${view.overs === 1 ? 'over' : 'overs'} · 3 wickets`;
    const score = view.scores[view.batter];
    $('targetLine').textContent = !match ? 'The pitch is yours. Start a match to play.' : view.phase === 'finished' ? Engine.resultText(view) : view.target ? `${view.players[view.batter]} need ${Math.max(0, view.target - score.runs)} runs from ${Math.max(0, view.overs * 6 - score.balls)} balls · Target ${view.target}` : `${view.players[view.batter]} are setting the target · ${view.wicketLimit - score.wickets} wickets left`;
    const batting = !match || amBatting();
    pitch.setPresentationRole?.(batting ? 'batting' : 'bowling');
    $('stadium').classList.toggle('bowling-role', !batting);
    $('shotPanelTitle').textContent = batting ? 'YOUR SHOT' : 'YOUR DELIVERY';
    $('pauseButton').hidden = !match || mode === 'online' || view.phase !== 'playing';
    $('pauseButton').textContent = paused ? 'Resume play' : 'Pause';
    $('battingControls').hidden = !batting; $('bowlingControls').hidden = batting || !match || view.phase !== 'playing';
    $('swingButton').disabled = !match || !busy || !batting || paused || (mode === 'online' && !connected);
    $('aimLeft').disabled = $('aimRight').disabled = !match || !batting || paused || view.phase !== 'playing' || (mode === 'online' && !connected);
    const canBowl = !!match && !batting && !busy && !bowlingPending && !paused && !panelOpen() && document.visibilityState !== 'hidden' && view.phase === 'playing' && (mode !== 'online' || connected);
    document.querySelectorAll('[data-delivery]').forEach(b => { b.disabled = !canBowl; b.setAttribute('aria-pressed', String(b.dataset.delivery === selectedBowlingType)); });
    $('bowlButton').disabled = !canBowl;
    pitch.setBowlingMode?.(canBowl);
    if (canBowl) $('outcomeBadge').hidden = true;
    if (!batting) updateBowlingReadout(busy ? currentDelivery : pitch.bowlingAim);
    $('nextButton').hidden = !match || busy;
    $('newMatchButton').hidden = !match;
    $('newMatchButton').textContent = view.phase === 'finished' ? 'New match' : 'End match';
    $('rolePill').textContent = !match ? 'YOUR CREASE' : batting ? 'BATTING' : 'BOWLING';
    $('playTitle').textContent = !match ? 'Welcome to the crease' : view.phase === 'finished' ? 'Match complete' : view.phase === 'innings-break' ? 'Innings break' : paused ? 'Match paused' : busy ? batting ? 'Watch the ball. Release your shot.' : 'Delivery in play' : batting ? mode === 'online' ? 'Waiting for the bowler' : 'Next delivery coming up' : bowlingPending ? 'Sending your delivery…' : 'Pick a delivery card to bowl.';
    $('playDescription').textContent = !match ? 'Open the in-game menu to start a match.' : view.phase === 'finished' ? 'View the scorecard or play a rematch.' : view.phase === 'innings-break' ? `${view.players[1 - view.batter]} chase ${score.runs + 1}.` : paused ? 'Resume play when you are ready.' : busy ? batting ? 'Click when the ball reaches the bat. Aim away from fielders.' : 'The batter controls this shot.' : batting ? mode === 'online' ? 'Your friend chooses the next delivery.' : 'Automatic bowling — stay ready.' : 'Tap Bouncer, Spin or Yorker. Aim on the pitch to adjust your target.';
    $('controlHint').textContent = batting ? 'Move to aim · Farther cursor = more power · Click to hit' : 'Tap a card: bowl · Pitch: target & power · Space: repeat delivery';
    $('inputHint').textContent = batting ? 'HOLD FOR EXTRA POWER · RELEASE TO STRIKE' : 'AIM ON PITCH · DRAG DOWN · RELEASE';
    if (match && !busy) {
      if (view.phase === 'innings-break') { $('nextButton').textContent = 'Start the chase →'; $('nextButton').disabled = mode === 'online' && !room?.isHost; }
      else if (view.phase === 'finished') { $('nextButton').textContent = rematchRequested ? 'Waiting for friend…' : 'Play again ↗'; $('nextButton').disabled = rematchRequested || (mode === 'online' && !connected); }
      else { $('nextButton').hidden = true; }
    }
    if (match && mode === 'online' && !connected) { $('playTitle').textContent = 'Connection paused.'; $('playDescription').textContent = 'Your friend left or lost connection. Leave the room and create a new one.'; }
    lockSetup(!!match || !!room);
    if (room && !match) { $('startButton').hidden = !connected || !room.isHost; $('startButton').disabled = !connected; $('startButton').textContent = 'Start online match ↗'; }
    else $('startButton').hidden = !!match;
    const history = view.history.slice().reverse();
    $('historyCount').textContent = `${view.history.length} DELIVER${view.history.length === 1 ? 'Y' : 'IES'}`;
    $('historyList').replaceChildren();
    if (!history.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'A fresh pitch. A story waiting to happen.'; $('historyList').append(p); }
    history.forEach(ball => {
      const row = document.createElement('div'); row.className = 'delivery';
      const icon = document.createElement('span'); icon.className = `delivery-icon ${ball.wicket ? 'wicket' : ball.runs === 6 ? 'six' : ball.runs === 4 ? 'four' : ''}`; icon.textContent = ball.wicket ? 'W' : ball.runs;
      const text = document.createElement('div'); text.className = 'delivery-text'; const strong = document.createElement('strong'); strong.textContent = ball.label; const small = document.createElement('small'); small.textContent = `${view.players[ball.batter]} · ${ball.shot || ball.type} · ${ball.over}`; text.append(strong, small);
      const tag = document.createElement('span'); tag.className = 'delivery-score'; tag.textContent = ball.timing === null ? 'Missed' : `${Math.round(ball.quality * 100)}% timing · ${Math.round((ball.power ?? .8) * 100)}% power`;
      row.append(icon, text, tag); $('historyList').append(row);
    });
    $('ballTrail').replaceChildren();
    const currentOver = Math.floor(Math.max(0, score.balls - 1) / 6);
    view.history.filter(ball => ball.batter === view.batter && Math.floor((Number(ball.over.split('.')[0]) * 6) / 6) === currentOver).slice(-6).forEach(ball => { const b = document.createElement('span'); b.textContent = ball.wicket ? 'W' : ball.runs; b.className = ball.wicket ? 'wicket' : ball.runs >= 4 ? 'boundary' : ''; $('ballTrail').append(b); });
    updateStats();
  }
  function acceptMatch(next) {
    if (next.ball === 0) { recorded = false; rematchRequested = false; }
    if (busy) pendingMatch = next;
    else { match = next; saveMatch(); render(); }
  }
  function startOffline() {
    resetGame();
    closePanels();
    match = Engine.createMatch({names: [playerName(), mode === 'local' ? $('friendName').value.trim() || 'Player 2' : 'Computer'], ...settings()});
    saveMatch(); render();
    if (mode === 'local') localHandoff(() => startAutomaticBall());
    else if (amBatting()) showModal({title: 'You’re on strike.', description: 'Move your cursor around the batter to aim. Farther from the bat means more power. Click as the ball reaches the crease; hold and release for an extra power boost. Ground shots are safer, lofted shots can clear the rope or be caught.', primary: 'Ready to bat →', action: () => later(startAutomaticBall, 850)});
  }
  function localHandoff(action) {
    showModal({title: `${match.players[match.batter]}, you’re up.`, description: 'Pass the device to the batter. Face the automatic bowler, time your swings, and set a score for your friend to beat.', primary: 'Ready to bat →', action});
  }
  function startAutomaticBall() {
    if (!match || busy || match.phase !== 'playing' || paused || document.visibilityState === 'hidden' || panelOpen()) return;
    const type = match.scores[match.batter].balls === 0 ? 'spin' : randomType();
    const seed = randomUint();
    beginDelivery({type, seed, line: ((seed >>> 8) % 101 - 50) / 100, length: type === 'yorker' ? .95 : type === 'spin' ? .35 : .4 + ((seed >>> 16) % 31) / 100, speed: .5 + (seed % 41) / 100, id: `${match.ball + 1}`});
  }
  function beginDelivery(delivery) {
    if (!match || busy || match.phase !== 'playing') return;
    bowlingPending = false; busy = true; currentDelivery = delivery; pendingMatch = null;
    $('outcomeBadge').hidden = true; $('stadiumTag').textContent = `${delivery.type.toUpperCase()} DELIVERY`;
    $('fieldCaption').textContent = amBatting() ? 'Eyes on the ball. Swing at the crease.' : 'Field set. Make this one count.';
    pitch.startDelivery(delivery, {interactive: amBatting()}); render();
    if (mode === 'cpu' && !amBatting()) {
      // CPU timing is picked before the ball, independently of the player's input.
      const miss = randomUint() % 9 === 0;
      const timing = miss ? null : (randomUint() % 451) - 225;
      const angle = (randomUint() / 4294967295 * 2 - 1) * Math.PI;
      const power = .28 + randomUint() / 4294967295 * .72;
      const delay = Engine.deliveryDuration(delivery.type, delivery.speed) + (timing ?? 220);
      later(() => {
        if (!busy || currentDelivery?.id !== delivery.id) return;
        const shot = {timing, angle, power}; pitch.showShot(shot); receiveSwing(shot);
      }, Math.max(50, delay));
    }
  }
  async function receiveSwing(shot) {
    if (!busy || !currentDelivery || pendingMatch) return;
    $('swingButton').disabled = true;
    spaceHeld = false;
    updateShotReadout(shot);
    try {
      if (mode === 'online') await room.swing(shot);
      else acceptMatch(Engine.applyDelivery(match, {...currentDelivery, ...shot}));
    } catch (error) { toast(error.message); }
  }
  function finishBall() {
    busy = false; currentDelivery = null;
    if (pendingMatch) { match = pendingMatch; pendingMatch = null; }
    if (!match) return;
    const last = match.lastBall;
    if (last) {
      updateShotReadout(last);
      $('outcomeBadge').textContent = last.label; $('outcomeBadge').hidden = false;
      $('outcomeBadge').classList.toggle('wicket', last.wicket);
      $('fieldCaption').textContent = last.wicket ? 'The stumps have a story to tell.' : last.runs === 6 ? 'That one’s out of the park!' : last.runs === 4 ? 'All the way to the rope.' : last.runs ? 'Keep the scoreboard ticking.' : 'The bowler wins this one.';
      tone(last);
    }
    $('stadiumTag').textContent = 'THE POCKET OVAL';
    saveMatch(); render();
    if (match.phase === 'finished') {
      if (!recorded) {
        recorded = true; stats.games++;
        if (mode !== 'local' && match.winner === mySeat()) stats.wins++;
        stats.best = Math.max(stats.best, match.scores[mySeat()].runs);
        safeWrite('pocket-cricket-stats-v1', stats); updateStats();
      }
      showModal({title: match.winner === -1 ? 'What a match. It’s a tie!' : `${match.players[match.winner]} take the win!`, description: `${Engine.resultText(match)} Final score: ${match.players[0]} ${match.scores[0].runs}/${match.scores[0].wickets} — ${match.players[1]} ${match.scores[1].runs}/${match.scores[1].wickets}.`, icon: '🏆', primary: mode === 'online' ? 'Request rematch ↗' : 'One more match ↗', action: playAgain, secondary: 'View scorecard', cancel: showScorecard});
    } else if (match.phase === 'innings-break') {
      toast(`Innings over! ${match.players[1 - match.batter]} need ${match.scores[match.batter].runs + 1} to win.`);
    } else if (mode !== 'online' && amBatting() && !paused) later(startAutomaticBall, 1350);
  }
  function continueInnings() {
    if (mode === 'online') { room.continueInnings(); return; }
    match = Engine.startNextInnings(match); pitch.reset(); $('outcomeBadge').hidden = true; saveMatch(); render();
    if (mode === 'local') localHandoff(startAutomaticBall);
    else if (amBatting()) later(startAutomaticBall, 500);
  }
  function playAgain() {
    if (mode === 'online') {
      if (!connected) { toast('Create a new room to play again.'); return; }
      rematchRequested = true;
      try { room.rematch(); render(); if (rematchRequested) toast('Rematch requested. Your friend needs to click Play again too.'); }
      catch (error) { rematchRequested = false; render(); toast(error.message); }
    }
    else startOffline();
  }
  function roomStatus(text) { $('onlineStatus').textContent = text; $('onlineStatus').hidden = false; }
  function createRoomController() {
    return new CricketRoom({
      onStatus: status => {
        const messages = {setup: 'Opening the online pavilion…', connecting: 'Connecting to your friend…', waiting: 'Room ready. Share the invite with a friend.', connected: 'Friend connected. Ready for cricket!', disconnected: 'Friend disconnected. Leave this room and create a new one.'};
        connected = status === 'connected';
        $('connectionBadge').textContent = connected ? '● Friend connected' : '● Offline ready';
        roomStatus(messages[status] || status);
        if (status === 'disconnected') { clearTimers(); pitch.reset(); busy = false; bowlingPending = false; currentDelivery = null; pendingMatch = null; }
        render();
      },
      onLobby: lobby => {
        if (lobby.settings) { $('oversSelect').value = String(lobby.settings.overs); $('batFirstSelect').value = String(lobby.settings.batFirst); }
        connected = lobby.connected; $('roomCard').hidden = false; $('onlineFields').hidden = true;
        $('roomCode').textContent = lobby.code; $('roomPlayers').textContent = lobby.connected ? `${lobby.players[0]} vs ${lobby.players[1]}` : 'Waiting for a friend…'; render();
      },
      onMatch: next => {
        const first = !match || next.ball === 0;
        if (first) { pitch.reset(); busy = false; $('outcomeBadge').hidden = true; closePanels(); }
        acceptMatch(next);
        if (first) toast('Match on! The bowler chooses the first delivery.');
      },
      onDelivery: beginDelivery,
      onShot: shot => { updateShotReadout(shot); pitch.showShot(shot); },
      onError: message => { toast(message); if (!connected && !match) { room?.leave(false); room = null; $('roomCard').hidden = true; $('onlineFields').hidden = false; } roomStatus(message); render(); }
    });
  }
  async function openRoom(join = false) {
    if (!window.Peer || !window.CricketRoom) { toast('Online connection could not load. You can still play offline.'); return; }
    const code = $('roomInput').value.trim().toUpperCase();
    if (join && !/^[A-Z2-9]{6,8}$/.test(code)) { toast('Enter the room code your friend shared.'); $('roomInput').focus(); return; }
    resetGame({leaveRoom: true});
    room = createRoomController(); lockSetup(true); $('startButton').disabled = true; $('joinButton').disabled = true;
    try {
      const result = join ? await room.join(code, {name: playerName()}) : await room.create({name: playerName(), settings: settings()});
      $('roomCode').textContent = result.code; $('roomCard').hidden = false; $('onlineFields').hidden = true; render();
    } catch (error) { room?.leave(); room = null; connected = false; $('roomCard').hidden = true; $('onlineFields').hidden = false; roomStatus(error.message || 'Unable to connect. Try again.'); render(); }
  }
  $('startButton').onclick = () => mode !== 'online' ? startOffline() : room && connected ? room.start() : openRoom();
  $('joinButton').onclick = () => openRoom(true);
  $('roomInput').onkeydown = event => { if (event.key === 'Enter') $('joinButton').click(); };
  $('nextButton').onclick = () => { if (!match || busy) return; if (match.phase === 'innings-break') continueInnings(); else if (match.phase === 'finished') playAgain(); else startAutomaticBall(); };
  $('pauseButton').onclick = () => { pauseFor('manual', !pauseReasons.has('manual')); render(); schedulePlay(); };
  document.querySelectorAll('[data-delivery]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    selectedBowlingType = button.dataset.delivery;
    pitch.setBowlingType?.(selectedBowlingType);
    dispatchBowl(pitch.bowlingAim);
  });
  async function dispatchBowl(aim = pitch.bowlingAim) {
    if (!match || busy || bowlingPending || paused || panelOpen() || document.visibilityState === 'hidden' || amBatting() || match.phase !== 'playing' || (mode === 'online' && !connected)) return;
    try {
      const options = Engine.bowlingOptions(aim);
      bowlingPending = true; render();
      if (mode === 'online') await room.bowl(selectedBowlingType, options);
      else beginDelivery({type: selectedBowlingType, ...options, seed: randomUint(), id: `${match.ball + 1}`});
    } catch (error) { bowlingPending = false; render(); toast(error.message); }
  }
  $('bowlButton').onclick = () => dispatchBowl();
  function changeAim(delta) {
    const aim = pitch.shotAim || {angle: -Math.PI / 2, power: .7};
    const angle = Math.atan2(Math.sin(aim.angle + delta), Math.cos(aim.angle + delta));
    pitch.setShotAim({angle, power: aim.power});
  }
  $('aimLeft').onclick = () => changeAim(-.15); $('aimRight').onclick = () => changeAim(.15);
  $('swingButton').onclick = () => { if (!$('swingButton').disabled) pitch.swing(); };
  $('swingButton').onpointerdown = event => { if (!$('swingButton').disabled) { event.preventDefault(); $('swingButton').setPointerCapture(event.pointerId); pitch.startCharge(); } };
  $('swingButton').onpointerup = event => { if (!$('swingButton').disabled) { event.preventDefault(); pitch.releaseShot(); } };
  $('swingButton').onpointercancel = () => pitch.cancelCharge?.();
  function trapFocus(event, panel) {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(element => element.offsetParent !== null && element.tabIndex >= 0);
    if (!controls.length) return;
    const current = controls.indexOf(document.activeElement);
    event.preventDefault(); controls[(current + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
  }
  document.addEventListener('keydown', event => {
    if (!$('modal').hidden) {
      if (event.key === 'Escape' && !$('modalSecondary').hidden) { event.preventDefault(); $('modalSecondary').click(); }
      trapFocus(event, $('modal'));
      return;
    }
    if (!$('scorecard').hidden) { if (event.key === 'Escape') { event.preventDefault(); closeScorecard(); } trapFocus(event, $('scorecard')); return; }
    if (!$('gameMenu').hidden) { if (event.key === 'Escape') { event.preventDefault(); closeMenu(); } trapFocus(event, $('gameMenu')); return; }
    if (event.key === 'Escape') { event.preventDefault(); showMenu(); return; }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.repeat || !match) return;
    if (event.code === 'Space' && !$('bowlButton').disabled) { event.preventDefault(); dispatchBowl(); }
    else if (event.code === 'Space' && !$('swingButton').disabled) { event.preventDefault(); spaceHeld = pitch.startCharge(); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && !$('bowlButton').disabled) {
      event.preventDefault();
      const aim = Engine.bowlingOptions(pitch.bowlingAim);
      if (event.key === 'ArrowLeft') aim.line = Math.max(-1, aim.line - .15);
      if (event.key === 'ArrowRight') aim.line = Math.min(1, aim.line + .15);
      if (event.key === 'ArrowUp') aim.length = Math.max(0, aim.length - .1);
      if (event.key === 'ArrowDown') aim.length = Math.min(1, aim.length + .1);
      pitch.setBowlingAim?.(aim);
    }
    else if (event.key === 'ArrowLeft' && !$('aimLeft').disabled) { event.preventDefault(); changeAim(-.15); }
    else if (event.key === 'ArrowRight' && !$('aimRight').disabled) { event.preventDefault(); changeAim(.15); }
    else if (event.key.toLowerCase() === 'p' && mode !== 'online' && match.phase === 'playing') { event.preventDefault(); $('pauseButton').click(); }
  });
  document.addEventListener('keyup', event => { if (event.code === 'Space' && spaceHeld) { event.preventDefault(); spaceHeld = false; if (!paused && !panelOpen()) pitch.releaseShot(); else pitch.cancelCharge?.(); } });
  function endMatch() { safeWrite('pocket-cricket-save-v1', null); resetGame({leaveRoom: mode === 'online'}); setMode(mode); showMenu(); }
  $('newMatchButton').onclick = () => match?.phase === 'finished' ? endMatch() : showModal({title: 'Leave this match?', description: mode === 'online' ? 'Your friend will be disconnected from this match. You can create a new room afterward.' : 'This match will end. You can start a fresh one right away.', primary: 'End match', action: endMatch, secondary: 'Keep playing'});
  $('leaveButton').onclick = () => match && match.phase !== 'finished' ? $('newMatchButton').click() : endMatch();
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
  ['playerName', 'friendName', 'oversSelect', 'batFirstSelect'].forEach(id => $(id).addEventListener('change', () => !match && render()));
  $('copyButton').onclick = async () => {
    const url = new URL(location.href); url.searchParams.set('room', room.code);
    try { await navigator.clipboard.writeText(url.toString()); toast('Invite copied! Send it to your friend.'); } catch { toast(`Room code: ${room.code}. Share it with your friend.`); }
  };
  $('soundButton').onclick = () => { sound = !sound; safeWrite('pocket-cricket-sound', sound); updateSound(); if (sound) tone({runs: 4, wicket: false}); };
  $('helpButton').onclick = () => showModal({title: 'Rules & timing', description: 'Six balls per over. Three wickets per team. Two innings. Bat: click as the ball reaches the bat, or hold and release for extra power. Bowl: choose a delivery type, aim the landing target on the pitch, drag down for more speed and release. Space or BOWL uses your current target. Lofted shots can be caught. Offline play pauses in menus; online play continues.', primary: 'Back to controls'});
  $('menuTabMatch').onclick = () => selectMenuTab('match');
  $('menuTabControls').onclick = () => selectMenuTab('controls');
  ['menuTabMatch', 'menuTabControls'].forEach(id => $(id).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tab = event.key === 'Home' ? 'match' : event.key === 'End' ? 'controls' : menuTab === 'match' ? 'controls' : 'match';
    selectMenuTab(tab); $(tab === 'match' ? 'menuTabMatch' : 'menuTabControls').focus();
  }));
  $('menuButton').onclick = showMenu; $('menuClose').onclick = closeMenu;
  $('scorecardButton').onclick = showScorecard; $('scorecardClose').onclick = closeScorecard;
  $('fullscreenButton').onclick = async () => {
    try { document.fullscreenElement ? await document.exitFullscreen() : await $('stadium').requestFullscreen(); }
    catch { toast('The game already fills the browser window. Fullscreen is unavailable in this browser.'); }
  };
  document.addEventListener('fullscreenchange', () => $('fullscreenButton').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
  document.addEventListener('visibilitychange', () => { pauseFor('background', document.visibilityState === 'hidden'); render(); if (document.visibilityState === 'visible') schedulePlay(); });
  $('resumeButton').onclick = () => {
    const saved = safeRead('pocket-cricket-save-v1', null);
    try {
      if (!saved || !['cpu', 'local'].includes(saved.mode) || !saved.match || !['playing', 'innings-break'].includes(saved.match.phase)) throw new Error('No saved match.');
      Engine.createMatch({names: saved.match.players, overs: saved.match.overs, wickets: saved.match.wicketLimit, batFirst: saved.match.batter});
      resetGame(); closePanels(); setMode(saved.mode); match = saved.match; render();
      if (mode === 'local' && match.phase === 'playing') localHandoff(startAutomaticBall);
      else if (mode === 'cpu' && match.phase === 'playing' && amBatting()) later(startAutomaticBall, 750);
    } catch { safeWrite('pocket-cricket-save-v1', null); toast('Saved match could not be restored. Start a fresh match.'); render(); }
  };
  window.addEventListener('beforeunload', () => room?.leave());
  updateSound(); render();
  updateShotReadout(pitch.shotAim || {angle: -Math.PI / 2, power: .7});
  showMenu();
  const invite = new URLSearchParams(location.search).get('room');
  if (invite && /^[A-Z2-9]{6,8}$/.test(invite.toUpperCase())) { setMode('online'); $('roomInput').value = invite.toUpperCase(); toast('Enter your team name, then Join your friend’s room.'); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'}).catch(() => {});
})();
