import {
  createFacadeClient,
  createHttpClient,
  type TokenProvider,
} from "@agenthub/agent-client";

/** Empty = same-origin (Vite proxy / production reverse proxy). */
export const API_BASE = (import.meta.env.VITE_HUB_API_BASE as string | undefined) ?? "";

let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

const tokens: TokenProvider = {
  getAccessToken,
  refreshAccessToken: async () => {
    try {
      const res = await fetch(`${API_BASE || ""}/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return accessToken;
    } catch {
      return null;
    }
  },
  onAuthFailure: () => {
    accessToken = null;
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  },
};

export const http = createHttpClient(API_BASE, tokens);
export const api = createFacadeClient(http);
