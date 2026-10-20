/**
 * Holy Chat - catalogs for the Botrix-style options: message designs, entry animations,
 * extra fonts and message sounds. Loaded before app.js, which reads window.HolyCatalog.
 */
(function () {
    'use strict';

    // Message designs. `stacked` puts the name above the text, `columns` lines names up on the
    // left, `font` is the design's own font (used when Fuente is "Automática"), `layout` is the
    // Disposición the settings page switches to when the design is picked, and `hides` lists
    // what the design leaves out: time, direction, icon and events.
    const DESIGNS = [
        { id: 'chatterino', name: 'Chatterino' },
        { id: 'default', name: 'Tarjetas' },
        { id: 'aurora', name: 'Aurora' },
        { id: 'bubbles', name: 'Burbujas', stacked: true, hides: ['time'] },
        { id: 'cake', name: 'Pastel', stacked: true, hides: ['time'] },
        { id: 'carbon', name: 'Carbono' },
        { id: 'glass', name: 'Vidrio' },
        { id: 'minimal', name: 'Mínimo' },
        { id: 'platform-accent', name: 'Acento Kick', stacked: true },
        { id: 'side', name: 'Columnas', columns: true, hides: ['time', 'events'] },
        { id: 'streamline', name: 'Cinta simple', layout: 'horizontal', hides: ['time', 'direction'] },
        { id: 'transparent', name: 'Transparente' },
        { id: 'white', name: 'Blanco' },
        { id: 'hacker', name: 'Hacker', font: 'inconsolata', hides: ['icon'] },
        { id: 'neon', name: 'Neón' },
        { id: 'neoncards', name: 'Tarjetas neón', stacked: true },
        { id: 'pastelpop', name: 'Pastel pop', stacked: true },
        { id: 'pixelquest', name: 'Pixel Quest', stacked: true, font: 'press-start-2p' },
        { id: 'rounded', name: 'Redondeado', stacked: true, hides: ['time'] },
        { id: 'sky', name: 'Cielo', stacked: true, hides: ['time'] },
        { id: 'sunset', name: 'Atardecer' },
        { id: 'windowglass', name: 'Ventana', stacked: true },
        { id: 'whatschat', name: 'Mensajería', stacked: true },
        { id: 'retro', name: 'Retro', font: 'space-mono' },
        { id: 'velvet', name: 'Terciopelo', layout: 'horizontal', hides: ['direction'] },
        { id: 'winxp', name: 'Windows XP', stacked: true, font: 'tahoma', windowButtons: true },
        { id: 'frutigeraero', name: 'Frutiger Aero', font: 'segoe-ui' },
        { id: 'liquidglass', name: 'Liquid Glass' }
    ];

    // What a hidden capability is called in the settings page's note under Estilo
    const CAPABILITY_LABELS = {
        time: 'hora',
        direction: 'dirección',
        icon: 'icono de Kick',
        events: 'donaciones ni recompensas'
    };

    // Entry animations. The first three keep the ids older links use.
    const ANIMATIONS = [
        { id: 'none', name: 'Ninguna' },
        { id: 'slide', name: 'Deslizar' },
        { id: 'fade', name: 'Desvanecer' },
        { id: 'pop', name: 'Aparecer' },
        { id: 'bounce', name: 'Rebote' },
        { id: 'zoom', name: 'Zoom' },
        { id: 'flip', name: 'Voltear' },
        { id: 'rotate', name: 'Girar' },
        { id: 'swing', name: 'Columpio' },
        { id: 'roll', name: 'Rodar' }
    ];

    // Fonts added to the project's FONTS (same shape). `weights` lists only the weights each
    // Google Fonts family has; a family without `weights` is installed with the system.
    const EXTRA_FONTS = {
        arial: { name: 'Arial' },
        'times-new-roman': { name: 'Times New Roman' },
        verdana: { name: 'Verdana' },
        georgia: { name: 'Georgia' },
        impact: { name: 'Impact' },
        tahoma: { name: 'Tahoma' },
        'segoe-ui': { name: 'Segoe UI' },
        'dancing-script': { name: 'Dancing Script', weights: '400;500;600;700' },
        cinzel: { name: 'Cinzel', weights: '400;500;600;700;800' },
        lobster: { name: 'Lobster', weights: '400' },
        teko: { name: 'Teko', weights: '400;500;600;700' },
        'russo-one': { name: 'Russo One', weights: '400' },
        inconsolata: { name: 'Inconsolata', weights: '400;500;600;700;800' },
        'press-start-2p': { name: 'Press Start 2P', weights: '400' },
        'space-mono': { name: 'Space Mono', weights: '400;700' },
        eczar: { name: 'Eczar', weights: '400;500;600;700;800' },
        'inknut-antiqua': { name: 'Inknut Antiqua', weights: '400;500;600;700;800' },
        lora: { name: 'Lora', weights: '400;500;600;700' },
        'londrina-outline': { name: 'Londrina Outline', weights: '400' },
        merriweather: { name: 'Merriweather', weights: '400;700' },
        monoton: { name: 'Monoton', weights: '400' },
        'noto-sans': { name: 'Noto Sans', weights: '400;500;600;700;800' },
        'noto-serif': { name: 'Noto Serif', weights: '400;500;600;700;800' },
        oswald: { name: 'Oswald', weights: '400;500;600;700' },
        'playfair-display': { name: 'Playfair Display', weights: '400;500;600;700;800' },
        abel: { name: 'Abel', weights: '400' },
        'abril-fatface': { name: 'Abril Fatface', weights: '400' },
        aclonica: { name: 'Aclonica', weights: '400' },
        acme: { name: 'Acme', weights: '400' },
        actor: { name: 'Actor', weights: '400' },
        adamina: { name: 'Adamina', weights: '400' },
        'advent-pro': { name: 'Advent Pro', weights: '400;500;600;700;800' },
        'aguafina-script': { name: 'Aguafina Script', weights: '400' },
        akronim: { name: 'Akronim', weights: '400' },
        aladin: { name: 'Aladin', weights: '400' },
        aldrich: { name: 'Aldrich', weights: '400' },
        alegreya: { name: 'Alegreya', weights: '400;500;600;700;800' },
        raleway: { name: 'Raleway', weights: '400;500;600;700;800' },
        saira: { name: 'Saira', weights: '400;500;600;700;800' },
        'work-sans': { name: 'Work Sans', weights: '400;500;600;700;800' },
        'yanone-kaffeesatz': { name: 'Yanone Kaffeesatz', weights: '400;500;600;700' },
        yantramanav: { name: 'Yantramanav', weights: '400;500;700' },
        'zilla-slab': { name: 'Zilla Slab', weights: '400;500;600;700' },
        archivo: { name: 'Archivo', weights: '400;500;600;700;800' },
        cabin: { name: 'Cabin', weights: '400;500;600;700' },
        cormorant: { name: 'Cormorant', weights: '400;500;600;700' },
        'fira-sans': { name: 'Fira Sans', weights: '400;500;600;700;800' }
    };

    // Message sounds, made with the Web Audio API in features/sound.js (no audio files)
    const SOUNDS = [
        { id: 'default', name: 'Normal' },
        { id: 'chime', name: 'Campanilla' },
        { id: 'bell', name: 'Campana' },
        { id: 'pop', name: 'Pop' },
        { id: 'digital', name: 'Digital' },
        { id: 'soft', name: 'Suave' },
        { id: 'sparkle', name: 'Brillo' },
        { id: 'pulse', name: 'Pulso' },
        { id: 'arcade', name: 'Arcade' },
        { id: 'knock', name: 'Toc toc' }
    ];

    // Minimize, maximize and close at the end of the name bar, for the window styles.
    // Three real boxes, so they share size, gap and corners.
    function decorateHead(head, designId) {
        if (!find(DESIGNS, designId, 'chatterino').windowButtons) return;
        const buttons = document.createElement('span');
        buttons.className = 'chat-window-buttons';
        buttons.setAttribute('aria-hidden', 'true');
        ['min', 'max', 'close'].forEach(name => {
            const b = document.createElement('span');
            b.className = `wb-${name}`;
            buttons.appendChild(b);
        });
        head.appendChild(buttons);
    }

    function find(list, id, fallback) {
        return list.find(item => item.id === id) || list.find(item => item.id === fallback);
    }

    window.HolyCatalog = {
        DESIGNS,
        CAPABILITY_LABELS,
        ANIMATIONS,
        EXTRA_FONTS,
        SOUNDS,
        design: id => find(DESIGNS, id, 'chatterino'),
        animationId: id => find(ANIMATIONS, id, 'none').id,
        soundId: id => find(SOUNDS, id, 'default').id,
        // True when the design keeps that part of the message (time, direction, icon, events)
        decorateHead,
        designShows: (id, capability) => !(find(DESIGNS, id, 'chatterino').hides || []).includes(capability)
    };
})();
