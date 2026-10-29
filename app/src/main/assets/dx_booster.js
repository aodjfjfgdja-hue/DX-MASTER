(function () {
  if (window.__dxLoaded) return; window.__dxLoaded = true;
  var KEY = 'dx_gain_v2';
  var state = { gain: 300, on: true };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) state = sv; } catch (e) {}
  var nodes = window.__dxNodes = window.__dxNodes || [];
  var inNodes = window.__dxInNodes = window.__dxInNodes || [];

  function apply() {
    var g = state.on ? state.gain / 100 : 1;
    // incoming (others' voice): extra gain on top of the normal playback, capped at 4x total
    var gi = state.on ? Math.max(0, Math.min(state.gain / 100, 4) - 1) : 0;
    nodes.forEach(function (n) { try { n.gain.value = g; } catch (e) {} });
    inNodes.forEach(function (n) { try { n.gain.value = gi; } catch (e) {} });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  window.__dxApply = apply;

  function makeLimiter(ctx) {
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.08;
    return lim;
  }

  // ---- 1) Boost the outgoing mic so EVERYONE in the call hears it ----
  if (!window.__dxHooked && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    window.__dxHooked = true;
    var orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (c) {
      var s = await orig(c);
      if (!c || !c.audio || s.getAudioTracks().length === 0) return s;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        var ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume();
        var src = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
        var g = ctx.createGain();
        var lim = makeLimiter(ctx);
        var dest = ctx.createMediaStreamDestination();
        src.connect(g); g.connect(lim); lim.connect(dest);
        nodes.push(g);
        apply();
        var out = new MediaStream();
        dest.stream.getAudioTracks().forEach(function (t) { out.addTrack(t); });
        s.getVideoTracks().forEach(function (t) { out.addTrack(t); });
        return out;
      } catch (e) { return s; }
    };
  }

  // ---- 2) Boost incoming call audio (other people's voices) ----
  function boostIn(track) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      if (ctx.state === 'suspended') ctx.resume();
      var src = ctx.createMediaStreamSource(new MediaStream([track]));
      var g = ctx.createGain();
      var lim = makeLimiter(ctx);
      src.connect(g); g.connect(lim); lim.connect(ctx.destination);
      inNodes.push(g);
      apply();
    } catch (e) {}
  }
  var PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (PC && !window.__dxPC) {
    window.__dxPC = true;
    var NewPC = function (a, b) {
      var pc = new PC(a, b);
      pc.addEventListener('track', function (e) {
        if (e.track && e.track.kind === 'audio') boostIn(e.track);
      });
      return pc;
    };
    NewPC.prototype = PC.prototype;
    try { Object.setPrototypeOf(NewPC, PC); } catch (e) {}
    window.RTCPeerConnection = NewPC;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = NewPC;
  }

  // ---- 3) Side control panel ----
  function build() {
    if (document.getElementById('dx-panel') || !document.body) return;
    var st = document.createElement('style');
    st.textContent =
      '#dx-panel{position:fixed;right:6px;top:50%;transform:translateY(-50%);width:76px;z-index:2147483647;' +
      'background:linear-gradient(180deg,#14142b,#0a0a1a);border:2px solid #2979ff;border-radius:20px;' +
      'padding:10px 6px;display:flex;flex-direction:column;align-items:center;gap:8px;font-family:sans-serif;' +
      'animation:dxg 1.4s infinite alternate;color:#fff;user-select:none}' +
      '@keyframes dxg{from{box-shadow:0 0 14px #ff1744,0 0 4px #ff1744}to{box-shadow:0 0 18px #2979ff,0 0 6px #2979ff}}' +
      '#dx-panel .t{font-weight:800;font-size:11px;letter-spacing:1px;text-align:center;line-height:1.2;' +
      'background:linear-gradient(90deg,#ff1744,#2979ff);-webkit-background-clip:text;color:transparent}' +
      '#dx-panel button{width:46px;height:40px;border:0;border-radius:12px;font-size:22px;font-weight:700;color:#fff;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff)}' +
      '#dx-panel button:active{transform:scale(.92)}' +
      '#dx-panel input[type=range]{-webkit-appearance:slider-vertical;writing-mode:vertical-lr;direction:rtl;' +
      'width:30px;height:150px;accent-color:#ff1744}' +
      '#dx-panel .v{font-size:15px;font-weight:800;color:#82b1ff}' +
      '#dx-panel .sw{width:58px;height:30px;font-size:13px}' +
      '#dx-fab{position:fixed;right:6px;top:50%;width:46px;height:46px;border-radius:50%;z-index:2147483647;' +
      'display:none;align-items:center;justify-content:center;font-size:22px;' +
      'background:linear-gradient(135deg,#ff1744,#2979ff);animation:dxg 1.4s infinite alternate}';
    document.head.appendChild(st);

    var p = document.createElement('div');
    p.id = 'dx-panel';
    p.innerHTML =
      '<div class="t">DX<br>MASTER</div>' +
      '<button id="dx-up">+</button>' +
      '<input id="dx-sl" type="range" min="100" max="1000" step="50">' +
      '<button id="dx-dn">&minus;</button>' +
      '<div class="v" id="dx-val"></div>' +
      '<button class="sw" id="dx-on"></button>' +
      '<div id="dx-x" style="font-size:12px;color:#82b1ff">hide</div>';
    document.body.appendChild(p);

    var fab = document.createElement('div');
    fab.id = 'dx-fab';
    fab.textContent = '🎤';
    document.body.appendChild(fab);

    var sl = document.getElementById('dx-sl'), val = document.getElementById('dx-val'),
        on = document.getElementById('dx-on');
    function ui() {
      sl.value = state.gain;
      val.textContent = state.gain + '%';
      on.textContent = state.on ? 'ON' : 'OFF';
      on.style.opacity = state.on ? '1' : '.45';
      apply();
    }
    function set(v) { state.gain = Math.max(100, Math.min(1000, v)); ui(); }
    sl.oninput = function () { set(parseInt(sl.value, 10)); };
    document.getElementById('dx-up').onclick = function () { set(state.gain + 50); };
    document.getElementById('dx-dn').onclick = function () { set(state.gain - 50); };
    on.onclick = function () { state.on = !state.on; ui(); };
    document.getElementById('dx-x').onclick = function () { p.style.display = 'none'; fab.style.display = 'flex'; };
    fab.onclick = function () { fab.style.display = 'none'; p.style.display = 'flex'; };
    ui();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
  setInterval(build, 3000);
})();
