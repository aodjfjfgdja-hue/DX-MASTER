(function () {
if (window.__dxLoaded) return; window.__dxLoaded = true;
var KEY = 'dx_cfg_v8';
var st = { voice: 50000, echo: 3000, echoTime: 450, bassDb: 30, cut: 4, on: true, bass: true, eon: true, mode: 'lord' };
try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) { for (var k in sv) st[k] = sv[k]; } } catch (e) {}

var pipes = [], ctxs = [], pcs = new Set();
var outTracks = new WeakSet(), rawMap = new WeakMap(), metaMap = new WeakMap(), refreshing = new WeakSet();
var status = { mic: 0, talk: 0 };
var lastConstraints = { audio: true };
var origGUM = null;
var SEND_BITRATE = 510000;

function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return Math.min(b, Math.max(a, v)); }

function newCtx() {
var C = window.AudioContext || window.webkitAudioContext;
var c;
try { c = new C({ latencyHint: 'interactive', sampleRate: 48000 }); }
catch (e) { c = new C({ latencyHint: 'interactive' }); }
ctxs.push(c); return c;
}
function resumeAll() {
ctxs.forEach(function (c) { if (c.state === 'suspended') { try { c.resume(); } catch (e) {} } });
}
setInterval(resumeAll, 1000);
['click', 'touchstart', 'pointerdown', 'focus'].forEach(function (ev) {
window.addEventListener(ev, resumeAll, true);
});

// ---------- settings per mode (Enhanced for Extreme Power) ----------
function params() {
var L = st.mode === 'lord';
var c = L
? { thr: -65, knee: 45, ratio: 25, att: 0.0001, rel: 0.03, loud: 18, drive: 2.8,
pres: 25, high: 20, limit: 0, sT: -2, sMax: 128, bassMul: 1.5 }
: { thr: -40, knee: 30, ratio: 12, att: 0.002, rel: 0.1, loud: 6, drive: 0.5,
pres: 12, high: 8, limit: -1, sT: -8, sMax: 24, bassMul: 0.8 };
c.low = (st.on && st.bass) ? st.bassDb * c.bassMul : 0;
c.sub = c.low * 0.8;
if (!st.on) {
c.thr = -6; c.knee = 0; c.ratio = 1; c.loud = 1; c.drive = 0;
c.pres = 0; c.high = 0; c.limit = -0.5; c.sMax = 1;
}
return c;
}

var curves = {};
function curveFor(amount) {
var key = Math.round(amount * 100) / 100;
if (curves[key]) return curves[key];
var k = Math.max(0.0001, key * 120), n = 4096, cv = new Float32Array(n);
for (var i = 0; i < n; i++) {
var x = (i * 2) / n - 1;
cv[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
}
curves[key] = cv; return cv;
}

function setP(param, v) { try { param.value = v; } catch (e) {} }

function applyOne(p) {
var c = params(), n = p.nodes;
setP(n.low.gain, c.low); setP(n.sub.gain, c.sub);
setP(n.pres.gain, c.pres); setP(n.high.gain, c.high);
setP(n.comp1.threshold, c.thr); setP(n.comp1.knee, c.knee); setP(n.comp1.ratio, c.ratio);
setP(n.comp1.attack, c.att); setP(n.comp1.release, c.rel);
setP(n.loud.gain, c.loud);
setP(n.gain.gain, st.on ? clamp(st.voice, 100, 150000) / 100 : 1);
try { n.sat.curve = curveFor(c.drive); } catch (e) {}
setP(n.limiter.threshold, c.limit);

var t = clamp(st.echoTime, 100, 600) / 1000;  
setP(n.delay.delayTime, t);  
setP(n.delay2.delayTime, Math.min(0.98, t * 1.6));  
var eOn = st.on && st.eon;  
var wet = eOn ? Math.min(1.8, (st.echo / 100) * 0.08) : 0;  
var fb = (eOn && st.echo > 0) ? Math.min(0.8, 0.25 + st.echo / 700) : 0;  
setP(n.wet.gain, wet);  
setP(n.wet2.gain, wet * 0.7);  
setP(n.fb.gain, fb);  
p.c = c;
}

function apply() {
pipes.forEach(applyOne);
try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
var el = document.getElementById('dx-st');
if (el) el.textContent = 'MIC ' + (status.mic ? '✓' : '✗') + '  ' + (status.talk ? '🔊 DANGEROUS TALK' : '· quiet');
}

// ---------- raw mic constraints ----------
function rawAudio(audio) {
var base = (audio && typeof audio === 'object') ? audio : {};
return Object.assign({}, base, {
echoCancellation: false, noiseSuppression: false, autoGainControl: false,
googAutoGainControl: false, googNoiseSuppression: false, googHighpassFilter: false,
googEchoCancellation: false, googEchoCancellation2: false, googDAEchoCancellation: false,
googTypingNoiseDetection: false,
channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 }
});
}
function normConstraints(c) {
if (c === true) c = { audio: true };
if (!c || typeof c !== 'object') return c;
var n = Object.assign({}, c);
if (n.audio === true) n.audio = {};
if (n.audio && typeof n.audio === 'object') n.audio = rawAudio(n.audio);
return n;
}
function wantsAudio(c) {
if (c === true) return true;
return !!(c && typeof c === 'object' && c.audio);
}
try {
var MTP = window.MediaStreamTrack && MediaStreamTrack.prototype;
if (MTP && MTP.applyConstraints && !MTP.__dxPatched) {
var origApply = MTP.applyConstraints;
MTP.applyConstraints = function (c) {
var next = (this.kind === 'audio' && st.on) ? rawAudio(c) : c;
return origApply.call(this, next);
};
MTP.__dxPatched = true;
}
} catch (e) {}

