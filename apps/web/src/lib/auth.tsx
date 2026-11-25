import { useQueryClient } from '@tanstack/react-query';
import { can, canAccess, seesMoney, type Action, type Module, type Role } from '@nexo/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}
interface Ctx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  demoLogin: (role: Role) => Promise<void>;
  logout: () => Promise<void>;
  can: (a: Action) => boolean;
  access: (m: Module) => boolean;
  money: boolean;
}
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      qc.clear();
    });
    api
      .get<{ user: SessionUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
    qc.clear();
    setUser(r.user);
  }, [qc]);
  const demoLogin = useCallback(async (role: Role) => {
    const r = await api.post<{ user: SessionUser }>('/auth/demo-login', { role });
    qc.clear();
    setUser(r.user);
  }, [qc]);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => null);
    qc.clear();
    setUser(null);
  }, [qc]);

  const value = useMemo<Ctx>(
    () => ({
      user,
      loading,
      login,
      demoLogin,
      logout,
      can: (a) => (user ? can(user.role, a) : false),
      access: (m) => (user ? canAccess(user.role, m) : false),
      money: user ? seesMoney(user.role) : false,
    }),
    [user, loading, login, demoLogin, logout],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider faltante');
  return c;
}
