import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function issueToken(user, secret, now = Date.now()) {
  const payload = encode({ sub: user.id, phone: user.phone, exp: now + 7 * 24 * 60 * 60 * 1000 });
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.exp > now ? decoded : null;
  } catch {
    return null;
  }
}

export function randomSecret() {
  return randomBytes(32).toString('hex');
}

export function createOtp() {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(requestId, phone, code, secret) {
  return createHmac('sha256', secret).update(`${requestId}:${phone}:${code}`).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const digest = scryptSync(String(password), salt, 64).toString('base64url');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, salt, digest] = String(encoded ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const actual = scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sanitizeReview(text) {
  const blocked = ['暴恐', '色情交易'];
  if (blocked.some((word) => text.includes(word))) {
    const error = new Error('评论包含不允许发布的内容');
    error.statusCode = 422;
    error.code = 'REVIEW_REJECTED';
    throw error;
  }
  return text
    .replace(/1\d{10}/g, '[手机号已隐藏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]')
    .trim()
    .slice(0, 1000);
}
