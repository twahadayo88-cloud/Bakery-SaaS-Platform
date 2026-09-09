import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getOrganizationForUser, getLocationForUser } from '../db/index.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    organization_id?: string;
    location_id?: string;
  };
  organization?: any;
  location?: any;
}

const JWT_SECRET = process.env.JWT_SECRET || 'bakery-webapp-secret-key-v2';

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };
    req.organization = getOrganizationForUser(decoded.id);
    req.location = getLocationForUser(decoded.id, req.organization?.location_id);
    if (req.organization) {
      req.user.organization_id = req.organization.id;
      req.user.location_id = req.location?.id;
    }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function generateToken(userId: string, email: string, name: string, role: string): string {
  return jwt.sign({ id: userId, email, name, role }, JWT_SECRET, { expiresIn: '7d' });
}
