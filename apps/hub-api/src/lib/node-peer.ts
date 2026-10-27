import { AsyncLocalStorage } from "node:async_hooks";
import { X509Certificate } from "node:crypto";
import type tls from "node:tls";
import { unauthenticated } from "../errors.js";

export type NodePeer = { authorized: boolean; fingerprint: string | null };

export const nodePeer = new AsyncLocalStorage<NodePeer>();

export function peerFromSocket(socket: tls.TLSSocket | undefined): NodePeer {
  if (!socket || typeof socket.getPeerCertificate !== "function") {
    return { authorized: false, fingerprint: null };
  }
  const cert = socket.getPeerCertificate();
  if (!cert?.raw) return { authorized: false, fingerprint: null };
  const fingerprint = new X509Certificate(cert.raw).fingerprint256.replace(/:/g, "").toLowerCase();
  return { authorized: socket.authorized === true, fingerprint };
}

export function requireNodeFingerprint(): string {
  const peer = nodePeer.getStore();
  if (!peer?.authorized || !peer.fingerprint) {
    throw unauthenticated("mTLS client certificate required");
  }
  return peer.fingerprint;
}
