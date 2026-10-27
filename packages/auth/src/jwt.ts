import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type AccessClaims = {
  /** subject = userId */
  sub: string;
  /** current tenant id (empty string when none) */
  tid: string;
  /** tenant roles for current tenant */
  troles: string[];
  /** platform admin */
  pa: boolean;
  jti: string;
};

export type AccessTokenPayload = JWTPayload & AccessClaims;

export type RefreshClaims = {
  sub: string;
  tid: string;
  /** refresh family id */
  fid: string;
  jti: string;
};

export type RefreshTokenPayload = JWTPayload & RefreshClaims;

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  expiresIn = "15m",
): Promise<string> {
  return new SignJWT({
    tid: claims.tid,
    troles: claims.troles,
    pa: claims.pa,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
  });
  if (payload.aud === "llm-proxy") {
    throw Object.assign(new Error("llm proxy token cannot be used as an access token"), {
      name: "JWTClaimValidationFailed",
    });
  }
  return payload as AccessTokenPayload;
}

/** Short-lived credential for a runtime to call Hub LLM Proxy. Binds session and workspace. */
export type LlmProxyClaims = {
  sub: string;
  sid: string;
  wid: string;
  tid: string;
  pid: string;
};

export async function signLlmProxyToken(
  claims: LlmProxyClaims,
  secret: string,
  expiresIn = "1h",
): Promise<string> {
  return new SignJWT({
    sid: claims.sid,
    wid: claims.wid,
    tid: claims.tid,
    pid: claims.pid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("llm-proxy")
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(secret));
}

export async function verifyLlmProxyToken(
  token: string,
  secret: string,
): Promise<LlmProxyClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
    audience: "llm-proxy",
  });
  const sid = payload.sid;
  const wid = payload.wid;
  const tid = payload.tid;
  const pid = payload.pid;
  if (!payload.sub || typeof sid !== "string" || typeof wid !== "string" || typeof tid !== "string" || typeof pid !== "string") {
    throw Object.assign(new Error("llm proxy token is missing claims"), {
      name: "JWTClaimValidationFailed",
    });
  }
  return { sub: payload.sub, sid, wid, tid, pid };
}

export async function signRefreshToken(
  claims: RefreshClaims,
  secret: string,
  expiresIn = "7d",
): Promise<string> {
  return new SignJWT({
    tid: claims.tid,
    fid: claims.fid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey(secret));
}

export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
  });
  return payload as RefreshTokenPayload;
}
