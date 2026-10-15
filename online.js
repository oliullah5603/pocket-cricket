/* Online cricket over a reliable PeerJS/WebRTC data connection.
 * PeerJS 1.5.5 is bundled locally. Signaling uses its public HTTPS service.
 * Scores are computed independently on both browsers; no score is trusted from a peer.
 */
(function (global) {
  'use strict';

  const PROTOCOL = 'pocket-cricket-v4';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const DELIVERY_TYPES = ['pace', 'spin', 'yorker'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const validCode = code => /^[A-HJ-NP-Z2-9]{8}$/.test(code);
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 24 && !/[\x00-\x1f\x7f]/.test(name);
  const nameOf = (name, fallback) => String(name || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24) || fallback;
  const validSettings = settings => settings && [1, 2, 5].includes(settings.overs) && settings.wickets === 3 && [0, 1].includes(settings.batFirst);
  const validBowling = options => options && Number.isFinite(options.line) && options.line >= -1 && options.line <= 1 && Number.isFinite(options.length) && options.length >= 0 && options.length <= 1 && Number.isFinite(options.speed) && options.speed >= .25 && options.speed <= 1;
  const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  };
  const randomHex = count => Array.from(global.crypto.getRandomValues(new Uint8Array(count)), n => n.toString(16).padStart(2, '0')).join('');
  const roomCode = () => Array.from(global.crypto.getRandomValues(new Uint8Array(8)), n => ALPHABET[n & 31]).join('');
  const hash = async value => {
    const data = new TextEncoder().encode(canonical(value));
    const bytes = new Uint8Array(await global.crypto.subtle.digest('SHA-256', data));
    return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  };

  class CricketRoom {
    constructor(callbacks = {}) {
      this.callbacks = callbacks;
      this.peer = null;
      this.seat = null;
      this.code = '';
      this.isHost = false;
      this.status = 'setup';
      this.players = [];
      this._conn = null;
      this._connected = false;
      this._closed = true;
      this._generation = 0;
      this._state = null;
      this._pending = null;
      this._settings = null;
      this._round = 0;
      this._matchId = '';
      this._retiredMatches = new Set();
      this._lastAdvanceSeq = null;
      this._sessionId = '';
      this._rematchVotes = [false, false];
      this._queue = Promise.resolve();
      this._joinTimer = null;
      this._ballTimer = null;
      this._cancelOpen = null;
      this._cancelJoin = null;
    }

    get connected() { return this._connected && !this._closed && Boolean(this._conn && this._conn.open); }
    get state() { return this._state ? clone(this._state) : null; }

    _emit(event, value) {
      if (typeof this.callbacks[event] !== 'function') return;
      try { this.callbacks[event](value); } catch (error) { console.error('Cricket callback failed:', error); }
    }
    _status(status) { this.status = status; this._emit('onStatus', status); }
    _lobby() { this._emit('onLobby', { code: this.code, players: this.players.slice(), isHost: this.isHost, connected: this.connected, settings: this._settings ? clone(this._settings) : null, rematchVotes: this._rematchVotes.slice() }); }
    _showMatch() { this._emit('onMatch', this.state); }
    _require(condition, message) { if (!condition) throw new Error(message); }
    _requireReady() { this._require(this.connected, 'Your opponent is not connected. Create or join a room again.'); }
    _checkEnvironment() {
      this._require(typeof global.Peer === 'function', 'The online library did not load. Reload the page.');
      this._require(global.crypto && global.crypto.subtle, 'Online cricket needs HTTPS or localhost.');
      this._require(typeof global.RTCPeerConnection === 'function', 'This browser does not support online multiplayer. Try a recent Chrome, Edge, Firefox or Safari.');
      this._require(global.CricketEngine, 'The cricket game did not load. Reload the page.');
      this._require(!global.navigator || global.navigator.onLine !== false, 'You are offline. Use Solo or Pass & Play until you reconnect.');
    }

    async create({ name, settings = {} } = {}) {
      this.leave(false);
      this._checkEnvironment();
      this._closed = false;
      this.isHost = true;
      this.seat = 0;
      this.players = [nameOf(name, 'Host')];
      this._settings = { overs: settings.overs || 2, wickets: settings.wickets || 3, batFirst: settings.batFirst === 1 ? 1 : 0 };
      this._require(validSettings(this._settings), 'Choose 1, 2 or 5 overs with 3 wickets.');
      this._status('connecting');
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          this.code = roomCode();
          try { await this._openPeer(PROTOCOL + '-' + this.code); break; }
          catch (error) {
            const failedPeer = this.peer;
            this.peer = null;
            if (failedPeer) failedPeer.destroy();
            if (error.type !== 'unavailable-id' || attempt === 2) throw error;
          }
        }
        this._require(!this._closed, 'Room creation was cancelled.');
        this._status('waiting');
        this._lobby();
        return { code: this.code };
      } catch (error) { if (!this._closed) this._fail(error.message); throw error; }
    }

    async join(code, { name } = {}) {
      this.leave(false);
      this._checkEnvironment();
      this.code = String(code || '').toUpperCase().replace(/[\s-]/g, '');
      this._require(validCode(this.code), 'Enter the 8-character room code.');
      this._closed = false;
      this.isHost = false;
      this.seat = 1;
      this._name = nameOf(name, 'Guest');
      this._status('connecting');
      try {
        await this._openPeer();
        this._require(!this._closed, 'Joining was cancelled.');
        const joined = new Promise((resolve, reject) => {
          this._joinResolve = resolve;
          this._cancelJoin = reject;
          this._joinTimer = setTimeout(() => this._fail('Could not connect to that room. Check the code and keep the host tab open. Some networks block peer connections.'), 20000);
        });
        const conn = this.peer.connect(PROTOCOL + '-' + this.code, { reliable: true, serialization: 'json', metadata: { protocol: PROTOCOL, code: this.code } });
        this._attachConnection(conn);
        await joined;
        return { code: this.code };
      } catch (error) { if (!this._closed) this._fail(error.message); throw error; }
    }

    _openPeer(id) {
      const generation = this._generation;
      return new Promise((resolve, reject) => {
        let settled = false;
        let peer;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this._cancelOpen = null;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('The multiplayer service did not respond. Check your internet connection and try again.')), 15000);
        this._cancelOpen = finish;
        try {
          // Inherit the bundled library's Google STUN + public PeerJS TURN fallback.
          peer = id ? new global.Peer(id, { secure: true, debug: 0 }) : new global.Peer({ secure: true, debug: 0 });
          this.peer = peer;
        } catch (error) { finish(error); return; }
        const current = () => generation === this._generation && this.peer === peer && !this._closed;
        peer.on('open', () => { if (current()) finish(); });
        peer.on('connection', conn => { if (current()) this._acceptIncoming(conn); else conn.close(); });
        peer.on('error', error => {
          if (!current()) return;
          const friendly = this._peerError(error);
          if (!settled) { const e = new Error(friendly); e.type = error.type; finish(e); }
          else this._fail(friendly);
        });
        peer.on('disconnected', () => {
          if (!current()) return;
          const message = 'The multiplayer connection was lost. Create or join a fresh room to keep playing.';
          if (!settled) finish(new Error(message)); else this._fail(message);
        });
        peer.on('close', () => { if (current()) this._fail('The online room closed. Create or join a fresh room.'); });
      });
    }

    _peerError(error) {
      if (error.type === 'unavailable-id') return 'That room code is already in use. Try creating another room.';
      if (error.type === 'peer-unavailable') return 'Room not found. Check the code and make sure the host has the room open.';
      if (error.type === 'browser-incompatible') return 'This browser cannot connect. Try a recent Chrome, Edge, Firefox or Safari.';
      if (error.type === 'webrtc') return 'Your browsers could not connect. Try another network or use Pass & Play.';
      return 'The multiplayer service is unavailable. Check your connection and try again.';
    }

    _acceptIncoming(conn) {
      const metadata = conn.metadata || {};
      if (!this.isHost || this._conn || metadata.protocol !== PROTOCOL || metadata.code !== this.code) {
        conn.on('open', () => {
          try { conn.send({ v: 3, code: this.code, type: 'reject', message: 'This room is full or incompatible. Ask the host for a fresh room.' }); } catch (_) {}
          setTimeout(() => conn.close(), 150);
        });
        conn.on('error', () => conn.close());
        return;
      }
      this._attachConnection(conn);
    }

    _attachConnection(conn) {
      this._conn = conn;
      const generation = this._generation;
      const current = () => generation === this._generation && this._conn === conn && !this._closed;
      conn.on('open', () => {
        if (!current()) return;
        if (this.isHost) this._joinTimer = setTimeout(() => this._fail('The guest did not finish joining. Create a fresh room.'), 8000);
        else this._send('hello', { name: this._name });
      });
      conn.on('data', packet => {
        if (!current()) return;
        this._queue = this._queue.then(async () => { if (current()) await this._handle(packet); }).catch(error => { if (current()) this._fail(error.message || 'The game could not stay synchronized. Create a fresh room.'); });
      });
      conn.on('close', () => { if (current()) this._fail('Your opponent disconnected. Create or join a fresh room to play again.'); });
      conn.on('error', () => { if (current()) this._fail('The connection to your opponent failed. Try another network or use Pass & Play.'); });
    }

    _send(type, payload = {}) {
      this._require(this._conn && this._conn.open && !this._closed, 'Your opponent is disconnected.');
      this._conn.send({ v: 3, code: this.code, session: this._sessionId, type, ...payload });
    }

    async _handle(packet) {
      this._require(packet && typeof packet === 'object' && !Array.isArray(packet) && JSON.stringify(packet).length < 8192, 'Received an invalid game message.');
      this._require(packet.v === 3 && packet.code === this.code && typeof packet.type === 'string', 'The players are using incompatible game versions. Reload both game pages.');
      if (packet.type === 'reject') throw new Error('This room is full. Ask the host for a fresh room.');
      if (packet.type === 'hello') {
        this._require(this.isHost && !this._connected && validName(packet.name), 'Invalid room join request.');
        clearTimeout(this._joinTimer);
        this._sessionId = randomHex(16);
        this.players.push(packet.name);
        this._connected = true;
        this._send('welcome', { players: this.players, settings: this._settings });
        this._status('connected');
        this._lobby();
        return;
      }
      if (packet.type === 'welcome') {
        this._require(!this.isHost && !this._connected && Array.isArray(packet.players) && packet.players.length === 2 && packet.players.every(validName) && validSettings(packet.settings) && /^[a-f0-9]{32}$/.test(packet.session), 'Invalid room welcome.');
        clearTimeout(this._joinTimer);
        this.players = packet.players.slice();
        this._settings = clone(packet.settings);
        this._sessionId = packet.session;
        this._connected = true;
        this._status('connected');
        this._lobby();
        if (this._joinResolve) this._joinResolve();
        this._joinResolve = null;
        this._cancelJoin = null;
        return;
      }
      this._requireReady();
      this._require(packet.session === this._sessionId, 'Received a message from a different room session.');
      if (packet.type === 'start') {
        if (packet.round <= this._round && (packet.match === this._matchId || this._retiredMatches.has(packet.match))) return;
        this._require(!this.isHost && packet.round === this._round + 1 && /^[a-f0-9]{32}$/.test(packet.match) && (!this._state || (this._state.phase === 'finished' && this._rematchVotes.every(Boolean))), 'Invalid match start.');
        this._begin(packet.match, packet.round);
        return;
      }
      if (this._retiredMatches.has(packet.match)) return;
      this._require(this._state && packet.match === this._matchId, 'Received a message for a different match.');
      if (['delivery', 'delivery-ready', 'shot'].includes(packet.type) && Number.isInteger(packet.seq) && packet.seq <= this._state.ball) return;
      switch (packet.type) {
        case 'delivery': {
          if (this._pending && packet.seq === this._pending.seq && this._state.batter === this.seat) return;
          this._require(this._state.phase === 'playing' && this._state.batter === this.seat && !this._pending && packet.seq === this._state.ball + 1 && DELIVERY_TYPES.includes(packet.deliveryType) && Number.isInteger(packet.seed) && packet.seed >= 0 && packet.seed <= 0xffffffff && validBowling(packet), 'Invalid or repeated delivery.');
          this._pending = { seq: packet.seq, type: packet.deliveryType, seed: packet.seed, line: packet.line, length: packet.length, speed: packet.speed, acknowledged: true, shooting: false };
          this._watchBall();
          this._send('delivery-ready', { match: this._matchId, seq: packet.seq });
          this._emit('onDelivery', this._deliveryView());
          break;
        }
        case 'delivery-ready': {
          if (this._pending && this._pending.acknowledged && packet.seq === this._pending.seq) return;
          this._require(this._state.batter !== this.seat && this._pending && !this._pending.acknowledged && packet.seq === this._pending.seq, 'Invalid delivery acknowledgement.');
          this._pending.acknowledged = true;
          this._emit('onDelivery', this._deliveryView());
          break;
        }
        case 'shot': {
          this._require(this._state.phase === 'playing' && this._state.batter !== this.seat && this._pending && this._pending.acknowledged && packet.seq === this._pending.seq && this._validShot(packet) && /^[a-f0-9]{64}$/.test(packet.result), 'Invalid or repeated shot.');
          const delivery = { type: this._pending.type, seed: this._pending.seed, line: this._pending.line, length: this._pending.length, speed: this._pending.speed, timing: packet.timing, angle: packet.angle, power: packet.power };
          const next = global.CricketEngine.applyDelivery(this._state, delivery);
          this._require(await hash(next) === packet.result, 'The score did not match on both browsers. Create a fresh room.');
          if (this._closed) return;
          this._emit('onShot', { timing: packet.timing, angle: packet.angle, power: packet.power });
          this._finishBall(next);
          break;
        }
        case 'advance': {
          if (packet.seq === this._lastAdvanceSeq) return;
          this._require(!this.isHost && !this._pending && this._state.phase === 'innings-break' && packet.seq === this._state.ball, 'Invalid innings transition.');
          this._state = global.CricketEngine.startNextInnings(this._state);
          this._lastAdvanceSeq = packet.seq;
          this._showMatch();
          break;
        }
        case 'rematch': {
          this._require(this._state.phase === 'finished', 'Invalid rematch request.');
          if (this._rematchVotes[1 - this.seat]) return;
          this._rematchVotes[1 - this.seat] = true;
          this._lobby();
          if (this.isHost && this._rematchVotes.every(Boolean)) this._startMatch();
          break;
        }
        default: throw new Error('Received an unknown game message. Reload both browsers.');
      }
    }

    start() {
      this._requireReady();
      this._require(this.isHost && !this._state, 'Only the host can start the first match. Use Rematch after a result.');
      this._startMatch();
    }
    _startMatch() {
      const id = randomHex(16);
      const round = this._round + 1;
      this._send('start', { match: id, round });
      this._begin(id, round);
    }
    _begin(id, round) {
      clearTimeout(this._ballTimer);
      if (this._matchId) this._retiredMatches.add(this._matchId);
      if (this._retiredMatches.size > 30) this._retiredMatches.delete(this._retiredMatches.values().next().value);
      this._matchId = id;
      this._round = round;
      this._pending = null;
      this._lastAdvanceSeq = null;
      this._rematchVotes = [false, false];
      this._state = global.CricketEngine.createMatch({ names: this.players.slice(), ...this._settings });
      this._lobby();
      this._showMatch();
    }

    async bowl(type, options = {}) {
      this._requireReady();
      this._require(this._state && this._state.phase === 'playing' && this._state.batter !== this.seat, 'It is not your turn to bowl.');
      this._require(!this._pending, 'Wait for this delivery to finish.');
      this._require(DELIVERY_TYPES.includes(type), 'Choose Pace, Spin or Yorker.');
      this._require(options && typeof options === 'object' && !Array.isArray(options), 'Choose a valid delivery line, length and speed.');
      const bowling = {line: options.line === undefined ? 0 : options.line, length: options.length === undefined ? .6 : options.length, speed: options.speed === undefined ? .65 : options.speed};
      this._require(validBowling(bowling), 'Choose line from -1 to 1, length from 0 to 1 and speed from .25 to 1.');
      const seed = global.crypto.getRandomValues(new Uint32Array(1))[0];
      this._pending = { seq: this._state.ball + 1, type, seed, ...bowling, acknowledged: false, shooting: false };
      this._watchBall();
      this._send('delivery', { match: this._matchId, seq: this._pending.seq, deliveryType: type, seed, ...bowling });
    }
    _deliveryView() { return { type: this._pending.type, seed: this._pending.seed, line: this._pending.line, length: this._pending.length, speed: this._pending.speed, id: this._matchId + ':' + this._pending.seq }; }
    _validShot(shot) { return (shot.timing === null || (Number.isFinite(shot.timing) && shot.timing >= -3000 && shot.timing <= 3000)) && Number.isFinite(shot.angle) && shot.angle >= -Math.PI && shot.angle <= Math.PI && Number.isFinite(shot.power) && shot.power >= 0 && shot.power <= 1; }

    async swing(shot) {
      this._requireReady();
      this._require(this._state && this._state.phase === 'playing' && this._state.batter === this.seat && this._pending && this._pending.acknowledged, 'There is no ball for you to hit yet.');
      this._require(!this._pending.shooting, 'This shot has already been played.');
      this._require(shot && this._validShot(shot), 'The shot timing or direction is invalid.');
      const pending = this._pending;
      const generation = this._generation;
      pending.shooting = true;
      try {
        const delivery = { type: pending.type, seed: pending.seed, line: pending.line, length: pending.length, speed: pending.speed, timing: shot.timing, angle: shot.angle, power: shot.power };
        const next = global.CricketEngine.applyDelivery(this._state, delivery);
        const result = await hash(next);
        this._requireReady();
        this._require(generation === this._generation && this._pending === pending, 'The match has closed.');
        this._send('shot', { match: this._matchId, seq: pending.seq, timing: shot.timing, angle: shot.angle, power: shot.power, result });
        this._finishBall(next);
      } catch (error) { if (!this._closed) this._fail(error.message); throw error; }
    }
    _finishBall(next) {
      clearTimeout(this._ballTimer);
      this._pending = null;
      this._state = next;
      this._showMatch();
    }
    _watchBall() {
      clearTimeout(this._ballTimer);
      this._ballTimer = setTimeout(() => this._fail('This delivery timed out. Keep both game tabs open, then create or join a fresh room.'), 12000);
    }

    continueInnings() {
      this._requireReady();
      this._require(this.isHost && this._state && this._state.phase === 'innings-break' && !this._pending, 'Only the host can start the next innings.');
      this._send('advance', { match: this._matchId, seq: this._state.ball });
      this._state = global.CricketEngine.startNextInnings(this._state);
      this._lastAdvanceSeq = this._state.ball;
      this._showMatch();
    }
    rematch() {
      this._requireReady();
      this._require(this._state && this._state.phase === 'finished', 'Finish the current match first.');
      if (this._rematchVotes[this.seat]) return;
      this._rematchVotes[this.seat] = true;
      this._send('rematch', { match: this._matchId });
      this._lobby();
      if (this.isHost && this._rematchVotes.every(Boolean)) this._startMatch();
    }

    _fail(message) {
      if (this._closed) return;
      this._closed = true;
      this._connected = false;
      clearTimeout(this._joinTimer);
      clearTimeout(this._ballTimer);
      this._pending = null;
      if (this._cancelOpen) this._cancelOpen(new Error(message));
      if (this._cancelJoin) this._cancelJoin(new Error(message));
      this._cancelJoin = null;
      this._joinResolve = null;
      if (this._conn) this._conn.close();
      if (this.peer) this.peer.destroy();
      this._status('disconnected');
      this._lobby();
      this._emit('onError', message);
    }
    leave(notify = true) {
      this._generation++;
      this._closed = true;
      this._connected = false;
      clearTimeout(this._joinTimer);
      clearTimeout(this._ballTimer);
      if (this._cancelOpen) this._cancelOpen(new Error('Room closed.'));
      if (this._cancelJoin) this._cancelJoin(new Error('Room closed.'));
      this._cancelOpen = null;
      this._cancelJoin = null;
      this._joinResolve = null;
      if (this._conn) this._conn.close();
      if (this.peer) this.peer.destroy();
      this.peer = null;
      this._conn = null;
      this._state = null;
      this._pending = null;
      this._sessionId = '';
      this._settings = null;
      this._matchId = '';
      this._retiredMatches.clear();
      this._lastAdvanceSeq = null;
      this._round = 0;
      this._rematchVotes = [false, false];
      this._queue = Promise.resolve();
      this.players = [];
      this.code = '';
      this.seat = null;
      this.isHost = false;
      this.status = 'setup';
      if (notify) { this._status('setup'); this._lobby(); }
    }
  }

  global.CricketRoom = CricketRoom;
})(window);

