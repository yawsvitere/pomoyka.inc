import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import type { User } from "../api/types";

type HubConnection = import("@microsoft/signalr").HubConnection;

export interface UserBanStatus {
  reason: string;
  bannedUntil: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  banStatus: UserBanStatus | null;
  isBanStatusChecked: boolean;
  banStatusError: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem("user");
      return savedUser ? (JSON.parse(savedUser) as User) : null;
    } catch {
      localStorage.removeItem("user");
      return null;
    }
  });
  const [banStatus, setBanStatus] = useState<UserBanStatus | null>(null);
  const [isBanStatusChecked, setIsBanStatusChecked] = useState(!user);
  const [banStatusError, setBanStatusError] = useState(false);
  const isLoading = false;
  const userId = user?.id;

  useEffect(() => {
    const handleLogout = () => {
      setUser(null);
      setBanStatus(null);
      setIsBanStatusChecked(true);
      setBanStatusError(false);
    };
    window.addEventListener("logout", handleLogout);

    return () => window.removeEventListener("logout", handleLogout);
  }, []);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    let expiryTimer: number | undefined;
    let connection: HubConnection | null = null;
    let currentBanStatus: UserBanStatus | null = null;
    let hubStarted = false;
    let banStatusRevision = 0;

    const startHub = () => {
      if (!active || !connection || hubStarted || currentBanStatus) return;
      hubStarted = true;
      void connection.start().catch(() => {
        hubStarted = false;
      });
    };

    const scheduleBanExpiry = (status: UserBanStatus | null) => {
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      if (!status) return;
      const remaining = status.bannedUntil
        ? new Date(status.bannedUntil).getTime() - Date.now()
        : Number.POSITIVE_INFINITY;
      const delay = Math.max(1_000, Math.min(30_000, remaining));
      expiryTimer = window.setTimeout(() => void refreshBanStatus(), delay);
    };

    const refreshBanStatus = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        window.dispatchEvent(new CustomEvent("logout"));
        return;
      }

      try {
        const revision = banStatusRevision;
        const response = await fetch(
          `${import.meta.env.VITE_API_URL ?? ""}/api/auth/ban-status`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (response.status === 401) {
          window.dispatchEvent(new CustomEvent("logout"));
          return;
        }
        if (!response.ok) {
          throw new Error(`Ban status request failed (${response.status})`);
        }

        const result = (await response.json()) as {
          isBanned: boolean;
          banUntil: string | null;
          banReason: string | null;
        };
        if (!active || revision !== banStatusRevision) return;
        const nextStatus = result.isBanned
          ? {
              reason: result.banReason ?? "",
              bannedUntil: result.banUntil,
            }
          : null;
        currentBanStatus = nextStatus;
        setBanStatus(nextStatus);
        setBanStatusError(false);
        setIsBanStatusChecked(true);
        scheduleBanExpiry(nextStatus);
        if (!nextStatus) startHub();
      } catch {
        if (active && !currentBanStatus) {
          setBanStatusError(true);
          setIsBanStatusChecked(true);
        }
      }
    };

    void refreshBanStatus();

    const heartbeat = () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      void fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/auth/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }).catch(() => undefined);
    };

    heartbeat();
    const intervalId = window.setInterval(heartbeat, 60_000);

    void import("@microsoft/signalr")
      .then(({ HubConnectionBuilder, LogLevel }) => {
        if (!active) return;

        connection = new HubConnectionBuilder()
          .withUrl(`${import.meta.env.VITE_API_URL ?? ""}/hubs/feed`, {
            accessTokenFactory: () => localStorage.getItem("token") ?? "",
          })
          .withAutomaticReconnect()
          .configureLogging(LogLevel.Warning)
          .build();

        connection.on("UserRoleChanged", () => {
          void import("../api/auth")
            .then(({ refreshToken }) => refreshToken())
            .then((res) => {
              localStorage.setItem("token", res.token);
              localStorage.setItem("user", JSON.stringify(res.user));
              setUser(res.user);
            })
            .catch(() => undefined);
        });

        connection.on(
          "UserBanned",
          (status: {
            isBanned: boolean;
            banUntil: string | null;
            banReason: string | null;
          }) => {
            if (!active) return;
            banStatusRevision += 1;
            const nextStatus = {
              reason: status.banReason ?? "",
              bannedUntil: status.banUntil,
            };
            currentBanStatus = nextStatus;
            setBanStatus(nextStatus);
            setBanStatusError(false);
            setIsBanStatusChecked(true);
            scheduleBanExpiry(nextStatus);
            hubStarted = false;
            void connection?.stop();
          },
        );

        connection.on("UserUnbanned", () => {
          if (!active) return;
          banStatusRevision += 1;
          currentBanStatus = null;
          setBanStatus(null);
          setBanStatusError(false);
          setIsBanStatusChecked(true);
          scheduleBanExpiry(null);
          startHub();
        });

        startHub();
      })
      .catch(() => undefined);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      if (connection) void connection.stop();
    };
  }, [userId]);

  async function login(email: string, password: string) {
    const authApi = await import("../api/auth");
    const res = await authApi.login(email, password);
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setBanStatus(null);
    setIsBanStatusChecked(false);
    setBanStatusError(false);
    setUser(res.user);
  }

  async function register(
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ) {
    const authApi = await import("../api/auth");
    const res = await authApi.register(
      email,
      password,
      displayName,
      inviteCode,
    );
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setBanStatus(null);
    setIsBanStatusChecked(false);
    setBanStatusError(false);
    setUser(res.user);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setBanStatus(null);
    setIsBanStatusChecked(true);
    setBanStatusError(false);
  }

  function updateUser(updatedUser: User) {
    localStorage.setItem("user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        banStatus,
        isBanStatusChecked,
        banStatusError,
        login,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx)
    throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
