# Moon Outfit v4 — OpenRouter 动态穿搭配图

## 升级现有网站

解压 ZIP，将 moon-outfit 文件夹内的文件覆盖到原 GitHub 项目同一目录并提交，Vercel 会重新部署。不要只改环境变量而不上传新版代码。Vercel 不直接运行 ZIP。

保留现有 OPENROUTER_API_KEY 和 Upstash / KV 环境变量。新增：

OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image

该变量也是代码默认值，不设置也使用这个图片模型。它与文字模型 OPENROUTER_MODEL 完全独立。OPENROUTER_MODEL 保留你目前的值；未设置时仍默认 openai/gpt-6-astra。不需要 Google API Key。

在 Production（生产）和需要的 Preview 环境设置，保存后重新部署。所有密钥只读取服务端环境变量。

Vercel：Framework Other；Node 22.x；Build Command `node scripts/build.mjs`；Output Directory `public`；Root Directory 为包含 package.json 的目录。

## 新行为

- 先生成每日文字推荐，再调用 OpenRouter 图片 API，根据已经保存的 Best Outfit、Power Color 和性别生成一张单套穿搭平铺图。不会再用固定男女拼图冒充推荐结果。
- 图片生成失败不影响文字结果，可单独点击 Retry outfit image。普通浏览和已缓存图片读取不发起生图。
- 同一份资料、日期、文字模型、图片模型与密钥复用已保存的图片。图片/文字保存约 72 小时；不要当天清空数据库。换模型、密钥或资料会创建新图片。
- 并发图片请求使用 150 秒锁；等待期间只查询结果，不自动再次发起付费生成。失败后等待几分钟手动重试。网络中断或保存失败后再次生图可能产生额外费用。
- 月相标题、对应说明与明暗示意图在打开页面、切换时区及跨日后更新，不依赖 AI。月相按平均朔望月近似计算，以所选时区日期的 UTC 正午作为日代表时刻；同一个阶段可持续多天。圆盘为标准方向示意，不是所在地实拍或精密星历。
- 手机表单单列、控件 48px，图片采用正方形完整展示。

## OpenRouter 图片调用

模型：google/gemini-3.1-flash-image（Nano Banana 2）。服务端 POST https://openrouter.ai/api/v1/images，n=1、resolution=1K、aspect_ratio=1:1。只发送衣服描述与性别；图片请求不发送姓名、出生日期或城市。

文字仍使用 /api/v1/chat/completions。两种调用共同消费你的 OpenRouter 余额，具体价格以平台模型页及账单为准。不承诺 10 美元可生成固定张数。没有自动换模型或付费重试。

图片二进制校验只接受 PNG/JPEG/WebP；输出 base64 最大 4,000,000 字符。分块写入你已有的 Upstash Redis，避免单次大请求，最后写完成标记。通过本站 /api/outfit-image 读取图片，不依赖外部临时链接。图片缓存比文字占空间大，用户规模增长后可迁移到对象存储。

## Redis

支持以下任一组：

UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

KV_REST_API_URL + KV_REST_API_TOKEN

必须使用可写 REST TOKEN，不能用 READ_ONLY_TOKEN 或 redis:// URL。无可用持久存储时不调用图片模型。

文字仍使用 v3 缓存，升级不会强制重新付费生成已有文字。首次获取对应图片会发生一次生图调用。文字首次并发请求可能有多次调用，但最终采用同一份首次保存结果。

## 本地与验证

Node.js 22，无 npm 第三方依赖。`npm run dev` 打开 http://127.0.0.1:4173；`npm test` 运行模拟测试；`node scripts/build.mjs` 构建。脚本不会自动读取 .env，实际调用需在运行环境配置变量。

本版用模拟服务验证：每日结果固定、时区跨日、输入校验、图片提示词来自已保存推荐、图片并发锁、分块保存读取、缓存复用、图片错误保留文字、余额/权限/限流错误。已检查手机表单宽高。未使用用户真实密钥调用 OpenRouter 或线上 Redis，实际出图质量与账户权限需部署后验证。

## 文件

api/generate.js：文字推荐；api/outfit-image.js：生图与图片读取；lib/outfit-image.js：提示词和图片存储；lib/daily-cache.js：每日缓存；app.js：前端联动和月相绘制。

官方参考：
https://openrouter.ai/google/gemini-3.1-flash-image
https://openrouter.ai/docs/guides/overview/multimodal/image-generation
