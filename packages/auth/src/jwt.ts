import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type AccessClaims = {
  /** subject = userId */
  sub: string;
  /** current tenant id */
  tid: string;
  /** tenant roles for current tenant */
  troles: string[];
  /** platform admin */
  pa: boolean;
  jti: string;
};

export type AccessTokenPayload = JWTPayload & AccessClaims;

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
