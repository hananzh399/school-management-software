// SoftSchool WhatsApp gateway core: one Baileys session PER SCHOOL + the anti-ban limiter.
// The limits live HERE (not only in the backend) so no bug or abuse upstream can bypass them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export const cfg = {
  port: num(process.env.PORT, 3001),
  host: process.env.HOST || '127.0.0.1',
  apiKey: process.env.API_KEY || '',
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || './sessions'),
  cc: String(process.env.DEFAULT_COUNTRY_CODE || '92').replace(/\D/g, ''),
  // pacing between two messages (random, so the rhythm is human-like)
  minDelay: num(process.env.MIN_DELAY_MS, 6000),
  maxDelay: num(process.env.MAX_DELAY_MS, 14000),
  // simulated "typing…" time before each message
  typingMin: num(process.env.TYPING_MIN_MS, 800),
  typingMax: num(process.env.TYPING_MAX_MS, 2000),
  // longer rest after every N messages
  breakEvery: num(process.env.BREAK_EVERY, 15),
  breakMin: num(process.env.BREAK_MIN_MS, 60000),
  breakMax: num(process.env.BREAK_MAX_MS, 120000),
  // caps per school number (rolling windows)
  dailyLimit: num(process.env.DAILY_LIMIT, 300),   // per rolling 24 h, AFTER warm-up
  hourlyLimit: num(process.env.HOURLY_LIMIT, 60),  // per rolling 60 min
  warmup: process.env.WARMUP !== 'false',          // smaller caps while a number is new
  // nothing is sent at night; the queue simply waits for the morning
  quietStart: num(process.env.QUIET_START_HOUR, 21),
  quietEnd: num(process.env.QUIET_END_HOUR, 7),
  quietTz: process.env.QUIET_TZ || 'Asia/Karachi',
  maxQueue: num(process.env.MAX_QUEUE, 600),
  maxPerRequest: 300,
  failLimit: 5,                 // consecutive send failures before the circuit opens
  failPauseMs: 30 * 60 * 1000,  // ...and sending pauses for 30 minutes
};
if (cfg.maxDelay < cfg.minDelay) cfg.maxDelay = cfg.minDelay;
if (cfg.typingMax < cfg.typingMin) cfg.typingMax = cfg.typingMin;

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '');

/** "0300-1234567" | "+92 300 1234567" | "923001234567" -> "923001234567" (or null) */
export function normalizePhone(raw, country = cfg.cc, strict = false) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = country + d.slice(1);
  else if (!d.startsWith(country) && d.length <= 10) d = country + d;
  if (d.length < 10 || d.length > 15) return null;
  return strict && looksFakeNumber(d, country) ? null : d;
}

/** Numbers nobody really owns: 11111, 0300-0000000, 03111111111, 03001234567 ... and non-mobile Pakistani numbers. */
export function looksFakeNumber(d, country = cfg.cc) {
  const n = d.startsWith(country) ? d.slice(country.length) : d;
  if (country === '92' && d.startsWith('92') && !/^3\d{9}$/.test(n)) return true; // PK mobile = 3XX XXXXXXX
  if (new Set(n).size <= 2) return true;                                        // 0000000000, 3111111111
  const tail = n.slice(-7);
  if (new Set(tail).size === 1) return true;                                    // 0300-1111111
  return '01234567890123456789'.includes(tail) || '98765432109876543210'.includes(tail); // 0300-1234567
}

/** New numbers get small caps that grow with the age of the link (WhatsApp watches new accounts hardest). */
export function warmupCap(ageDays, dailyLimit = cfg.dailyLimit, warmup = cfg.warmup) {
  if (!warmup) return dailyLimit;
  const steps = [[2, 40], [4, 80], [7, 150], [14, 220]];
  for (const [days, cap] of steps) if (ageDays < days) return Math.min(cap, dailyLimit);
  return dailyLimit;
}

export function inQuietHours(date = new Date(), start = cfg.quietStart, end = cfg.quietEnd, tz = cfg.quietTz) {
  if (start === end) return false;
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(date));
  return start < end ? h >= start && h < end : h >= start || h < end;
}

const hashOf = (to, text) => crypto.createHash('sha1').update(to + '|' + text).digest('hex');

