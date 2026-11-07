/* =========================================================
   모두의 세계여행 - 게임 엔진 (브라우저 · 서버 공용)
   게임 규칙과 진행만 담당한다. 화면/통신은 io 객체가 맡는다.
     io.event(ev)      : 화면에 보여줄 일 (sync, log, dice, announce, float, sfx, msg, end)
     io.ask(p, req)    : 사람 플레이어에게 결정 요청 → Promise(답). undefined면 컴퓨터가 대신 결정
     io.sleep(ms)      : 연출용 대기
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const START_MONEY = 1500, SALARY = 100, ESCAPE_FEE = 50, WARP_FEE = 30;
  const FEST_COUNT = 3;           // 축제 도시는 동시에 3곳 (각각 통행료 ×2)
  const LAP_CAP = [1, 2, 3, 4];   // 바퀴 수에 따른 건설 한도: 1바퀴 하우스, 2바퀴 빌딩, 3바퀴 호텔, 4바퀴부터 제한 없음
  const TOUR_MULT = [0, 1, 1.5, 2, 2.5];   // 관광지: 가진 관광지 수에 따라 통행료가 오른다 (기본 통행료 × 배율)
  const TOUR_ICONS = ['', '🚩', '⛱️', '🛖', '🏆'];
  const GAUGE_CHANCE = 0.55;      // 주사위 조절 게이지 성공 확률
  const COST_MULT = [1, 0.6, 1.2, 1.8, 2.4];      // 땅, 하우스, 빌딩, 호텔, 랜드마크 (나라 가격 대비)
  const ELEM_TOLL = [0.05, 0.15, 0.28, 0.52, 1.0]; // 건물별 통행료 = 호텔 기준 통행료 × 비율 (땅·하우스·빌딩·호텔을 더하면 호텔 통행료, 랜드마크는 그만큼 더)
  const LAND_RATE = 0.3;  // 땅값 = 호텔 통행료 × 0.3
  const LEVEL_NAMES = ['땅', '하우스', '빌딩', '호텔', '랜드마크'];
  const LEVEL_ICONS = ['🚩', '🏠', '🏠🏢', '🏠🏢🏨', '🌟'];
  // 캐릭터: 소방차, 구급차, 경찰차, 탱크, 한전 작업차, 도시가스차
  const PCHARS = ['소방차', '구급차', '경찰차', '탱크', '한전 작업차', '도시가스차'];
  const PCOLORS = ['#ff5d5d', '#ffa94d', '#4dabf7', '#94d82d', '#ffd43b', '#20c997'];
  const PEMOJI = ['🚒', '🚑', '🚓', '🪖', '⚡', '🔥'];
  const MAX_PLAYERS = 6;
  const SIDES = [[1, 7], [9, 15], [17, 23], [25, 31]];
  const AI_RESERVE = 150;
  const BLACKHOLE = 8, FESTIVAL = 16, WARP = 24;
  const N = 32; // 보드 칸 수 (모서리 사이 7칸씩)

  // 라인: A(아래·노랑) B(왼쪽·녹색) C(위·파랑) D(오른쪽·빨강). 같은 라인 나라는 땅값·건물값·통행료가 모두 같다
  const LINES = [
    { name: 'A라인', color: '#ffd43b', base: 8, step: 1 },
    { name: 'B라인', color: '#51cf66', base: 13, step: 1 },
    { name: 'C라인', color: '#4dabf7', base: 18, step: 1 },
    { name: 'D라인', color: '#ff6b6b', base: 24, step: 2 },
  ];
  const lineOf = (i) => (i % 8 === 0 ? -1 : Math.floor(i / 8));
  const GROUPS = [
    { name: '중미', color: '#f783ac' }, { name: '남미', color: '#ff922b' }, { name: '아프리카', color: '#c9a66b' }, { name: '중동', color: '#fcc419' },
    { name: '오세아니아', color: '#3bc9db' }, { name: '아시아', color: '#69db7c' }, { name: '북미', color: '#5c7cfa' }, { name: '유럽', color: '#cc5de8' },
  ];

  const TILE_DEFS = [
    { type: 'start', name: '출발', icon: '🚀', sub: '월급 100만 · 도착 시 건설' },
    { type: 'city', name: '쿠바', cc: 'cu', g: 0 },
    { type: 'city', name: '멕시코', cc: 'mx', g: 0 },
    { type: 'chance', name: '행운 카드', icon: '🎴' },
    { type: 'city', name: '페루', cc: 'pe', g: 1 },
    { type: 'station', name: '제주도', icon: '🏝️', price: 60, toll: 30 },
    { type: 'city', name: '아르헨티나', cc: 'ar', g: 1 },
    { type: 'city', name: '브라질', cc: 'br', g: 1 },
    { type: 'blackhole', name: '버뮤다 삼각지대', icon: '🌊', sub: '최대 3턴 표류' },
    { type: 'city', name: '이집트', cc: 'eg', g: 2 },
    { type: 'city', name: '케냐', cc: 'ke', g: 2 },
    { type: 'chance', name: '행운 카드', icon: '🎴' },
    { type: 'city', name: '튀르키예', cc: 'tr', g: 3 },
    { type: 'station', name: '부산', icon: '🌉', price: 100, toll: 50 },
    { type: 'city', name: '사우디', cc: 'sa', g: 3 },
    { type: 'city', name: 'UAE', cc: 'ae', g: 3 },
    { type: 'festival', name: '월드 페스티벌', icon: '🎉', sub: '통행료 배율 UP' },
    { type: 'city', name: '피지', cc: 'fj', g: 4 },
    { type: 'city', name: '호주', cc: 'au', g: 4 },
    { type: 'chance', name: '행운 카드', icon: '🎴' },
    { type: 'city', name: '태국', cc: 'th', g: 5 },
    { type: 'station', name: '경주', icon: '🏯', price: 60, toll: 30 },
    { type: 'city', name: '싱가포르', cc: 'sg', g: 5 },
    { type: 'city', name: '일본', cc: 'jp', g: 5 },
    { type: 'warp', name: '워프 게이트', icon: '🌀', sub: '다음 턴 원하는 곳으로' },
    { type: 'city', name: '캐나다', cc: 'ca', g: 6 },
    { type: 'city', name: '미국', cc: 'us', g: 6 },
    { type: 'chance', name: '행운 카드', icon: '🎴' },
    { type: 'city', name: '이탈리아', cc: 'it', g: 7 },
    { type: 'tax', name: '관세', icon: '💸' },
    { type: 'city', name: '프랑스', cc: 'fr', g: 7 },
    { type: 'station', name: '서울', icon: '🗼', price: 300, toll: 200 },
  ];

  // 나라별 '호텔까지 지었을 때 통행료' (만). 다른 금액은 모두 이 값에서 비율로 정해진다
  const HOTEL_TOLL = {
    쿠바: 70, 멕시코: 80, 페루: 80, 아르헨티나: 90, 브라질: 100,
    이집트: 90, 케냐: 90, 튀르키예: 100, 사우디: 100, UAE: 110,
    피지: 100, 호주: 110, 태국: 110, 싱가포르: 120, 일본: 130,
    캐나다: 110, 미국: 150, 이탈리아: 110, 프랑스: 120,
  };
  TILE_DEFS.forEach((t, i) => {
    t.line = lineOf(i);
    if (t.type === 'city') { t.hotel = HOTEL_TOLL[t.name]; t.price = Math.round(t.hotel * LAND_RATE); }
  });

  // 행운 카드 (보관 카드는 갖고 있다가 자동으로 사용)
  const CARDS = [
    { icon: '🎰', title: '해외 복권 당첨', desc: '100만을 받습니다.' },
    { icon: '🧳', title: '수하물 분실', desc: '짐을 다시 사느라 60만을 냅니다.' },
    { icon: '🛬', title: '귀국 항공권', desc: '출발지로 이동합니다. (월급 지급)' },
    { icon: '🌊', title: '폭풍우 표류', desc: '버뮤다 삼각지대로 떠내려갑니다!' },
    { icon: '🌀', title: '워프 티켓', desc: '워프 게이트로 이동합니다.' },
    { icon: '🎉', title: '페스티벌 초대장', desc: '월드 페스티벌로 이동합니다.' },
    { icon: '🛡️', title: '여행자 보험', desc: '[보관] 통행료를 1번 면제받습니다.', keep: true },
    { icon: '🎟️', title: '통행 할인 쿠폰', desc: '[보관] 통행료를 1번 50% 할인받습니다.', keep: true },
    { icon: '🌪️', title: '태풍 발생', desc: '[공격] 상대 나라 1곳의 건물을 1단계 무너뜨립니다. (랜드마크 제외)', attack: true },
    { icon: '💳', title: '보너스 월급', desc: '[보관] 다음에 출발지를 지날 때 월급을 2배로 받습니다.', keep: true },
    { icon: '🛟', title: '구조 요청', desc: '[보관] 버뮤다에 갇히면 바로 구조됩니다.', keep: true },
    { icon: '🧱', title: '방어막', desc: '[보관] 내 나라를 노린 공격 카드를 1번 막아냅니다.', keep: true },
    { icon: '🤧', title: '독감 유행', desc: '[공격] 상대 나라 1곳과 같은 세트의 그 주인 나라들 통행료가 3라운드 동안 절반이 됩니다.', attack: true },
    { icon: '🔌', title: '대정전', desc: '[공격] 상대 나라 1곳의 통행료가 2라운드 동안 0원이 됩니다.', attack: true },
    { icon: '🔨', title: '강제 경매', desc: '[공격] 상대 나라 1곳을 은행에 팔아버립니다. 주인은 투자금 절반만 받아요. (랜드마크 제외)', attack: true },
    { icon: '🔄', title: '나라 맞교환', desc: '[공격] 내 나라 1곳과 상대 나라 1곳을 바꿉니다. (랜드마크 제외)', attack: true },
    { icon: '🎁', title: '나라 선물', desc: '내 나라 1곳을 가장 가난한 플레이어에게 줍니다.' },
    { icon: '🛃', title: '세관 검사', desc: '관세 칸으로 이동해서 관세를 냅니다.' },
    { icon: '✨', title: '랜덤 여행', desc: '무작위 위치로 이동합니다. (출발지 통과 시 월급)' },
    { icon: '🎂', title: '생일 파티', desc: '모든 플레이어에게 20만씩 축하금을 받습니다.' },
  ];
  const CARD_POOL = [0, 1, 2, 3, 4, 5, 6, 6, 7, 7, 8, 9, 10, 11, 11, 12, 13, 14, 15, 15, 16, 17, 18, 19];

  /* ---------- 공용 계산 ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rnd = (n) => Math.floor(Math.random() * n);
  const fmt = (n) => `${Math.round(n).toLocaleString()}만`;
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const isProp = (t) => t.type === 'city' || t.type === 'station';
  const cityPrice = (t) => t.price;
  const levelCost = (t, L) => (t.type === 'station' ? t.price : Math.round(t.price * COST_MULT[L]));
  function cumCost(t, from, to) { let s = 0; for (let L = from + 1; L <= to; L++) s += levelCost(t, L); return s; }
  const invested = (t) => (t.level < 0 ? 0 : t.type === 'station' ? t.price : cumCost(t, -1, t.level));
  const sellValue = (t) => Math.floor(invested(t) / 2);
  const takeoverPrice = (t) => invested(t) * 2;
  const stationCount = (s, pid) => s.tiles.filter((x) => x.type === 'station' && x.owner === pid).length;
  const elemToll = (t, k) => Math.round(t.hotel * ELEM_TOLL[k]);
  function tollAt(s, t, L) {
    if (t.type === 'station') return Math.round(t.toll * TOUR_MULT[Math.min(4, Math.max(1, stationCount(s, t.owner)))]);
    let m = 0; for (let k = 0; k <= L; k++) m += elemToll(t, k);
    return m;
  }
  // 같은 대륙(색) 세트를 모두 가지면 그 나라들의 통행료 ×2
  const setOwned = (s, pid, g) => pid >= 0 && s.tiles.filter((x) => x.type === 'city' && x.g === g).every((x) => x.owner === pid);
  const setBonus = (s, t) => (t.type === 'city' && setOwned(s, t.owner, t.g) ? 2 : 1);
  const isFestival = (s, i) => !!(s.festivals && s.festivals.includes(i));
  function toll(s, t) {
    let v = tollAt(s, t, t.level) * setBonus(s, t);
    if (isFestival(s, t.idx)) v *= 2;
    const e = s.effects && s.effects[t.idx];
    if (e) v = e.kind === 'off' ? 0 : Math.round(v / 2);
    return v;
  }
  // 합이 sum이 되는 주사위 두 개
  function pairForSum(sum) {
    const ps = [];
    for (let a = 1; a <= 6; a++) { const b = sum - a; if (b >= 1 && b <= 6) ps.push([a, b]); }
    return ps[rnd(ps.length)];
  }
  const propValue = (s, p) => s.tiles.filter((t) => t.owner === p.id).reduce((a, t) => a + invested(t), 0);
  const assets = (s, p) => (p.alive ? p.money + propValue(s, p) : 0);
  function fullSets(s, pid) {
    let n = 0;
    for (let g = 0; g < GROUPS.length; g++) if (s.tiles.filter((t) => t.type === 'city' && t.g === g).every((t) => t.owner === pid)) n++;
    return n;
  }
  function gridPos(i) {  // 9×9 격자
    if (i <= 8) return { r: 9, c: 9 - i };
    if (i <= 16) return { r: 9 - (i - 8), c: 1 };
    if (i <= 24) return { r: 1, c: 1 + (i - 16) };
    return { r: 1 + (i - 24), c: 9 };
  }
  function makeTiles() { return TILE_DEFS.map((d, i) => Object.assign({}, d, { idx: i, owner: -1, level: -1 })); }
  // 네트워크로 받은 요약 상태를 계산 가능한 상태로 되돌림
  function expand(snap) {
    const tiles = makeTiles();
    snap.tiles.forEach((v, i) => { tiles[i].owner = v[0]; tiles[i].level = v[1]; });
    return Object.assign({}, snap, { tiles });
  }

  /* ---------- 게임 ---------- */
  class Game {
    constructor(seats, opts, io) {
      this.io = io;
      this.aborted = false;
      this.s = {
        players: seats.map((p, i) => ({
          id: i, name: String(p.name), isAI: !!p.isAI, color: PCOLORS[i], emoji: PEMOJI[i],
          money: START_MONEY, pos: 0, alive: true, stuck: 0, shield: 0, coupon: 0, salBoost: 0, rescue: 0, guard: 0, laps: 0, warpReady: false,
        })),
        tiles: makeTiles(), cur: 0, round: 1, maxRounds: opts.maxRounds || 0, festivals: [], effects: {}, over: false, deck: [], dbl: 0,
      };
      // 시작할 때 도시 카드에서 3곳을 뽑아 축제 도시로 정한다
      this.s.festivals = shuffle(this.s.tiles.filter((t) => t.type === 'city').map((t) => t.idx)).slice(0, FEST_COUNT);
    }

    snapshot() {
      const s = this.s;
      return {
        players: s.players.map((p) => Object.assign({}, p)), tiles: s.tiles.map((t) => [t.owner, t.level]),
        cur: s.cur, round: s.round, maxRounds: s.maxRounds, festivals: s.festivals.slice(), effects: JSON.parse(JSON.stringify(s.effects)), over: s.over,
      };
    }
    sleep(ms) { return this.io.sleep(ms); }
    emit(ev) { if (!this.aborted) this.io.event(ev); }
    sync() { this.emit({ type: 'sync', state: this.snapshot() }); }
    log(html) { this.emit({ type: 'log', html }); }
    announce(text) { this.emit({ type: 'announce', text }); }
    float(p, text, good) { this.emit({ type: 'float', pid: p.id, text, good }); }
    sfx(name) { this.emit({ type: 'sfx', name }); }
    msg(html) { this.emit({ type: 'msg', html }); }
    fx(name, data) { this.emit(Object.assign({ type: 'fx', name }, data || {})); }
    nm(p) { return `<b style="color:${p.color}">${p.emoji}${esc(p.name)}</b>`; }
    abort() { this.aborted = true; this.s.over = true; }

    async ask(p, req) {
      if (this.s.over) return this.aiAnswer(p, req);
      if (p.isAI) {
        await this.sleep(req.kind === 'roll' ? 650 : req.kind === 'card' ? 1100 : 450);
        return this.aiAnswer(p, req);
      }
      const a = await this.io.ask(p, req);
      return a === undefined ? this.aiAnswer(p, req) : a;
    }

    /* ----- 컴퓨터(또는 자리 비운 사람)의 결정 ----- */
    aiAnswer(p, req) {
      const s = this.s;
      switch (req.kind) {
        case 'blackhole': return p.money > 400 ? 'pay' : 'roll';
        case 'build': return this.aiChooseLevel(p, s.tiles[req.tile], req.from, req.maxL);
        case 'station': return p.money - req.price >= AI_RESERVE;
        case 'roll': return { target: this.aiDiceTarget(p) };
        case 'takeover': return this.aiWantsTakeover(p, s.tiles[req.tile], req.price);
        case 'sell': {
          const mine = s.tiles.filter((t) => t.owner === p.id).sort((a, b) => sellValue(a) - sellValue(b));
          return mine.length ? mine[0].idx : 'bk';
        }
        case 'pick': {
          if (req.purpose === 'warp') return this.aiWarp(p);
          if (req.purpose === 'startBuild') return this.aiStartBuild(p, req.cands);
          if (req.purpose === 'mine') return req.cands.slice().sort((a, b) => invested(s.tiles[a]) - invested(s.tiles[b]))[0];
          const c = req.cands.slice().sort((a, b) => toll(s, s.tiles[b]) - toll(s, s.tiles[a]));
          return c[0];
        }
        default: return true; // card
      }
    }
    aiChooseLevel(p, t, from, maxL) {
      for (let L = maxL; L > from; L--) if (cumCost(t, from, L) <= p.money - AI_RESERVE) return L;
      if (from === -1 && levelCost(t, 0) <= p.money - 50) return 0;
      return null;
    }
    aiWantsTakeover(p, t, price) {
      if (p.money - price < AI_RESERVE) return false;
      if (t.type === 'city') {
        const others = this.s.tiles.filter((x) => x.type === 'city' && x.g === t.g && x !== t);
        if (others.every((x) => x.owner === p.id)) return true;
      }
      return Math.random() < 0.65;
    }
    // 주사위 조절: 도착했을 때 가장 좋은 칸을 노린다
    aiDiceTarget(p) {
      const s = this.s;
      let best = 7, bestSc = -Infinity;
      for (let sum = 2; sum <= 12; sum++) {
        const t = s.tiles[(p.pos + sum) % N];
        let sc = 0;
        if (isProp(t)) {
          if (t.owner === -1) sc = cityPrice(t) <= p.money - 50 ? 60 + cityPrice(t) / 2 : 0;
          else if (t.owner === p.id) sc = t.level < 4 ? 40 : 5;
          else sc = -toll(s, t);
        } else if (t.type === 'blackhole') sc = -120;
        else if (t.type === 'warp') sc = 35;
        else if (t.type === 'start') sc = 50;
        else if (t.type === 'chance') sc = 15;
        else if (t.type === 'festival') sc = s.tiles.some((x) => x.owner === p.id) ? 40 : 0;
        else if (t.type === 'tax') sc = -propValue(s, p) * 0.1;
        sc += Math.random() * 10;
        if (sc > bestSc) { bestSc = sc; best = sum; }
      }
      return best;
    }
    aiStartBuild(p, cands) {
      const s = this.s;
      const c = cands.map((i) => s.tiles[i]).filter((t) => t.level < 4).sort((a, b) => cityPrice(b) - cityPrice(a));
      return c.length ? c[0].idx : null;
    }
    aiWarp(p) {
      let best = 0, bestScore = 60;
      for (const t of this.s.tiles) {
        if (t.idx === WARP || t.idx === BLACKHOLE) continue;
        let sc = 0;
        if (isProp(t) && t.owner === -1 && cityPrice(t) <= p.money - AI_RESERVE) sc = cityPrice(t) + 50;
        else if (t.type === 'city' && t.owner === p.id && t.level < 4) {
          const nxt = t.level === 3 ? 4 : t.level + 1;
          if (levelCost(t, nxt) <= p.money - AI_RESERVE) sc = cityPrice(t) + 30;
        }
        if (sc > bestScore) { bestScore = sc; best = t.idx; }
      }
      return best;
    }

    /* ----- 진행 ----- */
    async run() {
      this.log(`🚀 게임 시작! 모두 ${fmt(START_MONEY)}을 가지고 세계 일주를 떠납니다.`);
      this.log(`🎉 축제 도시: ${this.s.festivals.map((i) => this.s.tiles[i].name).join(' · ')} (통행료 ×2)`);
      while (!this.s.over) {
        const p = this.s.players[this.s.cur];
        this.sync();
        await this.playTurn(p);
        if (this.s.over) break;
        await this.sleep(350);
        this.advance();
        if (this.s.maxRounds && this.s.round > this.s.maxRounds) { this.endByAssets(); break; }
      }
    }
    advance() {
      const s = this.s;
      let n = s.cur;
      do {
        n = (n + 1) % s.players.length;
        if (n === 0) {
          s.round++;
          for (const k of Object.keys(s.effects)) if (--s.effects[k].left <= 0) { delete s.effects[k]; this.log(`✅ ${s.tiles[k].name}의 통행료가 원래대로 돌아왔어요.`); }
        }
      } while (!s.players[n].alive);
      s.cur = n;
    }

    async playTurn(p) {
      const s = this.s;
      s.dbl = 0;
      this.msg(`${p.emoji} ${esc(p.name)}의 차례`);
      if (p.stuck > 0) {
        const r = await this.blackholeTurn(p);
        if (r !== 'paid') return;
      }
      if (p.warpReady) { await this.warpTravel(p); return; }
      while (!s.over) {
        const [a, b] = await this.rollDice(p);
        if (s.over) return;
        const isD = a === b;
        if (isD && ++s.dbl === 3) {
          this.announce('3연속 더블! 버뮤다로 표류…');
          this.fx('bermuda', { pid: p.id });
          this.log(`${this.nm(p)} 3연속 더블! 버뮤다 삼각지대로 떠내려갑니다.`);
          await this.teleport(p, BLACKHOLE); p.stuck = 3; this.sync(); return;
        }
        await this.moveSteps(p, a + b);
        await this.resolveTile(p);
        this.sync();
        if (s.over || !p.alive || p.stuck > 0 || !isD) return;
        this.fx('double', { pid: p.id });
        await this.sleep(500);
      }
    }

    async rollDice(p, auto) {
      let target = null;
      if (!auto) {
        this.msg(`${p.emoji} ${esc(p.name)}의 차례 — 게이지를 맞춰 주사위를 굴리세요`);
        const ans = await this.ask(p, { kind: 'roll' });
        const tg = ans && Number(ans.target);
        if (Number.isInteger(tg) && tg >= 2 && tg <= 12) target = tg;
      } else await this.sleep(p.isAI ? 600 : 250);
      if (this.s.over) return [1, 2];
      let a = 1 + rnd(6), b = 1 + rnd(6);
      if (target != null && Math.random() < GAUGE_CHANCE) {
        // 게이지 성공: 목표 합 ±1 범위에서 나온다
        const sums = [target - 1, target, target + 1].filter((x) => x >= 2 && x <= 12);
        [a, b] = pairForSum(sums[rnd(sums.length)]);
      }
      if (target != null) this.emit({ type: 'gauge', pid: p.id, target, hit: Math.abs(a + b - target) <= 1 });
      this.emit({ type: 'dice', a, b, pid: p.id });
      await this.sleep(850);
      const dbl = a === b;
      this.msg(`🎲 ${a} + ${b} = <b>${a + b}</b>${dbl ? ' <span style="color:var(--accent)">더블!</span>' : ''}`);
      this.log(`${this.nm(p)} 🎲 ${a}+${b}=${a + b}${dbl ? ' (더블)' : ''}`);
      return [a, b];
    }

    async blackholeTurn(p) {
      if (p.rescue > 0) {
        p.rescue--; p.stuck = 0;
        this.announce('🛟 구조 요청 성공!'); this.log(`${this.nm(p)} 구조 요청 카드로 버뮤다에서 바로 탈출!`); this.sync();
        return 'paid';
      }
      let choice = 'roll';
      if (p.money >= ESCAPE_FEE) {
        choice = await this.ask(p, { kind: 'blackhole', stuck: p.stuck, fee: ESCAPE_FEE, money: p.money });
        if (choice !== 'pay') choice = 'roll';
      }
      if (this.s.over) return false;
      if (choice === 'pay') {
        p.money -= ESCAPE_FEE; p.stuck = 0; this.float(p, `-${ESCAPE_FEE}`, false);
        this.log(`${this.nm(p)} 구조비 ${fmt(ESCAPE_FEE)}을 내고 버뮤다 탈출!`); this.sync();
        return 'paid';
      }
      const [a, b] = await this.rollDice(p, true);
      if (a === b) {
        p.stuck = 0; this.announce('🎉 버뮤다 탈출!'); this.log(`${this.nm(p)} 더블로 버뮤다 탈출!`);
        await this.moveSteps(p, a + b); await this.resolveTile(p); this.sync();
        return 'moved';
      }
      p.stuck--;
      this.log(`${this.nm(p)} 탈출 실패… ${p.stuck > 0 ? `남은 ${p.stuck}턴` : '다음 턴에 자유!'}`);
      this.sync();
      return false;
    }

    async moveSteps(p, n, delay = 170) {
      for (let k = 0; k < n; k++) {
        if (this.aborted) return;
        p.pos = (p.pos + 1) % N;
        if (p.pos === 0) {
          p.laps++;
          const pay = p.salBoost > 0 ? SALARY * 2 : SALARY;
          if (p.salBoost > 0) p.salBoost--;
          p.money += pay; this.float(p, `+${pay} 월급`, true); this.sfx('coin');
          this.log(`${this.nm(p)} 출발지 통과! 월급 ${fmt(pay)}${pay > SALARY ? ' (💳 보너스 2배)' : ''}`);
        }
        this.sync();
        await this.sleep(delay);
      }
    }
    async moveBack(p, n) {
      for (let k = 0; k < n; k++) { p.pos = (p.pos + N - 1) % N; this.sync(); await this.sleep(170); }
    }
    async moveForwardTo(p, target) { await this.moveSteps(p, (target - p.pos + N) % N, 70); }
    async teleport(p, target) { p.pos = target; this.sync(); this.sfx('warp'); await this.sleep(400); }

    gain(p, amt, reason) {
      p.money += amt; this.float(p, `+${amt}`, true); this.sfx('coin');
      this.log(`${this.nm(p)} ${reason} <span class="pos">+${fmt(amt)}</span>`); this.sync();
    }

    async pay(p, amt, to, reason) {
      if (amt <= 0) return true;
      if (p.money < amt) await this.raiseFunds(p, amt);
      if (p.money >= amt) {
        p.money -= amt; this.float(p, `-${amt}`, false);
        if (to) { to.money += amt; this.float(to, `+${amt}`, true); }
        this.log(`${this.nm(p)} ${reason} <span class="neg">-${fmt(amt)}</span>${to ? ` → ${this.nm(to)}` : ''}`);
        this.sync();
        return true;
      }
      if (to) to.money += p.money;
      p.money = 0;
      this.log(`${this.nm(p)} ${reason} ${fmt(amt)}을(를) 낼 수 없습니다!`);
      await this.bankrupt(p);
      return false;
    }

    sellProp(t) {
      const o = this.s.players[t.owner], v = sellValue(t);
      o.money += v;
      this.log(`${this.nm(o)} ${t.name} 매각 <span class="pos">+${fmt(v)}</span>`);
      t.owner = -1; t.level = -1;
    }

    async raiseFunds(p, need) {
      while (p.money < need && !this.s.over) {
        const mine = this.s.tiles.filter((t) => t.owner === p.id);
        if (!mine.length) return;
        const v = await this.ask(p, {
          kind: 'sell', need, money: p.money,
          props: mine.map((t) => ({ idx: t.idx, value: sellValue(t), level: t.level })),
        });
        if (v === 'bk') return;
        const t = this.s.tiles[v];
        if (!t || t.owner !== p.id) continue;
        this.sellProp(t); this.sync();
        await this.sleep(300);
      }
    }

    async bankrupt(p) {
      p.alive = false; p.stuck = 0;
      this.s.tiles.forEach((t) => { if (t.owner === p.id) { t.owner = -1; t.level = -1; } });
      this.log(`💀 ${this.nm(p)} 파산했습니다!`);
      this.fx('bankrupt', { pid: p.id });
      this.sync(); await this.sleep(1800);
      const alive = this.s.players.filter((x) => x.alive);
      if (alive.length === 1) this.endGame(alive[0], '최후의 생존자');
    }

    checkWin(p) {
      const s = this.s;
      if (s.over) return true;
      if (fullSets(s, p.id) >= 3) { this.endGame(p, '트리플 독점! (대륙 세트 3개 완성)'); return true; }
      for (const [a, b] of SIDES) {
        if (s.tiles.slice(a, b + 1).filter(isProp).every((t) => t.owner === p.id)) { this.endGame(p, '라인 독점! (한 줄 전체 소유)'); return true; }
      }
      if (s.tiles.filter((t) => t.type === 'station').every((t) => t.owner === p.id)) { this.endGame(p, '관광지 독점! (관광지 4곳 소유)'); return true; }
      return false;
    }

    endGame(winner, reason) {
      const s = this.s;
      if (s.over) return;
      s.over = true;
      const ranking = s.players.slice().sort((a, b) => (b.alive - a.alive) || (assets(s, b) - assets(s, a)))
        .map((p) => ({ id: p.id, alive: p.alive, assets: assets(s, p) }));
      this.result = { winner: winner.id, reason };
      this.sync();
      this.fx('win', { pid: winner.id });
      this.msg(`🏆 ${esc(winner.name)} 승리 — ${reason}`);
      this.emit({ type: 'end', winner: winner.id, reason, ranking });
    }
    endByAssets() {
      const alive = this.s.players.filter((p) => p.alive).sort((a, b) => assets(this.s, b) - assets(this.s, a));
      this.endGame(alive[0], `${this.s.maxRounds}라운드 종료 — 총자산 1위`);
    }

    async resolveTile(p) {
      if (this.s.over || !p.alive) return;
      const t = this.s.tiles[p.pos];
      this.emit({ type: 'focus', tile: p.pos });
      switch (t.type) {
        case 'city': case 'station': await this.landProperty(p, t); break;
        case 'chance': await this.drawCard(p); break;
        case 'blackhole': p.stuck = 3; this.fx('bermuda', { pid: p.id }); this.log(`${this.nm(p)} 버뮤다 삼각지대에 표류합니다. (최대 3턴)`); break;
        case 'festival': await this.festivalTile(p); break;
        case 'warp': await this.warpTile(p); break;
        case 'start': await this.startTile(p); break;
        case 'tax': await this.taxTile(p); break;
        default: break;
      }
      this.sync();
    }

    async landProperty(p, t) {
      const s = this.s;
      if (t.owner === -1) return this.buildDialog(p, t, true);
      if (t.owner === p.id) return this.buildDialog(p, t, false);
      const owner = s.players[t.owner];
      let amt = toll(s, t);
      if (p.shield > 0) { p.shield--; amt = 0; this.fx('shield', { pid: p.id }); this.log(`${this.nm(p)} 여행자 보험으로 통행료 면제!`); await this.sleep(900); }
      else if (p.coupon > 0) { p.coupon--; amt = Math.round(amt / 2); this.log(`${this.nm(p)} 할인 쿠폰 사용 (50%)`); }
      if (amt > 0) {
        this.fx('toll', { pid: p.id, to: owner.id, amount: amt, tile: t.idx });
        await this.sleep(1000);
        const ok = await this.pay(p, amt, owner, `${t.name} 통행료`);
        if (!ok || s.over) return;
      }
      if (t.level >= 4 || t.owner === p.id || t.owner < 0) return;
      if (p.laps === 0) { this.log(`${this.nm(p)} 첫 바퀴에는 인수할 수 없어요.`); return; }
      const price = takeoverPrice(t);
      if (p.money < price) return;
      const yes = (await this.ask(p, { kind: 'takeover', tile: t.idx, price, owner: owner.id, money: p.money })) === true;
      if (!yes || s.over || p.money < price || t.owner !== owner.id) return;
      p.money -= price; owner.money += price; t.owner = p.id;
      this.float(p, `-${price}`, false); this.sfx('build');
      this.fx('takeover', { pid: p.id, from: owner.id, tile: t.idx });
      this.log(`${this.nm(p)} ${this.nm(owner)}의 ${t.name}을(를) ${fmt(price)}에 인수!`);
      this.sync();
      await this.sleep(900);
      this.announceSet(p, t);
      if (this.checkWin(p)) return;
      if (t.type === 'city') await this.buildDialog(p, t, false);
    }

    async buildDialog(p, t, isNew) {
      const s = this.s;
      if (t.type === 'station') {
        if (!isNew) return;
        if (p.money < t.price) { this.log(`${this.nm(p)} 자금 부족으로 ${t.name} 구매 불가`); return; }
        const n = stationCount(s, p.id) + 1;
        const yes = (await this.ask(p, { kind: 'station', tile: t.idx, price: t.price, nextToll: Math.round(t.toll * TOUR_MULT[Math.min(4, n)]), count: n, money: p.money })) === true;
        if (!yes || s.over || p.money < t.price || t.owner !== -1) return;
        p.money -= t.price; t.owner = p.id; t.level = 0;
        this.sfx('build'); this.float(p, `-${t.price}`, false);
        this.log(`${this.nm(p)} ${t.name} 구매!`); this.sync(); this.checkWin(p);
        return;
      }
      const from = t.level;
      if (from >= 4) return;
      let maxL = from === 3 ? 4 : 3;
      const cap = LAP_CAP[Math.min(p.laps, LAP_CAP.length - 1)];
      maxL = Math.min(maxL, cap);
      if (maxL <= from) { this.log(`${this.nm(p)} ${p.laps + 1}바퀴째에는 ${LEVEL_NAMES[cap]}까지만 지을 수 있어요.`); return; }
      const opts = [];
      for (let L = from + 1; L <= maxL; L++) {
        const cost = cumCost(t, from, L);
        opts.push({ L, cost, toll: tollAt(s, t, L), ok: cost <= p.money });
      }
      if (!opts.some((o) => o.ok)) { if (isNew) this.log(`${this.nm(p)} 자금 부족으로 ${t.name} 구매 불가`); return; }
      let L = await this.ask(p, { kind: 'build', tile: t.idx, from, maxL, isNew, opts, money: p.money, cap, lap: p.laps + 1 });
      if (s.over) return;
      if (!(Number.isInteger(L) && L > from && L <= maxL && cumCost(t, from, L) <= p.money)) return;
      if (t.owner !== -1 && t.owner !== p.id) return;
      const cost = cumCost(t, from, L);
      p.money -= cost; t.owner = p.id; t.level = L;
      this.sfx('build'); this.float(p, `-${cost}`, false);
      if (L === 4) this.fx('landmark', { pid: p.id, tile: t.idx });
      this.log(`${this.nm(p)} ${t.name} ${isNew ? '구매' : '건설'} → ${LEVEL_ICONS[L]} ${LEVEL_NAMES[L]} <span class="neg">-${fmt(cost)}</span>`);
      this.sync();
      if (L === 4) await this.sleep(1200);
      if (isNew) { this.announceSet(p, t); this.checkWin(p); }
    }

    async pickTile(p, cands, text, cancellable, purpose) {
      const v = await this.ask(p, { kind: 'pick', cands, text, cancellable, purpose });
      if (cands.includes(v)) return v;
      if (cancellable) return null;
      return this.aiAnswer(p, { kind: 'pick', cands, purpose });
    }

    announceSet(p, t) {
      if (t.type !== 'city' || !setOwned(this.s, p.id, t.g)) return;
      const g = GROUPS[t.g].name;
      this.announce(`🎨 ${g} 세트 완성! 통행료 ×2`);
      this.sfx('build');
      this.log(`${this.nm(p)} 🎨 ${g} 세트 완성! ${g} 나라 통행료 ×2`);
    }
    async festivalTile(p) {
      const s = this.s;
      const mine = s.tiles.filter((t) => t.owner === p.id && !isFestival(s, t.idx));
      if (!mine.length) { this.log(`${this.nm(p)} 축제를 옮길 내 나라가 없습니다.`); this.announce('🎉 월드 페스티벌'); return; }
      const idx = await this.pickTile(p, mine.map((t) => t.idx), '🎉 축제를 옮겨올 내 나라를 고르세요 (가장 오래된 축제 도시가 끝나요)', true, 'festival');
      if (idx == null || s.over) return;
      const gone = s.festivals.shift();
      s.festivals.push(idx);
      this.fx('festival', { pid: p.id, tile: idx, mul: 2 });
      this.log(`${this.nm(p)} ${s.tiles[gone].name}의 축제를 ${s.tiles[idx].name}(으)로 옮겼어요! 통행료 ×2`);
    }

    async warpTile(p) {
      p.warpReady = true;
      this.announce('🌀 워프 게이트!');
      this.log(`${this.nm(p)} 워프 게이트 도착! 다음 턴에 원하는 곳으로 여행합니다. (여행비 ${fmt(WARP_FEE)})`);
    }
    async warpTravel(p) {
      p.warpReady = false;
      if (p.pos !== WARP) return;
      if (p.money < WARP_FEE) { this.log(`${this.nm(p)} 여행비가 부족해서 워프하지 못했어요.`); return; }
      const cands = this.s.tiles.map((t) => t.idx).filter((i) => i !== WARP);
      const target = await this.pickTile(p, cands, `🌀 여행할 곳을 고르세요 (여행비 ${fmt(WARP_FEE)} · 출발지 통과 시 월급)`, true, 'warp');
      if (target == null || this.s.over) { this.log(`${this.nm(p)} 워프를 취소했습니다.`); return; }
      p.money -= WARP_FEE; this.float(p, `-${WARP_FEE}`, false);
      this.log(`${this.nm(p)} 여행비 ${fmt(WARP_FEE)}을 내고 ${this.s.tiles[target].name}(으)로 워프!`);
      this.fx('warp', { pid: p.id });
      await this.sleep(700);
      await this.moveForwardTo(p, target);
      await this.resolveTile(p);
    }
    // 출발지에 딱 도착하면 내 나라 한 곳에 건설
    async startTile(p) {
      const s = this.s;
      const cands = s.tiles.filter((t) => t.type === 'city' && t.owner === p.id && t.level < 4).map((t) => t.idx);
      if (!cands.length) return;
      this.announce('🚀 출발지 도착! 내 나라에 건설');
      const idx = await this.pickTile(p, cands, '🚀 건설할 내 나라를 고르세요', true, 'startBuild');
      if (idx == null || s.over) return;
      await this.buildDialog(p, s.tiles[idx], false);
    }

    async taxTile(p) {
      const amt = Math.round(propValue(this.s, p) * 0.1);
      if (amt <= 0) { this.log(`${this.nm(p)} 부동산이 없어 관세 면제`); this.announce('💸 관세 면제'); return; }
      this.fx('toll', { pid: p.id, to: -1, amount: amt, tile: p.pos, tax: true });
      await this.sleep(1000);
      await this.pay(p, amt, null, '관세');
    }

    async drawCard(p) {
      const s = this.s;
      if (!s.deck.length) s.deck = shuffle(CARD_POOL.slice());
      const ci = s.deck.pop(), c = CARDS[ci];
      this.log(`${this.nm(p)} 🎴 ${c.icon} ${c.title}`);
      this.announce(`${c.icon} ${c.title}`);
      await this.ask(p, { kind: 'card', card: ci });
      if (s.over) return;
      await this.runCard(ci, p);
      this.sync();
    }

    // 공격 카드 대상 고르기 (상대가 방어막을 갖고 있으면 막힌다)
    async attackPick(p, cands, text) {
      if (!cands.length) { this.log('공격할 대상이 없어요.'); return null; }
      const idx = await this.pickTile(p, cands, text, false, 'attack');
      const t = this.s.tiles[idx];
      const o = this.s.players[t.owner];
      if (o && o.guard > 0) {
        o.guard--;
        this.fx('shield', { pid: o.id });
        this.log(`🧱 ${this.nm(o)} 방어막으로 공격을 막았어요!`);
        await this.sleep(900);
        return null;
      }
      return t;
    }
    foes(p, f) { return this.s.tiles.filter((t) => t.type === 'city' && t.owner >= 0 && t.owner !== p.id && (!f || f(t))).map((t) => t.idx); }

    async runCard(ci, p) {
      const s = this.s;
      switch (ci) {
        case 0: this.gain(p, 100, '해외 복권'); break;
        case 1: await this.pay(p, 60, null, '수하물 분실'); break;
        case 2: await this.moveForwardTo(p, 0); break;
        case 3: await this.teleport(p, BLACKHOLE); p.stuck = 3; this.fx('bermuda', { pid: p.id }); this.log(`${this.nm(p)} 버뮤다 삼각지대에 표류합니다.`); break;
        case 4: await this.moveForwardTo(p, WARP); await this.resolveTile(p); break;
        case 5: await this.moveForwardTo(p, FESTIVAL); await this.resolveTile(p); break;
        case 6: p.shield++; break;
        case 7: p.coupon++; break;
        case 8: {
          const t = await this.attackPick(p, this.foes(p, (x) => x.level >= 1 && x.level <= 3), '🌪️ 태풍을 보낼 상대 나라를 고르세요');
          if (t && t.level >= 1 && t.level <= 3) {
            t.level--;
            this.fx('typhoon', { pid: p.id, tile: t.idx });
            this.log(`🌪️ ${t.name}의 건물이 무너져 ${LEVEL_NAMES[t.level]} 단계가 되었습니다.`);
          }
          break;
        }
        case 9: p.salBoost++; break;
        case 10: p.rescue++; break;
        case 11: p.guard++; break;
        case 12: {
          const t = await this.attackPick(p, this.foes(p), '🤧 독감을 퍼뜨릴 상대 나라를 고르세요');
          if (t) {
            const hit = s.tiles.filter((x) => x.type === 'city' && x.g === t.g && x.owner === t.owner);
            hit.forEach((x) => { s.effects[x.idx] = { kind: 'half', left: 3 }; });
            this.announce(`🤧 독감 유행! ${hit.map((x) => x.name).join('·')}`); this.sfx('lose');
            this.log(`🤧 ${hit.map((x) => x.name).join(', ')} 통행료가 3라운드 동안 절반!`);
          }
          break;
        }
        case 13: {
          const t = await this.attackPick(p, this.foes(p), '🔌 정전을 일으킬 상대 나라를 고르세요');
          if (t) {
            s.effects[t.idx] = { kind: 'off', left: 2 };
            this.announce(`🔌 ${t.name} 대정전!`); this.sfx('lose');
            this.log(`🔌 ${t.name} 통행료가 2라운드 동안 0원!`);
          }
          break;
        }
        case 14: {
          const t = await this.attackPick(p, this.foes(p, (x) => x.level < 4), '🔨 강제 경매에 부칠 상대 나라를 고르세요');
          if (t && t.level < 4) {
            this.fx('takeover', { pid: p.id, from: t.owner, tile: t.idx });
            this.sellProp(t);
            this.log(`🔨 ${t.name}이(가) 강제 경매로 은행에 팔렸어요.`);
          }
          break;
        }
        case 15: {
          const mine = s.tiles.filter((t) => t.type === 'city' && t.owner === p.id && t.level < 4).map((t) => t.idx);
          const theirs = this.foes(p, (x) => x.level < 4);
          if (!mine.length || !theirs.length) { this.log('바꿀 나라가 없어요.'); break; }
          const a = await this.pickTile(p, mine, '🔄 내줄 내 나라를 고르세요', false, 'mine');
          const t = await this.attackPick(p, theirs, '🔄 가져올 상대 나라를 고르세요');
          if (!t || t.level >= 4) break;
          const m = s.tiles[a], other = t.owner;
          m.owner = other; t.owner = p.id;
          this.fx('takeover', { pid: p.id, from: other, tile: t.idx });
          this.log(`🔄 ${this.nm(p)} ${m.name} ↔ ${this.nm(s.players[other])} ${t.name} 맞교환!`);
          this.sync();
          this.announceSet(p, t);
          if (this.checkWin(p)) break;
          this.checkWin(s.players[other]);
          break;
        }
        case 16: {
          const mine = s.tiles.filter((t) => t.owner === p.id).map((t) => t.idx);
          const others = s.players.filter((q) => q.alive && q !== p);
          if (!mine.length || !others.length) { this.log('선물할 나라가 없어요.'); break; }
          const poor = others.sort((a, b) => assets(s, a) - assets(s, b))[0];
          const idx = await this.pickTile(p, mine, `🎁 ${poor.name}에게 선물할 내 나라를 고르세요`, false, 'mine');
          const t = s.tiles[idx];
          t.owner = poor.id;
          this.log(`🎁 ${this.nm(p)} ${t.name}을(를) ${this.nm(poor)}에게 선물했어요.`);
          this.sync();
          this.checkWin(poor);
          break;
        }
        case 17: {
          const taxIdx = s.tiles.findIndex((t) => t.type === 'tax');
          await this.moveForwardTo(p, taxIdx); await this.resolveTile(p); break;
        }
        case 18: {
          let i; do { i = rnd(N); } while (i === p.pos || i === BLACKHOLE);
          await this.moveForwardTo(p, i); await this.resolveTile(p); break;
        }
        case 19: for (const q of s.players) if (q !== p && q.alive && !s.over) await this.pay(q, 20, p, '생일 축하금'); break;
        default: break;
      }
    }
  }

  return {
    START_MONEY, SALARY, ESCAPE_FEE, WARP_FEE, FEST_COUNT, LAP_CAP, TOUR_MULT, TOUR_ICONS, PCHARS, LEVEL_NAMES, LEVEL_ICONS, PCOLORS, PEMOJI, MAX_PLAYERS,
    N, GROUPS, LINES, TILE_DEFS, CARDS, esc, fmt, isProp, cityPrice, levelCost, cumCost, invested, sellValue, takeoverPrice,
    stationCount, tollAt, toll, elemToll, isFestival, setOwned, setBonus, propValue, assets, fullSets, gridPos, makeTiles, expand, Game,
  };
});