// ---------- the sound pipeline (Super Boosted) ----------
function build(track) {
var ctx = newCtx(); ctx.resume();
var src = ctx.createMediaStreamSource(new MediaStream([track]));

var gateMeter = ctx.createAnalyser(); gateMeter.fftSize = 1024;  
src.connect(gateMeter);  
var gbuf = new Float32Array(1024);  

var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 40; hp.Q.value = 0.7;  
var low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;  
var sub = ctx.createBiquadFilter(); sub.type = 'peaking'; sub.frequency.value = 100; sub.Q.value = 1.2;  
var pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3500; pres.Q.value = 1.8;  
var high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500;  
var comp1 = ctx.createDynamicsCompressor();  
var comp2 = ctx.createDynamicsCompressor();  
comp2.threshold.value = -14; comp2.knee.value = 6; comp2.ratio.value = 16;  
comp2.attack.value = 0.0008; comp2.release.value = 0.04;  
var loud = ctx.createGain();  
var gain = ctx.createGain();  
var sat = ctx.createWaveShaper(); sat.oversample = '4x';  
var sustain = ctx.createGain(); sustain.gain.value = 1;  
var mix = ctx.createGain();  

var delay = ctx.createDelay(1.0); delay.delayTime.value = 0.3;  
var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;  
var fb = ctx.createGain(), wet = ctx.createGain();  
var delay2 = ctx.createDelay(1.0); delay2.delayTime.value = 0.48;  
var wet2 = ctx.createGain();  

var limiter = ctx.createDynamicsCompressor();  
limiter.knee.value = 0; limiter.ratio.value = 25;  
limiter.attack.value = 0.0001; limiter.release.value = 0.01;  
var gate = ctx.createGain(); gate.gain.value = 0;  
var meter = ctx.createAnalyser(); meter.fftSize = 1024; meter.smoothingTimeConstant = 0.15;  
var dest = ctx.createMediaStreamDestination();  

src.connect(hp); hp.connect(low); low.connect(sub); sub.connect(pres); pres.connect(high);  
high.connect(comp1); comp1.connect(comp2); comp2.connect(loud); loud.connect(gain);  
gain.connect(sat); sat.connect(sustain);  
sustain.connect(mix);  
sustain.connect(delay); delay.connect(lp); lp.connect(wet); wet.connect(mix);  
lp.connect(fb); fb.connect(delay);  
sustain.connect(delay2); delay2.connect(wet2); wet2.connect(mix);  
mix.connect(limiter); limiter.connect(meter);  
limiter.connect(gate); gate.connect(dest);  

var pipe = { ctx: ctx, nodes: { low: low, sub: sub, pres: pres, high: high, comp1: comp1, loud: loud, gain: gain,  
             sat: sat, limiter: limiter, wet: wet, wet2: wet2, fb: fb, delay: delay, delay2: delay2 }, c: params() };  
pipes.push(pipe);  
applyOne(pipe);  

var hold = 0, mbuf = new Uint8Array(meter.fftSize), cur = 1;  
var gateTimer = setInterval(function () {  
  try {  
    if (!st.on) { gate.gain.setTargetAtTime(1, ctx.currentTime, 0.01); return; }  
    gateMeter.getFloatTimeDomainData(gbuf);  
    var s = 0;  
    for (var i = 0; i < gbuf.length; i++) s += gbuf[i] * gbuf[i];  
    var rms = Math.sqrt(s / gbuf.length);  
    var now = Date.now();  
    var echoOn = st.eon && st.echo > 0;  
    if (rms > st.cut / 1000) hold = now + (echoOn ? 600 : 400);  
    var talking = now < hold;  
    gate.gain.setTargetAtTime(talking ? 1 : 0, ctx.currentTime,  
      talking ? 0.005 : (echoOn ? 0.7 : 0.1));  
    var f = talking ? 1 : 0;  
    if (status.talk !== f) { status.talk = f; apply(); }  
  } catch (e) {}  
}, 15);  

var sTimer = setInterval(function () {  
  try {  
    var c = pipe.c;  
    if (!st.on || ctx.state === 'closed') { cur = 1; sustain.gain.value = 1; return; }  
    meter.getByteTimeDomainData(mbuf);  
    var sum = 0;  
    for (var i = 0; i < mbuf.length; i++) { var v = (mbuf[i] - 128) / 128; sum += v * v; }  
    var db = 20 * Math.log10(Math.max(Math.sqrt(sum / mbuf.length), 0.000001));  
    if (db < c.sT) {  
      var lift = 1 + Math.min(1.8, Math.max(0.04, (c.sT - db) * 0.05));  
      cur = Math.min(c.sMax, cur * lift);  
    } else {  
      cur = Math.max(1, cur * 0.78);  
    }  
    sustain.gain.value = cur;  
  } catch (e) {}  
}, 120);  

track.addEventListener('ended', function () {  
  clearInterval(gateTimer); clearInterval(sTimer);  
  var i = pipes.indexOf(pipe); if (i >= 0) pipes.splice(i, 1);  
  status.mic = pipes.length;  
  try { ctx.close(); } catch (e) {}  
}, { once: true });  

return dest.stream.getAudioTracks()[0];
}

