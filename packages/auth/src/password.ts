import { hash, verify } from "@node-rs/argon2";

/** argon2id: m=64MB, t=3, p=1 (architecture 03); algorithm 2 = Argon2id */
const OPTS = {
  algorithm: 2,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  return verify(hashStr, password, OPTS);
}
