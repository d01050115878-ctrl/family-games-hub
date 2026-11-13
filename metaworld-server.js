/* =========================================================
   모두의 세계여행 - 온라인 대전 서버 (WebSocket, 최대 6명)
   서버가 게임 엔진을 직접 돌리고, 각 플레이어에게 결정을 물어본다.
   접속이 끊긴 사람의 차례는 컴퓨터가 대신 진행하고, 다시 들어오면 이어서 한다.
   ========================================================= */
const { WebSocketServer } = require('ws');
const MW = require('./public/meta-world/engine.js');

const WS_PATH = '/metaworld-ws';
const MAX_SEATS = MW.MAX_PLAYERS;
const ROLL_TIMEOUT = 30000;
const ASK_TIMEOUT = 45000;
const EMPTY_ROOM_TTL = 180000;
const BOT_NAMES = ['구조봇', '출동봇', '순찰봇', '전진봇', '번개봇', '불꽃봇', '든든봇', '씽씽봇'];

const rooms = new Map();      // code → Room
const tokenRoom = new Map();  // token → Room
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || '플레이어';

function newCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

class Room {
  constructor() {
    this.code = newCode();
    this.seats = [];          // { ai, name, token, ws, left }
    this.hostToken = null;
    this.state = 'wait';      // wait | play
    this.maxRounds = 50;
    this.aiLevel = 1;
    this.game = null;
    this.lastSync = null;
    this.pending = new Map();
    this.askSeq = 0;
    this.emptyTimer = null;
    rooms.set(this.code, this);
  }

  freeChar() { const used = new Set(this.seats.map((s) => s.ch)); let k = 0; while (used.has(k)) k++; return k; }
  // 내 말을 다음으로 비어 있는 말로 바꾼다
  nextChar(i) {
    const used = new Set(this.seats.filter((_, j) => j !== i).map((s) => s.ch));
    let k = this.seats[i].ch;
    for (let n = 0; n < MAX_SEATS; n++) { k = (k + 1) % MAX_SEATS; if (!used.has(k)) break; }
    this.seats[i].ch = k;
  }

  seatOf(token) { return this.seats.findIndex((s) => !s.ai && s.token === token); }
  onlineHumans() { return this.seats.filter((s) => !s.ai && s.ws && s.ws.readyState === 1).length; }

  info(forToken) {
    return {
      t: 'room', code: this.code, state: this.state, maxRounds: this.maxRounds, aiLevel: this.aiLevel,
      host: this.seatOf(this.hostToken), you: this.seatOf(forToken),
      seats: this.seats.map((s, i) => ({
        name: s.name, ai: s.ai || s.left, online: s.ai ? true : !!(s.ws && s.ws.readyState === 1),
        ch: s.ch, color: MW.PCOLORS[s.ch], emoji: MW.PEMOJI[s.ch],
      })),
    };
  }
  broadcastInfo() { for (const s of this.seats) if (!s.ai) send(s.ws, this.info(s.token)); }
  broadcast(o) { const raw = JSON.stringify(o); for (const s of this.seats) if (!s.ai && s.ws && s.ws.readyState === 1) s.ws.send(raw); }

  addHuman(c) {
    this.seats.push({ ai: false, name: c.name, token: c.token, ws: c.ws, left: false, ch: this.freeChar() });
    tokenRoom.set(c.token, this);
    c.room = this;
    if (!this.hostToken || this.seatOf(this.hostToken) < 0) this.hostToken = c.token;
    this.touch();
    this.broadcastInfo();
  }

  // 대기실에서 자리 빼기
  removeSeat(i) {
    const s = this.seats[i];
    if (!s) return;
    this.seats.splice(i, 1);
    if (!s.ai) {
      tokenRoom.delete(s.token);
      if (this.hostToken === s.token) {
        const h = this.seats.find((x) => !x.ai);
        this.hostToken = h ? h.token : null;
      }
    }
    if (!this.seats.some((x) => !x.ai)) { this.destroy(); return; }
    this.broadcastInfo();
  }

