/* =====================================================================
 * api.js  —  Google Apps Script 웹앱 호출 래퍼
 * 공개 API: window.API
 *   setUrl(url)                         : 웹앱 URL 지정 (main.js에서 호출)
 *   ping()                              : 연결 확인
 *   login({class_no,number,name,password})
 *   saveState(student_id, state, scores)
 *   getAllStudents(teacher_password)
 *   addEvent(teacher_password, type, strength)
 *   getEvents(since)
 *
 * 요청: POST, Content-Type text/plain (Apps Script 권장 — CORS preflight 회피)
 *       body = JSON.stringify({ action:'...', ...params })
 * 응답: { ok:true, ... }  또는  { ok:false, error:'...' }
 *
 * 네트워크 실패 시 saveState는 localStorage('sim_backup_<id>')에 백업.
 * ===================================================================== */
(function (global) {
  'use strict';

  var URL = '';

  function post(payload) {
    if (!URL) return Promise.reject(new Error('APPS_SCRIPT_URL 미설정'));
    return fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  var API = {
    setUrl: function (u) { URL = u || ''; },
    getUrl: function () { return URL; },

    ping: function () {
      return post({ action: 'ping' }).catch(function () { return { ok: false, error: 'network' }; });
    },

    login: function (info) {
      return post(Object.assign({ action: 'login' }, info));
    },

    saveState: function (student_id, state, scores) {
      // 성공/실패와 무관하게 로컬 백업은 남긴다
      try { localStorage.setItem('sim_backup_' + student_id, JSON.stringify(state)); } catch (e) {}
      return post({ action: 'saveState', student_id: student_id, state: state, scores: scores })
        .catch(function () { return { ok: false, error: 'network', offline: true }; });
    },

    // class_no 를 주면 그 반만, 비우면(''/undefined) 전체 반환
    getAllStudents: function (pw, class_no) {
      return post({ action: 'getAllStudents', teacher_password: pw, class_no: class_no || '' })
        .catch(function () { return { ok: false, error: 'network' }; });
    },

    addEvent: function (pw, type, strength) {
      return post({ action: 'addEvent', teacher_password: pw, type: type, strength: strength })
        .catch(function () { return { ok: false, error: 'network' }; });
    },

    // 학생 입장 허용/차단
    setLoginOpen: function (pw, open) {
      return post({ action: 'setLoginOpen', teacher_password: pw, open: !!open })
        .catch(function () { return { ok: false, error: 'network' }; });
    },

    getEvents: function (since) {
      return post({ action: 'getEvents', since: since || 0 })
        .catch(function () { return { ok: false, error: 'network', events: [] }; });
    }
  };

  global.API = API;
})(typeof window !== 'undefined' ? window : globalThis);
