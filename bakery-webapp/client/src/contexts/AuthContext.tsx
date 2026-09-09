import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../lib/api';
import { setOrganizationFormatting } from '../lib/utils';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'baker';
  organization?: any;
  location?: any;
  phone?: string;
  bakery?: {
    id: string;
    name: string;
    slug: string;
    tier: string;
    status: string;
  };
}

interface AuthContextType {
  user: User | null;
  organization: any;
  location: any;
  role: string | null;
  permissions: string[];
  locations: any[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; bakeryName: string }) => Promise<void>;
  logout: () => void;
  impersonate: (token: string, user: User) => void;
  stopImpersonating: () => void;
  isImpersonating: boolean;
  refreshContext: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [originalToken, setOriginalToken] = useState<string | null>(null);

  const applyAuthContext = (data: any) => {
    setUser(data.user || null);
    setOrganization(data.organization || null);
    setLocation(data.location || null);
    setPermissions(data.permissions || []);
    setLocations(data.locations || []);
    if (data.organization) {
      setOrganizationFormatting({ currency: data.organization.currency, locale: data.organization.locale, timezone: data.organization.timezone });
    }
  };

  const refreshContext = async () => {
    const data = await api.get('/auth/me');
    applyAuthContext(data);
  };

  useEffect(() => {
    const token = localStorage.getItem('jb_token');
    if (token) {
      api.setToken(token);
      api.get('/auth/me')
        .then(applyAuthContext)
        .catch(() => { localStorage.removeItem('jb_token'); api.setToken(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('jb_token', data.token);
    api.setToken(data.token);
    setUser(data.user);
    setOrganization(data.organization || null);
    setLocation(data.location || null);
    setPermissions(data.permissions || []);
    setLocations(data.locations || []);
    setOrganizationFormatting({ currency: data.organization?.currency, locale: data.organization?.locale, timezone: data.organization?.timezone });
  };

  const register = async (regData: { name: string; email: string; password: string; bakeryName: string }) => {
    const data = await api.post('/auth/register', regData);
    localStorage.setItem('jb_token', data.token);
    api.setToken(data.token);
    setUser(data.user);
    setOrganization(data.organization || null);
    setLocation(data.location || null);
    setPermissions(data.permissions || []);
    setLocations(data.locations || []);
    setOrganizationFormatting({ currency: data.organization?.currency, locale: data.organization?.locale, timezone: data.organization?.timezone });
  };

  const logout = () => {
    localStorage.removeItem('jb_token');
    localStorage.removeItem('jb_original_token');
    api.setToken(null);
    setUser(null);
    setOrganization(null);
    setLocation(null);
    setPermissions([]);
    setLocations([]);
    localStorage.removeItem('jb_organization_formatting');
    setIsImpersonating(false);
    setOriginalToken(null);
  };

  const impersonate = (token: string, impUser: User) => {
    const currentToken = api.getToken();
    if (currentToken) {
      setOriginalToken(currentToken);
      localStorage.setItem('jb_original_token', currentToken);
    }
    api.setToken(token);
    localStorage.setItem('jb_token', token);
    setUser(impUser);
    setIsImpersonating(true);
  };

  const stopImpersonating = () => {
    const saved = originalToken || localStorage.getItem('jb_original_token');
    if (saved) {
      api.setToken(saved);
      localStorage.setItem('jb_token', saved);
      api.get('/auth/me').then((data: any) => {
        setUser(data.user);
        setIsImpersonating(false);
        setOriginalToken(null);
        localStorage.removeItem('jb_original_token');
      });
    }
  };

  return (
    <AuthContext.Provider value={{ user, organization, location, role: organization?.role || user?.role || null, permissions, locations, loading, login, register, logout, impersonate, stopImpersonating, isImpersonating, refreshContext }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export type StatusType =
  | 'active'
  | 'pending'
  | 'confirmed'
  | 'production'
  | 'ready'
  | 'delivered'
  | 'cancelled'
  | 'paid'
  | 'unpaid'
  | 'partial'
  | 'trialing'
  | 'past_due'
  | 'failed'
  | 'completed'
  | 'refunded'
  | 'preparing'
  | 'inactive'
  | 'archived';

const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  // Positive statuses - Green
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  paid: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  delivered: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  ready: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },

  // Warning statuses - Amber
  pending: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  trialing: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  partial: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  preparing: { bg: 'bg-amber-500/20', text: 'text-amber-400' },

  // Negative statuses - Red
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400' },
  unpaid: { bg: 'bg-red-500/20', text: 'text-red-400' },
  past_due: { bg: 'bg-red-500/20', text: 'text-red-400' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400' },
  refunded: { bg: 'bg-red-500/20', text: 'text-red-400' },

  // Info statuses - Blue
  confirmed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  production: { bg: 'bg-blue-500/20', text: 'text-blue-400' },

  // Neutral statuses - Gray
  inactive: { bg: 'bg-surface-700', text: 'text-surface-300' },
  archived: { bg: 'bg-surface-700', text: 'text-surface-300' },
};

const statusLabelMap: Record<StatusType, string> = {
  active: 'Active',
  pending: 'Pending',
  confirmed: 'Confirmed',
  production: 'Production',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  paid: 'Paid',
  unpaid: 'Unpaid',
  partial: 'Partial',
  trialing: 'Trial',
  past_due: 'Past Due',
  failed: 'Failed',
  completed: 'Completed',
  refunded: 'Refunded',
  preparing: 'Preparing',
  inactive: 'Inactive',
  archived: 'Archived',
};

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  className = '',
}: StatusBadgeProps) {
  const colors = statusColorMap[status] || statusColorMap.inactive;
  const displayLabel = label || statusLabelMap[status];

  return (
    <span
      className={`badge text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
    >
      {displayLabel}
    </span>
  );
}