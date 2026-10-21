FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PHOTO_PORT=8791 \
    PHOTO_HOST=0.0.0.0 \
    PHOTO_DATA_DIR=/data
# The frontend (web/dist) is built by CI, not inside the image.
# server.js is zero-dependency, so no node_modules are needed at runtime.
# package.json is required for its "type": "module".
COPY web/package.json ./
COPY web/server.js ./
COPY web/lib/ ./lib/
# 滤镜目录前后端共用同一份(服务端用它在提示词里列出可选滤镜并校验 id)
COPY web/src/lib/filters.json ./src/lib/filters.json
COPY web/dist ./dist
RUN mkdir -p /data
EXPOSE 8791
CMD ["node", "server.js"]
