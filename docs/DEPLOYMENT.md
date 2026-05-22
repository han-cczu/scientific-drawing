# Docker 部署指南

> 目标场景：单机自部署到 VPS / 内网 Linux 服务器。一个容器同时服务前端（`dist/`）、API（`/api/*`）与运行产物（`/uploads/*` `/exports/*`），用镜像锁定字体环境绕过 Linux/Windows 字体差异。

## 1. 前置依赖

- Docker 24+ 与 Docker Compose v2（`docker compose` 子命令，注意不是老的 `docker-compose`）
- 一台可访问 8787 端口（或经反代映射到 80/443）的 Linux 主机
- 至少 1 GB 内存、2 GB 磁盘空闲

> **未在本机验证**：本仓库的开发主机为 Windows，Dockerfile / compose 未在本机 `docker compose build` 实跑。首次部署到 VPS 时建议先 `docker compose build` 确认无报错再 `up -d`。

## 2. 一键部署

```bash
# 1) 拉源码（或 git pull）
git clone <repo-url> scientific-drawing
cd scientific-drawing

# 2) 准备宿主机 data/ 子目录，并交给 uid=1000（容器内 node 用户）
#    data/config.json 会在用户通过 UI 保存 AI 配置时由容器写入，目录权限给够即可
mkdir -p data/uploads data/scenes data/exports data/evaluation
sudo chown -R 1000:1000 data/

# 3) 配环境变量
cp .env.example .env
# 编辑 .env：要用 AI 重建就填 OPENAI_API_KEY；不填也能跑（启发式分析依旧可用）
$EDITOR .env

# 4) 构建并启动
docker compose build
docker compose up -d

# 5) 健康检查
curl -fsS http://localhost:8787/api/config
# 浏览器打开 http://<host>:8787/
```

### 关键点解释

- **`data/` 子目录 chown 1000:1000**：容器内以非 root `node` 用户（uid=1000）运行；bind mount 会沿用宿主机文件权限，宿主机不预先 chown 容器会写不进去。
- **bind mount 按子目录挂载**：`docker-compose.yml` 故意不整目录挂 `./data:/app/data`，因为镜像内 `/app/data/eval-suite` 是构建时拷进去的，整挂会被宿主机空目录遮盖，导致 `npm run evaluate` 找不到样本。
- **未配 `OPENAI_API_KEY`**：容器仍能正常启动，前端 AI 重建按钮自动禁用，启发式分析与编辑导出全功能可用。首次打开页面会自动弹出 AI 设置对话框，可直接在 UI 配置（写入 `data/config.json`，与 `.env` 二选一）。
- **`data/config.json` 优先级 > `.env`**：UI 一旦保存就覆盖环境变量，重启容器后仍生效（前提是 `data/` 是持久化 bind mount）。不希望 UI 写入生效时：① 后端进程对应的用户不应有写权限——目前默认就有；② 通过对话框「清空 / 回退 env」或 `docker compose exec app rm data/config.json` 删除文件即可回退。该行为是有意为之的设计——浏览器谁能访问页面谁能改后端配置，与「能 `docker compose exec` 进容器」是同级风险。多用户共享部署应通过反代加身份认证。

## 3. 常用运维命令

```bash
# 查看实时日志
docker compose logs -f app

# 重启
docker compose restart app

# 完全停止 + 清理容器（data/ 不会被删）
docker compose down

# 在容器内跑评估（与 CI 同源样本）
docker compose exec app npm run evaluate

# 容器内开 shell 排错
docker compose exec app bash

# 拉新版本 + 重建
git pull
docker compose build
docker compose up -d
```

## 4. 备份策略

只需要备份宿主机 `./data/` 目录（除 `data/eval-suite/`，那是镜像内置只读样本）：

```bash
# 简易冷备
tar -czf backup-$(date +%F).tar.gz data/

# 上传到 OSS / S3 / rsync 同步盘
rsync -a --delete data/ backup-host:/srv/sd-backup/
```

`scene.json`、上传原图、导出产物都集中在 `data/`，没有外部数据库依赖。

## 5. 反向代理示例

容器只监听 8787 HTTP；TLS 与 HTTP/2 交给外层。

