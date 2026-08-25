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

/* ID 规则：1-20 位任意字符（中文/英文/数字/符号均可），仅排除会破坏存储的控制字符 */
function validId(id) {
  if (!id || id.length < 1 || id.length > 20) return false;
  return !/[\u0000-\u001F\u007F]/.test(id); // 排除控制字符
}

/* 密码规则：至少 6 位，仅允许英文字母、数字与常见符号（任选组合，不含中文等字符） */
function validPassword(p) {
  if (!p || p.length < 6) return false;
  return /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/~`\\]+$/.test(p);
}

/* ---------- 注册 ---------- */
export async function register(id, password) {
  id = (id || "").trim();
  if (!validId(id)) return { ok: false, msg: "ID 需为 1-20 位任意字符" };
  if (!validPassword(password)) return { ok: false, msg: "密码需至少 6 位，且仅含英文字母、数字与符号" };
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
