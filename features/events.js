/**
 * Holy Chat - donation (Kicks) and channel point reward rows. The live client sends them as
 * `channel_event`; the test chat makes examples with the same shape, so both go through fill().
 */
(function () {
    'use strict';

    const KICK_GREEN = '#53fc18';

    // "envió 100 Kicks" / "canjeó Hidratarse"
    function actionText(evt) {
        if (evt.kind === 'donation') {
            return evt.amount > 0 ? `envió ${evt.amount} ${evt.amount === 1 ? 'Kick' : 'Kicks'}` : `envió ${evt.title}`;
        }
        return `canjeó ${evt.title}`;
    }

    // Fills an event row: icon, name and action on top, the viewer's message below.
    // toHtml turns the message into HTML with the channel's emotes; designId adds the style's
    // decorations to the header (the window buttons).
    function fill(row, evt, toHtml, designId) {
        row.textContent = '';
        row.classList.add('chat-event', `event-${evt.kind}`);
        if (evt.accent) row.style.setProperty('--event-accent', evt.accent);

        const head = document.createElement('span');
        head.className = 'chat-head';

        const icon = document.createElement('span');
        icon.className = 'chat-event-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = evt.kind === 'donation' ? '💚' : '⭐';

        const author = document.createElement('span');
        author.className = 'chat-author';
        author.style.color = evt.color || KICK_GREEN;
        author.textContent = evt.username;

        const action = document.createElement('span');
        action.className = 'chat-event-action';
        action.textContent = ` ${actionText(evt)}`;

        head.append(icon, author, action);
        window.HolyCatalog.decorateHead(head, designId);
        row.appendChild(head);

        if (evt.text) {
            const text = document.createElement('span');
            text.className = 'chat-text';
            text.innerHTML = toHtml(evt.text);
            row.appendChild(text);
        }
    }

    const SAMPLE_REWARDS = [
        { title: 'Hidratarse', accent: '#3aa0ff', text: '' },
        { title: 'Elegir la próxima canción', accent: '#b05cff', text: 'pon la de siempre' },
        { title: 'Saludo en pantalla', accent: '#ff9f1a', text: 'saludos desde Santiago' }
    ];
    const SAMPLE_DONATIONS = [
        { amount: 10, text: '' },
        { amount: 100, text: 'vamos que se puede' },
        { amount: 500, text: 'para el café del stream' }
    ];

    // An example of each kind for the test chat, from one of its users
    function sample(kind, user) {
        const pool = kind === 'donation' ? SAMPLE_DONATIONS : SAMPLE_REWARDS;
        const base = pool[Math.floor(Math.random() * pool.length)];
        return {
            kind,
            id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            createdAt: new Date().toISOString(),
            username: user.username,
            color: user.color,
            title: kind === 'donation' ? 'Kicks' : base.title,
            amount: base.amount || 0,
            accent: base.accent,
            text: base.text
        };
    }

    window.HolyEvents = { fill, sample };
})();
