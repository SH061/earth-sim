/* =====================================================================
 * ui.js  —  화면 그리기 전담 (state를 수정하지 않음)
 * 공개 API: window.UI
 *   mount(state)         : 학생 화면 뼈대 1회 생성 + 탭 연결 (main에서 최초 1회)
 *   render(state)        : 값만 갱신 (매 턴). 애니메이션이 끊기지 않도록 in-place 갱신
 *   toast(msg)           : 하단 알림
 *   setSaveStatus(text)  : 저장 상태
 *   renderTeacherTable(students, onRowClick)
 *   renderStudentDetail(row)
 * ===================================================================== */
(function (global) {
  'use strict';
  var C = global.CONFIG;

  function el(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function pct(v, min, max) { return C.clamp((v - min) / (max - min) * 100, 0, 100); }
  function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff; return h; }

  /* =================================================================
   * 생물 SVG (개체수/시대에 따라 stage 1~3로 생김새가 변함 = 진화 표현)
   * ================================================================= */
  var CREATURE = {
    cyano:       { color: '#7fe3a0', anim: 'a-drift', band: [12, 30] },
    algae:       { color: '#49c8a8', anim: 'a-sway',  band: [46, 60] },
    inverts:     { color: '#d59a5c', anim: 'a-drift', band: [54, 68] },
    fish:        { color: '#4fb0e6', anim: 'a-swim',  band: [34, 58] },
    land_plants: { color: '#74c552', anim: 'a-sway',  band: [64, 84] },
    amphibians:  { color: '#84d873', anim: 'a-hop',   band: [60, 80] },
    reptiles:    { color: '#9bbf74', anim: 'a-crawl', band: [72, 90] },
    mammals:     { color: '#cf9f74', anim: 'a-trot',  band: [66, 86] }
  };

  function critStage(pop) { return pop >= 420 ? 3 : pop >= 120 ? 2 : 1; }

  // id + stage → SVG 문자열
  function critSVG(id, stage) {
    var c = CREATURE[id].color;
    var g;
    if (id === 'cyano') {
      if (stage === 1) g = '<circle cx="28" cy="22" r="9" fill="' + c + '"/><circle cx="25" cy="19" r="3" fill="#e2fff0"/>';
      else if (stage === 2) g = [16, 28, 40].map(function (x) { return '<circle cx="' + x + '" cy="22" r="7" fill="' + c + '"/>'; }).join('') + '<circle cx="14" cy="20" r="2" fill="#e2fff0"/>';
      else g = '<ellipse cx="28" cy="22" rx="26" ry="10" fill="' + c + '" opacity=".18"/>' + [8, 18, 28, 38, 48].map(function (x) { return '<circle cx="' + x + '" cy="22" r="6" fill="' + c + '"/>'; }).join('');
    } else if (id === 'algae') {
      if (stage === 1) g = '<path d="M28 42 C26 32 24 30 28 18" stroke="' + c + '" stroke-width="5" fill="none" stroke-linecap="round"/>';
      else if (stage === 2) g = '<path d="M24 42 C22 32 20 30 24 16" stroke="' + c + '" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M34 42 C33 34 32 30 34 20" stroke="' + c + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
      else g = '<path d="M28 44 C25 30 27 24 28 10" stroke="' + c + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="20" cy="22" rx="8" ry="3" fill="' + c + '" transform="rotate(-25 20 22)"/>' +
        '<ellipse cx="36" cy="28" rx="8" ry="3" fill="' + c + '" transform="rotate(25 36 28)"/>' +
        '<ellipse cx="30" cy="14" rx="7" ry="3" fill="' + c + '" transform="rotate(-15 30 14)"/>';
    } else if (id === 'inverts') {
      var base = '<ellipse cx="28" cy="24" rx="' + (9 + stage) + '" ry="6" fill="' + c + '"/>';
      var seg = stage >= 2 ? '<path d="M22 19 V29 M28 18 V30 M34 19 V29" stroke="#8a5a2e" stroke-width="1.5"/>' : '<circle cx="24" cy="23" r="1.4" fill="#3a2a1a"/><circle cx="31" cy="23" r="1.4" fill="#3a2a1a"/>';
      var ant = stage >= 3 ? '<path d="M22 18 L16 9 M34 18 L40 9" stroke="' + c + '" stroke-width="1.6" stroke-linecap="round"/><path d="M22 30 l-3 5 M28 31 l0 5 M34 30 l3 5" stroke="' + c + '" stroke-width="1.6" stroke-linecap="round"/>' : '';
      g = base + seg + ant;
    } else if (id === 'fish') {
      g = '<ellipse cx="26" cy="22" rx="14" ry="8" fill="' + c + '"/><circle cx="19" cy="20" r="1.7" fill="#07202c"/>';
      if (stage >= 2) g += '<path d="M39 22 l11 -7 v14 z" fill="' + c + '"/>';
      if (stage >= 3) g += '<path d="M22 14 l8 -7 5 7 z" fill="' + c + '"/><path d="M24 18 V26 M30 17 V27" stroke="#0a3a52" stroke-width="1.6"/>';
    } else if (id === 'land_plants') {
      if (stage === 1) g = '<path d="M28 44 V28" stroke="#6b4a2a" stroke-width="3"/><ellipse cx="22" cy="27" rx="6" ry="3" fill="' + c + '" transform="rotate(-30 22 27)"/><ellipse cx="34" cy="27" rx="6" ry="3" fill="' + c + '" transform="rotate(30 34 27)"/>';
      else if (stage === 2) g = '<path d="M28 44 V30" stroke="#6b4a2a" stroke-width="4"/><circle cx="28" cy="24" r="9" fill="' + c + '"/><circle cx="20" cy="28" r="7" fill="' + c + '"/><circle cx="36" cy="28" r="7" fill="' + c + '"/>';
      else g = '<rect x="25" y="22" width="6" height="22" fill="#6b4a2a"/><circle cx="28" cy="15" r="12" fill="' + c + '"/><circle cx="17" cy="22" r="8" fill="' + c + '"/><circle cx="39" cy="22" r="8" fill="' + c + '"/>';
    } else if (id === 'amphibians') {
      if (stage === 1) g = '<circle cx="24" cy="24" r="7" fill="' + c + '"/><path d="M30 24 q10 -6 17 0 q-10 5 -17 0 z" fill="' + c + '"/>';
      else if (stage === 2) g = '<circle cx="24" cy="24" r="7" fill="' + c + '"/><path d="M30 24 q9 -5 15 0 q-9 4 -15 0 z" fill="' + c + '"/><path d="M22 30 l-4 6 M27 30 l2 6" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/>';
      else g = '<ellipse cx="28" cy="27" rx="11" ry="8" fill="' + c + '"/><circle cx="22" cy="18" r="3.2" fill="' + c + '"/><circle cx="34" cy="18" r="3.2" fill="' + c + '"/><circle cx="22" cy="18" r="1.3" fill="#08240f"/><circle cx="34" cy="18" r="1.3" fill="#08240f"/><path d="M19 33 l-5 6 M37 33 l5 6 M24 34 l-3 6 M32 34 l3 6" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/>';
    } else if (id === 'reptiles') {
      var tail = stage >= 2 ? 'q-15 2 -19 11' : 'q-10 2 -13 8';
      g = '<ellipse cx="27" cy="24" rx="' + (10 + stage) + '" ry="5" fill="' + c + '"/><circle cx="38" cy="23" r="4" fill="' + c + '"/><path d="M16 24 ' + tail + '" stroke="' + c + '" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M21 28 l-3 6 M33 28 l3 6" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/>';
      if (stage >= 3) g += '<path d="M19 19 l3 -5 3 5 M27 18 l3 -5 3 5 M35 19 l3 -5 3 5" fill="' + c + '"/>';
    } else if (id === 'mammals') {
      if (stage === 1) g = '<ellipse cx="27" cy="26" rx="10" ry="7" fill="' + c + '"/><circle cx="21" cy="17" r="3.5" fill="' + c + '"/><circle cx="30" cy="16" r="3.5" fill="' + c + '"/><circle cx="24" cy="24" r="1.4" fill="#2a1a0c"/><path d="M37 27 q8 0 9 -6" stroke="' + c + '" stroke-width="2" fill="none"/>';
      else if (stage === 2) g = '<ellipse cx="26" cy="24" rx="12" ry="7" fill="' + c + '"/><circle cx="39" cy="21" r="5" fill="' + c + '"/><path d="M18 31 v7 M25 32 v7 M32 32 v7 M38 31 v7" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/><path d="M14 24 q-6 0 -8 6" stroke="' + c + '" stroke-width="2" fill="none"/>';
      else g = '<ellipse cx="25" cy="26" rx="12" ry="7" fill="' + c + '"/><circle cx="40" cy="19" r="7.5" fill="' + c + '"/><circle cx="40" cy="14" r="1.6" fill="#ffe08a"/><path d="M17 32 v7 M24 33 v7 M31 33 v7 M37 32 v7" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/>';
    } else {
      g = '<circle cx="28" cy="22" r="8" fill="' + c + '"/>';
    }
    return '<svg viewBox="0 0 56 44">' + g + '</svg>';
  }

  /* =================================================================
   * mount — 뼈대 1회 생성
   * ================================================================= */
  var mounted = false;
  var prevEnv = {};
  var prevTotal = null;
  var lastSceneSig = '';

  function mount(state) {
    if (mounted || !el('envList')) return;
    mounted = true;

    // --- 탭 전환 ---
    var tabBar = el('tabBar');
    if (tabBar) {
      tabBar.addEventListener('click', function (e) {
        var b = e.target.closest('.tab'); if (!b) return;
        var name = b.getAttribute('data-tab');
        tabBar.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('is-active', t === b); });
        document.querySelectorAll('.view').forEach(function (v) {
          v.classList.toggle('is-active', v.getAttribute('data-view') === name);
        });
      });
    }

    // --- 환경 게이지 ---
    el('envList').innerHTML = C.ENV_VARS.map(function (v) {
      var lo = pct(v.good[0], v.min, v.max);
      var hi = pct(v.good[1], v.min, v.max);
      return '<div class="env-row" data-env="' + v.id + '">'
        + '<div class="env-name">' + v.label + '</div>'
        + '<div class="bar"><div class="bar-zone" style="left:' + lo + '%;width:' + (hi - lo) + '%"></div>'
        + '<div class="bar-fill"></div></div>'
        + '<div class="env-val"><span class="num">-</span><span class="trend"></span></div>'
        + '</div>';
    }).join('');

    // --- 생물 카드 ---
    el('speciesList').innerHTML = C.SPECIES.map(function (sp) {
      return '<div class="sp-card" data-sp="' + sp.id + '" data-stage="0">'
        + '<div class="sp-icon"></div>'
        + '<div class="sp-name">' + sp.name + '</div>'
        + '<div class="sp-pop">0</div>'
        + '<div class="tag st-none">미출현</div>'
        + '<div class="bar sm"><div class="bar-fill"></div></div>'
        + '</div>';
    }).join('');

    // --- 점수 4행 ---
    var SC = [['eco', '생태계 다양성'], ['species', '종 다양성'], ['genetic', '유전적 다양성'], ['intel', '지적 생명체 발달']];
    el('scoreList').innerHTML = SC.map(function (p) {
      return '<div class="score-row" data-sc="' + p[0] + '">'
        + '<div class="s-name">' + p[1] + '</div>'
        + '<div class="bar"><div class="bar-fill"></div></div>'
        + '<div class="s-val">-</div></div>';
    }).join('');

    // --- 퀘스트 ---
    el('questList').innerHTML = C.QUESTS.map(function (qt) {
      return '<li data-quest="' + qt.id + '"><span class="mk">□</span> <b>' + esc(qt.title) + '</b> — ' + esc(qt.desc) + ' (+' + qt.reward + ')</li>';
    }).join('');

    // --- 행동 버튼 ---
    el('actions').innerHTML = C.ACTIONS.map(function (a) {
      return '<button data-action="' + a.id + '" title="' + esc(a.desc) + '"><span class="lbl">' + a.label + '</span></button>';
    }).join('');

    // --- 행성 리드아웃 4칸 ---
    el('planetReadout').innerHTML = [
      ['total', '총점'], ['alive', '살아있는 종'], ['o2', '산소'], ['temp', '평균기온']
    ].map(function (p) {
      return '<div class="ro-cell" data-ro="' + p[0] + '"><div class="ro-k">' + p[1] + '</div><div class="ro-v">-</div></div>';
    }).join('');

    // --- 바다 기포(장식) ---
    var scene = el('planetScene');
    for (var i = 0; i < 7; i++) {
      var b = document.createElement('span');
      b.className = 'bubble';
      b.style.left = (6 + Math.random() * 88) + '%';
      b.style.animationDuration = (7 + Math.random() * 8) + 's';
      b.style.animationDelay = '-' + (Math.random() * 10) + 's';
      scene.appendChild(b);
    }
  }

  /* =================================================================
   * render — 값만 갱신
   * ================================================================= */
  function render(state) {
    if (!el('envList')) return;
    var sc = global.SIM_ENGINE.calcScores(state);
    var era = C.ERAS.find(function (e) { return e.id === state.era_id; }) || C.ERAS[0];

    // 상단 HUD
    el('stuName').textContent = (state.student && state.student.name) || '학생';
    el('eraBadge').textContent = era.name;
    el('turnInfo').textContent = '턴 ' + state.turn + (state.civ_stage ? ' · ' + C.CIV_KO[state.civ_stage] : '');
    var tScore = Math.round(sc.total);
    el('totalScore').textContent = tScore;
    if (prevTotal !== null && tScore !== prevTotal) {
      var big = el('scoreBig');
      big.classList.add('bump');
      setTimeout(function () { big.classList.remove('bump'); }, 220);
    }
    prevTotal = tScore;

    // 환경 게이지
    C.ENV_VARS.forEach(function (v) {
      var row = q('.env-row[data-env="' + v.id + '"]');
      if (!row) return;
      var val = state.env[v.id];
      var w = pct(val, v.min, v.max);
      var good = val >= v.good[0] && val <= v.good[1];
      var fill = q('.bar-fill', row);
      fill.style.width = w + '%';
      fill.className = 'bar-fill ' + (good ? 'ok' : 'warn');
      q('.num', row).textContent = r1(val) + v.unit;
      var tr = q('.trend', row);
      var prev = prevEnv[v.id];
      if (prev === undefined || Math.abs(val - prev) < 0.05) { tr.textContent = '·'; tr.className = 'trend'; }
      else if (val > prev) { tr.textContent = '▲'; tr.className = 'trend up'; }
      else { tr.textContent = '▼'; tr.className = 'trend down'; }
      prevEnv[v.id] = val;
    });

    // 생물 카드
    C.SPECIES.forEach(function (sp) {
      var card = q('.sp-card[data-sp="' + sp.id + '"]');
      if (!card) return;
      var pop = state.species[sp.id] || 0;
      var unlocked = global.SIM_ENGINE.eraOrder(state.era_id) >= global.SIM_ENGINE.eraOrder(sp.eraUnlock);
      var st = statusOf(pop, unlocked);
      var stage = pop > 0 ? critStage(pop) : 0;
      if (String(stage) !== card.getAttribute('data-stage')) {
        card.setAttribute('data-stage', String(stage));
        q('.sp-icon', card).innerHTML = stage > 0 ? critSVG(sp.id, stage) : '';
      }
      q('.sp-pop', card).textContent = Math.round(pop);
      var tag = q('.tag', card);
      tag.textContent = st.t; tag.className = 'tag ' + st.c;
      q('.bar-fill', card).style.width = C.clamp(pop / 400 * 100, 0, 100) + '%';
    });

    // 점수 4행
    ['eco', 'species', 'genetic', 'intel'].forEach(function (k) {
      var row = q('.score-row[data-sc="' + k + '"]');
      if (!row) return;
      q('.bar-fill', row).style.width = C.clamp(sc[k] / 25 * 100, 0, 100) + '%';
      q('.s-val', row).textContent = r1(sc[k]) + '/25';
    });
    el('reasons').innerHTML = sc.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');

    // 퀘스트
    C.QUESTS.forEach(function (qt) {
      var li = q('li[data-quest="' + qt.id + '"]');
      if (!li) return;
      var done = state.quests[qt.id] && state.quests[qt.id].done;
      li.classList.toggle('q-done', !!done);
      q('.mk', li).textContent = done ? '✔' : '□';
    });

    // 행동 버튼 (쿨다운)
    C.ACTIONS.forEach(function (a) {
      var btn = q('button[data-action="' + a.id + '"]');
      if (!btn) return;
      var cd = state.cooldowns[a.id] || 0;
      btn.disabled = cd > 0;
      q('.lbl', btn).textContent = a.label + (cd > 0 ? ' (' + cd + ')' : '');
    });

    // 로그 (최근 12, 최신이 위)
    el('logList').innerHTML = state.log.slice(-12).reverse().map(function (l) {
      return '<li><span class="lt">' + l.turn + 'T</span>' + esc(l.text) + '</li>';
    }).join('');

    // 행성 뷰
    renderPlanet(state, sc, era);
  }

  function statusOf(pop, unlocked) {
    if (!unlocked && pop <= 0) return { t: '미출현', c: 'st-none' };
    if (pop <= 0) return { t: '멸종', c: 'st-ext' };
    if (pop < C.SIM.SURVIVAL_MIN) return { t: '위기', c: 'st-risk' };
    if (pop >= C.SIM.HEALTHY_POP) return { t: '번성', c: 'st-boom' };
    return { t: '유지', c: 'st-ok' };
  }

  function renderPlanet(state, sc, era) {
    var scene = el('planetScene');
    if (!scene) return;

    // 배경 색을 환경값에 맞춰 (CSS 변수)
    var o2n = pct(state.env.o2, 0, 25);
    var vegn = pct(state.env.land_veg, 0, 100);
    var tempn = pct(state.env.temp, 0, 32);
    scene.style.setProperty('--sky-b', 'hsl(' + (206 - o2n * 0.45) + ',58%,' + (22 + o2n * 0.24) + '%)');
    scene.style.setProperty('--sky-a', 'hsl(210,55%,' + (12 + o2n * 0.12) + '%)');
    scene.style.setProperty('--sea-a', 'hsl(198,' + (44 + tempn * 0.25) + '%,' + (24 + tempn * 0.08) + '%)');
    scene.style.setProperty('--land', (16 + vegn * 0.52).toFixed(1) + '%');
    scene.style.setProperty('--land-a', 'hsl(' + (98 - vegn * 0.12) + ',' + (22 + vegn * 0.4) + '%,' + (22 + vegn * 0.12) + '%)');

    el('sceneCaption').textContent = era.desc;

    // 리드아웃
    setRO('total', Math.round(sc.total), '');
    setRO('alive', C.countAlive(state) + ' / 8', C.countAlive(state) >= 5 ? 'good' : (C.countAlive(state) < 3 ? 'warn' : ''));
    setRO('o2', r1(state.env.o2) + '%', state.env.o2 >= 15 ? 'good' : (state.env.o2 < 6 ? 'warn' : ''));
    setRO('temp', r1(state.env.temp) + '℃', (state.env.temp >= 10 && state.env.temp <= 22) ? 'good' : 'warn');

    // 생물 스프라이트 — 종류/개체수단계/시대가 바뀔 때만 다시 그림(애니메이션 리셋 방지)
    var sig = state.era_id + '|' + C.SPECIES.map(function (sp) {
      var pop = state.species[sp.id] || 0;
      if (pop < C.SIM.SURVIVAL_MIN) return '';
      var n = C.clamp(Math.round(pop / 120), 1, 5);
      return sp.id + n + critStage(pop);
    }).join(',');
    if (sig === lastSceneSig) return;
    lastSceneSig = sig;

    var html = '';
    C.SPECIES.forEach(function (sp) {
      var pop = state.species[sp.id] || 0;
      if (pop < C.SIM.SURVIVAL_MIN) return;
      var n = C.clamp(Math.round(pop / 120), 1, 5);
      var stage = critStage(pop);
      var cr = CREATURE[sp.id];
      var h = hash(sp.id);
      for (var i = 0; i < n; i++) {
        var left = 6 + ((i * 19 + h) % 82);
        var top = cr.band[0] + (hash(sp.id + i) % 100) / 100 * (cr.band[1] - cr.band[0]);
        var delay = (i * 1.3 + (h % 5)).toFixed(1);
        html += '<span class="crit s' + stage + ' ' + cr.anim + '" style="left:' + left + '%;top:' + top.toFixed(1) + '%;animation-delay:-' + delay + 's">' + critSVG(sp.id, stage) + '</span>';
      }
    });
    el('sceneLife').innerHTML = html;
  }

  function setRO(key, val, cls) {
    var cell = q('.ro-cell[data-ro="' + key + '"]');
    if (!cell) return;
    var v = q('.ro-v', cell);
    v.textContent = val;
    v.className = 'ro-v' + (cls ? ' ' + cls : '');
  }

  /* ---------- 공용 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = el('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function setSaveStatus(txt) { var s = el('saveStatus'); if (s) s.textContent = txt; }

  /* =================================================================
   * 교사 화면 (마크업 그대로)
   * ================================================================= */
  function renderTeacherTable(students, onRowClick) {
    var tb = q('#stuTable tbody');
    if (!tb) return;
    tb.innerHTML = students.map(function (row) {
      var eraName = (C.ERAS.find(function (e) { return e.id === row.era_id; }) || {}).name || row.era_id;
      var upd = row.updated_at ? new Date(row.updated_at).toLocaleTimeString('ko-KR') : '-';
      return '<tr data-id="' + esc(row.student_id) + '">'
        + '<td>' + esc(row.class_no) + '</td>'
        + '<td>' + esc(row.number) + '</td>'
        + '<td>' + esc(row.name) + '</td>'
        + '<td>' + esc(eraName) + '</td>'
        + '<td>' + (row.turn || 0) + '</td>'
        + '<td>' + r1(row.eco) + '</td>'
        + '<td>' + r1(row.species_score) + '</td>'
        + '<td>' + r1(row.genetic) + '</td>'
        + '<td>' + r1(row.intel) + '</td>'
        + '<td><strong>' + r1(row.total) + '</strong></td>'
        + '<td>' + upd + '</td>'
        + '</tr>';
    }).join('');
    Array.prototype.forEach.call(tb.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () {
        var row = students.find(function (s) { return s.student_id === tr.getAttribute('data-id'); });
        if (row && onRowClick) onRowClick(row);
      });
    });
  }

  function renderStudentDetail(row) {
    var panel = el('detailPanel'), body = el('detailBody');
    if (!panel || !body) return;
    panel.hidden = false;
    el('detailName').textContent = '(' + row.class_no + '반 ' + row.number + '번 ' + row.name + ')';

    var envHtml = C.ENV_VARS.map(function (v) {
      return '<div>' + v.label + '</div><div>' + r1(row.env[v.id]) + v.unit + '</div>';
    }).join('');
    var spHtml = C.SPECIES.map(function (sp) {
      var pop = (row.species && row.species[sp.id]) || 0;
      return '<div>' + sp.name + '</div><div>' + Math.round(pop) + '</div>';
    }).join('');

    body.innerHTML =
      '<h3>환경</h3><div class="kv">' + envHtml + '</div>'
      + '<h3>생물 개체수</h3><div class="kv">' + spHtml + '</div>'
      + '<h3>기타</h3><div class="kv">'
      + '<div>인류</div><div>' + (row.humans || 0) + '</div>'
      + '<div>문명 단계</div><div>' + (C.CIV_KO[row.civ_stage] || '없음') + '</div>'
      + '<div>살아있는 그룹</div><div>' + (row.alive || 0) + ' / 8</div>'
      + '<div>총점</div><div>' + r1(row.total) + ' / 100</div>'
      + '</div>';
  }

  global.UI = {
    mount: mount,
    render: render,
    toast: toast,
    setSaveStatus: setSaveStatus,
    renderTeacherTable: renderTeacherTable,
    renderStudentDetail: renderStudentDetail
  };
})(typeof window !== 'undefined' ? window : globalThis);