export class Session {
  constructor(schoolId) {
    this.schoolId = schoolId;
    this.dir = path.join(cfg.sessionsDir, schoolId);
    this.sock = null;
    this.state = 'disconnected'; // disconnected | connecting | qr | pairing | connected
    this.qr = null;
    this.pairingCode = null;
    this.pairPhone = null;
    this.me = null;
    this.queue = [];
    this.working = false;
    this.stopping = false;
    this.dead = false;
    this.retries = 0;
    this.sinceBreak = 0;
    this.failStreak = 0;
    this.pausedUntil = 0;
    this.meta = { linkedAt: null, sent: [], dedupe: {} };
    this.saveTimer = null;
    this.load();
  }

  // ───────── persistence (so a restart never resets the limits or loses the queue) ─────────
  load() {
    try { this.meta = { ...this.meta, ...JSON.parse(fs.readFileSync(path.join(this.dir, 'meta.json'), 'utf8')) }; } catch { /* first run */ }
    try { this.queue = JSON.parse(fs.readFileSync(path.join(this.dir, 'queue.json'), 'utf8')); } catch { /* none */ }
    if (!Array.isArray(this.queue)) this.queue = [];
  }
  persist() {
    if (this.dead || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dead) return;
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta));
        fs.writeFileSync(path.join(this.dir, 'queue.json'), JSON.stringify(this.queue));
      } catch (e) { log.warn({ e: e.message }, 'persist failed'); }
    }, 300);
    this.saveTimer.unref?.();
  }
  flush() { // write now (used by tests / shutdown)
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.dead) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta));
    fs.writeFileSync(path.join(this.dir, 'queue.json'), JSON.stringify(this.queue));
  }

  // ───────── limiter ─────────
  prune(now = Date.now()) {
    this.meta.sent = this.meta.sent.filter((t) => now - t < DAY);
    for (const [h, t] of Object.entries(this.meta.dedupe)) if (now - t >= DAY) delete this.meta.dedupe[h];
  }
  ageDays(now = Date.now()) { return this.meta.linkedAt ? Math.floor((now - this.meta.linkedAt) / DAY) : 0; }
  dailyCap(now = Date.now()) { return warmupCap(this.ageDays(now)); }
  sentToday(now = Date.now()) { this.prune(now); return this.meta.sent.length; }
  sentThisHour(now = Date.now()) { return this.meta.sent.filter((t) => now - t < HOUR).length; }
  /** How many NEW messages can still be accepted today without exceeding the safe cap. */
  remainingToday(now = Date.now()) { return Math.max(0, this.dailyCap(now) - this.sentToday(now) - this.queue.length); }

  view() {
    const now = Date.now();
    return {
      schoolId: this.schoolId,
      state: this.state,
      connected: this.state === 'connected',
      number: this.me,
      qr: this.qr,
      pairingCode: this.pairingCode,
      queued: this.queue.length,
      sentToday: this.sentToday(now),
      dailyCap: this.dailyCap(now),
      remainingToday: this.remainingToday(now),
      sentThisHour: this.sentThisHour(now),
      hourlyLimit: cfg.hourlyLimit,
      ageDays: this.ageDays(now),
      warmup: cfg.warmup && this.dailyCap(now) < cfg.dailyLimit,
      quietNow: inQuietHours(new Date(now)),
      quietHours: `${String(cfg.quietStart).padStart(2, '0')}:00-${String(cfg.quietEnd).padStart(2, '0')}:00`,
      pausedUntil: this.pausedUntil > now ? this.pausedUntil : null,
      maxPerRequest: cfg.maxPerRequest,
    };
  }

  // ───────── connection ─────────
  async start() {
    this.stopping = false;
    this.dead = false;
    fs.mkdirSync(this.dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.dir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    this.state = 'connecting';
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.appropriate('SoftSchool'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        if (this.pairPhone && !sock.authState.creds.registered) {
          try {
            this.pairingCode = await sock.requestPairingCode(this.pairPhone);
            this.state = 'pairing';
          } catch (e) { log.warn({ e: e.message }, 'pairing code failed'); }
        } else {
          this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
          this.state = 'qr';
        }
      }
      if (connection === 'open') {
        this.state = 'connected';
        this.qr = null; this.pairingCode = null; this.pairPhone = null; this.retries = 0;
        this.me = (sock.user?.id || '').split(':')[0].split('@')[0] || null;
        if (!this.meta.linkedAt) { this.meta.linkedAt = Date.now(); this.persist(); }
        log.info({ school: this.schoolId, me: this.me }, 'WhatsApp connected');
        this.pump();
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.qr = null; this.pairingCode = null;
        if (this.stopping) { this.state = 'disconnected'; return; }
        if (code === DisconnectReason.loggedOut) {
          log.warn({ school: this.schoolId }, 'logged out from phone');
          this.wipe();
          return;
        }
        this.state = 'connecting';
        const wait = Math.min(30000, 2000 * ++this.retries);
        log.info({ school: this.schoolId, code, wait }, 'reconnecting');
        setTimeout(() => this.start().catch((e) => log.error(e)), wait);
      }
    });
  }

  wipe() {
    this.dead = true;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.queue = [];
    this.meta = { linkedAt: null, sent: [], dedupe: {} };
    this.state = 'disconnected'; this.me = null; this.qr = null; this.pairingCode = null;
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  // ───────── queue ─────────
  /** Throws {status, message} when the queue is full. Duplicate (same number + same text within 24 h) is skipped. */
  enqueue(items, country) {
    this.prune();
    const valid = [];
    const out = [];
    for (const it of items) {
      const to = normalizePhone(it.to, country, true);
      if (!to) { out.push({ to: it.to, accepted: false, reason: 'invalid number' }); continue; }
      const text = String(it.text || '').slice(0, 4000);
      if (!text.trim()) { out.push({ to, accepted: false, reason: 'empty message' }); continue; }
      const h = hashOf(to, text);
      if (this.meta.dedupe[h]) { out.push({ to, accepted: false, reason: 'duplicate' }); continue; }
      valid.push({ to, text, h });
      out.push({ to, accepted: true });
      this.meta.dedupe[h] = Date.now();
    }
    if (this.queue.length + valid.length > cfg.maxQueue) {
      for (const v of valid) delete this.meta.dedupe[v.h];
      const e = new Error(`Queue is full (${this.queue.length}/${cfg.maxQueue}). Try again later.`);
      e.status = 429;
      throw e;
    }
    for (const v of valid) this.queue.push({ to: v.to, text: v.text });
    this.persist();
    this.pump();
    return out;
  }

  async pump() {
    if (this.working || this.state !== 'connected') return;
    this.working = true;
    try {
      while (this.queue.length && this.state === 'connected' && !this.dead) {
        const now = Date.now();
        this.prune(now);
        if (this.pausedUntil > now) break;                         // circuit breaker open
        if (inQuietHours(new Date(now))) break;                    // night: wait for morning
        if (this.meta.sent.length >= this.dailyCap(now)) break;    // today's safe cap reached
        if (this.sentThisHour(now) >= cfg.hourlyLimit) break;      // this hour's cap reached

        const m = this.queue[0];
        let delivered = false;
        try {
          const [res] = (await this.sock.onWhatsApp(m.to)) || [];
          if (res?.exists) {
            await this.sock.sendPresenceUpdate('composing', res.jid);
            await sleep(rand(cfg.typingMin, cfg.typingMax));
            await this.sock.sendMessage(res.jid, { text: m.text });
            delivered = true;
          } else {
            log.info({ to: m.to }, 'number is not on WhatsApp, skipped');
          }
          this.failStreak = 0;
          this.queue.shift();
        } catch (e) {
          log.warn({ e: e.message }, 'send failed');
          if (this.state !== 'connected') break;                   // keep the message; connection dropped
          this.queue.shift();
          if (++this.failStreak >= cfg.failLimit) {
            this.pausedUntil = Date.now() + cfg.failPauseMs;
            this.failStreak = 0;
            log.warn({ school: this.schoolId }, 'too many failures: sending paused for 30 min');
          }
        }
        if (delivered) this.meta.sent.push(Date.now());
        this.persist();
        if (cfg.breakEvery && ++this.sinceBreak >= cfg.breakEvery) {
          this.sinceBreak = 0;
          await sleep(rand(cfg.breakMin, cfg.breakMax));
        } else {
          await sleep(rand(cfg.minDelay, cfg.maxDelay));
        }
      }
    } finally { this.working = false; }
  }

  async logout() {
    this.stopping = true;
    try { await this.sock?.logout(); } catch { /* already closed */ }
    try { this.sock?.end(undefined); } catch { /* noop */ }
    this.wipe();
  }
}
