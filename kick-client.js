/**
 * Kick Realtime Chat Client
 * - Kick Pusher WebSocket (chat, deletes, bans)
 * - Native Kick badges (local SVGs + channel subscriber badge images)
 * - 7TV integration: channel + global emotes, user badges, user name colors / paints
 */

/**
 * Lightweight localStorage Cache with TTL and LRU eviction
 */
class KickCache {
    static PREFIX = 'kick_cache_';

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
        try {
            const item = {
                val,
                exp: ttlMs ? Date.now() + ttlMs : 0
            };
            localStorage.setItem(this.PREFIX + key, JSON.stringify(item));
        } catch (e) {
            // Prune expired or old entries if quota reached
            KickCache.prune(true);
            try {
                const item = { val, exp: ttlMs ? Date.now() + ttlMs : 0 };
                localStorage.setItem(this.PREFIX + key, JSON.stringify(item));
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
            const userStyles = [];

            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(this.PREFIX)) {
                    try {
                        const item = JSON.parse(localStorage.getItem(k));
                        if (item && item.exp && now > item.exp) {
                            keysToRemove.push(k);
                        } else if (k.startsWith(this.PREFIX + '7tv_')) {
                            userStyles.push({ key: k, exp: item?.exp || 0 });
                        }
                    } catch (err) {
                        keysToRemove.push(k);
                    }
                }
            }

            keysToRemove.forEach(k => localStorage.removeItem(k));

            if (forceEvictOldest && userStyles.length > 50) {
                userStyles.sort((a, b) => a.exp - b.exp);
                userStyles.slice(0, Math.floor(userStyles.length / 2)).forEach(u => {
                    localStorage.removeItem(u.key);
                });
            }
        } catch (e) {}
    }
}

class KickChatClient extends EventTarget {
    static CHANNEL_DEFAULTS = {
        rageylo: { channelId: 19024162, chatroomId: 18761973, kickUserId: 19996585 }
    };

    static CHANNEL_PACKS = new Map();
    static CHANNEL_PACKS_LOWER = new Map();

    static getChannelEmotes(channel) {
        const slug = (channel || 'rageylo').toLowerCase().trim();
        if (KickChatClient.CHANNEL_PACKS.has(slug)) {
            return KickChatClient.CHANNEL_PACKS.get(slug);
        }
        const map = new Map();
        const lower = new Map();
        const cached = KickCache.get(`emotes_${slug}`);
        if (Array.isArray(cached) && cached.length > 0) {
            cached.forEach(([name, em]) => {
                if (name && em) {
                    map.set(name, em);
                    lower.set(name.toLowerCase(), name);
                }
            });
        }
        KickChatClient.CHANNEL_PACKS.set(slug, map);
        KickChatClient.CHANNEL_PACKS_LOWER.set(slug, lower);
        return map;
    }

    static getChannelLowerMap(channel) {
        const slug = (channel || 'rageylo').toLowerCase().trim();
        if (!KickChatClient.CHANNEL_PACKS_LOWER.has(slug)) {
            KickChatClient.getChannelEmotes(slug);
        }
        return KickChatClient.CHANNEL_PACKS_LOWER.get(slug) || new Map();
    }

