#!/bin/sh

echo "=========================================="
echo "  标书 Agent 填写系统 - Docker 启动"
echo "=========================================="

# 确保数据目录存在
mkdir -p /app/data/sessions /app/data/superdoc-home /app/data/pdf-library

# 启动 Node.js 后端
echo "启动 Node.js 后端 (端口 ${PORT:-8000})..."
cd /app/server-node
exec node --loader tsx src/index.ts
