/**
 * Kick Realtime Chat Client
 * - Kick Pusher WebSocket (chat, deletes, bans)
 * - Native Kick badges (local SVGs + channel subscriber badge images)
 * - 7TV integration: per-channel emote pack (the streamer's active set), user badges, name colors / paints
 */

/**
 * Lightweight localStorage Cache with TTL and eviction
 */
class KickCache {
    static PREFIX = 'kick_cache_';
    // Keys written by older versions (one entry per 7TV user). Old emote packs ('emotes_') are
    // migrated by KickChatClient.migrateLegacyPacks() before the first prune.
    static LEGACY_PREFIXES = ['7tv_'];
    static pruneTimer = null;

    static get(key) {
        try {
            const raw = localStorage.getItem(this.PREFIX + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (item.exp && Date.now() > item.exp) {
                localStorage.removeItem(this.PREFIX + key);
                return null;
            }
            return item.val;
        } catch (e) {
            return null;
        }
    }

    static set(key, val, ttlMs = 3600000) {
        const write = () => {
            const item = { val, exp: ttlMs ? Date.now() + ttlMs : 0 };
            localStorage.setItem(this.PREFIX + key, JSON.stringify(item));
        };
        try {
            write();
        } catch (e) {
            // Quota reached: drop expired entries and the oldest half of the rest, then retry once
            KickCache.prune(true);
            try {
                write();
            } catch (e2) {
                console.warn('[KickCache] set failed:', e2);
            }
        }
    }

    static remove(key) {
        try {
            localStorage.removeItem(this.PREFIX + key);
        } catch (e) {}
    }

    static prune(forceEvictOldest = false) {
        try {
            const now = Date.now();
            const keysToRemove = [];
            const live = [];

            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(this.PREFIX)) continue;
                const name = k.slice(this.PREFIX.length);
                if (this.LEGACY_PREFIXES.some(p => name.startsWith(p))) {
                    keysToRemove.push(k);
                    continue;
                }
                try {
                    const item = JSON.parse(localStorage.getItem(k));
                    if (item && item.exp && now > item.exp) {
                        keysToRemove.push(k);
                    } else if (name !== 'overlay_settings') {
                        live.push({ key: k, exp: (item && item.exp) || Infinity });
                    }
                } catch (err) {
                    keysToRemove.push(k);
                }
            }

            keysToRemove.forEach(k => localStorage.removeItem(k));

            if (forceEvictOldest && live.length) {
                live.sort((a, b) => a.exp - b.exp);
                live.slice(0, Math.ceil(live.length / 2)).forEach(e => localStorage.removeItem(e.key));
            }
        } catch (e) {}
    }

    // OBS browser sources stay open for hours, so expired entries must be dropped while running too
    static startAutoPrune(intervalMs = 15 * 60 * 1000) {
        if (this.pruneTimer) return;
        this.pruneTimer = setInterval(() => this.prune(), intervalMs);
    }
}

/**
 * Kick API access. Kick does not send CORS headers to browsers, so requests usually need a proxy;
 * the strategy that last worked is remembered and tried first.
 */
class KickApi {
    static STRATEGY_KEY = 'fetch_strategy';
    static STRATEGIES = [
        url => url,
        url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];
    static preferred = null;

    static async fetchJson(url) {
        if (this.preferred === null) {
            const saved = KickCache.get(this.STRATEGY_KEY);
            this.preferred = Number.isInteger(saved) && saved >= 0 && saved < this.STRATEGIES.length ? saved : 0;
        }
        const order = [this.preferred, ...this.STRATEGIES.keys()].filter((v, i, a) => a.indexOf(v) === i);

        for (const i of order) {
            try {
                const res = await fetch(this.STRATEGIES[i](url));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (i !== this.preferred) {
                    this.preferred = i;
                    KickCache.set(this.STRATEGY_KEY, i, 24 * 60 * 60 * 1000);
                }
                return json;
            } catch (err) {
                console.warn(`[Kick] fetch attempt ${i} failed:`, url, err.message);
            }
        }
        return null;
    }
}

/**
 * 7TV user cosmetics (badge, name color, paint). Cosmetics belong to the user, not the channel,
 * so this store is shared by every channel.
 * - Lookups are batched into one GraphQL query per BATCH_SIZE users (7TV rejects queries above ~400 complexity)
 * - Results live in a bounded LRU persisted under a single localStorage key
 * - Only a confirmed "no 7TV account / no cosmetics" is cached as negative; rate limits and
 *   network errors are retried with backoff instead of hiding a user's cosmetics
 */
class SevenTVCosmetics {
    static CACHE_KEY = 'seventv_styles';
    static MAX_ENTRIES = 2000;
    static BATCH_SIZE = 15;
    static BATCH_DELAY_MS = 100;
    static MAX_CONCURRENT = 2;
    static MAX_RETRIES = 3;
    static STYLE_TTL = 6 * 60 * 60 * 1000;
    static NONE_TTL = 60 * 60 * 1000;
    // After its TTL an entry is still shown while it refreshes, so a 7TV outage doesn't strip cosmetics
    static STALE_MAX = 7 * 24 * 60 * 60 * 1000;
    static FIELDS = 'id style { color badge { tooltip host { url files { name } } } paint { function color angle shape image_url repeat stops { at color } shadows { x_offset y_offset radius color } } }';

    static entries = null;       // kick user id -> { v: style|null, exp }, in LRU order
    static pending = new Map();  // kick user id -> { promise, resolve, retries }
    static queue = [];
    static flushTimer = null;
    static persistTimer = null;
    static active = 0;
    static backoffMs = 0;
    static backoffUntil = 0;

    static load() {
        if (this.entries) return;
        this.entries = new Map();
        const stored = KickCache.get(this.CACHE_KEY);
        const oldest = Date.now() - this.STALE_MAX;
        if (Array.isArray(stored)) {
            stored.forEach(([id, e]) => {
                if (id && e && e.exp > oldest) this.entries.set(id, e);
            });
        }
    }

    static persist() {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        if (this.entries) {
            KickCache.set(this.CACHE_KEY, Array.from(this.entries.entries()), this.STALE_MAX);
        }
    }

    static schedulePersist() {
        if (!this.persistTimer) this.persistTimer = setTimeout(() => this.persist(), 5000);
    }

    static remember(id, value, ttl) {
        this.entries.delete(id);
        this.entries.set(id, { v: value, exp: Date.now() + ttl });
        while (this.entries.size > this.MAX_ENTRIES) {
            this.entries.delete(this.entries.keys().next().value);
        }
        this.schedulePersist();
    }

    /**
     * "Actualizar caché": every stored style counts as expired. Each user is fetched again the next
     * time they chat, and meanwhile keeps the last known style (so a 7TV outage strips nothing).
     */
    static expireAll() {
        this.load();
        this.entries.forEach(e => { e.exp = 0; });
        this.persist();
    }

