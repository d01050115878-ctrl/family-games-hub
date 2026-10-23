/* =========================================================
   꿀꺽 뱀 대결 - 게임 엔진 (브라우저 / 서버 공용)
   - 레벨이 높은 뱀이 낮은 뱀의 머리를 물면 통째로 삼킨다
   - 레벨이 같거나 높으면 상대 몸통을 물어 레벨을 빨아온다
   - 레벨이 낮은 쪽이 몸통에 부딪히면 튕겨나간다
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  };

  const widthOf = (L) => 16 + 5.5 * Math.cbrt(Math.max(1, L));
  const lengthOf = (L) => widthOf(L) * Math.min(42, 4 + 1.5 * Math.sqrt(Math.max(1, L)));
  const turnOf = (L) => Math.max(3.2, 7.4 - 0.4 * Math.log2(Math.max(1, L)));
  const TRAIL_STEP = 5;
  // 먹이 종류: 0 먹이, 1 선물상자(스킨), 2~8 아이템
  const ITEM = { SKIN: 1, MAGNET: 2, SPEED: 3, SHIELD: 4, DOUBLE: 5, BOMB: 6, STAR: 7, ICE: 8 };
  const ITEM_TIME = { 2: 10, 3: 6, 4: 8, 5: 10 };
  const ITEM_WEIGHTS = [[2, 3], [3, 3], [4, 2], [5, 2], [6, 2], [7, 2], [8, 1.5]];
  const MAGNET_RANGE = 230;
  function pickItem() {
    let t = 0;
    for (const [, w] of ITEM_WEIGHTS) t += w;
    let r = Math.random() * t;
    for (const [k, w] of ITEM_WEIGHTS) { r -= w; if (r <= 0) return k; }
    return 2;
  }
  const DIE_TIME = 0.45;

  // 머리부터 꼬리 방향으로 경로를 일정 간격으로 샘플링 (평탄 배열 [x0,y0,x1,y1,...])
  function samplePath(trail, total, spacing) {
    const n = trail.length;
    const out = [trail[n - 1][0], trail[n - 1][1]];
    let dist = 0, next = spacing;
    for (let i = n - 1; i > 0; i--) {
      const ax = trail[i][0], ay = trail[i][1], bx = trail[i - 1][0], by = trail[i - 1][1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg === 0) continue;
      while (next <= dist + seg && next <= total) {
        const t = (next - dist) / seg;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
        next += spacing;
      }
      dist += seg;
      if (dist >= total) break;
    }
    return out;
  }

  function World(opt) {
    opt = opt || {};
    this.R = opt.radius || 1400;
    this.foodTarget = opt.foodTarget || 200;
    this.foodValue = opt.foodValue || 1;
    this.skinEvery = opt.skinEvery || 0;
    this.skinT = this.skinEvery * 0.5;
    this.itemTarget = opt.itemTarget || 0;
    this.itemT = 0;
    this.items = 0;
    this.snakes = [];
    this.foods = new Map();
    this.orbs = 0;
    this.seq = 1;
    this.time = 0;
    this.events = [];
    this.fa = [];
    this.fr = [];
    this.newMeta = [];
  }

  const W = World.prototype;

  W.randPoint = function (margin) {
    const a = rand(0, TAU), r = Math.sqrt(Math.random()) * (this.R - margin);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };

  // 다른 뱀들과 최대한 떨어진 출발 지점
  W.spawnPoint = function (minD, avoid) {
    let best = null, bestD = -1;
    for (let i = 0; i < 30; i++) {
      const p = this.randPoint(200);
      let near = Infinity;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        const k = avoid && s === avoid ? 2 : 1;
        near = Math.min(near, Math.hypot(s.x - p.x, s.y - p.y) / k);
      }
      if (near >= minD) return p;
      if (near > bestD) { bestD = near; best = p; }
    }
    return best;
  };

  // ox, oy: 튀어나오는 출발 위치 (팡! 효과용)
  W.addFood = function (x, y, v, k, ox, oy) {
    const id = this.seq++;
    const f = { id, x, y, v, k: k || 0, born: this.time };
    if (ox !== undefined) { f.ox = ox; f.oy = oy; }
    this.foods.set(id, f);
    if (!k) this.orbs++;
    else if (k >= 2) this.items++;
    const rec = [id, Math.round(x), Math.round(y), v, k || 0];
    if (ox !== undefined) rec.push(Math.round(ox), Math.round(oy));
    this.fa.push(rec);
    return id;
  };

  W.removeFood = function (id) {
    const f = this.foods.get(id);
    if (!f) return;
    if (!f.k) this.orbs--;
    else if (f.k >= 2) this.items--;
    this.foods.delete(id);
    this.fr.push(id);
  };

  W.spawnFood = function () {
    const p = this.randPoint(40);
    const r = Math.random();
    const m = r < 0.03 ? 8 : r < 0.17 ? 3 : 1;
    this.addFood(p.x, p.y, m * this.foodValue, 0);
  };

  W.clearFoods = function () {
    for (const id of Array.from(this.foods.keys())) this.removeFood(id);
  };

  W.addSnake = function (o) {
    const id = this.seq++;
    const level = Math.max(1, o.level || 1);
    const dir = o.dir !== undefined ? o.dir : rand(0, TAU);
    const s = {
      id, name: o.name || '뱀', skin: o.skin || 'basic', level, best: level,
      x: o.x || 0, y: o.y || 0, dir, want: dir,
      speed: o.speed || 210, foodMul: o.foodMul || 1,
      isBot: !!o.isBot, isBoss: !!o.isBoss, isHuman: !!o.isHuman,
      aggro: o.aggro !== undefined ? o.aggro : 0.6, chase: o.chase || 480, humanBias: o.humanBias || 0,
      think: rand(0, 0.3), bounceT: 0, latch: 0, dying: null, alive: true, fxT: 0,
      fx: { 2: 0, 3: 0, 4: 0, 5: 0, slow: 0 },
      trail: [], body: [], kills: 0,
    };
    this.resetTrail(s);
    this.snakes.push(s);
    this.newMeta.push(this.meta(s));
    return s;
  };

  // 출발할 때는 몸을 둘둘 만 채로 시작 (경기장 밖으로 몸이 삐져나오지 않게)
  W.resetTrail = function (s) {
    const L = lengthOf(s.level) + TRAIL_STEP, w = widthOf(s.level);
    const a = w * 0.7, b = w * 1.05 / TAU;
    const pts = [[a, 0]];
    let th = 0, len = 0, px = a, py = 0;
    while (len < L) {
      th += TRAIL_STEP / Math.max(a + b * th, 1);
      const r = a + b * th, nx = Math.cos(th) * r, ny = Math.sin(th) * r;
      len += Math.hypot(nx - px, ny - py);
      px = nx; py = ny;
      pts.push([px, py]);
    }
    const n = pts.length;
    const tang = Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0]);
    const rot = s.dir - tang, c = Math.cos(rot), si = Math.sin(rot);
    const hx = pts[n - 1][0], hy = pts[n - 1][1];
    s.trail = pts.map(([x, y]) => {
      const dx = x - hx, dy = y - hy;
      return [s.x + dx * c - dy * si, s.y + dx * si + dy * c];
    });
    s.body = samplePath(s.trail, lengthOf(s.level), w * 0.45);
  };

  W.meta = function (s) {
    return [s.id, s.name, s.skin, (s.isBot ? 1 : 0) | (s.isBoss ? 2 : 0) | (s.isHuman ? 4 : 0)];
  };

  W.get = function (id) {
    for (const s of this.snakes) if (s.id === id) return s;
    return null;
  };

  W.step = function (dt) {
    this.time += dt;
    const live = this.snakes.filter((s) => s.alive && !s.dying);
    for (const s of live) {
      for (const k in s.fx) if (s.fx[k] > 0) s.fx[k] -= dt;
      if (s.isBot) {
        s.think -= dt;
        if (s.think <= 0) { this.think(s); s.think = rand(0.12, 0.24); }
      }
      this.move(s, dt);
    }
    for (const s of live) this.eat(s);
    this.collide(live, dt);
    for (const s of this.snakes) if (s.dying) this.updateDying(s, dt);
    this.snakes = this.snakes.filter((s) => s.alive);
    while (this.orbs < this.foodTarget) this.spawnFood();
    if (this.items < this.itemTarget) {
      this.itemT -= dt;
      if (this.itemT <= 0) {
        this.itemT = this.items < this.itemTarget / 2 ? 0.15 : rand(1.5, 3);
        const p = this.randPoint(120);
        this.addFood(p.x, p.y, 0, pickItem());
      }
    }
    if (this.skinEvery > 0) {
      let has = false;
      for (const f of this.foods.values()) if (f.k === 1) { has = true; break; }
      if (!has) {
        this.skinT -= dt;
        if (this.skinT <= 0) {
          this.skinT = this.skinEvery;
          const p = this.randPoint(150);
          this.addFood(p.x, p.y, 0, 1);
        }
      }
    }
  };

  W.move = function (s, dt) {
    if (s.bounceT > 0) s.bounceT -= dt;
    else {
      const d = angDiff(s.want, s.dir), m = turnOf(s.level) * dt * (s.isHuman ? 1.3 : 1);
      s.dir += clamp(d, -m, m);
    }
    const sp = s.speed * (s.latch ? 0.8 : 1) * (s.bounceT > 0 ? 0.75 : 1) *
      (s.fx[3] > 0 ? 1.6 : 1) * (s.fx.slow > 0 ? 0.45 : 1);
    s.x += Math.cos(s.dir) * sp * dt;
    s.y += Math.sin(s.dir) * sp * dt;
    const w = widthOf(s.level);
    const lim = this.R - w / 2, d = Math.hypot(s.x, s.y);
    if (d > lim) {
      s.x *= lim / d; s.y *= lim / d;
      if (s.isBot) s.want = Math.atan2(-s.y, -s.x) + rand(-0.5, 0.5);
    }
    const tr = s.trail, n = tr.length;
    const prev = tr[n - 2];
    if (!prev || Math.hypot(s.x - prev[0], s.y - prev[1]) >= TRAIL_STEP) tr.push([s.x, s.y]);
    else tr[n - 1] = [s.x, s.y];
    // 길이를 넘는 오래된 경로 잘라내기
    const L = lengthOf(s.level) + 20;
    let acc = 0;
    for (let i = tr.length - 1; i > 0; i--) {
      acc += Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]);
      if (acc > L) { if (i > 1) tr.splice(0, i - 1); break; }
    }
    s.body = samplePath(tr, lengthOf(s.level), w * 0.45);
  };

  W.eat = function (s) {
    const r = widthOf(s.level) * 0.5 + 14, r2 = r * r;
    const mr = s.fx[2] > 0 ? r + MAGNET_RANGE : 0, mr2 = mr * mr;
    const dbl = s.fx[5] > 0 ? 2 : 1;
    for (const f of this.foods.values()) {
      const dx = f.x - s.x, dy = f.y - s.y, d2 = dx * dx + dy * dy;
      if (d2 > r2 && !(f.k === 0 && d2 < mr2)) continue;
      if (f.k === ITEM.SKIN) {
        if (!s.isHuman) continue;
        this.events.push({ e: 'skin', id: s.id });
      } else if (f.k >= 2) {
        this.applyItem(s, f);
      } else {
        this.grow(s, f.v * s.foodMul * dbl);
        if (d2 > r2) this.events.push({ e: 'mg', a: s.id, x: Math.round(f.x), y: Math.round(f.y) });
      }
      this.removeFood(f.id);
    }
  };

  W.applyItem = function (s, f) {
    const k = f.k;
    if (ITEM_TIME[k]) s.fx[k] = ITEM_TIME[k];
    else if (k === ITEM.BOMB) {
      for (let i = 0; i < 24; i++) {
        const a = rand(0, TAU), d = rand(70, 280);
        let x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
        const dd = Math.hypot(x, y), lim = this.R - 40;
        if (dd > lim) { x *= lim / dd; y *= lim / dd; }
        this.addFood(x, y, this.foodValue * (Math.random() < 0.3 ? 3 : 1), 0, f.x, f.y);
      }
    } else if (k === ITEM.STAR) {
      this.grow(s, Math.max(5 * this.foodValue, s.level * 0.15));
    } else if (k === ITEM.ICE) {
      for (const o of this.snakes) {
        if (o === s || !o.alive || o.dying) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) < 700) o.fx.slow = 3.5;
      }
    }
    this.events.push({ e: 'item', id: s.id, k, x: Math.round(f.x), y: Math.round(f.y) });
  };

  W.grow = function (s, v) {
    s.level += v;
    if (s.level > s.best) s.best = s.level;
  };

  W.collide = function (live, dt) {
    for (const A of live) A.latch = 0;
    for (const A of live) {
      if (A.dying) continue;
      const rA = widthOf(A.level) / 2;
      for (const B of live) {
        if (A.dying) break;
        if (B === A || B.dying) continue;
        const rB = widthOf(B.level) / 2;
        const reach = lengthOf(B.level) + rA + rB + 20;
        if (Math.abs(B.x - A.x) > reach || Math.abs(B.y - A.y) > reach) continue;
        // 머리끼리
        if (Math.hypot(B.x - A.x, B.y - A.y) < (rA + rB) * 0.85) {
          const diff = A.level - B.level;
          if (diff >= 1 && !(B.fx[4] > 0)) this.swallow(A, B, false);
          else if (diff <= -1 && !(A.fx[4] > 0)) this.swallow(B, A, false);
          else { this.bounce(A, B.x, B.y); this.bounce(B, A.x, A.y); }
          continue;
        }
        // 내 머리 → 상대 몸통
        const pts = B.body, lim = rA + rB * 0.8, lim2 = lim * lim;
        for (let k = 4; k < pts.length; k += 2) {
          const dx = pts[k] - A.x, dy = pts[k + 1] - A.y;
          if (dx * dx + dy * dy < lim2) {
            if (A.level >= B.level && !(B.fx[4] > 0)) { A.latch = B.id; this.drain(A, B, dt, pts[k], pts[k + 1]); }
            else this.bounce(A, pts[k], pts[k + 1]);
            break;
          }
        }
      }
    }
  };

  W.drain = function (A, B, dt, x, y) {
    const rate = Math.max(3, B.level * 0.3);
    const d = Math.min(rate * dt, B.level - 1);
    B.level -= d;
    this.grow(A, d * 0.7);
    A.fxT -= dt;
    if (A.fxT <= 0) {
      A.fxT = 0.12;
      this.events.push({ e: 'bite', a: A.id, b: B.id, x: Math.round(x), y: Math.round(y) });
    }
    if (B.level <= 1.05) this.swallow(A, B, true);
  };

  W.swallow = function (A, B, drained) {
    if (A.dying || B.dying) return;
    const lv = B.level;
    this.grow(A, lv * (drained ? 0.6 : 0.4));
    A.kills++;
    B.dying = { by: A.id, t: 0, body0: B.body.slice() };
    this.popBody(B, lv);
    this.events.push({ e: 'eat', a: A.id, b: B.id, x: Math.round(B.x), y: Math.round(B.y), lv: Math.floor(lv) });
  };

  W.popBody = function (B, lv) {
    const b = B.body, segs = Math.max(1, (b.length >> 1) - 1);
    const n = Math.min(30, 6 + Math.floor(segs / 2));
    const v = Math.max(this.foodValue, Math.round(lv * 0.35 / n));
    const lim = this.R - 40;
    for (let i = 0; i < n; i++) {
      const k = Math.floor((i / n) * segs) * 2;
      const ox = b[k], oy = b[k + 1];
      const a = rand(0, TAU), d = rand(40, 170);
      let x = ox + Math.cos(a) * d, y = oy + Math.sin(a) * d;
      const dd = Math.hypot(x, y);
      if (dd > lim) { x *= lim / dd; y *= lim / dd; }
      this.addFood(x, y, v, 0, ox, oy);
    }
    if (Math.random() < 0.5) {
      const a = rand(0, TAU);
      this.addFood(B.x + Math.cos(a) * 90, B.y + Math.sin(a) * 90, 0, pickItem(), B.x, B.y);
    }
  };

  W.bounce = function (A, fx, fy) {
    const a = Math.atan2(A.y - fy, A.x - fx);
    A.dir = a; A.want = a; A.bounceT = 0.28;
    A.x += Math.cos(a) * 4; A.y += Math.sin(a) * 4;
    if (A.isHuman) this.events.push({ e: 'bump', a: A.id });
  };

  W.updateDying = function (s, dt) {
    const d = s.dying;
    d.t += dt;
    const eater = this.get(d.by);
    const ex = eater ? eater.x : s.x, ey = eater ? eater.y : s.y;
    const q = Math.pow(Math.min(1, d.t / DIE_TIME), 2);
    const b = d.body0;
    s.body = b.map((v, i) => v + ((i % 2 ? ey : ex) - v) * q);
    s.x = s.body[0]; s.y = s.body[1];
    if (d.t >= DIE_TIME) s.alive = false;
  };

  /* ---------- 인공지능 ---------- */
  W.think = function (s) {
    const w = widthOf(s.level);
    let threat = null, td = Infinity, target = null, ts = -Infinity;
    for (const o of this.snakes) {
      if (o === s || !o.alive || o.dying) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > 1200) continue;
      if (o.level >= s.level + 1 && d < 200 + w * 4 + widthOf(o.level) * 2 && d < td) { threat = o; td = d; }
      if (s.level >= o.level + 1 && d < s.chase) {
        const sc = o.level * 15 - d + (o.isHuman ? s.humanBias : 0);
        if (sc > ts) { ts = sc; target = { x: o.x + Math.cos(o.dir) * 60, y: o.y + Math.sin(o.dir) * 60 }; }
      } else if (s.level >= o.level && d < s.chase * 0.8 && o.body.length > 8) {
        const b = o.body, k = Math.min(b.length - 2, (b.length >> 2) * 2);
        const sc = o.level * 8 - d * 1.2 + (o.isHuman ? s.humanBias : 0);
        if (sc > ts) { ts = sc; target = { x: b[k], y: b[k + 1] }; }
      }
    }
    if (threat) {
      s.want = Math.atan2(s.y - threat.y, s.x - threat.x) + rand(-0.4, 0.4);
    } else if (target && Math.random() < s.aggro) {
      s.want = Math.atan2(target.y - s.y, target.x - s.x);
    } else {
      let best = null, bs = -Infinity;
      for (const f of this.foods.values()) {
        if (f.k === ITEM.SKIN) continue;
        const d = Math.abs(f.x - s.x) + Math.abs(f.y - s.y);
        if (d > 700) continue;
        const sc = (f.k ? 150 : f.v / this.foodValue * 25) - d;
        if (sc > bs) { bs = sc; best = f; }
      }
      if (best) s.want = Math.atan2(best.y - s.y, best.x - s.x);
      else s.want += rand(-0.7, 0.7);
    }
    if (Math.hypot(s.x, s.y) > this.R - 200 - w) s.want = Math.atan2(-s.y, -s.x) + rand(-0.4, 0.4);
  };

  /* ---------- 네트워크용 직렬화 ---------- */
  W.snapshot = function () {
    return this.snakes.map((s) => {
      const b = s.body;
      const out = [s.id, Math.round(s.x), Math.round(s.y), Math.round(s.dir * 100), Math.round(s.level * 10),
        this.flags(s)];
      for (let i = 2; i < b.length; i += 4) out.push(Math.round(b[i]), Math.round(b[i + 1]));
      if (b.length > 2 && (b.length - 2) % 4 !== 0) out.push(Math.round(b[b.length - 2]), Math.round(b[b.length - 1]));
      return out;
    });
  };
  W.flags = function (s) {
    const f = s.fx;
    return (s.dying ? 1 : 0) | (s.latch ? 2 : 0) | (f[2] > 0 ? 4 : 0) | (f[3] > 0 ? 8 : 0) |
      (f[4] > 0 ? 16 : 0) | (f[5] > 0 ? 32 : 0) | (f.slow > 0 ? 64 : 0);
  };
  W.allFoods = function () {
    return Array.from(this.foods.values()).map((f) => [f.id, Math.round(f.x), Math.round(f.y), f.v, f.k]);
  };
  W.allMeta = function () { return this.snakes.map((s) => this.meta(s)); };
  W.takeDelta = function () {
    const r = { fa: this.fa, fr: this.fr, m: this.newMeta, ev: this.events };
    this.fa = []; this.fr = []; this.newMeta = []; this.events = [];
    return r;
  };

  return { World, widthOf, lengthOf, samplePath, ITEM, MAGNET_RANGE };
});
