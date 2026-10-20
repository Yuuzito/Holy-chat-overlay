/**
 * Kick Chat Overlay Controller
 * - Initial Configurator Menu (Matin Aniss exact layout & options)
 * - Chatterino 2 Style Chat Overlay
 * - 7TV Cosmetics & Emotes integration
 * - Full URL generator & real-time preview
 */

(function () {
    'use strict';

    // Fallback 7TV badge image (only used if the CDN image fails to load)
    const SEVENTV_FALLBACK_BASE64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSIzIiBmaWxsPSIjMGVhNWU5Ii8+PHBhdGggZD0iTTUgNmgxNHYyLjVMMTIuNSAxOEg5bDUtNy41SDVWNnoiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4=';

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
            'badges/admin.svg',
            'badges/gift_blue.svg',
            'badges/gift_mauve.svg',
            'badges/gift_red.svg',
            'badges/gift_yellow.svg',
            'badges/gift_green.svg'
        ];
        badgeUrls.forEach(url => {
            const img = new Image();
            img.src = url;
        });
    }

    if (typeof window !== 'undefined' && window.KickCache) {
        window.KickCache.prune();
    }
    preloadBadges();

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

    const config = {
        // Matin Aniss 10 Options:
        channel: (params.get('channel') || params.get('kick') || (cachedConfig && cachedConfig.channel) || 'rageylo').toLowerCase().trim(),
        sevenTVCosmetics: params.get('sevenTVCosmeticsEnabled') !== null ? (params.get('sevenTVCosmeticsEnabled') === 'true') : (cachedConfig ? cachedConfig.sevenTVCosmetics !== false : true),
        sevenTVEmotes: params.get('sevenTVEmotesEnabled') !== null ? (params.get('sevenTVEmotesEnabled') === 'true') : (cachedConfig ? cachedConfig.sevenTVEmotes !== false : true),
        theme: (params.get('theme') || (cachedConfig && cachedConfig.theme) || 'dark').toLowerCase(),
        textShadow: (params.get('textShadow') || (cachedConfig && cachedConfig.textShadow) || 'small').toLowerCase(),
        textSize: (params.get('textSize') || (cachedConfig && cachedConfig.textSize) || 'medium').toLowerCase(),
        animation: (params.get('animation') || (cachedConfig && cachedConfig.animation) || 'none').toLowerCase(),
        showPin: params.get('showPinEnabled') !== null ? (params.get('showPinEnabled') === 'true') : (cachedConfig ? cachedConfig.showPin === true : false),
        textBg: params.get('textBackgroundEnabled') !== null ? (params.get('textBackgroundEnabled') === 'true') : (cachedConfig ? cachedConfig.textBg === true : false),
        textBgWidth: (params.get('textBackgroundWidth') || (cachedConfig && cachedConfig.textBgWidth) || 'min').toLowerCase(),

        // Additional Chatterino Layout Options:
        fontSize: parseInt(params.get('size'), 10) || textSizeToPx(params.get('textSize') || (cachedConfig && cachedConfig.textSize) || 'medium'),
        timestamps: params.get('timestamps') === 'true',
        altRows: params.get('alt') !== null ? params.get('alt') !== 'false' : (cachedConfig ? cachedConfig.altRows !== false : true),
        header: params.get('header') !== null ? params.get('header') !== 'false' : (cachedConfig ? cachedConfig.header !== false : true),
        badges: params.get('badges') !== null ? params.get('badges') !== 'false' : (cachedConfig ? cachedConfig.badges !== false : true),
        fadeTime: parseInt(params.get('fade'), 10) || (cachedConfig && cachedConfig.fadeTime) || 0,
        limit: parseInt(params.get('limit'), 10) || (cachedConfig && cachedConfig.limit) || 80
    };

    // Ensure fontSize matches textSize
    config.fontSize = textSizeToPx(config.textSize);

    // -------------------------------------------------------------------------
    // DOM Elements
    // -------------------------------------------------------------------------
    const initialMenu = document.getElementById('initialMenu');
    const menuCloseBtn = document.getElementById('menuCloseBtn');
    const overlayContainer = document.getElementById('overlayContainer');

    // Menu form inputs
    const cfgChannel = document.getElementById('cfgChannel');
    const cfg7tvCosmetics = document.getElementById('cfg7tvCosmetics');
    const cfg7tvEmotes = document.getElementById('cfg7tvEmotes');
    const cfgTheme = document.getElementById('cfgTheme');
    const cfgTextShadow = document.getElementById('cfgTextShadow');
    const cfgTextSize = document.getElementById('cfgTextSize');
    const cfgAnimation = document.getElementById('cfgAnimation');
    const cfgPinnedBanner = document.getElementById('cfgPinnedBanner');
    const cfgTextBg = document.getElementById('cfgTextBg');
    const cfgTextBgWidth = document.getElementById('cfgTextBgWidth');
    const cfgPreviewInput = document.getElementById('cfgPreviewInput');
    const btnTestSend = document.getElementById('btnTestSend');
    const menuPreviewBox = document.getElementById('menuPreviewBox');
    const previewLine = document.getElementById('previewLine');
    const previewBadges = document.getElementById('previewBadges');
    const preview7tvBadge = document.getElementById('preview7tvBadge');
    const previewAuthor = document.getElementById('previewAuthor');
    const previewEmoteContainer = document.getElementById('previewEmoteContainer');
    const previewMsgText = document.getElementById('previewMsgText');
    const menuUrlBox = document.getElementById('menuUrlBox');
    const btnLaunchOverlay = document.getElementById('btnLaunchOverlay');
    const btnCopyOverlayUrl = document.getElementById('btnCopyOverlayUrl');
    const btnEmoteOverlay = document.getElementById('btnEmoteOverlay');

    // Overlay feed elements
    const chatArea = document.getElementById('chatArea');
    const chatMessagesEl = document.getElementById('chatMessages');
    const chatterinoHeader = document.getElementById('chatterinoHeader');
    const headerChannelName = document.getElementById('headerChannelName');
    const pinnedBanner = document.getElementById('pinnedBanner');
    const pinnedBannerText = document.getElementById('pinnedBannerText');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const settingsTrigger = document.getElementById('settingsTrigger');

    let client = null;
    let messageCounter = 0;
    let hideStatusTimer = null;

    // -------------------------------------------------------------------------
    // Initial Menu Logic (Real-time preview & URL generator)
    // -------------------------------------------------------------------------

    function populateMenuFromConfig() {
        if (!initialMenu) return;
        if (cfgChannel) cfgChannel.value = config.channel || 'rageylo';
        if (cfg7tvCosmetics) cfg7tvCosmetics.checked = config.sevenTVCosmetics;
        if (cfg7tvEmotes) cfg7tvEmotes.checked = config.sevenTVEmotes;
        if (cfgTheme) cfgTheme.value = config.theme;
        if (cfgTextShadow) cfgTextShadow.value = config.textShadow;
        if (cfgTextSize) cfgTextSize.value = config.textSize;
        if (cfgAnimation) cfgAnimation.value = config.animation;
        if (cfgPinnedBanner) cfgPinnedBanner.checked = config.showPin;
        if (cfgTextBg) cfgTextBg.checked = config.textBg;
        if (cfgTextBgWidth) cfgTextBgWidth.value = config.textBgWidth;

        updateMenuPreviewAndUrl();
    }

    function buildGeneratedUrl(forObs = true) {
        const origin = window.location.origin;
        const pathname = window.location.pathname;
        const ch = (cfgChannel ? cfgChannel.value.trim() : config.channel) || 'rageylo';

        const q = new URLSearchParams();
        q.set('channel', ch);
        q.set('sevenTVCosmeticsEnabled', cfg7tvCosmetics ? String(cfg7tvCosmetics.checked) : 'true');
        q.set('sevenTVEmotesEnabled', cfg7tvEmotes ? String(cfg7tvEmotes.checked) : 'true');
        q.set('theme', cfgTheme ? cfgTheme.value : 'dark');
        q.set('textShadow', cfgTextShadow ? cfgTextShadow.value : 'small');
        q.set('textSize', cfgTextSize ? cfgTextSize.value : 'medium');
        q.set('animation', cfgAnimation ? cfgAnimation.value : 'none');
        q.set('showPinEnabled', cfgPinnedBanner ? String(cfgPinnedBanner.checked) : 'false');
        q.set('textBackgroundEnabled', cfgTextBg ? String(cfgTextBg.checked) : 'false');
        q.set('textBackgroundWidth', cfgTextBgWidth ? cfgTextBgWidth.value : 'min');
        if (forObs) {
            q.set('overlay', 'true');
        }

        return `${origin}${pathname}?${q.toString()}`;
    }

    function updateMenuPreviewAndUrl() {
        if (!initialMenu) return;
        const fullUrl = buildGeneratedUrl();
        if (menuUrlBox) {
            menuUrlBox.textContent = fullUrl;
        }

        // 7TV Cosmetics toggle in Preview (Badges + Author Name Style)
        const has7tvCosmetics = cfg7tvCosmetics ? cfg7tvCosmetics.checked : true;
        if (preview7tvBadge) {
            preview7tvBadge.style.display = has7tvCosmetics ? 'inline-block' : 'none';
        }
        if (previewAuthor) {
            if (has7tvCosmetics) {
                // 7TV supporter cosmetics style (vibrant paint gradient)
                previewAuthor.style.backgroundImage = 'linear-gradient(90deg, #ff007f, #7928ca, #0070f3, #00dfd8)';
                previewAuthor.style.webkitBackgroundClip = 'text';
                previewAuthor.style.backgroundClip = 'text';
                previewAuthor.style.webkitTextFillColor = 'transparent';
                previewAuthor.style.color = 'transparent';
                previewAuthor.style.textShadow = 'none';
            } else {
                // Native Kick username color
                previewAuthor.style.backgroundImage = 'none';
                previewAuthor.style.webkitBackgroundClip = '';
                previewAuthor.style.backgroundClip = '';
                previewAuthor.style.webkitTextFillColor = '';
                previewAuthor.style.color = '#53fc18';
                previewAuthor.style.textShadow = 'none';
            }
        }

        // 7TV Emotes toggle & Dynamic parsing of the preview message text using the selected channel's emote pack
        const has7tvEmotes = cfg7tvEmotes ? cfg7tvEmotes.checked : true;
        const currentChannel = (cfgChannel ? cfgChannel.value.trim().toLowerCase() : config.channel) || 'rageylo';
        const channelEmotes = (client && client.channelSlug === currentChannel) ? client.emotes : (window.KickChatClient ? KickChatClient.getChannelEmotes(currentChannel) : null);
        const rawMessage = (cfgPreviewInput ? cfgPreviewInput.value : 'Hola, este es un mensaje de prueba jeje Rlove') || 'Hola, este es un mensaje de prueba jeje Rlove';

        if (previewMsgText) {
            if (window.KickChatClient && KickChatClient.parseContentToHtml) {
                previewMsgText.innerHTML = KickChatClient.parseContentToHtml(rawMessage, {
                    sevenTVEmotes: has7tvEmotes,
                    emotes: channelEmotes,
                    channel: currentChannel
                });
            } else {
                previewMsgText.textContent = rawMessage;
            }
        }

        // Live Preview Box Styling
        if (menuPreviewBox && previewMsgText) {
            const currentTheme = cfgTheme ? cfgTheme.value : 'dark';
            menuPreviewBox.className = `menu-preview-box theme-${currentTheme}`;

            const currentShadow = cfgTextShadow ? cfgTextShadow.value : 'small';
            previewMsgText.className = `preview-msg-text chat-text shadow-${currentShadow}`;

            switch (currentShadow) {
                case 'none':
                    previewMsgText.style.textShadow = 'none';
                    break;
                case 'small':
                    previewMsgText.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.8)';
                    break;
                case 'medium':
                    previewMsgText.style.textShadow = '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 1px #000';
                    break;
                case 'large':
                    previewMsgText.style.textShadow = '0 0 4px #000, 0 0 8px #000, 0 2px 4px rgba(0,0,0,0.9)';
                    break;
            }

            const currentSize = cfgTextSize ? cfgTextSize.value : 'medium';
            const pxSize = textSizeToPx(currentSize);
            if (previewLine) previewLine.style.fontSize = `${pxSize}px`;
            previewMsgText.style.fontSize = `${pxSize}px`;

            const hasTextBg = cfgTextBg ? cfgTextBg.checked : false;
            const bgWidth = cfgTextBgWidth ? cfgTextBgWidth.value : 'min';

            if (hasTextBg) {
                previewMsgText.style.background = 'rgba(0, 0, 0, 0.65)';
                previewMsgText.style.padding = '2px 8px';
                previewMsgText.style.borderRadius = '4px';
                previewMsgText.style.display = bgWidth === 'max' ? 'block' : 'inline-block';
                previewMsgText.style.width = bgWidth === 'max' ? '100%' : 'fit-content';
            } else {
                previewMsgText.style.background = 'transparent';
                previewMsgText.style.padding = '0';
                previewMsgText.style.borderRadius = '0';
                previewMsgText.style.display = 'inline';
                previewMsgText.style.width = 'auto';
            }
        }

        // Save current menu settings to cache
        if (typeof window !== 'undefined' && window.KickCache) {
            window.KickCache.set('overlay_settings', {
                channel: cfgChannel ? cfgChannel.value.trim().toLowerCase() : config.channel,
                sevenTVCosmetics: cfg7tvCosmetics ? cfg7tvCosmetics.checked : true,
                sevenTVEmotes: cfg7tvEmotes ? cfg7tvEmotes.checked : true,
                theme: cfgTheme ? cfgTheme.value : 'dark',
                textShadow: cfgTextShadow ? cfgTextShadow.value : 'small',
                textSize: cfgTextSize ? cfgTextSize.value : 'medium',
                animation: cfgAnimation ? cfgAnimation.value : 'none',
                showPin: cfgPinnedBanner ? cfgPinnedBanner.checked : false,
                textBg: cfgTextBg ? cfgTextBg.checked : false,
                textBgWidth: cfgTextBgWidth ? cfgTextBgWidth.value : 'min'
            }, 30 * 24 * 60 * 60 * 1000);
        }
    }

    function launchOverlayFromMenu() {
        isOverlayActive = true;
        config.channel = (cfgChannel ? cfgChannel.value.trim().toLowerCase() : config.channel) || 'rageylo';
        config.sevenTVCosmetics = cfg7tvCosmetics ? cfg7tvCosmetics.checked : true;
        config.sevenTVEmotes = cfg7tvEmotes ? cfg7tvEmotes.checked : true;
        config.theme = cfgTheme ? cfgTheme.value : 'dark';
        config.textShadow = cfgTextShadow ? cfgTextShadow.value : 'small';
        config.textSize = cfgTextSize ? cfgTextSize.value : 'medium';
        config.fontSize = textSizeToPx(config.textSize);
        config.animation = cfgAnimation ? cfgAnimation.value : 'none';
        config.showPin = cfgPinnedBanner ? cfgPinnedBanner.checked : false;
        config.textBg = cfgTextBg ? cfgTextBg.checked : false;
        config.textBgWidth = cfgTextBgWidth ? cfgTextBgWidth.value : 'min';

        applyStyles();
        if (!client || client.channelSlug !== config.channel || client.sevenTVEmotes !== config.sevenTVEmotes) {
            startClient();
        }

        if (initialMenu) initialMenu.classList.add('hidden');
        if (overlayContainer) overlayContainer.classList.remove('hidden');

        try {
            // Keep regular browser clean so refresh always reopens the menu
            window.history.pushState({}, '', buildGeneratedUrl(false));
        } catch (e) {}
    }

    function openMenu() {
        if (!initialMenu) return;
        populateMenuFromConfig();
        if (menuCloseBtn) menuCloseBtn.classList.remove('hidden');
        if (btnLaunchOverlay) btnLaunchOverlay.textContent = '💾 Guardar y Volver al Chat';
        initialMenu.classList.remove('hidden');
    }

    function closeMenu() {
        launchOverlayFromMenu();
    }

    function copyGeneratedUrl() {
        const textToCopy = buildGeneratedUrl(true);
        navigator.clipboard.writeText(textToCopy).then(() => {
            const btn = btnCopyOverlayUrl || menuUrlBox;
            const oldText = btn.textContent;
            btn.textContent = '¡Copiado al portapapeles!';
            if (btnCopyOverlayUrl) {
                btnCopyOverlayUrl.style.borderColor = '#53fc18';
                btnCopyOverlayUrl.style.color = '#53fc18';
            }
            setTimeout(() => {
                btn.textContent = oldText;
                if (btnCopyOverlayUrl) {
                    btnCopyOverlayUrl.style.borderColor = '';
                    btnCopyOverlayUrl.style.color = '';
                }
                updateMenuPreviewAndUrl();
            }, 2000);
        }).catch(() => {
            prompt('Copia este enlace para OBS Studio:', textToCopy);
        });
    }

    function sendTestChatMessage() {
        const rawText = (cfgPreviewInput ? cfgPreviewInput.value.trim() : '') || 'Hola, este es un mensaje de prueba jeje Rlove';
        const has7tvEmotes = cfg7tvEmotes ? cfg7tvEmotes.checked : true;
        const has7tvCosmetics = cfg7tvCosmetics ? cfg7tvCosmetics.checked : true;

        const parsedHtml = (window.KickChatClient && KickChatClient.parseContentToHtml)
            ? KickChatClient.parseContentToHtml(rawText, { sevenTVEmotes: has7tvEmotes })
            : rawText;

        const testMsg = {
            id: `test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            chatroomId: (client && client.chatroomId) || 18761973,
            content: rawText,
            html: parsedHtml,
            createdAt: new Date().toISOString(),
            sender: {
                id: 19996585,
                username: 'Yuuzito',
                slug: 'yuuzito',
                color: '#53fc18',
                badges: [
                    { type: 'founder', text: 'Fundador', imageUrl: 'badges/founder.svg' },
                    { type: 'subscriber', text: 'Suscriptor', imageUrl: 'badges/subscriber.svg' }
                ]
            },
            sevenTv: has7tvCosmetics ? {
                badge: { type: '7tv', text: '7TV Supporter', imageUrl: SEVENTV_FALLBACK_BASE64 },
                paint: { background: 'linear-gradient(90deg, #ff007f, #7928ca, #0070f3, #00dfd8)' }
            } : null
        };

        addMessage(testMsg);

        if (btnTestSend) {
            const origHtml = btnTestSend.innerHTML;
            btnTestSend.innerHTML = '✅ ¡Enviado!';
            btnTestSend.style.borderColor = '#53fc18';
            btnTestSend.style.color = '#53fc18';
            setTimeout(() => {
                btnTestSend.innerHTML = origHtml;
                btnTestSend.style.borderColor = '';
                btnTestSend.style.color = '';
            }, 1800);
        }
    }

    // Attach menu input listeners
    [cfgChannel, cfgPreviewInput].forEach(el => {
        if (el) el.addEventListener('input', updateMenuPreviewAndUrl);
    });

    if (cfgPreviewInput) {
        cfgPreviewInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendTestChatMessage();
            }
        });
    }

    if (btnTestSend) {
        btnTestSend.addEventListener('click', sendTestChatMessage);
    }

    window.addEventListener('emotes_loaded', updateMenuPreviewAndUrl);
    window.addEventListener('channel_emotes_loaded', updateMenuPreviewAndUrl);

    if (cfgChannel) {
        cfgChannel.addEventListener('input', () => {
            updateMenuPreviewAndUrl();
            const ch = cfgChannel.value.trim().toLowerCase();
            if (ch && window.KickChatClient && KickChatClient.loadChannelPack) {
                KickChatClient.loadChannelPack(ch);
            }
        });
    }

    [cfg7tvCosmetics, cfg7tvEmotes, cfgTheme, cfgTextShadow, cfgTextSize, cfgAnimation, cfgPinnedBanner, cfgTextBg, cfgTextBgWidth].forEach(el => {
        if (el) el.addEventListener('change', updateMenuPreviewAndUrl);
    });

    if (menuUrlBox) menuUrlBox.addEventListener('click', copyGeneratedUrl);
    if (btnCopyOverlayUrl) btnCopyOverlayUrl.addEventListener('click', copyGeneratedUrl);

    if (btnLaunchOverlay) {
        btnLaunchOverlay.addEventListener('click', launchOverlayFromMenu);
    }

    if (btnEmoteOverlay) {
        btnEmoteOverlay.addEventListener('click', () => {
            // Quick toggle to show emote testing or xQc / rageylo
            if (cfgChannel) {
                cfgChannel.value = cfgChannel.value === 'xQc' ? 'rageylo' : 'xQc';
                updateMenuPreviewAndUrl();
            }
        });
    }

    if (settingsTrigger) settingsTrigger.addEventListener('click', openMenu);
    if (menuCloseBtn) menuCloseBtn.addEventListener('click', closeMenu);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (initialMenu && !initialMenu.classList.contains('hidden') && isOverlayActive) {
                closeMenu();
            }
        } else if ((e.key === 'c' || e.key === 'C') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
            if (initialMenu && !initialMenu.classList.contains('hidden')) {
                if (isOverlayActive) closeMenu();
            } else {
                openMenu();
            }
        }
    });

    // -------------------------------------------------------------------------
    // Overlay Application & Styles
    // -------------------------------------------------------------------------

    function applyStyles() {
        document.documentElement.style.setProperty('--font-size', `${config.fontSize}px`);

        // Theme
        document.body.classList.remove('theme-dark', 'theme-light', 'theme-transparent');
        document.body.classList.add(`theme-${config.theme}`);

        // Shadow & Text Background
        if (chatArea) {
            chatArea.classList.remove('shadow-none', 'shadow-small', 'shadow-medium', 'shadow-large');
            chatArea.classList.add(`shadow-${config.textShadow}`);
            chatArea.classList.toggle('text-bg-enabled', config.textBg);
            chatArea.classList.toggle('text-bg-max', config.textBgWidth === 'max');
        }

        // Pinned Banner
        if (pinnedBanner) {
            pinnedBanner.classList.toggle('hidden', !config.showPin);
            if (pinnedBannerText) {
                pinnedBannerText.textContent = `Mensaje fijado: Bienvenidos al chat de Kick #${config.channel}`;
            }
        }

        // Header
        if (chatterinoHeader) {
            chatterinoHeader.classList.toggle('hidden', !config.header);
            if (headerChannelName) headerChannelName.textContent = `#${config.channel}`;
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
        img.src = b.imageUrl;
        img.alt = b.text || b.type || 'badge';
        img.title = b.text || b.type || '';
        if (b.type === '7tv') {
            img.onerror = function () {
                this.onerror = null;
                this.src = SEVENTV_FALLBACK_BASE64;
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

        // 2) Sombra y filtros de paint
        if (paint.filter) {
            authorSpan.style.filter = paint.filter;
        }

        // 3) Aplicación de Paint (URL/Imagen o Gradiente)
        if (paint.function === 'URL' && paint.image_url) {
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
     * Appends Chatterino-styled message row
     */
    function addMessage(msg) {
        messageCounter++;
        const row = document.createElement('div');
        row.className = 'chatterino-line';
        row.dataset.id = msg.id;

        // Animation classes
        if (config.animation === 'slide') row.classList.add('anim-slide');
        else if (config.animation === 'fade') row.classList.add('anim-fade');

        const author = (msg.sender?.username || 'Anónimo').toLowerCase();
        row.dataset.author = author;

        // Alternating row background (Chatterino feature)
        if (config.altRows && messageCounter % 2 === 0) {
            row.classList.add('alt-row');
        }

        // Mention / Highlight (Chatterino highlight)
        const contentLower = (msg.content || '').toLowerCase();
        if (contentLower.includes(config.channel) || contentLower.includes('@' + config.channel)) {
            row.classList.add('highlight');
        }

        // Timestamp span (only if explicitly enabled)
        if (config.timestamps) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'chat-time';
            timeSpan.textContent = formatTime(msg.createdAt);
            row.appendChild(timeSpan);
        }

        // Badges element (Kick native; 7TV badge is prepended when style resolves)
        const badgesEl = renderBadgesElement(msg.sender?.badges);
        if (badgesEl) {
            row.appendChild(badgesEl);
        }

        // Author username
        const authorSpan = document.createElement('span');
        authorSpan.className = 'chat-author';
        let authorColor = msg.sender?.color;
        if (!authorColor || authorColor === '#000000' || authorColor === '#000' || authorColor === 'transparent' || authorColor.toLowerCase() === 'black') {
            authorColor = client ? client.generateUserColor(msg.sender?.username || 'user') : '#53fc18';
        }
        authorSpan.style.color = authorColor;
        authorSpan.textContent = msg.sender?.username || 'Anónimo';
        row.appendChild(authorSpan);

        // 7TV cosmetics (badge, name color, paint)
        if (config.sevenTVCosmetics) {
            if (msg.sevenTv) {
                if (badgesEl && msg.sevenTv.badge && config.badges) badgesEl.prepend(createBadgeImg(msg.sevenTv.badge));
                applySevenTVNameStyle(authorSpan, msg.sevenTv);
            } else if (client && msg.sender?.id) {
                client.get7TVStyle(msg.sender.id).then(style => {
                    if (!style) return;
                    if (badgesEl && style.badge && config.badges) badgesEl.prepend(createBadgeImg(style.badge));
                    applySevenTVNameStyle(authorSpan, style);
                });
            }
        }

        // Colon
        const colonSpan = document.createElement('span');
        colonSpan.className = 'colon';
        colonSpan.textContent = ':';
        row.appendChild(colonSpan);

        // Content
        const contentSpan = document.createElement('span');
        contentSpan.className = 'chat-text';
        contentSpan.innerHTML = msg.html || msg.content || '';
        row.appendChild(contentSpan);

        chatMessagesEl.appendChild(row);

        // Keep within limit
        while (chatMessagesEl.children.length > config.limit) {
            chatMessagesEl.removeChild(chatMessagesEl.firstElementChild);
        }

        // Auto fade out if configured
        if (config.fadeTime > 0) {
            setTimeout(() => {
                row.classList.add('fade-out');
                setTimeout(() => {
                    if (row.parentNode === chatMessagesEl) {
                        chatMessagesEl.removeChild(row);
                    }
                }, 400);
            }, config.fadeTime * 1000);
        }
    }

    function handleMessageDeleted(messageId) {
        const target = chatMessagesEl.querySelector(`[data-id="${messageId}"]`);
        if (target) {
            target.classList.add('deleted');
            const textSpan = target.querySelector('.chat-text');
            if (textSpan) textSpan.textContent = '<message deleted>';
        }
    }

    function handleUserBanned(username) {
        if (!username) return;
        const normalized = username.toLowerCase();
        const messages = chatMessagesEl.querySelectorAll(`[data-author="${normalized}"]`);
        messages.forEach(el => {
            el.classList.add('deleted');
            const textSpan = el.querySelector('.chat-text');
            if (textSpan) textSpan.textContent = '<message deleted>';
        });
    }

    function startClient() {
        if (client) {
            client.disconnect();
            client = null;
        }

        if (!config.channel) {
            setStatus('Configura el canal en ⚙️', 'error');
            openMenu();
            return;
        }

        setStatus(`Conectando a #${config.channel}...`, 'connecting');

        client = new KickChatClient({
            channel: config.channel,
            sevenTVEmotes: config.sevenTVEmotes
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
            addMessage(e.detail);
        });

        client.addEventListener('message_deleted', (e) => {
            handleMessageDeleted(e.detail.messageId);
        });

        client.addEventListener('user_banned', (e) => {
            handleUserBanned(e.detail.username);
        });

        client.connect();
    }

    // -------------------------------------------------------------------------
    // Execution Entry Point
    // -------------------------------------------------------------------------
    populateMenuFromConfig();

    if (isOverlayActive) {
        // Run Overlay Feed (OBS Studio)
        if (initialMenu) initialMenu.classList.add('hidden');
        if (overlayContainer) overlayContainer.classList.remove('hidden');
        applyStyles();
        startClient();
    } else {
        // Show Initial Menu
        if (initialMenu) initialMenu.classList.remove('hidden');
        if (overlayContainer) overlayContainer.classList.add('hidden');
    }

})();
