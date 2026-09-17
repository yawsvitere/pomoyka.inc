import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import type { User } from "../api/types";
import * as authApi from "../api/auth";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);

    const handleLogout = () => {
      setUser(null);
    };
    window.addEventListener("logout", handleLogout);

    return () => window.removeEventListener("logout", handleLogout);
  }, []);

  useEffect(() => {
    if (!user) return;

    const heartbeat = () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      void fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/auth/heartbeat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }).catch(() => undefined);
    };

    heartbeat();
    const intervalId = window.setInterval(heartbeat, 60_000);

    const connection = new HubConnectionBuilder()
      .withUrl(`${import.meta.env.VITE_API_URL ?? ""}/hubs/feed`, {
        accessTokenFactory: () => localStorage.getItem("token") ?? "",
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("UserRoleChanged", () => {
      void authApi.refreshToken().then((res) => {
        localStorage.setItem("token", res.token);
        localStorage.setItem("user", JSON.stringify(res.user));
        setUser(res.user);
      }).catch(() => undefined);
    });

    void connection.start().catch(() => undefined);

    return () => {
      window.clearInterval(intervalId);
      void connection.stop();
    };
  }, [user?.id]);

  async function login(email: string, password: string) {
    const res = await authApi.login(email, password);
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
  }

  async function register(
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ) {
    const res = await authApi.register(
      email,
      password,
      displayName,
      inviteCode,
    );
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  function updateUser(updatedUser: User) {
    localStorage.setItem("user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, logout, updateUser }}
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
