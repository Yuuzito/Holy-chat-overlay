/**
 * Holy Chat - new message sound. Every sound is made with the Web Audio API, so there are no
 * audio files to load or license. window.HolySound.play(type, volume) with volume 1–100.
 */
(function () {
    'use strict';

    let ctx = null;
    let lastPlay = 0;
    // In a busy chat one sound per message would be noise: at most one every 120 ms
    const MIN_GAP_MS = 120;

    // Browsers only start audio after a click or key press on the page. OBS browser sources
    // allow it from the start; the settings page wakes it on the first interaction.
    function audio() {
        if (!ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            ctx = new Ctx();
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
    }

    ['pointerdown', 'keydown'].forEach(type => {
        window.addEventListener(type, () => { if (!ctx || ctx.state === 'suspended') audio(); }, { passive: true });
    });

    // One note: an oscillator through a gain envelope (fast attack, exponential decay)
    function tone(ac, out, { type = 'sine', freq, to, at = 0, len = 0.2, gain = 1 }) {
        const t = ac.currentTime + at;
        const osc = ac.createOscillator();
        const env = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t + len);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(env).connect(out);
        osc.start(t);
        osc.stop(t + len + 0.02);
    }

    // A short burst of filtered noise, for the knock
    function thump(ac, out, { at = 0, freq = 180, len = 0.08, gain = 1 }) {
        const t = ac.currentTime + at;
        const frames = Math.ceil(ac.sampleRate * len);
        const buffer = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        const src = ac.createBufferSource();
        const filter = ac.createBiquadFilter();
        const env = ac.createGain();
        src.buffer = buffer;
        filter.type = 'lowpass';
        filter.frequency.value = freq * 4;
        env.gain.value = gain;
        src.connect(filter).connect(env).connect(out);
        src.start(t);
        tone(ac, out, { type: 'sine', freq, to: freq * 0.6, at, len, gain: gain * 0.8 });
    }

    const VOICES = {
        default: (ac, out) => {
            tone(ac, out, { freq: 880, len: 0.12, gain: 0.6 });
            tone(ac, out, { freq: 1320, at: 0.07, len: 0.16, gain: 0.45 });
        },
        chime: (ac, out) => {
            [1047, 1319, 1568].forEach((freq, i) => tone(ac, out, { type: 'triangle', freq, at: i * 0.08, len: 0.5, gain: 0.45 }));
        },
        bell: (ac, out) => {
            tone(ac, out, { freq: 784, len: 1.1, gain: 0.6 });
            tone(ac, out, { freq: 784 * 2.76, len: 0.6, gain: 0.18 });
            tone(ac, out, { freq: 784 * 5.4, len: 0.3, gain: 0.08 });
        },
        pop: (ac, out) => {
            tone(ac, out, { freq: 900, to: 220, len: 0.09, gain: 0.8 });
        },
        digital: (ac, out) => {
            tone(ac, out, { type: 'square', freq: 1200, len: 0.06, gain: 0.22 });
            tone(ac, out, { type: 'square', freq: 1600, at: 0.08, len: 0.06, gain: 0.22 });
        },
        soft: (ac, out) => {
            tone(ac, out, { freq: 523, len: 0.45, gain: 0.35 });
            tone(ac, out, { freq: 659, at: 0.05, len: 0.45, gain: 0.25 });
        },
        sparkle: (ac, out) => {
            [1568, 2093, 2637, 3136].forEach((freq, i) => tone(ac, out, { type: 'triangle', freq, at: i * 0.045, len: 0.25, gain: 0.3 }));
        },
        pulse: (ac, out) => {
            tone(ac, out, { type: 'sawtooth', freq: 220, len: 0.12, gain: 0.25 });
            tone(ac, out, { type: 'sawtooth', freq: 220, at: 0.16, len: 0.12, gain: 0.25 });
        },
        arcade: (ac, out) => {
            [523, 659, 784, 1047].forEach((freq, i) => tone(ac, out, { type: 'square', freq, at: i * 0.05, len: 0.07, gain: 0.2 }));
        },
        knock: (ac, out) => {
            thump(ac, out, { gain: 0.9 });
            thump(ac, out, { at: 0.14, gain: 0.8 });
        }
    };

    function play(type, volume) {
        if (!(volume > 0)) return;
        const now = Date.now();
        if (now - lastPlay < MIN_GAP_MS) return;
        const ac = audio();
        if (!ac || ac.state !== 'running') return;
        lastPlay = now;
        const out = ac.createGain();
        // The slider is linear for the ear: 50% sounds about half as loud as 100%
        out.gain.value = Math.pow(Math.min(100, volume) / 100, 2);
        out.connect(ac.destination);
        (VOICES[type] || VOICES.default)(ac, out);
    }

    // Starts the audio context ahead of time (the settings page calls it when sound is switched on)
    function unlock() {
        audio();
    }

    window.HolySound = { play, unlock };
})();
