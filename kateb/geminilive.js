/* v48 live dictation through the free Gemini audio key, streamed (Zeyad: «زي الواتس: أتكلم والكلام يتكتب على طول»).
   A WebSocket to Gemini's Live API: the microphone's samples go up every ~200 ms as 16 kHz PCM, and Google sends back the
   transcription of what was said as it hears it (inputAudioTranscription). Words appear while speaking, in any browser
   (Brave too). The model itself is told to stay silent: only the transcription is used.
   start(key, {lang, onPartial(text), onTurn(text), onError(code, msg), onOpen()}) → { send(Float32Array16k), pause(), resume(), stop(), ready() } */
var GeminiLive = (function () {
  'use strict';
  var API = 'https://generativelanguage.googleapis.com/v1beta';
  var WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  var LS_MODEL = 'kateb.livemodel';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  /* the key's own list decides the model: one that speaks the Live protocol (bidiGenerateContent) and answers in TEXT */
  /* v49: every Live-capable model of the key, best first. Text-answering models get TEXT; the native-audio ones (some keys
     only have those now) get AUDIO — their answer is ignored, only the transcription of what was said is used. */
  async function candidates(key) {
    var r = await fetch(API + '/models?pageSize=300', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw { code: r.status === 400 || r.status === 403 ? 'bad_key' : 'net', why: 'models ' + r.status };
    var j = await r.json(), live = (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('bidiGenerateContent') >= 0; }).map(function (m) { return m.name.replace(/^models\//, ''); });
    if (!live.length) throw { code: 'no_live', why: 'no Live model on this key' };
    function audioOnly(n) { return /native-audio|audio-dialog|audio-preview|-tts/.test(n); }
    function score(n) { return (audioOnly(n) ? -50 : 0) + (/image/.test(n) ? -100 : 0) + (/flash/.test(n) ? 10 : 0) + (/live/.test(n) ? 5 : 0) + (/lite/.test(n) ? -2 : 0) + (parseFloat((/(\d+(\.\d+)?)/.exec(n) || [0, 0])[1]) || 0); }
    live.sort(function (a, b) { return score(b) - score(a); });
    var saved = lsGet(LS_MODEL), out = live.map(function (n) { return { name: n, mod: audioOnly(n) ? 'AUDIO' : 'TEXT' }; });
    if (saved) out.sort(function (a, b) { return (b.name === saved) - (a.name === saved); });
    return out;
  }
  async function pickModel(key) { return (await candidates(key))[0].name; }
  function b64(int16) {
    var u8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength), s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function toInt16(f32) { var o = new Int16Array(f32.length); for (var i = 0; i < f32.length; i++) { var v = Math.max(-1, Math.min(1, f32[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; }
  function start(key, opt) {
    opt = opt || {};
    var ws = null, open = false, setupDone = false, paused = false, stopped = false, buf = [], bufLen = 0, turn = '', sendT = null, model = '', reconnects = 0, everSetup = false;
    var cands = null, ci = 0, why = [];
    function emitTurn() { var t = turn.replace(/\s+/g, ' ').trim(); turn = ''; if (t && opt.onTurn) opt.onTurn(t); }
    async function connect() {
      if (!cands) { try { cands = await candidates(key); } catch (e) { if (opt.onError) opt.onError(e.code || 'net', e.why || ''); return; } }
      var c = cands[ci]; model = c.name;
      try { ws = new WebSocket(WS + '?key=' + encodeURIComponent(key)); } catch (e) { if (opt.onError) opt.onError('net', 'websocket'); return; }
      ws.onopen = function () {
        open = true;
        ws.send(JSON.stringify({ setup: {
          model: 'models/' + model,
          generationConfig: { responseModalities: [c.mod] },
          systemInstruction: { parts: [{ text: 'You only listen. Never answer, never speak, never comment: reply with nothing at all.' }] },
          inputAudioTranscription: {},
          realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } }
        } }));
      };
      ws.onmessage = async function (ev) {
        var raw = ev.data; if (typeof raw !== 'string') { try { raw = await (raw.text ? raw.text() : new Response(raw).text()); } catch (e) { return; } }
        var m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.setupComplete) { setupDone = true; everSetup = true; reconnects = 0; lsSet(LS_MODEL, model); if (opt.onOpen) opt.onOpen(model); flush(); return; }
        if (m.error) why.push(model + ': ' + (m.error.message || JSON.stringify(m.error)).slice(0, 160));
        var sc = m.serverContent; if (!sc) return;
        if (sc.inputTranscription && sc.inputTranscription.text) { turn += sc.inputTranscription.text; if (opt.onPartial) opt.onPartial(turn.replace(/\s+/g, ' ').trim()); }
        if (sc.turnComplete || sc.generationComplete || sc.interrupted) emitTurn();
      };
      ws.onerror = function () {};
      ws.onclose = function (ev) {
        var was = setupDone; open = false; setupDone = false; emitTurn();
        if (stopped) return;
        if (!everSetup) {
          why.push(model + ' [' + c.mod + ']: ' + (ev.code || '') + ' ' + (ev.reason || 'closed').slice(0, 160));
          if (/API key not valid|invalid api key|PERMISSION_DENIED/i.test(ev.reason || '')) { if (opt.onError) opt.onError('bad_key', why.join(' · ')); return; }
          if (++ci < cands.length && ci < 4) { setTimeout(connect, 150); return; }          // the next model
          lsSet(LS_MODEL, ''); if (opt.onError) opt.onError(/quota|exhaust|429|RESOURCE/i.test(why.join(' ')) ? 'quota' : 'live_failed', why.join(' · ')); return;
        }
        /* sessions are time-limited (~10-15 min): reconnect and keep going */
        if (reconnects++ < 5) setTimeout(connect, was ? 200 : 1500); else if (opt.onError) opt.onError('live_failed', ev.reason || '');
      };
    }
    function flush() {
      if (!ws || !setupDone || paused || !bufLen) return;
      var all = new Float32Array(bufLen), o = 0; buf.forEach(function (b) { all.set(b, o); o += b.length; }); buf = []; bufLen = 0;
      try { ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(toInt16(all)), mimeType: 'audio/pcm;rate=16000' } } })); } catch (e) {}
    }
    connect();
    sendT = setInterval(flush, 200);
    return {
      send: function (f32) { if (stopped || paused || !f32 || !f32.length) return; buf.push(f32); bufLen += f32.length; if (bufLen > 16000 * 30) { buf.shift(); bufLen = buf.reduce(function (a, b) { return a + b.length; }, 0); } },
      pause: function () { flush(); paused = true; try { if (ws && setupDone) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (e) {} },
      resume: function () { paused = false; if (!open && !stopped) connect(); },
      ready: function () { return setupDone; },
      model: function () { return model; },
      stop: function () {
        flush();
        try { if (ws && setupDone) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (e) {}
        return new Promise(function (res) {
          setTimeout(function () { stopped = true; clearInterval(sendT); emitTurn(); try { if (ws) ws.close(); } catch (e) {} res(); }, 1200);   // the last words come back
        });
      }
    };
  }
  return { start: start, pickModel: pickModel, _toInt16: toInt16 };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GeminiLive;
