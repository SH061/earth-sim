/* =====================================================================
 * sim.js  —  순수 시뮬레이션 로직 (DOM/네트워크 금지)
 * 공개 API: window.SIM_ENGINE
 *   migrate(state)            : 저장본을 최신 schema로 보정
 *   tick(state)               : 한 턴 진행 → 새 state 반환 (원본 불변)
 *   applyAction(state, id)    : 행동 적용 → {ok, state, message}
 *   applyEvent(state, evt)    : 교사 이벤트 적용 → {ok, state}
 *   checkQuests(state)        : 퀘스트 달성 처리 (state 직접 수정)
 *   calcScores(state)         : {eco, species, genetic, intel, total, reasons[]}
 * ===================================================================== */
(function (global) {
  'use strict';
  var C = global.CONFIG;
  var SIM = C.SIM;
  var clamp = C.clamp;

  /* ---------- 내부 헬퍼 ---------- */
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); } // state는 순수 데이터라 안전
  function eraById(id) { return C.ERAS.find(function (e) { return e.id === id; }) || C.ERAS[0]; }
  function eraOrder(id) { return eraById(id).order; }
  function pushLog(s, text) {
    s.log.push({ turn: s.turn, text: text });
    if (s.log.length > SIM.LOG_MAX) s.log = s.log.slice(-SIM.LOG_MAX);
  }

  /* ---------- migrate ---------- */
  function migrate(state) {
    if (!state || typeof state !== 'object') return C.createInitialState();
    var base = C.createInitialState(state.student);
    var s = Object.assign({}, base, state);
    s.schema_version = SIM.SCHEMA_VERSION;
    s.env            = Object.assign({}, base.env, state.env || {});
    s.species        = Object.assign({}, base.species, state.species || {});
    s.speciesLowTurns = Object.assign({}, base.speciesLowTurns, state.speciesLowTurns || {});
    s.cooldowns      = Object.assign({}, base.cooldowns, state.cooldowns || {});
    s.flags          = Object.assign({}, base.flags, state.flags || {});
    s.quests         = Object.assign({}, base.quests, state.quests || {});
    if (!Array.isArray(s.log)) s.log = [];
    if (!Array.isArray(s.history)) s.history = [];
    if (typeof s.questBonus !== 'number') s.questBonus = 0;
    if (typeof s.lastEventId !== 'number') s.lastEventId = 0;
    if (typeof s.humans !== 'number') s.humans = 0;
    if (typeof s.civ_stage !== 'number') s.civ_stage = 0;
    return s;
  }

  /* ---------- 시대 전환 ---------- */
  function advanceEra(s) {
    var guard = 0;
    while (guard++ < 10) {
      var cur = eraById(s.era_id);
      var next = C.ERAS.find(function (e) { return e.order === cur.order + 1; });
      if (!next || !next.unlock(s)) break;
      s.era_id = next.id;
      pushLog(s, next.tip);
      next.unlockSpecies.forEach(function (id) {
        if ((s.species[id] || 0) <= 0) s.species[id] = C.SPECIES_BY_ID[id].seedPop;
      });
    }
  }

  /* ---------- 한 턴 진행 ---------- */
  function tick(state) {
    var before = calcRaw(state);        // 직전 점수 스냅샷(사유 표시용)
    var s = deepCopy(state);
    s.turn += 1;

    // 1) 자연 환경 변화 (교육용 단순화: 선형 근사)
    var photosynth = (s.species.cyano || 0) * 0.005
                   + (s.species.algae || 0) * 0.003
                   + (s.species.land_plants || 0) * 0.0015;
    s.env.o2 = clamp(s.env.o2 + photosynth - 0.02, 0, 25);

    s.env.ghg = clamp(s.env.ghg - 0.3, 0, 100);                 // 온실기체 자연 감소
    var tempTarget = 14 + (s.env.ghg - 30) * 0.15;              // 온실기체가 기준기온을 끌어당김
    s.env.temp = clamp(s.env.temp + (tempTarget - s.env.temp) * 0.15, 0, 32);

    var vegChange = (s.species.land_plants || 0) * 0.02 - 0.4;  // 육상식물이 식생을 만든다
    s.env.land_veg = clamp(s.env.land_veg + vegChange, 0, 100);

    var seaTarget = (s.env.temp - 14) * 1.5;                    // 더우면 해수면 상승(빙하 융해)
    s.env.sea_level = clamp(s.env.sea_level + (seaTarget - s.env.sea_level) * 0.05, -50, 50);

    // 2) 시대 전환 + 신규 생물 seed
    advanceEra(s);

    // 3) 생물 개체수 갱신
    C.SPECIES.forEach(function (sp) {
      var pop = s.species[sp.id] || 0;
      var unlocked = eraOrder(s.era_id) >= eraOrder(sp.eraUnlock);
      if (!unlocked || pop <= 0) { s.species[sp.id] = unlocked ? pop : 0; return; }

      var fit = sp.pref(s.env);                                 // 0~1
      var rate = SIM.GROWTH_BASE * sp.growth * (fit - 0.45);    // 적합도 0.45 기준 증감
      var capacity = SIM.MAX_POP * (0.2 + 0.8 * fit);           // 환경이 좋을수록 수용력↑
      var next = pop + pop * rate * (1 - pop / capacity);       // 로지스틱 성장

      // 해양 보호구역 / 습지: 감소를 40% 완화
      if (s.flags.oceanProtectTurns > 0 && ['algae', 'inverts', 'fish'].indexOf(sp.id) >= 0 && next < pop)
        next = pop - (pop - next) * 0.4;
      if (s.flags.wetlandTurns > 0 && sp.id === 'amphibians' && next < pop)
        next = pop - (pop - next) * 0.4;

      next = clamp(next, 0, SIM.MAX_POP);
      if (next < 1) next = 0;                                   // 멸종

      if (pop >= SIM.SURVIVAL_MIN && next === 0) pushLog(s, sp.name + ' 개체군이 멸종했습니다.');
      s.species[sp.id] = next;

      // 유전적 다양성용: 생존선 미만이 지속되면 누적
      if (next > 0 && next < SIM.SURVIVAL_MIN) s.speciesLowTurns[sp.id] = (s.speciesLowTurns[sp.id] || 0) + 1;
      else if (next >= SIM.SURVIVAL_MIN) s.speciesLowTurns[sp.id] = Math.max(0, (s.speciesLowTurns[sp.id] || 0) - 1);
    });

    // 4) 인류 & 문명 (교육용 단순화: 개체수 임계치로 단계 판정)
    if (s.era_id === 'E6') {
      if (s.humans < 1) {
        s.humans = 1; s.civ_stage = 1;
        pushLog(s, '인류가 출현했습니다. (수렵채집)');
      } else {
        var stable = (s.species.mammals || 0) >= 100 && s.env.temp >= 8 && s.env.temp <= 24;
        s.humans = clamp(s.humans + (stable ? 0.12 * s.humans + 2 : -0.05 * s.humans), 0, SIM.MAX_POP);
        var stage = s.humans >= 120 ? 3 : s.humans >= 40 ? 2 : 1;
        if (stage > s.civ_stage) {
          s.civ_stage = stage;
          pushLog(s, '문명이 발전했습니다: ' + C.CIV_KO[stage]);
        }
        if (s.civ_stage >= 3) s.env.ghg = clamp(s.env.ghg + 0.6, 0, 100);       // 산업문명 → 온실기체 부하
        else if (s.civ_stage >= 2) s.env.ghg = clamp(s.env.ghg + 0.2, 0, 100);
      }
    }

    // 5) 카운트다운
    if (s.flags.oceanProtectTurns > 0) s.flags.oceanProtectTurns--;
    if (s.flags.wetlandTurns > 0) s.flags.wetlandTurns--;
    Object.keys(s.cooldowns).forEach(function (k) { if (s.cooldowns[k] > 0) s.cooldowns[k]--; });

    // 6) 퀘스트 + 점수 기록
    checkQuests(s);
    s.prevScores = before;
    var after = calcRaw(s);
    s.history.push({ turn: s.turn, total: after.total });
    if (s.history.length > 200) s.history.shift();

    return s;
  }

  /* ---------- 행동 적용 ---------- */
  function applyAction(state, actionId) {
    var act = C.ACTION_BY_ID[actionId];
    if (!act) return { ok: false, state: state, message: '알 수 없는 행동' };
    if ((state.cooldowns[actionId] || 0) > 0)
      return { ok: false, state: state, message: act.label + ' 쿨다운 ' + state.cooldowns[actionId] + '턴' };

    var s = deepCopy(state);
    act.effect(s);
    s.cooldowns[actionId] = act.cooldown;
    var extra = s._lastRelocateName ? (' → ' + s._lastRelocateName) : '';
    delete s._lastRelocateName;
    pushLog(s, '[행동] ' + act.label + extra);
    return { ok: true, state: s, message: act.label + ' 실행' };
  }

  /* ---------- 교사 이벤트 적용 ---------- */
  function applyEvent(state, evt) {
    var def = C.EVENT_BY_ID[evt.type];
    if (!def) return { ok: false, state: state };
    var s = deepCopy(state);
    var lv = C.STRENGTH[evt.strength] || 2;
    def.effect(s, lv);
    pushLog(s, '[전지구 이벤트] ' + def.label + ' (' + (C.STRENGTH_KO[evt.strength] || '중') + ')');
    return { ok: true, state: s };
  }

  /* ---------- 퀘스트 ---------- */
  function checkQuests(s) {
    C.QUESTS.forEach(function (q) {
      if (!s.quests[q.id]) s.quests[q.id] = { done: false };
      if (!s.quests[q.id].done && q.check(s)) {
        s.quests[q.id].done = true;
        s.questBonus += q.reward;
        pushLog(s, "'" + q.title + "' 퀘스트 달성! (+" + q.reward + "점)");
      }
    });
  }

  /* ---------- 점수 (각 0~25, 총점 0~100) ---------- */
  var HABITATS = {
    '얕은 바다': ['cyano', 'algae'],
    '깊은 바다': ['fish', 'inverts'],
    '습지·물가': ['amphibians', 'land_plants'],
    '육지': ['reptiles', 'mammals']
  };

  function calcRaw(s) {
    // (1) 생태계 다양성: 활성 서식지 수 + 환경 안정도
    var activeHab = 0;
    Object.keys(HABITATS).forEach(function (k) {
      var on = HABITATS[k].some(function (id) { return (s.species[id] || 0) >= SIM.SURVIVAL_MIN; });
      if (on) activeHab++;
    });
    var goodEnv = C.ENV_VARS.reduce(function (n, v) {
      var val = s.env[v.id];
      return n + (val >= v.good[0] && val <= v.good[1] ? 1 : 0);
    }, 0);
    var eco = clamp(activeHab / 4 * 15 + goodEnv / 5 * 10, 0, 25);

    // (2) 종 다양성: 생존 종 수 + 균형도(심슨 지수 단순화)
    var alivePops = C.SPECIES.map(function (sp) { return s.species[sp.id] || 0; })
      .filter(function (p) { return p >= SIM.SURVIVAL_MIN; });
    var S = alivePops.length;
    var totalPop = alivePops.reduce(function (a, b) { return a + b; }, 0);
    var E = 0;
    if (totalPop > 0) {
      var sumSq = alivePops.reduce(function (a, p) { var r = p / totalPop; return a + r * r; }, 0);
      E = 1 - sumSq; // 0(독점) ~ 1(완전 균등)
    }
    var species = clamp(S / 8 * 12 + E * 13, 0, 25);

    // (3) 유전적 다양성(대리지표): 개체수 규모 + 병목 페널티
    var gPts = C.SPECIES.reduce(function (acc, sp) {
      var pop = s.species[sp.id] || 0;
      var p = pop >= SIM.RICH_POP ? 2 : pop >= SIM.SURVIVAL_MIN ? 1 : 0;
      if ((s.speciesLowTurns[sp.id] || 0) > 3) p -= 1;
      return acc + clamp(p, 0, 2);
    }, 0);
    var genetic = clamp(gPts / (8 * 2) * 25, 0, 25);

    // (4) 지적 생명체 발달
    var intel = 0;
    if ((s.humans || 0) >= 1) {
      var civBonus = [0, 0, 4, 8][s.civ_stage] || 0;
      intel = 10 + civBonus;
      var aliveN = C.countAlive(s);
      if (s.env.ghg <= 60 && aliveN >= 5) intel += 7;
      else if (s.env.ghg > 75 || aliveN < 4) intel -= 3;
      intel = clamp(intel, 0, 25);
    }

    var total = clamp(Math.round(eco + species + genetic + intel) + (s.questBonus || 0), 0, 100);
    return { eco: eco, species: species, genetic: genetic, intel: intel, total: total };
  }

  function calcScores(state) {
    var raw = calcRaw(state);
    var reasons = [];
    if (state.prevScores) {
      [['eco', '생태계 다양성'], ['species', '종 다양성'], ['genetic', '유전적 다양성'], ['intel', '지적 생명체 발달']]
        .forEach(function (p) {
          var d = Math.round(raw[p[0]] - state.prevScores[p[0]]);
          if (d !== 0) reasons.push(p[1] + ' ' + (d > 0 ? '+' : '') + d + '점');
        });
      if (!reasons.length) reasons.push('세부 점수 변화 없음');
    } else {
      reasons.push('시뮬레이션을 시작했습니다.');
    }
    return Object.assign({}, raw, { reasons: reasons });
  }

  global.SIM_ENGINE = {
    migrate: migrate,
    tick: tick,
    applyAction: applyAction,
    applyEvent: applyEvent,
    checkQuests: checkQuests,
    calcScores: calcScores,
    eraOrder: eraOrder
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SIM_ENGINE;

})(typeof window !== 'undefined' ? window : globalThis);
