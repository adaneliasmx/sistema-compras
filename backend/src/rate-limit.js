// Rate limiter en memoria — 5 intentos por key cada 15 minutos
const RATE_MAX = 5;
const RATE_WINDOW = 15 * 60 * 1000;

function createRateLimiter() {
  const attempts = new Map();

  function getIp(req) {
    return ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
  }

  function check(key) {
    const now = Date.now();
    const e = attempts.get(key);
    if (!e || now > e.resetAt) return { blocked: false };
    if (e.count >= RATE_MAX) return { blocked: true, wait: Math.ceil((e.resetAt - now) / 60000) };
    return { blocked: false };
  }

  function recordFail(key) {
    const now = Date.now();
    const e = attempts.get(key) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > e.resetAt) { e.count = 0; e.resetAt = now + RATE_WINDOW; }
    e.count++;
    attempts.set(key, e);
  }

  function clear(key) { attempts.delete(key); }

  return { getIp, check, recordFail, clear };
}

module.exports = { createRateLimiter };
