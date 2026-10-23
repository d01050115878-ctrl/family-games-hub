/* =========================================================
   꿀꺽 뱀 대결 - 온라인 대전 서버 (WebSocket)
   서버가 게임을 직접 계산하고, 접속한 사람들에게 화면 정보를 보내준다.
   ========================================================= */
const { WebSocketServer } = require('ws');
const Engine = require('./public/snake-battle/engine.js');

const MATCH_TIME = 120;
const TICK = 1 / 30;
const MAX_HUMANS = 8;
const TOTAL_SNAKES = 20;
const START_LEVEL = 5;
const BOT_NAMES = ['꼬물이', '뱀뱀이', '쭉쭉이', '알록이', '스르륵', '반짝이', '도톰이', '쑥쑥이', '말랑이', '콩콩이',
  '방울이', '통통이', '삐약이', '하늘이', '바다', '초코', '젤리', '쿠키', '망고', '두부'];
const SKIN_IDS = ['tree', 'garter', 'corn', 'field', 'sand', 'racer', 'python', 'coral', 'milk', 'rattle',
  'seakrait', 'emerald', 'cobra', 'mamba', 'albino', 'viper', 'gold', 'crystal', 'lava', 'nebula'];

const rooms = new Map();
let cidSeq = 1;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

function newCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

class Room {
  constructor(priv) {
    this.code = newCode();
    this.priv = priv;
    this.clients = new Set();
    this.host = null;
    this.state = 'wait';
    this.world = null;
    this.loop = null;
    this.tm = 0;
    this.tick = 0;
    this.botT = 0;
    rooms.set(this.code, this);
  }

  humans() { return this.clients.size; }

  info() {
    return {
      t: 'room', code: this.code, priv: this.priv, state: this.state, host: this.host ? this.host.cid : 0,
      players: [...this.clients].map((c) => ({ id: c.cid, name: c.name, skin: c.skin })),
    };
  }

  bcast(o) {
    const s = JSON.stringify(o);
    for (const c of this.clients) if (c.ws.readyState === 1) c.ws.send(s);
  }

  add(c) {
    this.clients.add(c);
    c.room = this;
    if (!this.host) this.host = c;
    this.bcast(this.info());
    if (this.state === 'play') this.spawn(c, true);
  }

  remove(c) {
    this.clients.delete(c);
    c.room = null;
    // 나간 사람의 뱀은 컴퓨터가 대신 조종
    if (this.world && c.sid) {
      const s = this.world.get(c.sid);
      if (s && s.alive && !s.dying) { s.isBot = true; s.isHuman = false; s.aggro = 0.5; }
    }
    c.sid = 0;
    if (this.host === c) this.host = [...this.clients][0] || null;
    if (!this.clients.size) this.close();
    else this.bcast(this.info());
  }

  close() {
    clearInterval(this.loop);
    this.loop = null;
    rooms.delete(this.code);
  }

  start() {
    this.world = new Engine.World({ radius: 2800, foodTarget: 700, foodValue: 1, skinEvery: 20, giftMax: 3 });
    this.state = 'play';
    this.tm = MATCH_TIME;
    this.tick = 0;
    this.botT = 0;
    for (const c of this.clients) this.spawn(c, false);
    this.fillBots();
    this.world.takeDelta();
    for (const c of this.clients) this.sendStart(c);
    this.bcast(this.info());
    clearInterval(this.loop);
    this.loop = setInterval(() => this.step(), TICK * 1000);
  }

  spawn(c, late) {
    const p = this.world.spawnPoint(500);
    const s = this.world.addSnake({
      name: c.name, skin: c.skin, level: START_LEVEL, isHuman: true, x: p.x, y: p.y, speed: 290,
    });
    c.sid = s.id;
    c.best = START_LEVEL;
    if (late) this.sendStart(c);
  }

  sendStart(c) {
    const w = this.world;
    send(c.ws, {
      t: 'start', R: w.R, you: c.sid, tm: Math.round(this.tm * 10), priv: this.priv, code: this.code,
      metas: w.allMeta(), foods: w.allFoods(), sn: w.snapshot(),
    });
  }

  fillBots() {
    const w = this.world;
    const elapsed = MATCH_TIME - this.tm;
    const used = new Set(w.snakes.map((s) => s.name));
    while (w.snakes.filter((s) => !s.dying).length < TOTAL_SNAKES) {
      const names = BOT_NAMES.filter((n) => !used.has(n));
      const name = names.length ? pick(names) : '뱀';
      used.add(name);
      const p = w.spawnPoint(600);
      const base = 3 + elapsed * 0.6;
      w.addSnake({
        name, skin: pick(SKIN_IDS), isBot: true, x: p.x, y: p.y,
        level: Math.max(2, base * (0.3 + Math.random() * 1.1)), speed: 258 + Math.random() * 18,
        aggro: 0.45 + Math.random() * 0.3, humanBias: 40,
      });
    }
  }