    /** Resolves to { color, paint: {background, color, filter}|null, badge: {type:'7tv', text, imageUrl}|null } | null */
    static get(kickUserId) {
        const id = String(kickUserId || '').replace(/\D/g, '');
        if (!id) return Promise.resolve(null);
        this.load();

        const hit = this.entries.get(id);
        if (hit) {
            this.entries.delete(id);
            this.entries.set(id, hit);
            // Expired: show the last known style now and refresh it in the background
            if (hit.exp <= Date.now()) this.request(id);
            return Promise.resolve(hit.v);
        }
        return this.request(id);
    }

    static request(id) {
        const inFlight = this.pending.get(id);
        if (inFlight) return inFlight.promise;

        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this.pending.set(id, { promise, resolve, retries: 0 });
        this.queue.push(id);
        this.scheduleFlush(this.BATCH_DELAY_MS);
        return promise;
    }

    static scheduleFlush(delayMs) {
        if (this.flushTimer) return;
        const wait = Math.max(delayMs, this.backoffUntil - Date.now());
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
        }, wait);
    }

    static flush() {
        while (this.queue.length && this.active < this.MAX_CONCURRENT && Date.now() >= this.backoffUntil) {
            const batch = this.queue.splice(0, this.BATCH_SIZE);
            this.active++;
            this.fetchBatch(batch).finally(() => {
                this.active--;
                if (this.queue.length) this.scheduleFlush(0);
            });
        }
        if (this.queue.length && Date.now() < this.backoffUntil) this.scheduleFlush(0);
    }

    static async fetchBatch(ids) {
        const query = `{ ${ids.map((id, i) => `u${i}: userByConnection(platform: KICK, id: "${id}") { ${this.FIELDS} }`).join(' ')} }`;
        let json = null;
        try {
            const res = await fetch('https://7tv.io/v3/gql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            if (res.ok) json = await res.json();
        } catch (e) {}

        const data = json && json.data;
        if (!data) {
            this.retry(ids);
            return;
        }

        const failed = [];
        ids.forEach((id, i) => {
            const user = data[`u${i}`];
            if (!user && json.errors) {
                failed.push(id);
                return;
            }
            const style = SevenTVCosmetics.parseUser(user);
            this.remember(id, style, style ? this.STYLE_TTL : this.NONE_TTL);
            this.settle(id, style);
        });

        if (failed.length) this.retry(failed);
        else this.backoffMs = 0;
    }

    static retry(ids) {
        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 2000, 60000);
        this.backoffUntil = Date.now() + this.backoffMs;
        ids.forEach(id => {
            const p = this.pending.get(id);
            if (!p) return;
            if (++p.retries > this.MAX_RETRIES) this.settle(id, null);
            else this.queue.push(id);
        });
        if (this.queue.length) this.scheduleFlush(0);
    }

    static settle(id, value) {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        p.resolve(value);
    }

    static parseUser(user) {
        // Kick users without a 7TV account come back as "*DeletedUser" with an all-zero id
        if (!user || !user.id || /^0+$/.test(user.id)) return null;

        const style = user.style || {};
        let badge = null;
        if (style.badge && style.badge.host) {
            let hostUrl = style.badge.host.url || '';
            if (hostUrl.startsWith('//')) hostUrl = 'https:' + hostUrl;
            const files = (style.badge.host.files || []).map(f => f.name);
            const file = files.includes('2x.webp') ? '2x.webp' : (files[0] || '1x.webp');
            badge = {
                type: '7tv',
                text: style.badge.tooltip || '7TV',
                imageUrl: `${hostUrl}/${file}`
            };
        }

        const color = style.color ? SevenTVCosmetics.intToRgba(style.color) : null;
        const paint = SevenTVCosmetics.paintToCss(style.paint);
        if (!badge && !color && !paint) return null;
        return { color, paint, badge };
    }

    static intToRgba(n) {
        if (n == null) return null;
        const u = n >>> 0;
        const r = (u >>> 24) & 255;
        const g = (u >>> 16) & 255;
        const b = (u >>> 8) & 255;
        const a = (u & 255) / 255;
        if (a < 0.05 || (r === 0 && g === 0 && b === 0)) return null;
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    }

    static paintToCss(paint) {
        if (!paint) return null;
        const rgba = SevenTVCosmetics.intToRgba;
        const fn = (paint.function || '').toUpperCase();
        // function and image_url let app.js preload an image paint before clipping the text
        const out = { function: fn, image_url: paint.image_url || null, background: null, color: null, filter: null };

        const stops = (paint.stops || [])
            .map(s => {
                const c = rgba(s.color);
                return c ? `${c} ${(s.at * 100).toFixed(2)}%` : null;
            })
            .filter(Boolean)
            .join(', ');
        const repeat = paint.repeat ? 'repeating-' : '';

        if (fn === 'LINEAR_GRADIENT' && stops) {
            out.background = `${repeat}linear-gradient(${paint.angle || 0}deg, ${stops})`;
        } else if (fn === 'RADIAL_GRADIENT' && stops) {
            out.background = `${repeat}radial-gradient(${paint.shape || 'circle'}, ${stops})`;
        } else if (fn === 'URL' && paint.image_url) {
            out.background = `url("${paint.image_url}")`;
        } else if (paint.color != null) {
            out.color = rgba(paint.color);
        } else {
            return null;
        }

        if (Array.isArray(paint.shadows) && paint.shadows.length) {
            out.filter = paint.shadows
                .map(s => {
                    const c = rgba(s.color);
                    return c ? `drop-shadow(${s.x_offset || 0}px ${s.y_offset || 0}px ${s.radius || 1}px ${c})` : null;
                })
                .filter(Boolean)
                .join(' ');
        }
        return out;
    }
}

/**
 * 7TV EventAPI: one WebSocket shared by every watched channel. It subscribes to each channel's active
 * emote set ("emote_set.*") and to the streamer's 7TV user ("user.*", to notice a set switch), so a pack
 * is downloaded once and then kept current by pushed changes instead of polling.
 */
class SevenTVEvents {
    static URL = 'wss://events.7tv.io/v3';
    static OP = { DISPATCH: 0, HELLO: 1, HEARTBEAT: 2, RECONNECT: 4, ACK: 5, ERROR: 6, END_OF_STREAM: 7, SUBSCRIBE: 35, UNSUBSCRIBE: 36 };

    static ws = null;
    static ready = false;
    static channels = new Set();     // watched channel slugs
    static subscribed = new Map();   // "type|object_id" -> { type, objectId }
    static heartbeatMs = 60000;
    static watchdog = null;
    static reconnectTimer = null;
    static reconnectAttempts = 0;
    static hadSession = false;

    static watch(slug) {
        this.channels.add(slug);
        this.sync();
    }

    static unwatch(slug) {
        this.channels.delete(slug);
        this.sync();
    }