### 5.1 Caddy（推荐：自动 TLS）

`Caddyfile`：

```
draw.example.com {
    encode gzip
    reverse_proxy localhost:8787 {
        # 上传超时放宽，sharp 处理大图可能慢
        transport http {
            response_header_timeout 120s
        }
    }
    # multer 接受 20 MB 上传，反代层不要更小
    request_body {
        max_size 25MB
    }
}
```

`caddy reload --config Caddyfile`。

### 5.2 nginx

```nginx
server {
    listen 443 ssl http2;
    server_name draw.example.com;

    ssl_certificate     /etc/letsencrypt/live/draw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/draw.example.com/privkey.pem;

    client_max_body_size 25M;
    proxy_read_timeout   120s;
    proxy_send_timeout   120s;

    location / {
        proxy_pass         http://127.0.0.1:8787;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

## 6. 开发态 compose

如果需要在容器内复现 CI 行为或调试字体相关问题，使用 `docker-compose.dev.yml`：

```bash
docker compose -f docker-compose.dev.yml up
# 5173 = Vite 前端热重载
# 8787 = Express 后端 + tsx watch
```

- 源码（`src/`、`server/`、`tests/`）通过 bind mount 注入，宿主机 IDE 改文件容器内立即生效。
- 容器内 `/app/node_modules` 用 anonymous volume 保护，避免被宿主机（特别是 Windows 上的 Linux-incompatible 二进制）覆盖。
- `data/` 子目录仍按 bind mount 暴露，与 prod 一致。

## 7. 升级流程

```bash
# 1. 备份
tar -czf backup-$(date +%F).tar.gz data/

# 2. 拉新代码
git pull

# 3. 重建镜像（package.json 改动或 Dockerfile 改动会触发重 npm ci）
docker compose build

# 4. 滚动重启
docker compose up -d

# 5. 验证
curl -fsS http://localhost:8787/api/config
docker compose logs --tail=50 app
```

## 8. 故障排查

| 现象 | 排查方向 |
|------|----------|
| `docker compose up` 后 `curl /api/config` 502 / 拒连 | 看 `docker compose logs app`；常见是 `.env` 缺失（compose 报 `env file not found`）。`cp .env.example .env` 即可，全部变量都是可空的。 |
| 上传图后 `/api/analyze` 500，日志报 `unable to open font` | 检查 `docker compose exec app fc-list \| grep -i noto`，应能看到 Noto CJK。如果没装，重新 build 镜像（Dockerfile 的 apt 步骤可能在某些 base 镜像缓存层失效，加 `--no-cache`）。 |
| 上传成功但 `data/uploads` 在宿主机看不到新文件 | 大概率宿主机 `data/uploads` owner 不是 1000:1000，容器内写入实际落到了容器的 overlay 层。`ls -ln data/` 确认 owner，必要时 `sudo chown -R 1000:1000 data/` 后 `docker compose restart`。 |
| `docker exec app npm run evaluate` 报样本缺失 | 检查 `docker compose exec app ls /app/data/eval-suite`。若为空，说明 bind mount 误用整目录覆盖了。确认 `docker-compose.yml` 用的是子目录挂载（uploads/scenes/exports/evaluation 四条），不是整 `./data:/app/data`。 |
| 容器内 `id` 显示 root | Dockerfile 或外层 compose 被改过 USER。本项目 Dockerfile 末尾 `USER node`，期望 uid=1000。 |
| `OPENAI_BASE_URL` 改成自建反代后调用失败 | 容器内 `docker compose exec app curl -v $OPENAI_BASE_URL/models`。注意自建端点是否要尾斜杠，以及证书链。 |

## 9. 范围之外

本部署形态有意不覆盖以下能力，需要时按外层基础设施补：

- TLS 终止 / 证书自动签发：交给 Caddy / nginx + certbot / cloudflare tunnel
- 多机水平扩展：当前是单容器有状态（`data/` 本地盘），需要先做对象存储抽象
- 多用户认证 / RBAC
- K8s / Swarm 部署
- 镜像推送到 Docker Hub / GHCR：仓库目前无 remote

如需以上能力，参考 PRD `Out of Scope` 章节。