  step() {
    const w = this.world;
    w.step(TICK);
    this.tm -= TICK;
    this.tick++;
    for (const c of this.clients) {
      const s = c.sid && w.get(c.sid);
      if (s && s.level > c.best) c.best = s.level;
    }
    this.botT -= TICK;
    if (this.botT <= 0 && this.tm > 20) { this.botT = 1.5; this.fillBots(); }
    if (this.tick % 2 === 0) {
      const d = w.takeDelta();
      this.bcast({
        t: 's', st: Date.now(), tm: Math.round(this.tm * 10), sn: w.snapshot(),
        fa: d.fa, fr: d.fr, m: d.m, ev: d.ev,
      });
    }
    if (this.tm <= 0) this.end();
  }

  end() {
    clearInterval(this.loop);
    this.loop = null;
    const w = this.world;
    const bySid = new Map();
    for (const c of this.clients) if (c.sid) bySid.set(c.sid, c);
    const alive = w.snakes.filter((s) => s.alive && !s.dying).sort((a, b) => b.level - a.level);
    const rank = alive.map((s) => {
      const c = bySid.get(s.id);
      return { name: s.name, lv: Math.floor(s.level), human: s.isHuman, alive: true, cid: c ? c.cid : 0 };
    });
    // 먹혀서 탈락한 사람도 최고 레벨로 순위에 넣기
    const out = [...this.clients].filter((c) => !alive.some((s) => s.id === c.sid))
      .sort((a, b) => b.best - a.best)
      .map((c) => ({ name: c.name, lv: Math.floor(c.best), human: true, alive: false, cid: c.cid }));
    this.bcast({ t: 'end', rank: rank.concat(out) });
    this.world = null;
    for (const c of this.clients) c.sid = 0;
    if (this.priv) {
      this.state = 'wait';
      this.bcast(this.info());
    } else {
      for (const c of [...this.clients]) { this.clients.delete(c); c.room = null; }
      this.close();
    }
  }
}

function quickMatch(c) {
  for (const r of rooms.values()) {
    if (!r.priv && r.state === 'play' && r.tm > 40 && r.humans() < MAX_HUMANS) { r.add(c); return; }
  }
  const r = new Room(false);
  r.add(c);
  r.start();
}

module.exports = function attachSnakeServer(server) {
  const wss = new WebSocketServer({ server, path: '/snake-ws' });

  wss.on('connection', (ws) => {
    const c = { ws, cid: cidSeq++, name: '플레이어', skin: 'tree', room: null, sid: 0, best: 0, alive: true };
    send(ws, { t: 'welcome', cid: c.cid });
    ws.on('pong', () => { c.alive = true; });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      const r = c.room;
      switch (m.t) {
        case 'hello':
          c.name = String(m.name || '플레이어').trim().slice(0, 8) || '플레이어';
          if (typeof m.skin === 'string' && SKIN_IDS.includes(m.skin)) c.skin = m.skin;
          break;
        case 'quick':
          if (r) r.remove(c);
          quickMatch(c);
          break;
        case 'create': {
          if (r) r.remove(c);
          const nr = new Room(true);
          nr.add(c);
          break;
        }
        case 'join': {
          const target = rooms.get(String(m.code));
          if (!target || !target.priv) { send(ws, { t: 'err', msg: '그런 번호의 방이 없어요' }); break; }
          if (target.humans() >= MAX_HUMANS) { send(ws, { t: 'err', msg: '방이 꽉 찼어요' }); break; }
          if (r && r !== target) r.remove(c);
          if (r !== target) target.add(c);
          break;
        }
        case 'start':
          if (r && r.host === c && r.state === 'wait') r.start();
          break;
        case 'in':
          if (r && r.world && c.sid && typeof m.a === 'number' && Number.isFinite(m.a)) {
            const s = r.world.get(c.sid);
            if (s) s.want = m.a;
          }
          break;
        case 'respawn':
          if (r && r.world && r.tm > 15) {
            const s = c.sid && r.world.get(c.sid);
            if (!s || s.dying) r.spawn(c, true);
          }
          break;
        case 'leave':
          if (r) r.remove(c);
          break;
        default:
          break;
      }
    });

    ws.on('close', () => { if (c.room) c.room.remove(c); });
  });

  // 끊어진 연결 정리
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAliveFlag === false) { ws.terminate(); continue; }
      ws.isAliveFlag = false;
      ws.ping();
    }
  }, 25000);
  wss.on('connection', (ws) => { ws.isAliveFlag = true; ws.on('pong', () => { ws.isAliveFlag = true; }); });
  wss.on('close', () => clearInterval(hb));
};
