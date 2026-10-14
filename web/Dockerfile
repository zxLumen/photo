FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PHOTO_PORT=8791 \
    PHOTO_HOST=0.0.0.0 \
    PHOTO_DATA_DIR=/data
COPY web/package.json ./
COPY web/server.js ./
COPY web/lib/ ./lib/
COPY --from=build /app/dist ./dist
RUN mkdir -p /data
EXPOSE 8791
CMD ["node", "server.js"]
