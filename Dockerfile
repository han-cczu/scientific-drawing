# syntax=docker/dockerfile:1.6

# ============================================================================
# Stage 1: builder
# ============================================================================
# 安装全部 deps（含 devDeps）并产出前端 dist/
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 系统依赖：build 阶段也需要字体（防止某些 build 步骤渲染缺字体）
# sharp 用 prebuilt 二进制，无需 libvips-dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 先拷 manifest 提升缓存命中
COPY package.json package-lock.json* ./

# 安装全部依赖（含 dev，build 需要）
RUN npm ci

# 拷源码（与 .dockerignore 协作过滤无关文件）
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src
COPY server ./server

# 构建前端 dist/
RUN npm run build

# ============================================================================
# Stage 2: runtime
# ============================================================================
# 继续保留 tsx 跑源码（D2），node 用户运行（D3）
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# runtime 系统依赖：字体 + curl（healthcheck 用）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-liberation \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8787

# 从 builder 拷依赖、源码、产物
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json

# eval-suite COPY 进镜像（D5），保证 npm run evaluate 与 CI 同源
COPY --chown=node:node data/eval-suite ./data/eval-suite

# 预创建 data 子目录并交给 node 用户（D3）
RUN mkdir -p \
        /app/data/uploads \
        /app/data/exports \
        /app/data/scenes \
        /app/data/evaluation \
    && chown -R node:node /app/data

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8787/api/config || exit 1

CMD ["npx", "tsx", "server/src/index.ts"]
