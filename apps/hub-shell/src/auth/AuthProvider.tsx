import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, API_BASE, getAccessToken, setAccessToken } from "../lib/api.js";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  isPlatformAdmin: boolean;
  currentTenantId: string | null;
  tenants: Array<{ id: string; slug: string; name: string; role: string }>;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  getAccessToken: () => string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function bootstrapRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE || ""}/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken: string };
    return body.accessToken ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    let token = getAccessToken();
    if (!token) {
      token = await bootstrapRefresh();
      if (!token) {
        setUser(null);
        return;
      }
      setAccessToken(token);
    }
    const me = (await api.me()) as AuthUser;
    setUser(me);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refreshMe();
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setAccessToken(res.accessToken);
    setUser(res.user as AuthUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshMe,
      getAccessToken,
    }),
    [user, loading, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