    // Subscriptions the watched channels need, from their current packs
    static desired() {
        const out = new Map();
        this.channels.forEach(slug => {
            const pack = KickChatClient.getPack(slug);
            if (pack.setId) out.set(`emote_set.*|${pack.setId}`, { type: 'emote_set.*', objectId: pack.setId });
            if (pack.sevenTvUserId) out.set(`user.*|${pack.sevenTvUserId}`, { type: 'user.*', objectId: pack.sevenTvUserId });
        });
        const globalPack = KickChatClient.getGlobalPack();
        if (globalPack && globalPack.setId) {
            out.set(`emote_set.*|${globalPack.setId}`, { type: 'emote_set.*', objectId: globalPack.setId });
        }
        return out;
    }

    static sync() {
        const want = this.desired();
        if (!want.size) {
            this.stop();
            return;
        }
        if (!this.ws) {
            if (!this.reconnectTimer) this.open();
            return; // subscriptions are sent once the server says HELLO
        }
        if (!this.ready) return;

        for (const [key, sub] of this.subscribed) {
            if (!want.has(key)) {
                this.send(this.OP.UNSUBSCRIBE, sub);
                this.subscribed.delete(key);
            }
        }
        for (const [key, sub] of want) {
            if (!this.subscribed.has(key)) {
                this.send(this.OP.SUBSCRIBE, sub);
                this.subscribed.set(key, sub);
            }
        }
    }

    static send(op, sub) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ op, d: { type: sub.type, condition: { object_id: sub.objectId } } }));
    }

    static open() {
        let ws;
        try {
            ws = new WebSocket(this.URL);
        } catch (e) {
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;
        this.ready = false;
        ws.onmessage = (ev) => this.onMessage(ev);
        ws.onclose = () => {
            if (this.ws === ws) this.drop(true);
        };
        ws.onerror = () => {}; // onclose follows
        this.armWatchdog();
    }

    static onMessage(ev) {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch (e) {
            return;
        }
        this.armWatchdog();

        switch (msg.op) {
            case this.OP.HELLO: {
                this.heartbeatMs = (msg.d && msg.d.heartbeat_interval) || 60000;
                this.ready = true;
                this.reconnectAttempts = 0;
                this.armWatchdog();
                const resumed = this.hadSession;
                this.hadSession = true;
                this.sync();
                // Changes made while disconnected were not pushed: check each pack once
                if (resumed) {
                    this.channels.forEach(slug => KickChatClient.loadPack(slug, { force: true }));
                    KickChatClient.loadGlobalPack({ force: true });
                }
                break;
            }
            case this.OP.DISPATCH: {
                const type = msg.d && msg.d.type;
                const body = msg.d && msg.d.body;
                if (type === 'emote_set.update') {
                    this.channels.forEach(slug => KickChatClient.applySetChanges(slug, body));
                    KickChatClient.applyGlobalSetChanges(body);
                } else if (type === 'user.update') {
                    this.channels.forEach(slug => KickChatClient.applyUserChanges(slug, body));
                }
                break;
            }
            case this.OP.RECONNECT:
            case this.OP.END_OF_STREAM:
                this.drop(true);
                break;
            case this.OP.ERROR:
                console.warn('[7TV] EventAPI error:', msg.d);
                break;
        }
    }

    // The server sends a heartbeat every heartbeat_interval; silence for longer means a dead connection
    static armWatchdog() {
        clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => this.drop(true), this.heartbeatMs * 1.5 + 5000);
    }

    static drop(reconnect) {
        const ws = this.ws;
        this.ws = null;
        this.ready = false;
        this.subscribed.clear();
        clearTimeout(this.watchdog);
        this.watchdog = null;
        if (ws) {
            ws.onmessage = ws.onclose = ws.onerror = null;
            try {
                ws.close();
            } catch (e) {}
        }
        if (reconnect && this.channels.size) this.scheduleReconnect();
    }

    static scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.desired().size) this.open();
        }, delay);
    }

    // No channel needs live updates any more
    static stop() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.hadSession = false;
        this.drop(false);
    }
}

class KickChatClient extends EventTarget {
    static CHANNEL_DEFAULTS = {
        rageylo: { channelId: 19024162, chatroomId: 18761973, kickUserId: 19996585 }
    };

    static USER_COLORS = [
        '#53fc18', '#00e5ff', '#ff3366', '#ffb703',
        '#a78bfa', '#f43f5e', '#38bdf8', '#4ade80',
        '#fb923c', '#e879f9', '#2dd4bf', '#facc15'
    ];

    static HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

    static normalizeSlug(channel) {
        return String(channel || '').toLowerCase().trim();
    }

