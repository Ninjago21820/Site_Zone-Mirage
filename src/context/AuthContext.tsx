import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiError } from '../lib/api';

export interface Me {
  authenticated: boolean;
  user?: {
    id?: string;
    mirageId: string;
    username: string;
    role?: string;
    email?: string | null;
    profilePublic: boolean;
    showSocials: boolean;
    bio?: string;
    twoFactor?: { totp: boolean; passkeys: number; backupCodesLeft: number };
    isOwner?: boolean;
  };
  role?: string;
  staff?: boolean;
  mirageId?: string;
  username?: string;
  reauthFresh?: boolean;
  mustEnrollMfa?: boolean;
  csrfToken?: string;
}

interface AuthContextValue {
  me: Me;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  reauthOpen: boolean;
  openReauth: () => void;
  closeReauth: () => void;
  reauth: (password: string, code?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [reauthOpen, setReauthOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Me>('/api/auth/me');
      setMe(data);
    } catch {
      setMe({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setMe({ authenticated: false });
  }, []);

  const reauth = useCallback(async (password: string, code?: string) => {
    await apiPost('/api/auth/reauth', { password, code });
    await refresh();
    setReauthOpen(false);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({
    me,
    loading,
    refresh,
    logout,
    reauthOpen,
    openReauth: () => setReauthOpen(true),
    closeReauth: () => setReauthOpen(false),
    reauth,
  }), [me, loading, refresh, logout, reauthOpen, reauth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** True when the error is the "reauthentication required" sentinel. */
export function isReauthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 &&
    (error.code === 'reauth_required' || (error.data && error.data.error === 'reauth_required'));
}