  // 게임 중 연결이 끊김 → 그 사람의 결정은 컴퓨터가 대신 (다시 접속 가능)
  disconnect(token, permanent) {
    const i = this.seatOf(token);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.state === 'wait') { this.removeSeat(i); return; }
    s.ws = null;
    if (permanent) {
      s.left = true;
      tokenRoom.delete(token);
      if (this.game) this.game.s.players[i].isAI = true;
    }
    for (const [id, e] of this.pending) if (e.seat === i) e.finish(undefined);
    if (this.hostToken === token) {
      const h = this.seats.find((x) => !x.ai && !x.left && x.ws);
      if (h) this.hostToken = h.token;
    }
    this.touch();
    this.broadcastInfo();
  }

  reconnect(c) {
    const i = this.seatOf(c.token);
    const s = this.seats[i];
    if (s.ws && s.ws !== c.ws) { send(s.ws, { t: 'err', msg: '다른 창에서 같은 자리로 접속했어요' }); try { s.ws.close(); } catch (e) { } }
    s.ws = c.ws; c.room = this;
    this.touch();
    this.broadcastInfo();
    if (this.state === 'play' && this.lastSync) {
      send(c.ws, { t: 'ev', ev: { type: 'sync', state: this.lastSync } });
      for (const [id, e] of this.pending) if (e.seat === i) send(c.ws, { t: 'ask', id, req: e.req });
    }
  }

  touch() {
    clearTimeout(this.emptyTimer);
    if (this.onlineHumans() === 0) this.emptyTimer = setTimeout(() => { if (this.onlineHumans() === 0) this.destroy(); }, EMPTY_ROOM_TTL);
  }

  destroy() {
    clearTimeout(this.emptyTimer);
    if (this.game) this.game.abort();
    for (const [, e] of this.pending) e.finish(undefined);
    for (const s of this.seats) if (!s.ai && tokenRoom.get(s.token) === this) tokenRoom.delete(s.token);
    rooms.delete(this.code);
  }

  start() {
    if (this.state !== 'wait' || this.seats.length < 2) return;
    this.state = 'play';
    this.lastSync = null;
    const io = {
      event: (ev) => {
        if (ev.type === 'sync') this.lastSync = ev.state;
        this.broadcast({ t: 'ev', ev });
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ask: (p, req) => new Promise((resolve) => {
        const seat = this.seats[p.id];
        if (!seat || seat.ai || seat.left || !seat.ws || seat.ws.readyState !== 1) return resolve(undefined);
        const id = ++this.askSeq;
        const e = {
          seat: p.id, req,
          finish: (v) => { if (!this.pending.has(id)) return; clearTimeout(e.timer); this.pending.delete(id); resolve(v); },
        };
        e.timer = setTimeout(() => { send(this.seats[p.id] && this.seats[p.id].ws, { t: 'askDone', id }); e.finish(undefined); },
          req.kind === 'roll' ? ROLL_TIMEOUT : ASK_TIMEOUT);
        this.pending.set(id, e);
        send(seat.ws, { t: 'ask', id, req });
      }),
    };
    this.game = new MW.Game(this.seats.map((s) => ({ name: s.name, isAI: s.ai, ch: s.ch })), { maxRounds: this.maxRounds, aiLevel: this.aiLevel }, io);
    this.broadcastInfo();
    const g = this.game;
    g.run().catch((err) => console.error('[metaworld] game error', err)).then(() => {
      if (this.game !== g) return;
      this.game = null;
      this.state = 'wait';
      // 나간 사람 자리는 정리
      for (let i = this.seats.length - 1; i >= 0; i--) {
        const s = this.seats[i];
        if (!s.ai && (s.left || !s.ws)) { tokenRoom.delete(s.token); this.seats.splice(i, 1); }
      }
      if (!this.seats.some((x) => !x.ai)) { this.destroy(); return; }
      if (this.seatOf(this.hostToken) < 0) this.hostToken = this.seats.find((x) => !x.ai).token;
      this.broadcastInfo();
    });
  }
}

