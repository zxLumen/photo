# 光圈 · 构图裁剪与自动修图

给个人主页(zxLumen-Blog)应用栏用的独立子应用。上传一张照片,视觉模型现场分析主体、地平线与画面,
给出**最佳构图法**(三分 / 黄金分割 / 中心 / 对角线 / 三角 / 对称 / 引导线 / 留白)并**自动裁出构图框**,
同时给出一整套修图参数(曝光 / 对比 / 高光 / 阴影 / 黑白场 / 色温 / 色调 / 饱和度 / 清晰度 / 锐化 / 降噪 / 暗角),
并**按画面内容挑一个滤镜**(52 个:胶片 / 日系 / 电影 / 复古 / 黑白 / 题材),可手动微调后一键导出。

- 裁剪与调色**全程在浏览器内**完成:裁剪/旋转用 Canvas 2D,调色用 WebGL shader 实时预览(与导出同一套管线)。
- 视觉分析经**博客 AI 网关**调用(`http://app:3000/api/ai/v1`),真实 Key 只在主站;也支持直连调试。
- 数据**按访客隔离**:只把**缩略图 + 参数 + AI 结论**存到 `data/`,**不保存原图**。

## 目录

```
photo/
├─ .github/workflows/docker-publish.yml   # 推 GHCR: ghcr.io/zxlumen/photo-web
└─ web/
   ├─ server.js        # Express(零依赖 http):静态 + /api/*
   ├─ lib/             # 服务端:scope(cid 隔离)/ store / settings / llm / analysis / photo-store
   ├─ src/             # 前端:Vite + React 19 + TS
   │  ├─ components/   # CropStage / AdjustPanel / FilterRail / WorksPanel / SettingsPanel / ExportDialog / Uploader
   │  └─ lib/          # compose(构图几何) / crop(裁剪与吸附) / colorPipeline(WebGL) / filters(LUT 滤镜) / autoTone / imageOps
   └─ test/            # node --test(服务端纯函数与存储)
```

## 开发

```bash
cd web
npm install
cp .env.example .env      # 填 ZX_AI_GATEWAY_URL / ZX_AI_APP_TOKEN / SESSION_SECRET
npm run dev               # 前端 5175 + 接口 8791
# 或只用后端(需先 npm run build 出 dist)
npm start
```

- 本地调试视觉模型:把 `.env` 的 `ZX_AI_GATEWAY_URL` 指向本机主站 `http://localhost:3000/api/ai/v1`,
  或在应用内「设置」(站长)里临时直连某个视觉模型填 Key。
- 站长兜底:`http://127.0.0.1:8791/?owner=<PHOTO_OWNER_TOKEN>` 换 `photo_owner` cookie;
  与博客同 `SESSION_SECRET` 时,已登录博客即视为站长(SSO)。

## 滤镜

- 目录在 `src/lib/filters.json`(**前后端共用**:提示词、服务端校验、前端配方都读这一份),配方在 `src/lib/filters.ts`。
- 每个滤镜是一段声明式配方(曲线 / 通道混合 / 分色 / 分色相 HSL / 褪色),按需烘焙成 **33³ 3D LUT**,
  渲染时只是一次纹理采样(缩略图用 17³)。不内置任何 LUT 图片,离线可用。
- 叠加顺序:**按本图实测的调色 → 滤镜 LUT → 颗粒 / 暗角**。滤镜不修改调色参数,可单独开关、调节强度(0–100)。
- 自动修图时视觉模型输出 `filter{id, amount, why}`;客户端只认目录里的 id,并有三道护栏:
  文档不加滤镜、低调照片不套高调滤镜、有肤色不套强偏色滤镜、噪点重时压低颗粒类强度。
- 颜色配方跑在 sRGB 空间,预览 / 前后对比 / 导出共用同一个 shader,所见即所得。
- 空间效果(高光光晕 / 柔焦 / 漏光 / 边缘色散 / HDR 局部对比)也在同一遍 shader 里,
  滤镜强度为 0 时全部关闭,不影响性能。
- 公开样张页:`/preview.html`(静态图,由示例照片按真实管线渲染,方便对外展示)。

## 测试与校验

```bash
cd web
npm test          # node --test(服务端)+ tsc 编译后的 TS 逻辑测试(含滤镜 LUT / AI 选择)
npm run typecheck # tsc --noEmit
npm run build     # vite build → dist/
```

## 接入博客(上线时的清单)

1. 本仓库 push `main` → CI 构建并推 `ghcr.io/zxlumen/photo-web:latest`。
2. 博客 `docker/docker-compose.yml` 已有 `photo` 服务(镜像 + `PHOTO_AI_TOKEN` + `SESSION_SECRET`),
   `docker/Caddyfile` 已有 `photo.${DOMAIN}`,`docker/deploy.sh` 已加 pull —— 均在博客仓库。
3. 在博客 `/admin → AI 密钥` 签发本应用的**接入令牌**,填到服务器 `docker/.env` 的 `PHOTO_AI_TOKEN`。
4. 应用栏:博客 `/admin → 应用` 加一条 `id=photo`、`url=https://photo.zxlumen.cn/`、打开方式「页内浮层(panel)」,
   上传图标 → 线上 `npm run sync:apps`。出厂默认已含该条(`apps/next-home/src/lib/app-config.ts`)。
5. 项目卡:博客 `packages/shared/src/content.local.ts` 已加 `photo` 卡 → 线上 `npm run sync:projects`。

## 数据与隐私

- `data/sessions/<scope>.json`:编辑会话(缩略图 ≤360px + 参数 + AI 结论)。
- `data/presets/<scope>.json`:调色预设。
- `scope` = 访客 `photo_cid`(16 位 hex)或站长 `owner`;非 hex 一律归 `owner`(防路径穿越)。
- 单文件上限:会话 100 条、预设 50 条,超出丢最旧。
