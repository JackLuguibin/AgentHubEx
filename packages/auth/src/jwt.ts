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
  return payload as AccessTokenPayload;
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
