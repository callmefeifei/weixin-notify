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

If sending fails (exit code 1) or token is expired, run the login command:

    node ~/.weixin-notify/weixin-notify.mjs --login

IMPORTANT: Tell the user "二维码可能被折叠了，请点击展开终端输出查看二维码并用微信扫码"
(The QR code output may be collapsed/folded — please expand it to scan with WeChat).

This command waits up to 8 minutes for the user to scan, then exits automatically.
After login succeeds, retry sending the original message.
```
