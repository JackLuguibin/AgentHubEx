import ky, { type KyInstance } from "ky";

export type TokenProvider = {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  onAuthFailure?: () => void;
};

export function createHttpClient(
  baseUrl: string,
  tokens: TokenProvider,
): KyInstance {
  const normalized =
    baseUrl.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173");

  let refreshing: Promise<string | null> | null = null;

  return ky.create({
    prefixUrl: normalized,
    credentials: "include",
    timeout: 20_000,
    hooks: {
      beforeRequest: [
        (request) => {
          const token = tokens.getAccessToken();
          if (token) request.headers.set("authorization", `Bearer ${token}`);
        },
      ],
      afterResponse: [
        async (request, _options, response) => {
          if (response.status !== 401) return response;
          // Avoid retry loops on auth endpoints themselves.
          const path = request.url;
          if (path.includes("/v1/auth/")) return response;

          if (!refreshing) {
            refreshing = tokens.refreshAccessToken().finally(() => {
              refreshing = null;
            });
          }
          const next = await refreshing;
          if (!next) {
            tokens.onAuthFailure?.();
            return response;
          }
          const headers = new Headers(request.headers);
          headers.set("authorization", `Bearer ${next}`);
          return ky(request, {
            headers,
            credentials: "include",
            hooks: {
              // One-shot retry without nested 401 refresh.
              afterResponse: [],
            },
          });
        },
      ],
    },
  });
}