    static async loadChannelPack(channel, kickUserId = null) {
        const slug = (channel || 'rageylo').toLowerCase().trim();
        const userId = kickUserId || (slug === 'rageylo' ? 19996585 : null);
        if (!userId) return null;

        try {
            const res = await fetch(`https://7tv.io/v3/users/kick/${userId}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.emote_set && Array.isArray(data.emote_set.emotes)) {
                    const map = new Map();
                    const lower = new Map();
                    data.emote_set.emotes.forEach(em => {
                        if (!em || !em.name || !em.id) return;
                        const flags = em.flags || 0;
                        const dataFlags = (em.data && em.data.flags) || 0;
                        const zeroWidth = Boolean((flags & 1) || (dataFlags & 256));
                        map.set(em.name, {
                            url: `https://cdn.7tv.app/emote/${em.id}/2x.webp`,
                            zeroWidth
                        });
                        lower.set(em.name.toLowerCase(), em.name);
                    });
                    KickChatClient.CHANNEL_PACKS.set(slug, map);
                    KickChatClient.CHANNEL_PACKS_LOWER.set(slug, lower);
                    KickCache.set(`emotes_${slug}`, Array.from(map.entries()), 6 * 60 * 60 * 1000);
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('channel_emotes_loaded', { detail: { channel: slug } }));
                    }
                    return map;
                }
            }
        } catch (e) {
            console.warn(`[7TV] Error cargando pack de emotes del canal "${slug}":`, e);
        }
        return null;
    }

    static initEmoteStore() {
        // Pre-cargar pack de emotes del canal por defecto (rageylo) para vista previa
        KickChatClient.getChannelEmotes('rageylo');
        KickChatClient.loadChannelPack('rageylo', 19996585);
    }

    constructor(options = {}) {
        super();
        this.channelSlug = (options.channel || 'rageylo').toLowerCase().trim();
        this.channelId = options.channelId || null;
        this.chatroomId = options.chatroomId || null;
        this.kickUserId = options.kickUserId || null;

        // Pusher configuration
        this.pusherKey = options.pusherKey || '34bf7a0ff419a2a775b9';
        this.pusherCluster = options.pusherCluster || 'us2';
        this.ws = null;
        this.socketId = null;
        this.isConnected = false;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;
        this.reconnectTimeout = null;
        this.pingInterval = null;

        this.sevenTVEmotes = options.sevenTVEmotes !== false;

        // Channel assets - EXCLUSIVAMENTE limitados al pack de emotes del canal seleccionado
        this.subscriberBadges = [];
        this.emotes = new Map();
        this.lowerEmoteMap = new Map();
        this.sevenTvStyles = new Map(); // kick user id -> Promise<style|null>

        // Restaurar caché inmediata de este canal si ya existe
        this.restoreCachedEmotes();
    }

    /* ------------------------------------------------------------------ */
    /*  Channel resolution                                                 */
    /* ------------------------------------------------------------------ */

    async fetchJsonWithFallback(targetUrl) {
        const attempts = [
            async () => {
                const res = await fetch(targetUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            },
            async () => {
                const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
                if (!res.ok) throw new Error(`Proxy 1 HTTP ${res.status}`);
                return await res.json();
            },
            async () => {
                const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
                if (!res.ok) throw new Error(`Proxy 2 HTTP ${res.status}`);
                return await res.json();
            }
        ];
        for (const attempt of attempts) {
            try {
                return await attempt();
            } catch (err) {
                console.warn('[Kick] fetch attempt failed:', targetUrl, err.message);
            }
        }
        return null;
    }

    async refreshChannelData(slug) {
        try {
            const data = await this.fetchJsonWithFallback(`https://kick.com/api/v2/channels/${slug}`);
            if (data && (data.id || data.chatroom)) {
                this.channelId = data.id || (data.chatroom ? data.chatroom.channel_id : null);
                this.chatroomId = data.chatroom ? data.chatroom.id : (data.id || null);
                this.kickUserId = data.user_id || (data.user && data.user.id) || null;

                if (Array.isArray(data.subscriber_badges)) {
                    this.subscriberBadges = data.subscriber_badges
                        .slice()
                        .sort((a, b) => a.months - b.months);
                }

                KickCache.set(`channel_${slug}`, {
                    channelId: this.channelId,
                    chatroomId: this.chatroomId,
                    kickUserId: this.kickUserId,
                    subscriberBadges: this.subscriberBadges
                }, 24 * 60 * 60 * 1000); // 24 hours

                console.log(`[Kick] Synced channel "${slug}": channel=${this.channelId} chatroom=${this.chatroomId} user=${this.kickUserId}`);
                return true;
            }
        } catch (e) {
            console.warn('[Kick] Channel refresh error:', e);
        }
        return false;
    }

    async resolveChannel() {
        const slug = this.channelSlug;

        // 1) Fast path: restore instantly from cache
        const cached = KickCache.get(`channel_${slug}`);
        if (cached && cached.channelId && cached.chatroomId) {
            this.channelId = cached.channelId;
            this.chatroomId = cached.chatroomId;
            this.kickUserId = cached.kickUserId;
            this.subscriberBadges = Array.isArray(cached.subscriberBadges) ? cached.subscriberBadges : [];
            console.log(`[Kick] [Cache] Loaded "${slug}" instantly: channel=${this.channelId} chatroom=${this.chatroomId} user=${this.kickUserId}`);

            // Stale-while-revalidate in background without blocking
            this.refreshChannelData(slug);
            return true;
        }

        // 2) Network path
        const success = await this.refreshChannelData(slug);
        if (success) return true;

        // 3) Hardcoded fallback for known channels (e.g. rageylo) so OBS never breaks
        const fallback = KickChatClient.CHANNEL_DEFAULTS[slug];
        if (fallback) {
            this.channelId = fallback.channelId;
            this.chatroomId = fallback.chatroomId;
            this.kickUserId = fallback.kickUserId;
            this.subscriberBadges = [];
            KickCache.set(`channel_${slug}`, {
                channelId: this.channelId,
                chatroomId: this.chatroomId,
                kickUserId: this.kickUserId,
                subscriberBadges: []
            }, 12 * 60 * 60 * 1000);
            console.warn(`[Kick] Using fallback data for "${slug}": channel=${this.channelId}`);
            return true;
        }

        console.error(`[Kick] Could not resolve channel "${slug}".`);
        return false;
    }

    /* ------------------------------------------------------------------ */
    /*  Emotes (Pack exclusivo del canal: Kick sub emotes + 7TV canal)    */
    /* ------------------------------------------------------------------ */

    restoreCachedEmotes() {
        const cached = KickCache.get(`emotes_${this.channelSlug}`);
        if (Array.isArray(cached) && cached.length > 0) {
            this.emotes.clear();
            this.lowerEmoteMap.clear();
            cached.forEach(([name, em]) => {
                if (name && em) {
                    this.emotes.set(name, em);
                    this.lowerEmoteMap.set(name.toLowerCase(), name);
                }
            });
            console.log(`[Kick] [Cache] Restored ${cached.length} emotes exclusively for #${this.channelSlug}`);
        }
    }

    add7TVEmoteSet(emotes) {
        if (!Array.isArray(emotes)) return 0;
        let count = 0;
        emotes.forEach(em => {
            if (!em || !em.name || !em.id) return;
            const flags = em.flags || 0;
            const dataFlags = (em.data && em.data.flags) || 0;
            const zeroWidth = Boolean((flags & 1) || (dataFlags & 256));
            this.emotes.set(em.name, {
                url: `https://cdn.7tv.app/emote/${em.id}/2x.webp`,
                zeroWidth
            });
            this.lowerEmoteMap.set(em.name.toLowerCase(), em.name);
            count++;
        });
        return count;
    }

    async loadEmotes() {
        // 1) Restaurar inmediatamente desde la caché local de este canal
        this.restoreCachedEmotes();

        // 2) Cargar EXCLUSIVAMENTE el pack de emotes de 7TV del canal seleccionado
        if (this.sevenTVEmotes) {
            const targetUserId = this.kickUserId || (this.channelSlug === 'rageylo' ? 19996585 : null);
            if (targetUserId) {
                try {
                    const res = await fetch(`https://7tv.io/v3/users/kick/${targetUserId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.emote_set && Array.isArray(data.emote_set.emotes)) {
                            // Limpiar para asegurar que SOLO existan los emotes actuales de su pack
                            this.emotes.clear();
                            this.lowerEmoteMap.clear();
                            const n = this.add7TVEmoteSet(data.emote_set.emotes);
                            console.log(`[7TV] Pack de emotes del canal #${this.channelSlug} cargado: ${n} emotes (globales 7TV excluidos)`);
                        }
                    } else {
                        console.warn(`[7TV] No se encontró pack de 7TV para kick user ${targetUserId}:`, res.status);
                    }
                } catch (e) {
                    console.warn(`[7TV] Error cargando pack de emotes del canal #${this.channelSlug}:`, e);
                }
            }
        }

        // 3) Emotes de suscriptor nativos de Kick del propio canal (si tiene)
        try {
            const kickData = await this.fetchJsonWithFallback(`https://kick.com/emotes/${this.channelSlug}`);
            if (Array.isArray(kickData)) {
                kickData.forEach(set => {
                    if (set && Array.isArray(set.emotes)) {
                        set.emotes.forEach(em => {
                            if (em.name && em.id && !this.emotes.has(em.name)) {
                                this.emotes.set(em.name, {
                                    url: `https://files.kick.com/emotes/${em.id}/fullsize`,
                                    zeroWidth: false
                                });
                                this.lowerEmoteMap.set(em.name.toLowerCase(), em.name);
                            }
                        });
                    }
                });
            }
        } catch (e) {
            // Kick sub emotes opcionales
        }

        // Guardar snapshot actualizado en la caché de este canal
        if (this.emotes.size > 0) {
            KickCache.set(`emotes_${this.channelSlug}`, Array.from(this.emotes.entries()), 6 * 60 * 60 * 1000);
            KickChatClient.CHANNEL_PACKS.set(this.channelSlug, this.emotes);
            KickChatClient.CHANNEL_PACKS_LOWER.set(this.channelSlug, this.lowerEmoteMap);
        }
    }

    startEmoteRefresher() {
        this.stopEmoteRefresher();
        // Sincronización periódica automática del pack del canal cada 5 minutos
        this.emoteRefreshInterval = setInterval(() => {
            this.refresh7TVEmotes();
        }, 5 * 60 * 1000);
    }

    stopEmoteRefresher() {
        if (this.emoteRefreshInterval) {
            clearInterval(this.emoteRefreshInterval);
            this.emoteRefreshInterval = null;
        }
    }

    async refresh7TVEmotes() {
        if (!this.sevenTVEmotes) return;
        const targetUserId = this.kickUserId || (this.channelSlug === 'rageylo' ? 19996585 : null);
        if (!targetUserId) return;

        try {
            const res = await fetch(`https://7tv.io/v3/users/kick/${targetUserId}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.emote_set && Array.isArray(data.emote_set.emotes)) {
                    this.emotes.clear();
                    this.lowerEmoteMap.clear();
                    const n = this.add7TVEmoteSet(data.emote_set.emotes);
                    KickCache.set(`emotes_${this.channelSlug}`, Array.from(this.emotes.entries()), 6 * 60 * 60 * 1000);
                    KickChatClient.CHANNEL_PACKS.set(this.channelSlug, this.emotes);
                    KickChatClient.CHANNEL_PACKS_LOWER.set(this.channelSlug, this.lowerEmoteMap);
                    console.log(`[7TV] Sincronización periódica del pack de #${this.channelSlug}: ${n} emotes`);
                }
            }
        } catch (e) {
            console.warn('[7TV] Error en sincronización periódica del pack:', e);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  7TV user cosmetics (badge, name color, paint)                      */
    /* ------------------------------------------------------------------ */

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
        const rgba = KickChatClient.intToRgba;
        const fn = (paint.function || '').toUpperCase();
        const out = {
            function: fn,
            image_url: paint.image_url || null,
            background: null,
            color: null,
            filter: null
        };

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

    /**
     * Returns (cached) Promise resolving to:
     *   { color: 'rgba()', paint: {background, color, filter, function, image_url}|null, badge: {type:'7tv', text, imageUrl}|null } | null
     */
    get7TVStyle(kickUserId) {
        if (!kickUserId) return Promise.resolve(null);
        const key = String(kickUserId);
        const cacheKey = `7tv_v2_${key}`;

        // 1) In-memory active promise/value
        if (this.sevenTvStyles.has(key)) return this.sevenTvStyles.get(key);

        // 2) Check persistent localStorage cache
        const cached = KickCache.get(cacheKey);
        if (cached !== null) {
            const resolvedValue = (cached && !cached.none) ? cached : null;
            const p = Promise.resolve(resolvedValue);
            this.sevenTvStyles.set(key, p);
            return p;
        }

        // 3) Network query via 7TV GraphQL
        const query = `{ userByConnection(platform: KICK, id: "${key}") { id username style { color badge { id name tooltip host { url files { name } } } paint { id name function color angle shape image_url repeat stops { at color } shadows { x_offset y_offset radius color } } } } }`;

        const promise = (async () => {
            try {
                const res = await fetch('https://7tv.io/v3/gql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                if (!res.ok) {
                    KickCache.set(cacheKey, { none: true }, 15 * 60 * 1000);
                    return null;
                }
                const json = await res.json();
                const user = json && json.data && json.data.userByConnection;
                if (!user || /^0+$/.test(user.id || '') || user.username === '*DeletedUser') {
                    // Cache absence of 7TV account for 1 hour to avoid repeated requests
                    KickCache.set(cacheKey, { none: true }, 60 * 60 * 1000);
                    return null;
                }

                const style = user.style || {};
                let badge = null;
                if (style.badge && style.badge.host) {
                    let hostUrl = style.badge.host.url || '';
                    if (hostUrl.startsWith('//')) hostUrl = 'https:' + hostUrl;
                    const files = (style.badge.host.files || []).map(f => f.name);
                    const file = files.includes('2x.webp') ? '2x.webp' : (files[0] || '1x.webp');
                    badge = {
                        type: '7tv',
                        text: style.badge.tooltip || style.badge.name || '7TV',
                        imageUrl: `${hostUrl}/${file}`
                    };
                }

                const outStyle = {
                    color: style.color ? KickChatClient.intToRgba(style.color) : null,
                    paint: KickChatClient.paintToCss(style.paint),
                    badge
                };

                // Cache active 7TV style for 6 hours
                KickCache.set(cacheKey, outStyle, 6 * 60 * 60 * 1000);
                return outStyle;
            } catch (e) {
                return null;
            }
        })();

        this.sevenTvStyles.set(key, promise);
        return promise;
    }

    /* ------------------------------------------------------------------ */
    /*  Native Kick badges                                                 */
    /* ------------------------------------------------------------------ */

    getSubscriberBadgeUrl(months = 1) {
        const list = this.subscriberBadges;
        if (!list || list.length === 0) return 'badges/subscriber.svg';
        const exact = list.find(b => b.months === months);
        const lower = list.slice().reverse().find(b => b.months < months);
        const picked = exact || lower || list[0];
        return (picked && picked.badge_image && (picked.badge_image.src || picked.badge_image.srcset)) || 'badges/subscriber.svg';
    }

    mapKickBadges(rawBadges) {
        if (!Array.isArray(rawBadges)) return [];
        return rawBadges
            .slice()
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map(b => KickChatClient.mapKickBadge(b, this))
            .filter(Boolean);
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
            case 'sub_gifter': {
                let url = 'badges/gift_blue.svg';
                if (count >= 200) url = 'badges/gift_green.svg';
                else if (count >= 100) url = 'badges/gift_yellow.svg';
                else if (count >= 50) url = 'badges/gift_red.svg';
                else if (count >= 25) url = 'badges/gift_mauve.svg';
                return { type, text: `Sub Gifter (${count})`, imageUrl: url };
            }
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

        const resolved = await this.resolveChannel();
        if (!resolved) {
            this.dispatchEvent(new CustomEvent('error', {
                detail: { message: `No se pudo encontrar el canal "${this.channelSlug}" en Kick.` }
            }));
            this.scheduleReconnect();
            return;
        }

        this.loadEmotes();
        this.startEmoteRefresher();

        const wsUrl = `wss://ws-${this.pusherCluster}.pusher.com/app/${this.pusherKey}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

        try {
            if (this.ws) this.ws.close();
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.reconnectAttempts = 0;
                this.startHeartbeat();
            };
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onerror = (err) => {
                console.error('[Kick] WebSocket error:', err);
                this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
            };
            this.ws.onclose = (event) => {
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

    scheduleReconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
        this.reconnectAttempts++;
        const delay = Math.min(2000 * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
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
                return;
            }

            if (evt === 'App\\Events\\ChatMessageEvent') {
                const normalized = this.normalizeMessage(parse(packet.data));
                this.dispatchEvent(new CustomEvent('message', { detail: normalized }));
                return;
            }

            if (evt === 'App\\Events\\MessageDeletedEvent') {
                const data = parse(packet.data);
                const messageId = data?.message?.id || data?.id;
                if (messageId) this.dispatchEvent(new CustomEvent('message_deleted', { detail: { messageId } }));
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

    static parseContentToHtml(content, options = {}) {
        if (!content) return '';

        const sevenTVEnabled = options.sevenTVEmotes !== false;
        const targetChannel = (options.channel || 'rageylo').toLowerCase().trim();
        const emotesMap = options.emotes || KickChatClient.getChannelEmotes(targetChannel);
        const lowerMap = options.lowerMap || KickChatClient.getChannelLowerMap(targetChannel);

        const escapeHtml = (str) => str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

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

        const out = [];      // { html, isEmote }
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
                pushEmote(`<img class="chat-emote" src="https://files.kick.com/emotes/${tok.kick.id}/fullsize" alt="${escapeHtml(tok.kick.name)}" title="${escapeHtml(tok.kick.name)}">`, false);
                return;
            }
            const parts = tok.text.split(/(\s+)/);
            parts.forEach(part => {
                if (part === '') return;
                if (/^\s+$/.test(part)) {
                    out.push({ html: part, isEmote: false, space: true });
                    return;
                }
                let em = null;
                let emoteName = part;
                if (sevenTVEnabled && emotesMap) {
                    if (emotesMap.has(part)) {
                        em = emotesMap.get(part);
                    } else if (lowerMap && lowerMap.has(part.toLowerCase())) {
                        emoteName = lowerMap.get(part.toLowerCase());
                        em = emotesMap.get(emoteName);
                    }
                }
                if (em) {
                    if (em.zeroWidth && out.length >= 2 && out[out.length - 1].space && out[out.length - 2].isEmote) {
                        out.pop();
                    }
                    pushEmote(`<img class="chat-emote" src="${em.url}" alt="${escapeHtml(emoteName)}" title="${escapeHtml(emoteName)}">`, em.zeroWidth);
                } else {
                    out.push({ html: escapeHtml(part), isEmote: false });
                }
            });
        });

        return out.map(o => o.html).join('');
    }

    parseContentToHtml(content) {
        return KickChatClient.parseContentToHtml(content, {
            sevenTVEmotes: this.sevenTVEmotes,
            emotes: this.emotes,
            lowerMap: this.lowerEmoteMap,
            channel: this.channelSlug
        });
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
        const colors = [
            '#53fc18', '#00e5ff', '#ff3366', '#ffb703',
            '#a78bfa', '#f43f5e', '#38bdf8', '#4ade80',
            '#fb923c', '#e879f9', '#2dd4bf', '#facc15'
        ];
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
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}

if (typeof window !== 'undefined') {
    window.KickCache = KickCache;
    window.KickChatClient = KickChatClient;
    try {
        KickChatClient.initEmoteStore();
    } catch (e) {
        console.warn('initEmoteStore error:', e);
    }
}
