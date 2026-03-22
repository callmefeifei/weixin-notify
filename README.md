# weixin-notify

从命令行发送微信消息。零依赖逆向实现微信 ilink 协议，单文件，可作为 AI Agent 的通知 skill。

## 原理

微信通过 [OpenClaw](https://github.com/callmefeifei/openclaw) 开放了一套 HTTP API（`ilinkai.weixin.qq.com`），支持个人微信号的消息收发。本项目将该协议从 OpenClaw 中剥离，用单个脚本实现消息推送，无需安装 OpenClaw。

```
你的脚本/Agent ──► weixin-notify.mjs ──► ilink API ──► 微信
```

## 快速开始

```bash
# 1. 下载
git clone https://github.com/callmefeifei/weixin-notify.git ~/.weixin-notify
cd ~/.weixin-notify && npm install

# 2. 扫码登录（微信扫终端中的二维码）
node weixin-notify.mjs --login

# 3. 发条消息试试
node weixin-notify.mjs "Hello from terminal!"
```

## 用法

```bash
# 发送消息（默认发给自己，即扫码登录的微信号）
node weixin-notify.mjs "部署完成，共更新 3 个服务"

# 通过 stdin 发送（适合管道）
echo "构建日志：全部通过" | node weixin-notify.mjs --stdin
git log -1 --format="%s" | node weixin-notify.mjs --stdin

# 发给指定用户
node weixin-notify.mjs --to "xxx@im.wechat" "你好"

# 检查登录状态
node weixin-notify.mjs --status

# 重新登录（token 过期时执行）
node weixin-notify.mjs --login
```

## 作为 AI Agent Skill 使用

本项目设计为可被任何 AI Agent（Claude Code、Cursor、OpenHands 等）调用的通知工具。

### Claude Code

将以下内容添加到 `~/.claude/CLAUDE.md`：

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

之后你可以在 Claude Code 中说：

> "跑完测试用微信通知我"

Claude Code 会在测试完成后自动执行通知。

### Cursor / 其他 Agent

在你的 Agent 规则文件（如 `.cursorrules`）中加入同样的 skill 描述即可。核心就一行命令：

```bash
node ~/.weixin-notify/weixin-notify.mjs "消息内容"
```

退出码 `0` 表示成功，`1` 表示失败（token 过期或未登录）。

### 引导用户安装

如果你是 Agent 开发者，当用户要求接入微信通知时，可以引导用户执行以下步骤：

1. 检查 Node.js 版本（需要 >= 18）
2. 克隆仓库到 `~/.weixin-notify`
3. 执行 `npm install`
4. 执行 `node weixin-notify.mjs --login`，提示用户扫码
5. 执行 `node weixin-notify.mjs --status` 确认登录成功
6. 将 skill 描述写入 Agent 配置文件

## 微信 ilink API 协议参考

以下为从 OpenClaw 插件逆向得到的核心接口，供二次开发参考。

所有请求发往 `https://ilinkai.weixin.qq.com`。

### 公共请求头

| Header | 值 |
|--------|---|
| `Content-Type` | `application/json` |
| `AuthorizationType` | `ilink_bot_token` |
| `Authorization` | `Bearer <bot_token>` |
| `X-WECHAT-UIN` | Base64(随机 uint32 的十进制字符串) |

### 登录

```
GET /ilink/bot/get_bot_qrcode?bot_type=3
→ { "qrcode": "...", "qrcode_img_content": "..." }

GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>
Header: iLink-App-ClientVersion: 1
→ { "status": "wait|scaned|confirmed|expired", "bot_token": "...", "ilink_bot_id": "...", "ilink_user_id": "..." }
```

### 收消息

```
POST /ilink/bot/getupdates
{ "get_updates_buf": "" }
→ { "ret": 0, "msgs": [...], "get_updates_buf": "..." }
```

Long-poll，~35s 超时。`get_updates_buf` 为同步游标，首次传空字符串。

### 发消息

```
POST /ilink/bot/sendmessage
{
  "msg": {
    "to_user_id": "xxx@im.wechat",
    "client_id": "<unique>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{ "type": 1, "text_item": { "text": "hello" } }],
    "context_token": "<from_getupdates>"
  }
}
```

`context_token` 需从 `getupdates` 返回的消息中获取并回传。

### 消息类型 (item type)

| type | 说明 |
|------|------|
| 1 | 文本 |
| 2 | 图片 |
| 3 | 语音 |
| 4 | 文件 |
| 5 | 视频 |

## 文件结构

```
weixin-notify/
├── weixin-notify.mjs   # 主脚本（单文件，全部逻辑）
├── SKILL.md            # Skill 接入说明（供 Agent 读取）
├── package.json
└── state/              # 运行时生成，请勿提交
    └── account.json    # 登录凭据（token + userId）
```

## 注意事项

- **Token 会过期**：微信 ilink 的 bot_token 有有效期，过期后 `--status` 会返回 `expired`，重新 `--login` 即可
- **state/ 目录含敏感信息**：`account.json` 中存有 bot_token，已通过 `.gitignore` 排除，请勿手动提交
- **当前仅支持文本消息**：图片/文件等媒体类型需要 CDN 加密上传流程，暂未实现
- **需要 Node.js >= 18**：使用了原生 `fetch` API

## License

MIT