function processTrack(track, force) {
if (!track || track.kind !== 'audio') return track;
if (outTracks.has(track)) return track;
if (track.readyState === 'ended') return track;
if (!force && rawMap.has(track)) {
var ex = rawMap.get(track);
if (ex.readyState !== 'ended') return ex;
}
try {
try { track.contentHint = 'speech'; } catch (e) {}
var out = build(track);
outTracks.add(out);
rawMap.set(track, out);
metaMap.set(out, track);
status.mic = pipes.length;
apply();
return out;
} catch (e) { return track; }
}

// ---------- hooks ----------
try {
var MD = window.MediaDevices && MediaDevices.prototype;
if (MD && MD.getUserMedia) {
origGUM = MD.getUserMedia;
MD.getUserMedia = async function (c) {
if (wantsAudio(c)) lastConstraints = c || { audio: true };
var s;
try { s = await origGUM.call(this, normConstraints(c)); }
catch (e) { s = await origGUM.call(this, c); }
try {
if (!wantsAudio(c) || s.getAudioTracks().length === 0) return s;
var out = new MediaStream();
s.getAudioTracks().forEach(function (t) { out.addTrack(processTrack(t)); });
s.getVideoTracks().forEach(function (t) { out.addTrack(t); });
return out;
} catch (e) { return s; }
};
}
} catch (e) {}

function tuneSender(sender) {
try {
if (!sender || !sender.getParameters || !sender.setParameters) return;
var p = sender.getParameters() || {};
var enc = (p.encodings && p.encodings.length) ? p.encodings : [{}];
p.encodings = enc.map(function (e) {
return Object.assign({}, e, { active: e.active !== false, dtx: false,
maxBitrate: Math.max(Number(e.maxBitrate) || 0, SEND_BITRATE),
networkPriority: 'high', priority: 'high' });
});
sender.setParameters(p).catch(function () {});
} catch (e) {}
}
function streamFor(stream, rawT, procT) {
if (!stream || !stream.getTracks) return new MediaStream([procT]);
return new MediaStream(stream.getTracks().map(function (t) { return t === rawT ? procT : t; }));
}

