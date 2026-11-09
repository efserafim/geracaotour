import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

export function json(status, body) {
  return {
    statusCode: status,
    headers: CORS,
    body: JSON.stringify(body)
  };
}

export function ok(body) {
  return json(200, body);
}

export function noContent() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export function options() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  return neon(url, { fullResults: false });
}

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET missing");
  return secret;
}

function getCoordinators() {
  const raw = process.env.COORDINATORS || "[]";
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map(item => ({
        email: String(item.email || "").trim().toLowerCase(),
        password: String(item.password || "")
      }))
      .filter(item => item.email && item.password);
  } catch {
    return [];
  }
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signToken(payload, days = 7) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60
  };
  const encoded = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  const expected = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(encoded));
    if (!payload?.email || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) {
    const error = new Error("UNAUTHORIZED");
    error.status = 401;
    throw error;
  }
  return payload;
}

export function authenticateCoordinator(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  const pass = String(password || "");
  const match = getCoordinators().find(user => user.email === normalized && user.password === pass);
  return Boolean(match);
}

export function apiPath(event) {
  const fromQuery = event.queryStringParameters?.path;
  if (fromQuery) {
    return `/${String(fromQuery).replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  }
  const raw = event.rawUrl || `https://local${event.path || ""}`;
  let pathname = "/";
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = event.path || "/";
  }
  return pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "/")
    .replace(/^\/api\/?/, "/")
    .replace(/\/+$/, "") || "/";
}

export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("INVALID_JSON");
    error.status = 400;
    throw error;
  }
}

export function sqlErrorCode(error) {
  const message = String(error?.message || error || "");
  if (message.includes("CAPACITY_REACHED")) return "CAPACITY_REACHED";
  if (message.includes("DUPLICATE_REGISTRATION") || error?.code === "23505") return "DUPLICATE_REGISTRATION";
  if (message.includes("INVALID_PARTICIPANT")) return "INVALID_PARTICIPANT";
  return "SERVER_ERROR";
}
