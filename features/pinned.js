/**
 * Holy Chat - Pinned Message Cartelito Overlay
 * Separate OBS overlay widget (?widget=pinned&overlay=true) that displays Kick pinned messages
 * as a customizable card/sign for a chosen number of seconds before disappearing.
 */
(function () {
    'use strict';

    const PIN_STYLES = [
        { id: 'minimal', name: 'Minimalista' },
        { id: 'inline', name: 'Compacto (1 línea)' },
        { id: 'kick', name: 'Kick Oscuro' },
        { id: 'ghost', name: 'Sin fondo (solo texto)' },
        { id: 'light', name: 'Claro' }
    ];
    const STYLE_ALIASES = { pill: 'inline', glass: 'minimal' };
    const PIN_POSITIONS = ['top', 'center', 'bottom'];
    const PIN_ANIMS = [
        { id: 'slide', name: 'Deslizar' },
        { id: 'pop', name: 'Rebote' },
        { id: 'fade', name: 'Desvanecer' },
        { id: 'none', name: 'Ninguna' }
    ];

    const STEPS = {
        pinPosition: { values: PIN_POSITIONS, labels: ['Arriba', 'Centro', 'Abajo'] }
    };

    const $ = id => document.getElementById(id);

    function clampInt(n, min, max, fallback) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v)) return fallback;
        return Math.min(max, Math.max(min, v));
    }

    function bool(value, fallback = false) {
        if (value === undefined || value === null) return fallback;
        return value === true || value === 'true';
    }

    function pick(params, cached, param, key, fallback) {
        if (params.get(param) !== null) return params.get(param);
        if (cached && cached[key] !== undefined) return cached[key];
        return fallback;
    }

    function validId(list, id, fallback) {
        const norm = String(id || '').toLowerCase();
        return list.some(item => item.id === norm) ? norm : fallback;
    }

    function validStyle(id) {
        const norm = String(id || '').toLowerCase();
        const mapped = STYLE_ALIASES[norm] || norm;
        return validId(PIN_STYLES, mapped, 'minimal');
    }

    function parse(params, cached) {
        const pos = String(pick(params, cached, 'pinPosition', 'pinPosition', 'top')).toLowerCase();
        return {
            widget: params.get('widget') === 'pinned' ? 'pinned' : 'chat',
            pinDuration: clampInt(pick(params, cached, 'pinDuration', 'pinDuration', 15), 1, 600, 15),
            pinPermanent: bool(pick(params, cached, 'pinPermanent', 'pinPermanent', false), false),
            pinStyle: validStyle(pick(params, cached, 'pinStyle', 'pinStyle', 'minimal')),
            pinPosition: PIN_POSITIONS.includes(pos) ? pos : 'top',
            pinAnim: validId(PIN_ANIMS, pick(params, cached, 'pinAnim', 'pinAnim', 'slide'), 'slide'),
            pinSize: clampInt(pick(params, cached, 'pinSize', 'pinSize', 18), 12, 36, 18),
            pinAuthor: bool(pick(params, cached, 'pinAuthor', 'pinAuthor', true), true),
            pinProgress: bool(pick(params, cached, 'pinProgress', 'pinProgress', true), true),
            pinSound: bool(pick(params, cached, 'pinSound', 'pinSound', false), false)
        };
    }

    function toCache(config) {
        return {
            pinDuration: config.pinDuration,
            pinPermanent: config.pinPermanent,
            pinStyle: config.pinStyle,
            pinPosition: config.pinPosition,
            pinAnim: config.pinAnim,
            pinSize: config.pinSize,
            pinAuthor: config.pinAuthor,
            pinProgress: config.pinProgress,
            pinSound: config.pinSound
        };
    }

    function buildUrl(config, forObs = true) {
        const q = new URLSearchParams();
        q.set('channel', config.channel);
        q.set('widget', 'pinned');
        q.set('pinDuration', String(config.pinDuration));
        q.set('pinPermanent', String(config.pinPermanent));
        q.set('pinStyle', config.pinStyle);
        q.set('pinPosition', config.pinPosition);
        q.set('pinAnim', config.pinAnim);
        q.set('pinSize', String(config.pinSize));
        q.set('pinAuthor', String(config.pinAuthor));
        q.set('pinProgress', String(config.pinProgress));
        q.set('pinSound', String(config.pinSound));
        q.set('sevenTVCosmeticsEnabled', String(config.sevenTVCosmetics));
        q.set('sevenTVEmotesEnabled', String(config.sevenTVEmotes));
        q.set('font', config.font);
        q.set('fontWeight', String(config.fontWeight));
        if (config.pinSound) {
            q.set('sound', String(config.soundVolume || 50));
            if (config.soundType && config.soundType !== 'default') q.set('soundType', config.soundType);
        }
        if (forObs) q.set('overlay', 'true');
        return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
    }

    // ---------- DOM & Runtime State ----------
    const el = {};
    let deps = null;
    let currentMsg = null;
    let currentPinToken = 0;
    let hideTimer = null;
    let leaveTimer = null;
    let countdownInterval = null;
    let expiresAt = 0;

    function cacheElements() {
        [
            'pinnedOverlay', 'pinnedCard', 'pinnedCardAuthorWrap', 'pinnedCardText',
            'pinnedCardProgress', 'pinnedCardProgressFill', 'pinPreviewCountdown',
            'cfgPinDuration', 'cfgPinDurationNum', 'fieldPinDuration', 'cfgPinPermanent',
            'cfgPinStyle', 'cfgPinPosition', 'cfgPinAnim', 'cfgPinSize',
            'cfgPinAuthor', 'cfgPinProgress', 'cfgPinSound', 'btnTestPin'
        ].forEach(id => { el[id] = $(id); });
    }

    function setup(dependencies) {
        deps = dependencies;
        cacheElements();

        if (el.cfgPinStyle) {
            PIN_STYLES.forEach(s => el.cfgPinStyle.add(new Option(s.name, s.id)));
        }
        if (el.cfgPinAnim) {
            PIN_ANIMS.forEach(a => el.cfgPinAnim.add(new Option(a.name, a.id)));
        }

        // Sync numeric input <-> range slider
        if (el.cfgPinDuration && el.cfgPinDurationNum) {
            el.cfgPinDuration.addEventListener('input', () => {
                el.cfgPinDurationNum.value = el.cfgPinDuration.value;
            });
            el.cfgPinDurationNum.addEventListener('input', () => {
                const raw = clampInt(el.cfgPinDurationNum.value, 1, 600, 15);
                if (raw <= Number(el.cfgPinDuration.max)) {
                    el.cfgPinDuration.value = String(raw);
                    if (deps.syncSlider) deps.syncSlider(el.cfgPinDuration);
                }
                if (deps.onMenuChange) deps.onMenuChange({ target: el.cfgPinDurationNum });
            });
            el.cfgPinDurationNum.addEventListener('blur', () => {
                el.cfgPinDurationNum.value = String(clampInt(el.cfgPinDurationNum.value, 1, 600, 15));
            });
        }

        if (el.btnTestPin) {
            el.btnTestPin.addEventListener('click', () => {
                showSample(deps.getConfig());
            });
        }
    }

    function populate(config) {
        if (el.cfgPinDuration) {
            el.cfgPinDuration.value = String(Math.min(Number(el.cfgPinDuration.max), config.pinDuration));
        }
        if (el.cfgPinDurationNum) el.cfgPinDurationNum.value = String(config.pinDuration);
        if (el.cfgPinPermanent) el.cfgPinPermanent.checked = config.pinPermanent;
        if (el.cfgPinStyle) el.cfgPinStyle.value = config.pinStyle;
        if (el.cfgPinPosition && deps.setStep) deps.setStep(el.cfgPinPosition, config.pinPosition);
        if (el.cfgPinAnim) el.cfgPinAnim.value = config.pinAnim;
        if (el.cfgPinSize) el.cfgPinSize.value = String(config.pinSize);
        if (el.cfgPinAuthor) el.cfgPinAuthor.checked = config.pinAuthor;
        if (el.cfgPinProgress) el.cfgPinProgress.checked = config.pinProgress;
        if (el.cfgPinSound) el.cfgPinSound.checked = config.pinSound;
        if (el.fieldPinDuration) el.fieldPinDuration.classList.toggle('is-off', config.pinPermanent);
    }

    function read(config) {
        if (el.cfgPinDurationNum) {
            config.pinDuration = clampInt(el.cfgPinDurationNum.value, 1, 600, 15);
        } else if (el.cfgPinDuration) {
            config.pinDuration = clampInt(el.cfgPinDuration.value, 1, 600, 15);
        }
        if (el.cfgPinPermanent) config.pinPermanent = el.cfgPinPermanent.checked;
        if (el.cfgPinStyle) config.pinStyle = validStyle(el.cfgPinStyle.value);
        if (el.cfgPinPosition && deps.stepValue) config.pinPosition = deps.stepValue(el.cfgPinPosition);
        if (el.cfgPinAnim) config.pinAnim = validId(PIN_ANIMS, el.cfgPinAnim.value, 'slide');
        if (el.cfgPinSize) config.pinSize = clampInt(el.cfgPinSize.value, 12, 36, 18);
        if (el.cfgPinAuthor) config.pinAuthor = el.cfgPinAuthor.checked;
        if (el.cfgPinProgress) config.pinProgress = el.cfgPinProgress.checked;
        if (el.cfgPinSound) config.pinSound = el.cfgPinSound.checked;
        if (el.fieldPinDuration) el.fieldPinDuration.classList.toggle('is-off', config.pinPermanent);
    }

    function applyStyles(config, fontFamily) {
        if (!el.pinnedOverlay || !el.pinnedCard) return;

        if (fontFamily) el.pinnedOverlay.style.setProperty('--pin-font', fontFamily);
        el.pinnedOverlay.style.setProperty('--pin-size', `${config.pinSize}px`);
        el.pinnedOverlay.style.setProperty('--pin-duration', `${config.pinDuration}s`);

        el.pinnedOverlay.classList.remove('pos-top', 'pos-center', 'pos-bottom');
        el.pinnedOverlay.classList.add(`pos-${config.pinPosition}`);

        PIN_STYLES.forEach(s => el.pinnedCard.classList.remove(`pin-style-${s.id}`));
        el.pinnedCard.classList.add(`pin-style-${config.pinStyle}`);

        PIN_ANIMS.forEach(a => el.pinnedCard.classList.remove(`pin-anim-${a.id}`));
        el.pinnedCard.classList.add(`pin-anim-${config.pinAnim}`);

        if (el.pinnedCardAuthorWrap) {
            el.pinnedCardAuthorWrap.classList.toggle('hidden', !config.pinAuthor);
        }
        if (el.pinnedCardProgress) {
            el.pinnedCardProgress.classList.toggle('hidden', !config.pinProgress || config.pinPermanent);
        }

        updateCountdownBadge(config);
    }

    function updateCountdownBadge(config) {
        if (!el.pinPreviewCountdown) return;
        if (!currentMsg || el.pinnedCard.classList.contains('hidden')) {
            el.pinPreviewCountdown.textContent = 'Oculto (sin mensaje fijado)';
            return;
        }
        if (config.pinPermanent) {
            el.pinPreviewCountdown.textContent = 'Fijo hasta que se desfije';
            return;
        }
        const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        el.pinPreviewCountdown.textContent = `Desaparece en ${left} s`;
    }

    function clearTimers() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        if (leaveTimer) {
            clearTimeout(leaveTimer);
            leaveTimer = null;
        }
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    function restartProgressAnimation(config) {
        if (!el.pinnedCardProgressFill) return;
        el.pinnedCardProgressFill.classList.remove('is-running');
        if (config.pinPermanent || !config.pinProgress) return;
        void el.pinnedCardProgressFill.offsetWidth;
        el.pinnedCardProgressFill.classList.add('is-running');
    }

    function startTimer(config) {
        clearTimers();
        if (config.pinPermanent) {
            expiresAt = 0;
            updateCountdownBadge(config);
            return;
        }
        const ms = config.pinDuration * 1000;
        expiresAt = Date.now() + ms;
        hideTimer = setTimeout(() => hide(false, config), ms);
        updateCountdownBadge(config);
        if (deps && deps.isMenuMode && deps.isMenuMode()) {
            countdownInterval = setInterval(() => updateCountdownBadge(config), 250);
        }
    }

    function rescheduleTimer(config) {
        if (!currentMsg || !el.pinnedCard || el.pinnedCard.classList.contains('hidden') || el.pinnedCard.classList.contains('is-leaving')) {
            updateCountdownBadge(config);
            return;
        }
        el.pinnedOverlay.style.setProperty('--pin-duration', `${config.pinDuration}s`);
        restartProgressAnimation(config);
        startTimer(config);
    }

    function renderAuthor(msg, config, token) {
        if (!el.pinnedCardAuthorWrap || !deps) return;
        el.pinnedCardAuthorWrap.textContent = '';

        const badgesEl = deps.renderBadgesElement(msg.sender?.badges);
        if (badgesEl) el.pinnedCardAuthorWrap.appendChild(badgesEl);

        const authorSpan = document.createElement('span');
        authorSpan.className = 'chat-author';
        authorSpan.style.color = msg.sender?.color || '#53fc18';
        authorSpan.textContent = msg.sender?.username || 'Anónimo';
        el.pinnedCardAuthorWrap.appendChild(authorSpan);

        const colon = document.createElement('span');
        colon.className = 'colon';
        colon.textContent = ':';
        el.pinnedCardAuthorWrap.appendChild(colon);

        if (config.sevenTVCosmetics) {
            const style = msg.sevenTv || msg._sevenTvStyle;
            const client = deps.getClient ? deps.getClient() : null;
            if (style) {
                if (badgesEl && style.badge && config.badges && !badgesEl.querySelector('.badge-7tv')) {
                    badgesEl.appendChild(deps.createBadgeImg(style.badge));
                }
                deps.applySevenTVNameStyle(authorSpan, style);
            } else if (msg._sevenTvStyle === undefined && client && msg.sender?.id) {
                msg._sevenTvStyle = null;
                client.get7TVStyle(msg.sender.id).then(resolved => {
                    msg._sevenTvStyle = resolved || null;
                    if (!resolved || !config.sevenTVCosmetics || currentPinToken !== token) return;
                    if (badgesEl && resolved.badge && config.badges && !badgesEl.querySelector('.badge-7tv')) {
                        badgesEl.appendChild(deps.createBadgeImg(resolved.badge));
                    }
                    deps.applySevenTVNameStyle(authorSpan, resolved);
                });
            }
        }
    }

    function show(msg, config, { silent = false } = {}) {
        if (!el.pinnedOverlay || !el.pinnedCard || !msg) return;
        clearTimers();
        currentMsg = msg;
        currentPinToken++;
        const token = currentPinToken;

        applyStyles(config);
        renderAuthor(msg, config, token);
        if (el.pinnedCardText && deps) {
            el.pinnedCardText.innerHTML = deps.messageHtml(msg);
        }

        // Re-trigger entry animation cleanly
        el.pinnedCard.classList.remove('hidden', 'is-leaving');
        PIN_ANIMS.forEach(a => el.pinnedCard.classList.remove(`pin-anim-${a.id}`));
        void el.pinnedCard.offsetWidth;
        el.pinnedCard.classList.add(`pin-anim-${config.pinAnim}`);

        restartProgressAnimation(config);
        startTimer(config);

        if (!silent && config.pinSound && window.HolySound) {
            window.HolySound.play(config.soundType || 'default', config.soundVolume || 50);
        }
    }

    function hide(immediate = false, configOverride = null) {
        if (!el.pinnedCard || el.pinnedCard.classList.contains('hidden')) return;
        clearTimers();
        const cfg = configOverride || (deps && deps.getConfig ? deps.getConfig() : { pinAnim: 'slide' });

        const finishHide = () => {
            el.pinnedCard.classList.add('hidden');
            el.pinnedCard.classList.remove('is-leaving');
            currentMsg = null;
            updateCountdownBadge(cfg);
        };

        if (immediate || cfg.pinAnim === 'none') {
            finishHide();
            return;
        }
        el.pinnedCard.classList.add('is-leaving');
        leaveTimer = setTimeout(finishHide, 280);
    }

    function onUnpinned(messageId, config) {
        if (!currentMsg) return;
        if (messageId && currentMsg.id && String(currentMsg.id) !== String(messageId)) return;
        hide(false, config);
    }

    function rerender(config) {
        if (!currentMsg || !el.pinnedCard || el.pinnedCard.classList.contains('hidden')) return;
        currentMsg._parsed = null;
        if (deps && deps.resolveTemplate) deps.resolveTemplate(currentMsg);
        renderAuthor(currentMsg, config, currentPinToken);
        if (el.pinnedCardText && deps) {
            el.pinnedCardText.innerHTML = deps.messageHtml(currentMsg);
        }
    }

    function handleSevenTVStyleUpdated(kickUserId, newStyle, config) {
        if (!currentMsg || !currentMsg.sender || String(currentMsg.sender.id) !== String(kickUserId)) return;
        currentMsg._sevenTvStyle = newStyle || null;
        currentMsg.sevenTv = newStyle || null;
        if (!el.pinnedCard.classList.contains('hidden')) {
            renderAuthor(currentMsg, config, currentPinToken);
        }
    }

    function showSample(config, customText = '') {
        if (!deps) return;
        const text = (customText || '').trim() ||
            `¡Bienvenidos al stream! Sigan el canal {emote} 🇨🇱 🇦🇷`;
        const msg = deps.buildSampleMessage ? deps.buildSampleMessage(text) : {
            id: `pin-test-${Date.now()}`,
            content: text,
            _template: text,
            createdAt: new Date().toISOString(),
            sender: { id: 0, username: config.channel || 'Streamer', color: '#53fc18', badges: [{ type: 'broadcaster', text: 'Broadcaster', imageUrl: 'badges/broadcaster.svg' }] },
            _sevenTvStyle: null
        };
        show(msg, config, { silent: false });
    }

    window.HolyPinned = {
        PIN_STYLES,
        PIN_POSITIONS,
        PIN_ANIMS,
        STEPS,
        parse,
        toCache,
        buildUrl,
        setup,
        populate,
        read,
        applyStyles,
        rescheduleTimer,
        show,
        hide,
        onUnpinned,
        rerender,
        handleSevenTVStyleUpdated,
        showSample
    };
})();
