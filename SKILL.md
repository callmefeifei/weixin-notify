# Skill: weixin-notify

Send WeChat messages to the user from any AI agent (Claude Code, Cursor, etc.).

## Setup

Install the tool (one-time):

```bash
git clone https://github.com/callmefeifei/weixin-notify.git ~/.weixin-notify && cd ~/.weixin-notify && npm install
```

Login with WeChat (one-time, re-run if token expires):

```bash
node ~/.weixin-notify/weixin-notify.mjs --login
```

## How to Use

Send a notification:

```bash
node ~/.weixin-notify/weixin-notify.mjs "your message here"
```

Pipe from stdin:

```bash
echo "message" | node ~/.weixin-notify/weixin-notify.mjs --stdin
```

Check login status:

```bash
node ~/.weixin-notify/weixin-notify.mjs --status
```

## Agent Login Flow (Two-Step)

When token is expired and the agent needs to re-login, use the two-step flow
so the QR code URL is visible to the user (not hidden in collapsed terminal output):

**Step 1** — Get QR code URL:

```bash
node ~/.weixin-notify/weixin-notify.mjs --login-url
```

Stdout returns JSON: `{"qrcodeUrl":"https://...","qrcode":"..."}`.
Parse it and display the `qrcodeUrl` link to the user so they can open it and scan with WeChat.

**Step 2** — Wait for scan confirmation:

```bash
node ~/.weixin-notify/weixin-notify.mjs --login-wait
```

Polls until the user scans and confirms (up to 8 minutes). Prints `login_ok` to stdout on success.

## When to Use

- After completing a long-running task (build, deploy, test suite)
- When an error or anomaly is detected during automated work
- When user explicitly asks to be notified via WeChat
- When a background task finishes

## Message Guidelines

- Be concise: include project name + what happened + result
- Use the user's language (Chinese if they write in Chinese)
- For errors, include the key error message
- Example: "myapp: 构建完成，共编译 142 个文件，耗时 38s"
- Example: "myapp: 测试失败，3/87 用例未通过 (auth.test.ts)"

## Add to CLAUDE.md

To enable this skill globally in Claude Code, add to `~/.claude/CLAUDE.md`:

```markdown
## Skill: weixin-notify

When the user asks to be notified via WeChat, or when completing a long-running task
where the user requested notification, send a message using:

    node ~/.weixin-notify/weixin-notify.mjs "message"

If sending fails (exit code 1) or token is expired, use the two-step login flow:

1. Run `node ~/.weixin-notify/weixin-notify.mjs --login-url` to get JSON with the QR URL.
   Parse it and display the `qrcodeUrl` link to the user in your message.

2. Run `node ~/.weixin-notify/weixin-notify.mjs --login-wait` to poll for scan confirmation.
   When it prints `login_ok`, login is complete. Retry the original message.
```
