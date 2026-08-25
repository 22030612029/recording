/* ============================================================
 * auth.js — 用户认证（多账号体系）
 * 注册 / 登录 / 登出 / 会话；密码以「随机盐 + SHA-256」哈希存储
 * 用户表   : localStorage[kaoyan_users]
 * 会话     : localStorage[kaoyan_session] = 当前登录用户 id
 * 用户数据 : localStorage[kaoyan_study_data_<userId>]（由 storage.js 使用）
 * ============================================================ */

const USERS_KEY = "kaoyan_users";
const SESSION_KEY = "kaoyan_session";
const LEGACY_KEY = "kaoyan_study_data";

/* ---------- 工具 ---------- */
function readUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); }
  catch (e) { return []; }
}
function writeUsers(list) {
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ID_RE = /^[a-zA-Z0-9_]{3,20}$/;

/* ---------- 注册 ---------- */
export async function register(id, password) {
  id = (id || "").trim();
  if (!ID_RE.test(id)) return { ok: false, msg: "ID 需为 3-20 位字母、数字或下划线" };
  if (!password || password.length < 6) return { ok: false, msg: "密码至少 6 位" };
  const users = readUsers();
  if (users.some((u) => u.id === id)) return { ok: false, msg: "该 ID 已被注册" };

  const salt = randomSalt();
  const hash = await sha256Hex(salt + "::" + password);
  const user = { id, salt, hash, createdAt: Date.now() };
  users.push(user);
  writeUsers(users);

  // 首个注册用户：自动接管旧版单用户数据（kaoyan_study_data）
  if (users.length === 1) {
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) localStorage.setItem(userKey(id), old);
  }

  localStorage.setItem(SESSION_KEY, id);
  return { ok: true, user: { id, createdAt: user.createdAt } };
}

/* ---------- 登录 ---------- */
export async function login(id, password) {
  id = (id || "").trim();
  const user = readUsers().find((u) => u.id === id);
  if (!user) return { ok: false, msg: "用户不存在" };
  const hash = await sha256Hex(user.salt + "::" + password);
  if (hash !== user.hash) return { ok: false, msg: "密码错误" };
  localStorage.setItem(SESSION_KEY, id);
  return { ok: true, user: { id, createdAt: user.createdAt } };
}

/* ---------- 登出 / 会话 ---------- */
export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export function getSessionUserId() {
  try { return localStorage.getItem(SESSION_KEY) || null; }
  catch (e) { return null; }
}

export function currentUser() {
  const id = getSessionUserId();
  if (!id) return null;
  const u = readUsers().find((x) => x.id === id);
  return u ? { id: u.id, createdAt: u.createdAt } : null;
}

/* ---------- 数据 key ---------- */
export function userKey(id) { return "kaoyan_study_data_" + id; }
export function legacyKey() { return LEGACY_KEY; }