function handle(c, m) {
  const r = c.room;
  const isHost = r && r.hostToken === c.token;
  switch (m.t) {
    case 'hello': {
      c.name = cleanName(m.name);
      if (typeof m.token === 'string' && /^[a-z0-9]{8,40}$/i.test(m.token)) c.token = m.token;
      const old = tokenRoom.get(c.token);
      if (old && rooms.has(old.code) && old.seatOf(c.token) >= 0) old.reconnect(c);
      else send(c.ws, { t: 'lobby' });
      break;
    }
    case 'create': {
      if (r) r.disconnect(c.token, true);
      new Room().addHuman(c);
      break;
    }
    case 'join': {
      const target = rooms.get(String(m.code || '').trim());
      if (!target) { send(c.ws, { t: 'err', msg: '그런 번호의 방이 없어요' }); break; }
      if (target.seatOf(c.token) >= 0) { target.reconnect(c); break; }
      if (target.state !== 'wait') { send(c.ws, { t: 'err', msg: '이미 게임이 진행 중인 방이에요' }); break; }
      if (target.seats.length >= MAX_SEATS) { send(c.ws, { t: 'err', msg: '방이 꽉 찼어요 (최대 6명)' }); break; }
      if (r && r !== target) r.disconnect(c.token, true);
      target.addHuman(c);
      break;
    }
    case 'addBot':
      if (isHost && r.state === 'wait' && r.seats.length < MAX_SEATS) {
        const used = new Set(r.seats.map((s) => s.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || `봇${r.seats.length + 1}`;
        r.seats.push({ ai: true, name, ch: r.freeChar() });
        r.broadcastInfo();
      }
      break;
    case 'kick': {
      const i = Number(m.idx);
      if (isHost && r.state === 'wait' && Number.isInteger(i) && r.seats[i] && r.seats[i].token !== c.token) {
        const s = r.seats[i];
        if (!s.ai) send(s.ws, { t: 'kicked' });
        r.removeSeat(i);
      }
      break;
    }
    case 'char': {
      const i = r ? r.seatOf(c.token) : -1;
      if (i >= 0 && r.state === 'wait') { r.nextChar(i); r.broadcastInfo(); }
      break;
    }
    case 'aiLevel':
      if (isHost && r.state === 'wait' && [0, 1, 2].includes(Number(m.v))) { r.aiLevel = Number(m.v); r.broadcastInfo(); }
      break;
    case 'rounds':
      if (isHost && r.state === 'wait' && [0, 20, 30, 40, 50].includes(Number(m.v))) { r.maxRounds = Number(m.v); r.broadcastInfo(); }
      break;
    case 'start':
      if (isHost) r.start();
      break;
    case 'answer': {
      if (!r) break;
      const e = r.pending.get(Number(m.id));
      if (e && e.seat === r.seatOf(c.token)) e.finish(m.value);
      break;
    }
    case 'leave':
      if (r) { r.disconnect(c.token, true); c.room = null; }
      send(c.ws, { t: 'lobby' });
      break;
    default: break;
  }
}

module.exports = function attachMetaWorldServer(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    if (path !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const c = { ws, token: Math.random().toString(36).slice(2) + Date.now().toString(36), name: '플레이어', room: null };
    ws.isAliveFlag = true;
    ws.on('pong', () => { ws.isAliveFlag = true; });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      try { handle(c, m); } catch (err) { console.error('[metaworld] handler error', err); }
    });
    ws.on('close', () => {
      const r = c.room;
      if (r && r.seatOf(c.token) >= 0 && r.seats[r.seatOf(c.token)].ws === ws) r.disconnect(c.token, false);
    });
  });

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAliveFlag === false) { ws.terminate(); continue; }
      ws.isAliveFlag = false;
      ws.ping();
    }
  }, 25000);
  wss.on('close', () => clearInterval(hb));
};
