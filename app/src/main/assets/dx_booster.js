(function () {
  if (window.__dxLoaded) return; window.__dxLoaded = true;
  var KEY = 'dx_cfg_v3';
  var st = { gain: 500, on: true, bass: true, echo: false };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) { for (var k in sv) st[k] = sv[k]; } } catch (e) {}

  var chains = [], inNodes = [], ctxs = [];
  var outTracks = new WeakSet(), rawTracks = new WeakSet();
  var cache = {}, seenIn = {};
  var status = { mic: 0, inc: 0 };

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
    var g = st.on ? st.gain / 100 : 1;
    chains.forEach(function (ch) {
      try {
        ch.gain.gain.value = g;
        ch.bass.gain.value = (st.on && st.bass) ? 14 : 0;
        ch.wet.gain.value = (st.on && st.echo) ? 0.5 : 0;
        ch.fb.gain.value = (st.on && st.echo) ? 0.4 : 0;
      } catch (e) {}
    });
    var gi = st.on ? Math.max(0, Math.min(st.gain / 100, 6) - 1) : 0;
    inNodes.forEach(function (n) { try { n.gain.value = gi; } catch (e) {} });
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    var el = document.getElementById('dx-st');
    if (el) el.textContent = 'MIC ' + (status.mic ? '✓' : '✗') + ' IN ' + (status.inc ? '✓' : '✗');
  }

  // ---------- outgoing mic chain: gain -> bass -> treble -> echo -> limiter ----------
  function processTrack(track) {
    if (!track || outTracks.has(track)) return track;
    if (cache[track.id]) return cache[track.id];
    try {
      rawTracks.add(track);
      var ctx = newCtx(); ctx.resume();
      var src = ctx.createMediaStreamSource(new MediaStream([track]));
      var gain = ctx.createGain();
      var bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 150;
      var treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 3500; treble.gain.value = 4;
      var mix = ctx.createGain();
      var delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
      var fb = ctx.createGain(), wet = ctx.createGain();
      var lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.001; lim.release.value = 0.08;
      var dest = ctx.createMediaStreamDestination();

      src.connect(gain); gain.connect(bass); bass.connect(treble); treble.connect(mix);
      mix.connect(lim);
      mix.connect(delay); delay.connect(wet); wet.connect(lim);
      delay.connect(fb); fb.connect(delay);
      lim.connect(dest);

      var out = dest.stream.getAudioTracks()[0];
      outTracks.add(out);
      cache[track.id] = out;
      chains.push({ gain: gain, bass: bass, wet: wet, fb: fb });
      status.mic++;
      apply();
      return out;
    } catch (e) { return track; }
  }

  // Hook 1: getUserMedia (prototype level)
  try {
    var MD = window.MediaDevices && MediaDevices.prototype;
    if (MD && MD.getUserMedia) {
      var origGUM = MD.getUserMedia;
      MD.getUserMedia = async function (c) {
        var s = await origGUM.call(this, c);
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

  // Hook 2 + 3: whatever audio track the call gives to WebRTC gets processed
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

  // ---------- incoming audio (other people) ----------
  function boostIn(track) {
    try {
      var ctx = newCtx(); ctx.resume();
      var src = ctx.createMediaStreamSource(new MediaStream([track]));
      var g = ctx.createGain();
      var lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      src.connect(g); g.connect(lim); lim.connect(ctx.destination);
      inNodes.push(g);
      status.inc++;
      apply();
    } catch (e) {}
  }
  function scanIn() {
    var els = document.querySelectorAll('audio,video');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], so = el.srcObject;
      if (!so || !so.getAudioTracks || el.muted) continue;
      var ts = so.getAudioTracks();
      for (var j = 0; j < ts.length; j++) {
        var t = ts[j];
        if (seenIn[t.id] || outTracks.has(t) || rawTracks.has(t) || t.readyState === 'ended') continue;
        seenIn[t.id] = 1; boostIn(t);
      }
    }
  }
  setInterval(scanIn, 1000);

  // ---------- side panel ----------
  function build() {
    if (document.getElementById('dx-panel') || !document.body) return;
    var css = document.createElement('style');
    css.textContent =
      '#dx-panel{position:fixed;right:6px;top:50%;transform:translateY(-50%);width:76px;z-index:2147483647;' +
      'background:linear-gradient(180deg,#14142b,#0a0a1a);border:2px solid #2979ff;border-radius:20px;' +
      'padding:8px 6px;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:sans-serif;' +
      'animation:dxg 1.4s infinite alternate;color:#fff;user-select:none}' +
      '@keyframes dxg{from{box-shadow:0 0 14px #ff1744,0 0 4px #ff1744}to{box-shadow:0 0 18px #2979ff,0 0 6px #2979ff}}' +
      '#dx-panel .t{font-weight:800;font-size:11px;letter-spacing:1px;text-align:center;line-height:1.2;' +
      'background:linear-gradient(90deg,#ff1744,#2979ff);-webkit-background-clip:text;color:transparent}' +
      '#dx-panel button{width:46px;height:34px;border:0;border-radius:12px;font-size:20px;font-weight:700;color:#fff;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff)}' +
      '#dx-panel button:active{transform:scale(.92)}' +
      '#dx-panel input[type=range]{-webkit-appearance:slider-vertical;writing-mode:vertical-lr;direction:rtl;' +
      'width:30px;height:110px;accent-color:#ff1744}' +
      '#dx-panel .v{font-size:15px;font-weight:800;color:#82b1ff}' +
      '#dx-panel .sw{width:60px;height:28px;font-size:12px}' +
      '#dx-st{font-size:10px;color:#82b1ff}' +
      '#dx-fab{position:fixed;right:6px;top:50%;width:46px;height:46px;border-radius:50%;z-index:2147483647;' +
      'display:none;align-items:center;justify-content:center;font-size:22px;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff);animation:dxg 1.4s infinite alternate}';
    document.head.appendChild(css);

    var p = document.createElement('div');
    p.id = 'dx-panel';
    p.innerHTML =
      '<div class="t">DX<br>MASTER</div>' +
      '<button id="dx-up">+</button>' +
      '<input id="dx-sl" type="range" min="100" max="1000" step="50">' +
      '<button id="dx-dn">&minus;</button>' +
      '<div class="v" id="dx-val"></div>' +
      '<button class="sw" id="dx-on"></button>' +
      '<button class="sw" id="dx-bass">BASS</button>' +
      '<button class="sw" id="dx-echo">ECHO</button>' +
      '<div id="dx-st"></div>' +
      '<div id="dx-x" style="font-size:12px;color:#82b1ff">hide</div>';
    document.body.appendChild(p);

    var fab = document.createElement('div');
    fab.id = 'dx-fab'; fab.textContent = '🎤';
    document.body.appendChild(fab);

    var sl = document.getElementById('dx-sl'), val = document.getElementById('dx-val'),
        on = document.getElementById('dx-on'), bs = document.getElementById('dx-bass'),
        ec = document.getElementById('dx-echo');
    function ui() {
      sl.value = st.gain;
      val.textContent = st.gain + '%';
      on.textContent = st.on ? 'ON' : 'OFF';
      on.style.opacity = st.on ? '1' : '.45';
      bs.style.opacity = st.bass ? '1' : '.45';
      ec.style.opacity = st.echo ? '1' : '.45';
      apply();
    }
    function set(v) { st.gain = Math.max(100, Math.min(1000, v)); ui(); }
    sl.oninput = function () { set(parseInt(sl.value, 10)); };
    document.getElementById('dx-up').onclick = function () { set(st.gain + 50); };
    document.getElementById('dx-dn').onclick = function () { set(st.gain - 50); };
    on.onclick = function () { st.on = !st.on; ui(); };
    bs.onclick = function () { st.bass = !st.bass; ui(); };
    ec.onclick = function () { st.echo = !st.echo; ui(); };
    document.getElementById('dx-x').onclick = function () { p.style.display = 'none'; fab.style.display = 'flex'; };
    fab.onclick = function () { fab.style.display = 'none'; p.style.display = 'flex'; };
    ui();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  setInterval(build, 3000);
})();
