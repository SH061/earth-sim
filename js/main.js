/* =====================================================================
 * main.js  —  전체 조립 (페이지별 초기화 · 루프 · 저장 · 이벤트 수신)
 * body[data-page] 값으로 login / student / teacher 분기.
 * ===================================================================== */
(function () {
  'use strict';

  /* ★★★ 여기에 배포한 Apps Script 웹앱 URL 을 붙여넣으세요 ★★★
   * 예: https://script.google.com/macros/s/AKfycb....../exec
   * 비워두면 서버 저장 없이 이 브라우저(localStorage)에서만 동작합니다. */
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwV0xfCka-BW3og_pPZr76Bedawwb01-skR98mBF6kEO3UJAxv4MRdDCg7WBEUAGEI/exec';

  window.API.setUrl(APPS_SCRIPT_URL);

  var page = document.body.getAttribute('data-page');
  if (page === 'login') initLogin();
  else if (page === 'student') initStudent();
  else if (page === 'teacher') initTeacher();

  function now() { return new Date().toLocaleTimeString('ko-KR'); }

  /* ================================================================
   * 1) 로그인 화면
   * ============================================================== */
  function initLogin() {
    var sel = document.getElementById('inClass');
    for (var i = 1; i <= window.CONFIG.CLASS_COUNT; i++) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = i + '반';
      sel.appendChild(o);
    }

    var form = document.getElementById('loginForm');
    var msg = document.getElementById('loginMsg');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var info = {
        class_no: document.getElementById('inClass').value,
        number: document.getElementById('inNumber').value,
        name: document.getElementById('inName').value.trim(),
        password: document.getElementById('inPw').value.trim()
      };
      if (!info.name) { msg.textContent = '이름을 입력하세요.'; return; }
      if (!/^[0-9]{4}$/.test(info.password)) { msg.textContent = '비밀번호는 숫자 4자리입니다.'; return; }

      msg.textContent = '확인 중...';

      if (!window.API.getUrl()) {
        // URL 미설정 → 오프라인 모드로 바로 시작
        startOffline(info);
        return;
      }

      window.API.login(info).then(function (res) {
        if (res && res.ok) {
          var session = { student: res.student, state: res.state || null };
          localStorage.setItem('sim_session', JSON.stringify(session));
          location.href = 'student.html';
        } else {
          msg.textContent = (res && res.error) || '로그인에 실패했습니다.';
        }
      }).catch(function () {
        if (confirm('서버에 연결할 수 없습니다.\n오프라인으로 시작할까요? (저장은 이 브라우저에만 됩니다)')) {
          startOffline(info);
        } else {
          msg.textContent = '서버 연결 실패';
        }
      });
    });

    function startOffline(info) {
      var student = {
        id: info.class_no + '-' + info.number,
        class_no: info.class_no, number: info.number, name: info.name
      };
      // 이전 오프라인 백업이 있으면 이어하기
      var backup = null;
      try { backup = JSON.parse(localStorage.getItem('sim_backup_' + student.id) || 'null'); } catch (e) {}
      localStorage.setItem('sim_session', JSON.stringify({ student: student, state: backup }));
      location.href = 'student.html';
    }
  }

  /* ================================================================
   * 2) 학생 시뮬레이션 화면
   * ============================================================== */
  function initStudent() {
    var session = null;
    try { session = JSON.parse(localStorage.getItem('sim_session') || 'null'); } catch (e) {}
    if (!session || !session.student) { location.href = 'index.html'; return; }

    var ENGINE = window.SIM_ENGINE;
    var state = session.state
      ? ENGINE.migrate(session.state)
      : window.CONFIG.createInitialState(session.student);
    state.student = session.student; // 이름/반 최신화

    var paused = false;
    var saving = false;
    var lastSavedTurn = -1;

    window.UI.render(state);
    window.UI.setSaveStatus(window.API.getUrl() ? '준비됨' : '오프라인 모드');

    // --- 자동 턴 루프 ---
    setInterval(function () {
      if (paused) return;
      state = ENGINE.tick(state);
      window.UI.render(state);
      // N턴마다 서버 저장 (동시접속 부하를 줄이려 간격을 크게 잡음)
      if (state.turn !== lastSavedTurn && state.turn % window.CONFIG.SIM.SAVE_EVERY_TURNS === 0) {
        lastSavedTurn = state.turn;
        doSave(true);
      }
    }, window.CONFIG.SIM.TURN_MS);

    // --- 안전망: 60초마다 저장 ---
    setInterval(function () { doSave(true); }, window.CONFIG.SIM.SAVE_INTERVAL_MS);

    // --- 교사 이벤트 확인 (학생마다 시작 시점을 흩뜨려 요청이 몰리지 않게) ---
    setTimeout(function () {
      pollEvents();
      setInterval(pollEvents, window.CONFIG.SIM.EVENT_POLL_MS);
    }, Math.random() * window.CONFIG.SIM.EVENT_POLL_MS);

    // --- 5초마다 입장 허용 여부 확인 → 교사가 차단하면 저장 후 강제 종료 ---
    setInterval(checkGate, 5000);

    // --- 버튼 ---
    document.getElementById('btnPause').addEventListener('click', function () {
      paused = !paused;
      this.textContent = paused ? '재개' : '일시정지';
      window.UI.toast(paused ? '일시정지됨' : '재개됨');
    });
    document.getElementById('btnSave').addEventListener('click', function () { doSave(false); });

    // 행동 버튼 (이벤트 위임)
    document.getElementById('actions').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-action]');
      if (!b) return;
      var res = ENGINE.applyAction(state, b.getAttribute('data-action'));
      if (res.ok) state = res.state;
      window.UI.toast(res.message);
      window.UI.render(state);
    });

    // 페이지를 떠날 때 마지막 저장 시도
    window.addEventListener('beforeunload', function () {
      try {
        localStorage.setItem('sim_session', JSON.stringify({ student: state.student, state: state }));
        localStorage.setItem('sim_backup_' + state.student.id, JSON.stringify(state));
      } catch (e) {}
      var url = window.API.getUrl();
      if (url && navigator.sendBeacon) {
        var sc = ENGINE.calcScores(state);
        var payload = JSON.stringify({ action: 'saveState', student_id: state.student.id, state: state, scores: sc });
        try { navigator.sendBeacon(url, payload); } catch (e) {}
      }
    });

    function doSave(silent) {
      // 세션 캐시는 항상 갱신
      try { localStorage.setItem('sim_session', JSON.stringify({ student: state.student, state: state })); } catch (e) {}
      if (!window.API.getUrl()) { window.UI.setSaveStatus('오프라인 저장 · ' + now()); return; }
      if (saving) return;
      saving = true;
      if (!silent) window.UI.setSaveStatus('저장 중...');
      var sc = ENGINE.calcScores(state);
      window.API.saveState(state.student.id, state, sc).then(function (res) {
        saving = false;
        if (res && res.ok) window.UI.setSaveStatus('저장됨 · ' + now());
        else window.UI.setSaveStatus('오프라인(로컬 저장) · ' + now());
      });
    }

    var kicked = false;
    function checkGate() {
      if (kicked || !window.API.getUrl()) return;
      window.API.ping().then(function (res) {
        // 확실히 false 일 때만 종료 (네트워크 오류 시엔 그대로 진행)
        if (res && res.ok && res.login_open === false) kickOut();
      });
    }

    function kickOut() {
      if (kicked) return;
      kicked = true;
      paused = true;
      window.UI.setSaveStatus('입장이 마감되어 저장 후 종료합니다…');
      window.UI.toast('교사가 입장을 마감했습니다. 저장 후 종료합니다.');

      // 1) 로컬 백업 즉시
      try {
        localStorage.setItem('sim_session', JSON.stringify({ student: state.student, state: state }));
        localStorage.setItem('sim_backup_' + state.student.id, JSON.stringify(state));
      } catch (e) {}

      // 2) 서버 저장 후 구글로 이동
      var sc = ENGINE.calcScores(state);
      window.API.saveState(state.student.id, state, sc).then(leave, leave);

      // 3) 저장이 늦어도 3초 후엔 강제 이동
      setTimeout(leave, 3000);

      function leave() { location.href = 'https://www.google.com'; }
    }

    function pollEvents() {
      if (!window.API.getUrl()) return;
      window.API.getEvents(state.lastEventId || 0).then(function (res) {
        if (!res || !res.ok || !res.events || !res.events.length) return;
        var n = 0;
        res.events.forEach(function (evt) {
          var r = ENGINE.applyEvent(state, evt);
          if (r.ok) { state = r.state; n++; }
          state.lastEventId = Math.max(state.lastEventId || 0, evt.id);
        });
        if (n) {
          window.UI.render(state);
          window.UI.toast('교사 이벤트 ' + n + '건이 반영되었습니다');
          doSave(true);
        }
      });
    }
  }

  /* ================================================================
   * 3) 교사 대시보드
   * ============================================================== */
  function initTeacher() {
    var C = window.CONFIG;
    var pw = '';
    var autoTimer = null;

    var gate = document.getElementById('gate');
    var dash = document.getElementById('dash');
    var gateForm = document.getElementById('gateForm');
    var gateMsg = document.getElementById('gateMsg');

    // 반 선택 드롭다운 채우기 (전체 + 1~N반)
    var classSel = document.getElementById('classFilter');
    classSel.innerHTML = '<option value="">전체</option>'
      + Array.from({ length: C.CLASS_COUNT }, function (_, i) {
          return '<option value="' + (i + 1) + '">' + (i + 1) + '반</option>';
        }).join('');
    classSel.addEventListener('change', refresh);

    function currentClass() { return classSel.value; }

    // --- 학생 입장 on/off 토글 ---
    var loginOpen = null; // null=아직 모름
    var btnLogin = document.getElementById('btnLoginToggle');

    function applyLoginOpenUI(open) {
      loginOpen = !!open;
      btnLogin.classList.toggle('on', loginOpen);
      btnLogin.classList.toggle('off', !loginOpen);
      btnLogin.textContent = loginOpen ? '학생 입장: 허용됨 (누르면 차단)' : '학생 입장: 차단됨 (누르면 허용)';
    }

    btnLogin.addEventListener('click', function () {
      if (!pw || loginOpen === null) return;
      var next = !loginOpen;
      btnLogin.textContent = '변경 중…';
      window.API.setLoginOpen(pw, next).then(function (res) {
        if (res && res.ok) {
          applyLoginOpenUI(res.login_open);
          document.getElementById('evtMsg').textContent =
            (res.login_open ? '학생 입장을 허용했습니다.' : '학생 입장을 차단했습니다.') + ' · ' + now();
        } else {
          applyLoginOpenUI(loginOpen); // 원상 복구
          document.getElementById('evtMsg').textContent = (res && res.error) || '변경 실패';
        }
      });
    });

    // 이벤트 버튼 생성
    document.getElementById('eventBtns').innerHTML = C.TEACHER_EVENTS.map(function (ev) {
      return '<span class="evt-item">'
        + '<select data-strength-for="' + ev.id + '">'
        + '<option value="weak">약</option><option value="mid" selected>중</option><option value="strong">강</option>'
        + '</select>'
        + '<button data-evt="' + ev.id + '">' + ev.label + '</button>'
        + '</span>';
    }).join('');

    gateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = document.getElementById('teacherPw').value.trim();
      if (!v) return;
      gateMsg.textContent = '확인 중...';
      window.API.getAllStudents(v, currentClass()).then(function (res) {
        if (res && res.ok) {
          pw = v;
          gate.hidden = true;
          dash.hidden = false;
          if (res.login_open !== undefined) applyLoginOpenUI(res.login_open);
          renderTable(res.students || []);
          startAuto();
        } else {
          gateMsg.textContent = (res && res.error) || '입장 실패';
        }
      });
    });

    document.getElementById('btnRefresh').addEventListener('click', refresh);
    document.getElementById('autoRef').addEventListener('change', function () {
      if (this.checked) startAuto(); else stopAuto();
    });

    document.getElementById('eventBtns').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-evt]');
      if (!b) return;
      var type = b.getAttribute('data-evt');
      var sel = document.querySelector('select[data-strength-for="' + type + '"]');
      var strength = sel ? sel.value : 'mid';
      var msg = document.getElementById('evtMsg');
      msg.textContent = '발동 중...';
      window.API.addEvent(pw, type, strength).then(function (res) {
        if (res && res.ok) {
          var label = (C.EVENT_BY_ID[type] || {}).label || type;
          msg.textContent = '발동됨: ' + label + ' (' + (C.STRENGTH_KO[strength] || strength) + ') · ' + now();
        } else {
          msg.textContent = (res && res.error) || '발동 실패';
        }
      });
    });

    function refresh() {
      if (!pw) return;
      var msg = document.getElementById('tableMsg');
      msg.textContent = '불러오는 중...';
      window.API.getAllStudents(pw, currentClass()).then(function (res) {
        if (res && res.ok) {
          var list = res.students || [];
          if (res.login_open !== undefined) applyLoginOpenUI(res.login_open);
          renderTable(list);
          msg.textContent = summaryText(list) + ' · ' + now();
        } else {
          msg.textContent = (res && res.error) || '불러오기 실패';
        }
      });
    }

    // 반별 요약 한 줄 (인원 / 평균 총점 / 도달 시대 분포)
    function summaryText(list) {
      if (!list.length) return '학생 없음';
      var avg = Math.round(list.reduce(function (a, s) { return a + (s.total || 0); }, 0) / list.length);
      var eraCount = {};
      list.forEach(function (s) {
        var nm = (C.ERAS.find(function (e) { return e.id === s.era_id; }) || {}).name || s.era_id;
        eraCount[nm] = (eraCount[nm] || 0) + 1;
      });
      var eras = Object.keys(eraCount).map(function (k) { return k + ' ' + eraCount[k] + '명'; }).join(', ');
      var scope = currentClass() ? (currentClass() + '반') : '전체';
      return scope + ' ' + list.length + '명 · 평균 총점 ' + avg + ' · [' + eras + ']';
    }

    function renderTable(students) {
      window.UI.renderTeacherTable(students, function (row) {
        window.UI.renderStudentDetail(row);
      });
    }

    function startAuto() {
      stopAuto();
      autoTimer = setInterval(refresh, 30000);
    }
    function stopAuto() {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }
  }
})();
