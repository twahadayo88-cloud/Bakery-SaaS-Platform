import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { hasPermission } from '../db/index.js';

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  next();
}

export function requireBaker(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'baker') {
    res.status(403).json({ error: 'Baker role required' });
    return;
  }

  next();
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!hasPermission(req.user.id, permission)) {
      res.status(403).json({ error: `Permission required: ${permission}` });
      return;
    }
    next();
  };
}
