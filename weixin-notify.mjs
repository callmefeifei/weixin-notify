#!/usr/bin/env node
/**
 * weixin-notify: Send WeChat messages via ilink API.
 *
 * Usage:
 *   node weixin-notify.mjs --login                    # QR code login (interactive)
 *   node weixin-notify.mjs --login-url                # get QR URL as JSON (agents)
 *   node weixin-notify.mjs --login-wait               # wait for scan (after --login-url)
 *   node weixin-notify.mjs "hello"                    # send message
 *   node weixin-notify.mjs --to <userId> "hello"      # send to specific user
 *   echo "msg" | node weixin-notify.mjs --stdin       # pipe message
 *   node weixin-notify.mjs --status                   # check login status
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, "state");
const ACCOUNT_FILE = path.join(STATE_DIR, "account.json");

const BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";
const API_TIMEOUT_MS = 15_000;
const QR_LOGIN_TIMEOUT_MS = 480_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadAccount() {
  try {
    if (fs.existsSync(ACCOUNT_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveAccount(data) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(data, null, 2), "utf-8");
  try { fs.chmodSync(ACCOUNT_FILE, 0o600); } catch {}
}

// ---------------------------------------------------------------------------
// WeChat ilink API
// ---------------------------------------------------------------------------

async function apiPost(endpoint, body, token) {
  const url = `${BASE_URL}/${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        Authorization: `Bearer ${token}`,
        "X-WECHAT-UIN": randomWechatUin(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function sendText(token, to, text, contextToken) {
  const clientId = `wn-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await apiPost("ilink/bot/sendmessage", {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      ...(contextToken ? { context_token: contextToken } : {}),
    },
  }, token);
  return clientId;
}

async function fetchContextToken(token) {
  try {
    const resp = await apiPost("ilink/bot/getupdates", { get_updates_buf: "" }, token);
    if (resp?.msgs?.length > 0) {
      return resp.msgs[resp.msgs.length - 1].context_token;
    }
  } catch {}
  return undefined;
}

/** Quick connectivity check: try a getUpdates and see if token is valid. */
async function checkToken(token) {
  try {
    const resp = await apiPost("ilink/bot/getupdates", { get_updates_buf: "" }, token);
    if (resp?.ret === 0 || resp?.ret === undefined) return { ok: true };
    if (resp?.errcode === -14) return { ok: false, reason: "token expired" };
    return { ok: false, reason: `ret=${resp.ret} errcode=${resp.errcode}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// QR Code Login
// ---------------------------------------------------------------------------

/**
 * Fetch a fresh QR code from WeChat and return { qrcode, qrcodeUrl }.
 */
async function fetchQrCode() {
  const qrRes = await fetch(`${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
  if (!qrRes.ok) throw new Error(`Failed to get QR code: ${qrRes.status}`);
  const qrData = await qrRes.json();
  return { qrcode: qrData.qrcode, qrcodeUrl: qrData.qrcode_img_content };
}

/**
 * --login-url: Print QR code URL to stdout (for agents to display to users).
 * Also saves the qrcode key to state/qr-pending.json for --login-wait.
 */
async function loginUrl() {
  const { qrcode, qrcodeUrl } = await fetchQrCode();
  ensureDir(STATE_DIR);
  fs.writeFileSync(
    path.join(STATE_DIR, "qr-pending.json"),
    JSON.stringify({ qrcode, qrcodeUrl, createdAt: Date.now() }),
    "utf-8"
  );
  // stdout: machine-readable JSON for agents
  console.log(JSON.stringify({ qrcodeUrl, qrcode }));
}

/**
 * --login-wait: Poll for scan confirmation using a previously fetched QR code.
 * Reads qrcode key from state/qr-pending.json (written by --login-url).
 */
async function loginWait() {
  const pendingFile = path.join(STATE_DIR, "qr-pending.json");
  if (!fs.existsSync(pendingFile)) {
    throw new Error("No pending QR code. Run --login-url first.");
  }
  const { qrcode } = JSON.parse(fs.readFileSync(pendingFile, "utf-8"));

  console.error("Waiting for WeChat scan...\n");
  const deadline = Date.now() + QR_LOGIN_TIMEOUT_MS;
  let scannedLogged = false;

  while (Date.now() < deadline) {
    const statusRes = await fetch(
      `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: { "iLink-App-ClientVersion": "1" } }
    );
    if (!statusRes.ok) throw new Error(`Status poll failed: ${statusRes.status}`);
    const status = await statusRes.json();

    if (status.status === "scaned" && !scannedLogged) {
      console.error("Scanned! Please confirm on your phone...");
      scannedLogged = true;
    } else if (status.status === "confirmed") {
      return saveLoginResult(status);
    } else if (status.status === "expired") {
      throw new Error("QR code expired. Run --login again.");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Login timed out (8 minutes). Run --login again.");
}

function saveLoginResult(status) {
  if (!status.bot_token || !status.ilink_bot_id) {
    throw new Error("Login confirmed but server did not return bot_token");
  }
  const account = {
    token: status.bot_token,
    botId: status.ilink_bot_id,
    baseUrl: status.baseurl || BASE_URL,
    userId: status.ilink_user_id,
    savedAt: new Date().toISOString(),
  };
  saveAccount(account);
  // Clean up pending QR
  try { fs.unlinkSync(path.join(STATE_DIR, "qr-pending.json")); } catch {}
  console.error(`Login successful!`);
  console.error(`  Bot ID:  ${account.botId}`);
  console.error(`  User ID: ${account.userId}`);
  console.log("login_ok");
  return account;
}

/**
 * --login: Interactive login (QR in terminal). For human use in a real terminal.
 */
async function loginWithQr() {
  console.error("[weixin-notify] Requesting QR code...\n");
  const { qrcode, qrcodeUrl } = await fetchQrCode();

  // Display QR in terminal
  let qrDisplayed = false;
  try {
    const { default: qrterm } = await import("qrcode-terminal");
    await new Promise((resolve) => {
      qrterm.generate(qrcodeUrl, { small: true }, (qr) => {
        console.error(qr);
        resolve();
      });
    });
    qrDisplayed = true;
  } catch {}

  if (!qrDisplayed) {
    console.error("QR code URL (open in browser or scan):");
    console.error(qrcodeUrl);
    console.error("\nTip: npm install qrcode-terminal for in-terminal QR display\n");
  }

  console.error("Scan the QR code with WeChat, then confirm on your phone.");
  console.error("Waiting...\n");

  const deadline = Date.now() + QR_LOGIN_TIMEOUT_MS;
  let scannedLogged = false;

  while (Date.now() < deadline) {
    const statusRes = await fetch(
      `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: { "iLink-App-ClientVersion": "1" } }
    );
    if (!statusRes.ok) throw new Error(`Status poll failed: ${statusRes.status}`);
    const status = await statusRes.json();

    if (status.status === "scaned" && !scannedLogged) {
      console.error("Scanned! Please confirm on your phone...");
      scannedLogged = true;
    } else if (status.status === "confirmed") {
      return saveLoginResult(status);
    } else if (status.status === "expired") {
      throw new Error("QR code expired. Run --login again.");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Login timed out (8 minutes). Run --login again.");
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.error(`weixin-notify - Send WeChat messages from the command line

Usage:
  weixin-notify --login                    Login with QR code (interactive)
  weixin-notify --login-url                Get QR code URL as JSON (for agents)
  weixin-notify --login-wait               Wait for QR scan (after --login-url)
  weixin-notify --status                   Check login status
  weixin-notify "message"                  Send message to yourself
  weixin-notify --to <userId> "message"    Send to a specific user
  echo "msg" | weixin-notify --stdin       Pipe message from stdin

Examples:
  node weixin-notify.mjs --login
  node weixin-notify.mjs "Deploy complete: 3 services updated"
  git log -1 --format=%s | node weixin-notify.mjs --stdin`);
}

async function main() {
  const argv = process.argv.slice(2);

  // --help
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  // --login-url (agent step 1: get QR URL)
  if (argv.includes("--login-url")) {
    await loginUrl();
    return;
  }

  // --login-wait (agent step 2: poll for scan confirmation)
  if (argv.includes("--login-wait")) {
    await loginWait();
    return;
  }

  // --login (interactive: QR in terminal)
  if (argv.includes("--login")) {
    await loginWithQr();
    return;
  }

  // --status
  if (argv.includes("--status")) {
    const account = loadAccount();
    if (!account?.token) {
      console.log("not_logged_in");
      console.error("No account found. Run: node weixin-notify.mjs --login");
      process.exit(1);
    }
    const result = await checkToken(account.token);
    if (result.ok) {
      console.log("ok");
      console.error(`Logged in as ${account.userId} (bot: ${account.botId})`);
    } else {
      console.log("expired");
      console.error(`Token invalid: ${result.reason}. Run: node weixin-notify.mjs --login`);
      process.exit(1);
    }
    return;
  }

  // Load account
  const account = loadAccount();
  if (!account?.token || !account?.userId) {
    console.error("No account found. Run first:\n  node weixin-notify.mjs --login");
    process.exit(1);
  }

  // Parse --to
  let to = account.userId; // default: send to self
  const toIdx = argv.indexOf("--to");
  if (toIdx !== -1) {
    to = argv[toIdx + 1];
    if (!to) {
      console.error("--to requires a userId argument");
      process.exit(1);
    }
    argv.splice(toIdx, 2);
  }

  // Collect message
  let message;
  if (argv.includes("--stdin")) {
    message = await readStdin();
  } else {
    message = argv.filter((a) => !a.startsWith("--")).join(" ");
  }

  if (!message) {
    printUsage();
    process.exit(1);
  }

  // Send
  const contextToken = await fetchContextToken(account.token);
  const clientId = await sendText(account.token, to, message, contextToken);
  console.log(`ok:${clientId}`);
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});
