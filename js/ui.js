/* =====================================================================
 * ui.js  —  화면 그리기 전담 (state를 절대 수정하지 않음)
 * 공개 API: window.UI
 *   render(state)        : 학생 화면 전체 다시 그리기
 *   toast(msg)           : 하단 알림
 *   setSaveStatus(text)  : 저장 상태 텍스트
 *   renderTeacherTable(students, onRowClick)
 *   renderStudentDetail(row)
 * ===================================================================== */
(function (global) {
  'use strict';
  var C = global.CONFIG;

  function el(id) { return document.getElementById(id); }
  function pct(v, min, max) { return C.clamp((v - min) / (max - min) * 100, 0, 100); }
  function r1(x) { return Math.round((Number(x) || 0) * 10) / 10; }
  function esc(t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function speciesStatus(pop, unlocked) {
    if (!unlocked && pop <= 0) return { t: '미출현', c: 'st-none' };
    if (pop <= 0) return { t: '멸종', c: 'st-ext' };
    if (pop < C.SIM.SURVIVAL_MIN) return { t: '위기', c: 'st-risk' };
    if (pop >= C.SIM.HEALTHY_POP) return { t: '번성', c: 'st-boom' };
    return { t: '유지', c: 'st-ok' };
  }

  function scoreRow(name, val) {
    var w = C.clamp(val / 25 * 100, 0, 100);
    return '<div class="score-row"><div class="s-name">' + name + '</div>'
      + '<div class="bar"><div class="bar-fill" style="width:' + w + '%"></div></div>'
      + '<div class="s-val">' + r1(val) + '/25</div></div>';
  }

  /* ---------- 학생 화면 ---------- */
  function render(state) {
    var sc = global.SIM_ENGINE.calcScores(state);
    var era = C.ERAS.find(function (e) { return e.id === state.era_id; }) || C.ERAS[0];

    el('stuName').textContent = (state.student && state.student.name) || '학생';
    el('eraBadge').textContent = era.name;
    el('turnInfo').textContent = '턴 ' + state.turn
      + (state.civ_stage ? ' · ' + C.CIV_KO[state.civ_stage] + ' 문명' : '');
    el('totalScore').textContent = Math.round(sc.total);

    // 환경 게이지
    el('envList').innerHTML = C.ENV_VARS.map(function (v) {
      var val = state.env[v.id];
      var w = pct(val, v.min, v.max);
      var good = val >= v.good[0] && val <= v.good[1];
      return '<div class="env-row">'
        + '<div class="env-name">' + v.label + '</div>'
        + '<div class="bar"><div class="bar-fill ' + (good ? 'ok' : 'warn') + '" style="width:' + w + '%"></div></div>'
        + '<div class="env-val">' + r1(val) + v.unit + '</div>'
        + '</div>';
    }).join('');

    // 분위기 배경 (교육용 단순화: 산소=하늘 밝기, 식생=초록, 해수면=파랑 비중)
    var o2n = pct(state.env.o2, 0, 25);
    var veg = pct(state.env.land_veg, 0, 100);
    var sea = pct(state.env.sea_level, -50, 50);
    var mood = el('moodBox');
    mood.style.background = 'linear-gradient(180deg,'
      + ' hsl(' + (205 - o2n * 0.35) + ',75%,' + (58 - o2n * 0.12) + '%) 0%,'
      + ' hsl(' + (130 - sea * 0.3) + ',' + (28 + veg * 0.4) + '%,' + (46 + veg * 0.12) + '%) 100%)';
    mood.textContent = era.desc;

    // 생물 카드
    el('speciesList').innerHTML = C.SPECIES.map(function (sp) {
      var pop = state.species[sp.id] || 0;
      var unlocked = global.SIM_ENGINE.eraOrder(state.era_id) >= global.SIM_ENGINE.eraOrder(sp.eraUnlock);
      var st = speciesStatus(pop, unlocked);
      var w = C.clamp(pop / 300 * 100, 0, 100);
      return '<div class="sp-card">'
        + '<div class="sp-top"><span>' + sp.name + '</span><span class="tag ' + st.c + '">' + st.t + '</span></div>'
        + '<div class="sp-pop">' + Math.round(pop) + '</div>'
        + '<div class="bar sm"><div class="bar-fill" style="width:' + w + '%"></div></div>'
        + '</div>';
    }).join('');

    // 행동 버튼
    el('actions').innerHTML = C.ACTIONS.map(function (a) {
      var cd = state.cooldowns[a.id] || 0;
      return '<button data-action="' + a.id + '" ' + (cd > 0 ? 'disabled' : '') + ' title="' + esc(a.desc) + '">'
        + a.label + (cd > 0 ? ' (' + cd + ')' : '') + '</button>';
    }).join('');

    // 점수
    el('scoreList').innerHTML =
      scoreRow('생태계 다양성', sc.eco) +
      scoreRow('종 다양성', sc.species) +
      scoreRow('유전적 다양성', sc.genetic) +
      scoreRow('지적 생명체 발달', sc.intel);
    el('reasons').innerHTML = sc.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');

    // 퀘스트
    el('questList').innerHTML = C.QUESTS.map(function (q) {
      var done = state.quests[q.id] && state.quests[q.id].done;
      return '<li class="' + (done ? 'q-done' : '') + '">'
        + (done ? '✔ ' : '□ ') + '<strong>' + q.title + '</strong> — ' + esc(q.desc) + ' (+' + q.reward + ')'
        + '</li>';
    }).join('');

    // 로그 (최근 10, 최신이 위)
    el('logList').innerHTML = state.log.slice(-10).reverse().map(function (l) {
      return '<li><span class="lt">' + l.turn + '턴</span> ' + esc(l.text) + '</li>';
    }).join('');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }
  function setSaveStatus(txt) { var s = el('saveStatus'); if (s) s.textContent = txt; }

  /* ---------- 교사 화면 ---------- */
  function renderTeacherTable(students, onRowClick) {
    var tb = document.querySelector('#stuTable tbody');
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
    var panel = el('detailPanel');
    var body = el('detailBody');
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
    render: render,
    toast: toast,
    setSaveStatus: setSaveStatus,
    renderTeacherTable: renderTeacherTable,
    renderStudentDetail: renderStudentDetail
  };
})(typeof window !== 'undefined' ? window : globalThis);
