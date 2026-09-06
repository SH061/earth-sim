/* =====================================================================
 * config.js  —  교육용 지구 진화 시뮬레이션 (1차 MVP)
 * ---------------------------------------------------------------------
 * "규칙과 숫자"만 담는다. 계산은 sim.js, 화면은 ui.js.
 * 브라우저: window.CONFIG / Node 테스트: module.exports
 *
 * state 표준 모양(schema_version: 1):
 * {
 *   schema_version, student:{id,class_no,number,name},
 *   turn, era_id, civ_stage(0없음 1수렵채집 2농경 3산업),
 *   env:{temp,o2,ghg,sea_level,land_veg},
 *   species:{cyano,algae,inverts,fish,land_plants,amphibians,reptiles,mammals},
 *   humans, speciesLowTurns:{}, cooldowns:{}, flags:{oceanProtectTurns,wetlandTurns,hadMassExtinction},
 *   quests:{Q1:{done}}, questBonus,
 *   log:[{turn,text}], lastEventId, prevScores, history:[{turn,total}]
 * }
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- 0. 공용 상수 & 헬퍼 ---------- */
  var CLASS_COUNT = 10;       // 반 개수 (1반 ~ N반). 한 반만 쓰면 1로 바꾸세요.

  var SIM = {
    SCHEMA_VERSION: 1,
    TURN_MS: 8000,           // 자동 진행: 8초에 1턴
    SAVE_EVERY_TURNS: 6,     // 서버 저장: 6턴마다(≈48초). 동시접속이 많을수록 크게.
    SAVE_INTERVAL_MS: 60000, // 안전망 저장: 60초마다
    EVENT_POLL_MS: 20000,    // 교사 이벤트 확인: 20초마다
    SURVIVAL_MIN: 15,        // 미만이면 위기, 0이면 멸종
    HEALTHY_POP: 100,        // 이상이면 번성
    RICH_POP: 250,           // 유전적 다양성 만점 기준
    MAX_POP: 2000,           // 개체수 상한(발산 방지)
    GROWTH_BASE: 0.14,       // 기본 성장 계수
    LOG_MAX: 40
  };

  var STRENGTH = { weak: 1, mid: 2, strong: 3 };
  var STRENGTH_KO = { weak: '약', mid: '중', strong: '강' };
  var CIV_KO = ['', '수렵채집', '농경', '산업'];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // 종 모양 적합도 곡선: center에서 1, 멀수록 0. tol이 클수록 너그럽다.
  function bell(v, center, tol) { var d = (v - center) / tol; return Math.exp(-d * d); }

  // 해수면 지수 → 육지 면적 비율 → 0~1 정규화
  function landNorm(env) {
    var raw = clamp(0.35 - (env.sea_level || 0) / 200, 0.05, 0.5);
    return clamp(raw / 0.35, 0, 1);
  }

  /* ---------- 1. 환경 변수 5개 ---------- */
  var ENV_VARS = [
    { id: 'temp',      label: '평균기온',  unit: '℃', min: 0,   max: 32,  base: 14, good: [10, 22] },
    { id: 'o2',        label: '산소 농도', unit: '%',  min: 0,   max: 25,  base: 1,  good: [15, 23] },
    { id: 'ghg',       label: '온실기체',  unit: '',   min: 0,   max: 100, base: 30, good: [15, 45] },
    { id: 'sea_level', label: '해수면',    unit: '',   min: -50, max: 50,  base: 0,  good: [-15, 15] },
    { id: 'land_veg',  label: '육상 식생', unit: '',   min: 0,   max: 100, base: 0,  good: [40, 90] }
  ];

  /* ---------- 2. 시대 6단계 ----------
   * 진화 순서는 실제 지질/생물 진화와 일치:
   * 광합성(남세균) → 산소 축적 → 오존층 → 육상 진출 → 파충류·포유류 → 인류
   */
  var ERAS = [
    {
      id: 'E1', name: '원시 지구', order: 0,
      desc: '바다만 있고 대기에 산소가 거의 없는 시기입니다.',
      unlock: function () { return true; },
      unlockSpecies: [], spawnHumans: false,
      tip: '원시 지구에서 시뮬레이션이 시작되었습니다.'
    },
    {
      id: 'E2', name: '남세균의 시대', order: 1,
      desc: '남세균이 광합성을 시작하여 산소가 조금씩 쌓입니다.',
      unlock: function (s) { return s.turn >= 2; },
      unlockSpecies: ['cyano'], spawnHumans: false,
      tip: '남세균이 출현해 광합성이 시작되었습니다. (초기 산소는 바다에 먼저 흡수됩니다 — 교육용 단순화)'
    },
    {
      id: 'E3', name: '산소 혁명과 바다의 번성', order: 2,
      desc: '대기 산소가 늘고 오존층이 형성되며 해양 생물이 번성합니다.',
      unlock: function (s) { return s.env.o2 >= 6; },
      unlockSpecies: ['algae', 'inverts', 'fish'], spawnHumans: false,
      tip: '산소 농도가 올라 해조류·무척추동물·어류가 바다에 번성하기 시작했습니다.'
    },
    {
      id: 'E4', name: '육상 진출', order: 3,
      desc: '오존층이 자외선을 막아 식물과 양서류가 뭍으로 올라옵니다.',
      unlock: function (s) { return s.env.o2 >= 14; },
      unlockSpecies: ['land_plants', 'amphibians'], spawnHumans: false,
      tip: '산소가 충분해져 오존층이 두꺼워졌고, 육상 식물과 양서류가 육지로 진출했습니다.'
    },
    {
      id: 'E5', name: '파충류와 포유류의 시대', order: 4,
      desc: '건조에 강한 파충류가 번성하고, 이어 포유류가 확산합니다.',
      unlock: function (s) { return s.env.land_veg >= 28; },
      unlockSpecies: ['reptiles', 'mammals'], spawnHumans: false,
      tip: '육상 식생이 자리 잡아 파충류와 포유류가 등장했습니다.'
    },
    {
      id: 'E6', name: '인류와 문명', order: 5,
      desc: '포유류에서 인류가 출현하여 문명을 발달시킵니다.',
      unlock: function (s) {
        return (s.species.mammals || 0) >= 120 && s.env.temp >= 8 && s.env.temp <= 24;
      },
      unlockSpecies: [], spawnHumans: true,
      tip: '포유류가 안정적으로 번성한 가운데 인류가 출현했습니다.'
    }
  ];

  /* ---------- 3. 생물 8그룹 ----------
   * pref(env): 현재 환경 적합도 0~1 (1이면 최적). 항상 clamp/bell로 감쌌다.
   */
  var SPECIES = [
    {
      id: 'cyano', name: '남세균', eraUnlock: 'E2', seedPop: 60, growth: 1.30,
      pref: function (env) { return clamp(0.55 + 0.45 * bell(env.temp, 22, 20), 0, 1); },
      note: '광합성으로 산소를 만든다. 환경에 관대하다.'
    },
    {
      id: 'algae', name: '해조류', eraUnlock: 'E3', seedPop: 34, growth: 1.05,
      pref: function (env) { return clamp(bell(env.temp, 18, 13) * clamp(env.o2 / 10, 0.1, 1), 0, 1); },
      note: '산소가 있는 바다에서 번성한다.'
    },
    {
      id: 'inverts', name: '해양 무척추동물', eraUnlock: 'E3', seedPop: 24, growth: 0.95,
      pref: function (env) {
        var acid = env.ghg > 65 ? 0.6 : 1; // 온실기체↑ → 산성화 → 불리
        return clamp(bell(env.temp, 20, 10) * clamp((env.o2 - 4) / 10, 0, 1) * acid, 0, 1);
      },
      note: '따뜻하고 산소가 있는 바다를 좋아한다. 산성화에 약하다.'
    },
    {
      id: 'fish', name: '어류', eraUnlock: 'E3', seedPop: 20, growth: 0.9,
      pref: function (env) { return clamp(bell(env.temp, 16, 12) * clamp((env.o2 - 8) / 12, 0, 1), 0, 1); },
      note: '산소가 풍부한 바다가 필요하다.'
    },
    {
      id: 'land_plants', name: '육상 식물', eraUnlock: 'E4', seedPop: 22, growth: 1.05,
      pref: function (env) { return clamp(bell(env.temp, 18, 16) * landNorm(env) * clamp(env.o2 / 12, 0.2, 1), 0, 1); },
      note: '육지 면적과 온난한 기후에서 잘 자란다. 육상 식생을 만든다.'
    },
    {
      id: 'amphibians', name: '양서류', eraUnlock: 'E4', seedPop: 15, growth: 0.85,
      pref: function (env) {
        var moisture = clamp((env.sea_level + 30) / 40, 0.2, 1);
        return clamp(clamp(env.land_veg / 50, 0, 1) * bell(env.temp, 20, 10) * moisture, 0, 1);
      },
      note: '습한 육지와 물가가 필요하다.'
    },
    {
      id: 'reptiles', name: '파충류', eraUnlock: 'E5', seedPop: 13, growth: 0.85,
      pref: function (env) {
        var dry = clamp((20 - Math.max(0, env.sea_level)) / 20, 0.3, 1);
        return clamp(clamp(env.land_veg / 40, 0, 1) * bell(env.temp, 24, 12) * dry, 0, 1);
      },
      note: '건조하고 따뜻한 육지에서 번성한다.'
    },
    {
      id: 'mammals', name: '포유류', eraUnlock: 'E5', seedPop: 11, growth: 0.8,
      pref: function (env) {
        // 체온 조절 → 기온 변화에 강함(tol을 크게)
        return clamp(clamp(env.land_veg / 45, 0, 1) * (0.5 + 0.5 * bell(env.temp, 18, 20)), 0, 1);
      },
      note: '기온 변화에 강하고, 육상 식생이 풍부하면 번성한다. 인류의 조상.'
    }
  ];

  var SPECIES_BY_ID = {};
  SPECIES.forEach(function (sp) { SPECIES_BY_ID[sp.id] = sp; });

  /* ---------- 4. 학생 행동 6개 (환경 3 + 생물 3) ----------
   * effect(state): state를 직접 수정. 쿨다운 검사는 sim.applyAction 담당.
   */
  var ACTIONS = [
    {
      id: 'plant_forest', label: '숲 가꾸기', cooldown: 3, desc: '육상 식생을 크게 늘립니다.',
      effect: function (s) { s.env.land_veg = clamp(s.env.land_veg + 8, 0, 100); }
    },
    {
      id: 'cultivate_algae', label: '해조류 재배', cooldown: 2, desc: '해조류를 늘리고 광합성으로 산소를 조금 올립니다.',
      effect: function (s) {
        if (s.species.algae > 0) s.species.algae = Math.min(SIM.MAX_POP, s.species.algae * 1.15);
        s.env.o2 = clamp(s.env.o2 + 0.7, 0, 25);
      }
    },
    {
      id: 'clean_pollution', label: '오염 정화', cooldown: 3, desc: '대기 중 온실기체를 줄입니다.',
      effect: function (s) { s.env.ghg = clamp(s.env.ghg - 8, 0, 100); }
    },
    {
      id: 'create_wetland', label: '습지 조성', cooldown: 3, desc: '습지를 만들어 양서류를 돕고 식생을 조금 늘립니다.',
      effect: function (s) {
        s.env.land_veg = clamp(s.env.land_veg + 3, 0, 100);
        if (s.species.amphibians > 0) s.species.amphibians = Math.min(SIM.MAX_POP, s.species.amphibians * 1.2);
        s.flags.wetlandTurns = 3;
      }
    },
    {
      id: 'protect_ocean', label: '해양 보호구역', cooldown: 4, desc: '이후 3턴 동안 해양 생물의 감소를 완화합니다.',
      effect: function (s) { s.flags.oceanProtectTurns = 3; }
    },
    {
      id: 'relocate_species', label: '생물 이동·방사', cooldown: 3, desc: '가장 위태로운 생물 그룹의 개체수를 늘려 줍니다.',
      effect: function (s) {
        var worstId = null, worst = Infinity;
        SPECIES.forEach(function (sp) {
          var pop = s.species[sp.id] || 0;
          if (pop > 0 && pop < worst) { worst = pop; worstId = sp.id; }
        });
        if (worstId) {
          s.species[worstId] = Math.min(SIM.MAX_POP, (s.species[worstId] || 0) * 1.3 + 10);
          s._lastRelocateName = SPECIES_BY_ID[worstId].name;
        }
      }
    }
  ];

  var ACTION_BY_ID = {};
  ACTIONS.forEach(function (a) { ACTION_BY_ID[a.id] = a; });

  /* ---------- 5. 퀘스트 5개 ---------- */
  function countAlive(s) {
    return SPECIES.reduce(function (n, sp) { return n + ((s.species[sp.id] || 0) >= SIM.SURVIVAL_MIN ? 1 : 0); }, 0);
  }
  function countThriving(s) {
    return SPECIES.reduce(function (n, sp) { return n + ((s.species[sp.id] || 0) >= SIM.HEALTHY_POP ? 1 : 0); }, 0);
  }

  var QUESTS = [
    { id: 'Q1', title: '첫 숨결', reward: 4, desc: '산소 농도를 10 이상으로 올리세요.',
      check: function (s) { return s.env.o2 >= 10; } },
    { id: 'Q2', title: '육지로', reward: 5, desc: '육상 식물 개체수를 50 이상으로 만드세요.',
      check: function (s) { return (s.species.land_plants || 0) >= 50; } },
    { id: 'Q3', title: '번성하는 세계', reward: 6, desc: '동시에 4개 이상의 생물 그룹을 번성(100 이상) 상태로 유지하세요.',
      check: function (s) { return countThriving(s) >= 4; } },
    { id: 'Q4', title: '대멸종을 넘어', reward: 6, desc: '대멸종을 겪은 뒤 살아 있는 생물 그룹을 6개 이상으로 회복시키세요.',
      check: function (s) { return s.flags.hadMassExtinction && countAlive(s) >= 6; } },
    { id: 'Q5', title: '지성의 탄생', reward: 4, desc: '인류를 출현시키세요.',
      check: function (s) { return (s.humans || 0) >= 1; } }
  ];

  /* ---------- 6. 교사 전역 이벤트 6개 ----------
   * effect(state, level): level 1(약)·2(중)·3(강).
   * '시간 배속'은 이벤트가 아니라 클라이언트 설정으로 처리 → 이벤트는 6개.
   */
  var TEACHER_EVENTS = [
    { id: 'ghg_up', label: '온실기체 증가',
      effect: function (s, lv) { s.env.ghg = clamp(s.env.ghg + [10, 20, 30][lv - 1], 0, 100); } },
    { id: 'ghg_down', label: '온실기체 감소',
      effect: function (s, lv) { s.env.ghg = clamp(s.env.ghg - [10, 20, 30][lv - 1], 0, 100); } },
    { id: 'temp_shift', label: '평균기온 상승',
      effect: function (s, lv) { s.env.temp = clamp(s.env.temp + [2, 4, 6][lv - 1], 0, 32); } },
    { id: 'sea_level_shift', label: '해수면 상승',
      effect: function (s, lv) { s.env.sea_level = clamp(s.env.sea_level + [10, 20, 30][lv - 1], -50, 50); } },
    { id: 'meteor', label: '운석 충돌',
      effect: function (s, lv) {
        s.env.temp = clamp(s.env.temp - [3, 5, 8][lv - 1], 0, 32);
        s.env.land_veg = clamp(s.env.land_veg - [15, 25, 40][lv - 1], 0, 100);
        var kill = [0.30, 0.45, 0.60][lv - 1];
        var pool = SPECIES.map(function (sp) { return sp.id; });
        var hits = 2 + (lv >= 3 ? 1 : 0);
        for (var i = 0; i < hits && pool.length; i++) {
          var idx = Math.floor(Math.random() * pool.length);
          var id = pool.splice(idx, 1)[0];
          if (s.species[id]) s.species[id] = s.species[id] * (1 - kill);
        }
        s.flags.hadMassExtinction = true;
      } },
    { id: 'volcano', label: '화산 활동',
      effect: function (s, lv) {
        s.env.ghg = clamp(s.env.ghg + [8, 14, 20][lv - 1], 0, 100);
        s.env.temp = clamp(s.env.temp + [1, 2, 3][lv - 1], 0, 32);
        s.env.land_veg = clamp(s.env.land_veg - [8, 14, 20][lv - 1], 0, 100);
      } }
  ];

  var EVENT_BY_ID = {};
  TEACHER_EVENTS.forEach(function (e) { EVENT_BY_ID[e.id] = e; });

  /* ---------- 7. 초기 상태 ---------- */
  function createInitialState(student) {
    var s = {
      schema_version: SIM.SCHEMA_VERSION,
      student: student || { id: '', class_no: '', number: '', name: '게스트' },
      turn: 0, era_id: 'E1', civ_stage: 0,
      env: {}, species: {}, humans: 0,
      speciesLowTurns: {}, cooldowns: {},
      flags: { oceanProtectTurns: 0, wetlandTurns: 0, hadMassExtinction: false },
      quests: {}, questBonus: 0,
      log: [], lastEventId: 0, prevScores: null, history: []
    };
    ENV_VARS.forEach(function (v) { s.env[v.id] = v.base; });
    SPECIES.forEach(function (sp) { s.species[sp.id] = 0; s.speciesLowTurns[sp.id] = 0; });
    ACTIONS.forEach(function (a) { s.cooldowns[a.id] = 0; });
    QUESTS.forEach(function (q) { s.quests[q.id] = { done: false }; });
    s.log.push({ turn: 0, text: ERAS[0].tip });
    return s;
  }

  /* ---------- 8. 내보내기 ---------- */
  var CONFIG = {
    CLASS_COUNT: CLASS_COUNT,
    SIM: SIM, STRENGTH: STRENGTH, STRENGTH_KO: STRENGTH_KO, CIV_KO: CIV_KO,
    ENV_VARS: ENV_VARS, ERAS: ERAS,
    SPECIES: SPECIES, SPECIES_BY_ID: SPECIES_BY_ID,
    ACTIONS: ACTIONS, ACTION_BY_ID: ACTION_BY_ID,
    QUESTS: QUESTS,
    TEACHER_EVENTS: TEACHER_EVENTS, EVENT_BY_ID: EVENT_BY_ID,
    clamp: clamp, bell: bell, landNorm: landNorm,
    countAlive: countAlive, countThriving: countThriving,
    createInitialState: createInitialState
  };

  global.CONFIG = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;

})(typeof window !== 'undefined' ? window : globalThis);
