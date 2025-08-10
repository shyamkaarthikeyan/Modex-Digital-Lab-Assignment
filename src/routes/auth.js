import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Demo credentials
const DEMO_USERS = {
  admin: { password: 'admin123', role: 'admin' },
  user: { password: 'user123', role: 'user' },
};

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const TOKEN_TTL = '2h';

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const found = DEMO_USERS[username];
  if (!found || found.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: username, role: found.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, role: found.role, username });
});

// Middleware helpers used by other routers (optional to import)
export function requireAuth(role) {
  return function (req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (role && role !== 'any' && payload.role !== role && payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

export default router;
