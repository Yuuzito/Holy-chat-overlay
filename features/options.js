/**
 * Holy Chat - the Botrix-style options that app.js doesn't own: message style (design),
 * direction, background color, ignored users, sound, donations, rewards, Kick icon and time.
 * Reads them from the URL / saved settings, writes them back, and keeps their controls on the
 * settings page in step. Loaded after features/catalog.js and before app.js.
 */
(function () {
    'use strict';

    const Catalog = window.HolyCatalog;
    const $ = id => document.getElementById(id);

    const DIRECTIONS = ['bottom', 'top'];
    // Stepped sliders this module adds to app.js's STEPS
    const STEPS = {
        direction: { values: DIRECTIONS, labels: ['Abajo', 'Arriba'] }
    };

    // "a,  B ,,c" -> "a, b, c"
    function nameList(text) {
        return (text || '').split(',').map(n => n.trim().toLowerCase().replace(/^@/, '')).filter(Boolean).join(', ');
    }

    // "#rgb", "#rrggbb" or "#rrggbbaa" -> "#rrggbbaa"; anything else (or alpha 0) -> no background
    function hexColor(value) {
        let hex = String(value || '').trim().replace(/^#/, '').toLowerCase();
        if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map(c => c + c).join('');
        if (/^[0-9a-f]{6}$/.test(hex)) hex += 'ff';
        if (!/^[0-9a-f]{8}$/.test(hex) || hex.endsWith('00')) return '';
        return `#${hex}`;
    }

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    // URL first, then the saved settings, then the default
    function pick(params, cached, param, key, fallback) {
        if (params.get(param) !== null) return params.get(param);
        if (cached && cached[key] !== undefined) return cached[key];
        return fallback;
    }

    function bool(value) {
        return value === true || value === 'true';
    }

    function parse(params, cached) {
        const volume = Number(pick(params, cached, 'sound', 'soundVolume', 0));
        return {
            design: Catalog.design(pick(params, cached, 'design', 'design', 'chatterino')).id,
            direction: DIRECTIONS.includes(pick(params, cached, 'direction', 'direction', 'bottom')) ? pick(params, cached, 'direction', 'direction', 'bottom') : 'bottom',
            background: hexColor(pick(params, cached, 'background', 'background', '')),
            ignoredUsers: nameList(pick(params, cached, 'ignoredUsers', 'ignoredUsers', '')),
            // `sound` in the URL is the volume, 0 = off. The saved settings keep the volume
            // apart, so switching the sound off and on again remembers it.
            soundOn: params.get('sound') !== null ? volume > 0 : bool(cached && cached.soundOn),
            soundVolume: volume > 0 ? clamp(Math.round(volume), 1, 100) : 50,
            soundType: Catalog.soundId(pick(params, cached, 'soundType', 'soundType', 'default')),
            donations: bool(pick(params, cached, 'donations', 'donations', true)),
            rewards: bool(pick(params, cached, 'rewards', 'rewards', false)),
            platformIcon: bool(pick(params, cached, 'platformIcon', 'platformIcon', false)),
            timestamps: bool(pick(params, cached, 'timestamps', 'timestamps', false))
        };
    }

    function toQuery(config, q) {
        if (config.design !== 'chatterino') q.set('design', config.design);
        if (config.direction !== 'bottom') q.set('direction', config.direction);
        if (config.background) q.set('background', config.background);
        if (config.ignoredUsers) q.set('ignoredUsers', config.ignoredUsers);
        if (config.soundOn) {
            q.set('sound', String(config.soundVolume));
            if (config.soundType !== 'default') q.set('soundType', config.soundType);
        }
        q.set('donations', String(config.donations));
        q.set('rewards', String(config.rewards));
        if (config.platformIcon) q.set('platformIcon', 'true');
        if (config.timestamps) q.set('timestamps', 'true');
    }

    function toCache(config) {
        const keys = ['design', 'direction', 'background', 'ignoredUsers', 'soundOn', 'soundVolume', 'soundType', 'donations', 'rewards', 'platformIcon', 'timestamps'];
        return Object.fromEntries(keys.map(k => [k, config[k]]));
    }

    // ---------- Settings page ----------
    const el = {};

    function setup() {
        ['cfgDesign', 'designNote', 'cfgDirection', 'fieldDirection', 'cfgBgColor', 'cfgBgAlpha', 'cfgSound', 'fieldSound',
            'cfgSoundType', 'cfgSoundVolume', 'cfgDonations', 'cfgRewards', 'fieldEvents', 'cfgPlatformIcon', 'cfgTimestamps',
            'cfgIgnoredUsers'].forEach(id => { el[id] = $(id); });

        if (el.cfgDesign) {
            Catalog.DESIGNS.forEach(d => el.cfgDesign.add(new Option(d.name, d.id)));
        }
        if (el.cfgSoundType) {
            Catalog.SOUNDS.forEach(s => el.cfgSoundType.add(new Option(s.name, s.id)));
        }
        // Picking a sound plays it, so it can be heard before choosing
        if (el.cfgSoundType) el.cfgSoundType.addEventListener('change', () => preview());
        if (el.cfgSound) el.cfgSound.addEventListener('change', () => { if (el.cfgSound.checked) preview(); });
        if (el.cfgSoundVolume) el.cfgSoundVolume.addEventListener('change', () => preview());
    }

    function preview() {
        if (!window.HolySound || !el.cfgSound || !el.cfgSound.checked) return;
        HolySound.unlock();
        // The context may need a moment to start after the first click
        setTimeout(() => HolySound.play(el.cfgSoundType.value, Number(el.cfgSoundVolume.value)), 60);
    }

    function populate(config) {
        if (el.cfgDesign) el.cfgDesign.value = config.design;
        if (el.cfgDirection) el.cfgDirection.value = DIRECTIONS.indexOf(config.direction);
        if (el.cfgBgColor) el.cfgBgColor.value = config.background ? config.background.slice(0, 7) : '#000000';
        if (el.cfgBgAlpha) el.cfgBgAlpha.value = config.background ? Math.round(parseInt(config.background.slice(7), 16) / 255 * 100) : 0;
        if (el.cfgSound) el.cfgSound.checked = config.soundOn;
        if (el.cfgSoundType) el.cfgSoundType.value = config.soundType;
        if (el.cfgSoundVolume) el.cfgSoundVolume.value = config.soundVolume;
        if (el.cfgDonations) el.cfgDonations.checked = config.donations;
        if (el.cfgRewards) el.cfgRewards.checked = config.rewards;
        if (el.cfgPlatformIcon) el.cfgPlatformIcon.checked = config.platformIcon;
        if (el.cfgTimestamps) el.cfgTimestamps.checked = config.timestamps;
        if (el.cfgIgnoredUsers) el.cfgIgnoredUsers.value = config.ignoredUsers;
        updateFields(config);
    }

    function read(config) {
        if (el.cfgDesign) config.design = Catalog.design(el.cfgDesign.value).id;
        if (el.cfgDirection) config.direction = DIRECTIONS[Number(el.cfgDirection.value)] || 'bottom';
        if (el.cfgBgColor && el.cfgBgAlpha) {
            const alpha = Math.round(Number(el.cfgBgAlpha.value) / 100 * 255).toString(16).padStart(2, '0');
            config.background = hexColor(el.cfgBgColor.value + alpha);
        }
        if (el.cfgSound) config.soundOn = el.cfgSound.checked;
        if (el.cfgSoundType) config.soundType = Catalog.soundId(el.cfgSoundType.value);
        if (el.cfgSoundVolume) config.soundVolume = clamp(Number(el.cfgSoundVolume.value) || 50, 1, 100);
        if (el.cfgDonations) config.donations = el.cfgDonations.checked;
        if (el.cfgRewards) config.rewards = el.cfgRewards.checked;
        if (el.cfgPlatformIcon) config.platformIcon = el.cfgPlatformIcon.checked;
        if (el.cfgTimestamps) config.timestamps = el.cfgTimestamps.checked;
        if (el.cfgIgnoredUsers) config.ignoredUsers = nameList(el.cfgIgnoredUsers.value);
        updateFields(config);
    }

    // Controls the chosen design doesn't use are dimmed, and the note under Estilo says which
    function updateFields(config) {
        const shows = cap => Catalog.designShows(config.design, cap);
        const off = (node, isOff) => { if (node) node.classList.toggle('is-off', isOff); };
        off(el.fieldDirection, !shows('direction') || config.layout !== 'vertical');
        off(el.fieldSound, !config.soundOn);
        off(el.fieldEvents, !shows('events'));
        off(el.cfgTimestamps && el.cfgTimestamps.closest('.hc-switch'), !shows('time'));
        off(el.cfgPlatformIcon && el.cfgPlatformIcon.closest('.hc-switch'), !shows('icon'));
        if (el.designNote) {
            const hidden = (Catalog.design(config.design).hides || []).map(cap => Catalog.CAPABILITY_LABELS[cap]);
            el.designNote.textContent = hidden.length ? `Este estilo no muestra ${hidden.join(', ')}.` : '';
            el.designNote.classList.toggle('hidden', !hidden.length);
        }
    }

    // ---------- Chat window ----------
    function apply(config, container, chatArea) {
        const design = Catalog.design(config.design);
        Array.from(container.classList).filter(c => c.startsWith('design-')).forEach(c => container.classList.remove(c));
        container.classList.toggle('has-design', design.id !== 'chatterino');
        if (design.id !== 'chatterino') container.classList.add(`design-${design.id}`);
        if (design.stacked) container.classList.add('design-stacked');
        if (design.columns) container.classList.add('design-columns');

        container.classList.toggle('has-widget-bg', Boolean(config.background));
        container.style.setProperty('--widget-bg', config.background || 'transparent');

        if (chatArea) chatArea.classList.toggle('dir-top', config.direction === 'top' && Catalog.designShows(design.id, 'direction'));
    }

    function isIgnored(config, author) {
        return Boolean(author) && Boolean(config.ignoredUsers) && config.ignoredUsers.split(', ').includes(author);
    }

    // Whether a donation / reward row is shown with these settings
    function showsEvent(config, evt) {
        if (!Catalog.designShows(config.design, 'events')) return false;
        if (isIgnored(config, (evt.username || '').toLowerCase())) return false;
        return evt.kind === 'donation' ? config.donations : config.rewards;
    }

    // Plays the new message sound, if it is on
    function playSound(config) {
        if (config.soundOn && window.HolySound) HolySound.play(config.soundType, config.soundVolume);
    }

    window.HolyOptions = { STEPS, parse, toQuery, toCache, setup, populate, read, apply, isIgnored, showsEvent, playSound, nameList };
})();
