(function () {
  if (window.__dxLoaded) return; window.__dxLoaded = true;
  var KEY = 'dx_cfg_v5';
  var st = { voice: 10000, echo: 1500, cut: 6, on: true, bass: true, eon: true };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) { for (var k in sv) st[k] = sv[k]; } } catch (e) {}

  var chains = [], ctxs = [];
  var outTracks = new WeakSet(), rawTracks = new WeakSet();
  var cache = {};
  var status = { mic: 0, talk: 0 };

  function newCtx() {
    var C = window.AudioContext || window.webkitAudioContext;
    var c = new C(); ctxs.push(c); return c;
  }
  setInterval(function () {
    ctxs.forEach(function (c) { if (c.state === 'suspended') { try { c.resume(); } catch (e) {} } });
  }, 1000);
  ['click', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      ctxs.forEach(function (c) { try { c.resume(); } catch (e) {} });
    }, true);
  });

  function apply() {
    var g = st.on ? st.voice / 100 : 1;
    var wet = (st.on && st.eon) ? Math.min(1.2, (st.echo / 100) * 0.05) : 0;
    var fb = (st.on && st.eon && st.echo > 0) ? Math.min(0.55, 0.15 + st.echo / 10000) : 0;
    chains.forEach(function (ch) {
      try {
        ch.gain.gain.value = g;
        ch.bass.gain.value = (st.on && st.bass) ? 16 : 0;
        ch.wet.gain.value = wet;
        ch.fb.gain.value = fb;
      } catch (e) {}
    });
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    var el = document.getElementById('dx-st');
    if (el) el.textContent = 'MIC ' + (status.mic ? '✓' : '✗') + '   ' + (status.talk ? '🔊 TALK' : '· quiet');
  }

  function makeCurve() {
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i * 2 / (n - 1) - 1;
      c[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
    }
    return c;
  }
  var CURVE = makeCurve();

  // ---------- outgoing mic chain ----------
  // raw -> gain -> highpass -> bass -> treble -> noise gate -> (echo mix)
  //     -> compressor -> makeup -> soft clip -> limiter -> out
  function processTrack(track) {
    if (!track || outTracks.has(track)) return track;
    if (cache[track.id]) return cache[track.id];
    try {
      rawTracks.add(track);
      var ctx = newCtx(); ctx.resume();
      var src = ctx.createMediaStreamSource(new MediaStream([track]));

      // level detector on the RAW mic (before gain) for the noise gate
      var analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      src.connect(analyser);
      var buf = new Float32Array(1024);

      var gain = ctx.createGain();
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
      var bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 150;
      var treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3500; treble.gain.value = 5;
      var gate = ctx.createGain(); gate.gain.value = 0;
      var mix = ctx.createGain();
      var delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
      var fb = ctx.createGain(), wet = ctx.createGain();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -40; comp.knee.value = 0; comp.ratio.value = 20;
      comp.attack.value = 0.002; comp.release.value = 0.15;
      var makeup = ctx.createGain(); makeup.gain.value = 3;
      var shaper = ctx.createWaveShaper(); shaper.curve = CURVE; shaper.oversample = '4x';
      var lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.001; lim.release.value = 0.06;
      var dest = ctx.createMediaStreamDestination();

      src.connect(gain); gain.connect(hp); hp.connect(bass); bass.connect(treble); treble.connect(gate);
      gate.connect(mix);
      mix.connect(comp);
      mix.connect(delay); delay.connect(wet); wet.connect(comp);
      delay.connect(fb); fb.connect(delay);
      comp.connect(makeup); makeup.connect(shaper); shaper.connect(lim); lim.connect(dest);

      var hold = 0;
      var timer = setInterval(function () {
        try {
          if (!st.on) { gate.gain.setTargetAtTime(1, ctx.currentTime, 0.01); return; }
          analyser.getFloatTimeDomainData(buf);
          var s = 0;
          for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          var rms = Math.sqrt(s / buf.length);
          var now = Date.now();
          if (rms > st.cut / 1000) hold = now + 350;
          var talking = now < hold;
          gate.gain.setTargetAtTime(talking ? 1 : 0, ctx.currentTime, talking ? 0.008 : 0.12);
          var f = talking ? 1 : 0;
          if (status.talk !== f) { status.talk = f; apply(); }
        } catch (e) {}
      }, 15);
      track.addEventListener('ended', function () { clearInterval(timer); });

      var out = dest.stream.getAudioTracks()[0];
      outTracks.add(out);
      cache[track.id] = out;
      chains.push({ gain: gain, bass: bass, wet: wet, fb: fb });
      status.mic++;
      apply();
      return out;
    } catch (e) { return track; }
  }

  // Hook 1: getUserMedia (turn off Messenger's own noise suppression / auto gain)
  try {
    var MD = window.MediaDevices && MediaDevices.prototype;
    if (MD && MD.getUserMedia) {
      var origGUM = MD.getUserMedia;
      MD.getUserMedia = async function (c) {
        var s;
        try {
          var c2 = c;
          if (c && c.audio) {
            c2 = Object.assign({}, c);
            var a = (typeof c.audio === 'object') ? Object.assign({}, c.audio) : {};
            a.echoCancellation = false; a.noiseSuppression = false; a.autoGainControl = false;
            c2.audio = a;
          }
          s = await origGUM.call(this, c2);
        } catch (e) {
          s = await origGUM.call(this, c);
        }
        try {
          if (s.getAudioTracks().length === 0) return s;
          var out = new MediaStream();
          s.getAudioTracks().forEach(function (t) { out.addTrack(processTrack(t)); });
          s.getVideoTracks().forEach(function (t) { out.addTrack(t); });
          return out;
        } catch (e) { return s; }
      };
    }
  } catch (e) {}

  // Hook 2: any audio track handed to WebRTC
  try {
    var P = window.RTCPeerConnection && RTCPeerConnection.prototype;
    if (P && P.addTrack) {
      var oAdd = P.addTrack;
      P.addTrack = function (track) {
        var a = Array.prototype.slice.call(arguments);
        if (track && track.kind === 'audio') a[0] = processTrack(track);
        return oAdd.apply(this, a);
      };
    }
    if (P && P.addTransceiver) {
      var oTr = P.addTransceiver;
      P.addTransceiver = function (x) {
        var a = Array.prototype.slice.call(arguments);
        if (x && typeof x !== 'string' && x.kind === 'audio') a[0] = processTrack(x);
        return oTr.apply(this, a);
      };
    }
    var S = window.RTCRtpSender && RTCRtpSender.prototype;
    if (S && S.replaceTrack) {
      var oRep = S.replaceTrack;
      S.replaceTrack = function (t) {
        if (t && t.kind === 'audio') t = processTrack(t);
        return oRep.call(this, t);
      };
    }
  } catch (e) {}

  // ---------- control panel ----------
  function build() {
    if (document.getElementById('dx-panel') || !document.body) return;
    var css = document.createElement('style');
    css.textContent =
      '#dx-panel{position:fixed;right:6px;top:50%;transform:translateY(-50%);width:166px;z-index:2147483647;' +
      'background:linear-gradient(180deg,#14142b,#0a0a1a);border:2px solid #2979ff;border-radius:18px;' +
      'padding:8px 10px;display:flex;flex-direction:column;gap:6px;font-family:sans-serif;' +
      'animation:dxg 1.4s infinite alternate;color:#fff;user-select:none}' +
      '@keyframes dxg{from{box-shadow:0 0 14px #ff1744,0 0 4px #ff1744}to{box-shadow:0 0 18px #2979ff,0 0 6px #2979ff}}' +
      '#dx-panel .t{font-weight:800;font-size:13px;letter-spacing:2px;text-align:center;' +
      'background:linear-gradient(90deg,#ff1744,#2979ff);-webkit-background-clip:text;color:transparent}' +
      '#dx-panel .row{display:flex;flex-direction:column;gap:2px}' +
      '#dx-panel .lb{display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:#82b1ff}' +
      '#dx-panel .lb b{color:#fff}' +
      '#dx-panel input[type=range]{width:100%;height:26px;accent-color:#ff1744;margin:0}' +
      '#dx-panel .btns{display:flex;gap:4px}' +
      '#dx-panel button{flex:1;height:30px;border:0;border-radius:10px;font-size:11px;font-weight:800;color:#fff;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff)}' +
      '#dx-panel button:active{transform:scale(.93)}' +
      '#dx-st{font-size:10px;color:#82b1ff;text-align:center}' +
      '#dx-fab{position:fixed;right:6px;top:50%;width:46px;height:46px;border-radius:50%;z-index:2147483647;' +
      'display:none;align-items:center;justify-content:center;font-size:22px;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff);animation:dxg 1.4s infinite alternate}';
    document.head.appendChild(css);

    var p = document.createElement('div');
    p.id = 'dx-panel';
    p.innerHTML =
      '<div class="t">DX MASTER</div>' +
      '<div class="row"><div class="lb"><span>VOICE</span><b id="dx-vv"></b></div>' +
      '<input id="dx-v" type="range" min="100" max="70000" step="100"></div>' +
      '<div class="row"><div class="lb"><span>ECHO</span><b id="dx-ev"></b></div>' +
      '<input id="dx-e" type="range" min="0" max="4000" step="100"></div>' +
      '<div class="row"><div class="lb"><span>NOISE CUT</span><b id="dx-cv"></b></div>' +
      '<input id="dx-c" type="range" min="1" max="40" step="1"></div>' +
      '<div class="btns"><button id="dx-on"></button><button id="dx-bass">BASS</button><button id="dx-eon">ECHO</button></div>' +
      '<div id="dx-st"></div>' +
      '<div id="dx-x" style="font-size:12px;color:#82b1ff;text-align:center">hide</div>';
    document.body.appendChild(p);

    var fab = document.createElement('div');
    fab.id = 'dx-fab'; fab.textContent = '🎤';
    document.body.appendChild(fab);

    function $(id) { return document.getElementById(id); }
    function ui() {
      $('dx-v').value = st.voice; $('dx-vv').textContent = st.voice + '%';
      $('dx-e').value = st.echo; $('dx-ev').textContent = st.echo + '%';
      $('dx-c').value = st.cut; $('dx-cv').textContent = st.cut;
      $('dx-on').textContent = st.on ? 'ON' : 'OFF';
      $('dx-on').style.opacity = st.on ? '1' : '.45';
      $('dx-bass').style.opacity = st.bass ? '1' : '.45';
      $('dx-eon').style.opacity = st.eon ? '1' : '.45';
      apply();
    }
    $('dx-v').oninput = function () { st.voice = parseInt(this.value, 10); ui(); };
    $('dx-e').oninput = function () { st.echo = parseInt(this.value, 10); ui(); };
    $('dx-c').oninput = function () { st.cut = parseInt(this.value, 10); ui(); };
    $('dx-on').onclick = function () { st.on = !st.on; ui(); };
    $('dx-bass').onclick = function () { st.bass = !st.bass; ui(); };
    $('dx-eon').onclick = function () { st.eon = !st.eon; ui(); };
    $('dx-x').onclick = function () { p.style.display = 'none'; fab.style.display = 'flex'; };
    fab.onclick = function () { fab.style.display = 'none'; p.style.display = 'flex'; };
    ui();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  setInterval(build, 3000);
})();
