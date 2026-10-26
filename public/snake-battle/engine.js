/* =========================================================
   꿀꺽 뱀 대결 - 게임 엔진 (브라우저 / 서버 공용)
   - 머리끼리 부딪히면 레벨이 높은 뱀이 낮은 뱀을 통째로 삼킨다
   - 큰 뱀이 작은 뱀의 몸통·꼬리를 물면 물린 자리부터 꼬리까지 먹힌다
   - 작은 뱀이 큰 뱀 몸통에 부딪히거나 레벨이 같으면 튕겨나간다
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

  // 뱀 굵기 (길이도 굵기에 비례)
  const widthOf = (L) => 0.8 * (16 + 5.5 * Math.cbrt(Math.max(1, L)));
  const lengthOf = (L) => widthOf(L) * Math.min(42, 4 + 1.5 * Math.sqrt(Math.max(1, L)));
  const turnOf = (L) => Math.max(3.2, 7.4 - 0.4 * Math.log2(Math.max(1, L)));
  // 캐릭터 등급 (1 일반, 2 레어, 3 에픽, 4 전설) - 브라우저와 서버가 함께 사용
  const SKIN_TIERS = {
    1: ['tree', 'garter', 'corn', 'field', 'sand', 'racer', 'ball', 'hognose', 'redrat', 'yellowrat', 'bluerace', 'rosy', 'blueshark',
      'water', 'ribbon', 'gopher', 'vine', 'nurse', 'gardeneel'],
    2: ['python', 'coral', 'milk', 'king', 'rattle', 'seakrait', 'emerald', 'greenmamba', 'anaconda', 'blood', 'indigo', 'banana',
      'violet', 'tigershark', 'hammer', 'moray', 'redtail', 'mangrove', 'sunbeam', 'carpet', 'mako', 'ribboneel'],
    3: ['cobra', 'mamba', 'albino', 'viper', 'taipan', 'gaboon', 'horned', 'rainbow', 'sapphire', 'ruby', 'pearl', 'greatwhite',
      'whaleshark', 'electric', 'boomslang', 'rhino', 'spitcobra', 'amethyst', 'thresher',
      'bushmaster', 'krait', 'opal', 'goblinshark', 'lanterneel'],
    4: ['gold', 'crystal', 'lava', 'nebula', 'shadow', 'megalodon', 'firedragon', 'icedragon', 'thunderdragon', 'blackdragon',
      'golddragon', 'jadedragon', 'aurora', 'sakuradragon', 'leviathan',
      'solar', 'abyss', 'moondragon', 'poisondragon', 'ghostshark'],
  };
  // 캐릭터 레벨 보너스 (등급이 높을수록 크다) - 스테이지와 온라인 대전에서 같이 사용
  const SKIN_MAX_LV = { 1: 20, 2: 30, 3: 40, 4: 50 };
  function skinBonus(id, lv) {
    const t = SKIN_TIER[id] || 1;
    lv = Math.max(1, Math.min(SKIN_MAX_LV[t], Math.floor(lv) || 1));
    return { start: t * 2 + Math.floor(lv * t * 0.8), food: t * 4 + Math.round(lv * t * 0.5) };
  }
  const SKIN_TIER = {};
  for (const t in SKIN_TIERS) for (const id of SKIN_TIERS[t]) SKIN_TIER[id] = +t;

  const TRAIL_STEP = 5;
  // 굵은 뱀은 경로 점 간격도 넓힌다 (점 개수를 적당히 유지)
  const stepOf = (L) => Math.max(TRAIL_STEP, widthOf(L) * 0.2);
  // 먹이 종류: 0 먹이, 1 선물상자(스킨), 2~8 아이템
  const ITEM = { SKIN: 1, MAGNET: 2, SPEED: 3, SHIELD: 4, DOUBLE: 5, BOMB: 6, STAR: 7, ICE: 8 };
  const ITEM_TIME = { 2: 10, 3: 6, 4: 8, 5: 10 };
  const ITEM_WEIGHTS = [[2, 3], [3, 3], [4, 2], [5, 2], [6, 2], [7, 2], [8, 1.5]];
  const MAGNET_RANGE = 230;
  // 별: 먹이 몇 개 분량만큼 고정으로 자란다 (현재 레벨에 비례하지 않음)
  const STAR_FOODS = 10;
  function pickItem() {
    let t = 0;
    for (const [, w] of ITEM_WEIGHTS) t += w;
    let r = Math.random() * t;
    for (const [k, w] of ITEM_WEIGHTS) { r -= w; if (r <= 0) return k; }
    return 2;
  }
  // 먹힌 뱀이 머리부터 상대 입속으로 다 빨려 들어가는 시간
  const DIE_TIME = 0.9;
  // 레벨 상한 (원작처럼 숫자가 끝없이 커지지 않게)
  const MAX_LEVEL = 9999;
  // 몸 앞쪽 이 비율까지는 머리로 친다 (여기에 부딪혀야 먹고 먹힌다)
  const HEAD_ZONE = 0.15;
  // 몸통을 먹었을 때: 먹은 양 중 얻는 비율, 같은 뱀을 다시 물 수 있을 때까지의 시간
  const BITE_GAIN = 0.8, BITE_COOL = 0.5;

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
    // 경기장 배율: 뱀이 커지는 높은 스테이지에서 거리 기준(AI 시야, 아이템 범위 등)을 같이 키운다
    this.sc = opt.scale || 1;
    this.foodTarget = opt.foodTarget || 200;
    this.foodValue = opt.foodValue || 1;
    this.skinEvery = opt.skinEvery || 0;
    this.skinT = Math.min(6, this.skinEvery * 0.3);
    this.giftMax = opt.giftMax || 1;
    this.itemTarget = opt.itemTarget || 0;
    this.itemEvery = opt.itemEvery || 10;
    this.itemT = this.itemEvery * 0.4;
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
    const level = Math.min(MAX_LEVEL, Math.max(1, o.level || 1));
    const dir = o.dir !== undefined ? o.dir : rand(0, TAU);
    const s = {
      id, name: o.name || '뱀', skin: o.skin || 'basic', level, best: level,
      x: o.x || 0, y: o.y || 0, dir, want: dir,
      speed: o.speed || 210, foodMul: o.foodMul || 1,
      isBot: !!o.isBot, isBoss: !!o.isBoss, isHuman: !!o.isHuman,
      aggro: o.aggro !== undefined ? o.aggro : 0.6, chase: o.chase || 480, humanBias: o.humanBias || 0,
      think: rand(0, 0.3), bounceT: 0, latch: 0, dying: null, alive: true,
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
    const st = stepOf(s.level), L = lengthOf(s.level) + st, w = widthOf(s.level);
    const a = w * 0.7, b = w * 1.05 / TAU;
    const pts = [[a, 0]];
    let th = 0, len = 0, px = a, py = 0;
    while (len < L) {
      th += st / Math.max(a + b * th, 1);
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
      if (s.biteT > 0) s.biteT -= dt;
      if (s.isBot) {
        s.think -= dt;
        if (s.think <= 0) { this.think(s); s.think = rand(0.12, 0.24); }
      }
      this.move(s, dt);
    }
    for (const s of live) this.eat(s);
    this.collide(live);
    for (const s of this.snakes) if (s.dying) this.updateDying(s, dt);
    this.snakes = this.snakes.filter((s) => s.alive);
    while (this.orbs < this.foodTarget) this.spawnFood();
    if (this.items < this.itemTarget) {
      this.itemT -= dt;
      if (this.itemT <= 0) {
        this.itemT = this.itemEvery * rand(0.7, 1.3);
        const p = this.randPoint(120);
        this.addFood(p.x, p.y, 0, pickItem());
      }
    }
    if (this.skinEvery > 0) {
      let gifts = 0;
      for (const f of this.foods.values()) if (f.k === 1) gifts++;
      if (gifts < this.giftMax) {
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
    if (!prev || Math.hypot(s.x - prev[0], s.y - prev[1]) >= stepOf(s.level)) tr.push([s.x, s.y]);
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
    // 입 반경(r0) 안은 바로 먹고, 머리 주변 흡입 반경(r) 안의 먹이·아이템은 빨려 들어온다
    const w = widthOf(s.level), r0 = w * 0.5 + 14, r02 = r0 * r0;
    const r = w * 1.3 + 30 * this.sc, r2 = r * r;
    const mr = s.fx[2] > 0 ? r + MAGNET_RANGE * this.sc : 0, mr2 = mr * mr;
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
        // 사람이 먹을 때만 효과음용 이벤트 (m: 0 보통, 1 큰 먹이, 2 아주 큰 먹이)
        if (s.isHuman) this.events.push({ e: 'fd', a: s.id, m: f.v >= this.foodValue * 8 ? 2 : f.v >= this.foodValue * 3 ? 1 : 0 });
      }
      if (d2 > r02 && (s.isHuman || d2 > r2)) this.events.push({ e: 'mg', a: s.id, x: Math.round(f.x), y: Math.round(f.y) });
      this.removeFood(f.id);
    }
  };

  W.applyItem = function (s, f) {
    const k = f.k;
    if (ITEM_TIME[k]) s.fx[k] = ITEM_TIME[k];
    else if (k === ITEM.BOMB) {
      for (let i = 0; i < 24; i++) {
        const a = rand(0, TAU), d = rand(70, 280) * this.sc;
        let x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
        const dd = Math.hypot(x, y), lim = this.R - 40;
        if (dd > lim) { x *= lim / dd; y *= lim / dd; }
        this.addFood(x, y, this.foodValue * (Math.random() < 0.3 ? 3 : 1), 0, f.x, f.y);
      }
    } else if (k === ITEM.STAR) {
      this.grow(s, STAR_FOODS * this.foodValue * s.foodMul);
    } else if (k === ITEM.ICE) {
      for (const o of this.snakes) {
        if (o === s || !o.alive || o.dying) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) < 700 * this.sc) o.fx.slow = 3.5;
      }
    }
    this.events.push({ e: 'item', id: s.id, k, x: Math.round(f.x), y: Math.round(f.y) });
  };

  W.grow = function (s, v) {
    s.level = Math.min(MAX_LEVEL, s.level + v);
    if (s.level > s.best) s.best = s.level;
  };

  // Snake Clash 규칙: 머리(머리와 목 부분)끼리 부딪히면 레벨이 높은 쪽이 낮은 쪽을 통째로 꿀꺽!
  // 큰 뱀이 작은 뱀의 몸통·꼬리를 물면 그 자리부터 꼬리까지 먹는다. 작은 뱀이 큰 뱀 몸통에 박으면 튕겨나간다.
  // 레벨이 같거나 방패가 있으면 튕겨나간다.
  W.collide = function (live) {
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
        const pts = B.body, n = pts.length >> 1;
        // 머리부터 목까지(몸 앞쪽 HEAD_ZONE 비율)는 머리로 친다
        const neck = Math.max(3, Math.ceil(n * HEAD_ZONE));
        let hit = -1;
        if (Math.hypot(B.x - A.x, B.y - A.y) < (rA + rB) * 0.95) hit = 0;
        else {
          const lim = rA + rB * 0.8, lim2 = lim * lim;
          for (let j = 2; j < n; j++) {
            const dx = pts[2 * j] - A.x, dy = pts[2 * j + 1] - A.y;
            if (dx * dx + dy * dy < lim2) { hit = j; break; }
          }
        }
        if (hit < 0) continue;
        const hx = pts[2 * hit], hy = pts[2 * hit + 1];
        const la = Math.floor(A.level), lb = Math.floor(B.level);
        if (hit >= neck) {
          // 몸통·꼬리: 내가 더 크면 물린 자리부터 꼬리까지 꿀꺽 (잠깐 동안은 연달아 먹히지 않는다)
          if (la > lb && !(B.fx[4] > 0)) { if (!(B.biteT > 0)) this.bite(A, B, hit); }
          else this.bounce(A, hx, hy);
          continue;
        }
        if (la > lb && !(B.fx[4] > 0)) this.swallow(A, B);
        else if (lb > la && !(A.fx[4] > 0)) this.swallow(B, A);
        else { this.bounce(A, B.x, B.y); this.bounce(B, A.x, A.y); }
      }
    }
  };

  // 물린 자리 뒤쪽(꼬리까지)을 삼킨다. 머리 쪽만 남아 계속 움직인다
  W.bite = function (A, B, j) {
    const b = B.body, n = b.length >> 1;
    j = Math.min(j, n - 3);
    // 먹힌 몸 비율만큼 레벨이 줄어든다 (남은 몸은 움직이면서 레벨 길이만큼 다시 자란다)
    const lv = B.level, keep = j / n, keepLen = lengthOf(lv) * keep;
    const lost = Math.min(lv - 1, lv * (1 - keep));
    if (lost <= 0) return;
    const piece = b.slice(2 * j);
    const tr = B.trail;
    let acc = 0;
    for (let i = tr.length - 1; i > 0; i--) {
      acc += Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]);
      if (acc >= keepLen) { tr.splice(0, i - 1); break; }
    }
    B.level -= lost;
    B.biteT = BITE_COOL;
    B.body = samplePath(tr, lengthOf(B.level), widthOf(B.level) * 0.45);
    this.grow(A, lost * BITE_GAIN);
    // 화면에서 뚝 떨어져 나갔다가 입으로 빨려 들어갈 토막 모양 (점 수를 줄여서 보낸다)
    const segs = piece.length >> 1, st = Math.max(1, Math.ceil(segs / 24)) * 2, p = [];
    for (let i = 0; i < piece.length; i += st) p.push(Math.round(piece[i]), Math.round(piece[i + 1]));
    if ((piece.length - 2) % st) p.push(Math.round(piece[piece.length - 2]), Math.round(piece[piece.length - 1]));
    this.events.push({ e: 'part', a: A.id, b: B.id, x: Math.round(piece[0]), y: Math.round(piece[1]),
      w: Math.round(widthOf(lv) * 10) / 10, keep: Math.round(keep * 100) / 100, n: Math.round(lost * BITE_GAIN * 10) / 10, p });
  };

  W.swallow = function (A, B) {
    if (A.dying || B.dying) return;
    const lv = B.level;
    this.grow(A, lv * 0.5);
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
      const a = rand(0, TAU), d = rand(40, 170) * this.sc;
      let x = ox + Math.cos(a) * d, y = oy + Math.sin(a) * d;
      const dd = Math.hypot(x, y);
      if (dd > lim) { x *= lim / dd; y *= lim / dd; }
      this.addFood(x, y, v, 0, ox, oy);
    }
  };

  W.bounce = function (A, fx, fy) {
    const a = Math.atan2(A.y - fy, A.x - fx);
    A.dir = a; A.want = a; A.bounceT = 0.28;
    A.x += Math.cos(a) * 4; A.y += Math.sin(a) * 4;
    if (A.isHuman) this.events.push({ e: 'bump', a: A.id });
  };

  // 머리부터 꼬리까지 자기 몸이 지나온 길을 따라 미끄러지며 먹은 뱀의 입으로 빨려 들어간다
  W.updateDying = function (s, dt) {
    const d = s.dying;
    d.t += dt;
    const eater = this.get(d.by), b = d.body0, n = b.length >> 1;
    if (eater && eater.alive) {
      const ew = widthOf(eater.level) * 0.55;
      d.mx = eater.x + Math.cos(eater.dir) * ew; d.my = eater.y + Math.sin(eater.dir) * ew;
    } else if (d.mx === undefined) { d.mx = b[0]; d.my = b[1]; }
    const p = Math.min(1, d.t / DIE_TIME);
    // 처음엔 천천히, 점점 빠르게 후루룩
    const eaten = (n - 1) * Math.pow(p, 1.7), i0 = Math.floor(eaten), fr = eaten - i0;
    const at = (k) => k >= n - 1 ? [b[2 * n - 2], b[2 * n - 1]]
      : [b[2 * k] + (b[2 * k + 2] - b[2 * k]) * fr, b[2 * k + 1] + (b[2 * k + 3] - b[2 * k + 1]) * fr];
    const f = at(i0);
    // 앞쪽은 입에 딱 붙고, 뒤로 갈수록 원래 자리에 가깝게 끌려온다
    const ox = d.mx - f[0], oy = d.my - f[1], pull = Math.min(1, p / 0.2), span = Math.max(4, n * 0.6);
    const out = [];
    for (let k = i0, j = 0; k < n; k++, j++) {
      const q = at(k), wgt = pull * Math.max(0, 1 - j / span);
      out.push(q[0] + ox * wgt, q[1] + oy * wgt);
    }
    s.body = out.length >= 4 ? out : [d.mx, d.my, d.mx, d.my];
    s.x = s.body[0]; s.y = s.body[1];
    if (d.t >= DIE_TIME) s.alive = false;
  };

  /* ---------- 인공지능 ---------- */
  W.think = function (s) {
    const w = widthOf(s.level), sc = this.sc;
    let threat = null, td = Infinity, target = null, ts = -Infinity;
    const me = Math.floor(s.level);
    for (const o of this.snakes) {
      if (o === s || !o.alive || o.dying) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > 1200 * sc) continue;
      const ol = Math.floor(o.level);
      if (ol > me && d < 200 * sc + w * 4 + widthOf(o.level) * 2 && d < td) { threat = o; td = d; }
      if (me > ol && d < s.chase * sc) {
        const v = o.level * 15 - d + (o.isHuman ? s.humanBias : 0);
        // 머리를 노릴 때는 가는 방향을 앞질러 간다
        if (v > ts) { ts = v; target = { x: o.x + Math.cos(o.dir) * 60 * sc, y: o.y + Math.sin(o.dir) * 60 * sc }; }
        // 몸통 가운데를 물어도 반쯤 먹을 수 있다
        const b = o.body;
        if (b.length > 8) {
          const k = (b.length >> 2) * 2, bd = Math.hypot(b[k] - s.x, b[k + 1] - s.y);
          const bv = o.level * 9 - bd + (o.isHuman ? s.humanBias : 0);
          if (bv > ts) { ts = bv; target = { x: b[k], y: b[k + 1] }; }
        }
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
        if (d > 700 * sc) continue;
        const v = (f.k ? 150 * sc : f.v / this.foodValue * 25 * sc) - d;
        if (v > bs) { bs = v; best = f; }
      }
      if (best) s.want = Math.atan2(best.y - s.y, best.x - s.x);
      else s.want += rand(-0.7, 0.7);
    }
    if (Math.hypot(s.x, s.y) > this.R - 200 * sc - w) s.want = Math.atan2(-s.y, -s.x) + rand(-0.4, 0.4);
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

  return { World, MAX_LEVEL, widthOf, lengthOf, samplePath, ITEM, MAGNET_RANGE, STAR_FOODS, DIE_TIME, SKIN_TIERS, SKIN_TIER, SKIN_MAX_LV, skinBonus };
});
