/* Neoarcadianism — interactions */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: the choice just isn't remembered */ } },
  };

  /* ─────────────── Language ───────────────
     English is written in the page itself; i18n.js holds Portuguese. Elements marked data-i18n
     swap their inner HTML, data-i18n-attr swaps attributes, and the script's own words come from T().
     Each section registers in onLang to rewrite whatever it has drawn. */
  const I18N = window.NEO_I18N || { html: {}, attr: {}, text: { en: {} } };
  let lang = store.get("neo-lang") || ((navigator.language || "").toLowerCase().startsWith("pt") ? "pt" : "en");
  if (!I18N.text[lang]) lang = "en";
  const T = (k) => (I18N.text[lang] && I18N.text[lang][k] !== undefined ? I18N.text[lang][k] : I18N.text.en[k]);
  const isTwig = (el) => el.classList.contains("twig");   // its label is a text node beside the cut mark
  const enHTML = {}, enAttr = {};
  const attrPairs = (el) => el.dataset.i18nAttr.split(";").map((pair) => pair.split(":").map((x) => x.trim()));
  $$("[data-i18n]").forEach((el) => { enHTML[el.dataset.i18n] = isTwig(el) ? el.firstChild.nodeValue : el.innerHTML; });
  $$("[data-i18n-attr]").forEach((el) => attrPairs(el).forEach(([a, k]) => { enAttr[k] = el.getAttribute(a); }));
  const onLang = [];
  function applyLang(next) {
    lang = next;
    const html = lang === "en" ? enHTML : I18N.html[lang] || {}, attr = lang === "en" ? enAttr : I18N.attr[lang] || {};
    $$("[data-i18n]").forEach((el) => {
      const v = html[el.dataset.i18n];
      if (v === undefined) return;
      if (isTwig(el)) el.firstChild.nodeValue = v; else el.innerHTML = v;
    });
    $$("[data-i18n-attr]").forEach((el) => attrPairs(el).forEach(([a, k]) => { if (attr[k] !== undefined) el.setAttribute(a, attr[k]); }));
    root.lang = lang === "pt" ? "pt-BR" : "en";
    document.title = T("title");
    const md = $('meta[name="description"]');
    if (md) md.setAttribute("content", T("description"));
    $$(".g").forEach((g) => g.setAttribute("aria-expanded", "false"));
    onLang.forEach((f) => f());
    root.classList.remove("i18n-wait");
  }

  /* A reload begins again at the painting: drop any #anchor left from the index and
     don't restore the old scroll position. A fresh link to an anchor is still honoured. */
  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (nav && nav.type === "reload") {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    scrollTo(0, 0);
    addEventListener("load", () => scrollTo(0, 0), { once: true });
  }

  /* ─────────────── Lyre ───────────────
     A plucked-string model (Karplus–Strong), tuned and played the way the
     lyre was imagined by the Greeks:
       · Pythagorean tuning: strings tuned by pure fifths (3:2), as Greek theory taught
       · gut-like warmth: a soft, low-passed pluck, struck near the string's middle
       · a soundbox (tortoise-shell) resonance and a stone-stoa reverb
       · composed phrases: question, then answer, always returning home to the root,
         over an open drone of root and fifth, with a little human rubato           */
  const Lyre = (() => {
    let ctx, bus, on = false, timer, nextStart = 0, count = 0, lastQ = -1, lastA = -1;
    const live = new Set();
    const cache = new Map();
    const BASE = 293.66;                                   // D4: small speakers cannot carry a D3
    const RATIO = [1, 9 / 8, 81 / 64, 4 / 3, 3 / 2, 27 / 16, 243 / 128]; // D E F♯ G A B C♯ (Pythagorean)
    const deg = (d) => BASE * RATIO[((d % 7) + 7) % 7] * Math.pow(2, Math.floor(d / 7));
    const PENTA = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14].map(deg); // D E F♯ A B, two octaves
    const BEAT = 0.82;

    // Melodies as [scale degree, beats]; 0 = D3, 4 = A3, 5 = B3, 7 = D4 …
    const QUESTIONS = [
      [[2, 1], [4, 1], [5, 1], [7, 2.5]],                  // the opening jingle's own shape, lifted
      [[4, 1.5], [5, 0.5], [7, 1], [5, 1], [4, 2.5]],
      [[7, 1], [9, 1], [8, 1], [7, 1], [5, 2.5]],
      [[5, 1], [7, 0.5], [8, 0.5], [9, 2], [7, 1], [5, 2]],
    ];
    const ANSWERS = [
      [[5, 1], [4, 1], [2, 1], [1, 1], [0, 3.5]],          // stepping down to the root
      [[7, 1.5], [5, 0.5], [4, 1], [2, 1], [0, 3.5]],
      [[5, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 3.5]],
      [[8, 1], [7, 1], [5, 1], [4, 1], [2, 0.5], [1, 0.5], [0, 3.5]],
    ];

    function init() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bus = ctx.createGain(); bus.gain.value = 3.4;
      const peak = (f, q, g) => { const b = ctx.createBiquadFilter(); b.type = "peaking"; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
      const body1 = peak(380, 1.1, 4), body2 = peak(860, 2.2, 3);        // soundbox
      const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 5200; tone.Q.value = 0.4;
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 6; lim.attack.value = 0.004; lim.release.value = 0.25;
      bus.connect(body1); body1.connect(body2); body2.connect(tone); tone.connect(lim); lim.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 3.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {                         // dark, stone-like tail
        const d = ir.getChannelData(c); let lp = 0;
        for (let i = 0; i < len; i++) { lp += 0.3 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 2.4 * Math.pow(1 - i / len, 2.8); }
      }
      const verb = ctx.createConvolver(); verb.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.5;
      tone.connect(verb); verb.connect(wet); wet.connect(lim);
    }

    function buffer(f) {
      const key = Math.round(f * 100);
      if (cache.has(key)) return cache.get(key);
      const sr = ctx.sampleRate, N = Math.round(sr / f);
      const t60 = Math.min(4.4, Math.max(2.2, 4.4 - 2 * (f - 293) / 880));   // low strings ring longer
      const g = Math.pow(10, -3 / (t60 * f));                                 // per-loop decay for that T60
      const len = Math.floor(sr * Math.min(4.6, t60 + 0.3));
      const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      // excitation: warm (low-passed) noise, then a comb for the plucking point (~1/6 along the string)
      const ring = new Float32Array(N), raw = new Float32Array(N);
      let lp = 0;
      for (let i = 0; i < N; i++) { lp += 0.5 * ((Math.random() * 2 - 1) - lp); raw[i] = lp; }
      const pp = Math.max(1, Math.round(N / 6));
      let peakAmp = 0;
      for (let i = 0; i < N; i++) { ring[i] = raw[i] - 0.85 * raw[(i + pp) % N]; peakAmp = Math.max(peakAmp, Math.abs(ring[i])); }
      for (let i = 0; i < N; i++) ring[i] *= 0.5 / peakAmp;
      for (let i = 0; i < len; i++) {
        const k = i % N, n = (k + 1) % N;
        d[i] = ring[k];
        ring[k] = g * 0.5 * (ring[k] + ring[n]);
      }
      cache.set(key, b);
      return b;
    }

    function pluck(f, when = 0, vol = 0.2, emit = false) {
      init();
      if (emit && on && Lyre.onPluck) Lyre.onPluck(when);
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = buffer(f);
      s.detune.value = (Math.random() - 0.5) * 7;           // hand-made strings are never quite in tune
      g.gain.value = vol;
      s.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-0.7, Math.min(0.7, (Math.log2(f / BASE) - 1.5) * 0.22 + (Math.random() - 0.5) * 0.1));
        g.connect(p); p.connect(bus);
      } else g.connect(bus);
      const item = { g };
      live.add(item); s.onended = () => live.delete(item);
      s.start(ctx.currentTime + Math.max(0, when));
    }

    function silence() {
      if (!ctx) return;
      const now = ctx.currentTime;
      live.forEach(({ g }) => { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.18); });
    }

    // One phrase: an open drone (root, fifth, octave), then the melody; returns when the next may begin.
    function playPhrase(start, melody) {
      const rel = (t) => t - ctx.currentTime;
      pluck(deg(0), rel(start), 0.2);
      pluck(deg(4), rel(start + 0.15), 0.13);
      pluck(deg(7), rel(start + 0.3), 0.09);
      if (!melody) return start + BEAT * 5;
      let t = start + 0.55;
      const total = melody.reduce((a, m) => a + m[1], 0);
      let elapsed = 0, bassDone = false;
      melody.forEach(([d, b], i) => {
        const late = 1 + 0.12 * (elapsed / total);                 // a gentle slowing toward the cadence
        const jitter = (Math.random() - 0.5) * 0.03;               // human, not metronomic
        const v = (i === 0 ? 0.22 : b >= 2 ? 0.2 : 0.16) * (0.92 + Math.random() * 0.16);
        pluck(deg(d), rel(t + jitter), v, Math.random() < 0.16);
        if (Math.random() < 0.3) pluck(deg(d + 7), rel(t + jitter + 0.05), 0.045);  // octave shadow: heterophony
        if (!bassDone && elapsed >= total / 2) { pluck(deg(-3), rel(t), 0.13); bassDone = true; } // low A beneath
        t += b * BEAT * late; elapsed += b;
      });
      pluck(deg(0), rel(t - 3 * BEAT * 0.9), 0.1);                 // settle on the root
      return t + BEAT * 1.4;                                      // a breath before the next phrase
    }

    function pick(list, last) {
      let i; do { i = Math.floor(Math.random() * list.length); } while (i === last && list.length > 1);
      return i;
    }
    function loop() {
      if (!on) return;
      const start = Math.max(nextStart, ctx.currentTime + 0.1);
      let melody = null;
      if (count % 8 === 7) melody = null;                          // every so often: only the drone, resting
      else if (count % 2 === 0) { lastQ = pick(QUESTIONS, lastQ); melody = QUESTIONS[lastQ]; }
      else { lastA = pick(ANSWERS, lastA); melody = ANSWERS[lastA]; }
      count++;
      nextStart = playPhrase(start, melody);
      timer = setTimeout(loop, Math.max(200, (nextStart - ctx.currentTime - 1.2) * 1000));
    }

    function resume() { init(); if (ctx.state === "suspended") ctx.resume(); }
    return {
      get on() { return on; },
      toggle() {
        resume();
        on = !on;
        clearTimeout(timer);
        if (on) {
          // the opening jingle, as it was
          [0, 2, 4, 5].forEach((n, i) => pluck(PENTA[n], i * 0.22, 0.24, i % 2 === 0));
          nextStart = ctx.currentTime + 4 * 0.22 + 1.6;
          count = 0; lastQ = lastA = -1;
          timer = setTimeout(loop, 1200);
        } else silence();
        return on;
      },
      phrase(notes, gap = 0.22) { resume(); notes.forEach((n, i) => pluck(PENTA[n], i * gap, 0.24)); },
      chord() { if (on) [0, 4, 7].forEach((n, i) => pluck(PENTA[n], i * 0.06, 0.2)); },
      tick(i = 5) { if (on) pluck(PENTA[i], 0, 0.12); },
    };
  })();

  /* ─────────────── The dock: an olive sprig that opens into the lyre, the theme and the language ─────────────── */
  const dock = $("#dock"), dockToggle = $(".dock__toggle"), lyreBtn = $(".lyre"), themeBtn = $(".theme"), langBtns = $$(".lang__btn");
  const dockOpen = () => dock.classList.contains("is-open");
  function setDock(open) { dock.classList.toggle("is-open", open); dockToggle.setAttribute("aria-expanded", open); }
  dockToggle.addEventListener("click", () => setDock(!dockOpen()));
  document.addEventListener("click", (e) => { if (dockOpen() && !dock.contains(e.target)) setDock(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dockOpen()) { setDock(false); dockToggle.focus(); } });

  lyreBtn.addEventListener("click", () => {
    const on = Lyre.toggle();
    lyreBtn.setAttribute("aria-pressed", on);
    dock.classList.toggle("is-playing", on);      // the sprig keeps a quiet pulse while the dock is closed
  });

  // theme: follows the system until the reader chooses; the choice is remembered
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : darkMQ.matches);
  function themeLabel() { const t = isDark() ? T("toLight") : T("toDark"); themeBtn.title = t; themeBtn.setAttribute("aria-label", t); }
  const onTheme = [];
  themeBtn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    store.set("neo-theme", next);
    themeLabel();
    onTheme.forEach((f) => f());
  });
  darkMQ.addEventListener("change", () => { themeLabel(); onTheme.forEach((f) => f()); });

  // language
  function langUI() {
    langBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === lang));
    lyreBtn.title = T("lyre"); lyreBtn.setAttribute("aria-label", T("lyre"));
    dockToggle.title = T("dock"); dockToggle.setAttribute("aria-label", T("dock"));
    themeLabel();
  }
  langBtns.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    store.set("neo-lang", b.dataset.lang);
    applyLang(b.dataset.lang);
    Lyre.tick(5);
  }));
  onLang.push(langUI);
  /* floating notes while the lyre plays */
  const notesLayer = document.createElement("div");
  notesLayer.className = "notes"; notesLayer.setAttribute("aria-hidden", "true");
  document.body.appendChild(notesLayer);
  const glyphs = ["♪", "♫", "♩", "♬", "𝄞"];
  function emitNote() {
    if (reduced || document.hidden) return;
    const r = (dockOpen() ? lyreBtn : dockToggle).getBoundingClientRect();
    const n = document.createElement("span");
    n.className = "note";
    n.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    n.style.left = (r.left + r.width / 2 + (Math.random() - .5) * 26) + "px";
    n.style.top = (r.top + 8) + "px";
    n.style.fontSize = (0.95 + Math.random() * 0.6).toFixed(2) + "rem";
    n.style.setProperty("--dx", ((Math.random() - .65) * 70).toFixed(0) + "px");
    n.style.setProperty("--rise", (70 + Math.random() * 90).toFixed(0) + "px");
    n.style.setProperty("--rot", ((Math.random() - .5) * 50).toFixed(0) + "deg");
    n.style.setProperty("--dur", (9 + Math.random() * 5).toFixed(1) + "s");
    n.addEventListener("animationend", () => n.remove());
    notesLayer.appendChild(n);
  }
  let noteTimer;
  function noteLoop() { if (!Lyre.on) return; emitNote(); noteTimer = setTimeout(noteLoop, 2200 + Math.random() * 2800); }
  lyreBtn.addEventListener("click", () => { clearTimeout(noteTimer); if (Lyre.on) noteLoop(); });
  Lyre.onPluck = (when) => setTimeout(emitNote, when * 1000);

  // (delegated: the sentence holding this word is rewritten when the language changes)
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".lyre-word")) Lyre.phrase([2, 4, 5, 7, 9, 7, 5], 0.24); });

  const wake = () => document.documentElement.classList.add("awake");
  requestAnimationFrame(() => requestAnimationFrame(wake));
  setTimeout(wake, 120);

  /* inline words act as buttons (spans keep them flowing with the sentence) */
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches && t.matches('span[role="button"]') && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.click(); }
  });

  /* ─────────────── Glosses ─────────────── */
  $$(".g").forEach((g) => g.setAttribute("aria-expanded", "false"));
  document.addEventListener("click", (e) => {     // delegated, so glosses keep working after a language change
    const g = e.target.closest && e.target.closest(".g");
    if (!g) return;
    const open = g.getAttribute("aria-expanded") !== "true";
    g.setAttribute("aria-expanded", open);
    if (open) Lyre.tick(6 + Math.floor(Math.random() * 4));
  });

  /* ─────────────── Rise on arrival ─────────────── */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.05 });
  $$(".rise").forEach((el) => io.observe(el));

  /* ─────────────── I · Fvgere Vrbem: the noise ─────────────── */
  const fuge = $(".fuge");
  const noise = $(".fuge__noise");
  const fragKinds = ["nz-sale", "nz-pill", "nz-tick", "nz-shout", "nz-sign", "nz-bubble", "nz-tick down", "nz-pill", "nz-shout",
    "nz-sign", "nz-sale", "nz-bubble", "nz-tick", "nz-pill", "nz-shout", "nz-sign", "nz-pill", "nz-tick down",
    "nz-shout", "nz-bubble", "nz-sale", "nz-sign"];
  const fragEls = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  fragKinds.forEach((cls, i) => {
    const el = document.createElement("div");
    el.className = "noise-frag";
    const x = 4 + rnd() * 86;
    let y = 4 + rnd() * 88;
    // keep the words themselves mostly legible: noise crowds around them, not over them
    if (x < 42 && y > 22 && y < 72) y = y < 47 ? 4 + rnd() * 14 : 76 + rnd() * 16;
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.style.setProperty("--r", (rnd() * 24 - 12).toFixed(1) + "deg");
    el.style.setProperty("--dx", ((x - 50) * 14).toFixed(0));
    el.style.setProperty("--dy", ((y - 50) * 10).toFixed(0));
    el.style.setProperty("--jd", (-rnd()).toFixed(2) + "s");
    el.innerHTML = `<span class="${cls}">${T("noise")[i]}</span>`;
    noise.appendChild(el);
    fragEls.push(el.firstChild);
  });
  onLang.push(() => fragEls.forEach((el, i) => { el.innerHTML = T("noise")[i]; }));

  function fugeUpdate() {
    const r = fuge.getBoundingClientRect();
    const span = r.height - innerHeight;
    const p = clamp(-r.top / span);
    const calm = clamp((p - 0.22) / 0.38);
    const b = clamp((p - 0.45) / 0.15);
    const fade = clamp((p - 0.78) / 0.17);
    fuge.style.setProperty("--calm", calm.toFixed(3));
    fuge.style.setProperty("--b", b.toFixed(3));
    fuge.style.setProperty("--fade", fade.toFixed(3));
  }

  /* ─────────────── II · Locvs Amœnvs: the window ─────────────── */
  const PLACES = ["villages", "lounges", "parks", "landscapes", "wilderness"];
  const frames = $$(".arch__window img"), archCap = $(".arch__cap");
  let place = "landscapes";
  function showPlace(k, sound) {
    place = k;
    $$(".place").forEach((x) => { const on = x.dataset.place === k; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); });
    frames.forEach((f) => f.classList.toggle("is-on", f.dataset.place === k));
    archCap.innerHTML = T("captions")[k];
    if (sound) Lyre.tick(3 + PLACES.indexOf(k));
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".place"); if (b) showPlace(b.dataset.place, true); });
  onLang.push(() => showPlace(place, false));

  /* ─────────────── III · Invtilia Trvncat: the shears ─────────────── */
  const cuts = $$(".twig.cut"), count = $(".vine__count"), vCoda = $(".vine__coda");
  const shootsLeft = () => cuts.filter((x) => !x.classList.contains("snipped")).length;
  function vineCount() {
    const left = shootsLeft();
    count.textContent = left ? "" : T("pruned");
  }
  const twigLabel = (c) => c.setAttribute("aria-label", `${T("prune")}: ${c.firstChild.nodeValue}`);
  onLang.push(() => { cuts.forEach(twigLabel); if (shootsLeft() < cuts.length) vineCount(); });
  cuts.forEach((c) => {
    const slash = document.createElement("span"); slash.className = "slash"; slash.setAttribute("aria-hidden", "true");
    c.appendChild(slash);
    twigLabel(c);
    c.addEventListener("click", () => {
      c.classList.add("snipped");
      Lyre.tick(1);
      setTimeout(() => c.classList.add("fallen"), 520);
      setTimeout(() => { c.hidden = true; }, 2400);
      vineCount();
      if (!shootsLeft()) setTimeout(() => { vCoda.classList.add("is-in"); Lyre.chord(); }, 1200);
    });
  });
  $$(".twig.keep").forEach((k) => k.addEventListener("click", () => {
    k.classList.remove("glow"); void k.offsetWidth; k.classList.add("glow");
  }));

  /* ─────────────── IV · Avrea Mediocritas: the string ─────────────── */
  const mean = $(".mean"), dopa = $("#dopa"), warpWrap = $(".mean__warp");
  const warpMap = $("#warpMap"), warpNoise = $("#warpNoise");
  const sWord = $(".string__word"), sGloss = $(".string__gloss");
  const RANGES = [[0, 8], [8, 28], [28, 44], [44, 57], [57, 72], [72, 90], [90, 101]];   // words and glosses: T("states")
  let warpE = 0, warpT = 0, warpRaf = 0, wasGolden = true;
  function warpLoop(t) {
    warpT = t / 1000;
    const bf = 0.008 + Math.sin(warpT * 0.6) * 0.003;
    warpNoise.setAttribute("baseFrequency", `${bf.toFixed(4)} ${(bf * 1.4).toFixed(4)}`);
    warpMap.setAttribute("scale", (warpE * 70).toFixed(1));
    if (warpE > 0.15 && !reduced) warpRaf = requestAnimationFrame(warpLoop); else warpRaf = 0;
  }
  function meanUpdate() {
    const v = +dopa.value;
    const e = clamp((v - 50) / 50), d = clamp((50 - v) / 50);
    mean.style.setProperty("--e", e.toFixed(3));
    mean.style.setProperty("--d", d.toFixed(3));
    const [word, gloss] = T("states")[RANGES.findIndex((r) => v >= r[0] && v < r[1])];
    sWord.textContent = word; sGloss.textContent = gloss;
    dopa.setAttribute("aria-valuetext", word);
    const golden = v >= 44 && v < 57;
    mean.classList.toggle("golden", golden);
    mean.classList.toggle("off", !golden);
    if (golden && !wasGolden) Lyre.chord();
    wasGolden = golden;
    warpE = e;
    warpWrap.classList.toggle("warping", e > 0.15 && !reduced);
    if (e > 0.15 && !warpRaf && !reduced) warpRaf = requestAnimationFrame(warpLoop);
  }
  dopa.addEventListener("input", meanUpdate);
  meanUpdate();
  onLang.push(meanUpdate);

  /* ─────────────── V · Carpe Diem: the field of hours ─────────────── */
  const TOTAL = 460000, COLS = 800, ROWS = Math.ceil(TOTAL / COLS);
  const HOURS_PER_YEAR = 16 * 365.25;
  const canvas = $(".field__canvas"), cx = canvas.getContext("2d");
  const now = $(".field__now"), tip = $(".field__tip");
  const age = $("#age"), ageOut = $("#ageOut"), ageRead = $(".age__read");
  const grain = new Uint8Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) grain[i] = Math.floor(Math.random() * 60);
  const img = cx.createImageData(COLS, ROWS);

  function cssColor(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  function drawField(spent) {
    const g = hexRgb(cssColor("--gold-bright") || "#c8962f");
    const bg = hexRgb(cssColor("--vellum") || "#ede3cc");
    const dim = hexRgb(cssColor("--muted") || "#8a7a5f");
    const data = img.data;
    for (let i = 0; i < COLS * ROWS; i++) {
      const o = i * 4;
      if (i >= TOTAL) { data[o] = bg[0]; data[o + 1] = bg[1]; data[o + 2] = bg[2]; data[o + 3] = 255; continue; }
      const k = grain[i];
      if (i < spent) {
        const m = 0.32 + k / 400;
        data[o] = bg[0] * (1 - m) + dim[0] * m; data[o + 1] = bg[1] * (1 - m) + dim[1] * m; data[o + 2] = bg[2] * (1 - m) + dim[2] * m;
      } else {
        const m = 0.55 + k / 140;
        data[o] = bg[0] * (1 - m) + g[0] * m; data[o + 1] = bg[1] * (1 - m) + g[1] * m; data[o + 2] = bg[2] * (1 - m) + g[2] * m;
      }
      data[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
  }
  function placeNow(hour) {
    if (!hour) { now.style.display = "none"; return; }
    const col = hour % COLS, row = Math.floor(hour / COLS);
    now.style.display = "block";
    now.style.left = (col / COLS * canvas.offsetWidth) + "px";
    now.style.top = (row / ROWS * canvas.offsetHeight) + "px";
  }
  const fmt = (n) => Math.round(n).toLocaleString(T("locale"));
  function ageUpdate() {
    const y = +age.value;
    ageOut.textContent = y || "—";
    const spent = Math.min(TOTAL, Math.round(y * HOURS_PER_YEAR));
    drawField(spent);
    placeNow(spent && spent < TOTAL ? spent : 0);
    if (!y) ageRead.textContent = T("ageEmpty");
    else if (spent >= TOTAL) ageRead.textContent = T("ageSpent");
    else ageRead.textContent = T("ageRead")(fmt(spent), fmt(TOTAL - spent), fmt((TOTAL - spent) / 16));
  }
  age.addEventListener("input", ageUpdate);
  ageUpdate();
  onTheme.push(ageUpdate);   // the field is painted in the theme's colours
  onLang.push(ageUpdate);

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / r.width * COLS), row = Math.floor((e.clientY - r.top) / r.height * ROWS);
    const h = row * COLS + col;
    if (h < 0 || h >= TOTAL) { tip.style.opacity = 0; return; }
    const yrs = h / HOURS_PER_YEAR;
    tip.textContent = T("tip")(fmt(h + 1), yrs < 1 ? T("underOne") : Math.floor(yrs));
    tip.style.left = (e.clientX - r.left) + "px";
    tip.style.top = (e.clientY - r.top) + "px";
    tip.style.opacity = 1;
  });
  canvas.addEventListener("pointerleave", () => { tip.style.opacity = 0; });

  const arrived = Date.now(), sinceN = $(".since__n");
  const sinceUpdate = () => { sinceN.textContent = T("since")(Math.floor((Date.now() - arrived) / 60000)); };
  setInterval(sinceUpdate, 15000);
  onLang.push(sinceUpdate);

  /* breath */
  const breath = $(".breath"), bWord = $(".breath__word");
  let bTimers = [];
  $(".breath-btn").addEventListener("click", () => {
    breath.hidden = false;
    bTimers.forEach(clearTimeout); bTimers = [];
    const cycle = (n) => {
      bWord.textContent = T("breathIn"); breath.classList.add("inhale");
      bTimers.push(setTimeout(() => { bWord.textContent = T("breathOut"); breath.classList.remove("inhale"); }, 4600));
      if (n > 1) bTimers.push(setTimeout(() => cycle(n - 1), 9600));
      else bTimers.push(setTimeout(() => { bWord.textContent = T("breathDone"); }, 9800));
    };
    requestAnimationFrame(() => requestAnimationFrame(() => cycle(2)));
  });
  breath.addEventListener("click", () => { breath.hidden = true; breath.classList.remove("inhale"); bTimers.forEach(clearTimeout); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !breath.hidden) breath.click(); });

  /* ─────────────── VI · Compendivm Laboris: the ledger ─────────────── */
  const labor = $(".labor"), dayShallow = $(".day__shallow"), dayRead = $(".day__read");
  const tasks = $$(".tasks li");
  function ledgerUpdate() {
    let shallow = 0, freed = 0;
    tasks.forEach((li) => {
      const h = +$(".task__h", li).dataset.h;
      if (li.classList.contains("given")) freed += h; else shallow += h;
    });
    dayShallow.style.flexBasis = (shallow / 16 * 100 * 4) + "%"; // drawn ×4 so a small hour shows
    const fmtH = (h) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
    if (!freed) dayRead.textContent = T("dayShallow")(fmtH(shallow), fmt(shallow * 365.25 / 16));
    else {
      const year = freed * 365.25;
      dayRead.textContent = T("dayFreed")(fmtH(freed), fmt(year), fmt(year / 16));
    }
    labor.classList.toggle("freed", freed > 0.9);
  }
  const taskBtnText = (li, i) => { $(".task__btn", li).textContent = li.classList.contains("given") ? T("given")[i] : T("handOver"); };
  onLang.push(() => { tasks.forEach(taskBtnText); ledgerUpdate(); });
  tasks.forEach((li, i) => {
    const btn = $(".task__btn", li);
    taskBtnText(li, i);
    btn.addEventListener("click", () => {
      const given = li.classList.toggle("given");
      taskBtnText(li, i);
      btn.setAttribute("aria-pressed", given);
      if (given) Lyre.tick(4);
      ledgerUpdate();
    });
  });
  ledgerUpdate();

  /* ─────────────── Opening: the painting breathes ───────────────
     A WebGL layer redraws the painting with a little life in it, region by region,
     guided by a hand-tuned mask (images/dream-of-arcadia-mask.png):
       R · foliage: wind sways the canopies in coherent masses, gusts rolling across,
                    with a faint flutter and leaves catching the light
       G · sky:     clouds drift and slowly change shape
       B · water:   the pond's reflections quiver; the waterfall runs
     plus cloud shadows crossing the land. Every motion is a few pixels at most.        */
  (function livingPainting() {
    if (reduced) return;
    const art = $(".opening__art"), img = $("img", art);
    const cv = document.createElement("canvas");
    cv.className = "opening__gl"; cv.setAttribute("aria-hidden", "true");
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" };
    const gl = cv.getContext("webgl2", opts) || cv.getContext("webgl", opts);
    if (!gl) return;
    const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

    const VS1 = `attribute vec2 a; varying vec2 vUv;
      void main(){ vUv = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;
    const FS = `
      varying vec2 vUv;
      vec2 gx, gy;                               // texture-coordinate gradients of the undisplaced image
      uniform sampler2D uImg, uMask;
      uniform vec2 uScale, uOff;
      uniform float uT, uAmp, uAspect;

      vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453) * 2. - 1.; }
      float noise(vec2 p){                       // gradient noise, roughly −.7 … .7
        vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
        return mix(mix(dot(h2(i), f), dot(h2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
                   mix(dot(h2(i + vec2(0, 1)), f - vec2(0, 1)), dot(h2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
      }

      // a rising plume of smoke: q is the position relative to its base (y grows downward), in image heights
      float plume(vec2 q, float lean, float top, float w0, float grow){
        float h = -q.y, hp = max(h, 0.);
        return smoothstep(1., .45, abs(q.x - lean * hp) / (w0 + grow * hp))
             * smoothstep(.0005, .005, h) * smoothstep(top, top * .66, h);
      }
      // the same plume continuing past the painted part: thinning wisps that lean and sway with the wind
      float wisp(vec2 q, float t, float from, float lean, float w0, float grow, float top, float seed){
        float hw = -q.y - from, hp = max(hw, 0.);
        float across = (q.x - (.004 + lean * hp + sin(t * .4 + hw * 40. + seed) * .002)) / (w0 + grow * hp);
        float w = noise(vec2(across * 1.5 + seed, hw * 45. - t * .9)) + .5 * noise(vec2(across * 3., hw * 90. - t * 1.7) + 3. + seed);
        return smoothstep(-.1, .55, w) * exp(-across * across * 2.) * smoothstep(-.004, .008, hw) * smoothstep(top, top * .25, hw);
      }

      void main(){
        vec2 uv = vUv * uScale + uOff;           // image coordinates (object-fit: cover)
        GRADS(uv)                                // choose detail from where the pixel is, not where it samples
        vec3 m = texture2D(uMask, uv).rgb;
        float fol = m.r, sky = m.g;
        float pond = m.b * step(.76, uv.y), fall = m.b * (1. - step(.76, uv.y));
        float fallCore = smoothstep(.4, .8, fall);   // the water itself, not the soft edge of the mask
        vec2 p = vec2(uv.x * uAspect, uv.y);     // square units: 1 = image height
        float t = uT;
        vec2 d = vec2(0.);                       // displacement, in image widths

        // wind: gusts roll left to right; canopies move as masses, not as jelly
        float gust = .3 + .7 * smoothstep(-.2, .45, noise(vec2(p.x * .8 - t * .13, p.y * .6 + t * .015)));
        float sway = sin(t * 1.25 + p.x * 2.1 + p.y * 1.4 + noise(p * 1.4) * 3.) * .85      // the breeze: boughs rock
                   + noise(p * 2.1 + vec2(t * .22, -t * .13)) * .9;
        float lift = sin(t * 1.1 + p.x * 1.7 + 1.3) * .35 + noise(p * 2.5 + vec2(-t * .16, t * .18));
        vec2 flut = vec2(noise(p * 15. + vec2(t * .9, t * .35)), noise(p * 15. + vec2(-t * .45, t * .8) + 7.3));
        d += (vec2(sway, lift * .4) * .0075 * gust + flut * .0007 * (.3 + gust)) * fol;

        // pond: reflections quiver, stretched along the water
        float b1 = noise(vec2(p.x * 6., p.y * 70.) + vec2(t * .12, -t * .5));
        float b2 = noise(vec2(p.x * 11., p.y * 140.) + vec2(-t * .18, -t * .85));
        d += vec2(b2 * .0008, (b1 * .75 + b2 * .25) * .0022) * pond;

        // ── the waterfall, modelled on falling water ──
        // Water leaves the lip almost still and accelerates in free fall (speed ∝ √(2g·h)): glassy at
        // the top, stretching into faster, longer streamers that break apart lower down. Its path is
        // straight down, then a slide of about 42° down-left over the rock that splits the falls.
        float lipY = mix(.588, .594, smoothstep(.922, .932, uv.x));
        float fs = max(uv.y - lipY, 0.);                                 // distance fallen
        float speed = sqrt(fs + .003);                                   // a little speed already at the lip
        float onRock = smoothstep(.643, .656, uv.y) * smoothstep(.931, .922, uv.x);
        vec2 T = normalize(mix(vec2(0., 1.), vec2(-.9, 1.), onRock));    // along the flow (square units, y down)
        vec2 N = vec2(T.y, -T.x);                                        // across it
        float across = dot(p, N), along = dot(p, T);
        // strands waver sideways, more as they speed up
        d += N / uAspect * (noise(vec2(across * 140., along * 5. - t * 2.2)) * .0007 + noise(vec2(across * 320., along * 11. - t * 4.1)) * .0003)
             * fallCore * (.4 + 1.6 * speed);

        // smoke: from the altar fire beside the temple, and from the roof ridge above it. Drawn analytically;
        // the altar plume must stop short of the temple's columns
        vec2 sp = p - vec2(.7196 * uAspect, .5345);
        vec2 sq = p - vec2(.7528 * uAspect, .4864);
        vec2 sr = p - vec2(.7612 * uAspect, .4856);
        float shA = -sp.y;
        float smokeA = plume(sp, .1, .042, .003, .3) * smoothstep(.7243, .7233, uv.x);
        float smokeB = plume(sq, .35, .016, .0022, .35);
        float smokeC = plume(sr, .3, .028, .0028, .3);
        float smoke = max(smokeA, max(smokeB, smokeC));
        // plumes sway more the higher they rise
        d.x += (noise(vec2(shA * 70. - t * 1.1, t * .35)) * smokeA * smoothstep(0., .03, shA)
              + noise(vec2(-sq.y * 90. - t * 1.3, t * .4 + 5.)) * smokeB * smoothstep(0., .012, -sq.y)
              + noise(vec2(-sr.y * 90. - t * 1.2, t * .4 + 9.)) * smokeC * smoothstep(0., .02, -sr.y)) * .0016;

        d *= uAmp;
        d.y *= uAspect;                          // widths → image-uv in y

        // clouds: continuous drift by two phase-offset samples crossfaded (a flow map),
        // plus a slow change of shape; offsets fade out toward mountains and trees
        // (no branch here: sampling inside one breaks mip derivatives and draws seams)
        // The same trick carries the waterfall down and the smoke up, each at its own pace;
        // their phases are staggered strand by strand so the crossfade never pulses in unison.
        float isFall = step(.001, fallCore), isSmoke = step(.001, smoke) * (1. - isFall);
        // each strand of the falls has its own speed and phase, so nothing slides down as one sheet
        float strand = noise(vec2(across * 45., 7.));
        float per = mix(mix(36., 2.6, isSmoke), .5 + .22 * strand, isFall);
        float stagger = noise(vec2(p.x * 26., p.y * 3.)) * .45 * isSmoke
                      + (noise(vec2(across * 28. + 11., along * 2.5)) * .7 + noise(vec2(across * 80., along * 5. + 3.)) * .25) * isFall;
        float ph = fract(t / per + stagger), ph1 = fract(ph + .5);
        float spray = smoothstep(.645, .675, uv.y) * smoothstep(.72, .7, uv.y) * smoothstep(.886, .9, uv.x) * smoothstep(.958, .946, uv.x);
        vec2 dir = vec2(-.02, 0.) * sky                      // clouds: a modest range, so the copies never visibly double
                 - T * (.0018 * speed / .33) * (1. + .3 * strand) / uAspect * fallCore   // the painted water runs along its path, faster lower down
                 + vec2(0., .007 / uAspect) * smoke;           // smoke rises
        vec2 morph = vec2(noise(p * 2.2 + vec2(t * .05, 0.)), noise(p * 2.2 - vec2(0., t * .04) + 4.1)) * .012 * sky;   // clouds billow
        vec2 o0 = (dir * (ph - .5) + morph) * uAmp, o1 = (dir * (ph1 - .5) + morph) * uAmp;
        o0.y *= uAspect; o1.y *= uAspect;
        vec3 col = mix(SAMPLE(uImg, uv + d + o0).rgb, SAMPLE(uImg, uv + d + o1).rgb, abs(2. * ph - 1.));

        float lum = dot(col, vec3(.299, .587, .114));
        // leaves turning in the wind catch the light
        col *= 1. + fol * noise(p * 20. + vec2(t * .55, -t * .35)) * .11 * smoothstep(.12, .55, lum) * gust * uAmp;
        // glints on the water
        float glint = smoothstep(.38, .6, noise(vec2(p.x * 38., p.y * 240.) + vec2(t * .25, -t * 1.3)));
        col += pond * glint * smoothstep(.3, .65, lum) * .2 * uAmp;
        // Streamers drift through "fall time" (√distance) at a steady rate, so on screen they
        // accelerate and lengthen as they drop, like real water
        float tau = 2. * speed;
        float s1 = noise(vec2(across * 380., tau * 22. - t * 4.4));
        float s2 = noise(vec2(across * 820. + 7., tau * 40. - t * 6.9));
        float s3 = noise(vec2(across * 150. + 3., tau * 8. - t * 1.9));  // broader surges
        float streamer = s1 * .7 + s2 * .45 + s3 * .6;
        float broken = smoothstep(.0, .06, fs);                          // sheet → streamers → spray
        // where there is water: pale painted water inside the falls, with edges that fray as it breaks up
        float pale = smoothstep(.3, .55, lum) * smoothstep(.42, .2, (max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b))) / max(col.r, .01));
        float wet = smoothstep(.3, .65, fall + (s2 * .5 + s1 * .3) * broken * .4) * mix(pale, 1., .25 * broken * smoothstep(.5, .8, fall));
        float lit = smoothstep(.2 - .12 * broken, .78, streamer);
        float fine = smoothstep(.25, .7, noise(vec2(across * 1500. + 2., tau * 70. - t * 9.)));   // threads of spray
        float gap = smoothstep(-.1, -.65, streamer) * broken;
        // light and shade work on the painting's own colours, so its brushwork and canvas grain stay visible
        col = 1. - (1. - col) * (1. - wet * (lit * (.3 + .12 * broken) + fine * .12 * broken) * uAmp);   // screen: brightens, never clips
        col *= 1. - wet * gap * .24 * uAmp;
        // a glassy sheen where the water slips over the lip
        col += fall * exp(-fs / .006) * (.6 + .4 * noise(vec2(across * 120., t * 1.4))) * .07 * uAmp;
        // white water churning in place where the falls strike the rock, and at their foot
        vec2 kRock = (p - vec2(.924 * uAspect, .649)) * vec2(1., 1.5), kFoot = (p - vec2(.918 * uAspect, .688)) * vec2(.5, 1.);
        float churnZone = exp(-dot(kRock, kRock) / .00012) + exp(-dot(kFoot, kFoot) / .00022);
        float boil = noise(p * 520. + vec2(sin(t * 1.7), cos(t * 1.3)) * 1.2) * .6 + noise(p * 1100. + vec2(cos(t * 2.3), sin(t * 2.9)) * 1.5) * .4;
        col *= 1. + churnZone * (smoothstep(.0, .5, boil) - .35) * .3 * smoothstep(.3, .6, fall) * uAmp;
        // spray billowing up from the plunge and drifting off with the breeze
        float mist = noise(vec2(p.x * 34. - t * .08, p.y * 28. + t * .5)) + .6 * noise(vec2(p.x * 70. + t * .1, p.y * 60. + t * .9) + 2.);
        float mistZone = exp(-dot(kFoot, kFoot) / .0005) * (1. - smoothstep(.0, .02, .668 - uv.y) * .5);
        col = mix(col, vec3(.89, .85, .82), mistZone * smoothstep(-.1, .75, mist) * .2 * uAmp);

        // the altar fire flickers
        float fire = smoothstep(.0045, .0012, length(sp + vec2(0., .001)));
        float flick = noise(vec2(t * 7., 1.3)) * .6 + noise(vec2(t * 15., 4.1)) * .4;
        col *= 1. + fire * flick * .4 * smoothstep(.0, .12, col.r - col.b) * uAmp;
        // each plume keeps rising past what was painted, thinning and leaning with the wind
        float wA = wisp(sp, t, .024, .35, .007, .22, .065, 0.);
        float wC = wisp(sr, t, .022, .55, .006, .26, .058, 4.);
        float wB = wisp(sq, t, .008, .5, .004, .3, .035, 8.);
        vec3 tintA = texture2D(uImg, vec2(.7195, .512)).rgb * 1.04;
        vec3 tintB = texture2D(uImg, vec2(.7528, .4852)).rgb * 1.02;
        col = mix(col, tintA, wA * .3 * uAmp);
        col = mix(col, tintB, max(wB, wC) * .34 * uAmp);
        // cloud shadows crossing the land, very faint
        float shade = smoothstep(-.05, .45, noise(vec2(p.x * 1.2 - t * .03, p.y * 2.3 + 3.)));
        col *= 1. - .09 * shade * (1. - sky) * smoothstep(.3, .6, uv.y) * uAmp;

        gl_FragColor = vec4(col, 1.);
      }`;

    // Displacing the painting with fine noise makes texture coordinates change fast from pixel to
    // pixel, and the GPU answers by sampling a blurrier mip level. So each sample is told its detail
    // level from the undisplaced coordinate (textureGrad), keeping the painting crisp while it moves.
    const lodExt = !gl2 && gl.getExtension("OES_standard_derivatives") && gl.getExtension("EXT_shader_texture_lod");
    const HEAD = gl2
      ? "#version 300 es\nprecision highp float;\n#define varying in\n#define texture2D texture\nout vec4 fragOut;\n#define gl_FragColor fragOut\n#define SAMPLE(s, c) textureGrad(s, c, gx, gy)\n#define GRADS(u) gx = dFdx(u); gy = dFdy(u);\n"
      : lodExt
        ? "#extension GL_OES_standard_derivatives : enable\n#extension GL_EXT_shader_texture_lod : enable\nprecision highp float;\n#define SAMPLE(s, c) texture2DGradEXT(s, c, gx, gy)\n#define GRADS(u) gx = dFdx(u); gy = dFdy(u);\n"
        : "precision highp float;\n#define SAMPLE(s, c) texture2D(s, c)\n#define GRADS(u)\n";
    const VS = gl2 ? "#version 300 es\nin vec2 a; out vec2 vUv;\nvoid main(){ vUv = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }" : VS1;

    function shader(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, HEAD + FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) { console.warn("Opening painting stays still:", err); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ["uImg", "uMask", "uScale", "uOff", "uT", "uAmp", "uAspect"].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

    function texture(unit, source, mip) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    const loaded = (el) => (el.complete && el.naturalWidth ? Promise.resolve() : new Promise((r, j) => { el.addEventListener("load", r, { once: true }); el.addEventListener("error", j, { once: true }); }));
    // decode() can reject in a background tab; then simply wait for the ordinary load
    const ready = (el) => (el.decode ? el.decode().catch(() => loaded(el)) : loaded(el));
    const picture = (src) => { const i = new Image(); i.src = src; return ready(i).then(() => i); };
    // Opened as a file, the browser won't let WebGL read local images, so load embedded copies
    // (data: URIs are allowed). Served over http(s), use the image already on the page.
    function sources() {
      if (location.protocol === "file:") {
        return new Promise((r, j) => {
          const s = document.createElement("script");
          s.src = "images/dream-of-arcadia-embed.js";
          s.onload = r; s.onerror = j;
          document.head.appendChild(s);
        }).then(() => Promise.all([picture(window.__arcadiaEmbed.img), picture(window.__arcadiaEmbed.mask)]));
      }
      const imgReady = img.complete && img.naturalWidth ? Promise.resolve() : new Promise((r, j) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", j, { once: true }); });
      return Promise.all([imgReady.then(() => ready(img)).then(() => img), picture("images/dream-of-arcadia-mask.png?v=2")]);
    }

    let aspect = 1.5, start = 0, raf = 0, last = 0, visible = true, live = false;
    function size() {
      const w = art.clientWidth || innerWidth, h = art.clientHeight || innerHeight;
      let dpr = Math.min(devicePixelRatio || 1, 2);
      const budget = 5.2e6;                                   // keep the fragment count humane
      if (w * h * dpr * dpr > budget) dpr = Math.sqrt(budget / (w * h));
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      const ca = w / h;                                       // replicate object-fit: cover; object-position: 60% 50%
      if (ca > aspect) { gl.uniform2f(U.uScale, 1, aspect / ca); gl.uniform2f(U.uOff, 0, (1 - aspect / ca) * 0.5); }
      else { gl.uniform2f(U.uScale, ca / aspect, 1); gl.uniform2f(U.uOff, (1 - ca / aspect) * 0.6, 0); }
    }
    const SEED = 40 + Math.random() * 400;                    // each visit, a different moment of the same afternoon
    function draw(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(draw);
      if (now - last < 32) return;                           // ~30 fps is plenty for motion this slow
      last = now;
      paint(now);
      if (!live) { live = true; requestAnimationFrame(() => cv.classList.add("is-live")); }
    }
    function paint(now) {
      if (!start) start = now;
      const s = (now - start) / 1000;
      const ramp = clamp(s / 3);
      gl.uniform1f(U.uT, SEED + s);
      gl.uniform1f(U.uAmp, ramp * ramp * (3 - 2 * ramp));    // ease in from the still image
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(draw); };

    sources().then(([pic, mask]) => {
      aspect = pic.naturalWidth / pic.naturalHeight;
      texture(0, pic, gl2);
      texture(1, mask, false);
      gl.uniform1i(U.uImg, 0); gl.uniform1i(U.uMask, 1);
      gl.uniform1f(U.uAspect, aspect);
      art.appendChild(cv);
      size();
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(art);
      document.addEventListener("visibilitychange", kick);
      // resizing wipes a WebGL canvas, so repaint at once rather than show black until the next frame
      const onResize = () => { size(); paint(performance.now()); last = 0; kick(); };
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(art); else addEventListener("resize", onResize);
      kick();
    }).catch((err) => console.warn("Opening painting stays still:", err));

    cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; visible = false; cv.classList.remove("is-live"); });
  })();

  /* ─────────────── The stoa: the verses follow the eye ───────────────
     The painting stays whole. A pool of light moves to what is being described and the verse
     appears beside it. Each focus: x, y, radius (fractions of the picture's width), side for the verse. */
  (() => {
    const scene = $(".society__scene"); if (!scene) return;
    const stage = $(".society__stage"), img = $(".society__img"), dim = $(".society__dim");
    const verses = $$(".verse", stage), steps = $$(".step", scene);
    const RATIO = 1.5;                                  // the painting is 3:2
    const FOCUS = [
      [0.42, 0.26, 0.30, "below"],   // the portico
      [0.52, 0.55, 0.17, "above"],   // the table
      [0.45, 0.72, 0.15, "left"],    // the lyre and the boy
      [0.17, 0.46, 0.13, "right"],   // the easel
      [0.82, 0.66, 0.14, "left"],    // the old man
      [0.87, 0.47, 0.12, "left"],    // the robots
    ];
    let cur = -1;
    function layout() {
      const vw = stage.clientWidth, vh = stage.clientHeight; if (!vw || !vh) return;
      const narrow = vw <= 860;
      const wc = narrow ? vw : Math.min(vw, vh * RATIO * 0.94), hc = wc / RATIO;
      const left = (vw - wc) / 2, top = narrow ? Math.max(12, (vh * 0.6 - hc) / 2) : (vh - hc) / 2;
      img.style.width = wc + "px"; img.style.height = hc + "px"; img.style.left = left + "px"; img.style.top = top + "px";
      const f = FOCUS[cur];
      if (!f) { dim.style.setProperty("--fr", "4000px"); dim.style.setProperty("--fx", vw / 2 + "px"); dim.style.setProperty("--fy", vh / 2 + "px"); return; }
      const fx = left + f[0] * wc, fy = top + f[1] * hc, fr = f[2] * wc;
      dim.style.setProperty("--fx", fx + "px"); dim.style.setProperty("--fy", fy + "px"); dim.style.setProperty("--fr", fr + "px");
      verses.forEach((v, i) => {
        if (narrow) { v.style.left = v.style.top = ""; return; }
        if (i !== cur) return;
        const w = v.offsetWidth, h = v.offsetHeight, gap = 18;
        let x, y;
        if (f[3] === "right") { x = fx + fr + gap; y = fy - h / 2; }
        else if (f[3] === "left") { x = fx - fr - gap - w; y = fy - h / 2; }
        else if (f[3] === "above") { x = fx - w / 2; y = fy - fr - gap - h; }
        else { x = fx - w / 2; y = fy + fr + gap; }
        v.style.left = clamp(x, 16, vw - w - 16) + "px";
        v.style.top = clamp(y, 16, vh - h - 16) + "px";
      });
    }
    function update() {
      const mid = scrollY + innerHeight / 2;
      let next = 0, best = Infinity;
      steps.forEach((s, i) => { const r = s.getBoundingClientRect(), d = Math.abs(scrollY + r.top + r.height / 2 - mid); if (d < best) { best = d; next = i; } });
      if (next >= FOCUS.length) next = -1;               // the outro: the whole picture, unlit by anything
      if (next !== cur) { cur = next; verses.forEach((v, i) => v.classList.toggle("is-on", i === cur)); }
      layout();
    }
    let q = false;
    const go = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; update(); }); };
    addEventListener("scroll", go, { passive: true });
    addEventListener("resize", go);
    if (window.ResizeObserver) { const ro = new ResizeObserver(go); ro.observe(stage); verses.forEach((v) => ro.observe(v)); }   // a gloss opening or a new language changes a verse's size
    update();
  })();

  /* ─────────────── Start in the reader's language ─────────────── */
  langUI();
  if (lang !== "en") applyLang(lang); else root.classList.remove("i18n-wait");

  /* ─────────────── Frame loop ─────────────── */
  let ticking = false;
  function frame() { ticking = false; fugeUpdate(); }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  addEventListener("resize", () => { frame(); ageUpdate(); });
  frame();
})();
