const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { HttpError, asyncRoute } = require('./http');
const issuer = 'trip-painting-api';
const audience = 'trip-painting-mobile';

function createAuth(db, secret) {
  const issueToken = (user) =>
    jwt.sign({ id: user.id }, secret, {
      algorithm: 'HS256',
      issuer,
      audience,
      subject: String(user.id),
      expiresIn: '30d',
    });
  const authenticate = asyncRoute(async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) throw new HttpError(401, 'NO_TOKEN', 'A Bearer access token is required.');
    let payload;
    try {
      payload = jwt.verify(match[1], secret, { algorithms: ['HS256'], issuer, audience });
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.');
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Number.isSafeInteger(payload.id) ||
      payload.id <= 0 ||
      payload.sub !== String(payload.id)
    )
      throw new HttpError(401, 'INVALID_TOKEN', 'The access token is invalid.');
    const user = await db.get('SELECT id,email,username,created_at FROM users WHERE id=?', [
      payload.id,
    ]);
    if (!user) throw new HttpError(401, 'INVALID_TOKEN', 'The account is no longer available.');
    req.user = user;
    next();
  });
  const router = express.Router();
  const credentials = (body, signup) => {
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      (signup && typeof body.username !== 'string')
    )
      throw new HttpError(
        400,
        'MISSING_FIELDS',
        'Email and password are required; signup also requires a username.',
      );
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    const username = signup ? body.username.trim() : undefined;
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (signup && Buffer.byteLength(password, 'utf8') > 72) ||
      password.length < (signup ? 8 : 1) ||
      (signup && (!username || username.length > 80))
    )
      throw new HttpError(
        400,
        'INVALID_CREDENTIALS_INPUT',
        'Provide a valid email, password and username. Signup passwords need 8 characters and may not exceed 72 UTF-8 bytes.',
      );
    return { email, password, username };
  };
  router.post(
    '/signup',
    asyncRoute(async (req, res) => {
      const { email, password, username } = credentials(req.body, true);
      if (await db.get('SELECT id FROM users WHERE email=? COLLATE NOCASE', [email]))
        throw new HttpError(409, 'USER_EXISTS', 'An account with this email already exists.');
      const hash = await bcrypt.hash(password, 10);
      let inserted;
      try {
        inserted = await db.run('INSERT INTO users(email,password_hash,username) VALUES (?,?,?)', [
          email,
          hash,
          username,
        ]);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT')
          throw new HttpError(409, 'USER_EXISTS', 'An account with this email already exists.');
        throw error;
      }
      const user = { id: inserted.lastID, email, username };
      res.status(201).json({ token: issueToken(user), user });
    }),
  );
  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const { email, password } = credentials(req.body, false);
      const row = await db.get(
        'SELECT id,email,username,password_hash FROM users WHERE email=? COLLATE NOCASE ORDER BY CASE WHEN email=? THEN 0 ELSE 1 END,id LIMIT 1',
        [email, req.body.email.trim()],
      );
      if (!row || !(await bcrypt.compare(password, row.password_hash)))
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      const user = { id: row.id, email: row.email, username: row.username };
      res.json({ token: issueToken(user), user });
    }),
  );
  router.get('/me', authenticate, (req, res) =>
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        username: req.user.username,
        createdAt: req.user.created_at,
      },
    }),
  );
  return { router, authenticate };
}
module.exports = { createAuth };
