/**
 * Holy Chat - Kick Chat Overlay Controller
 * - Settings page: sliders on the left, the live overlay as a test chat on the right
 * - Chatterino 2 Style Chat Overlay (OBS mode, ?overlay=true)
 * - 7TV Cosmetics & Emotes integration
 */

(function () {
    'use strict';

    // Preload local SVG badges so there is zero latency/flicker on first render
    function preloadBadges() {
        const badgeUrls = [
            'badges/mod.svg',
            'badges/verified.svg',
            'badges/broadcaster.svg',
            'badges/vip.svg',
            'badges/og.svg',
            'badges/subscriber.svg',
            'badges/founder.svg',
            'badges/admin.svg'
        ];
        badgeUrls.forEach(url => {
            const img = new Image();
            img.src = url;
        });
    }

    if (typeof window !== 'undefined' && window.KickCache) {
        // Pruning parses every stored entry (emote packs included), so it waits until the page is
        // idle instead of delaying the first messages; get() already ignores expired entries
        const prune = () => window.KickCache.prune();
        if (typeof requestIdleCallback === 'function') requestIdleCallback(prune, { timeout: 10000 });
        else setTimeout(prune, 3000);
        window.KickCache.startAutoPrune();
    }
    preloadBadges();

    function debounce(fn, ms) {
        let timer = null;
        const debounced = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn(...args);
            }, ms);
        };
        debounced.flush = () => {
            if (timer === null) return;
            clearTimeout(timer);
            timer = null;
            fn();
        };
        return debounced;
    }

    // -------------------------------------------------------------------------
    // Configuration & URL Parsing (Matin Aniss exact options + Chatterino styles)
    // -------------------------------------------------------------------------
    const cachedConfig = (typeof window !== 'undefined' && window.KickCache) ? window.KickCache.get('overlay_settings') : null;
    const params = new URLSearchParams(window.location.search);

    // Opening the page always opens the menu first, UNLESS explicitly in OBS overlay mode (?overlay=true)
    let isOverlayActive = params.get('overlay') === 'true' && params.get('menu') !== 'true';

    // Map textSize string to px
    function textSizeToPx(sizeStr) {
        switch ((sizeStr || '').toLowerCase()) {
            case 'small': return 12;
            case 'large': return 18;
            case 'medium':
            default: return 14;
        }
    }

    // Chat fonts (Google Fonts). `weights` lists only the weights each family has:
    // Google Fonts rejects the whole request if one of them is missing.
    const FONTS = {
        inter: { name: 'Inter', weights: '400;500;600;700;800' },
        roboto: { name: 'Roboto', weights: '400;500;600;700;800' },
        'open-sans': { name: 'Open Sans', weights: '400;500;600;700;800' },
        montserrat: { name: 'Montserrat', weights: '400;500;600;700;800' },
        poppins: { name: 'Poppins', weights: '400;500;600;700;800' },
        nunito: { name: 'Nunito', weights: '400;500;600;700;800' },
        rubik: { name: 'Rubik', weights: '400;500;600;700;800' },
        lato: { name: 'Lato', weights: '400;700;900' },
        ubuntu: { name: 'Ubuntu', weights: '400;500;700' },
        fredoka: { name: 'Fredoka', weights: '400;500;600;700' },
        'comic-neue': { name: 'Comic Neue', weights: '400;700' },
        'jetbrains-mono': { name: 'JetBrains Mono', weights: '400;500;600;700;800' },
        system: { name: 'Sistema' },
        // The style's own font (Hacker, Pixel Quest, Retro), Inter for the rest
        auto: { name: 'Automática (la del estilo)' },
        // The rest of Botrix's catalog (features/catalog.js)
        ...window.HolyCatalog.EXTRA_FONTS
    };
    const FONT_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
    const FONT_WEIGHTS = [400, 500, 600, 700, 800];

    function fontKey(key) {
        key = (key || '').toLowerCase();
        return FONTS[key] ? key : 'inter';
    }

    function fontWeight(w) {
        w = parseInt(w, 10);
        return FONT_WEIGHTS.includes(w) ? w : 700;
    }

    // Kick chat bots hidden by "Ocultar bots" unless the streamer edits the list
    const DEFAULT_BOTS = 'botrix, kicklet, kickbot, streamelements, nightbot, sery_bot';

    // "a,  B ,,c" -> "a, b, c"
    function botList(text) {
        return (text || '').split(',').map(n => n.trim().toLowerCase()).filter(Boolean).join(', ');
    }

    // How a deleted message stays in the chat: removed, struck through, or replaced by a notice
    const DELETED_MODES = ['hide', 'strike', 'notice'];

    function deletedMode(mode) {
        mode = (mode || '').toLowerCase();
        return DELETED_MODES.includes(mode) ? mode : 'notice';
    }

    // How the messages sit on screen: the usual column, one line along the bottom,
    // or scattered at random spots
    const LAYOUTS = ['vertical', 'horizontal', 'scatter'];

    function layoutMode(mode) {
        mode = (mode || '').toLowerCase();
        return LAYOUTS.includes(mode) ? mode : 'vertical';
    }

    // "Aleatorio": messages on screen at once, and seconds each one stays when there is no fade time
    const SCATTER_MAX = 8;
    const SCATTER_LIFETIME = 10;

    // "Horizontal": a ticker. Its speed follows the chat's pace: it scrolls the width of the
    // messages that arrived in the last few seconds, with a floor (a quiet chat still moves).
    // The ceiling is about the pace of the test chat at x100. Speeds in px per second.
    const TICKER_MIN_SPEED = 60;
    const TICKER_MAX_SPEED = 26000;
    const TICKER_RATE_WINDOW = 8000;
    const TICKER_GAP = 32;
    // Messages waiting off the right edge. In a busy chat the newest one replaces the last
    // one in line, so the front of the line keeps entering the screen.
    const TICKER_QUEUE_MAX = 6;

    // Seconds a message stays before fading out; 0 keeps it forever (∞)
    const FADE_TIMES = [1, 3, 5, 10, 15, 20, 30, 60, 120, 300, 0];

    // Older links can carry any number of seconds: use the closest step
    function fadeStep(seconds) {
        if (!(seconds > 0)) return 0;
        return FADE_TIMES.filter(t => t > 0).reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a));
    }

    // Text shadow thickness, 0 (none) to 6 (a thick outline). Older links use names.
    const SHADOW_NAMES = { none: 0, small: 1, medium: 3, large: 5 };

    function shadowLevel(value) {
        if (value in SHADOW_NAMES) return SHADOW_NAMES[value];
        const n = parseInt(value, 10);
        return n >= 0 && n <= 6 ? n : 1;
    }

    function msgShadowLevel(value) {
        const n = parseInt(value, 10);
        return n >= 0 && n <= 5 ? n : 0;
    }

    // Text size in px: 10–60 (older links went from 12 to 24)
    function clampFontSize(px) {
        return Math.min(60, Math.max(10, px));
    }

    const config = {
        // Matin Aniss 10 Options:
        channel: (params.get('channel') || params.get('kick') || (cachedConfig && cachedConfig.channel) || 'rageylo').toLowerCase().trim(),
        sevenTVCosmetics: params.get('sevenTVCosmeticsEnabled') !== null ? (params.get('sevenTVCosmeticsEnabled') === 'true') : (cachedConfig ? cachedConfig.sevenTVCosmetics !== false : true),
        sevenTVEmotes: params.get('sevenTVEmotesEnabled') !== null ? (params.get('sevenTVEmotesEnabled') === 'true') : (cachedConfig ? cachedConfig.sevenTVEmotes !== false : true),
        theme: (params.get('theme') || (cachedConfig && cachedConfig.theme) || 'transparent').toLowerCase(),
        shadow: shadowLevel(params.get('shadow') !== null ? params.get('shadow')
            : params.get('textShadow') !== null ? params.get('textShadow').toLowerCase()
                : cachedConfig && cachedConfig.shadow !== undefined ? cachedConfig.shadow
                    : (cachedConfig && cachedConfig.textShadow) || 0),
        msgShadow: msgShadowLevel(params.get('msgShadow') !== null ? params.get('msgShadow')
            : params.get('dropShadow') !== null ? params.get('dropShadow')
                : cachedConfig && cachedConfig.msgShadow !== undefined ? cachedConfig.msgShadow
                    : 1),
        textSize: (params.get('textSize') || (cachedConfig && cachedConfig.textSize) || 'large').toLowerCase(),
        animation: window.HolyCatalog.animationId((params.get('animation') || (cachedConfig && cachedConfig.animation) || 'none').toLowerCase()),
        showPin: params.get('showPinEnabled') !== null ? (params.get('showPinEnabled') === 'true') : (cachedConfig ? cachedConfig.showPin === true : false),
        textBg: params.get('textBackgroundEnabled') !== null ? (params.get('textBackgroundEnabled') === 'true') : (cachedConfig ? cachedConfig.textBg === true : false),
        textBgWidth: (params.get('textBackgroundWidth') || (cachedConfig && cachedConfig.textBgWidth) || 'min').toLowerCase(),
        mentionHighlight: params.get('mentionHighlightEnabled') !== null ? (params.get('mentionHighlightEnabled') === 'true') : (cachedConfig ? cachedConfig.mentionHighlight === true : false),
        hideBots: params.get('hideBots') !== null ? (params.get('hideBots') === 'true') : (cachedConfig ? cachedConfig.hideBots === true : false),
        bots: botList(params.get('bots') !== null ? params.get('bots') : (cachedConfig && typeof cachedConfig.bots === 'string' ? cachedConfig.bots : DEFAULT_BOTS)),
        hideCommands: params.get('hideCommands') !== null ? (params.get('hideCommands') === 'true') : (cachedConfig ? cachedConfig.hideCommands === true : false),
        deletedMessages: deletedMode(params.get('deletedMessages') || (cachedConfig && cachedConfig.deletedMessages) || 'hide'),
        layout: layoutMode(params.get('layout') || (cachedConfig && cachedConfig.layout)),

        // Additional Chatterino Layout Options:
        fontSize: clampFontSize(parseInt(params.get('size'), 10) || (cachedConfig && cachedConfig.fontSize) || 40),
        emoteSize: clampEmoteSize(parseInt(params.get('emoteSize'), 10) || (cachedConfig && cachedConfig.emoteSize) || 60),
        badgeSize: clampBadgeSize(parseInt(params.get('badgeSize'), 10) || (cachedConfig && cachedConfig.badgeSize) || 40),
        font: fontKey(params.get('font') || (cachedConfig && cachedConfig.font)),
        fontWeight: fontWeight(params.get('fontWeight') || (cachedConfig && cachedConfig.fontWeight)),
        altRows: params.get('alt') !== null ? params.get('alt') !== 'false' : (cachedConfig ? cachedConfig.altRows !== false : true),
        badges: params.get('badges') !== null ? params.get('badges') !== 'false' : (cachedConfig ? cachedConfig.badges !== false : true),
        fadeTime: fadeStep(params.get('fade') !== null ? parseInt(params.get('fade'), 10) : (cachedConfig && cachedConfig.fadeTime !== undefined ? cachedConfig.fadeTime : 20)),
        limit: parseInt(params.get('limit'), 10) || (cachedConfig && cachedConfig.limit) || 80,

        // Botrix-style options (features/options.js): estilo, dirección, color de fondo,
        // usuarios ignorados, sonido, donaciones, recompensas, icono de Kick y hora
        ...window.HolyOptions.parse(params, cachedConfig)
    };

    // Emote height in px (the settings slider's range)
    function clampEmoteSize(px) {
        return Math.min(64, Math.max(16, px));
    }

    // Badge size in px (the settings slider's range)
    function clampBadgeSize(px) {
        return Math.min(40, Math.max(12, px));
    }

    // Name of the closest preset, kept in the URL for older overlay links
    function sizeName(px) {
        return px <= 12 ? 'small' : px >= 18 ? 'large' : 'medium';
    }

    // -------------------------------------------------------------------------
    // DOM Elements
    // -------------------------------------------------------------------------
    const root = document.documentElement;
    const initialMenu = document.getElementById('initialMenu');
    const menuCloseBtn = document.getElementById('menuCloseBtn');
    const overlayContainer = document.getElementById('overlayContainer');

    // Settings inputs
    const cfgChannel = document.getElementById('cfgChannel');
    const cfg7tvCosmetics = document.getElementById('cfg7tvCosmetics');
    const cfg7tvEmotes = document.getElementById('cfg7tvEmotes');
    const cfgTheme = document.getElementById('cfgTheme');
    const cfgLayout = document.getElementById('cfgLayout');
    const cfgTextShadow = document.getElementById('cfgTextShadow');
    const cfgMsgShadow = document.getElementById('cfgMsgShadow');
    const cfgTextSize = document.getElementById('cfgTextSize');
    const cfgEmoteSize = document.getElementById('cfgEmoteSize');
    const cfgBadgeSize = document.getElementById('cfgBadgeSize');
    const cfgFont = document.getElementById('cfgFont');
    const cfgFontWeight = document.getElementById('cfgFontWeight');
    const cfgAnimation = document.getElementById('cfgAnimation');
    const cfgPinnedBanner = document.getElementById('cfgPinnedBanner');
    const cfgTextBg = document.getElementById('cfgTextBg');
    const cfgTextBgWidth = document.getElementById('cfgTextBgWidth');
    const cfgMentionHighlight = document.getElementById('cfgMentionHighlight');
    const fieldTextBgWidth = document.getElementById('fieldTextBgWidth');
    const cfgHideBots = document.getElementById('cfgHideBots');
    const cfgBots = document.getElementById('cfgBots');
    const fieldBots = document.getElementById('fieldBots');
    const cfgHideCommands = document.getElementById('cfgHideCommands');
    const cfgDeletedMessages = document.getElementById('cfgDeletedMessages');
    const cfgTestSpeed = document.getElementById('cfgTestSpeed');
    const cfgFadeTime = document.getElementById('cfgFadeTime');
    const btnCopyOverlayUrl = document.getElementById('btnCopyOverlayUrl');
    const btnCopyLabel = document.getElementById('btnCopyLabel');
    const btnRefreshCache = document.getElementById('btnRefreshCache');
    const btnRefreshLabel = document.getElementById('btnRefreshLabel');
    const urlFallback = document.getElementById('urlFallback');
    const copyError = document.getElementById('copyError');
    const obsHelp = document.getElementById('obsHelp');

    // Test chat panel
    const testComposer = document.getElementById('testComposer');
    const cfgPreviewInput = document.getElementById('cfgPreviewInput');

    // Overlay feed elements
    const chatArea = document.getElementById('chatArea');
    const chatMessagesEl = document.getElementById('chatMessages');
    const pinnedBanner = document.getElementById('pinnedBanner');
    const pinnedBannerText = document.getElementById('pinnedBannerText');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    let client = null;
    let messageCounter = 0;
    let hideStatusTimer = null;

    function isMenuMode() {
        return root.classList.contains('mode-menu');
    }

    function setMode(mode) {
        root.classList.toggle('mode-menu', mode === 'menu');
        root.classList.toggle('mode-overlay', mode === 'overlay');
    }

    // -------------------------------------------------------------------------
    // Settings page (sliders, URL, test chat)
    // -------------------------------------------------------------------------

    // Stepped sliders: index on the slider <-> value in the config / URL
    const STEPS = {
        theme: { values: ['dark', 'transparent', 'light'], labels: ['Oscuro', 'Transparente', 'Claro'] },
        layout: { values: LAYOUTS, labels: ['Vertical', 'Horizontal', 'Aleatorio'] },
        shadow: { values: [0, 1, 2, 3, 4, 5, 6], labels: ['Nada', '1', '2', '3', '4', '5', '6'] },
        msgShadow: { values: [0, 1, 2, 3, 4, 5], labels: ['Nada', '1', '2', '3', '4', '5'] },
        textBgWidth: { values: ['min', 'max'], labels: ['Mínimo', 'Máximo'] },
        deletedMessages: { values: DELETED_MODES, labels: ['Ocultar', 'Tachar', 'Aviso'] },
        fadeTime: { values: FADE_TIMES, labels: ['1 s', '3 s', '5 s', '10 s', '15 s', '20 s', '30 s', '1 min', '2 min', '5 min', '∞'] },
        // x100 is roughly 40 messages a second, a huge stream's chat
        testSpeed: { values: [0, 0.5, 1, 2, 5, 10, 25, 50, 100], labels: ['Pausa', 'x0.5', 'x1', 'x2', 'x5', 'x10', 'x25', 'x50', 'x100'] },
        fontWeight: { values: FONT_WEIGHTS, labels: ['Normal', 'Media', 'Semi', 'Negrita', 'Extra'] }
    };
    Object.assign(STEPS, window.HolyOptions.STEPS);
    const SIZE_TICKS = [10, 14, 20, 30, 45, 60];
    const sliders = [cfgLayout, cfgTheme, cfgFontWeight, cfgTextSize, cfgEmoteSize, cfgBadgeSize, cfgTextShadow, cfgMsgShadow, cfgTextBgWidth, cfgDeletedMessages, cfgTestSpeed, cfgFadeTime,
        document.getElementById('cfgDirection'), document.getElementById('cfgBgAlpha'), document.getElementById('cfgSoundVolume')].filter(Boolean);

    if (cfgAnimation) {
        window.HolyCatalog.ANIMATIONS.forEach(a => cfgAnimation.add(new Option(a.name, a.id)));
    }

    if (cfgFont) {
        Object.entries(FONTS).forEach(([key, f]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = f.name;
            cfgFont.appendChild(opt);
        });
    }

    function stepValue(slider) {
        return STEPS[slider.dataset.steps].values[Number(slider.value)];
    }

    function setStep(slider, value) {
        const i = STEPS[slider.dataset.steps].values.indexOf(value);
        slider.value = i >= 0 ? i : 0;
    }

    function syncSlider(slider) {
        const min = Number(slider.min);
        const max = Number(slider.max);
        const v = Number(slider.value);
        slider.style.setProperty('--f', max === min ? 0 : (v - min) / (max - min));

        const field = slider.closest('.hc-field');
        const out = field && field.querySelector('output');
        const key = slider.dataset.steps;
        // data-unit gives a slider another unit than px ("%" for the volume and the background)
        const label = key ? STEPS[key].labels[v] : `${v}${slider.dataset.unit !== undefined ? slider.dataset.unit : ' px'}`;
        if (out) out.textContent = label;
        slider.setAttribute('aria-valuetext', label);

        const ticks = document.querySelector(`.hc-ticks[data-for="${slider.id}"]`);
        if (ticks) {
            ticks.querySelectorAll('button').forEach(b => {
                b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v));
            });
        }

        updateSectionSummary(slider);
    }

    // Value an element marked with data-summary adds to its category's title
    function summaryValue(el) {
        const dependsOn = el.dataset.summaryIf && document.getElementById(el.dataset.summaryIf);
        if (dependsOn && !dependsOn.checked) return '';
        if (el.type === 'checkbox') return el.checked ? el.dataset.summary : '';
        if (el.tagName === 'SELECT') return el.selectedOptions[0] ? el.selectedOptions[0].textContent : '';
        if (el.tagName === 'INPUT') return el.value.trim();
        return el.textContent;
    }

    // Every collapsed category shows its values in its title. Each title only lists the
    // [data-summary] elements of its own category, not those of a section nested inside it.
    function updateSectionSummary() {
        if (!initialMenu) return;
        initialMenu.querySelectorAll('details.hc-disclosure').forEach(section => {
            const summary = section.querySelector(':scope > summary .hc-val');
            if (!summary) return;
            const parts = Array.from(section.querySelectorAll('[data-summary]'))
                .filter(el => el.closest('details') === section)
                .map(summaryValue)
                .filter(Boolean);
            summary.textContent = parts.join(' · ') || section.dataset.summaryEmpty || '';
        });
    }

    function buildTicks(slider) {
        const ticks = document.querySelector(`.hc-ticks[data-for="${slider.id}"]`);
        if (!ticks) return;
        const key = slider.dataset.steps;
        // data-ticks picks which steps get a tick (step indexes), when there are too many labels to fit
        const picked = key && slider.dataset.ticks ? slider.dataset.ticks.split(',').map(Number) : null;
        const items = key
            ? STEPS[key].labels.map((label, i) => ({ label, v: i })).filter(t => !picked || picked.includes(t.v))
            : (slider.dataset.ticks ? slider.dataset.ticks.split(',').map(Number) : SIZE_TICKS).map(v => ({ label: String(v), v }));
        items.forEach(({ label, v }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.dataset.v = v;
            b.tabIndex = -1;
            b.addEventListener('click', () => {
                slider.value = v;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
            ticks.appendChild(b);
        });
    }

    sliders.forEach(buildTicks);

    // Presets: looks for the chat, layout and message lifetime included (never the channel, 7TV,
    // mentions, Filtros or the pinned banner)
    const PRESETS = [
        {
            id: 'rageylo', name: 'Rageylo', desc: 'El diseño por defecto, los mensajes duran 20 segundos',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'transparent', font: 'inter', fontWeight: 700, fontSize: 40, emoteSize: 60, badgeSize: 40, shadow: 0, msgShadow: 2, animation: 'none', textBg: false, textBgWidth: 'min', fadeTime: 20, deletedMessages: 'hide' }
        },
        {
            id: 'game', name: 'Juego', desc: 'Sobre el juego: transparente, sombra moderada, cada mensaje dura 1 minuto',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'transparent', font: 'inter', fontWeight: 800, fontSize: 16, emoteSize: 32, badgeSize: 20, shadow: 2, msgShadow: 1, animation: 'slide', textBg: false, textBgWidth: 'min', fadeTime: 60 }
        },
        {
            id: 'ticker', name: 'Cinta', desc: 'Cinta horizontal para la parte de abajo de la pantalla',
            settings: { design: 'chatterino', layout: 'horizontal', theme: 'transparent', font: 'rubik', fontWeight: 700, fontSize: 18, emoteSize: 36, badgeSize: 22, shadow: 2, msgShadow: 0, animation: 'fade', textBg: true, textBgWidth: 'min', fadeTime: 0 }
        },
        {
            id: 'floating', name: 'Flotante', desc: 'Mensajes en lugares al azar que aparecen y se van a los 10 segundos',
            settings: { design: 'chatterino', layout: 'scatter', theme: 'transparent', font: 'fredoka', fontWeight: 600, fontSize: 18, emoteSize: 40, badgeSize: 22, shadow: 0, msgShadow: 0, animation: 'fade', textBg: false, textBgWidth: 'min', fadeTime: 10 }
        },
        {
            id: 'boxes', name: 'Cajitas', desc: 'Cada mensaje en su caja, se desvanecen a los 30 segundos',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'transparent', font: 'poppins', fontWeight: 600, fontSize: 16, emoteSize: 32, badgeSize: 20, shadow: 0, msgShadow: 0, animation: 'fade', textBg: true, textBgWidth: 'min', fadeTime: 30 }
        },
        {
            id: 'big', name: 'Grande', desc: 'Letra y emotes grandes con fondo, se lee de lejos; duran 2 minutos',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'transparent', font: 'nunito', fontWeight: 800, fontSize: 20, emoteSize: 40, badgeSize: 24, shadow: 2, msgShadow: 0, animation: 'slide', textBg: true, textBgWidth: 'max', fadeTime: 120 }
        },
        {
            id: 'light', name: 'Claro', desc: 'Fondo blanco y alto contraste',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'light', font: 'open-sans', fontWeight: 600, fontSize: 14, emoteSize: 28, badgeSize: 18, shadow: 0, msgShadow: 0, animation: 'fade', textBg: false, textBgWidth: 'min', fadeTime: 0 }
        },
        {
            id: 'terminal', name: 'Terminal', desc: 'Monoespaciada y compacta, sin animaciones',
            settings: { design: 'chatterino', layout: 'vertical', theme: 'dark', font: 'jetbrains-mono', fontWeight: 500, fontSize: 13, emoteSize: 24, badgeSize: 16, shadow: 0, msgShadow: 0, animation: 'none', textBg: false, textBgWidth: 'min', fadeTime: 0 }
        },
        {
            id: 'bubbles', name: 'Burbujas', desc: 'Burbujas con el nombre en una etiqueta, duran 1 minuto',
            settings: { design: 'bubbles', layout: 'vertical', theme: 'transparent', font: 'poppins', fontWeight: 600, fontSize: 16, emoteSize: 30, badgeSize: 18, shadow: 0, msgShadow: 0, animation: 'fade', textBg: false, textBgWidth: 'min', fadeTime: 60 }
        },
        {
            id: 'neon', name: 'Neón', desc: 'Tarjetas negras con borde y texto del color de cada usuario',
            settings: { design: 'neon', layout: 'vertical', theme: 'transparent', font: 'rubik', fontWeight: 700, fontSize: 16, emoteSize: 30, badgeSize: 18, shadow: 0, msgShadow: 0, animation: 'fade', textBg: false, textBgWidth: 'min', fadeTime: 0 }
        },
        {
            id: 'hacker', name: 'Hacker', desc: 'Terminal verde con líneas de escaneo',
            settings: { design: 'hacker', layout: 'vertical', theme: 'transparent', font: 'inconsolata', fontWeight: 600, fontSize: 16, emoteSize: 28, badgeSize: 18, shadow: 0, msgShadow: 0, animation: 'fade', textBg: false, textBgWidth: 'min', fadeTime: 0 }
        }
    ];
    const presetGrid = document.getElementById('presetGrid');
    const presetCurrent = document.getElementById('presetCurrent');
    // The list shows this many presets; a last button opens the rest
    const PRESETS_VISIBLE = 4;
    let presetMoreBtn = null;

    function buildPresetGrid() {
        if (!presetGrid) return;
        PRESETS.forEach((p, i) => {
            const s = p.settings;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = i < PRESETS_VISIBLE ? 'hc-preset' : 'hc-preset hc-preset-extra';
            b.dataset.preset = p.id;
            b.title = p.desc;
            b.setAttribute('aria-pressed', 'false');

            // "Aa" in the preset's font and weight, on its theme's background
            const sample = document.createElement('span');
            sample.className = `hc-preset-sample is-${s.theme}`;
            sample.textContent = 'Aa';
            sample.style.fontFamily = s.font === 'system' ? FONT_FALLBACK : `"${FONTS[s.font].name}", ${FONT_FALLBACK}`;
            sample.style.fontWeight = String(s.fontWeight);
            sample.setAttribute('aria-hidden', 'true');

            const name = document.createElement('strong');
            name.textContent = p.name;

            b.append(sample, name);
            b.addEventListener('click', () => applyPreset(p));
            presetGrid.appendChild(b);
        });

        const extra = PRESETS.length - PRESETS_VISIBLE;
        if (extra <= 0) return;
        presetMoreBtn = document.createElement('button');
        presetMoreBtn.type = 'button';
        presetMoreBtn.className = 'hc-preset hc-preset-more';
        presetMoreBtn.setAttribute('aria-controls', 'presetGrid');
        const icon = document.createElement('span');
        icon.className = 'hc-preset-sample';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('strong');
        presetMoreBtn.append(icon, label);
        presetMoreBtn.addEventListener('click', () => {
            setPresetsExpanded(!presetGrid.classList.contains('is-expanded'));
        });
        presetGrid.appendChild(presetMoreBtn);
        setPresetsExpanded(false);
    }

    function setPresetsExpanded(expanded) {
        if (!presetMoreBtn) return;
        const extra = PRESETS.length - PRESETS_VISIBLE;
        presetGrid.classList.toggle('is-expanded', expanded);
        presetMoreBtn.setAttribute('aria-expanded', String(expanded));
        presetMoreBtn.querySelector('.hc-preset-sample').textContent = expanded ? '−' : `+${extra}`;
        presetMoreBtn.querySelector('strong').textContent = expanded ? 'Menos' : 'Más';
        presetMoreBtn.title = expanded ? 'Ocultar presets' : PRESETS.slice(PRESETS_VISIBLE).map(p => p.name).join(', ');
    }

    // The samples show each preset's font, so the settings page loads them all
    function loadPresetFonts() {
        PRESETS.forEach(p => loadFont(p.settings.font));
    }

    function applyPreset(p) {
        const s = p.settings;
        setStep(cfgLayout, s.layout);
        setStep(cfgTheme, s.theme);
        cfgFont.value = s.font;
        setStep(cfgFontWeight, s.fontWeight);
        cfgTextSize.value = s.fontSize;
        cfgEmoteSize.value = s.emoteSize;
        cfgBadgeSize.value = s.badgeSize;
        setStep(cfgTextShadow, s.shadow);
        if (s.msgShadow !== undefined && cfgMsgShadow) setStep(cfgMsgShadow, s.msgShadow);
        cfgAnimation.value = s.animation;
        const cfgDesign = document.getElementById('cfgDesign');
        if (cfgDesign) cfgDesign.value = s.design;
        cfgTextBg.checked = s.textBg;
        setStep(cfgTextBgWidth, s.textBgWidth);
        setStep(cfgFadeTime, s.fadeTime);
        if (s.deletedMessages !== undefined && cfgDeletedMessages) setStep(cfgDeletedMessages, s.deletedMessages);
        sliders.forEach(syncSlider);
        onMenuChange();
    }

    // Marks the preset that matches the current settings; changing any of them by hand leaves "Personalizado"
    function updatePresetState() {
        const match = PRESETS.find(p => Object.entries(p.settings).every(([k, v]) => config[k] === v));
        if (presetGrid) {
            presetGrid.querySelectorAll('.hc-preset[data-preset]').forEach(b => {
                b.setAttribute('aria-pressed', String(Boolean(match) && b.dataset.preset === match.id));
            });
        }
        // The active preset never stays hidden behind "presets más"
        if (match && PRESETS.indexOf(match) >= PRESETS_VISIBLE) setPresetsExpanded(true);
        if (presetCurrent) presetCurrent.textContent = match ? match.name : 'Personalizado';
    }

    function populateMenuFromConfig() {
        if (!initialMenu) return;
        if (cfgChannel) cfgChannel.value = config.channel || 'rageylo';
        if (cfg7tvCosmetics) cfg7tvCosmetics.checked = config.sevenTVCosmetics;
        if (cfg7tvEmotes) cfg7tvEmotes.checked = config.sevenTVEmotes;
        if (cfgTheme) setStep(cfgTheme, config.theme);
        if (cfgLayout) setStep(cfgLayout, config.layout);
        if (cfgTextShadow) setStep(cfgTextShadow, config.shadow);
        if (cfgMsgShadow) setStep(cfgMsgShadow, config.msgShadow);
        if (cfgAnimation) cfgAnimation.value = config.animation;
        if (cfgTextBgWidth) setStep(cfgTextBgWidth, config.textBgWidth);
        if (cfgTextSize) cfgTextSize.value = config.fontSize;
        if (cfgEmoteSize) cfgEmoteSize.value = config.emoteSize;
        if (cfgBadgeSize) cfgBadgeSize.value = config.badgeSize;
        if (cfgFont) cfgFont.value = config.font;
        if (cfgFontWeight) setStep(cfgFontWeight, config.fontWeight);
        if (cfgPinnedBanner) cfgPinnedBanner.checked = config.showPin;
        if (cfgTextBg) cfgTextBg.checked = config.textBg;
        if (cfgMentionHighlight) cfgMentionHighlight.checked = config.mentionHighlight;
        if (cfgHideBots) cfgHideBots.checked = config.hideBots;
        if (cfgBots) cfgBots.value = config.bots;
        if (cfgHideCommands) cfgHideCommands.checked = config.hideCommands;
        if (cfgDeletedMessages) setStep(cfgDeletedMessages, config.deletedMessages);
        if (cfgFadeTime) setStep(cfgFadeTime, config.fadeTime);
        window.HolyOptions.populate(config);
        sliders.forEach(syncSlider);
        if (fieldTextBgWidth) fieldTextBgWidth.classList.toggle('is-off', !config.textBg);
        if (fieldBots) fieldBots.classList.toggle('is-off', !config.hideBots);
        updatePresetState();
        updateSectionSummary();
    }

    // Channel currently typed in the menu (the test chat and test messages use its emote pack)
    function menuChannel() {
        return (cfgChannel ? cfgChannel.value.trim().toLowerCase() : config.channel) || 'rageylo';
    }

    // Copies the settings page into config
    function readMenuIntoConfig() {
        if (!initialMenu) return;
        config.channel = menuChannel();
        config.sevenTVCosmetics = cfg7tvCosmetics ? cfg7tvCosmetics.checked : true;
        config.sevenTVEmotes = cfg7tvEmotes ? cfg7tvEmotes.checked : true;
        config.theme = cfgTheme ? stepValue(cfgTheme) : 'dark';
        config.layout = cfgLayout ? stepValue(cfgLayout) : 'vertical';
        config.shadow = cfgTextShadow ? stepValue(cfgTextShadow) : 1;
        config.msgShadow = cfgMsgShadow ? stepValue(cfgMsgShadow) : 0;
        config.animation = cfgAnimation ? window.HolyCatalog.animationId(cfgAnimation.value) : 'none';
        config.textBgWidth = cfgTextBgWidth ? stepValue(cfgTextBgWidth) : 'min';
        config.fontSize = cfgTextSize ? clampFontSize(Number(cfgTextSize.value)) : 14;
        config.textSize = sizeName(config.fontSize);
        config.emoteSize = cfgEmoteSize ? Number(cfgEmoteSize.value) : 28;
        config.badgeSize = cfgBadgeSize ? Number(cfgBadgeSize.value) : 18;
        config.font = cfgFont ? fontKey(cfgFont.value) : 'inter';
        config.fontWeight = cfgFontWeight ? stepValue(cfgFontWeight) : 700;
        config.showPin = cfgPinnedBanner ? cfgPinnedBanner.checked : false;
        config.textBg = cfgTextBg ? cfgTextBg.checked : false;
        config.mentionHighlight = cfgMentionHighlight ? cfgMentionHighlight.checked : config.mentionHighlight;
        config.hideBots = cfgHideBots ? cfgHideBots.checked : false;
        config.bots = cfgBots ? botList(cfgBots.value) : DEFAULT_BOTS;
        config.hideCommands = cfgHideCommands ? cfgHideCommands.checked : false;
        config.deletedMessages = cfgDeletedMessages ? stepValue(cfgDeletedMessages) : 'notice';
        config.fadeTime = cfgFadeTime ? stepValue(cfgFadeTime) : 0;
        window.HolyOptions.read(config);
    }

    function buildGeneratedUrl(forObs = true) {
        const q = new URLSearchParams();
        q.set('channel', config.channel);
        q.set('sevenTVCosmeticsEnabled', String(config.sevenTVCosmetics));
        q.set('sevenTVEmotesEnabled', String(config.sevenTVEmotes));
        q.set('theme', config.theme);
        q.set('layout', config.layout);
        q.set('shadow', String(config.shadow));
        q.set('msgShadow', String(config.msgShadow));
        q.set('textSize', config.textSize);
        q.set('size', String(config.fontSize));
        q.set('emoteSize', String(config.emoteSize));
        q.set('badgeSize', String(config.badgeSize));
        q.set('font', config.font);
        q.set('fontWeight', String(config.fontWeight));
        q.set('animation', config.animation);
        q.set('showPinEnabled', String(config.showPin));
        q.set('textBackgroundEnabled', String(config.textBg));
        q.set('textBackgroundWidth', config.textBgWidth);
        q.set('mentionHighlightEnabled', String(config.mentionHighlight));
        q.set('hideBots', String(config.hideBots));
        if (config.hideBots) q.set('bots', config.bots);
        q.set('hideCommands', String(config.hideCommands));
        q.set('deletedMessages', config.deletedMessages);
        q.set('fade', String(config.fadeTime));
        window.HolyOptions.toQuery(config, q);
        if (forObs) {
            q.set('overlay', 'true');
        }

        return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
    }

    // Any change on the settings page applies to the test chat right away
    function onMenuChange(e) {
        if (e && e.target && e.target.classList && e.target.classList.contains('hc-slider')) syncSlider(e.target);

        const prev = { channel: config.channel, emotes: config.sevenTVEmotes, cosmetics: config.sevenTVCosmetics, mentionHighlight: config.mentionHighlight, layout: config.layout, fadeTime: config.fadeTime, design: config.design, timestamps: config.timestamps, platformIcon: config.platformIcon };
        readMenuIntoConfig();
        // Cinta simple and Terciopelo run in the ticker: picking one of them switches Disposición
        // to it, and picking another style afterwards brings the column back
        if (e && e.target && e.target.id === 'cfgDesign' && cfgLayout) {
            const layout = window.HolyCatalog.design(config.design).layout;
            if (layout || window.HolyCatalog.design(prev.design).layout) {
                setStep(cfgLayout, layout || 'vertical');
                syncSlider(cfgLayout);
                readMenuIntoConfig();
            }
        }
        // The Presets title shows the preset matching config, so config is read first
        updatePresetState();
        updateSectionSummary();
        applyStyles();
        if (fieldTextBgWidth) fieldTextBgWidth.classList.toggle('is-off', !config.textBg);
        if (fieldBots) fieldBots.classList.toggle('is-off', !config.hideBots);
        if (urlFallback) urlFallback.classList.add('hidden');
        updateFilteredRows();

        if (prev.channel !== config.channel) {
            loadMenuChannelPackDebounced();
            rerenderMessages();
        }
        if (prev.emotes !== config.sevenTVEmotes || prev.cosmetics !== config.sevenTVCosmetics) {
            if (config.sevenTVEmotes) loadMenuChannelPack();
            rerenderMessages();
        }
        if (prev.mentionHighlight !== config.mentionHighlight) rerenderMessages();
        // The style decides whether rows show the time and the Kick icon
        if (prev.design !== config.design || prev.timestamps !== config.timestamps || prev.platformIcon !== config.platformIcon) rerenderMessages();
        if (prev.layout !== config.layout) relayoutRows();
        if (prev.layout !== config.layout || prev.fadeTime !== config.fadeTime) rescheduleFades();

        saveSettingsDebounced();
    }

    // Save current settings to cache (debounced: the page updates on every keystroke and slider step)
    function saveSettings() {
        if (typeof window !== 'undefined' && window.KickCache) {
            window.KickCache.set('overlay_settings', {
                channel: config.channel,
                sevenTVCosmetics: config.sevenTVCosmetics,
                sevenTVEmotes: config.sevenTVEmotes,
                theme: config.theme,
                layout: config.layout,
                shadow: config.shadow,
                msgShadow: config.msgShadow,
                textSize: config.textSize,
                fontSize: config.fontSize,
                emoteSize: config.emoteSize,
                badgeSize: config.badgeSize,
                font: config.font,
                fontWeight: config.fontWeight,
                animation: config.animation,
                showPin: config.showPin,
                textBg: config.textBg,
                textBgWidth: config.textBgWidth,
                mentionHighlight: config.mentionHighlight,
                hideBots: config.hideBots,
                bots: config.bots,
                hideCommands: config.hideCommands,
                deletedMessages: config.deletedMessages,
                fadeTime: config.fadeTime,
                ...window.HolyOptions.toCache(config)
            }, 30 * 24 * 60 * 60 * 1000);
        }
    }

    const saveSettingsDebounced = debounce(saveSettings, 300);

    // Loads the 7TV pack of the channel typed in the menu and 7TV global emotes
    function loadMenuChannelPack() {
        if (window.KickChatClient) {
            KickChatClient.loadPack(menuChannel());
            KickChatClient.loadGlobalPack();
        }
    }

    const loadMenuChannelPackDebounced = debounce(loadMenuChannelPack, 500);

    function launchOverlayFromMenu() {
        isOverlayActive = true;
        readMenuIntoConfig();
        saveSettingsDebounced.flush();
        applyStyles();
        stopTemplateFeed();
        chatMessagesEl.textContent = '';
        setMode('overlay');
        startClient();

        try {
            // Keep regular browser clean so refresh always reopens the menu
            window.history.pushState({}, '', buildGeneratedUrl(false));
        } catch (e) { }
    }

    function openMenu() {
        if (!initialMenu) return;
        populateMenuFromConfig();
        loadMenuChannelPack();
        loadPresetFonts();
        if (menuCloseBtn) menuCloseBtn.classList.toggle('hidden', !isOverlayActive);
        if (client) {
            client.disconnect();
            client = null;
        }
        chatMessagesEl.textContent = '';
        setMode('menu');
        startTemplateFeed();
    }

    function closeMenu() {
        launchOverlayFromMenu();
    }

    function copyGeneratedUrl() {
        readMenuIntoConfig();
        const textToCopy = buildGeneratedUrl(true);

        const done = () => {
            if (urlFallback) urlFallback.classList.add('hidden');
            if (copyError) copyError.classList.add('hidden');
            if (btnCopyLabel) {
                btnCopyLabel.textContent = 'URL copiada';
                setTimeout(() => { btnCopyLabel.textContent = 'Copiar URL para OBS'; }, 2000);
            }
        };
        // Clipboard refused: show the link only now, selected, so it can be copied by hand
        const fail = () => {
            if (!urlFallback) return;
            urlFallback.value = textToCopy;
            urlFallback.classList.remove('hidden');
            urlFallback.focus();
            urlFallback.select();
            if (copyError) copyError.classList.remove('hidden');
        };

        try {
            navigator.clipboard.writeText(textToCopy).then(done, fail);
        } catch (e) {
            fail();
        }
    }

    // "Actualizar caché": downloads the channel's Kick data, 7TV emotes and 7TV cosmetics again.
    // Limited so it cannot hammer Kick's and 7TV's APIs: one use per minute, five per hour.
    // The uses are stored, so reloading the page does not reset the limit.
    const REFRESH_COOLDOWN_MS = 60 * 1000;
    const REFRESH_PER_HOUR = 5;
    const REFRESH_KEY = 'cache_refreshes';
    const REFRESH_LABEL = 'Actualizar caché';
    let refreshBusy = false;
    let refreshTimer = null;
    let refreshResult = '';

    function recentRefreshes() {
        const list = window.KickCache ? window.KickCache.get(REFRESH_KEY) : null;
        const hourAgo = Date.now() - 60 * 60 * 1000;
        return Array.isArray(list) ? list.filter(t => typeof t === 'number' && t > hourAgo) : [];
    }

    // Milliseconds until the button can be used again (0 = now), and why
    function refreshWait() {
        const uses = recentRefreshes();
        const now = Date.now();
        if (uses.length >= REFRESH_PER_HOUR) {
            return { ms: uses[uses.length - REFRESH_PER_HOUR] + 60 * 60 * 1000 - now, hourly: true };
        }
        const last = uses[uses.length - 1];
        return { ms: last ? Math.max(0, last + REFRESH_COOLDOWN_MS - now) : 0, hourly: false };
    }

    function formatWait(ms) {
        const sec = Math.ceil(ms / 1000);
        return sec >= 60 ? `${Math.ceil(sec / 60)} min` : `${sec} s`;
    }

    // Keeps the button's text and state in step with the limit, ticking once a second while it waits
    function updateRefreshButton() {
        clearTimeout(refreshTimer);
        refreshTimer = null;
        if (!btnRefreshCache) return;
        if (refreshBusy) {
            btnRefreshCache.disabled = true;
            btnRefreshLabel.textContent = 'Actualizando…';
            return;
        }
        const wait = refreshWait();
        btnRefreshCache.disabled = wait.ms > 0;
        if (wait.ms <= 0) {
            btnRefreshLabel.textContent = REFRESH_LABEL;
            btnRefreshCache.title = `Vuelve a descargar los datos del canal, los emotes y los cosméticos de 7TV (máximo ${REFRESH_PER_HOUR} veces por hora)`;
            return;
        }
        const waitText = wait.hourly
            ? `Límite por hora · vuelve en ${formatWait(wait.ms)}`
            : `Disponible en ${formatWait(wait.ms)}`;
        btnRefreshLabel.textContent = refreshResult ? `${refreshResult} · ${waitText}` : waitText;
        btnRefreshCache.title = wait.hourly
            ? `Ya se actualizó ${REFRESH_PER_HOUR} veces en la última hora`
            : 'Espera un momento entre una actualización y otra';
        refreshTimer = setTimeout(updateRefreshButton, 1000);
    }

    async function refreshCache() {
        if (refreshBusy || refreshWait().ms > 0 || !window.KickChatClient) return;
        refreshBusy = true;
        refreshResult = '';
        window.KickCache.set(REFRESH_KEY, [...recentRefreshes(), Date.now()], 60 * 60 * 1000);
        updateRefreshButton();
        try {
            const res = await KickChatClient.refreshCache(menuChannel());
            refreshResult = res.channel ? `Listo: ${res.emotes} emotes` : 'Kick no respondió, se usa la copia guardada';
            rerenderMessages();
        } catch (e) {
            refreshResult = 'No se pudo actualizar';
        }
        refreshBusy = false;
        updateRefreshButton();
        // The result stays only for the first seconds of the wait
        setTimeout(() => { refreshResult = ''; }, 4000);
    }

    // -------------------------------------------------------------------------
    // Test chat: example messages only, never a real Kick chat
    // -------------------------------------------------------------------------
    // Real 7TV paints (from 7TV's cosmetics API), turned into CSS by the same code as live chat
    const SEVENTV_PAINTS = {
        bismuth: { "function": "LINEAR_GRADIENT", "angle": 135, "repeat": true, "stops": [{ "at": 0.0, "color": -1820262401 }, { "at": 0.1, "color": -1820262401 }, { "at": 0.1, "color": -9395969 }, { "at": 0.2, "color": -9395969 }, { "at": 0.2, "color": 12582911 }, { "at": 0.3, "color": 12582911 }, { "at": 0.3, "color": 1140751359 }, { "at": 0.4, "color": 1140751359 }, { "at": 0.4, "color": -18860801 }, { "at": 0.5, "color": -18860801 }], "shadows": [{ "x_offset": 0, "y_offset": 0, "radius": 3, "color": 1278803967 }] },
        tangerine: { "function": "LINEAR_GRADIENT", "angle": 90, "repeat": false, "stops": [{ "at": 0.19, "color": -1795293185 }, { "at": 0.5, "color": -3894017 }, { "at": 0.79, "color": -1795293185 }, { "at": 1.0, "color": -3894017 }], "shadows": [{ "x_offset": 0, "y_offset": 0, "radius": 0.1, "color": -121202945 }] },
        mysticSmoke: { "function": "LINEAR_GRADIENT", "angle": 125, "repeat": false, "stops": [{ "at": 0.0, "color": -236456961 }, { "at": 0.25, "color": -236456961 }, { "at": 0.5, "color": -1642534913 }, { "at": 0.75, "color": 1650418687 }, { "at": 1.0, "color": 1650418687 }], "shadows": [{ "x_offset": 0, "y_offset": 0, "radius": 0.1, "color": 1650484223 }, { "x_offset": 1, "y_offset": 1, "radius": 0.1, "color": 805328895 }] },
        slime: { "function": "LINEAR_GRADIENT", "angle": 180, "repeat": false, "stops": [{ "at": 0.32, "color": -7274497 }, { "at": 0.52, "color": -7274497 }, { "at": 0.65, "color": 15103743 }, { "at": 0.82, "color": 15103743 }, { "at": 1.0, "color": 15103743 }], "shadows": [{ "x_offset": 0, "y_offset": 0, "radius": 0.1, "color": 1558280703 }] },
        waterSurge: { "function": "LINEAR_GRADIENT", "angle": 125, "repeat": false, "stops": [{ "at": 0.09, "color": -1 }, { "at": 0.36, "color": -1109262337 }, { "at": 0.43, "color": 1725026815 }, { "at": 0.59, "color": 10921727 }, { "at": 1.0, "color": 372396031 }], "shadows": [{ "x_offset": 0, "y_offset": 1, "radius": 0.1, "color": 291532543 }] }
    };

    // Real 7TV badges (cdn.7tv.app/badge/<id>)
    const SEVENTV_BADGES = {
        founder: ['01GAFA46M0000E8VNG1S1RMTBG', '7TV Subscriber (Founder)'],
        twoYears: ['01H85BS7G000020G66EN3RFP99', '7TV Subscriber (2 Years)'],
        oneYear: ['01GAF9GYD8000E8VNG1S1RMTBF', '7TV Subscriber (1 Year)'],
        sixMonths: ['01GAF9BTB8000E8VNG1S1RMTBD', '7TV Subscriber (6 Months)'],
        threeMonths: ['01GAF994D8000E8VNG1S1RMTBC', '7TV Subscriber (3 Months)']
    };

    // The test chat's chatters (names chosen by the user). Badges use Kick's own types;
    // "sub_gifter:250" and "subscriber:12" carry the count like Kick does.
    const TEST_USERS = [
        { username: 'Agu_sanhueza', color: '#4aa3ff', badges: ['subscriber:3'] },
        { username: 'Fqkeeh', color: '#00c853', badges: ['moderator', 'subscriber:24'], paint: 'waterSurge', seventvBadge: 'twoYears' },
        { username: 'Yuuzito', color: '#53fc18', badges: ['founder', 'subscriber:30'], paint: 'bismuth', seventvBadge: 'founder' },
        { username: 'mearzys', color: '#e046d0', badges: ['vip', 'subscriber:8'] },
        { username: 'sacksuu', color: '#ff9f1a', badges: [] },
        { username: 'marttpeepo', color: '#a07bff', badges: ['subscriber:12'], paint: 'tangerine', seventvBadge: 'oneYear' },
        { username: 'matiaz0800', color: '#22c7b8', badges: ['og'] },
        { username: 'tintinMC', color: '#ff4f8b', badges: ['subscriber:1'] },
        { username: 'aywidbi', color: '#f7d34a', badges: [] },
        { username: 'chungkingexpress', color: '#ff6b6b', badges: ['og', 'sub_gifter:250'] },
        { username: 'lukitaselglorp', color: '#7bd88f', badges: ['subscriber:6'], paint: 'slime', seventvBadge: 'sixMonths' },
        { username: 'ferldz', color: '#4aa3ff', badges: [] },
        { username: 'MONKIWI', color: '#c471ed', badges: ['vip'] },
        { username: 'noah4eva', color: '#00dfd8', badges: ['subscriber:2'] },
        { username: 'pachudani', color: '#ff9f1a', badges: ['founder', 'subscriber:18'] },
        { username: 'Swagginhaze28', color: '#e046d0', badges: [], paint: 'mysticSmoke', seventvBadge: 'threeMonths' },
        { username: 'sillazul', color: '#4a7bff', badges: ['subscriber:4'] },
        { username: 'jmica', color: '#53fc18', badges: ['moderator'] },
        { username: 'tomasinfr', color: '#a07bff', badges: ['sub_gifter:50'] },
        { username: 'YesK', color: '#ff7a59', badges: [] },
        { username: 'SPEED_RUNNING', color: '#3ddc97', badges: ['subscriber:5'] },
        { username: 'ztample', color: '#f5a3ff', badges: [] },
        { username: 'Zephyrr05', color: '#6ec6ff', badges: ['subscriber:2'] },
        { username: 'zmaple', color: '#ffd166', badges: [] },
        { username: 'teeeo01', color: '#ef476f', badges: ['vip'] },
        { username: 'kutma04', color: '#06d6a0', badges: [] },
        { username: '6tincho', color: '#9d8cff', badges: ['subscriber:9'] },
        { username: 'mwrena', color: '#ff9e64', badges: [] },
        { username: 'Camcs', color: '#4cc9f0', badges: [] }
    ];

    // Conversations between the test chatters: each reply answers the message before it
    const TEST_THREADS = [
        {
            id: "A1", lines: [
                { u: "tintinMC", t: "@sacksuu 438 jugadores en el server a las 22:15. Te faltan 62 para el corte de pelo, jaja {emote}" },
                { u: "sacksuu", t: "@tintinMC eso es un bot que puso un pibe en el lobby, no cuenta. No me voy a cortar nada todavía" },
                { u: "tintinMC", t: "@sacksuu los 438 son reales, los conté con el /list. Que lo confirme {channel} si querés" },
                { u: "Fqkeeh", t: "@tintinMC @sacksuu nadie mete bots al server, la próxima se banea sin vuelta. Ya lo dije {emote}" },
                { u: "sacksuu", t: "@Fqkeeh dale, pero la apuesta es la apuesta. Si llego a 500 me corto el pelo en vivo, lo juro" },
                { u: "tintinMC", t: "@sacksuu y si no llegás, a bailar cumbia en la cancha del server. Preparate, que ya perdiste dos veces {emote}" }
            ]
        },
        {
            id: "A2", lines: [
                { u: "sillazul", t: "@marttpeepo el clásico fue 1 a 1 y el gol de Central llegó en el 90. Empate, no lo discutas más {emote}" },
                { u: "marttpeepo", t: "@sillazul empate en el papel, pero ganó Newell's en la cabeza. Así lo tengo anotado y no lo cambio {emote}" },
                { u: "sillazul", t: "@marttpeepo en la cabeza no vale puntos, amigo. Bancá que el próximo clásico lo ganamos nosotros" },
                { u: "aywidbi", t: "@sillazul el café que me debés sigue en pie, eh. Lo de la apuesta del derby no se olvida {emote}" },
                { u: "marttpeepo", t: "@aywidbi y encima sillazul tiene un sub regalado tuyo, qué suerte. Mañana sí te pago yo el café, posta" },
                { u: "sillazul", t: "@marttpeepo tranqui, con el laburo vas a llegar. Cata te manda mate y yo hoy no te jodo más con el clásico {emote}" }
            ]
        },
        {
            id: "A3", lines: [
                { u: "lukitaselglorp", t: "Me comprometí la semana pasada con Jime, acá en Bahía Blanca. Ella dijo que sí y yo todavía no me lo creo {emote}" },
                { u: "chungkingexpress", t: "@lukitaselglorp felicitaciones, posta! Que Jime te haga ver Casablanca un jueves y ya tenés el sí de la familia" },
                { u: "noah4eva", t: "@lukitaselglorp qué hermoso, che. La despedida de solter@ es en noviembre? Tiren pa Mendoza que hay bodegas de sobra {emote}" },
                { u: "lukitaselglorp", t: "@noah4eva noviembre en Bahía Blanca. Cada uno pone guita y el que no viene paga el fernet, eso es ley" },
                { u: "noah4eva", t: "@lukitaselglorp me despierto a las 3 para votar la despedida, eh. Mandame el link y pongo lo que pueda {emote}" },
                { u: "chungkingexpress", t: "@noah4eva ojo que para noviembre ya estás en Madrid, así que hacé el asado vos desde allá y lo mandamos por chat" }
            ]
        },
        {
            id: "A4", lines: [
                { u: "mearzys", t: "Llevo 14 horas de guardia y me quedan 10. Desde el office miro el stream, estoy agotada {emote}" },
                { u: "jmica", t: "@mearzys tomá agua y comé algo, enfermera. Acá no te piden nada más que aparecer {emote}" },
                { u: "mearzys", t: "@jmica gracias, jefe. Mi mamá me llama el domingo a la noche y se alarga una hora. Alguien me manda un audio que diga 'estoy en guardia, mami'?" },
                { u: "Fqkeeh", t: "@mearzys mandalo vos misma, y si hace falta te lo grabo yo el domingo. Pero nada de datos del hospital en el audio, eh" },
                { u: "jmica", t: "@mearzys me sumo: si tu mamá insiste, mandale un audio de Atlético perdiendo, así corta seguro {emote}" },
                { u: "mearzys", t: "@jmica no, Atlético perdiendo es lo que la pone peor. Mejor un audio de 'llegó el café'. Gracias chat, los quiero" }
            ]
        },
        {
            id: "A5", lines: [
                { u: "Agu_sanhueza", t: "Tango se comió otro cable del cargador. Ya van tres cargadores, me quedé sin celular a las 3 de la tarde en pleno final {emote}" },
                { u: "pachudani", t: "@Agu_sanhueza te entiendo, yo ya cambié tres auriculares por el perro de mi vecino. Tango es un crack, no un perro" },
                { u: "tintinMC", t: "@Agu_sanhueza comprate un cargador de cable blindado, de los que vienen con kevlar. Tango no pasa esa {emote}" },
                { u: "Agu_sanhueza", t: "@tintinMC ya lo intenté, el blindado también lo mastica. El último me salió 18 mil pesos y mi viejo me miró feo" },
                { u: "pachudani", t: "@Agu_sanhueza ojo con los 18 mil, eh. Mirá que la suscripción también la pago yo y no me quejo tanto {emote}" },
                { u: "Agu_sanhueza", t: "@pachudani dale, ustedes hacen fuerza que yo tengo el segundo final de Cálculo II la semana que viene. Tango, sos un problema" }
            ]
        },
        {
            id: "A6", lines: [
                { u: "matiaz0800", t: "Perdí el celular en el colectivo la semana pasada, el que hace ruido cuando lo llamás. Lo busco en la comisaría {emote}" },
                { u: "ferldz", t: "@matiaz0800 llamalo desde el fijo de casa a ver si aparece. Y Doña Rosa pisó el teclado en directo otra vez {emote}" },
                { u: "tomasinfr", t: "@ferldz Doña Rosa tiene más seguidores que mi gato, que todavía no tiene nombre. La respeto por eso" },
                { u: "matiaz0800", t: "@ferldz no, el celular no aparece. Pero el jueves hago milanesas igual, vengan los que quieran, hay para seis {emote}" },
                { u: "ferldz", t: "@matiaz0800 llego tarde, como siempre. Yo llevo la ensalada, pero la gata se la come si la dejo en la mesa" },
                { u: "tomasinfr", t: "@matiaz0800 yo llego después de cobrar y traigo fernet. Bancá que el gato no sabe el nombre pero sabe las milanesas {emote}" }
            ]
        },
        {
            id: "B1", lines: [
                { u: "ferldz", t: "Doña Rosa se subió al teclado otra vez y mandó como diez letras al chat. Pido disculpas por ella {emote}" },
                { u: "matiaz0800", t: "@ferldz sos el único que llega tarde a sus propias milanesas. El jueves cocino, así que hacé lugar en la mesa. {combo}" },
                { u: "ferldz", t: "@matiaz0800 llego a las 22 si el colectivo no se muere. Doña Rosa ya se tomó el pan rallado de la mesada." },
                { u: "noah4eva", t: "Me voy a Madrid en 20 días. Escribirlo a las 3 de la mañana da más pena, pero vine a despedirme igual. {emote}" },
                { u: "matiaz0800", t: "@noah4eva yo perdí el celu en el colectivo la semana pasada, pero el jueves te mando la foto de la milanesa igual." },
                { u: "ferldz", t: "@noah4eva mandá foto de Madrid, y no te olvides de las milanesas. En España el pan rallado es un misterio. {combo}" },
                { u: "noah4eva", t: "@ferldz @matiaz0800 gracias, en serio. Me despiertan a las 3 y encima me dan de comer. Nos vemos desde el otro lado." }
            ]
        },
        {
            id: "B2", lines: [
                { u: "Swagginhaze28", t: "Hola a todos, recién llego de Tucumán. Qué es el hype train? Lo vi escrito en el chat y no entendí nada {emote}" },
                { u: "jmica", t: "@Swagginhaze28 Hype train: cuando el chat junta subs y la barra sube de nivel. Bienvenido, leé las reglas en el panel." },
                { u: "Swagginhaze28", t: "@jmica ok, y los emotes raros que mandan todos, de dónde salen? Pregunté antes y nadie contestó, solo mandaban emotes. {combo}" },
                { u: "MONKIWI", t: "@Swagginhaze28 Son de 7TV, instalás la extensión y listo. Y sí, gané el sorteo otra vez, no me miren así. La botella de malbec existe, lo juro." },
                { u: "jmica", t: "@Swagginhaze28 Regla uno: nada de spam de emotes. Regla dos: nada de spoilers. Lo demás lo vas viendo solo." },
                { u: "Swagginhaze28", t: "@jmica bancá, ya me hice amigo de tres en cinco minutos. Eso cuenta para el hype? {emote}" }
            ]
        },
        {
            id: "B3", lines: [
                { u: "sacksuu", t: "@Yuuzito ya pasaron tres semanas, cuándo bailás la cumbia que le prometiste a {channel}? {emote}" },
                { u: "Yuuzito", t: "@sacksuu está en el guion, posta. Esta semana cuando termine el turno lo grabo en el living." },
                { u: "mearzys", t: "@Yuuzito eso lo dijiste la semana pasada. Yo ya bailé anoche en la guardia, con la camilla de partner. {combo}" },
                { u: "Yuuzito", t: "@mearzys la camilla no cuenta, te estás riendo de mí. Cumbia el domingo, de verdad. {emote}" },
                { u: "sacksuu", t: "@Yuuzito el domingo es el día con más chat, no hay excusas. Yo me corto el pelo si el server llega a 500, vos bailá." },
                { u: "Yuuzito", t: "Dale, dale, ya conecté el parlante. Pero a {channel} le pido que me filme de frente, no de costado. {emote}" },
                { u: "mearzys", t: "@Yuuzito si no bailás, te grabo yo en la próxima guardia y lo subo al canal. Sin excusas, guapo. {combo}" }
            ]
        },
        {
            id: "B4", lines: [
                { u: "chungkingexpress", t: "Otra semana, otra tanda de subs de regalo. Como en Chungking Express, el amor llega cuando menos lo esperás. {emote}" },
                { u: "Yuuzito", t: "@chungkingexpress y mi café de marzo sigue en el aire, eh. Ya es octubre, tengo el cortado frío esperándote." },
                { u: "chungkingexpress", t: "@Yuuzito el lunes después del cine en Almagro te invito el cortado y una medialuna. Esta vez sí, te lo juro. {combo}" },
                { u: "tomasinfr", t: "@chungkingexpress y yo acabo de tirar tres subs de regalo, cobré el freelance esta semana. Reparto para todos." },
                { u: "Yuuzito", t: "@tomasinfr qué bien. Y el gato sigue sin nombre? Te lo pregunto cada semana, es un tema de Estado. {emote}" },
                { u: "tomasinfr", t: "@Yuuzito sigue sin nombre, cada vez que lo nombro se pone a dormir. Sugerencias bienvenidas, menos Doña Rosa, que ya tiene dueña." },
                { u: "chungkingexpress", t: "@tomasinfr ponele Godard, así te deja en paz y se duerme viendo películas. Yuuzito, el lunes sigue en pie. {emote}" }
            ]
        },
        {
            id: "B5", lines: [
                { u: "aywidbi", t: "Te regalé un sub por perder la apuesta del clásico, sillazul. Vos me debés el café, no te olvides. {emote}" },
                { u: "sillazul", t: "@aywidbi el sub lo acepto con el corazón, el café lo pago con el primer franco que tenga. Vaca Muerta te tiene a full?" },
                { u: "aywidbi", t: "@sillazul tres semanas de turno y dos de descanso, o sea que el café lo tomás en enero, cuando baje del yacimiento." },
                { u: "Agu_sanhueza", t: "@aywidbi tres semanas de pozo y dos libres, qué envidia. Mientras tanto Tango mordió otro cargador, ya van cuatro. {combo}" },
                { u: "sillazul", t: "@Agu_sanhueza comprale a Tango un cargador de los que no se mastican. Y que Boca no te haga sufrir tanto. {emote}" },
                { u: "aywidbi", t: "@sillazul el sub es regalo, el café es deuda. Así de simple. Traé la guita en enero y listo." }
            ]
        },
        {
            id: "B6", lines: [
                { u: "marttpeepo", t: "Hoy me llamaron de una empresa para una entrevista, mañana sí, posta. Cata me trajo mate y eso ya es un buen día. {emote}" },
                { u: "mearzys", t: "@marttpeepo qué buena noticia, de verdad. Tomate el mate y después contame cómo te fue en la entrevista, guapo." },
                { u: "lukitaselglorp", t: "@marttpeepo sin presión, eh. Si no sale, el chat igual te banca. Y Cata es la mejor, le debo un mate también." },
                { u: "marttpeepo", t: "Gracias, en serio. Hace un mes me echaron y a veces siento que no sirvo para nada. Igual mandé tres CV esta semana." },
                { u: "mearzys", t: "@marttpeepo sirve un montón lo que hacés. Mandar CV con el mes que tuviste es ser valiente. Dormí bien hoy." },
                { u: "lukitaselglorp", t: "@marttpeepo cuando salga algo avisanos y lo festejamos en el chat, con un asado de mentira. {combo}" },
                { u: "marttpeepo", t: "Dale, aviso. Y que Newell's gane el sábado así tengo una buena noticia más encima. {emote}" }
            ]
        },
        {
            id: "C1", lines: [
                { u: "Fqkeeh", t: "Chat, ¿alguien me confirma si el audio se escucha bajo? Si hay lag o la cámara borrosa, avisen acá. {emote}" },
                { u: "Agu_sanhueza", t: "@Fqkeeh a mí se escucha bajito, creo que es mi router, se corta cada diez minutos desde ayer." },
                { u: "jmica", t: "@Agu_sanhueza el audio de {channel} está bien en mi lado. Reiniciá el router y fijate si mejora. {combo}" },
                { u: "Agu_sanhueza", t: "@jmica reinicié y nada, encima Tango ladró al cartero y se escucha todo de fondo. Perdón, posta." },
                { u: "jmica", t: "@Fqkeeh confirmo, la cámara se ve borrosa y el chat va con lag. Yo también lo veo desde el celu." },
                { u: "Fqkeeh", t: "@jmica dale, bajo el bitrate y reviso el encoder. @Agu_sanhueza que Tango ladre no es un problema técnico, eh. {combo}" }
            ]
        },
        {
            id: "C2", lines: [
                { u: "pachudani", t: "Otra vez cuatro anuncios en una hora y el sub subió. Yo estaba en la beta, esto ya no es lo mismo. {emote}" },
                { u: "MONKIWI", t: "@pachudani tranqui founder, cuando me llegue el malbec te pago la suscripción del año. {combo}" },
                { u: "pachudani", t: "@MONKIWI tu malbec no existe, sos el único que lo cree. Mientras tanto me quejo, es mi derecho." },
                { u: "Fqkeeh", t: "@pachudani regla nueva: las quejas de precio van al hilo de sugerencias, no al chat en vivo. Si se repite, la próxima se banea. {emote}" },
                { u: "MONKIWI", t: "@Fqkeeh jaja, sí jefe, lo dejo pasar. La botella existe igual, aunque nadie la vea." },
                { u: "pachudani", t: "Ok, cumplo. Pero no me voy, eh. Tengo turno de noche en el call center y acá me quedo hasta las seis." }
            ]
        },
        {
            id: "C3", lines: [
                { u: "MONKIWI", t: "Gané el sorteo otra vez, ya sé que me van a cargar. El malbec existe, se los juro. {combo}" },
                { u: "matiaz0800", t: "@MONKIWI el malbec no existe, lo dice todo el chat. Ganaste otra vez, sos la mascota del sorteo." },
                { u: "ferldz", t: "@MONKIWI pasame una foto de la etiqueta, aunque sea. Doña Rosa ya se subió a la mesa a mirar. {emote}" },
                { u: "MONKIWI", t: "@ferldz acá va la etiqueta: Maipú, 2019, la botella que todos dicen que no existe. {combo}" },
                { u: "matiaz0800", t: "@MONKIWI una etiqueta puede ser de cualquier cosa, jaja. Igual, la foto está bastante prolija." },
                { u: "ferldz", t: "@MONKIWI traela el jueves, matiaz hace milanesas. Si existe, nos la tomamos y listo." }
            ]
        },
        {
            id: "C4", lines: [
                { u: "mearzys", t: "Salí de una guardia de 24 horas y estoy hecha pelota. Ya quiero dormir, pero acá sigo mirando. {emote}" },
                { u: "Agu_sanhueza", t: "@mearzys yo con dos finales encima tampoco me acuerdo de mi nombre. Tip: 25 minutos de estudio y 5 de pausa. {combo}" },
                { u: "mearzys", t: "@Agu_sanhueza eso me sirve para los pacientes, no para los parciales. Igual lo pruebo, aunque sea mañana." },
                { u: "Agu_sanhueza", t: "@mearzys dale, y armá un resumen de una hoja. Tango se comió otro cargador, ya van tres, estudio con 4% de batería." },
                { u: "mearzys", t: "Jaja pobre Tango. Justo me llamó mamá, me preguntó si comí y le dije que sí. Mentí, obvio. {combo}" },
                { u: "Agu_sanhueza", t: "@mearzys mentirle a mamá es amor, eh. Ojalá te toque una noche tranquila antes de la próxima guardia." }
            ]
        },
        {
            id: "C5", lines: [
                { u: "sacksuu", t: "@tintinMC cuántos jugadores tiene el server hoy? Si llegamos a 500 me corto el pelo, si no, bailo cumbia. {emote}" },
                { u: "tintinMC", t: "@sacksuu 412 conectados anoche, te faltan casi cien, pibe. Andá buscando la tijera." },
                { u: "Yuuzito", t: "@sacksuu mientras tanto yo sigo debiendo el video de cumbia a {channel}. Lo hago el sábado, posta." },
                { u: "chungkingexpress", t: "@Yuuzito como dice Wong Kar-wai, el tiempo se va y el café no llega. Te lo debo desde marzo, lo juro. {combo}" },
                { u: "sacksuu", t: "@chungkingexpress ni me hables de café, estoy comiendo fideos desde que me compré la Switch con el aguinaldo." },
                { u: "tintinMC", t: "@sacksuu relajate, el viernes hay evento y el server sube. Si llegamos a 500, te corto el pelo yo mismo. {emote}" }
            ]
        },
        {
            id: "C6", lines: [
                { u: "Swagginhaze28", t: "Hola a todos, primera vez en el chat. ¿Qué es la tanda de subs regalados? Vi que llovieron. {emote}" },
                { u: "tomasinfr", t: "@Swagginhaze28 bienvenido. Regalo subs en tanda cuando me pagan, y me pagaron esta semana. {combo}" },
                { u: "MONKIWI", t: "@tomasinfr y el gato, ¿cómo se llama ya? Te lo pregunto cada semana y siempre cambiás de tema." },
                { u: "tomasinfr", t: "@MONKIWI sigue sin nombre, che. Se lo pongo cuando termine de cobrar todo el laburo freelance." },
                { u: "Swagginhaze28", t: "@tomasinfr ¿y si lo llamás Hype Train? Así le explico a todos qué es, jaja. {emote}" },
                { u: "MONKIWI", t: "@Swagginhaze28 jaja, eso suena a nombre de emote, no de gato. Después te explico bien el hype train." }
            ]
        },
        {
            id: "D1", lines: [
                { u: "Fqkeeh", t: "Borré un mensaje con un link raro que decía sorteo gratis. Acá los links de sorteos no pasan, la regla es clara. {emote}" },
                { u: "sacksuu", t: "@Fqkeeh y yo sigo anotado en el sorteo o me saqué? Lo vi recién cuando lo borraste." },
                { u: "Fqkeeh", t: "@sacksuu seguís adentro, el sorteo es del canal y no de links. Si alguien te escribe por privado, no le das nada. {combo}" },
                { u: "MONKIWI", t: "@sacksuu tranqui, si gano yo te doy la botella de malbec que nadie cree que tengo." },
                { u: "sacksuu", t: "@MONKIWI ni en joda, esa botella no existe. Pero gracias por la oferta. {emote}" },
                { u: "Fqkeeh", t: "@MONKIWI la próxima se banea, no hagamos bromas con links. Seguimos con el stream." }
            ]
        },
        {
            id: "D2", lines: [
                { u: "Agu_sanhueza", t: "Re trucho el sorteo del sábado, salió el mismo nombre de siempre. Algo raro pasa {emote}" },
                { u: "sacksuu", t: "@Agu_sanhueza ganaste vos el mes pasado, no te quejes. Tango ya se comió otro cargador?" },
                { u: "Agu_sanhueza", t: "@sacksuu fueron tres cargadores, Tango es un traidor. Y el sorteo sí fue raro, posta. {combo}" },
                { u: "jmica", t: "@Agu_sanhueza @sacksuu leé las reglas: el sorteo es random y se cierra. Hasta acá la discusión." },
                { u: "sacksuu", t: "@jmica bueno jefe. Igual si Tango gana el sorteo me callo la boca." },
                { u: "Agu_sanhueza", t: "@jmica dale, ok. Tango igual se queda con el cargador nuevo, eso no tiene sorteo. {emote}" }
            ]
        },
        {
            id: "D3", lines: [
                { u: "Yuuzito", t: "@{channel} el video de cumbia lo hago el domingo, lo prometí. Después no me pidas más. {emote}" },
                { u: "chungkingexpress", t: "@Yuuzito lo prometiste hace tres meses, y yo todavía te debo un café desde marzo." },
                { u: "pachudani", t: "@Yuuzito no es justo, el equipo ganó y el que baila sos vos. Que {channel} también baile si no es justo. {combo}" },
                { u: "Yuuzito", t: "@pachudani {channel} no baila, ya lo intenté. Bueno, dale, igual tengo que hacer el video. {emote}" },
                { u: "chungkingexpress", t: "@Yuuzito propongo compromiso: vos bailás 30 segundos de cumbia y yo te pago el café de una vez." },
                { u: "Yuuzito", t: "@chungkingexpress trato, pero el café lo pagás con un sub, no en efectivo. {combo}" }
            ]
        },
        {
            id: "D4", lines: [
                { u: "Fqkeeh", t: "Hoy cumple años @tintinMC, lo sabemos porque lo dijo 40 veces en el server. Feliz cumple {emote}" },
                { u: "sacksuu", t: "@tintinMC feliz cumple. Que el año que viene el server llegue a 500 y yo me corte el pelo, ahí sí." },
                { u: "aywidbi", t: "Feliz cumple tintinMC, cantemos todos juntos. {combo}" },
                { u: "MONKIWI", t: "Cumpleaños feliz, cumpleaños feliz. Chiste malo: qué le dijo el creeper al cumpleañero? Explotá de alegría." },
                { u: "sacksuu", t: "@tintinMC te regalo un sub, no es el server pero es algo. Me lo guardo para cuando pierdas. {emote}" },
                { u: "tintinMC", t: "@sacksuu gracias. El server ya tiene 430 jugadores, ese es mi regalo, no te preocupes por el pelo todavía." }
            ]
        },
        {
            id: "D5", lines: [
                { u: "lukitaselglorp", t: "Chicos, la despedida de soltero es en noviembre, en Bahía Blanca. Jime ya eligió el lugar {emote}" },
                { u: "ferldz", t: "@lukitaselglorp pueden quedarse en mi depto de La Plata si bajan a verme, tiene dos camas y una gata." },
                { u: "matiaz0800", t: "@lukitaselglorp @ferldz yo pongo las milanesas el jueves, las hago yo. La gata que se busque las suyas. {combo}" },
                { u: "mearzys", t: "@lukitaselglorp no llego en noviembre, tengo guardias de 24 horas esa semana. Mándenme audios de todo." },
                { u: "lukitaselglorp", t: "@mearzys tranqui, te guardo una milanesa y te mando audios. Jime dice que sí a todo. {emote}" },
                { u: "matiaz0800", t: "@mearzys dale, la milanesa va con tu nombre. Si cambia la guardia avisá, no seas loca. {combo}" }
            ]
        },
        {
            id: "D6", lines: [
                { u: "noah4eva", t: "Me quedan 20 días para Madrid. Mi último turno de 3am del stream es el viernes, lloro en silencio. {emote}" },
                { u: "tomasinfr", t: "@noah4eva qué vas a extrañar más, el mate o las 3 de la mañana con el chat?" },
                { u: "noah4eva", t: "@tomasinfr el mate de mi vieja, y sí, las 3 de la mañana con este chat. Re loco. {combo}" },
                { u: "Swagginhaze28", t: "@noah4eva qué tal es Madrid? Es como Buenos Aires pero con más frío? Perdón si es básico jaja" },
                { u: "noah4eva", t: "@Swagginhaze28 tiene algo de Buenos Aires pero más tranquilo, y se cena tarde. Frío en invierno, eso sí. {emote}" },
                { u: "tomasinfr", t: "@noah4eva mandame audio cuando llegues y te hago un stream de cuatro horas para despedirte." }
            ]
        },
        {
            id: "E1", lines: [
                { u: "Yuuzito", t: "{channel} clutch de otro planeta, el chat explotó {emote}" },
                { u: "aywidbi", t: "@Yuuzito Brutal" },
                { u: "sillazul", t: "@aywidbi fue suerte, pura suerte, no le den tanto crédito a {channel} {combo}" },
                { u: "MONKIWI", t: "@sillazul la suerte no existe, {channel} tiene la mano. Yo ya abrí el malbec para celebrar" },
                { u: "sillazul", t: "@MONKIWI ese malbec no existe, ya lo sabemos todos {emote}" },
                { u: "Yuuzito", t: "@sillazul dale, abrí vos la tuya a ver si existe jaja" }
            ]
        },
        {
            id: "E2", lines: [
                { u: "sacksuu", t: "Perdimos en el último segundo, en serio {channel}?? {emote}" },
                { u: "mearzys", t: "@sacksuu vengo de 24 horas de guardia y me puse a llorar, no es joda" },
                { u: "matiaz0800", t: "@mearzys te mando milanesas 🍗🍗🍗 aunque sea por chat, comé algo" },
                { u: "Fqkeeh", t: "@mearzys la próxima stream lo arreglamos, prometido. Hoy el reloj nos jugó en contra {combo}" },
                { u: "mearzys", t: "@Fqkeeh prometido? Porque si no me vuelvo al office a llorar otra vez {emote}" },
                { u: "matiaz0800", t: "@Fqkeeh jueves de milanesas y revancha, anotado" }
            ]
        },
        {
            id: "E3", lines: [
                { u: "Swagginhaze28", t: "QUÉ PASÓ?? Llegó un raid de 800 personas desde otro canal {emote}" },
                { u: "Agu_sanhueza", t: "@Swagginhaze28 un raid es cuando otro canal te manda a toda su gente de regalo, invasión amistosa" },
                { u: "Swagginhaze28", t: "@Agu_sanhueza y eso es bueno? Es lo mismo que el hype train?" },
                { u: "Agu_sanhueza", t: "@Swagginhaze28 bueno, mientras no nos coma el chat. Tango ladra de fondo como si entendiera el raid" },
                { u: "jmica", t: "@Swagginhaze28 leé las reglas antes de spamear emotes, que ahora somos 800 más {combo}" },
                { u: "Swagginhaze28", t: "@jmica ok jefe, primero el raid y después el hype train jaja {emote}" }
            ]
        },
        {
            id: "E4", lines: [
                { u: "marttpeepo", t: "Mañana tengo entrevista en un depósito de Rosario, ojalá salga {emote}" },
                { u: "lukitaselglorp", t: "@marttpeepo mucha suerte! Mañana me avisás cómo fue, te banco" },
                { u: "sillazul", t: "@marttpeepo Central te desea suerte, pero que no vayas con la rojinegra puesta jaja {combo}" },
                { u: "marttpeepo", t: "@sillazul Cata me hizo mate para la entrevista, dice que con mate no falla nadie" },
                { u: "sillazul", t: "@marttpeepo con mate o sin mate, el clásico nunca se olvida. Igual, mucha suerte posta {emote}" },
                { u: "aywidbi", t: "@marttpeepo suerte. Y decile a Cata que el mate es el secreto" }
            ]
        },
        {
            id: "E5", lines: [
                { u: "pachudani", t: "Tres muertes seguidas y encima el anuncio me cortó en el peor momento {emote}" },
                { u: "ferldz", t: "@pachudani la culpa es de Doña Rosa, me pisó el teclado justo cuando salté" },
                { u: "tomasinfr", t: "@ferldz mi gato sin nombre lo hubiera hecho mejor, ni mira la pantalla {combo}" },
                { u: "pachudani", t: "@ferldz no, el problema son los anuncios, cortan justo cuando tenés que reaccionar" },
                { u: "ferldz", t: "@pachudani Doña Rosa estaba durmiendo sobre el teclado, admitilo {emote}" },
                { u: "tomasinfr", t: "@ferldz dale, pero igual me gana. Alguien me dice cómo se llama el gato?" }
            ]
        },
        {
            id: "E6", lines: [
                { u: "sacksuu", t: "Propongo Mario Kart, lo juego en la Switch y lo gano seguro {emote}" },
                { u: "tintinMC", t: "@sacksuu ni en pedo, lo que vale es Minecraft, el server va en 470" },
                { u: "MONKIWI", t: "@tintinMC ojo, si llega a 500 sacksuu se corta el pelo. Yo voto Stardew Valley, tranqui" },
                { u: "Yuuzito", t: "@MONKIWI nada de Stardew, quiero un juego de autos, que lo digo como fan de la carrera {combo}" },
                { u: "chungkingexpress", t: "@Yuuzito y si hacemos noche de cine? Wong Kar-wai y nadie discute más" },
                { u: "noah4eva", t: "@chungkingexpress la peli me encanta pero con la diferencia de hora con Madrid, para mí ya es madrugada {emote}" },
                { u: "MONKIWI", t: "@noah4eva entonces: Minecraft el sábado y la peli otro día, así no te perdés nada" },
                { u: "tintinMC", t: "@MONKIWI dale, pero el server tiene que llegar a 500 primero {emote}" }
            ]
        },
        {
            id: "F1", lines: [
                { u: "lukitaselglorp", t: "Ya tenemos fecha: 14 de marzo en Bahía Blanca. Jime quiere algo chiquito, yo quiero un asado para 300. {emote}" },
                { u: "noah4eva", t: "@lukitaselglorp Felicitaciones, bro. Desde Córdoba te armo una playlist en español, la termino a las 3 de la mañana." },
                { u: "lukitaselglorp", t: "@noah4eva Jime pide cuarenta personas como máximo, así que la playlist tiene que entrar en una sola tanda de fernet. {combo}" },
                { u: "chungkingexpress", t: "@lukitaselglorp Para el primer baile: In the Mood for Love. Es lenta, triste y el vestido es lo mejor del mundo." },
                { u: "lukitaselglorp", t: "@chungkingexpress Jime la vio tres veces y lloró las tres. Va a ser un desastre emocional, dale. {emote}" },
                { u: "noah4eva", t: "@lukitaselglorp Te la mando desde Madrid si llego a tiempo con la mudanza en 20 días. Caetano va al final. {combo}" },
                { u: "chungkingexpress", t: "@noah4eva Y yo pago en la boda el café que le debo a Yuuzito desde marzo, lo juro. Vos traé el tango." }
            ]
        },
        {
            id: "F2", lines: [
                { u: "MONKIWI", t: "Chat, el malbec existe. Mañana lo fotografío con la etiqueta y no quiero escuchar más que es un mito. {emote}" },
                { u: "ferldz", t: "@MONKIWI Doña Rosa lo tiró del estante anoche. Te queda la mancha en el piso, esa es tu foto." },
                { u: "Swagginhaze28", t: "@MONKIWI es vino o jugo? Porque si es jugo, la mancha es de jugo y ahí sí te creo {emote}" },
                { u: "MONKIWI", t: "@Swagginhaze28 Es malbec de Mendoza, tinto. El jugo lo toma ferldz cuando no le queda vino." },
                { u: "ferldz", t: "@MONKIWI Jajaja, bueno, la mancha huele a bodega igual. Ahí tenés tu prueba de cata. {combo}" },
                { u: "Swagginhaze28", t: "@ferldz entonces la foto es del piso? Qué tristeza, pero la bancamos." },
                { u: "MONKIWI", t: "@ferldz Lo sabía. Mañana la prueba es la mancha, la fotografío como en las bodegas. Igual nadie me cree. {emote}" }
            ]
        },
        {
            id: "F3", lines: [
                { u: "aywidbi", t: "Volví. Tres semanas de turno en Vaca Muerta y ahora dos de descanso. Hola a todos. {emote}" },
                { u: "sillazul", t: "@aywidbi Bienvenido de vuelta! Gracias por el sub, y el café que te debo lo pago el viernes. {combo}" },
                { u: "pachudani", t: "@sillazul Yo también quiero un café, eh, que con el precio del sub ya no me alcanza ni para el mate. {combo}" },
                { u: "sillazul", t: "@pachudani Dale, la semana que viene. Pero dejá de quejarte del sub, que sos founder y ya lo pagaste." },
                { u: "pachudani", t: "@aywidbi Bienvenido, posta. El chat estaba más callado sin vos. Ahora a aguantar el turno de noche. {emote}" }
            ]
        },
        {
            id: "F4", lines: [
                { u: "tomasinfr", t: "Chat, mi gato sigue sin nombre y ya me preguntan todos. Propuestas? {emote}" },
                { u: "matiaz0800", t: "@tomasinfr Milanesa. Un gato con nombre de milanesa se come lo que le den, ideal para el depto." },
                { u: "ferldz", t: "@matiaz0800 Ni loco, Doña Rosa se ofende. Ella es la única reina del depto, no hay lugar para otra gata." },
                { u: "matiaz0800", t: "@ferldz Doña Rosa pisa el teclado, no tiene voto. Yo digo Lobo, por Gimnasia, y lo discutimos después. {emote}" },
                { u: "ferldz", t: "@tomasinfr Agu_sanhueza propone Tango, dice que su perro lo reclama. Eso no vale, pero lo pienso." },
                { u: "tomasinfr", t: "@ferldz @matiaz0800 Tango suena bien. Decide el gato, que duerme arriba del teclado. {combo}" }
            ]
        },
        {
            id: "F5", lines: [
                { u: "mearzys", t: "Estoy en el office, guardia de 24. Mi mamá quiere saber si como, alguien me manda un audio que diga que sí? {emote}" },
                { u: "Fqkeeh", t: "@mearzys Comé algo aunque sean galletitas. Descansá cuando puedas, el chat no se va a ningún lado." },
                { u: "jmica", t: "@mearzys Leé las reglas: primero comer, después mirar el stream. Y dormí un rato, el Decano no se va a ir." },
                { u: "mearzys", t: "@jmica Ya comí una galleta de agua, mamá lo sabe, y ahora te mando el audio así no me creés. {emote}" },
                { u: "Fqkeeh", t: "@mearzys matiaz0800 dice que cuando salgas te manda una milanesa por chat, así que aguantá. {combo}" }
            ]
        },
        {
            id: "F6", lines: [
                { u: "ferldz", t: "Se cortó la luz en La Plata, en el depto de matiaz0800 también. Y el stream se traba cada dos minutos. {emote}" },
                { u: "Agu_sanhueza", t: "@ferldz Acá en Córdoba no llueve pero tengo un sueño de mil. Tango se comió otro cable, así que me quedo con el celu." },
                { u: "Yuuzito", t: "@Agu_sanhueza Acá en Buenos Aires también llueve, y con este frío no hay cumbia que me saque el abrigo. {combo}" },
                { u: "ferldz", t: "@Yuuzito Y encima la cumbia prometida sigue pendiente. Con frío, bailá ahora que nadie te mira." },
                { u: "Yuuzito", t: "@ferldz No me tientes, con este frío lo único que bailo es el mate. La promesa queda en pausa. {emote}" },
                { u: "Agu_sanhueza", t: "@Yuuzito Hace meses que lo prometiste y el chat no se olvida. Con lluvia no hay excusa, posta. {combo}" },
                { u: "ferldz", t: "Se va la luz otra vez. Me quedo con el celu, si vuelvo me acuerdo de bailar. {emote}" }
            ]
        },
        {
            id: "R1", lines: [
                { u: "Agu_sanhueza", t: "che Yuuzito arrancaste con todo hoy" },
                { u: "sacksuu", t: "posta, lleva 20 min y ya van 3 muertes jajaja {emote}" },
                { u: "Yuuzito", t: "@sacksuu bancá que la próxima la rompo" },
                { u: "mearzys", t: "@Yuuzito nooo esa fue re mala jugada" }
            ]
        },
        {
            id: "R2", lines: [
                { u: "tintinMC", t: "alguien sabe si el lunes hay que ir presencial o es remoto?" },
                { u: "aywidbi", t: "@tintinMC creo que es híbrido, preguntale a jmica" },
                { u: "jmica", t: "@aywidbi es híbrido sí, dos días en oficina {emote}" },
                { u: "chungkingexpress", t: "@jmica y la guita del viático cómo va?" },
                { u: "ferldz", t: "@chungkingexpress jajaja no me hables de guita que estoy en cero {combo}" }
            ]
        },
        {
            id: "R3", lines: [
                { u: "MONKIWI", t: "alguien pidió sushi o qué" },
                { u: "noah4eva", t: "@MONKIWI yo pedí completo con palta, posta {emote}" },
                { u: "pachudani", t: "@noah4eva ustedes siempre piden lo mismo kkkk" },
                { u: "Swagginhaze28", t: "@pachudani kkkkk ya es tradición, no me jodas" },
                { u: "sillazul", t: "@Swagginhaze28 bancá que yo lo pedí sin salsa jajaja" }
            ]
        },
        {
            id: "R4", lines: [
                { u: "lukitaselglorp", t: "se cayó el server o soy yo" },
                { u: "tomasinfr", t: "@lukitaselglorp no, va bien, tu ping está ok {combo}" },
                { u: "matiaz0800", t: "@tomasinfr che el mío se quedó en 900ms, no es joda" },
                { u: "Fqkeeh", t: "@matiaz0800 reiniciá el router y listo {emote}" }
            ]
        },
        {
            id: "R5", lines: [
                { u: "marttpeepo", t: "cambiaron la música y quedó horrible jajaja" },
                { u: "mearzys", t: "@marttpeepo a mí me gustó, el beat es re bueno" },
                { u: "sacksuu", t: "@mearzys siempre defendés lo mismo kkkk {emote}" },
                { u: "Agu_sanhueza", t: "@sacksuu y vos lo mismo con el mate, no?" },
                { u: "Yuuzito", t: "@Agu_sanhueza ya la cambio, tranqui, bancá {combo}" }
            ]
        },
        {
            id: "M1", lines: [
                { u: "Agu_sanhueza", t: "nooo no no, qué fue ese ruido?? me cagué" },
                { u: "Yuuzito", t: "jajaja tranqui, es el enemigo que se ríe en el pasillo" },
                { u: "mearzys", t: "@Yuuzito yo no vi nada y el corazón me explotó {emote}" },
                { u: "sacksuu", t: "@mearzys bancá que todavía no apareció, mirá la esquina" },
                { u: "Yuuzito", t: "@sacksuu ahí viene, ahí viene, no miren el chat" }
            ]
        },
        {
            id: "M2", lines: [
                { u: "tomasinfr", t: "faltan dos puntos y yo ya tengo las manos heladas" },
                { u: "Fqkeeh", t: "tranqui, ellos tienen menos aire que nosotros" },
                { u: "ferldz", t: "@Fqkeeh no me hagas esto, si perdemos el último punto me desinstalo el juego" },
                { u: "Yuuzito", t: "último punto, nadie se mueva que lo tengo {combo}" },
                { u: "MONKIWI", t: "@Yuuzito juro que el chat completo dejó de respirar" }
            ]
        },
        {
            id: "M3", lines: [
                { u: "pachudani", t: "se trabó el stream??" },
                { u: "lukitaselglorp", t: "nooo se cortó justo en el clutch, qué horror" },
                { u: "chungkingexpress", t: "@lukitaselglorp tengo miedo que se haya caído el internet del Yuuzito" },
                { u: "aywidbi", t: "@chungkingexpress reinicia el router Yuuzito pls, en serio" },
                { u: "sillazul", t: "@aywidbi ya volvió, ya volvió, qué susto {emote}" }
            ]
        },
        {
            id: "M4", lines: [
                { u: "matiaz0800", t: "no miro, no miro, avisenme cuando pase el susto" },
                { u: "jmica", t: "@matiaz0800 ya pasó, podés mirar tranqui" },
                { u: "marttpeepo", t: "@jmica mentira, tapé una oreja y la otra la dejé escuchando {emote}" },
                { u: "tintinMC", t: "@marttpeepo jajaja yo miro por el costado de los dedos, posta" },
                { u: "Yuuzito", t: "@tintinMC te aviso cuando haga ruido, prometido" }
            ]
        },
        {
            id: "M5", lines: [
                { u: "ferldz", t: "escuché un ruido en la cocina a las 3am mientras miraba, no me digan nada" },
                { u: "Agu_sanhueza", t: "@ferldz jajaja fue el gato o el fantasma del Yuuzito {emote}" },
                { u: "pachudani", t: "@Agu_sanhueza no me reí, prendí todas las luces de la casa" },
                { u: "sacksuu", t: "@pachudani a mí también se me cortó la luz, qué miedo" },
                { u: "Fqkeeh", t: "@sacksuu tranqui, seguro fue el gato" }
            ]
        },
        {
            id: "T1", lines: [
                { u: "Yuuzito", t: "perdimos otra vez, no sé ni qué decir la verdad" },
                { u: "sacksuu", t: "@Yuuzito bancá, se nos fue en el último round, pasa" },
                { u: "Yuuzito", t: "es que le puse todo y no alcanzó, me duele re" },
                { u: "tintinMC", t: "@Yuuzito se te nota que lo querías ganar, eso ya dice mucho" },
                { u: "Yuuzito", t: "gracias che, de verdad. mañana arrancamos de nuevo {emote}" }
            ]
        },
        {
            id: "T2", lines: [
                { u: "Fqkeeh", t: "me voy de viaje mañana, el stream de la semana que viene lo lleva jmica" },
                { u: "mearzys", t: "@Fqkeeh ya te vamos a extrañar posta" },
                { u: "ferldz", t: "che no digas eso, volvé con historias de allá" },
                { u: "Fqkeeh", t: "vuelvo en dos semanas, no es para siempre" },
                { u: "MONKIWI", t: "@Fqkeeh cuidate y mandá fotos del viaje {emote}" },
                { u: "chungkingexpress", t: "el chat se va a sentir raro sin vos" }
            ]
        },
        {
            id: "T3", lines: [
                { u: "pachudani", t: "se me cayó el celular al agua hoy, perdí todas las fotos" },
                { u: "noah4eva", t: "uf @pachudani eso duele, tenías backup?" },
                { u: "pachudani", t: "algunas nomás, las de mi viejo no las tengo" },
                { u: "Swagginhaze28", t: "@pachudani lo siento mucho, las fotos pesan más que el aparato" },
                { u: "pachudani", t: "gracias, hablarlo ya me saca un peso {emote}" }
            ]
        },
        {
            id: "T4", lines: [
                { u: "sillazul", t: "hoy se nos fue el gato de mi vieja, ando re triste" },
                { u: "jmica", t: "@sillazul lo siento mucho, ese bicho era parte de la casa" },
                { u: "sillazul", t: "sí, dormía encima mío todas las noches" },
                { u: "lukitaselglorp", t: "@sillazul abrazo grande, tomate el tiempo que necesites" },
                { u: "sillazul", t: "gracias, ahora prefiero hablar de cualquier otra cosa" }
            ]
        },
        {
            id: "T5", lines: [
                { u: "matiaz0800", t: "acordate cuando éramos como 20 en el chat, extraño eso" },
                { u: "marttpeepo", t: "@matiaz0800 éramos menos pero se sentía más cercano" },
                { u: "tomasinfr", t: "@marttpeepo el primer stream que vi era con 4 personas, lloré de risa" },
                { u: "aywidbi", t: "@tomasinfr jajaja yo también estaba ahí {emote}" },
                { u: "Yuuzito", t: "siempre digo que los que vinieron desde el principio son los que más valen" }
            ]
        },
        {
            id: "F1_2", lines: [
                { u: "Agu_sanhueza", t: "me salió el laburo!!! entré a la entrevista el martes y hoy me llamaron {emote}" },
                { u: "ferldz", t: "@Agu_sanhueza QUEEEE bancá, te lo merecías che" },
                { u: "Agu_sanhueza", t: "@ferldz gracias gordo, todavía no lo caigo jajaja" },
                { u: "MONKIWI", t: "@Agu_sanhueza posta, se nota que te preparaste un montón" },
                { u: "Agu_sanhueza", t: "tengo que avisarle a mi vieja, va a llorar {combo}" }
            ]
        },
        {
            id: "F2_2", lines: [
                { u: "noah4eva", t: "chicos le pedí matrimonio a mi pareja en la playa, dijo que sí" },
                { u: "pachudani", t: "@noah4eva NOOO cómo que sí, felicitaciones wena!!" },
                { u: "sillazul", t: "@noah4eva la foto quedó brígida, los felicito de corazón {combo}" },
                { u: "noah4eva", t: "@sillazul gracias, todavía no me creo que me haya dicho que sí" },
                { u: "Swagginhaze28", t: "@noah4eva ya sabés lo que viene, la despedida de soltero jaja {emote}" }
            ]
        },
        {
            id: "F3_2", lines: [
                { u: "tintinMC", t: "llegamos a 500 subs?? mirá el contador" },
                { u: "aywidbi", t: "@tintinMC sí, Yuuzito va a llorar en vivo" },
                { u: "Yuuzito", t: "@aywidbi no lloro, pero casi. gracias de verdad chiquillos {emote}" },
                { u: "sacksuu", t: "esta comunidad es lo más bacán de kick, en serio" },
                { u: "chungkingexpress", t: "esto merece un hype train, ¿quién se suma?" },
                { u: "Yuuzito", t: "@chungkingexpress bancá, vamos a 1000 posta" }
            ]
        },
        {
            id: "F4_2", lines: [
                { u: "lukitaselglorp", t: "es mi primera vez en el chat, hola a todos" },
                { u: "jmica", t: "@lukitaselglorp bienvenido che, pasá nomás, acá no mordemos {emote}" },
                { u: "lukitaselglorp", t: "@jmica jaja gracias, me re sentí bienvenido" },
                { u: "MONKIWI", t: "@lukitaselglorp decí hola al chat y ya te sentís de la casa" },
                { u: "Fqkeeh", t: "@lukitaselglorp el que se queda a ver todo el stream es el mejor, bienvenido {combo}" }
            ]
        },
        {
            id: "F5_2", lines: [
                { u: "mearzys", t: "mi hermana tuvo a la beba hoy a las 4am, pesó 3.2 kilos" },
                { u: "sacksuu", t: "@mearzys FELICES!!! ¿cómo se llama?" },
                { u: "mearzys", t: "@sacksuu Rosario, se parece a mi tía, pobrecita jaja" },
                { u: "marttpeepo", t: "@mearzys abrazo enorme a toda la familia, mandá fotos cuando puedas {emote}" },
                { u: "mearzys", t: "@marttpeepo gracias, ya le mandé la foto a todo el grupo" },
                { u: "tomasinfr", t: "@mearzys que descanse la mami, y a vos también {combo}" }
            ]
        },
        {
            id: "G1", lines: [
                { u: "Agu_sanhueza", t: "el boss del mapa 3 me está matando hace 40 min, bancá" },
                { u: "mearzys", t: "@Agu_sanhueza yo llevo 12 muertes y ni le saqué la primera barra {emote}" },
                { u: "sacksuu", t: "che el patrón del segundo cambio de fase es re injusto" },
                { u: "Yuuzito", t: "@sacksuu hay que esquivar hacia la izquierda, no hacia atrás {emote}" },
                { u: "Agu_sanhueza", t: "@Yuuzito lo probé y me pegó igual jaja" }
            ]
        },
        {
            id: "G2", lines: [
                { u: "ferldz", t: "QUÉ FUE ESO, quedaban 2 segundos" },
                { u: "MONKIWI", t: "@ferldz no lo puedo creer, lo dio vuelta con 5% de vida {emote}" },
                { u: "pachudani", t: "el que dijo que el juego estaba perdido se la come" },
                { u: "tomasinfr", t: "@pachudani posta, tiré el mando al sillón jajaja {combo}" },
                { u: "Fqkeeh", t: "gg chat, sigamos que el próximo es más difícil" }
            ]
        },
        {
            id: "G3", lines: [
                { u: "Swagginhaze28", t: "Yuuzito le dio al botón de soltar el item en vez de usarlo jajaja" },
                { u: "noah4eva", t: "@Swagginhaze28 el que le puso nombre a los botones tiene algo contra él {emote}" },
                { u: "sillazul", t: "@noah4eva pasó como 3 veces esta semana, ya es tradición" },
                { u: "Yuuzito", t: "@sillazul no era eso, fue el dedo gordo que se me fue solo, bancá" },
                { u: "chungkingexpress", t: "por eso yo dejo el inventario siempre en la misma tecla {emote}" }
            ]
        },
        {
            id: "G4", lines: [
                { u: "lukitaselglorp", t: "salió el logro de terminar sin morir?? no lo puedo creer" },
                { u: "aywidbi", t: "@lukitaselglorp eso es un bug del juego, el contador nunca se resetea {emote}" },
                { u: "matiaz0800", t: "@aywidbi jaja no, el contador sí se reseteó, salió a la derecha en el último rato" },
                { u: "tintinMC", t: "@matiaz0800 el bug es que el personaje se queda trabado en la pared y el juego no lo ve {combo}" },
                { u: "jmica", t: "chicos, al que le pasó eso mandenlo al clip del día" }
            ]
        },
        {
            id: "G5", lines: [
                { u: "marttpeepo", t: "el speedrun se cayó en la última sala, un crash a dos pasos del final" },
                { u: "tomasinfr", t: "@marttpeepo justo ahí tenía el mejor tiempo de la semana {emote}" },
                { u: "mearzys", t: "@tomasinfr bancá, quedó empatado con el récord igual, no es poco" },
                { u: "Yuuzito", t: "@mearzys empatar el récord es mejor que nada, la próxima sale" },
                { u: "MONKIWI", t: "@Yuuzito la próxima la sala es la misma, es ahí no más {combo}" }
            ]
        },
        {
            id: "D1_2", lines: [
                { u: "sacksuu", t: "@Yuuzito si perdías el duelo hoy te ponías el gorro de Pachu en cámara, eh" },
                { u: "Yuuzito", t: "@sacksuu yo no dije eso, lo inventaste vos {emote}" },
                { u: "sacksuu", t: "@Yuuzito está en el VOD a las 2:14, bancá que lo busco" },
                { u: "tintinMC", t: "jajaja @sacksuu el VOD marca 2:41, rendite che" },
                { u: "Yuuzito", t: "bueno, mañana lo cumplo pero que conste que fue sin ganas" }
            ]
        },
        {
            id: "D2_2", lines: [
                { u: "ferldz", t: "¿alguien sabe qué pasó con el pollo de la semana pasada? sigue vivo en el overlay" },
                { u: "MONKIWI", t: "@ferldz el pollo se fue a vivir al Discord, no hay que preocuparse" },
                { u: "ferldz", t: "@MONKIWI no me digas eso que hace dos semanas que lo estoy esperando" },
                { u: "noah4eva", t: "@ferldz bancá, el pollo vuelve el viernes posta {emote}" },
                { u: "MONKIWI", t: "@noah4eva ya dijiste lo mismo la semana pasada jajaja" }
            ]
        },
        {
            id: "D3_2", lines: [
                { u: "jmica", t: "Nueva regla: no links sin permiso de mod. Lo aviso una sola vez." },
                { u: "lukitaselglorp", t: "@jmica y los clips de Kick también cuentan como link?" },
                { u: "jmica", t: "@lukitaselglorp los clips de Kick sí van, los de otros sitios no. Bancá el bot." },
                { u: "Fqkeeh", t: "@lukitaselglorp el filtro ya lo tenemos, si lo ves avisá {emote}" },
                { u: "matiaz0800", t: "posta, ayer me borró el mensaje y ni me enteré jaja" }
            ]
        },
        {
            id: "D4_2", lines: [
                { u: "Swagginhaze28", t: "GGGGGGGGGG" },
                { u: "aywidbi", t: "@Swagginhaze28 para de mandar lo mismo, nos rompiste el chat" },
                { u: "Swagginhaze28", t: "@aywidbi es que el emote me vuelve loco jajaja" },
                { u: "sillazul", t: "@Swagginhaze28 metele una pausa che, usá el modo lento" },
                { u: "jmica", t: "@Swagginhaze28 te doy 2 minutos de timeout, a respirar {emote}" }
            ]
        },
        {
            id: "D5_2", lines: [
                { u: "chungkingexpress", t: "@tomasinfr sigo enojado por lo que dijiste en el stream del martes" },
                { u: "tomasinfr", t: "@chungkingexpress fue un chiste mal hecho, perdón de verdad" },
                { u: "chungkingexpress", t: "bancá, no sé si te creo todavía {emote}" },
                { u: "tomasinfr", t: "@chungkingexpress el sábado te invito al 1v1 y lo arreglamos, posta" },
                { u: "chungkingexpress", t: "dale, pero el que pierde paga la ronda de mates" }
            ]
        },
        {
            id: "X1", lines: [
                { u: "tintinMC", t: "@Yuuzito el audio está re bajo, no se escucha nada" },
                { u: "Yuuzito", t: "bancá que lo subo, ¿ahora sí?" },
                { u: "sacksuu", t: "@Yuuzito ahora se escucha, pero hay eco como en un baño" },
                { u: "Yuuzito", t: "posta, el micro está cerca de la pared, lo muevo {emote}" },
                { u: "jmica", t: "@Yuuzito listo, ya se oye bien" }
            ]
        },
        {
            id: "X2", lines: [
                { u: "matiaz0800", t: "la cámara se ve re borrosa @Yuuzito" },
                { u: "Yuuzito", t: "ufa, debe ser la luz, ya la acomodo" },
                { u: "ferldz", t: "@Yuuzito se ve mejor, pero sigue medio pixelado {combo}" },
                { u: "MONKIWI", t: "@ferldz es el bitrate, seguro la subida está floja" },
                { u: "Fqkeeh", t: "@MONKIWI yo lo veo bien desde acá, debe ser tu red" }
            ]
        },
        {
            id: "X3", lines: [
                { u: "pachudani", t: "se traba todo el stream, el video se congela" },
                { u: "noah4eva", t: "@pachudani a mí también, cada diez segundos más o menos" },
                { u: "Yuuzito", t: "uh, ya cierro el navegador que consume un montón de CPU" },
                { u: "aywidbi", t: "@Yuuzito posta, se estaba trabando un montón, ahora anda {emote}" },
                { u: "noah4eva", t: "@aywidbi se ve todo sin cortes, gracias" }
            ]
        },
        {
            id: "X4", lines: [
                { u: "lukitaselglorp", t: "@Yuuzito se cortó la imagen, pantalla negra" },
                { u: "Yuuzito", t: "se me cortó la luz un segundo, ya volví" },
                { u: "sillazul", t: "jajaja se murió la luz en medio del directo" },
                { u: "chungkingexpress", t: "@sillazul no es joda, pasa seguido en mi barrio {combo}" },
                { u: "tomasinfr", t: "@Yuuzito avisá si se cae el stream así no nos quedamos mirando negro" }
            ]
        },
        {
            id: "X5", lines: [
                { u: "marttpeepo", t: "@Yuuzito se viene un anuncio justo ahora?? qué mal timing" },
                { u: "Yuuzito", t: "jaja sí, bancá que pasa en un rato" },
                { u: "mearzys", t: "@Yuuzito ¿hay delay en el stream? el chat va re atrasado" },
                { u: "Yuuzito", t: "sí, como quince segundos, por eso tardo en leer {emote}" },
                { u: "Fqkeeh", t: "@mearzys es el delay de la plataforma, es normal" }
            ]
        },
        {
            id: "V1", lines: [
                { u: "Agu_sanhueza", t: "el 60 llegó 40 min tarde otra vez, qué garca" },
                { u: "sacksuu", t: "@Agu_sanhueza el mío también, ya ni miro los horarios {emote}" },
                { u: "Agu_sanhueza", t: "bancá, al menos hoy no llovió" },
                { u: "mearzys", t: "@Agu_sanhueza jaja che, eso ya es ganar" }
            ]
        },
        {
            id: "V2", lines: [
                { u: "tintinMC", t: "alguien sabe si el mate se puede tomar con leche? me lo recomendó mi vieja" },
                { u: "Fqkeeh", t: "@tintinMC no no no, eso es pecado {emote}" },
                { u: "marttpeepo", t: "@Fqkeeh jaja la vieja de tintin no perdona" },
                { u: "tintinMC", t: "@marttpeepo a mí me gustó, qué le voy a hacer" },
                { u: "aywidbi", t: "@tintinMC probá con mate cocido, es más amigable" }
            ]
        },
        {
            id: "V3", lines: [
                { u: "chungkingexpress", t: "mi gato sigue sin nombre, ya van 3 semanas" },
                { u: "pachudani", t: "@chungkingexpress ponele Fideo, es re gordo {emote}" },
                { u: "chungkingexpress", t: "@pachudani no es gordo, es esponjoso" },
                { u: "noah4eva", t: "@chungkingexpress llamalo Nafta y listo" },
                { u: "chungkingexpress", t: "@noah4eva Nafta suena bien, lo pienso" }
            ]
        },
        {
            id: "V4", lines: [
                { u: "ferldz", t: "estoy en medio de una mudanza, las cajas me tienen harto" },
                { u: "lukitaselglorp", t: "@ferldz la mía tiene más cajas que muebles, ni te cuento" },
                { u: "MONKIWI", t: "@ferldz mi vieja me llamó tres veces mientras cargaba el sillón {emote}" },
                { u: "ferldz", t: "@MONKIWI jaja tu vieja siempre llama en el peor momento" },
                { u: "lukitaselglorp", t: "@ferldz bancá, después te traigo unas birras" }
            ]
        },
        {
            id: "V5", lines: [
                { u: "sillazul", t: "son las 3am y sigo acá mirando, qué vicio" },
                { u: "jmica", t: "@sillazul yo estoy desde la oficina en el break, shh" },
                { u: "tomasinfr", t: "@jmica en la oficina mirando el stream? respeto" },
                { u: "Yuuzito", t: "@tomasinfr jaja gracias por aguantar {emote}" },
                { u: "sillazul", t: "@Yuuzito posta que te aguantamos, andá a dormir un rato" }
            ]
        },
        {
            id: "H1", lines: [
                { u: "MONKIWI", t: "RAID!!! llegamos todos de golpe, bancá que somos un montón" },
                { u: "Yuuzito", t: "@MONKIWI bienvenidos carajo, pónganse cómodos {emote}" },
                { u: "noah4eva", t: "@Yuuzito recién llegamos, qué onda el stream?" },
                { u: "pachudani", t: "@noah4eva está el hype train arriba, no te lo podés perder" },
                { u: "Swagginhaze28", t: "@pachudani re buena la bienvenida, los del raid digan hola" }
            ]
        },
        {
            id: "H2", lines: [
                { u: "tomasinfr", t: "alguien acaba de regalar 20 subs???" },
                { u: "aywidbi", t: "@tomasinfr jajaja fue un anónimo, bancá" },
                { u: "sillazul", t: "@aywidbi el capo que regaló es re generoso {combo}" },
                { u: "matiaz0800", t: "y ahora el chat se llena de gracias pa todos" },
                { u: "jmica", t: "gracias al anónimo, el chat está en llamas" }
            ]
        },
        {
            id: "H3", lines: [
                { u: "chungkingexpress", t: "HYPE TRAIN, subí al tren ya!!" },
                { u: "lukitaselglorp", t: "@chungkingexpress voy, cuánto falta pal nivel 2?" },
                { u: "ferldz", t: "@lukitaselglorp faltan como 300 bits, a darle che" },
                { u: "marttpeepo", t: "@ferldz ya le metí, posta que el nivel 2 lo sacamos {emote}" },
                { u: "mearzys", t: "@marttpeepo si llegamos sale el emote nuevo, no paren" }
            ]
        },
        {
            id: "H4", lines: [
                { u: "sacksuu", t: "faltan 5 min pal sorteo, nadie se me vaya" },
                { u: "tintinMC", t: "@sacksuu 5 minutos, me pongo la alarma otra vez" },
                { u: "Agu_sanhueza", t: "@tintinMC tranqui, ya tengo el café {emote}" },
                { u: "Fqkeeh", t: "3 minutos, a preparar el chat" },
                { u: "pachudani", t: "@Fqkeeh cuenta regresiva en el overlay??? {combo}" }
            ]
        },
        {
            id: "H5", lines: [
                { u: "noah4eva", t: "qué significa el mensaje del sistema que dice Mes 12?" },
                { u: "Swagginhaze28", t: "@noah4eva es que alguien subió de nivel de sub, mirá arriba" },
                { u: "jmica", t: "@Swagginhaze28 son 12 meses del Agu, bancá que lo festejamos" },
                { u: "Agu_sanhueza", t: "@jmica posta 12 meses, lo festejo {emote}" },
                { u: "marttpeepo", t: "@Agu_sanhueza felicitaciones capo, 12 meses no es joda" }
            ]
        },
        {
            id: "Z1", lines: [
                { u: "Agu_sanhueza", t: "buenas a todos, recién llego, ¿ya arrancó?" },
                { u: "Fqkeeh", t: "@Agu_sanhueza todavía no, bancá que se está conectando {emote}" },
                { u: "ferldz", t: "@Agu_sanhueza llegaste justo, estaba por ir a buscar algo para tomar" },
                { u: "Agu_sanhueza", t: "jaja no, quedate che, aunque sea un ratito" }
            ]
        },
        {
            id: "Z2", lines: [
                { u: "Yuuzito", t: "me voy al baño 2 min, aguanten" },
                { u: "mearzys", t: "dale, mientras tanto pongo un tema" },
                { u: "sacksuu", t: "@mearzys ponele algo tranqui, no el de ayer que me dolió la cabeza" },
                { u: "Yuuzito", t: "@sacksuu jaja, anotado. ya vuelvo {emote}" },
                { u: "tintinMC", t: "posta que pasó el tiempo y no volvió {combo}" }
            ]
        },
        {
            id: "Z3", lines: [
                { u: "marttpeepo", t: "cambió el juego? pensé que seguía con el otro" },
                { u: "matiaz0800", t: "@marttpeepo sí, cortó el de ayer y arrancó este, ahora sí que es laburo" },
                { u: "aywidbi", t: "este es re difícil, ojo che" },
                { u: "chungkingexpress", t: "@aywidbi jaja, nos vamos a reír un rato igual {emote}" },
                { u: "Yuuzito", t: "a bancar, vamos!" }
            ]
        },
        {
            id: "Z4", lines: [
                { u: "lukitaselglorp", t: "mañana hay directo? no me acuerdo" },
                { u: "Fqkeeh", t: "@lukitaselglorp sí, mañana a las 21 hs, avisen a los amigos" },
                { u: "noah4eva", t: "@Fqkeeh ya me puse la alarma, gracias" },
                { u: "pachudani", t: "@noah4eva yo también, no me pierdo ni uno {emote}" },
                { u: "MONKIWI", t: "posta, el de mañana prometía" }
            ]
        },
        {
            id: "Z5", lines: [
                { u: "Yuuzito", t: "bueno, ya nos estamos yendo. gracias por venir, de verdad" },
                { u: "Swagginhaze28", t: "gracias a vos Yuuzito, siempre la pasamos bien" },
                { u: "sillazul", t: "@Swagginhaze28 el chat hoy estuvo buenísimo" },
                { u: "jmica", t: "nos vemos mañana, cuídense che {combo}" },
                { u: "tomasinfr", t: "@jmica nos vemos! no falten" }
            ]
        }
    ];

    // {emote} becomes an emote of the channel's 7TV pack, {channel} the channel name,
    // {user} another chatter of the test chat
    const TEMPLATE_LINES = [
        // Greetings
        'buenas buenas {emote}', 'wena wena chat', 'llegué tarde, qué me perdí?', 'holaaa {channel} {emote}',
        'primera vez por acá, saludos desde Valpo', 'saludos desde Concepción {emote}', 'buenas noches a todos menos a {user}',
        'volví del almuerzo, sigue el stream?', 'wena {user} {emote}', '@{channel} saludos desde Santiago {emote}',
        // Reactions
        '{emote}', '{emote}', 'GG', 'GG WP', 'JAJAJAJAJA', 'nooo casi {emote}', 'esa jugada estuvo limpia',
        'ese clip fue increíble jajaja {emote}', 'clipeen eso altiro', 'nooo por qué hiciste eso {emote}',
        'me muero JAJSJAJS', 'qué manera de jugar mal {emote}', 'insano lo que acaba de pasar', 'F en el chat',
        'F', 'W', 'L', 'era obvio que iba a pasar {emote}', 'ni yo lo hacía tan mal jajaja', 'aplausos {emote}',
        // Chatter
        'qué tal el stream hoy', 'el audio se escucha perfecto', 'vamos que se puede', 'recuerden seguir el canal',
        'jajaja el chat está on fire hoy', 'alguien más con lag o soy yo', 'se escucha bajito el juego',
        'a qué hora termina el stream?', 'mañana hay stream?', 'qué juego viene después?', 'pongan música po',
        '{user} cállate jajaja', '@{user} te dije que iba a perder', '{user} tiene razón', 'concuerdo con {user}',
        'yo apuesto a que gana {emote}', 'no se rindan chat', 'hidrátense chat {emote}', 'quién más mirando desde la pega',
        'mi mamá me está llamando pero no me pierdo esto', 'tengo que estudiar pero aquí estoy {emote}',
        'el mejor stream de Kick lejos', 'subanle al micro', 'la cámara se ve borrosa o soy yo?',
        'oye una consulta, el overlay se puede poner transparente en OBS? lo quiero encima del juego sin que tape nada',
        'cuánto llevas jugando esto?', 'pásate al otro mapa', 'ese personaje está roto', 'nerfeen eso porfa {emote}',
        // Subs and support
        'sub número 100 vamooo {emote}', 'gracias por el sub {user}', 'me suscribí recién {emote}',
        '5 meses de sub y sigo aquí {emote}', 'regalen subs chat', 'qué bueno el contenido, sigue así {emote}',
        'el mejor streamer de Chile', 'te banco desde el primer stream {emote}', 'lo dejo de fondo mientras trabajo',
        // Long ones, to test wrapping
        'oye chat alguien sabe cómo se pasa esta parte? llevo como tres días pegado y no hay caso, ya probé de todo {emote}',
        'el otro día vi el VOD completo y la parte donde se cayó el internet fue lo mejor del stream jajaja',
        'recomiendo que juegues el siguiente con el chat votando las decisiones, sería épico {emote}',
        // Argentine chat: rioplatense slang, cities and football, with emote combos
        'vamoooo {emote} ahí vamos',
        'jajaja no puede ser {combo}',
        'buenas tardes desde Córdoba {emote}',
        'saludos desde Rosario, qué onda el stream {emote}',
        '{user} mirá vos lo que hizo jajaja {emote}',
        'la rompiste {combo} tremendo',
        'bancá que ya llegó el mate {emote}',
        'mañana hay asado, quién viene? {emote}',
        'Boca o River, decí la verdad {emote}',
        're bien jugado, posta {combo}',
        'kkkkkk {emote}',
        '{channel} tenés que jugar eso otra vez',
        'Mar del Plata presente {emote}',
        'ni en pedo ganás con esa jugada {user} jajaja',
        'dale que vamos, tranqui {emote}',
        'cuánto tiempo más aguantás despierto? {emote}',
        'fernet y stream, lo mejor del día {combo}',
        'Tucumán acá, re loco el juego {emote}',
        'cagaste {user} jajajaja {combo}',
        'Neuquén saludando, el bondi llegó tarde pero llegué {emote}',
        'jajaja {emote} no lo puedo creer, qué golazo',
        'vamoooo {combo} ahí vamos che',
        '{user} la rompiste boludo {emote}',
        'Desde Córdoba siguiéndote, re bien el stream {emote}',
        'Saludos desde Rosario! {emote}',
        '{combo} posta que esto es tremendo',
        'Alguien me explica qué onda con ese juego? {emote}',
        'Mendoza presente {emote} tranqui que ya viene el mate',
        'kkkk {combo}',
        'Dale {channel} bancá que se da vuelta',
        'Qué onda el laburo de hoy, andá tranqui {emote}',
        'Ni en pedo lo que hizo {user} jajaja {emote}',
        'Bien ahí boludo, cagaste de risa {emote}',
        'Vamos Boca carajo, esto se gana {emote}',
        'Vamos Racing {emote} hoy se queda con todo',
        'Tucumán en vivo, mirá vos qué partido {emote}',
        'Sos un crack {channel}, seguí así {combo}',
        'Me faltó un mate para esto {emote}',
        'Hay asado el domingo? Dale que lo necesito {combo}',
        'Cuánta guita tiene que tener el que pone esa jugada {emote} jajaja',
        'jajaja no puedo con {user} hoy {emote}',
        'vamoooo {combo}',
        'Qué onda che, desde Córdoba acá mirando {emote}',
        'boludo esa jugada fue tremenda {combo}',
        'saludos desde Rosario, mate en mano {emote}',
        '¿Mañana hacés stream largo o cortás temprano?',
        'la rompiste {channel} {emote}',
        'dale que vamos {combo}',
        'Mirá vos, {user} con el fernet otra vez jajaja',
        'kkkkkk sos un capo {emote}',
        'bancá que todavía no terminó {combo}',
        're bien jugado, ni en pedo lo veía venir {emote}',
        'Desde Mendoza un abrazo grande para el chat {emote}',
        'posta que esto es lo mejor de la semana {combo}',
        'Hoy ganó Boca o nos vamos a tener que aguantar {emote} {user}',
        'tranqui, ahí vamos {emote}',
        '¿Cuándo hacés el asado con el chat? {emote}',
        'JAJAJAJA {user} no te la creo {combo}',
        'Qué quilombo ese último round {emote}',
        'Gracias por el stream {channel}, re buena onda {combo}',
        'Qué onda chicos, buenas desde Córdoba {emote}',
        'JAJAJA no puede ser {combo}',
        'vamoooo ahí vamos {combo}',
        'Mirá vos, re bien jugado {emote}',
        'Saludos desde Rosario, mate en mano {emote}',
        'Tranqui {user}, ni en pedo se te cae el bondi {emote}',
        'Posta que te querés ir a laburar a esta hora? {emote}',
        'kkkkkk {combo}',
        'Dale que hoy sí, vamo a ganarla {emote}',
        'Hola desde Mendoza, recién llego al stream {emote}',
        'Che {channel} cuándo hacés el asado? {emote}',
        'Bancá que me muero de risa {combo}',
        'Ni en pedo esperaba eso jajaja {emote}',
        'Vamo Boca carajo, esto es tremendo {combo}',
        'Quilombo total en el chat jajaja {emote}',
        'Qué buen fernet antes del partido {emote}',
        'Mirá que cagaste a {user} jajajaja {combo}',
        'Te re bancamos {channel}, sos un crack {emote}',
        'Saludos desde Tucumán, tremendo directo {combo}',
        'JAJAJA mirá vos lo que hizo {user} {emote}',
        'Qué onda gente, saludos desde Córdoba {emote}',
        'Re bien jugado, la rompiste {combo}',
        'Tranqui {user}, no pasa nada boludo {emote}',
        'Che {channel}, ¿mañana hay stream? {emote}',
        'Desde Rosario recién llego, ¿qué me perdí? {emote}',
        'Ni en pedo que ese remate entró jajaja {combo}',
        '¿Alguien me pasa el mate? Estoy re cansado {emote}',
        'Dale Boca, hoy se gana sí o sí {combo}',
        'Racing campeón, lo digo yo {emote}',
        'Cagaste a todos con esa jugada {combo}',
        'Mendoza presente, bancá el stream {emote}',
        'kkkk esto es un quilombo total {emote}',
        'Posta que te quedó tremendo eso {combo}',
        'Decí la verdad, ¿jugás con el control o con el teclado? {emote}',
        'Salta saludando a la mina de la cámara {emote}',
        'Me acabo de sumar, ¿cuánto dura el directo? {emote}',
        'Vamoooo San Lorenzo, hoy te toca {combo}',
        'Recién llegué del laburo, ¿se viene el asado? {emote}',
        'JAJAJA mirá vos cómo la rompiste {emote}',
        'bancá {user} que esto recién empieza {emote}',
        '¿de dónde sos vos? yo desde Rosario, saludos {emote}',
        'saludos desde Córdoba, re tranqui hoy el stream {emote}',
        '{combo} posta que jugaste re bien',
        'qué onda {channel} ¿cuándo sale el próximo directo? {emote}',
        'ni en pedo perdí con ese movimiento jajaja {emote}',
        'mirá vos, el fernet ya está en la mesa {emote}',
        '{user} no seas bobo que vos también pifiaste ayer {emote}',
        'dale que va Boca hoy {combo}',
        'River o Boca no sé, pero el chat está en llamas {emote}',
        'tremendo quilombo ese, cagaste jajaja {combo}',
        'kkkk {emote}',
        'el mate ya se enfrió por tu culpa {user} {emote}',
        '¿me explicás cómo hiciste eso? re crack {emote}',
        'Independiente siempre, pero hoy te banco igual {emote}',
        'llego desde Mar del Plata, no me pierdo nada {emote}',
        'Newell\'s presente desde Rosario, un abrazo {channel} {emote}',
        '{combo} qué golazo, ni te lo imaginabas',
        'vamoooo {emote} ahí vamos che',
        'mirá vos, re bien jugado {emote}',
        'buenas desde Córdoba, qué onda la noche {emote}',
        '{user} la rompiste otra vez {combo}',
        'kkkk cagaste {user} jajaja {emote}',
        'alguien me pasa el mate que hoy vengo con sed {emote}',
        'posta que este pibe juega re loco {combo}',
        'saludos desde Rosario, Central al palo hoy {emote}',
        'tranqui {user}, todavía no perdimos nada {emote}',
        '{channel} cuándo hacés el asado dale {emote}',
        'ni en pedo me pierdo este stream {emote}',
        'Boca o River? decime antes de que empiece {emote}',
        'bancá que se viene la jugada de la noche {combo}',
        're tremendo esto, no lo podía creer {emote}',
        'buenas tardes desde Mendoza, qué laburo fue hoy {emote}',
        'fernet con coca y dale que va {combo}',
        'jajaja, {user} dejá de hablar y mirá {emote}',
        'qué quilombo esa jugada, en serio {combo}',
        'tucumana presente, mandame un saludo {channel} {emote}',
        '{user} cagaste, la rompiste {emote}',
        'qué onda chat, saludos desde Córdoba {emote}',
        'mirá vos, re bien jugado {combo}',
        'bancá {user} que todavía no perdemos {emote}',
        'posta que sos el mejor del juego {combo}',
        'saludos desde Rosario, boludo, re tranqui {emote}',
        'KKKK no lo puedo creer {combo}',
        'alguien sabe si el stream sigue mañana? {emote}',
        'un asadito y a mirar el stream, dale {emote}',
        'fernet con coca y a gritar el gol {combo}',
        '{user} ni en pedo te creo eso jajaja {emote}',
        'vamos Boca carajo, esto es tremendo {emote}',
        'saludos desde Mendoza, recién llegué al chat {emote}',
        'decí la verdad {channel}, ¿lo tenías ensayado? {emote}',
        're loco lo que hiciste, andá a festejar {combo}',
        'tranqui, que el bondi todavía no pasó {emote}',
        'con el laburo de mañana y acá igual {emote}',
        '{combo} la guita no alcanza pero el stream sí',
        'JAJAJA mirá vos lo que hizo {user} {emote}',
        'ni en pedo que la rompiste así, re bien {combo}',
        'vamoooo boca carajo {emote}',
        'buenas desde Córdoba! qué onda el stream hoy {emote}',
        'saludos desde Rosario, recién llego del laburo {emote}',
        '{combo} tremendo golazo',
        'bancá {user} que no es para tanto jajaja {emote}',
        'che alguien sabe qué juego es este? {emote}',
        'cagaste {user} JAJAJAJA {combo}',
        'tranqui que ahí vamos, dale {emote}',
        'posta que sos un crack {channel} {combo}',
        'kkkk no puedo más {combo}',
        'mate listo, asado el domingo y vos acá {emote}',
        'fernet y stream, lo mejor de la semana {emote}',
        'Mar del Plata presente! {combo}',
        'River no nos deja otra vez, qué bajón {emote}',
        'Racing campeón y yo sin guita para la entrada jaja',
        'Salta en vivo, ¿cuándo arrancás la ronda de preguntas? {emote}',
        'dale {user} explicá la jugada otra vez, no entendí nada {combo}',
        'la mejor partida del año posta, ni en pedo me la pierdo {emote}',
        'vamoooo {emote} no lo puedo creer',
        'jajaja {combo} la rompiste che',
        'Mirá vos, qué jugada {emote}',
        '{user} tranqui que hoy sí gana Boca {emote}',
        'saludos desde Córdoba!! {emote}',
        'Saludos desde Rosario, mate en mano {emote}',
        'bancá {user}, no seas tan dramático jajaja {emote}',
        '¿Cuánto más vas a streamear hoy? {emote}',
        'kkkkk {emote}',
        'Hoy hay fernet y asado, qué onda {emote}',
        'Dale que vamos Racing carajo {combo}',
        '{user} sos el único que ve esto, boludo {emote}',
        'tremendo lo del último round {combo}',
        'Desde Mendoza con la guita lista para la sub {emote}',
        'ni en pedo me pierdo el stream de hoy {emote}',
        '{channel} ¿mañana streameás o descansás?',
        'Qué quilombo esa jugada jajaja {combo}',
        'Vamoooo Newell\'s, ahí vamos {emote}',
        'tranqui {user}, todos cometemos errores {emote}',
        '{channel} lleva 3 horas y yo sigo acá jajaja',
        'posta que esta jugada fue un golazo {emote}',
        'nooo {user} no te mueras ahora',
        'alguien me explica qué pasó en el último round',
        'recién llegué, qué me perdí? {combo}',
        'JAJAJAJA {emote}',
        '{user} cómo tenés tanta suerte che',
        'bancá Yuuzito que ya casi lo tenés',
        'esto ya es nivel leyenda, en serio {combo}',
        'me hiciste reír en el peor momento del día {emote}',
        '{channel} hoy viene con todo, se nota',
        'no puedo creer que haya fallado ese tiro',
        'che {user} vos sabías que iba a pasar eso?',
        'kkkkk el chat entero está en llamas {emote}',
        'esa cámara lenta fue una obra de arte',
        'va el primero que diga gg {combo}',
        'siempre se cae en el mejor momento, posta',
        'recién entro, ¿ya ganaste algo?',
        '{user} anda con el mouse más rápido que yo jajaja',
        'dale que se puede, nos vemos en el próximo round {emote}',
        'esto lo tenía que ver en vivo sí o sí',
        'qué buen laburo el de hoy, en serio',
        '{combo} me quedé mirando el ataque un rato',
        'no sé si reír o llorar con esa jugada',
        '{channel} tiene el mejor chat de la semana',
        'nooo no me hagas esto Yuuzito, casi me muero {emote}',
        'alguien que me diga que ya pasó el ruido porfa',
        'me quedé sin respirar cuando apareció eso {emote}',
        '{user} no mires el costado, que viene algo',
        'con el corazón a mil, no puedo seguir mirando {combo}',
        'jajaja no grité, grité un poquito nomás',
        'el silencio antes del jump scare es lo peor {emote}',
        'si perdemos este último punto me desinstalo el juego, posta',
        '{channel} bancá que falta poco, no te me caigas ahora {emote}',
        'se cortó la luz acá, después les cuento si sigo vivo',
        'el chat completo está en silencio, asustados nomás',
        'escuché un ruido en el pasillo y ya no quiero mirar más',
        'me tapé los ojos y abrí uno, así no vale',
        '{user} dejá de tirar spoilers del susto que tengo {emote}',
        'se trabó el video justo cuando iba a aparecer el enemigo, tremendo',
        'pasé de tener todo a estar con un solo corazón, qué tensión {combo}',
        'no me gusta el silencio de este mapa, algo se viene {combo}',
        'no sé si subo el volumen o lo bajo, me da miedo',
        'apagá la luz un toque Yuuzito, quiero sentir el miedo bien {emote}',
        'casi me da un paro al ver la sombra detrás de la puerta',
        'se cortó el stream y me quedé mirando la pantalla negra',
        '{user} vio lo mismo que yo o me estoy volviendo loco {combo}',
        'tranqui, es solo el juego, ¿no?',
        'la última ronda estuvo tan tensa que ahora tengo frío',
        '{user} ayuda, no quiero volver a mirar esa parte {emote}',
        'se nos fue el último bloque y el chat quedó en silencio, bancá {emote}',
        'perdimos y el chat entero se fue a dormir, igual fue épico',
        '{user} no te pongas así, el stream estuvo buenísimo',
        'uf, cuando se murió el personaje ya lo extrañé un poco',
        '{channel} se nos hace tarde, cuidate y descansá',
        'se le quebró la voz y yo ya estoy llorando un poquito {emote}',
        'ojalá el día que volvamos a estar todos juntos sea pronto',
        '{user} gracias por bancar hasta el final, de verdad',
        'el último stream de la noche siempre pesa un poquito',
        'me acuerdo del primer stream, éramos cuatro y aun así',
        'perdimos la racha, pero el chat sigue acá {combo}',
        'cuando dijiste que te ibas casi me caigo de la silla',
        'no sé si reír o llorar con esta derrota {emote}',
        '{user} dale tiempo, las cosas se acomodan solas',
        'se nota que le pusiste el alma a esa partida',
        'mandále un abrazo a {user} de mi parte, que hoy está mal',
        'despedirnos nunca me gustó, la verdad',
        '{channel} gracias por tanto, de verdad te vamos a extrañar',
        'sé que es mala noticia, mucha fuerza para vos',
        'ya tenía ganas de llorar cuando la voz se le cortó {emote}',
        'extraño las noches de veinte personas en el chat',
        '{user} cuidate mucho, acá seguimos esperando',
        'perder así duele, pero me gustó cómo lo tomaste',
        'silencio total en el chat después de ese mensaje',
        '{channel} volvé pronto, el stream no es lo mismo sin vos {combo}',
        'QUEEEE {channel} ganó el juego, ni lo puedo creer',
        'posta que {user} hizo el mejor clutch de la historia del canal {emote}',
        'felicitaciones a {user}, se lo merece todo',
        'bancá {channel}, esto recién empieza',
        '{user} ya no puede dejar de sonreír jajaja',
        'wena {user}!! felicitaciones, aguante',
        'sigan así que el chat está a full hoy',
        'miren el contador de subs, nos estamos acercando a la meta {combo}',
        'NO PUEDE SER, ¿dijo que ganó? {emote}',
        'Yuuzito se re emocionó, lo vi en el video',
        'gracias por el apoyo, de verdad chiquillos',
        '{user} recién llegó y ya lo estamos abrazando virtualmente',
        'el que no festeja es porque no está en el chat',
        'esto es lo que hace que valga la pena venir acá {combo}',
        'sos un crack {user}, cada día mejor',
        'por fin una buena noticia en el día, qué alegría',
        '{channel} nos acaba de dar el mejor momento de la semana {emote}',
        'jajajaja se viene la fiesta, que alguien traiga algo',
        'amo este chat, siempre hay buena onda',
        'alguien que le mande un abrazo grande a {user}',
        'racha de buenas noticias, seguimos festejando {emote}',
        'ni en el mejor sueño pensé que llegaríamos tan lejos',
        'a ver quién lo grita más fuerte, FELICIDADES {channel}',
        'esto se merece un hype train, quién se suma',
        'pura buena onda hoy, me encanta {combo}',
        'el que se equivocó de botón levante la mano',
        'QUÉ JUGADA, no me esperaba eso {emote}',
        '{user} te salvaste de milagro bancá',
        'esa muerte fue un chiste, ni la intención tenía {combo}',
        'el boss ya tiene cara de estar cansado jaja',
        'esa caída al vacío fue tan tonta que me dolió',
        'lo dio vuelta con 1% de vida, ni lo creo',
        '{channel} necesita un casco de guerra jaja',
        'no puede ser que haya muerto en la misma plataforma tres veces {emote}',
        'el logro que nadie consigue apareció en el momento justo',
        'jaja el personaje se quedó clavado en la pared, bug re gracioso',
        '{user} no sabe ni dónde está parado y gana igual {emote}',
        'se cayó el speedrun en la última sala, qué mala suerte',
        'esa pelea fue más larga que mi laburo de la semana',
        'el mapa nuevo es una trampa, no paro de caer {combo}',
        'un clutch así se paga con cerveza, posta',
        'qué empate más cruel, ni el juego sabe quién ganó {emote}',
        'chicos el boss tiene un patrón re raro en el segundo cambio',
        '{user} le dio al botón de soltar, ya es tradición',
        'gg, el que no pudo hoy que pruebe mañana',
        'esa esquiva en el último golpe fue magia pura',
        'tiré el mando al sillón del susto jaja',
        'el contador de muertes ya llegó a 30 y no para',
        'el juego se trabó justo en el mejor momento {combo}',
        '{channel} pasá el clip del clutch que me lo perdí',
        'alguien que me explique por qué el sorteo salió con el mismo nombre dos veces che',
        'el sorteo huele raro, o es mi imaginación {emote}',
        'pagame la apuesta de mañana {user} que ya lo dijiste en vivo',
        '{user} ya sabemos que vos sos el mejor del chat, no hace falta repetirlo',
        'el mejor jugador del chat sigue siendo {user} y no me discutan',
        'jmica dice que el pollo sigue vivo, no le creo nada {combo}',
        'bancá, que el chat ya tiene chiste interno con el posta de {user}',
        'pedí perdón {user}, que el chat no es para estas cosas',
        '{channel} los links sin permiso no se mandan, leé las reglas che',
        'posta que el modo lento está prendido, no manden 40 mensajes seguidos {emote}',
        '{user} te dije que no era el premio de Fqkeh, ya aclarate',
        'el sorteo lo corrió Fqkeh, nadie tiene que dudar del resultado',
        'quién le debe el favor a quién? yo creo que {user}',
        'ya fue, perdón por lo del martes, no quise decir eso',
        'reglas nuevas en el chat, el que spamea se va a timeout {emote}',
        'el que pierde el 1v1 con {user} paga la ronda, aceptamos?',
        'se armó un lío por nada, era un malentendido nomás',
        'que alguien le diga a {user} que el sorteo es el sábado y no el viernes',
        'jmica, avisá cuando cierre el sorteo que no me acuerdo',
        '{user} ganó otra apuesta y ahora quiere la revancha {combo}',
        'buenísimo lo de {user}, es el único que se acuerda de la regla',
        'a ver si Yuuzito cumple el gorro hoy o nos vuelve a mentir',
        'primero los favores, después los memes, orden en el chat',
        'el bot no me dejó mandar el link, culpa del filtro de jmica',
        '{user} tiene razón, el mejor sigue siendo el de la semana pasada {emote}',
        'el chat de {channel} hoy está más tranquilo que el de ayer, bien ahí',
        'che {channel} el audio tiene eco, revisá el micro',
        '{user} el audio está bajito, subí un toque',
        'se ve pixelado de nuevo, ¿es la subida? {emote}',
        'la imagen se congeló, ¿se colgó la compu?',
        'se trabó otra vez, igual re buenísimo el stream {combo}',
        '{channel} avisame si se corta la luz así no me pierdo nada',
        'pantalla negra, ¿alguien más lo ve?',
        'bancá {channel}, reiniciá el router que se cayó la conexión',
        'el micro se apagó, nos quedamos hablando solos jaja {emote}',
        '¿esto es delay o el chat va atrasado?',
        'se cortó el anuncio justo en la mejor parte, en serio',
        '{user} ¿se ve en 720 o en 1080? se ve distinto',
        'uh se cayó todo, ¿reinició la compu? {emote}',
        'che {channel} hay un zumbido en el audio, ¿será el cable?',
        'avisen si vuelve el stream, que estoy esperando sentado',
        'se re lagueó el video, me perdí el final {combo}',
        'pasó algo con la señal o es mi internet?',
        '{user} te escuchamos, pero se corta cada tanto',
        'ni te imaginás lo que se trabó mi pantalla recién {emote}',
        'jajaja otro anuncio en el peor momento, qué mala suerte',
        'se ve borroso con poca luz, bajá un poco la sensibilidad',
        'el delay se nota un montón, ya lo sabía {user}',
        'reiniciaste la compu? volvió todo, bien {emote}',
        'se escucha el ventilador de la compu, sacalo del micro {combo}',
        'no se ve nada, ¿se cerró la captura?',
        'alguien más siente que el lunes llegó sin avisar',
        '{channel} che, ¿hoy hay asado o no?',
        'tengo el mate frío y no me doy cuenta hasta el tercer sorbo {emote}',
        '{user} todavía estás en la oficina? andá a casa',
        'mi gato me miró como si fuera culpa mía que no haya agua {combo}',
        'el fernet con coca de hoy me pegó más fuerte que el laburo',
        'cumpleaños de mi hermana y ya perdí la cuenta de los postres {emote}',
        '{user} feliz cumple, que lo pases bien hoy',
        'posta que el bondi nunca llega cuando lo necesitás',
        'quién se acuerda de que mañana vence la luz? {emote}',
        'turno de guardia de 24 horas y el café ya no hace nada',
        '{channel} otra madrugada de stream, qué buena compañía',
        'mi vieja me mandó audio de 4 minutos sobre la sopa {emote}',
        'ya hice la mudanza entera y me faltan dos cajas, hermoso',
        'alguien sabe si el gato sin nombre ya tiene nombre? jaja',
        '{user} no te olvides de tomar agua, en serio',
        'no hay nada más triste que un domingo sin asado {combo}',
        'estoy mirando desde el laburo, shh que me ven {emote}',
        'el laburo me tiene la cabeza en otro lado hoy',
        '{channel} esa luz de la tarde te queda re linda',
        'con este calor no hay ganas de nada, qué locura',
        'mañana es el cumple de mi viejo, hay que planear el asado',
        'el 60 llegó justo cuando ya me iba a pedir un Uber {emote}',
        '{user} te toca traer el hielo para el asado',
        'quién más se duerme con el stream prendido? {combo}',
        'pagué la sub solo para tener el badge y no llorar en el chat',
        '{user} regaló una sub y yo sigo sin llegar a fin de mes jaja {emote}',
        'lo que me gasto en subs, mi viejo ya me pregunta qué hago',
        'sub de {user} y yo lloro, no me alcanza la plata {combo}',
        'bancá {channel}, ya me suscribí de nuevo jajaja',
        'el hype train me agarró sin plata, posta que lo intenté {emote}',
        'raid de {channel} confirmado, prepárense que vienen con todo',
        'llegamos de raid, hola a los que vienen de la otra comu {emote}',
        'alguien regaló 10 subs y yo sigo buscando el botón de regalar',
        '{user} regaló subs y ahora tengo que aguantarme el chat todo el día {combo}',
        'faltan 2 minutos pal sorteo, las manos me tiemblan',
        'si me toca el sorteo me desmayo acá mismo {emote}',
        'nervioso como si fuera la final, no sé ni escribir {emote}',
        'qué es el mensaje del sistema que dice mes 6? jaja',
        '{user} sube de nivel de sub, 6 meses, qué capo {emote}',
        'tanto tiempo suscripto y todavía no tengo el emote del mes',
        'la sub me sale más cara que el internet, pero la pago igual',
        '{channel} tiene el mejor chat del mundo, no pienso dejar de pagar',
        'bancá, 12 meses de sub y todavía me pregunto qué miro en el stream',
        'hype train arriba, todos a subirse que se viene el nivel 3 {combo}',
        'pagar la sub es mi forma de decir gracias, posta',
        '{user} te banqué la sub por 3 meses y ahora no me acuerdo ni de mi contraseña',
        'el sorteo es a las 9, pero yo ya estoy re nervioso',
        'nadie me explica qué es el mensaje rojo del sistema? {emote}',
        'subí de nivel de sub sin darme cuenta, qué quilombo jaja',
        'buenas a todos, llegué tarde pero acá estoy',
        '{channel} arrancá ya, que llevamos esperando {emote}',
        '¿alguien sabe si hoy hay directo o se cancela?',
        'bancá que me estaba preparando el mate',
        'jaja se nos fue el tiempo, ¿ya empezamos?',
        '{user} ya llegó, se viene la fiesta {emote}',
        'cuenta regresiva, 3, 2, 1... dale que ya',
        'che, volvé que te extrañamos {combo}',
        'no se vayan todavía, faltan los últimos minutos',
        'el baño no falla, ¿ya volvés? jaja',
        'posta que se cortó el audio, ¿me escuchan?',
        'cambiaste de juego y no me avisaste',
        'al final sí era este, qué buena elección',
        'nos vemos mañana, no falten {emote}',
        'gracias por el directo, la pasé re bien',
        '{channel} buenísimo el stream de hoy',
        'vení {user}, sumate al chat que se pone bueno',
        'pasá por los sorteos así no te los perdés',
        'che, ¿cuándo es el próximo directo?',
        'hoy la sorpresa estuvo buenísima {combo}',
        '¿es invitado nuevo? quiero saber quién es',
        'ya me estoy yendo, cuídense todos',
        'buenas noches a todos, descansen',
        'mañana no me lo pierdo, ya tengo la alarma puesta {emote}',
        'me quedo un rato más aunque sea madrugada'
    ];

    let lastTestUser = null;
    let templateTimer = null;
    let feedRunning = false;
    // Speed of the test chat (slider over it): divides the waits between example messages, 0 pauses them.
    // Only the settings page uses it, so it is not part of the OBS URL.
    let testSpeed = 1;

    // Waits of the test feed at the current speed (a paused feed still finishes what it started)
    function feedDelay(ms) {
        return ms / (testSpeed || 1);
    }

    // A chat bot answering commands, so "Ocultar bots" and "Ocultar comandos" show in the test chat
    const TEST_BOT = { username: 'BotRix', color: '#b9a3ff', badges: [] };
    const BOT_COMMANDS = [
        { cmd: '!discord', reply: 'Únete al Discord de {channel}: discord.gg/holychat' },
        { cmd: '!redes', reply: 'Instagram y TikTok: @{channel}. YouTube con los mejores momentos todas las semanas.' },
        { cmd: '!uptime', reply: '{channel} lleva 2 horas y 14 minutos en vivo.' },
        { cmd: '!horario', reply: 'Stream de lunes a viernes desde las 21:00 (hora de Chile).' },
        { cmd: '!sorteo', reply: 'El sorteo es el domingo. Escribe !participar para entrar.' }
    ];

    function pushBotExchange() {
        const command = BOT_COMMANDS[Math.floor(Math.random() * BOT_COMMANDS.length)];
        addMessage({
            id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            createdAt: new Date().toISOString(),
            ...testSender(pickTestUser()),
            content: command.cmd,
            _sevenTvStyle: null
        });
        setTimeout(() => {
            if (!feedRunning) return;
            addMessage({
                id: `bot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                createdAt: new Date().toISOString(),
                ...testSender(TEST_BOT),
                _template: command.reply,
                _sevenTvStyle: null
            });
        }, feedDelay(700 + Math.random() * 600));
    }

    // A moderator deleting one of the last few messages, so "Mensajes borrados" shows too
    function deleteRecentTestMessage() {
        const rows = Array.from(chatMessagesEl.querySelectorAll('.chatterino-line:not(.deleted):not(.filtered)')).slice(-6, -1);
        if (rows.length) markDeleted(rows[Math.floor(Math.random() * rows.length)]);
    }

    function pickTestUser() {
        const pool = TEST_USERS.filter(u => u !== lastTestUser);
        lastTestUser = pool[Math.floor(Math.random() * pool.length)];
        return lastTestUser;
    }

    function testSender(user) {
        return {
            sender: {
                id: 0,
                username: user.username,
                slug: user.username.toLowerCase(),
                color: user.color,
                // Same badge mapping as the live chat, so the icons are Kick's own
                badges: user.badges.map(spec => {
                    const [type, count] = spec.split(':');
                    return KickChatClient.mapKickBadge({ type, count }, null);
                }).filter(Boolean)
            },
            sevenTv: (user.paint || user.seventvBadge) ? {
                badge: user.seventvBadge ? {
                    type: '7tv',
                    text: SEVENTV_BADGES[user.seventvBadge][1],
                    imageUrl: `https://cdn.7tv.app/badge/${SEVENTV_BADGES[user.seventvBadge][0]}/2x.webp`
                } : null,
                paint: user.paint ? SevenTVCosmetics.paintToCss(SEVENTV_PAINTS[user.paint]) : null
            } : null
        };
    }

    // Packs are replaced, never changed in place, so each pack's name list is built once
    const packNamesCache = new WeakMap();

    function packEmoteNameSet() {
        if (!window.KickChatClient) return { list: [], set: new Set() };
        const channelEmotes = KickChatClient.getPack(config.channel).emotes;
        const globalEmotes = KickChatClient.getGlobalPack ? KickChatClient.getGlobalPack().emotes : null;
        const list = [];
        const seen = new Set();
        if (channelEmotes) {
            for (const [name, data] of channelEmotes) {
                if (!data.zeroWidth && !seen.has(name)) {
                    seen.add(name);
                    list.push(name);
                }
            }
        }
        if (globalEmotes) {
            for (const [name, data] of globalEmotes) {
                if (!data.zeroWidth && !seen.has(name)) {
                    seen.add(name);
                    list.push(name);
                }
            }
        }
        return { list, set: seen };
    }

    function packEmoteNames() {
        return packEmoteNameSet().list;
    }

    // A combo: a base emote followed by a zero-width emote, which the parser stacks on it
    function packComboPair() {
        if (!window.KickChatClient) return null;
        const channelEmotes = KickChatClient.getPack(config.channel).emotes;
        const globalEmotes = KickChatClient.getGlobalPack ? KickChatClient.getGlobalPack().emotes : null;
        const bases = [];
        const overlays = [];
        const add = (e, name) => {
            (e.zeroWidth ? overlays : bases).push(name);
        };
        if (channelEmotes) channelEmotes.forEach(add);
        if (globalEmotes) globalEmotes.forEach(add);
        if (!bases.length || !overlays.length) return null;
        const base = bases[Math.floor(Math.random() * bases.length)];
        const overlay = overlays[Math.floor(Math.random() * overlays.length)];
        return `${base} ${overlay}`;
    }

    // Fills a template message's text with the current channel and one of its emotes
    function resolveTemplate(msg) {
        if (!msg._template) return;
        const { list: names, set: nameSet } = packEmoteNameSet();
        if (!msg._emote || (names.length && !nameSet.has(msg._emote))) {
            msg._emote = names.length ? names[Math.floor(Math.random() * names.length)] : 'Rlove';
        }
        if (msg._template.includes('{combo}') && !msg._combo) {
            msg._combo = packComboPair() || msg._emote;
        }
        if (!msg._mention) {
            const others = TEST_USERS.filter(u => u.username !== msg.sender.username);
            msg._mention = others[Math.floor(Math.random() * others.length)].username;
        }
        msg.content = msg._template
            .replace(/\{combo\}/g, msg._combo || msg._emote)
            .replace(/\{emote\}/g, msg._emote)
            .replace(/\{channel\}/g, config.channel)
            .replace(/\{user\}/g, msg._mention);
    }

    // Avoids repeating any of the last few lines
    const recentLines = [];

    function pickTemplateLine() {
        const pool = TEMPLATE_LINES.filter(l => !recentLines.includes(l));
        const line = pool[Math.floor(Math.random() * pool.length)];
        recentLines.push(line);
        if (recentLines.length > 15) recentLines.shift();
        return line;
    }

    function pushTemplateMessage(animate = true) {
        const user = pickTestUser();
        addMessage({
            id: `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            createdAt: new Date().toISOString(),
            ...testSender(user),
            _template: pickTemplateLine(),
            // The ids are made up: never look them up on 7TV
            _sevenTvStyle: null
        }, { animate });
    }

    // Chatters sharing a track as a SoundCloud link, now and then, so links show up in the test chat too
    const SHARE_LINES = [
        'e bro dropio agu {emote} https://on.soundcloud.com/v2s8ZCO5GiglxEV0Za',
        'e bro dropio pachu {emote} https://on.soundcloud.com/RtNbk9UxxHuhujpYLs',
        'escuchen esto {user} https://on.soundcloud.com/x7KpQm2RtWn3LzA1Bc',
        'pasen el tema nuevo de {emote}, está brutal https://on.soundcloud.com/Lq8vT4hYe0MnRx9Ws2'
    ];

    function pushShareMessage() {
        addMessage({
            id: `shr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            createdAt: new Date().toISOString(),
            ...testSender(pickTestUser()),
            _template: SHARE_LINES[Math.floor(Math.random() * SHARE_LINES.length)],
            _sevenTvStyle: null
        });
    }

    // A conversation being played out line by line: the replies follow the message before them
    let activeThread = null;
    let lastThreadId = null;

    function startThread() {
        const pool = TEST_THREADS.filter(t => t.id !== lastThreadId);
        const thread = pool[Math.floor(Math.random() * pool.length)];
        lastThreadId = thread.id;
        activeThread = { id: thread.id, lines: thread.lines, index: 0 };
    }

    function pushThreadLine(animate = true) {
        const line = activeThread.lines[activeThread.index++];
        const user = TEST_USERS.find(u => u.username === line.u) || pickTestUser();
        addMessage({
            id: `thr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            createdAt: new Date().toISOString(),
            ...testSender(user),
            _template: line.t,
            _sevenTvStyle: null
        }, { animate });
        if (activeThread.index >= activeThread.lines.length) activeThread = null;
    }

    // Feed phases: calm (single messages), talk (conversations) and spam (a wave of emotes
    // of one category, like laughs or hype, sent by several chatters at once)
    const FEED_PHASES = [
        { name: 'calm', min: 20000, max: 40000 },
        { name: 'talk', min: 30000, max: 55000 },
        { name: 'spam', min: 6000, max: 11000 }
    ];

    // Emote names are matched by pattern, since the real names come from the channel's 7TV pack
    const EMOTE_CATEGORIES = [
        { name: 'risa', pattern: /lul|kek|lol|haha|jaja|omegal|xd|joy/i },
        { name: 'hype', pattern: /pog|hype|clap|fire|^gg|lets/i },
        { name: 'triste', pattern: /^f$|sad|cry|pain|feel|^rip/i },
        { name: 'amor', pattern: /love|heart|hug|kiss/i },
        { name: 'susto', pattern: /monka|scared|panic|omg|wow/i },
        { name: 'enojo', pattern: /angry|rage|mad|bonk|pout|smh/i }
    ];

    let feedPhaseIndex = 0;
    let feedPhaseEndsAt = 0;
    let spamPool = null;

    // Worked out once per pack (the name list object is cached per pack too)
    const categoriesCache = new WeakMap();

    // Categories with at least two emotes in the channel's pack
    function emoteCategories() {
        const names = packEmoteNameSet();
        let cats = categoriesCache.get(names);
        if (!cats) {
            cats = EMOTE_CATEGORIES
                .map(c => ({ name: c.name, emotes: names.list.filter(n => c.pattern.test(n)) }))
                .filter(c => c.emotes.length >= 2);
            categoriesCache.set(names, cats);
        }
        return cats;
    }

    // Several chatters each send 1 to 4 emotes of the same category, a few hundred ms apart
    function spamBurst(pool) {
        const senders = TEST_USERS.slice().sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 5));
        let sent = 0;
        const send = () => {
            // One emote per message: the wave comes from several chatters, not from one long message
            const content = pool.emotes[Math.floor(Math.random() * pool.emotes.length)];
            addMessage({
                id: `spam-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                createdAt: new Date().toISOString(),
                ...testSender(senders[sent]),
                content,
                _sevenTvStyle: null
            });
            sent++;
            if (sent < senders.length && feedRunning) setTimeout(send, feedDelay(350 + Math.random() * 650));
        };
        send();
    }

    function enterFeedPhase(index) {
        feedPhaseIndex = index;
        const phase = FEED_PHASES[index];
        feedPhaseEndsAt = Date.now() + feedDelay(phase.min + Math.random() * (phase.max - phase.min));
        activeThread = null;
        if (phase.name === 'spam') {
            const cats = emoteCategories();
            if (!cats.length) return enterFeedPhase(0);
            spamPool = cats[Math.floor(Math.random() * cats.length)];
        }
    }

    function startTemplateFeed() {
        stopTemplateFeed();
        activeThread = null;
        if (!chatMessagesEl.childElementCount) {
            for (let i = 0; i < 12; i++) pushTemplateMessage(false);
        }
        enterFeedPhase(0);
        feedRunning = true;
        scheduleFeedTick(1400 + Math.random() * 1800);
    }

    function scheduleFeedTick(ms) {
        clearTimeout(templateTimer);
        templateTimer = feedRunning && testSpeed > 0 ? setTimeout(feedTick, feedDelay(ms)) : null;
    }

    function feedTick() {
        if (Date.now() >= feedPhaseEndsAt) enterFeedPhase((feedPhaseIndex + 1) % FEED_PHASES.length);
        const phase = FEED_PHASES[feedPhaseIndex].name;
        let delay;
        if (phase === 'spam') {
            spamBurst(spamPool);
            delay = 2500 + Math.random() * 2500;
        } else if (phase === 'talk') {
            if (!activeThread && TEST_THREADS.length && Math.random() < 0.8) startThread();
            if (activeThread) {
                pushThreadLine();
                delay = 1600 + Math.random() * 1600;
            } else {
                pushTemplateMessage();
                delay = 1400 + Math.random() * 1800;
            }
        } else {
            const r = Math.random();
            if (r < 0.12) pushBotExchange();
            else if (r < 0.18) deleteRecentTestMessage();
            else if (r < 0.24) pushShareMessage();
            else if (r < 0.28) addChannelEvent(window.HolyEvents.sample(Math.random() < 0.5 ? 'donation' : 'reward', pickTestUser()));
            else pushTemplateMessage();
            delay = 2600 + Math.random() * 2200;
        }
        scheduleFeedTick(delay);
    }

    function stopTemplateFeed() {
        feedRunning = false;
        clearTimeout(templateTimer);
        templateTimer = null;
    }

    // A settings tab left in the background builds no test messages nobody sees; the feed
    // picks up again when the tab is shown
    document.addEventListener('visibilitychange', () => {
        if (!feedRunning) return;
        if (document.hidden) {
            clearTimeout(templateTimer);
            templateTimer = null;
        } else {
            scheduleFeedTick(600);
        }
    });

    function setTestSpeed(speed) {
        testSpeed = speed;
        if (window.KickCache) window.KickCache.set('test_speed', speed, 30 * 24 * 60 * 60 * 1000);
        // The next message follows the new speed right away, and none comes while paused
        scheduleFeedTick(600);
    }

    if (cfgTestSpeed) {
        const saved = window.KickCache ? window.KickCache.get('test_speed') : null;
        if (STEPS.testSpeed.values.includes(saved)) testSpeed = saved;
        setStep(cfgTestSpeed, testSpeed);
        syncSlider(cfgTestSpeed);
        cfgTestSpeed.addEventListener('input', () => {
            syncSlider(cfgTestSpeed);
            setTestSpeed(stepValue(cfgTestSpeed));
        });
    }

    function sendTestChatMessage() {
        const rawText = cfgPreviewInput ? cfgPreviewInput.value.trim() : '';
        if (!rawText) return;

        const user = pickTestUser();

        const testMsg = {
            id: `test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            chatroomId: (client && client.chatroomId) || 18761973,
            content: rawText,
            createdAt: new Date().toISOString(),
            ...testSender(user),
            // The ids are made up: never look them up on 7TV
            _sevenTvStyle: null
        };

        addMessage(testMsg);
        cfgPreviewInput.value = '';
        cfgPreviewInput.focus();
    }

    // Settings listeners
    if (initialMenu) {
        initialMenu.addEventListener('input', onMenuChange);
        initialMenu.addEventListener('change', onMenuChange);
    }
    if (cfgChannel) {
        cfgChannel.addEventListener('blur', () => { cfgChannel.value = menuChannel(); });
    }
    if (cfgBots) cfgBots.addEventListener('blur', () => { cfgBots.value = config.bots; });
    const cfgIgnoredUsers = document.getElementById('cfgIgnoredUsers');
    if (cfgIgnoredUsers) cfgIgnoredUsers.addEventListener('blur', () => { cfgIgnoredUsers.value = config.ignoredUsers; });
    if (btnCopyOverlayUrl) btnCopyOverlayUrl.addEventListener('click', copyGeneratedUrl);
    if (btnRefreshCache) {
        btnRefreshCache.addEventListener('click', refreshCache);
        updateRefreshButton();
    }
    if (obsHelp) {
        document.getElementById('btnObsHelp').addEventListener('click', () => obsHelp.showModal());
        document.getElementById('obsHelpClose').addEventListener('click', () => obsHelp.close());
        document.getElementById('obsHelpOk').addEventListener('click', () => obsHelp.close());
        // Click on the backdrop closes it
        obsHelp.addEventListener('click', (e) => { if (e.target === obsHelp) obsHelp.close(); });
    }

    // Test chat listeners
    if (testComposer) {
        testComposer.addEventListener('submit', (e) => {
            e.preventDefault();
            sendTestChatMessage();
        });
    }

    // Once the pack of the channel in the menu arrives, show its emotes in the test chat
    window.addEventListener('channel_emotes_loaded', (e) => {
        if (!isMenuMode() || !e.detail || e.detail.channel !== menuChannel()) return;
        chatMessagesEl.querySelectorAll('.chatterino-line').forEach(row => {
            if (row._msg) row._msg._parsed = null;
        });
        rerenderMessages();
    });

    window.addEventListener('global_emotes_loaded', () => {
        if (!isMenuMode()) return;
        chatMessagesEl.querySelectorAll('.chatterino-line').forEach(row => {
            if (row._msg) row._msg._parsed = null;
        });
        rerenderMessages();
    });

    if (menuCloseBtn) menuCloseBtn.addEventListener('click', closeMenu);

    window.addEventListener('keydown', (e) => {
        // The OBS help dialog handles its own keys (Esc closes it)
        if (obsHelp && obsHelp.open) return;
        if (e.key === 'Escape') {
            if (isMenuMode() && isOverlayActive) {
                closeMenu();
            }
        } else if ((e.key === 'c' || e.key === 'C') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
            if (isMenuMode()) {
                if (isOverlayActive) closeMenu();
            } else {
                openMenu();
            }
        }
    });

    // -------------------------------------------------------------------------
    // Overlay Application & Styles
    // -------------------------------------------------------------------------

    // Google Fonts stylesheets already added to the page (Inter comes with index.html)
    const loadedFonts = new Set(['inter', 'system']);

    function loadFont(key) {
        // Fonts without weights come with the system (Arial, Georgia...): nothing to download
        if (loadedFonts.has(key) || !FONTS[key].weights) return;
        loadedFonts.add(key);
        const f = FONTS[key];
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.weights}&display=swap`;
        document.head.appendChild(link);
    }

    function applyFont() {
        // "Automática": the style's own font, or Inter
        const key = config.font === 'auto' ? (window.HolyCatalog.design(config.design).font || 'inter') : config.font;
        const f = FONTS[key];
        loadFont(key);
        const family = key === 'system' ? FONT_FALLBACK : `"${f.name}", ${FONT_FALLBACK}`;
        overlayContainer.style.setProperty('--chatterino-font', family);
        overlayContainer.style.setProperty('--font-weight', String(config.fontWeight));
        // The picker shows the chosen font in that font
        if (cfgFont) cfgFont.style.fontFamily = family;
    }

    function applyStyles() {
        // Size and theme live on the chat window so the settings page keeps its own look
        overlayContainer.style.setProperty('--font-size', `${config.fontSize}px`);
        overlayContainer.style.setProperty('--emote-size', `${config.emoteSize}px`);
        overlayContainer.style.setProperty('--badge-size', `${config.badgeSize}px`);
        applyFont();

        // Theme
        overlayContainer.classList.remove('theme-dark', 'theme-light', 'theme-transparent');
        overlayContainer.classList.add(`theme-${config.theme}`);

        // Shadow & Text Background
        if (chatArea) {
            chatArea.classList.remove(...STEPS.shadow.values.map(v => `shadow-${v}`));
            chatArea.classList.add(`shadow-${config.shadow}`);
            chatArea.classList.remove(...STEPS.msgShadow.values.map(v => `msg-shadow-${v}`));
            chatArea.classList.add(`msg-shadow-${config.msgShadow}`);
            chatArea.classList.toggle('text-bg-enabled', config.textBg);
            chatArea.classList.toggle('text-bg-max', config.textBgWidth === 'max');
            // Deleted messages are restyled by CSS, so switching the mode also changes the old ones
            chatArea.dataset.deleted = config.deletedMessages;
            chatArea.classList.remove(...LAYOUTS.map(l => `layout-${l}`));
            chatArea.classList.add(`layout-${config.layout}`);
        }

        // Style, direction and background color
        window.HolyOptions.apply(config, overlayContainer, chatArea);

        // Pinned Banner
        if (pinnedBanner) {
            pinnedBanner.classList.toggle('hidden', !config.showPin);
            if (pinnedBannerText) {
                pinnedBannerText.textContent = `Mensaje fijado: Bienvenidos al chat de Kick #${config.channel}`;
            }
        }
    }

    function setStatus(text, state = 'connecting', autoHideMs = 0) {
        if (!statusIndicator) return;
        if (hideStatusTimer) clearTimeout(hideStatusTimer);

        statusText.textContent = text;
        statusDot.className = 'status-dot ' + state;
        statusIndicator.classList.remove('hidden');

        if (autoHideMs > 0) {
            hideStatusTimer = setTimeout(() => {
                statusIndicator.classList.add('hidden');
            }, autoHideMs);
        }
    }

    /**
     * Creates a badge <img>. Every badge (Kick native, subscriber tiers, 7TV) is an image.
     */
    function createBadgeImg(b) {
        const img = document.createElement('img');
        img.className = 'badge-img' + (b.type === '7tv' ? ' badge-7tv' : '');
        img.decoding = 'async';
        img.src = b.imageUrl;
        img.alt = b.text || b.type || 'badge';
        img.title = b.text || b.type || '';
        if (b.type === '7tv') {
            // No made-up stand-in: a 7TV badge that fails to load is just left out
            img.onerror = function () {
                this.remove();
            };
        }
        return img;
    }

    /**
     * Renders badge container with native Kick badges
     */
    function renderBadgesElement(badges) {
        if (!config.badges) return null;

        const span = document.createElement('span');
        span.className = 'chat-badges';

        (Array.isArray(badges) ? badges : []).forEach(b => {
            if (b && b.imageUrl) span.appendChild(createBadgeImg(b));
        });

        return span;
    }

    /**
     * Applies a 7TV paint / color to the username element
     */
    function applySevenTVNameStyle(authorSpan, style) {
        if (!style || !config.sevenTVCosmetics) return;

        // 1) Aplicar color base sólido de 7TV (si tiene) de forma que el nombre NUNCA quede invisible
        if (style.color) {
            authorSpan.style.color = style.color;
        }

        const paint = style.paint;
        if (!paint) return;

        // 2) Sombra y filtros de paint (se guardan en variable CSS para combinarse con el borde del overlay)
        if (paint.filter) {
            authorSpan.style.setProperty('--seventv-filter', paint.filter);
        }

        // 3) Aplicación de Paint (URL/Imagen o Gradiente)
        if (paint.function === 'URL' && paint.image_url) {
            authorSpan.classList.add('chat-author-paint');
            // Paint de imagen (ej: el paint de Pascua de noah4eva)
            // Precargar la imagen para asegurar que el texto nunca quede transparente/invisible si tarda o falla
            const img = new Image();
            img.onload = () => {
                authorSpan.style.backgroundImage = `url("${paint.image_url}")`;
                authorSpan.style.backgroundRepeat = 'repeat';
                authorSpan.style.backgroundPosition = 'center';
                authorSpan.style.backgroundSize = 'cover';
                authorSpan.style.webkitBackgroundClip = 'text';
                authorSpan.style.backgroundClip = 'text';
                authorSpan.style.webkitTextFillColor = 'transparent';
                authorSpan.style.color = 'transparent';
            };
            img.src = paint.image_url;
        } else if (paint.background) {
            // Paint de gradiente CSS
            authorSpan.classList.add('chat-author-paint');
            authorSpan.style.backgroundImage = paint.background;
            authorSpan.style.backgroundRepeat = 'repeat';
            authorSpan.style.backgroundPosition = 'center';
            authorSpan.style.backgroundSize = 'cover';
            authorSpan.style.webkitBackgroundClip = 'text';
            authorSpan.style.backgroundClip = 'text';
            authorSpan.style.webkitTextFillColor = 'transparent';
            authorSpan.style.color = 'transparent';
        } else if (paint.color) {
            authorSpan.style.color = paint.color;
        }
    }

    /**
     * Resets 7TV paint and inline cosmetics back to base author style
     */
    function resetSevenTVNameStyle(authorSpan, fallbackColor) {
        authorSpan.classList.remove('chat-author-paint');
        authorSpan.style.backgroundImage = '';
        authorSpan.style.backgroundRepeat = '';
        authorSpan.style.backgroundPosition = '';
        authorSpan.style.backgroundSize = '';
        authorSpan.style.webkitBackgroundClip = '';
        authorSpan.style.backgroundClip = '';
        authorSpan.style.webkitTextFillColor = '';
        authorSpan.style.removeProperty('--seventv-filter');
        authorSpan.style.color = fallbackColor || '#53fc18';
    }

    /**
     * Compares two 7TV styles to check if visual appearance actually changed
     */
    function areSevenTVStylesEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        if (a.color !== b.color) return false;

        const b1 = a.badge, b2 = b.badge;
        if (Boolean(b1) !== Boolean(b2)) return false;
        if (b1 && b2 && (b1.imageUrl !== b2.imageUrl || b1.text !== b2.text)) return false;

        const p1 = a.paint, p2 = b.paint;
        if (Boolean(p1) !== Boolean(p2)) return false;
        if (p1 && p2) {
            if (p1.background !== p2.background ||
                p1.color !== p2.color ||
                p1.filter !== p2.filter ||
                p1.function !== p2.function ||
                p1.image_url !== p2.image_url) return false;
        }
        return true;
    }

    /**
     * Reactively updates all active message rows for a user when their 7TV cosmetics refresh
     */
    function updateUserSevenTVStyle(kickUserId, newStyle) {
        if (!kickUserId) return;
        const rows = chatMessagesEl.querySelectorAll('.chatterino-line');
        rows.forEach(row => {
            const msg = row._msg;
            if (!msg || !msg.sender || String(msg.sender.id) !== String(kickUserId)) return;

            const oldStyle = msg._sevenTvStyle !== undefined ? msg._sevenTvStyle : (msg.sevenTv || null);
            if (areSevenTVStylesEqual(oldStyle, newStyle)) {
                msg._sevenTvStyle = newStyle || null;
                return;
            }

            msg._sevenTvStyle = newStyle || null;
            msg.sevenTv = newStyle || null;

            if (newStyle && newStyle.color) {
                row.style.setProperty('--uc', newStyle.color);
            } else {
                row.style.setProperty('--uc', msg.sender?.color || '#53fc18');
            }

            const authorSpan = row.querySelector('.chat-author');
            if (authorSpan) {
                resetSevenTVNameStyle(authorSpan, msg.sender?.color);
                if (newStyle && config.sevenTVCosmetics) {
                    applySevenTVNameStyle(authorSpan, newStyle);
                }
            }

            let badgesEl = row.querySelector('.chat-badges');
            if (badgesEl) {
                badgesEl.querySelectorAll('.badge-7tv').forEach(b => b.remove());
                if (newStyle && newStyle.badge && config.sevenTVCosmetics && config.badges) {
                    badgesEl.prepend(createBadgeImg(newStyle.badge));
                }
            } else if (newStyle && newStyle.badge && config.sevenTVCosmetics && config.badges) {
                const head = row.querySelector('.chat-head');
                const authorEl = row.querySelector('.chat-author');
                if (head && authorEl) {
                    badgesEl = document.createElement('span');
                    badgesEl.className = 'chat-badges';
                    badgesEl.appendChild(createBadgeImg(newStyle.badge));
                    head.insertBefore(badgesEl, authorEl);
                }
            }
        });
    }

    window.addEventListener('seventv_style_updated', (e) => {
        if (e.detail && e.detail.kickUserId) {
            updateUserSevenTVStyle(e.detail.kickUserId, e.detail.style);
        }
    });

    /**
     * Formats timestamp in Chatterino format: HH:MM
     */
    function formatTime(isoString) {
        try {
            const d = isoString ? new Date(isoString) : new Date();
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch (e) {
            return '00:00';
        }
    }

    /**
     * Message HTML. The settings page re-parses so the emote switch and the typed
     * channel apply at once; OBS mode reuses what the client already parsed.
     */
    function messageHtml(msg) {
        const reuse = !isMenuMode() && client && client.sevenTVEmotes === config.sevenTVEmotes && msg.html;
        if (reuse || !window.KickChatClient || !KickChatClient.parseContentToHtml) return msg.html || msg.content || '';
        // Redrawing every row (style, switches) reuses the last parse while text and pack are the same
        const content = msg.content || '';
        const emotes = config.sevenTVEmotes ? KickChatClient.getPack(config.channel).emotes : null;
        const globalEmotes = config.sevenTVEmotes && KickChatClient.getGlobalPack ? KickChatClient.getGlobalPack().emotes : null;
        const cached = msg._parsed;
        if (cached && cached.content === content && cached.emotes === emotes && cached.globalEmotes === globalEmotes) return cached.html;
        const html = KickChatClient.parseContentToHtml(content, {
            sevenTVEmotes: config.sevenTVEmotes,
            channel: config.channel,
            emotes: emotes || undefined,
            globalEmotes: globalEmotes || undefined
        });
        msg._parsed = { content, emotes, globalEmotes, html };
        return html;
    }

    /**
     * Fills a message row (badges, name, text). Called again on the same row
     * when the 7TV switches change on the settings page.
     */
    function fillRow(row) {
        const msg = row._msg;
        resolveTemplate(msg);
        row.textContent = '';
        // The author's color, for the styles that paint borders and text with it
        row.style.setProperty('--uc', msg.sender?.color || '#53fc18');

        // Time, Kick icon, badges, name and colon; some styles put this header above the text
        const head = document.createElement('span');
        head.className = 'chat-head';
        row.appendChild(head);

        // Timestamp span (only if enabled and the style shows it)
        if (config.timestamps && window.HolyCatalog.designShows(config.design, 'time')) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'chat-time';
            timeSpan.textContent = formatTime(msg.createdAt);
            head.appendChild(timeSpan);
        }

        if (config.platformIcon && window.HolyCatalog.designShows(config.design, 'icon')) {
            const icon = document.createElement('img');
            icon.className = 'chat-platform-icon';
            icon.src = 'badges/kick.svg';
            icon.alt = 'Kick';
            head.appendChild(icon);
        }

        // Badges element (Kick native; 7TV badge is prepended when style resolves)
        const badgesEl = renderBadgesElement(msg.sender?.badges);
        if (badgesEl) {
            head.appendChild(badgesEl);
        }

        // Author username
        const authorSpan = document.createElement('span');
        authorSpan.className = 'chat-author';
        authorSpan.style.color = msg.sender?.color || '#53fc18';
        authorSpan.textContent = msg.sender?.username || 'Anónimo';
        head.appendChild(authorSpan);

        // 7TV cosmetics (badge, name color, paint)
        if (config.sevenTVCosmetics) {
            const style = msg.sevenTv || msg._sevenTvStyle;
            if (style) {
                if (badgesEl && style.badge && config.badges) badgesEl.prepend(createBadgeImg(style.badge));
                applySevenTVNameStyle(authorSpan, style);
            } else if (msg._sevenTvStyle === undefined && client && msg.sender?.id) {
                msg._sevenTvStyle = null;
                client.get7TVStyle(msg.sender.id).then(resolved => {
                    msg._sevenTvStyle = resolved || null;
                    if (!resolved || !config.sevenTVCosmetics || row._msg !== msg) return;
                    const currentBadges = row.querySelector('.chat-badges');
                    const currentAuthor = row.querySelector('.chat-author');
                    if (currentBadges && resolved.badge && config.badges) currentBadges.prepend(createBadgeImg(resolved.badge));
                    if (currentAuthor) applySevenTVNameStyle(currentAuthor, resolved);
                });
            }
        }

        // Colon
        const colonSpan = document.createElement('span');
        colonSpan.className = 'colon';
        colonSpan.textContent = ':';
        head.appendChild(colonSpan);

        // Content
        const contentSpan = document.createElement('span');
        contentSpan.className = 'chat-text';
        contentSpan.innerHTML = messageHtml(msg);
        row.appendChild(contentSpan);

        window.HolyCatalog.decorateHead(head, config.design);
    }

    // Redraws every row with the current settings (deleted messages stay as they are)
    function rerenderMessages() {
        chatMessagesEl.querySelectorAll('.chatterino-line').forEach(row => {
            if (row._event) return fillEventRow(row);
            if (!row._msg || row.classList.contains('deleted')) return;
            row.classList.toggle('highlight', isMention(row._msg));
            fillRow(row);
        });
    }

    // Messages left out of the chat by "Ocultar bots" and "Ocultar comandos"
    function isFiltered(msg) {
        const author = (msg.sender?.username || '').toLowerCase();
        if (window.HolyOptions.isIgnored(config, author)) return true;
        if (config.hideBots && author && config.bots.split(', ').includes(author)) return true;
        return config.hideCommands && (msg.content || '').trimStart().startsWith('!');
    }

    // The test chat keeps filtered rows (hidden) so the switches can bring them back;
    // OBS never adds them, so they don't take up the message limit
    function updateFilteredRows() {
        chatMessagesEl.querySelectorAll('.chatterino-line').forEach(row => {
            if (row._msg) row.classList.toggle('filtered', isFiltered(row._msg));
            else if (row._event) row.classList.toggle('filtered', !window.HolyOptions.showsEvent(config, row._event));
        });
    }

    // True when the message names the channel's streamer (only if the mention highlight is on)
    function isMention(msg) {
        return config.mentionHighlight && (msg.content || '').toLowerCase().includes(config.channel);
    }

    /**
     * Appends Chatterino-styled message row
     */
    function addMessage(msg, { animate = true } = {}) {
        resolveTemplate(msg);
        const filtered = isFiltered(msg);
        if (filtered && !isMenuMode()) return;
        messageCounter++;
        const row = document.createElement('div');
        row.className = 'chatterino-line';
        row.dataset.id = msg.id;
        row._msg = msg;

        // Animation classes
        if (animate && config.animation !== 'none') row.classList.add(`anim-${config.animation}`);

        const author = (msg.sender?.username || 'Anónimo').toLowerCase();
        row.dataset.author = author;

        // Alternating row background (Chatterino feature)
        if (config.altRows && messageCounter % 2 === 0) {
            row.classList.add('alt-row');
        }

        // Mention / Highlight (Chatterino highlight)
        if (isMention(msg)) {
            row.classList.add('highlight');
        }
        if (filtered) row.classList.add('filtered');

        fillRow(row);
        appendRow(row);
        // History arrives at once and silent
        if (animate && !filtered) window.HolyOptions.playSound(config);
    }

    function fillEventRow(row) {
        window.HolyEvents.fill(row, row._event, text => KickChatClient.parseContentToHtml(text, {
            sevenTVEmotes: config.sevenTVEmotes,
            channel: config.channel
        }), config.design);
    }

    // Donations (Kicks) and channel point rewards. The test chat keeps the hidden ones (filtered)
    // so the switches can bring them back; OBS never adds them.
    function addChannelEvent(evt, { animate = true } = {}) {
        const shown = window.HolyOptions.showsEvent(config, evt);
        if (!shown && !isMenuMode()) return;
        const row = document.createElement('div');
        row.className = 'chatterino-line';
        row.dataset.id = evt.id;
        row.dataset.author = (evt.username || '').toLowerCase();
        row._event = evt;
        if (animate && config.animation !== 'none') row.classList.add(`anim-${config.animation}`);
        if (!shown) row.classList.add('filtered');
        fillEventRow(row);
        appendRow(row);
        if (animate && shown) window.HolyOptions.playSound(config);
    }

    // Takes a row out for good, with its fade timer, so no timer keeps a detached row alive
    function dropRow(row) {
        clearTimeout(row._fadeTimer);
        row._fadeTimer = null;
        if (tickerSizes) tickerSizes.unobserve(row);
        row.remove();
    }

    // Adds a row at the bottom, keeps the message limit and starts the fade timer
    function appendRow(row) {
        const scatter = config.layout === 'scatter';
        chatMessagesEl.appendChild(row);
        if (scatter) placeScattered(row);
        else if (config.layout === 'horizontal') tickerAdd(row);

        // Keep within limit
        const limit = scatter ? Math.min(config.limit, SCATTER_MAX) : config.limit;
        while (chatMessagesEl.childElementCount > limit) {
            dropRow(chatMessagesEl.firstElementChild);
        }

        row._shownAt = Date.now();
        scheduleFade(row);
    }

    // Seconds a message stays; scattered messages always leave after a while
    function messageLifetime() {
        // In the ticker a message leaves when it scrolls off the left edge
        if (config.layout === 'horizontal') return 0;
        return config.fadeTime > 0 ? config.fadeTime : (config.layout === 'scatter' ? SCATTER_LIFETIME : 0);
    }

    // Takes the row out once its lifetime has passed, counted from when it was shown (so the
    // history that arrives on connect leaves all together). Called again when the lifetime changes.
    function scheduleFade(row) {
        clearTimeout(row._fadeTimer);
        row._fadeTimer = null;
        const lifetime = messageLifetime();
        if (lifetime <= 0 || row.classList.contains('leaving')) return;
        const left = lifetime * 1000 - (Date.now() - row._shownAt);
        row._fadeTimer = setTimeout(() => leaveRow(row), Math.max(0, left));
    }

    // The way out mirrors the way in chosen under Animación: "Ninguna" removes the row at once,
    // "Deslizar" and "Desvanecer" play their exit animation first (leave-slide / leave-fade in the CSS)
    function leaveRow(row) {
        const remove = () => {
            if (row.parentNode === chatMessagesEl) dropRow(row);
        };
        row.classList.add('leaving');
        if (config.animation === 'none') return remove();
        row.classList.add(`leave-${config.animation}`);
        setTimeout(remove, 400);
    }

    function rescheduleFades() {
        chatMessagesEl.querySelectorAll('.chatterino-line').forEach(row => {
            if (row._shownAt) scheduleFade(row);
        });
    }

    // "Aleatorio": tries a few random spots and keeps the one that covers the other messages least.
    // The spot is stored in % so the message stays inside when the window is resized.
    function placeScattered(row) {
        const area = chatMessagesEl.getBoundingClientRect();
        const w = row.offsetWidth;
        const h = row.offsetHeight;
        const freeX = Math.max(0, area.width - w);
        const freeY = Math.max(0, area.height - h);
        const others = Array.from(chatMessagesEl.children)
            .filter(el => el !== row && el._spot)
            .map(el => el._spot);

        let best = null;
        for (let i = 0; i < 16; i++) {
            const x = Math.random() * freeX;
            const y = Math.random() * freeY;
            const overlap = others.reduce((sum, o) => {
                const ox = Math.max(0, Math.min(x + w, o.x + o.w) - Math.max(x, o.x));
                const oy = Math.max(0, Math.min(y + h, o.y + o.h) - Math.max(y, o.y));
                return sum + ox * oy;
            }, 0);
            if (!best || overlap < best.overlap) best = { x, y, overlap };
            if (overlap === 0) break;
        }

        row._spot = { x: best.x, y: best.y, w, h };
        row.style.left = area.width ? `${(best.x / area.width) * 100}%` : '0';
        row.style.top = area.height ? `${(best.y / area.height) * 100}%` : '0';
    }

    // Ticker rows keep their width in _w, updated when it changes (emotes loading, restyles),
    // so each frame only writes transforms and never asks the page for a layout
    const tickerSizes = typeof ResizeObserver === 'function'
        ? new ResizeObserver(entries => entries.forEach(e => { e.target._w = e.target.offsetWidth; }))
        : null;

    function tickerWidth(row) {
        if (row._w === undefined || !tickerSizes) row._w = row.offsetWidth;
        return row._w;
    }

    let tickerFrame = 0;
    let tickerLast = 0;
    let tickerSpeed = TICKER_MIN_SPEED;
    // Arrival time and width (with the gap) of each recent message, for the chat's pace
    let tickerArrivals = [];

    // "Horizontal": the message starts at the right edge, or right behind the previous one
    // if that one has not fully entered yet. `counts` is false for rows that were already
    // in the chat when switching layout, so they do not look like a burst of new messages.
    function tickerAdd(row, counts = true) {
        const width = chatMessagesEl.clientWidth;
        row._w = row.offsetWidth;
        if (tickerSizes) tickerSizes.observe(row);
        if (counts) tickerArrivals.push({ t: performance.now(), px: row._w + TICKER_GAP });
        const before = Array.from(chatMessagesEl.children).filter(el => el !== row && el._x !== undefined);
        const queued = before.filter(el => el._x >= width);
        while (queued.length >= TICKER_QUEUE_MAX) dropRow(queued.pop());

        // Lines the waiting messages up again behind the last one already on screen
        const shown = before.filter(el => el._x < width && el.isConnected);
        const last = shown[shown.length - 1];
        let x = last ? Math.max(width, last._x + tickerWidth(last) + TICKER_GAP) : width;
        [...queued, row].forEach(el => {
            setTickerX(el, x);
            x += tickerWidth(el) + TICKER_GAP;
        });
        if (!tickerFrame) {
            tickerLast = performance.now();
            tickerFrame = requestAnimationFrame(tickerStep);
        }
    }

    function setTickerX(row, x) {
        row._x = x;
        row.style.transform = `translate(${x}px, -50%)`;
    }

    // Pixels of messages per second arriving lately: the speed that shows them as fast as they come
    function tickerTargetSpeed(now) {
        while (tickerArrivals.length && now - tickerArrivals[0].t > TICKER_RATE_WINDOW) tickerArrivals.shift();
        const px = tickerArrivals.reduce((sum, a) => sum + a.px, 0);
        const pace = px / (TICKER_RATE_WINDOW / 1000);
        return Math.min(TICKER_MAX_SPEED, Math.max(TICKER_MIN_SPEED, pace));
    }

    // Moves every message left at the chat's pace; drops the ones that left the screen
    function tickerStep(now) {
        const dt = Math.min(0.1, (now - tickerLast) / 1000);
        tickerLast = now;
        const rows = Array.from(chatMessagesEl.children);
        if (config.layout !== 'horizontal' || !rows.length) {
            tickerFrame = 0;
            return;
        }

        // Eases toward the new pace over about a second, so a burst does not jolt the line
        tickerSpeed += (tickerTargetSpeed(now) - tickerSpeed) * Math.min(1, dt * 1.5);

        rows.forEach(row => {
            if (row._x === undefined) return;
            const x = row._x - tickerSpeed * dt;
            if (x + tickerWidth(row) < 0) {
                dropRow(row);
            } else {
                setTickerX(row, x);
            }
        });
        tickerFrame = requestAnimationFrame(tickerStep);
    }

    // Switching layout on the settings page: scatter the rows already shown, line them up
    // in the ticker, or put them back in the column
    function relayoutRows() {
        const rows = Array.from(chatMessagesEl.children);
        rows.forEach(row => {
            if (tickerSizes) tickerSizes.unobserve(row);
            row._spot = null;
            row._x = undefined;
            row._w = undefined;
            row.style.left = '';
            row.style.top = '';
            row.style.transform = '';
        });
        if (config.layout === 'scatter') {
            rows.slice(0, -SCATTER_MAX).forEach(dropRow);
            Array.from(chatMessagesEl.children).forEach(placeScattered);
        } else if (config.layout === 'horizontal') {
            // Only the latest few enter the ticker, or it would take minutes to get through them
            rows.slice(0, -5).forEach(dropRow);
            Array.from(chatMessagesEl.children).forEach(row => tickerAdd(row, false));
        }
        rescheduleFades();
    }

    // The row keeps its text: the "Mensajes borrados" mode (CSS on the chat area) hides it,
    // strikes it or swaps it for the notice
    function markDeleted(row) {
        if (row.classList.contains('deleted')) return;
        row.classList.add('deleted');
        const note = document.createElement('span');
        note.className = 'chat-deleted-note';
        note.textContent = '<mensaje borrado>';
        row.appendChild(note);
    }

    function handleMessageDeleted(messageId) {
        const target = chatMessagesEl.querySelector(`[data-id="${messageId}"]`);
        if (target) markDeleted(target);
    }

    // Kick sends a timeout's length in minutes: 10 -> "10m", 90 -> "1h 30m", 1440 -> "1d"
    function formatTimeout(minutes) {
        const units = [['d', 1440], ['h', 60], ['m', 1]];
        const parts = [];
        let left = Math.round(minutes);
        for (const [unit, size] of units) {
            if (left >= size) {
                parts.push(`${Math.floor(left / size)}${unit}`);
                left %= size;
            }
        }
        return parts.slice(0, 2).join(' ');
    }

    // A ban and a timeout both clear the user's messages; a line under them says which one it was
    function handleUserBanned({ username, permanent, duration }) {
        if (!username) return;
        const normalized = username.toLowerCase();
        chatMessagesEl.querySelectorAll(`[data-author="${normalized}"]:not(.system)`).forEach(markDeleted);

        const line = document.createElement('div');
        line.className = 'chatterino-line system';
        const text = document.createElement('span');
        text.className = 'chat-text';
        text.textContent = !permanent && duration > 0
            ? `${username} fue silenciado por ${formatTimeout(duration)}`
            : `${username} fue baneado`;
        line.appendChild(text);
        appendRow(line);
    }

    function startClient() {
        if (client) {
            client.disconnect();
            client = null;
            // A different channel: drop the previous channel's messages
            chatMessagesEl.textContent = '';
        }

        if (!config.channel) {
            setStatus('Configura el canal en ⚙️', 'error');
            openMenu();
            return;
        }

        setStatus(`Conectando a #${config.channel}...`, 'connecting');

        client = new KickChatClient({
            channel: config.channel,
            // The settings page can switch emotes on at any moment, so it always keeps the pack loaded
            sevenTVEmotes: isMenuMode() || config.sevenTVEmotes
        });

        client.addEventListener('connecting', (e) => {
            setStatus(`Conectando a #${e.detail.channel}...`, 'connecting');
        });

        client.addEventListener('connected', (e) => {
            setStatus(`Conectado a #${e.detail.channel}`, 'connected', 3500);
        });

        client.addEventListener('disconnected', () => {
            setStatus('Reconectando...', 'connecting');
        });

        client.addEventListener('error', (e) => {
            setStatus(e.detail?.message || 'Error de conexión', 'error');
        });

        client.addEventListener('message', (e) => {
            // History loaded on connect appears at once, without the entry animation
            addMessage(e.detail, { animate: !e.detail.isHistory });
        });

        client.addEventListener('message_deleted', (e) => {
            handleMessageDeleted(e.detail.messageId);
        });

        client.addEventListener('channel_event', (e) => {
            addChannelEvent(e.detail);
        });

        client.addEventListener('user_banned', (e) => {
            handleUserBanned(e.detail);
        });

        client.connect();
    }

    // -------------------------------------------------------------------------
    // Execution Entry Point
    // -------------------------------------------------------------------------
    window.HolyOptions.setup();
    buildPresetGrid();
    populateMenuFromConfig();
    applyStyles();

    if (isOverlayActive) {
        // Run Overlay Feed (OBS Studio)
        setMode('overlay');
        startClient();
    } else {
        // Settings page: the test chat shows example messages, no Kick connection
        setMode('menu');
        loadMenuChannelPack();
        loadPresetFonts();
        startTemplateFeed();
    }

})();