    static escapeHtml(str) {
        return str.replace(/[&<>"']/g, c => KickChatClient.HTML_ESCAPES[c]);
    }

    /* ------------------------------------------------------------------ */
    /*  Channel resolution (shared by the menu preview and live clients)   */
    /* ------------------------------------------------------------------ */

    static CHANNEL_INFO = new Map();   // slug -> { channelId, chatroomId, kickUserId, subscriberBadges }
    static CHANNEL_LOADS = new Map();  // slug -> in-flight Promise

    static cachedChannelInfo(slug) {
        if (this.CHANNEL_INFO.has(slug)) return this.CHANNEL_INFO.get(slug);
        const cached = KickCache.get(`channel_${slug}`);
        if (cached && cached.channelId && cached.chatroomId) {
            this.CHANNEL_INFO.set(slug, cached);
            return cached;
        }
        return null;
    }

    static fetchChannelInfo(slug) {
        if (this.CHANNEL_LOADS.has(slug)) return this.CHANNEL_LOADS.get(slug);
        const promise = (async () => {
            const data = await KickApi.fetchJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`);
            if (!data || !(data.id || data.chatroom)) return null;
            const info = {
                channelId: data.id || (data.chatroom ? data.chatroom.channel_id : null),
                chatroomId: data.chatroom ? data.chatroom.id : (data.id || null),
                kickUserId: data.user_id || (data.user && data.user.id) || null,
                subscriberBadges: Array.isArray(data.subscriber_badges)
                    ? data.subscriber_badges.slice().sort((a, b) => a.months - b.months)
                    : []
            };
            this.CHANNEL_INFO.set(slug, info);
            KickCache.set(`channel_${slug}`, info, 24 * 60 * 60 * 1000);
            console.log(`[Kick] Synced channel "${slug}": channel=${info.channelId} chatroom=${info.chatroomId} user=${info.kickUserId}`);
            return info;
        })().catch(e => {
            console.warn('[Kick] Channel refresh error:', e);
            return null;
        }).finally(() => this.CHANNEL_LOADS.delete(slug));
        this.CHANNEL_LOADS.set(slug, promise);
        return promise;
    }

    static async resolveChannelInfo(channel) {
        const slug = this.normalizeSlug(channel);
        if (!slug) return null;
        const cached = this.cachedChannelInfo(slug);
        if (cached) return cached;
        const info = await this.fetchChannelInfo(slug);
        if (info) return info;

        // Hardcoded fallback for known channels (e.g. rageylo) so OBS never breaks
        const fallback = this.CHANNEL_DEFAULTS[slug];
        if (fallback) {
            console.warn(`[Kick] Using fallback data for "${slug}": channel=${fallback.channelId}`);
            const info = { ...fallback, subscriberBadges: [] };
            this.CHANNEL_INFO.set(slug, info);
            return info;
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Emote packs: one per channel, the streamer's active 7TV set.       */
    /*  Names match exactly (case-sensitive); the same emote may exist in  */
    /*  several packs, but packs never mix.                                */
    /*  The set is downloaded once and cached; afterwards SevenTVEvents    */
    /*  pushes each change, so there is no polling.                        */
    /* ------------------------------------------------------------------ */

    // slug -> { setId, sevenTvUserId, kickConnectionIndex, signature, emotes: Map<name, {url, zeroWidth}> }
    static PACKS = new Map();
    static PACK_LOADS = new Map();  // slug -> in-flight Promise
    static GLOBAL_PACK = null;
    static GLOBAL_PACK_LOAD = null; // in-flight Promise for 7TV global emote set
    static EMPTY_PACK = Object.freeze({ setId: null, sevenTvUserId: null, kickConnectionIndex: null, signature: '', emotes: new Map() });
    // A pack checked this recently is used as is (e.g. OBS reloading the scene) unless forced
    static PACK_FRESH_MS = 10 * 60 * 1000;
    // Kept for a week so the overlay still has emotes if 7TV's API is down when OBS reloads
    static PACK_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

    static getPack(channel) {
        const slug = this.normalizeSlug(channel);
        if (!slug) return this.EMPTY_PACK;
        let pack = this.PACKS.get(slug);
        if (!pack) {
            const cached = KickCache.get(`pack_${slug}`);
            if (!cached || !Array.isArray(cached.emotes)) return this.EMPTY_PACK;
            pack = {
                setId: cached.setId || null,
                sevenTvUserId: cached.sevenTvUserId || null,
                kickConnectionIndex: Number.isInteger(cached.kickConnectionIndex) ? cached.kickConnectionIndex : null,
                signature: cached.signature || '',
                emotes: new Map(cached.emotes)
            };
            this.PACKS.set(slug, pack);
        }
        return pack;
    }

    static isPackFresh(slug) {
        const checkedAt = KickCache.get(`pack_checked_${slug}`);
        return typeof checkedAt === 'number' && Date.now() - checkedAt < this.PACK_FRESH_MS && this.PACKS.has(slug);
    }

    static getGlobalPack() {
        if (!this.GLOBAL_PACK) {
            const cached = KickCache.get('pack_global_7tv');
            if (!cached || !Array.isArray(cached.emotes)) return this.EMPTY_PACK;
            this.GLOBAL_PACK = {
                setId: cached.setId || null,
                signature: cached.signature || '',
                emotes: new Map(cached.emotes)
            };
        }
        return this.GLOBAL_PACK;
    }

    static isGlobalPackFresh() {
        const checkedAt = KickCache.get('pack_checked_global_7tv');
        return typeof checkedAt === 'number' && Date.now() - checkedAt < this.PACK_FRESH_MS && Boolean(this.GLOBAL_PACK && this.GLOBAL_PACK.emotes.size);
    }

    /**
     * Downloads 7TV global emote set (EZ, Clap, peepoSad, PETPET, etc.). Cached for 7 days.
     */
    static loadGlobalPack({ force = false } = {}) {
        if (this.GLOBAL_PACK_LOAD) return this.GLOBAL_PACK_LOAD;
        this.getGlobalPack();
        if (!force && this.isGlobalPackFresh()) return Promise.resolve(this.getGlobalPack());

        const promise = (async () => {
            const res = await fetch('https://7tv.io/v3/emote-sets/global');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const setId = (data && data.id) || 'global';
            const rawEmotes = (data && Array.isArray(data.emotes)) ? data.emotes : [];
            return this.storeGlobalPack({ setId }, rawEmotes);
        })().catch(e => {
            console.warn('[7TV] Error cargando pack de emotes globales:', e);
            return this.getGlobalPack();
        }).finally(() => {
            this.GLOBAL_PACK_LOAD = null;
        });

        this.GLOBAL_PACK_LOAD = promise;
        return promise;
    }

    static storeGlobalPack(meta, rawEmotes) {
        const entries = rawEmotes
            .filter(em => em && em.name && em.id)
            .map(em => KickChatClient.packEntry(em));
        return this.saveGlobalPack(meta, entries);
    }

    static saveGlobalPack(meta, entries) {
        KickCache.set('pack_checked_global_7tv', Date.now(), this.PACK_CACHE_TTL);

        const signature = KickChatClient.hashString(
            `${meta.setId}|${entries.map(([name, e]) => `${name}=${e.url}${e.zeroWidth ? '~' : ''}`).join('\n')}`
        );
        const current = this.GLOBAL_PACK;
        if (current && current.signature === signature) {
            return current;
        }

        const pack = {
            setId: meta.setId,
            signature,
            emotes: new Map(entries)
        };
        this.GLOBAL_PACK = pack;
        KickCache.set('pack_global_7tv', {
            setId: pack.setId,
            signature,
            emotes: entries
        }, entries.length ? this.PACK_CACHE_TTL : 30 * 60 * 1000);

        if (!current || current.signature !== signature) {
            console.log(`[7TV] Pack de emotes globales actualizado: ${entries.length} emotes (set ${pack.setId || 'global'})`);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('global_emotes_loaded', {
                    detail: { setId: pack.setId, count: entries.length }
                }));
            }
        }
        if (typeof SevenTVEvents !== 'undefined') SevenTVEvents.sync();
        return pack;
    }

    /**
     * Downloads the channel's whole active set in one request. Skipped when the cached pack was checked
     * less than PACK_FRESH_MS ago, unless options.force (set switched, or live updates may have been missed).
     */
    static loadPack(channel, { kickUserId = null, force = false } = {}) {
        const slug = this.normalizeSlug(channel);
        if (!slug) return Promise.resolve(this.EMPTY_PACK);
        if (this.PACK_LOADS.has(slug)) return this.PACK_LOADS.get(slug);
        this.getPack(slug); // hydrate from localStorage before deciding
        if (!force && this.isPackFresh(slug)) return Promise.resolve(this.getPack(slug));

        const promise = (async () => {
            const userId = kickUserId || ((await this.resolveChannelInfo(slug)) || {}).kickUserId;
            if (!userId) return this.getPack(slug);

            const res = await fetch(`https://7tv.io/v3/users/kick/${encodeURIComponent(userId)}`);
            if (res.status === 404) {
                // The streamer has no 7TV account, so the channel has no 7TV emotes
                return this.storePack(slug, { setId: null, sevenTvUserId: null, kickConnectionIndex: null }, []);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const set = data && data.emote_set;
            const connections = (data && data.user && Array.isArray(data.user.connections)) ? data.user.connections : [];
            // A 7TV user can link Twitch and Kick with different active sets; only the Kick one matters here
            const kickConnectionIndex = connections.findIndex(c => c.platform === 'KICK' && String(c.id) === String(data.id));
            return this.storePack(slug, {
                setId: set ? set.id : null,
                sevenTvUserId: (data && data.user && data.user.id) || null,
                kickConnectionIndex: kickConnectionIndex >= 0 ? kickConnectionIndex : null
            }, set && Array.isArray(set.emotes) ? set.emotes : []);
        })().catch(e => {
            console.warn(`[7TV] Error cargando pack de emotes del canal "${slug}":`, e);
            return this.getPack(slug);
        }).finally(() => this.PACK_LOADS.delete(slug));

        this.PACK_LOADS.set(slug, promise);
        return promise;
    }

    /**
     * "Actualizar caché" on the settings page: downloads the channel's Kick data (ids, subscriber
     * badges) and its 7TV emote pack again, and marks the 7TV cosmetics as expired. If a download
     * fails the cached copy stays in use. Resolves to { channel: bool, emotes: number }.
     */
    static async refreshCache(channel) {
        const slug = this.normalizeSlug(channel);
        if (!slug) return { channel: false, emotes: 0 };
        SevenTVCosmetics.expireAll();
        const info = await this.fetchChannelInfo(slug);
        const [pack, globalPack] = await Promise.all([
            this.loadPack(slug, { kickUserId: info && info.kickUserId, force: true }),
            this.loadGlobalPack({ force: true })
        ]);
        const totalEmotes = (pack ? pack.emotes.size : 0) + (globalPack ? globalPack.emotes.size : 0);
        return { channel: Boolean(info), emotes: totalEmotes };
    }

    // One pack entry from a 7TV active emote. em.name is the name inside the set (it can be an alias)
    static packEntry(em) {
        const flags = em.flags || 0;
        const dataFlags = (em.data && em.data.flags) || 0;
        return [em.name, {
            url: `https://cdn.7tv.app/emote/${em.id}/2x.webp`,
            zeroWidth: Boolean((flags & 1) || (dataFlags & 256))
        }];
    }

    static storePack(slug, meta, rawEmotes) {
        const entries = rawEmotes
            .filter(em => em && em.name && em.id)
            .map(em => KickChatClient.packEntry(em));
        return this.savePack(slug, meta, entries);
    }

    static savePack(slug, meta, entries) {
        KickCache.set(`pack_checked_${slug}`, Date.now(), this.PACK_CACHE_TTL);

        const signature = KickChatClient.hashString(
            `${meta.setId}|${entries.map(([name, e]) => `${name}=${e.url}${e.zeroWidth ? '~' : ''}`).join('\n')}`
        );
        const current = this.PACKS.get(slug);
        if (current && current.signature === signature &&
            current.sevenTvUserId === meta.sevenTvUserId && current.kickConnectionIndex === meta.kickConnectionIndex) {
            return current;
        }

        const pack = {
            setId: meta.setId,
            sevenTvUserId: meta.sevenTvUserId,
            kickConnectionIndex: meta.kickConnectionIndex,
            signature,
            emotes: new Map(entries)
        };
        this.PACKS.set(slug, pack);
        KickCache.set(`pack_${slug}`, {
            setId: pack.setId,
            sevenTvUserId: pack.sevenTvUserId,
            kickConnectionIndex: pack.kickConnectionIndex,
            signature,
            emotes: entries
        }, entries.length ? this.PACK_CACHE_TTL : 30 * 60 * 1000);

        if (!current || current.signature !== signature) {
            console.log(`[7TV] Pack de emotes de #${slug} actualizado: ${entries.length} emotes (set ${pack.setId || 'ninguno'})`);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('channel_emotes_loaded', {
                    detail: { channel: slug, setId: pack.setId, count: entries.length }
                }));
            }
        }
        // The set or 7TV user may have changed: keep live-update subscriptions in step
        if (typeof SevenTVEvents !== 'undefined') SevenTVEvents.sync();
        return pack;
    }

    /**
     * Applies an EventAPI "emote_set.update" change map (emotes added, removed, renamed) to every
     * channel whose active set it is, without downloading the set again.
     */
    static applySetChanges(slug, body) {
        const pack = this.getPack(slug);
        if (!pack.setId || !body || body.id !== pack.setId) return;

        const emotes = new Map(pack.emotes); // copy: messages being rendered keep the old map
        let changed = false;
        const remove = (old) => {
            if (!old || !old.id) return;
            const byName = emotes.get(old.name);
            if (byName && byName.url.includes(`/emote/${old.id}/`)) {
                emotes.delete(old.name);
                changed = true;
                return;
            }
            for (const [name, e] of emotes) {
                if (e.url.includes(`/emote/${old.id}/`)) {
                    emotes.delete(name);
                    changed = true;
                }
            }
        };
        const add = (em) => {
            if (!em || !em.name || !em.id) return;
            const [name, entry] = KickChatClient.packEntry(em);
            emotes.set(name, entry);
            changed = true;
        };

        (body.pulled || []).forEach(c => { if (c.key === 'emotes') remove(c.old_value); });
        (body.updated || []).forEach(c => {
            if (c.key !== 'emotes') return;
            remove(c.old_value);
            add(c.value);
        });
        (body.pushed || []).forEach(c => { if (c.key === 'emotes') add(c.value); });

        if (!changed) return;
        console.log(`[7TV] Cambio en vivo en el set de #${slug}` +
            `: +${(body.pushed || []).length} -${(body.pulled || []).length} ~${(body.updated || []).length}`);
        this.savePack(slug, pack, Array.from(emotes.entries()));
    }

    static applyGlobalSetChanges(body) {
        const pack = this.getGlobalPack();
        if (!pack.setId || !body || body.id !== pack.setId) return;

        const emotes = new Map(pack.emotes);
        let changed = false;
        const remove = (old) => {
            if (!old || !old.id) return;
            const byName = emotes.get(old.name);
            if (byName && byName.url.includes(`/emote/${old.id}/`)) {
                emotes.delete(old.name);
                changed = true;
                return;
            }
            for (const [name, e] of emotes) {
                if (e.url.includes(`/emote/${old.id}/`)) {
                    emotes.delete(name);
                    changed = true;
                }
            }
        };
        const add = (em) => {
            if (!em || !em.name || !em.id) return;
            const [name, entry] = KickChatClient.packEntry(em);
            emotes.set(name, entry);
            changed = true;
        };

        (body.pulled || []).forEach(c => { if (c.key === 'emotes') remove(c.old_value); });
        (body.updated || []).forEach(c => {
            if (c.key !== 'emotes') return;
            remove(c.old_value);
            add(c.value);
        });
        (body.pushed || []).forEach(c => { if (c.key === 'emotes') add(c.value); });

        if (!changed) return;
        console.log(`[7TV] Cambio en vivo en el set global` +
            `: +${(body.pushed || []).length} -${(body.pulled || []).length} ~${(body.updated || []).length}`);
        this.saveGlobalPack(pack, Array.from(emotes.entries()));
    }

    /**
     * Applies an EventAPI "user.update": when the streamer switches the active set of their Kick
     * connection, the new set is downloaded (once).
     */
    static applyUserChanges(slug, body) {
        const pack = this.getPack(slug);
        if (!pack.sevenTvUserId || !body || body.id !== pack.sevenTvUserId) return;

        for (const change of body.updated || []) {
            if (change.key !== 'connections') continue;
            if (pack.kickConnectionIndex !== null && Number.isInteger(change.index) && change.index !== pack.kickConnectionIndex) continue;
            for (const field of Array.isArray(change.value) ? change.value : []) {
                if (field.key !== 'emote_set' && field.key !== 'emote_set_id') continue;
                const newSetId = field.key === 'emote_set_id' ? field.value : (field.value && field.value.id);
                if ((newSetId || null) !== pack.setId) {
                    console.log(`[7TV] #${slug} cambió de set activo: ${pack.setId} -> ${newSetId}`);
                    this.loadPack(slug, { force: true });
                    return;
                }
            }
        }
    }

    /**
     * Older versions cached packs as 'emotes_<slug>' (exact names, plus Kick sub emotes). Keep their 7TV
     * part as this channel's pack so an existing OBS source still has emotes if 7TV can't be reached.
     * The empty signature makes the next successful load replace it.
     */
    static migrateLegacyPacks() {
        try {
            const legacyPrefix = KickCache.PREFIX + 'emotes_';
            const legacyKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(legacyPrefix)) legacyKeys.push(k);
            }
            legacyKeys.forEach(k => {
                const slug = k.slice(legacyPrefix.length);
                try {
                    const item = JSON.parse(localStorage.getItem(k));
                    const entries = (item && Array.isArray(item.val) ? item.val : []).filter(([name, em]) =>
                        name && em && typeof em.url === 'string' && em.url.startsWith('https://cdn.7tv.app/'));
                    if (slug && entries.length && !KickCache.get(`pack_${slug}`)) {
                        KickCache.set(`pack_${slug}`, { setId: null, signature: '', emotes: entries }, KickChatClient.PACK_CACHE_TTL);
                    }
                } catch (e) {}
                localStorage.removeItem(k);
            });
        } catch (e) {}
    }

    // FNV-1a, enough to tell whether a pack changed without storing the whole list twice
    static hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36) + ':' + str.length;
    }

    constructor(options = {}) {
        super();
        this.channelSlug = KickChatClient.normalizeSlug(options.channel) || 'rageylo';
        this.channelId = null;
        this.chatroomId = null;
        this.kickUserId = null;

        // Pusher configuration
        this.pusherKey = options.pusherKey || '34bf7a0ff419a2a775b9';
        this.pusherCluster = options.pusherCluster || 'us2';
        this.ws = null;
        this.socketId = null;
        this.isConnected = false;
        this.shouldReconnect = true;
        this.initialized = false;
        this.reconnectAttempts = 0;
        this.reconnectTimeout = null;
        this.pingInterval = null;
        this.emoteRefreshInterval = null;

        this.sevenTVEmotes = options.sevenTVEmotes !== false;

        // Chat history: ids already shown (so a reconnect only adds what was missed) and
        // live messages held back while the history request is in flight, to keep the order
        this.seenMessageIds = new Set();
        this.historyLoading = false;
        this.pendingLive = [];

        this.subscriberBadges = [];
        this.subscriberBadgeUrls = new Map(); // months -> url

        // Restore this channel's cached pack right away so the first messages already have emotes
        if (this.sevenTVEmotes) {
            KickChatClient.getPack(this.channelSlug);
            KickChatClient.getGlobalPack();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Channel data (resolved once per client, not on every reconnect)    */
    /* ------------------------------------------------------------------ */

    applyChannelInfo(info) {
        const moved = this.chatroomId !== null &&
            (info.chatroomId !== this.chatroomId || info.channelId !== this.channelId);
        this.channelId = info.channelId;
        this.chatroomId = info.chatroomId;
        this.kickUserId = info.kickUserId || null;
        this.subscriberBadges = Array.isArray(info.subscriberBadges) ? info.subscriberBadges : [];
        this.subscriberBadgeUrls.clear();
        return moved;
    }

    async init() {
        const slug = this.channelSlug;
        let info = KickChatClient.cachedChannelInfo(slug);

        if (info) {
            // Stale-while-revalidate: if Kick moved the chatroom, reconnect to the new one
            KickChatClient.fetchChannelInfo(slug).then(fresh => {
                if (fresh && this.shouldReconnect && this.applyChannelInfo(fresh) && this.ws) this.ws.close();
            });
        } else {
            info = await KickChatClient.resolveChannelInfo(slug);
        }
        if (!info) return false;

        this.applyChannelInfo(info);
        console.log(`[Kick] Channel "${slug}": channel=${this.channelId} chatroom=${this.chatroomId} user=${this.kickUserId}`);

        if (this.sevenTVEmotes) {
            KickChatClient.loadPack(slug, { kickUserId: this.kickUserId });
            KickChatClient.loadGlobalPack();
            SevenTVEvents.watch(slug);
            this.startEmoteRefresher();
        }
        this.initialized = true;
        return true;
    }

    startEmoteRefresher() {
        this.stopEmoteRefresher();
        // Changes arrive live through SevenTVEvents; this hourly check is only a safety net
        // in case an event was lost without the socket noticing
        this.emoteRefreshInterval = setInterval(() => {
            KickChatClient.loadPack(this.channelSlug, { kickUserId: this.kickUserId, force: true });
            KickChatClient.loadGlobalPack({ force: true });
        }, 60 * 60 * 1000);
    }

    stopEmoteRefresher() {
        if (this.emoteRefreshInterval) {
            clearInterval(this.emoteRefreshInterval);
            this.emoteRefreshInterval = null;
        }
    }

    get7TVStyle(kickUserId) {
        return SevenTVCosmetics.get(kickUserId);
    }

    /* ------------------------------------------------------------------ */
    /*  Native Kick badges                                                 */
    /* ------------------------------------------------------------------ */

    getSubscriberBadgeUrl(months = 1) {
        const list = this.subscriberBadges;
        if (!list || list.length === 0) return 'badges/subscriber.svg';
        let url = this.subscriberBadgeUrls.get(months);
        if (url) return url;

        // list is sorted by months: take the highest tier reached, or the first tier
        let picked = list[0];
        for (const b of list) {
            if (b.months <= months) picked = b;
            else break;
        }
        url = (picked && picked.badge_image && (picked.badge_image.src || picked.badge_image.srcset)) || 'badges/subscriber.svg';
        this.subscriberBadgeUrls.set(months, url);
        return url;
    }

    mapKickBadges(rawBadges) {
        if (!Array.isArray(rawBadges)) return [];
        return rawBadges
            .slice()
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map(b => KickChatClient.mapKickBadge(b, this))
            .filter(Boolean);
    }

    // Kick's sub gifter badge tiers (gifted subs needed for each icon in badges/gift/)
    static SUB_GIFTER_TIERS = [1, 5, 10, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 2000, 3000, 4000, 5000];

    static subGifterBadgeUrl(count) {
        let tier = KickChatClient.SUB_GIFTER_TIERS[0];
        for (const t of KickChatClient.SUB_GIFTER_TIERS) {
            if (t <= count) tier = t;
            else break;
        }
        return `badges/gift/gift-${tier}.svg`;
    }

    static mapKickBadge(b, ctx) {
        const type = (b.type || '').toLowerCase();
        const count = parseInt(b.count, 10) || 0;
        switch (type) {
            case 'broadcaster':
                return { type, text: 'Broadcaster', imageUrl: 'badges/broadcaster.svg' };
            case 'moderator':
                return { type, text: 'Moderator', imageUrl: 'badges/mod.svg' };
            case 'vip':
                return { type, text: 'VIP', imageUrl: 'badges/vip.svg' };
            case 'og':
                return { type, text: 'OG', imageUrl: 'badges/og.svg' };
            case 'verified':
                return { type, text: 'Verified', imageUrl: 'badges/verified.svg' };
            case 'staff':
                return { type, text: 'Staff', imageUrl: 'badges/admin.svg' };
            case 'founder':
                return { type, text: 'Founder', imageUrl: 'badges/founder.svg' };
            case 'subscriber':
                return {
                    type,
                    text: count ? `Subscriber (${count} meses)` : 'Subscriber',
                    imageUrl: ctx ? ctx.getSubscriberBadgeUrl(count || 1) : 'badges/subscriber.svg'
                };
            case 'sub_gifter':
                return { type, text: `Sub Gifter (${count})`, imageUrl: KickChatClient.subGifterBadgeUrl(count) };
            default:
                return null;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Connection                                                         */
    /* ------------------------------------------------------------------ */

    async connect() {
        this.shouldReconnect = true;
        this.dispatchEvent(new CustomEvent('connecting', {
            detail: { channel: this.channelSlug, attempt: this.reconnectAttempts }
        }));

        if (!this.initialized) {
            const ok = await this.init();
            if (!this.shouldReconnect) return; // disconnected while resolving
            if (!ok) {
                console.error(`[Kick] Could not resolve channel "${this.channelSlug}".`);
                this.dispatchEvent(new CustomEvent('error', {
                    detail: { message: `No se pudo encontrar el canal "${this.channelSlug}" en Kick.` }
                }));
                this.scheduleReconnect();
                return;
            }
        }

        this.openSocket();
    }

    openSocket() {
        this.closeSocket();
        const wsUrl = `wss://ws-${this.pusherCluster}.pusher.com/app/${this.pusherKey}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

        try {
            const ws = new WebSocket(wsUrl);
            this.ws = ws;

            ws.onopen = () => {
                this.reconnectAttempts = 0;
                this.startHeartbeat();
            };
            ws.onmessage = (event) => this.handleMessage(event);
            ws.onerror = (err) => {
                console.error('[Kick] WebSocket error:', err);
                this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
            };
            ws.onclose = (event) => {
                if (this.ws === ws) this.ws = null;
                this.isConnected = false;
                this.stopHeartbeat();
                this.dispatchEvent(new CustomEvent('disconnected', { detail: event }));
                if (this.shouldReconnect) this.scheduleReconnect();
            };
        } catch (err) {
            console.error('[Kick] Error initiating WebSocket:', err);
            this.scheduleReconnect();
        }
    }

    closeSocket() {
        if (!this.ws) return;
        const ws = this.ws;
        this.ws = null;
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
            ws.close();
        } catch (e) {}
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    // Never gives up: an OBS source has nobody watching to reload it, so it keeps retrying every minute at most
    scheduleReconnect() {
        if (!this.shouldReconnect) return;
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    handleMessage(event) {
        try {
            const packet = JSON.parse(event.data);
            const evt = packet.event;
            const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

            if (evt === 'pusher:connection_established') {
                this.socketId = parse(packet.data).socket_id;
                this.isConnected = true;
                this.subscribeToChannels();
                this.dispatchEvent(new CustomEvent('connected', {
                    detail: { channel: this.channelSlug, channelId: this.channelId, chatroomId: this.chatroomId }
                }));
                this.loadHistory();
                return;
            }

            if (evt === 'App\\Events\\ChatMessageEvent') {
                const normalized = this.normalizeMessage(parse(packet.data));
                if (this.historyLoading) this.pendingLive.push(normalized);
                else this.emitMessage(normalized);
                return;
            }

            if (evt === 'App\\Events\\MessageDeletedEvent') {
                const data = parse(packet.data);
                const messageId = data?.message?.id || data?.id;
                if (messageId) this.dispatchEvent(new CustomEvent('message_deleted', { detail: { messageId } }));
                return;
            }

            // Kicks sent to the streamer and channel point rewards. Not checked against a live
            // stream yet: the field names come from Kick's web client.
            if (evt === 'KicksGifted' || evt === 'App\\Events\\KicksGifted') {
                const data = parse(packet.data);
                this.emitChannelEvent({
                    kind: 'donation',
                    username: data?.sender?.username,
                    color: data?.sender?.username_color,
                    title: data?.gift?.name || 'Kicks',
                    amount: Number(data?.gift?.amount) || 0,
                    text: data?.message || ''
                });
                return;
            }

            if (evt === 'RewardRedeemedEvent' || evt === 'App\\Events\\RewardRedeemedEvent') {
                const data = parse(packet.data);
                this.emitChannelEvent({
                    kind: 'reward',
                    username: data?.username,
                    title: data?.reward_title || '',
                    accent: data?.reward_background_color,
                    text: data?.user_input || ''
                });
                return;
            }

            if (evt === 'App\\Events\\UserBannedEvent') {
                const data = parse(packet.data);
                this.dispatchEvent(new CustomEvent('user_banned', {
                    detail: {
                        username: data?.user?.username || data?.username,
                        userId: data?.user?.id || data?.id,
                        permanent: Boolean(data?.permanent),
                        duration: data?.duration || 0
                    }
                }));
            }
        } catch (err) {
            console.error('[Kick] Error parsing packet:', err);
        }
    }

    subscribeToChannels() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const channels = [
            `chatrooms.${this.chatroomId}.v2`,
            `chatrooms.${this.chatroomId}`,
            `chatroom_${this.chatroomId}`,
            `channel_${this.channelId}`
        ];
        channels.forEach(ch => {
            this.ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: ch } }));
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Message normalization                                              */
    /* ------------------------------------------------------------------ */

    /**
     * options.emotes: the channel's emote Map; when omitted, the pack of options.channel is used.
     * 7TV emotes match the exact name, case included ("LUL" is not "lul").
     */
    static parseContentToHtml(content, options = {}) {
        if (!content) return '';

        const escapeHtml = KickChatClient.escapeHtml;
        const emotesMap = options.sevenTVEmotes === false
            ? null
            : (options.emotes || KickChatClient.getPack(options.channel).emotes);
        const globalEmotesMap = options.sevenTVEmotes === false
            ? null
            : (options.globalEmotes || KickChatClient.getGlobalPack().emotes);

        // Tokenize: Kick native emotes become standalone tokens, rest split by whitespace
        const tokens = [];
        const emoteRegex = /\[emote:(\d+):([^\]\s]+)\]/g;
        let last = 0;
        let m;
        while ((m = emoteRegex.exec(content)) !== null) {
            if (m.index > last) tokens.push({ text: content.slice(last, m.index) });
            tokens.push({ kick: { id: m[1], name: m[2] } });
            last = m.index + m[0].length;
        }
        if (last < content.length) tokens.push({ text: content.slice(last) });

        const out = [];      // { html, isEmote, space }
        const pushEmote = (html, zeroWidth) => {
            if (zeroWidth && out.length && out[out.length - 1].isEmote) {
                const prev = out[out.length - 1];
                prev.html = `<span class="emote-stack">${prev.html}${html.replace('chat-emote', 'chat-emote zero-width')}</span>`;
                return;
            }
            out.push({ html, isEmote: true });
        };

        tokens.forEach(tok => {
            if (tok.kick) {
                const name = escapeHtml(tok.kick.name);
                pushEmote(`<img class="chat-emote" decoding="async" src="https://files.kick.com/emotes/${tok.kick.id}/fullsize" alt="${name}" title="${name}">`, false);
                return;
            }
            // split() with a capture group alternates words (even indexes) and whitespace runs (odd indexes)
            const parts = tok.text.split(/(\s+)/);
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part === '') continue;
                if (i % 2 === 1) {
                    out.push({ html: part, isEmote: false, space: true });
                    continue;
                }
                const em = (emotesMap && emotesMap.get(part)) || (globalEmotesMap && globalEmotesMap.get(part));
                if (em) {
                    if (em.zeroWidth && out.length >= 2 && out[out.length - 1].space && out[out.length - 2].isEmote) {
                        out.pop();
                    }
                    const name = escapeHtml(part);
                    pushEmote(`<img class="chat-emote" decoding="async" src="${em.url}" alt="${name}" title="${name}">`, em.zeroWidth);
                } else {
                    out.push({ html: escapeHtml(part), isEmote: false });
                }
            }
        });

        return out.map(o => o.html).join('');
    }

    parseContentToHtml(content) {
        return KickChatClient.parseContentToHtml(content, {
            sevenTVEmotes: this.sevenTVEmotes,
            channel: this.channelSlug
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Chat history                                                       */
    /* ------------------------------------------------------------------ */

    // Kick's API returns the channel's latest messages (25, newest first). Loading them on every
    // connect fills the overlay at start-up and recovers what was missed while reconnecting.
    static HISTORY_TIMEOUT_MS = 5000;

    async loadHistory() {
        if (!this.channelId || this.historyLoading) return;
        this.historyLoading = true;

        let data = null;
        try {
            const timeout = new Promise(resolve => setTimeout(resolve, KickChatClient.HISTORY_TIMEOUT_MS, null));
            data = await Promise.race([
                KickApi.fetchJson(`https://kick.com/api/v2/channels/${this.channelId}/messages`),
                timeout
            ]);
        } catch (e) {
            console.warn('[Kick] History request failed:', e);
        }
        if (!this.shouldReconnect) return; // client was closed meanwhile

        const list = data && data.data && Array.isArray(data.data.messages) ? data.data.messages : [];
        list.slice().reverse().forEach(raw => {
            if (raw && raw.sender) this.emitMessage(this.normalizeMessage(raw), true);
        });

        // Live messages that arrived meanwhile go after the history, minus any it already had
        this.historyLoading = false;
        const queued = this.pendingLive;
        this.pendingLive = [];
        queued.forEach(msg => this.emitMessage(msg));
    }

    // Donations and rewards can arrive on more than one subscribed channel: the same one within
    // two seconds is sent once
    emitChannelEvent(detail) {
        if (!detail.username) return;
        const key = `${detail.kind}:${detail.username}:${detail.title}:${detail.amount || 0}:${detail.text}`;
        const now = Date.now();
        this.recentChannelEvents = (this.recentChannelEvents || []).filter(e => now - e.t < 2000);
        if (this.recentChannelEvents.some(e => e.key === key)) return;
        this.recentChannelEvents.push({ key, t: now });
        this.dispatchEvent(new CustomEvent('channel_event', {
            detail: { ...detail, id: `${detail.kind}-${now}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString() }
        }));
    }

    // Sends a message to the overlay once: history and the live socket can both deliver it
    emitMessage(msg, isHistory = false) {
        if (this.seenMessageIds.has(msg.id)) return;
        this.seenMessageIds.add(msg.id);
        if (this.seenMessageIds.size > 1000) {
            this.seenMessageIds.delete(this.seenMessageIds.values().next().value);
        }
        if (isHistory) msg.isHistory = true;
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    }

    normalizeMessage(data) {
        const sender = data.sender || {};
        const identity = sender.identity || {};

        let color = identity.color || sender.color;
        if (!color || color === '#000000' || color === '#000' || color.toLowerCase() === 'black' || color === 'transparent') {
            color = this.generateUserColor(sender.username || 'user');
        }

        return {
            id: data.id || `kick-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            chatroomId: data.chatroom_id || this.chatroomId,
            content: data.content || '',
            html: this.parseContentToHtml(data.content || ''),
            createdAt: data.created_at || new Date().toISOString(),
            sender: {
                id: sender.id,
                username: sender.username || 'Anónimo',
                slug: sender.slug || sender.username || '',
                color,
                badges: this.mapKickBadges(identity.badges)
            }
        };
    }

    generateUserColor(username) {
        const colors = KickChatClient.USER_COLORS;
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    disconnect() {
        this.shouldReconnect = false;
        this.stopHeartbeat();
        this.stopEmoteRefresher();
        SevenTVEvents.unwatch(this.channelSlug);
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.closeSocket();
        this.isConnected = false;
    }
}

if (typeof window !== 'undefined') {
    window.KickCache = KickCache;
    window.KickApi = KickApi;
    window.SevenTVCosmetics = SevenTVCosmetics;
    window.SevenTVEvents = SevenTVEvents;
    window.KickChatClient = KickChatClient;
    KickChatClient.migrateLegacyPacks();
    // Flush the debounced cosmetics cache when OBS or the browser closes the page
    window.addEventListener('pagehide', () => SevenTVCosmetics.persist());
}
