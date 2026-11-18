/**
 * Holy Overlay - Kick Prediction Overlay
 * Separate OBS overlay widget (?widget=prediction&overlay=true) that polls the latest
 * prediction of a Kick channel and shows the title, options, percentages, points,
 * countdown, winner celebration and confetti.
 *
 * Loaded before app.js, which calls window.HolyPrediction.setup(...).
 */
(function () {
    'use strict';

    const PRED_LAYOUTS = [
        { id: 'standard', name: 'Estándar (640 px)' },
        { id: 'horizontal', name: 'Horizontal (840 px)' },
        { id: 'compact', name: 'Compacto (520 px)' },
        { id: 'minimal', name: 'Minimal (410 px)' }
    ];
    const PRED_POSITIONS = ['top', 'center', 'bottom'];

    const STEPS = {
        predPos: { values: PRED_POSITIONS, labels: ['Arriba', 'Centro', 'Abajo'] }
    };

    // Same adaptive rhythm as the standalone overlay, through the chat's CORS-aware client
    const POLL = {
        active: 2500,
        locked: 3000,
        idle: 7500
    };

    const $ = id => document.getElementById(id);

    function bool(value, fallback = false) {
        if (value === undefined || value === null) return fallback;
        return value === true || value === 'true';
    }

    function pick(params, cached, param, key, fallback) {
        if (params.get(param) !== null) return params.get(param);
        if (cached && cached[key] !== undefined) return cached[key];
        return fallback;
    }

    function validLayout(id) {
        const norm = String(id || '').toLowerCase();
        return PRED_LAYOUTS.some(l => l.id === norm) ? norm : 'standard';
    }

    function parse(params, cached) {
        const pos = String(pick(params, cached, 'predPos', 'predPos', 'center')).toLowerCase();
        return {
            predLayout: validLayout(pick(params, cached, 'predLayout', 'predLayout', 'standard')),
            predPos: PRED_POSITIONS.includes(pos) ? pos : 'center',
            predAutohide: bool(pick(params, cached, 'predAutohide', 'predAutohide', true), true)
        };
    }

    function toCache(config) {
        return {
            predLayout: config.predLayout,
            predPos: config.predPos,
            predAutohide: config.predAutohide
        };
    }

    function buildUrl(config, forObs = true) {
        const q = new URLSearchParams();
        q.set('channel', config.channel);
        q.set('widget', 'prediction');
        q.set('predLayout', config.predLayout);
        q.set('predPos', config.predPos);
        q.set('predAutohide', String(config.predAutohide));
        if (forObs) q.set('overlay', 'true');
        return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
    }

    // -------------------------------------------------------------------------
    // DOM & runtime state
    // -------------------------------------------------------------------------
    const el = {};
    let deps = null;
    let configRef = null;
    let currentChannel = '';
    let currentPrediction = null;
    let samplePrediction = null;
    let demoPrediction = null;
    let demoActive = false;
    let active = false;
    let previousState = null;
    let winnerAnnounced = false;
    let pollTimer = null;
    let pollToken = 0;
    let countdownTimer = null;
    let autoHideTimer = null;
    let confetti = null;

    function cacheElements() {
        [
            'predictionOverlay', 'prediction-card', 'prediction-title', 'status-pill', 'status-text',
            'center-icon', 'timer-text', 'outcome-card-1', 'outcome-1-title', 'outcome-1-multiplier',
            'outcome-1-percent', 'outcome-1-points', 'outcome-1-voters', 'outcome-card-2',
            'outcome-2-title', 'outcome-2-multiplier', 'outcome-2-percent', 'outcome-2-points',
            'outcome-2-voters', 'progress-bar-1', 'progress-bar-2', 'progress-divider',
            'winner-banner', 'winner-name-display', 'total-points-display', 'total-voters-display',
            'predConfettiCanvas', 'predPreviewStatus', 'cfgPredLayout', 'cfgPredPos',
            'cfgPredAutohide', 'predDemoStart', 'predDemoVotes', 'predDemoLock', 'predDemoWin1',
            'predDemoWin2', 'predDemoCancel', 'predDemoInactive', 'predDemoReset', 'btnTestPrediction'
        ].forEach(id => { el[id] = $(id); });

        el.widget = el['prediction-card'];
        el.overlay = el.predictionOverlay;
        el.title = el['prediction-title'];
        el.statusPill = el['status-pill'];
        el.statusText = el['status-text'];
        el.centerIcon = el['center-icon'];
        el.timerText = el['timer-text'];
        el.card1 = el['outcome-card-1'];
        el.title1 = el['outcome-1-title'];
        el.multiplier1 = el['outcome-1-multiplier'];
        el.percent1 = el['outcome-1-percent'];
        el.points1 = el['outcome-1-points'];
        el.voters1 = el['outcome-1-voters'];
        el.card2 = el['outcome-card-2'];
        el.title2 = el['outcome-2-title'];
        el.multiplier2 = el['outcome-2-multiplier'];
        el.percent2 = el['outcome-2-percent'];
        el.points2 = el['outcome-2-points'];
        el.voters2 = el['outcome-2-voters'];
        el.progressBar1 = el['progress-bar-1'];
        el.progressBar2 = el['progress-bar-2'];
        el.progressDivider = el['progress-divider'];
        el.winnerBanner = el['winner-banner'];
        el.winnerName = el['winner-name-display'];
        el.totalPoints = el['total-points-display'];
        el.totalVoters = el['total-voters-display'];
        el.confettiCanvas = el.predConfettiCanvas;
        el.previewStatus = el.predPreviewStatus;
    }

    // -------------------------------------------------------------------------
    // Confetti engine (60 fps, same colours as the original overlay)
    // -------------------------------------------------------------------------
    class ConfettiEngine {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas ? canvas.getContext('2d') : null;
            this.particles = [];
            this.animating = false;
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            if (!this.canvas) return;
            const host = el.overlay;
            const width = (host && host.clientWidth) || window.innerWidth;
            const height = (host && host.clientHeight) || window.innerHeight;
            this.canvas.width = Math.max(1, width);
            this.canvas.height = Math.max(1, height);
        }

        burst(count = 90) {
            if (!this.ctx) return;
            this.resize();
            const colors = ['#FFD700', '#53FC18', '#00E5FF', '#FF2A85', '#FFFFFF', '#FFA751'];
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 12 + 6;
                this.particles.push({
                    x: cx + (Math.random() - 0.5) * 300,
                    y: cy + (Math.random() - 0.5) * 100,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed - 5,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: Math.random() * 8 + 5,
                    rotation: Math.random() * 360,
                    rotSpeed: (Math.random() - 0.5) * 12,
                    opacity: 1,
                    gravity: 0.25,
                    drag: 0.96
                });
            }

            if (!this.animating) {
                this.animating = true;
                this.render();
            }
        }

        render() {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.vx *= p.drag;
                p.vy = p.vy * p.drag + p.gravity;
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotSpeed;
                p.opacity -= 0.008;

                if (p.opacity <= 0 || p.y > this.canvas.height) {
                    this.particles.splice(i, 1);
                    continue;
                }

                this.ctx.save();
                this.ctx.globalAlpha = Math.max(0, p.opacity);
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate((p.rotation * Math.PI) / 180);
                this.ctx.fillStyle = p.color;
                this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                this.ctx.restore();
            }

            if (this.particles.length > 0) {
                requestAnimationFrame(() => this.render());
            } else {
                this.animating = false;
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Formatting helpers
    // -------------------------------------------------------------------------
    function formatPoints(num) {
        if (typeof num !== 'number' || isNaN(num)) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
        if (num >= 10000) return (num / 1000).toFixed(1).replace('.0', '') + 'K';
        return num.toLocaleString('en-US');
    }

    function formatNumber(num) {
        if (typeof num !== 'number' || isNaN(num)) return '0';
        return num.toLocaleString('es-ES');
    }

    function formatTime(seconds) {
        if (seconds <= 0) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // -------------------------------------------------------------------------
    // Kick API (uses the chat client's proxy fallback, so GitHub Pages works)
    // -------------------------------------------------------------------------
    async function fetchLatestPrediction(channel) {
        const url = `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}/predictions/latest`;
        try {
            if (window.KickApi && typeof window.KickApi.fetchJson === 'function') {
                const json = await window.KickApi.fetchJson(url, 4000);
                return json && json.data ? (json.data.prediction || null) : null;
            }
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) return null;
            const json = await response.json();
            return json && json.data ? (json.data.prediction || null) : null;
        } catch (err) {
            console.warn('[HolyPrediction] No se pudo consultar la predicción:', err);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Preview helpers
    // -------------------------------------------------------------------------
    function isMenu() {
        return Boolean(deps && deps.isMenuMode && deps.isMenuMode());
    }

    function channelName() {
        return String((configRef && configRef.channel) || 'rageylo').toLowerCase();
    }

    function setPreviewStatus(text) {
        if (el.previewStatus) el.previewStatus.textContent = text;
    }

    function makeMockPrediction(title) {
        return {
            id: 'demo-pred',
            title: title || '¿Qué equipo gana?',
            created_at: new Date().toISOString(),
            duration: 180,
            state: 'ACTIVE',
            winning_outcome_id: null,
            outcomes: [
                { id: 'demo-opt-1', title: 'Azul', total_vote_amount: 9217, vote_count: 42, return_rate: 2.82 },
                { id: 'demo-opt-2', title: 'Rosa', total_vote_amount: 16800, vote_count: 78, return_rate: 1.55 }
            ]
        };
    }

    function renderPreviewSample() {
        if (!samplePrediction || Date.now() - new Date(samplePrediction.created_at).getTime() > 300000) {
            samplePrediction = makeMockPrediction();
        }
        renderPrediction(samplePrediction, { kind: 'sample' });
        setPreviewStatus(`Ejemplo · #${channelName()} sin predicción activa`);
    }

    // -------------------------------------------------------------------------
    // Renderer & states
    // -------------------------------------------------------------------------
    function renderPrediction(prediction, options) {
        if (!el.widget) return;
        const opts = options || {};
        const menu = isMenu();
        const autoHide = Boolean(configRef && configRef.predAutohide) && !menu;

        if (!prediction) {
            clearTimeout(autoHideTimer);
            if (autoHide) {
                el.widget.classList.add('hidden-state');
            } else {
                el.widget.classList.remove('hidden-state');
                el.title.textContent = 'Sin predicción activa en este canal';
                el.statusPill.className = 'status-pill status-cancelled';
                el.statusText.textContent = 'Inactivo';
                hideCenterIcon();
                el.timerText.textContent = '--:--';
                el.totalPoints.textContent = '0 pts';
                el.totalVoters.textContent = '0 votantes';
                el.card1.className = 'outcome-card option-1';
                el.card2.className = 'outcome-card option-2';
                el.winnerBanner.classList.remove('active');
                el.percent1.textContent = '50';
                el.percent2.textContent = '50';
                el.progressBar1.style.width = '50%';
                el.progressBar2.style.width = '50%';
                setPreviewStatus(`#${channelName()} · Sin predicción activa`);
            }
            return;
        }

        const state = String(prediction.state || 'ACTIVE').toUpperCase();
        const finishedTime = new Date(prediction.updated_at || prediction.created_at || 0).getTime();
        const isOldFinished = (state === 'RESOLVED' || state === 'CANCELLED') &&
            finishedTime > 0 &&
            !demoActive &&
            opts.kind !== 'sample' &&
            (Date.now() - finishedTime > 45 * 1000);

        if (isOldFinished && autoHide) {
            el.widget.classList.add('hidden-state');
            setPreviewStatus(`#${channelName()} · Sin predicción activa`);
            return;
        }

        clearTimeout(autoHideTimer);
        el.widget.classList.remove('hidden-state');

        el.title.textContent = prediction.title || 'Predicción en vivo';

        const outcome1 = prediction.outcomes?.[0] || { id: '1', title: 'Opción A', total_vote_amount: 0, vote_count: 0, return_rate: 1 };
        const outcome2 = prediction.outcomes?.[1] || { id: '2', title: 'Opción B', total_vote_amount: 0, vote_count: 0, return_rate: 1 };

        const pts1 = outcome1.total_vote_amount || 0;
        const pts2 = outcome2.total_vote_amount || 0;
        const totalPts = pts1 + pts2;

        const voters1 = outcome1.vote_count || 0;
        const voters2 = outcome2.vote_count || 0;
        const totalVoters = voters1 + voters2;

        let p1 = 50;
        let p2 = 50;
        if (totalPts > 0) {
            p1 = Math.round((pts1 / totalPts) * 100);
            p2 = 100 - p1;
        }

        el.title1.textContent = outcome1.title;
        el.multiplier1.textContent = `${Number(outcome1.return_rate || 1).toFixed(2)}x`;
        el.percent1.textContent = p1;
        el.points1.textContent = formatPoints(pts1);
        el.voters1.textContent = `${formatNumber(voters1)} votos`;

        el.title2.textContent = outcome2.title;
        el.multiplier2.textContent = `${Number(outcome2.return_rate || 1).toFixed(2)}x`;
        el.percent2.textContent = p2;
        el.points2.textContent = formatPoints(pts2);
        el.voters2.textContent = `${formatNumber(voters2)} votos`;

        el.totalPoints.textContent = formatPoints(totalPts);
        el.totalVoters.textContent = `${formatNumber(totalVoters)} votantes`;

        el.progressBar1.style.width = `${p1}%`;
        el.progressBar2.style.width = `${p2}%`;
        el.progressDivider.style.left = `${p1}%`;

        handleStateTransitions(state);

        if (state === 'ACTIVE') {
            el.statusPill.className = 'status-pill status-active';
            el.statusText.textContent = 'Votación Abierta';
            el.card1.className = 'outcome-card option-1';
            el.card2.className = 'outcome-card option-2';
            el.winnerBanner.classList.remove('active');
            startCountdown(prediction, totalPts);
        } else if (state === 'LOCKED') {
            el.statusPill.className = 'status-pill status-locked';
            el.statusText.textContent = 'Votación Cerrada';
            showTotalPointsCenter(totalPts);
            el.card1.className = 'outcome-card option-1';
            el.card2.className = 'outcome-card option-2';
            el.winnerBanner.classList.remove('active');
            stopCountdown();
        } else if (state === 'RESOLVED') {
            el.statusPill.className = 'status-pill status-resolved';
            el.statusText.textContent = 'Finalizada';
            showTotalPointsCenter(totalPts);
            stopCountdown();

            const winId = prediction.winning_outcome_id;
            if (String(winId) === String(outcome1.id)) {
                el.card1.className = 'outcome-card option-1 is-winner';
                el.card2.className = 'outcome-card option-2 is-loser';
                el.winnerName.textContent = outcome1.title;
            } else if (String(winId) === String(outcome2.id)) {
                el.card1.className = 'outcome-card option-1 is-loser';
                el.card2.className = 'outcome-card option-2 is-winner';
                el.winnerName.textContent = outcome2.title;
            }

            el.winnerBanner.classList.add('active');

            if (autoHide) {
                clearTimeout(autoHideTimer);
                autoHideTimer = setTimeout(() => {
                    el.widget.classList.add('hidden-state');
                }, 18000);
            }
        } else if (state === 'CANCELLED') {
            el.statusPill.className = 'status-pill status-cancelled';
            el.statusText.textContent = 'Cancelada';
            showTotalPointsCenter(totalPts);
            el.card1.className = 'outcome-card option-1 is-loser';
            el.card2.className = 'outcome-card option-2 is-loser';
            el.winnerBanner.classList.remove('active');
            stopCountdown();

            if (autoHide) {
                clearTimeout(autoHideTimer);
                autoHideTimer = setTimeout(() => {
                    el.widget.classList.add('hidden-state');
                }, 8000);
            }
        }

        previousState = state;

        if (opts.kind === 'demo') {
            const demoLabels = {
                ACTIVE: 'Demo · votación abierta',
                LOCKED: 'Demo · votación cerrada',
                RESOLVED: 'Demo · ganador anunciado',
                CANCELLED: 'Demo · cancelada'
            };
            setPreviewStatus(demoLabels[state] || 'Modo demo');
        } else if (opts.kind === 'sample') {
            setPreviewStatus(`Ejemplo · #${channelName()} sin predicción activa`);
        } else {
            const labels = {
                ACTIVE: 'Votación abierta',
                LOCKED: 'Votación cerrada',
                RESOLVED: 'Ganador anunciado',
                CANCELLED: 'Cancelada'
            };
            setPreviewStatus(`#${channelName()} · ${labels[state] || state}`);
        }
    }

    function handleStateTransitions(newState) {
        if (previousState && previousState !== newState) {
            if (newState === 'ACTIVE') {
                winnerAnnounced = false;
            } else if (newState === 'RESOLVED' && !winnerAnnounced) {
                if (confetti) confetti.burst(120);
                winnerAnnounced = true;
            }
        } else if (newState === 'RESOLVED' && !winnerAnnounced) {
            if (confetti) confetti.burst(80);
            winnerAnnounced = true;
        }
    }

    function showTotalPointsCenter(totalPts) {
        if (el.centerIcon) el.centerIcon.style.display = 'inline-flex';
        el.timerText.textContent = formatPoints(totalPts);
        el.timerText.setAttribute('title', 'Total apostado');
    }

    function hideCenterIcon() {
        if (el.centerIcon) el.centerIcon.style.display = 'none';
        el.timerText.removeAttribute('title');
    }

    function startCountdown(prediction, totalPts) {
        stopCountdown();

        const createdAt = new Date(prediction.created_at).getTime();
        const durationMs = (prediction.duration || 300) * 1000;
        const expiresAt = createdAt + durationMs;

        function update() {
            const remainingSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            if (remainingSeconds > 0) {
                hideCenterIcon();
                el.timerText.textContent = formatTime(remainingSeconds);
            } else {
                showTotalPointsCenter(totalPts);
                stopCountdown();
            }
        }

        update();
        countdownTimer = setInterval(update, 1000);
    }

    function stopCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Polling
    // -------------------------------------------------------------------------
    function stopPolling() {
        pollToken++;
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    function scheduleNextPoll(delayMs) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(pollPrediction, delayMs);
    }

    async function pollPrediction() {
        clearTimeout(pollTimer);
        pollTimer = null;
        if (!active || demoActive) return;

        const channel = channelName();
        if (channel !== currentChannel) {
            currentChannel = channel;
            currentPrediction = null;
            samplePrediction = null;
            previousState = null;
            winnerAnnounced = false;
        }

        const token = ++pollToken;
        const prediction = await fetchLatestPrediction(channel);
        if (!active || demoActive || token !== pollToken) return;

        currentPrediction = prediction;

        if (prediction) {
            samplePrediction = null;
            renderPrediction(prediction, { kind: 'live' });
        } else if (isMenu()) {
            // The settings page always shows the design: fall back to an example prediction
            renderPreviewSample();
        } else {
            renderPrediction(null, { kind: 'live' });
        }

        let next = POLL.idle;
        if (prediction) {
            if (prediction.state === 'ACTIVE') next = POLL.active;
            else if (prediction.state === 'LOCKED') next = POLL.locked;
        }
        scheduleNextPoll(next);
    }

    // -------------------------------------------------------------------------
    // Demo simulator
    // -------------------------------------------------------------------------
    function startDemo() {
        demoActive = true;
        stopPolling();
        stopCountdown();
        clearTimeout(autoHideTimer);
        winnerAnnounced = false;
        demoPrediction = makeMockPrediction();
        el.widget.classList.remove('hidden-state');
        renderPrediction(demoPrediction, { kind: 'demo' });
    }

    function addDemoVotes() {
        if (!demoPrediction || demoPrediction.state !== 'ACTIVE') return;

        const delta1 = Math.floor(Math.random() * 25000) + 5000;
        const delta2 = Math.floor(Math.random() * 20000) + 4000;

        demoPrediction.outcomes[0].total_vote_amount += delta1;
        demoPrediction.outcomes[0].vote_count += Math.floor(Math.random() * 6) + 1;
        demoPrediction.outcomes[1].total_vote_amount += delta2;
        demoPrediction.outcomes[1].vote_count += Math.floor(Math.random() * 5) + 1;

        const t1 = demoPrediction.outcomes[0].total_vote_amount;
        const t2 = demoPrediction.outcomes[1].total_vote_amount;
        const total = t1 + t2;
        demoPrediction.outcomes[0].return_rate = total / t1;
        demoPrediction.outcomes[1].return_rate = total / t2;

        renderPrediction(demoPrediction, { kind: 'demo' });
    }

    function lockDemo() {
        if (!demoPrediction) return;
        demoPrediction.state = 'LOCKED';
        renderPrediction(demoPrediction, { kind: 'demo' });
    }

    function declareDemoWinner(optionIndex) {
        if (!demoPrediction) startDemo();
        if (!demoPrediction) return;
        demoPrediction.state = 'RESOLVED';
        demoPrediction.winning_outcome_id = demoPrediction.outcomes[optionIndex].id;
        renderPrediction(demoPrediction, { kind: 'demo' });
    }

    function cancelDemo() {
        if (!demoPrediction) startDemo();
        if (!demoPrediction) return;
        demoPrediction.state = 'CANCELLED';
        demoPrediction.winning_outcome_id = null;
        renderPrediction(demoPrediction, { kind: 'demo' });
    }

    function simulateInactive() {
        demoActive = true;
        stopPolling();
        stopCountdown();
        clearTimeout(autoHideTimer);
        demoPrediction = null;
        currentPrediction = null;
        renderPrediction(null, { kind: 'demo' });
        setPreviewStatus('Modo demo · sin predicción');
    }

    function resetToChannel() {
        demoActive = false;
        demoPrediction = null;
        samplePrediction = null;
        currentPrediction = null;
        currentChannel = '';
        previousState = null;
        winnerAnnounced = false;
        stopCountdown();
        clearTimeout(autoHideTimer);
        setPreviewStatus(`Conectando a #${channelName()}...`);
        if (active) pollPrediction();
    }

    // -------------------------------------------------------------------------
    // Public lifecycle (called from app.js)
    // -------------------------------------------------------------------------
    function start(config) {
        if (config) configRef = config;
        active = true;
        demoActive = false;
        demoPrediction = null;
        samplePrediction = null;
        currentPrediction = null;
        currentChannel = '';
        previousState = null;
        winnerAnnounced = false;
        stopPolling();
        stopCountdown();
        clearTimeout(autoHideTimer);
        setPreviewStatus(`Conectando a #${channelName()}...`);
        pollPrediction();
    }

    function stop() {
        active = false;
        stopPolling();
        stopCountdown();
        clearTimeout(autoHideTimer);
    }

    function setActive(flag, config) {
        if (config) configRef = config;
        if (flag) {
            active = true;
            if (demoActive) {
                if (demoPrediction) renderPrediction(demoPrediction, { kind: 'demo' });
                else renderPrediction(null, { kind: 'demo' });
                return;
            }
            if (!pollTimer) {
                pollPrediction();
            } else if (channelName() !== currentChannel) {
                pollPrediction();
            }
        } else {
            active = false;
            stopPolling();
            stopCountdown();
            clearTimeout(autoHideTimer);
        }
    }

    function onChannelChange(config) {
        if (config) configRef = config;
        if (!active || demoActive) return;
        if (channelName() === currentChannel) return;
        pollPrediction();
    }

    // -------------------------------------------------------------------------
    // Settings panel
    // -------------------------------------------------------------------------
    function setup(dependencies) {
        deps = dependencies;
        configRef = deps.getConfig ? deps.getConfig() : null;
        cacheElements();
        confetti = new ConfettiEngine(el.confettiCanvas);

        if (el.cfgPredLayout) {
            el.cfgPredLayout.textContent = '';
            PRED_LAYOUTS.forEach(layout => el.cfgPredLayout.add(new Option(layout.name, layout.id)));
        }

        if (el.btnTestPrediction) el.btnTestPrediction.addEventListener('click', startDemo);
        if (el.predDemoStart) el.predDemoStart.addEventListener('click', startDemo);
        if (el.predDemoVotes) el.predDemoVotes.addEventListener('click', addDemoVotes);
        if (el.predDemoLock) el.predDemoLock.addEventListener('click', lockDemo);
        if (el.predDemoWin1) el.predDemoWin1.addEventListener('click', () => declareDemoWinner(0));
        if (el.predDemoWin2) el.predDemoWin2.addEventListener('click', () => declareDemoWinner(1));
        if (el.predDemoCancel) el.predDemoCancel.addEventListener('click', cancelDemo);
        if (el.predDemoInactive) el.predDemoInactive.addEventListener('click', simulateInactive);
        if (el.predDemoReset) el.predDemoReset.addEventListener('click', resetToChannel);

        if (typeof ResizeObserver === 'function' && el.overlay) {
            try {
                new ResizeObserver(() => confetti.resize()).observe(el.overlay);
            } catch (e) { }
        }
    }

    function populate(config) {
        if (el.cfgPredLayout) el.cfgPredLayout.value = config.predLayout;
        if (el.cfgPredPos && deps && deps.setStep) deps.setStep(el.cfgPredPos, config.predPos);
        if (el.cfgPredAutohide) el.cfgPredAutohide.checked = config.predAutohide;
    }

    function read(config) {
        if (el.cfgPredLayout) config.predLayout = validLayout(el.cfgPredLayout.value);
        if (el.cfgPredPos && deps && deps.stepValue) config.predPos = deps.stepValue(el.cfgPredPos);
        if (el.cfgPredAutohide) config.predAutohide = el.cfgPredAutohide.checked;
    }

    function applyStyles(config) {
        configRef = config;
        if (!el.overlay) return;

        el.overlay.classList.remove(...PRED_LAYOUTS.map(l => `pred-layout-${l.id}`));
        el.overlay.classList.add(`pred-layout-${validLayout(config.predLayout)}`);

        el.overlay.classList.remove(...PRED_POSITIONS.map(p => `pred-pos-${p}`));
        el.overlay.classList.add(`pred-pos-${PRED_POSITIONS.includes(config.predPos) ? config.predPos : 'center'}`);
    }

    window.HolyPrediction = {
        PRED_LAYOUTS,
        PRED_POSITIONS,
        STEPS,
        parse,
        toCache,
        buildUrl,
        setup,
        populate,
        read,
        applyStyles,
        start,
        stop,
        setActive,
        onChannelChange,
        startDemo,
        resetToChannel
    };
})();