try {
var P = window.RTCPeerConnection && RTCPeerConnection.prototype;
if (P && P.addTrack) {
var oAdd = P.addTrack;
P.addTrack = function (track) {
pcs.add(this);
var streams = Array.prototype.slice.call(arguments, 1);
if (track && track.kind === 'audio') {
var pt = processTrack(track);
var ps = streams.length ? streams.map(function (s) { return streamFor(s, track, pt); })
: [new MediaStream([pt])];
var sender = oAdd.apply(this, [pt].concat(ps));
tuneSender(sender);
return sender;
}
return oAdd.apply(this, arguments);
};
}
if (P && P.addTransceiver) {
var oTr = P.addTransceiver;
P.addTransceiver = function (x, init) {
pcs.add(this);
if (x && typeof x !== 'string' && x.kind === 'audio') {
var pt = processTrack(x);
var pi = (init && init.streams)
? Object.assign({}, init, { streams: init.streams.map(function (s) { return streamFor(s, x, pt); }) })
: init;
var tr = oTr.call(this, pt, pi);
tuneSender(tr && tr.sender);
return tr;
}
return oTr.apply(this, arguments);
};
}
var S = window.RTCRtpSender && RTCRtpSender.prototype;
if (S && S.replaceTrack) {
var oRep = S.replaceTrack;
S.replaceTrack = function (t) {
var nt = (t && t.kind === 'audio') ? processTrack(t) : t;
var r = oRep.call(this, nt);
var self = this;
try { Promise.resolve(r).then(function () { tuneSender(self); }).catch(function () {}); } catch (e) {}
return r;
};
}
} catch (e) {}

async function refreshSender(sender, dead) {
if (refreshing.has(sender)) return;
refreshing.add(sender);
try {
var raw = metaMap.get(dead);
var next = null;
if (raw && raw.readyState !== 'ended') next = processTrack(raw, true);
if (!next || next.readyState === 'ended') {
if (origGUM) {
var s = await origGUM.call(navigator.mediaDevices, normConstraints(lastConstraints));
var rt = s.getAudioTracks()[0];
if (rt) next = processTrack(rt, true);
}
}
if (next && next.readyState !== 'ended') { await sender.replaceTrack(next); tuneSender(sender); }
} catch (e) {}
refreshing.delete(sender);
}
setInterval(function () {
resumeAll();
pcs.forEach(function (pc) {
try {
if (pc.connectionState === 'closed') { pcs.delete(pc); return; }
pc.getSenders().forEach(function (sd) {
var t = sd.track;
if (t && t.kind === 'audio' && t.readyState === 'ended' && outTracks.has(t)) refreshSender(sd, t);
});
} catch (e) {}
});
}, 1000);

// ---------- Modern & Stunning UI Panel Design ----------
function build_ui() {
if (document.getElementById('dx-panel') || !document.body) return;
var css = document.createElement('style');
css.textContent =
'#dx-panel{position:fixed;right:8px;top:50%;transform:translateY(-50%);width:185px;z-index:2147483647;' +
'background:rgba(12, 12, 28, 0.92);backdrop-filter:blur(12px);border:1.5px solid rgba(41, 121, 255, 0.6);' +
'border-radius:20px;padding:12px 10px;display:flex;flex-direction:column;gap:6px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
'box-shadow:0 10px 35px rgba(0,0,0,0.7), 0 0 20px rgba(255, 23, 68, 0.3);color:#fff;user-select:none}' +
'#dx-panel .t{font-weight:900;font-size:14px;letter-spacing:2.5px;text-align:center;' +
'background:linear-gradient(90deg,#ff1744,#00e5ff);-webkit-background-clip:text;color:transparent;text-shadow:0 0 10px rgba(0,229,255,0.4)}' +
'#dx-panel .row{display:flex;flex-direction:column;gap:1px}' +
'#dx-panel .lb{display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#82b1ff;padding:0 2px}' +
'#dx-panel .lb b{color:#00e5ff}' +
'#dx-panel input[type=range]{width:100%;height:18px;accent-color:#00e5ff;margin:2px 0;cursor:pointer}' +
'#dx-panel .btns{display:flex;gap:5px}' +
'#dx-panel button{flex:1;height:30px;border:0;border-radius:10px;font-size:10px;font-weight:800;color:#fff;' +
'background:linear-gradient(135deg,#ff1744,#2979ff);box-shadow:0 4px 12px rgba(41,121,255,0.4);cursor:pointer;transition:all 0.2s}' +
'#dx-panel button:active{transform:scale(0.92)}' +
'#dx-st{font-size:9.5px;color:#00e5ff;text-align:center;font-weight:600;margin-top:2px}' +
'#dx-x{font-size:11px;color:#ff5252;text-align:center;font-weight:bold;cursor:pointer;margin-top:2px;opacity:0.8}' +
'#dx-x:hover{opacity:1}' +
'#dx-fab{position:fixed;right:8px;top:50%;transform:translateY(-50%);width:50px;height:50px;border-radius:50%;z-index:2147483647;' +
'display:none;align-items:center;justify-content:center;font-size:24px;cursor:pointer;' +
'background:linear-gradient(135deg,#ff1744,#2979ff);box-shadow:0 0 20px rgba(0,229,255,0.6);border:2px solid #fff}';
document.head.appendChild(css);

var p = document.createElement('div');  
p.id = 'dx-panel';  
p.innerHTML =  
  '<div class="t">⚡ DX MASTER ⚡</div>' +  
  '<div class="row"><div class="lb"><span>VOLUME BOOST</span><b id="dx-vv"></b></div>' +  
  '<input id="dx-v" type="range" min="0" max="100" step="1"></div>' +  
  '<div class="row"><div class="lb"><span>BASS LEVEL</span><b id="dx-bv"></b></div>' +  
  '<input id="dx-b" type="range" min="0" max="40" step="1"></div>' +  
  '<div class="row"><div class="lb"><span>ECHO DEPTH</span><b id="dx-ev"></b></div>' +  
  '<input id="dx-e" type="range" min="0" max="6000" step="100"></div>' +  
  '<div class="row"><div class="lb"><span>ECHO TIME</span><b id="dx-tv"></b></div>' +  
  '<input id="dx-t" type="range" min="100" max="600" step="20"></div>' +  
  '<div class="row"><div class="lb"><span>NOISE CUT</span><b id="dx-cv"></b></div>' +  
  '<input id="dx-c" type="range" min="1" max="40" step="1"></div>' +  
  '<div class="btns"><button id="dx-on"></button><button id="dx-bass">BASS</button><button id="dx-eon">ECHO</button></div>' +  
  '<div class="btns"><button id="dx-mode"></button></div>' +  
  '<div id="dx-st"></div>' +  
  '<div id="dx-x">✕ HIDE PANEL</div>';  
document.body.appendChild(p);  

var fab = document.createElement('div');  
fab.id = 'dx-fab'; fab.textContent = '🎛️';  
document.body.appendChild(fab);  

function $(id) { return document.getElementById(id); }  
function posFromVoice(v) { return Math.round(Math.log(clamp(v, 100, 150000) / 100) / Math.log(1500) * 100); }  
function voiceFromPos(pos) { return Math.round(100 * Math.pow(1500, pos / 100) / 100) * 100; }  

function ui() {  
  $('dx-v').value = posFromVoice(st.voice); $('dx-vv').textContent = st.voice + '%';  
  $('dx-b').value = st.bassDb; $('dx-bv').textContent = st.bassDb + 'dB';  
  $('dx-e').value = st.echo; $('dx-ev').textContent = st.echo + '%';  
  $('dx-t').value = st.echoTime; $('dx-tv').textContent = st.echoTime + 'ms';  
  $('dx-c').value = st.cut; $('dx-cv').textContent = st.cut;  
  $('dx-on').textContent = st.on ? 'POWER: ON' : 'POWER: OFF';  
  $('dx-on').style.opacity = st.on ? '1' : '0.5';  
  $('dx-bass').style.opacity = st.bass ? '1' : '0.5';  
  $('dx-eon').style.opacity = st.eon ? '1' : '0.5';  
  $('dx-mode').textContent = st.mode === 'lord' ? '🔥 LORD MODE (EXTREME)' : '💎 ROYAL MODE (CLEAR)';  
  apply();  
}  

$('dx-v').oninput = function () { st.voice = clamp(voiceFromPos(parseInt(this.value, 10)), 100, 150000); ui(); };  
$('dx-b').oninput = function () { st.bassDb = parseInt(this.value, 10); ui(); };  
$('dx-e').oninput = function () { st.echo = parseInt(this.value, 10); ui(); };  
$('dx-t').oninput = function () { st.echoTime = parseInt(this.value, 10); ui(); };  
$('dx-c').oninput = function () { st.cut = parseInt(this.value, 10); ui(); };  

$('dx-on').onclick = function () { st.on = !st.on; ui(); };  
$('dx-bass').onclick = function () { st.bass = !st.bass; ui(); };  
$('dx-eon').onclick = function () { st.eon = !st.eon; ui(); };  
$('dx-mode').onclick = function () { st.mode = st.mode === 'lord' ? 'royal' : 'lord'; ui(); };  

$('dx-x').onclick = function () {  
  $('dx-panel').style.display = 'none';  
  $('dx-fab').style.display = 'flex';  
};  
$('dx-fab').onclick = function () {  
  $('dx-panel').style.display = 'flex';  
  $('dx-fab').style.display = 'none';  
};  

ui();  
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
build_ui();
} else {
window.addEventListener('DOMContentLoaded', build_ui);
}
})();
