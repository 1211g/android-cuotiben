# Noteee · 个人自用

按 `安卓错题本APP需求分析.docx` 实现的**离线、单机、竖屏**错题本。UI 采用 **workbuddy 风格**（深色低饱和底 + 彩色环境光斑 + 圆角胶囊 + 底部凸起 FAB）叠加 **苹果液态玻璃**（`backdrop-filter: blur(26px) saturate(185%)` + 半透明材质 + 1px 内描边 + 顶部高光 + 斜向镜面渐变），深浅色两套完整 token。

同一份代码同时交付两种形态：

| 形态 | 入口 | 适用 |
| --- | --- | --- |
| PWA / Web App | 浏览器打开 `index.html` | 立刻预览、添加到主屏幕 |
| Android APK | `Noteee-v1.0.8.apk` | 真机安装，Android 8.0 (API 26) 及以上 |
| Android Studio 工程 | `android-studio/`（File → Open） | 用 IDE 直接 Run / Debug 到模拟器或真机 |

> 全程不注册、不登录、不联网、不收集信息、无埋点无广告。数据只存在本机 IndexedDB；备份是本地 ZIP 文件。

---

## 一、快速使用

### 浏览器 / PWA 预览

```bash
cd cuotiben-app
python -m http.server 8777 --bind 127.0.0.1
# 打开 http://127.0.0.1:8777/
```

浏览器（Chrome / Edge）里可「添加到主屏幕 / 安装应用」，Service Worker 会把全部静态资源缓存下来，之后断网也能打开。桌面浏览器会显示一个居中的手机框，方便按竖屏单手验收。

### Android 安装

直接把 `Noteee-v1.0.8.apk`（或 `Noteee-v1.0.8-签名版.apk`）传到手机安装即可。首次启动会**动态申请**相机 / 相册权限；拍照、选图都走系统标准接口。

---

## 二、需求对照

| 需求 | 实现 |
| --- | --- |
| **2.1 录入** | 首页加号弹出四个子选项「直接录入错题 / 批量导入错题 / 导入 PDF / 导入 TXT 小说」，分别拉起对应文件选择；直接录入支持拍照 / 相册多选 / 纯文字三种可混用；题干、ABCD 选项、正确答案、错因预设 + 「其他」补充说明、解析、科目、题型、掌握状态、多标签、录入/修改时间（**已按最新要求移除「我的错误答案」与「1–5 星难度」**）；图片进编辑器可**框选裁剪 + 调亮度**，拍照来源会**先弹出独立截取器**（四角拖拽 / 三分线 / 整张·题目区·宽幅预设，支持「截取」与「截取并识别」），并可**离线 OCR 识别转文字**、**识别数学公式**（上下标 / 分式 / 根号 → LaTeX + KaTeX 离线预览）或**一键把几何图形照片转成纯白背景干净 PNG**；底部固定「取消 / 存并继续 / 保存」，存并继续会保留科目与题型 |
| **2.2 列表** | 卡片**第一行显示知识点（标签）**、下方显示题干（题干里的 `$公式$` 用 KaTeX 渲染）；**题干最多显示 4 行**（比早期 2 行更多，从列表就能读到更完整的题目内容，超出部分进详情看全文）；科目、错因、掌握标记、日期；3 种排序（最新/最早录入、最近修改）；科目 / 题型 / 掌握 / 错因 / 标签**多条件叠加**筛选，顶部 chips 可单个移除或一键清空；全文搜索题干 / 解析 / 错因文字；卡片上可加标签、更多操作（**已移除难度星级与「一键切换掌握」按钮，掌握状态改在详情页切换**） |
| **2.3 详情** | 图片**自适应居中、保持原始比例不拉伸**（`object-fit:contain`，长边上限 300px），支持双指缩放、拖动、双击还原、滚轮缩放；展示全部字段；**已按最新要求移除「选项」框，只保留正确答案**（编辑页亦无 ABCD 选项输入）；**每题可选封面**：详情页「封面」按钮可设「默认封面」（同 APP 风格的紫蓝渐变卡 + 科目文字）/「导入图片作封面」/「恢复默认」，封面显示在首页卡片上；可改任意字段；删除二次确认并**一并移除关联图片**；一键切换掌握；**追加备考备注**独立成列表（**备注里的 `$公式$` 也用 KaTeX 渲染**），绝不覆盖解析；解析等长公式**限制换行、不横向溢出屏幕** |
| **2.4 管理** | 科目 / 题型 / 错因模板 / 标签同一入口增删改；科目重命名会同步迁移错题引用；删除科目可选「迁移到另一科目」或「连同错题一并删除」；删除标签只解除关联 |
| **2.5 备份** | 全部错题 + 图片打包成 ZIP（`manifest.json` + `data.json` + `images/*`），写入系统下载目录（Android 端经原生桥接写入 `下载/Noteee备份/`）；导入可选「合并」或「覆盖」，合并时重复条目以**较新修改时间**为准；覆盖前二次确认 |
| **2.6 统计** | 入口**从底部标签移到首页顶栏的图表按钮**（底部原「统计」位改为「资料」页）；总数 / 已掌握 / 未掌握 / 本周新增；分科目条形图、错因环形图（SVG `stroke-dasharray`）、近 8 周新增趋势 |
| **2.7 设置** | 深浅色切换、**备份目录（点「修改」直接弹输入框，改动即时写库并刷新显示；早期优先调用 `showDirectoryPicker` 在 WebView 里静默失效、表现为「点击无效」，本轮已移除该分支）**、只清理**未被引用**的残留图片、数据占用空间（额外显示资料份数）、**「导入后删除 ZIP」开关（批量导入 ZIP 成功后自动删除来源压缩包，仅原生端生效）**、关于「个人自用版 · v1.0.8 · chen5」；**设置页的「批量导入错题」按钮已按要求移除** |
| **非功能** | 图片压缩长边 1600 / 缩略图 320 分开缓存（WebP，JPEG 兜底；白底图形走无损 PNG）；**全屏弹层（详情/编辑器）顶部按 `env(safe-area-inset-top)` 避让状态栏，不再与系统栏重叠**；OCR 引擎、中文/英文词库、wasm、KaTeX CSS/JS/字体全部随包内置，**没有任何网络请求**；Android 8.0+；竖屏 + 刘海安全区（`env(safe-area-inset-*)`）；系统相机/相册接口；动态权限；**事务写入**（图片与文字同事务，失败不留半写）；删除撤销入口；备份包与数据库都记录 schema / dbVersion；无埋点广告 |
| **扩展** | 批量导入题目清单（JSON / CSV / JSONL / **ZIP 包**）：externalId 幂等、三种重复策略、解析预览、单事务写入与撤销；**ZIP 包 = `data.json` + `images/` 图片目录，导入时把题目 `images` 字段的相对路径自动替换成图片数据**；入口在首页加号 →「批量导入错题」（设置页入口已按要求移除），格式规范见第九节 |
| **资料（PDF + 本地 HTML + TXT 小说）** | **底部标签「资料」页**（替代原「统计」位，统计移顶栏）+ 首页加号第三项共用入口；PDF 以 `ArrayBuffer`、本地 HTML 以文本存进 IndexedDB 的 `pdfs` store（HTML 标 `kind:"html"`）；HTML 用沙箱 `iframe srcdoc` 离线渲染；列表按导入时间倒序、删除二次确认；查看器用随包内置的 **PDF.js 3.11.174** 离线渲染，采用**连续滚动**阅读（所有页垂直堆叠、页间留缝、按宽度自适应，向下滑直接跨页，如 WPS / QQ 浏览器效果）；顶部「1 / N」可点开跳转页码、上/下一页按钮切页；支持**双指缩放 / 单指拖动 / 双击复位**、懒渲染（仅渲染视口附近页）、横竖屏切换自动重新适配（桌面端 Ctrl+滚轮缩放）；设置「数据占用空间」额外显示 PDF 份数。详见第十节 |

> 需求中的风险项「纯图片题不可搜索」已处理：收录时提示补一句文字题干，卡片用文字题干首行做缩略图，全文检索才有内容可命中。

---


---

## 二·补8、v1.0.8 更新说明

本版修复上一版引入的一处回归：

- **恢复「导入 HTML」入口**：v1.0.7 把首页加号的「导入资料」子菜单改成直接的「导入 PDF」，导致本地 HTML 导入入口消失。本版把「导入 HTML」恢复为加号**一级选项**（五项：直接录入 / 批量导入 / 导入 PDF / 导入 HTML / 导入 TXT 小说），点击拉起系统文件选择器（`typ=*/*` 不过滤，确保手机本地 HTML 手册可选），导入后用沙箱 iframe 离线渲染并记忆阅读位置。真机 CDP 验证：加号出现「导入 HTML」项、点击触发 `GET_CONTENT` intent。
- **打包 / 版本**：版本号 1.0.7 → **1.0.8**（Gradle `versionCode` 8→9，手工包 `--version-code 9`）；Service Worker 缓存 v24 → **cuotiben-v25**。

## 二·补7、v1.0.7 更新说明

本版按用户反馈调整入口与文件选择、并更换图标，三项改动：

- **1. 资料页小说模块移除导入按钮**：小说书架不再放「导入 TXT 小说」按钮（入口已统一到首页底部「＋」→「导入 TXT 小说」），空态文案改为引导去首页加号导入；FAB 四项「直接录入 / 批量导入 / 导入 PDF / 导入 TXT 小说」保持不变。
- **2. 文件选择器精确过滤**：原生 `openFileChooser` 按各入口的 `accept` 精确生成过滤——「导入 PDF」只筛 `application/pdf`、「导入 TXT 小说」只筛 `text/plain`、「批量导入」只筛 `application/zip` 与 `application/json`（`EXTRA_MIME_TYPES`），三项均用真机 logcat 抓取 `GET_CONTENT` intent 验证（`typ=application/pdf` / `typ=text/plain` / `typ=*/* (has extras)`）。本地 HTML 仍保持**不过滤**（`typ=*/*`），避免部分厂商文件管理器不索引本地 html 导致用户手册选不到。Web 层批量导入的 `accept` 同步收窄为 `.zip,.json`，避免误导。
- **3. 图标更换**：按用户提供的「简约记事本（打开的书 + 铅笔）」图片重做全部图标。生成脚本改为运行时测量非白内容边界（约 1134×811）、居中裁成 1350×1350 方图、保留左右各约 8% 边距、采样背景色（纯白）填角；PWA 192/512/maskable 与 Android 五密度 `ic_launcher.png` 一次生成，0.235 圆角 / 80% 安全区规则不变。
- **打包 / 版本**：版本号 1.0.6 → **1.0.7**（Gradle `versionCode` 7→8，手工包 `--version-code 8`）；Service Worker 缓存 v23 → **cuotiben-v24**。

## 二·补6、v1.0.6 更新说明

本版根据用户反馈修复记忆 / 动画 / 状态栏问题，四项改动：

- **1. 管理分组折叠状态记忆**：科目管理 / 题型 / 错因 / 标签 / 科目字段显示五组的展开/收起状态由内存 `state.manageCollapsed` 升级为**持久化到配置** `config.manageCollapsed`（`DEFAULT_CONFIG` 含该字段，默认全部收起）；点开某组即写库，下次启动 App 仍是上次的展开状态。
- **2. 全局切换动画重做（更流畅、高帧率）**：上一版改成纯 opacity 淡入后效果偏生硬。本版 `viewIn` / `cardIn` 改为 **GPU 合成层动画**——`transform: translate3d(0,16px,0) scale(.988)` → none + opacity，配 `cubic-bezier(.22,1,.36,1)` 高帧率缓动曲线、时长 .34s、`will-change: transform,opacity`；动画期间通过 `.view.fx-enter` / `.view.entering` 临时关闭子元素 `backdrop-filter`（高斯模糊每帧重算是掉帧主因），动画结束再恢复毛玻璃，兼得流畅与质感；保留 `prefers-reduced-motion` 降级。
- **3. HTML 阅读记忆修复（真实手册验证）**：用户提供的两个真实 HTML（`数学二知识手册.html` 213 KB、`408考研知识手册.html` 338 KB）是**自包含 hash 路由 SPA**——打开先停在 `#/home`（无滚动内容），点章节链接后才构建正文（`docScrollHeight` 从 ~808 增至 4964+）。旧实现只上报滚动百分比，重开时 SPA 回到 `#/home` 无可滚内容，恢复永远是 0。本版改为**存 `{hash, pct}` 并 hash-aware 恢复**：iframe 用 `allow-same-origin`，宿主直接读取 `contentDocument` 探测真实滚动容器（内层 `overflow:auto` 或 window）、上报 `location.hash` + 滚动比例，恢复时先把 `location.hash` 设回上次章节触发正文构建、再按比例滚动。真机用这两个真实文件实测：滚到 55% → 关闭 → 重开，均精确恢复到原章节与原比例（`#/chapter/gs-1` / `#/chapter/ds-1`，pct 0.55）。
- **4. 小说界面顶部避让状态栏**：`.novel-top` 的 padding 改为 `calc(12px + env(safe-area-inset-top))`，顶栏内容不再被手机状态栏遮挡（仍用 padding 并入安全区而非 top 偏移，保证沉浸式整栏移出动画正常）。
- **打包 / 版本**：版本号 1.0.5 → **1.0.6**（Gradle `versionCode` 6→7，手工包 `--version-code 7`）；Service Worker 缓存 v22 → **cuotiben-v23**。

## 二·补5、v1.0.5 更新说明

本版根据用户反馈优化阅读体验与管理交互，八项改动：

- **1. 沉浸式阅读「轻点正文恢复」修复**：原用 `lastTouchEnd` 时间差抑制滑动后的幽灵 click，导致轻点正文多半被误判为滑动而不恢复。改为 `didSwipe` 标志——`touchstart` 置 false，`touchend` 仅在真实水平滑动（|dx|>50 且横向主导）时置 true 并翻页，`click` 只吞掉滑动后补发的幽灵 click；轻点正文中部可靠切换沉浸。真机连续 3 轮「轻点进入→轻点恢复」全部通过。
- **2. 大 TXT 加载提速**：小说阅读器改为**懒分页**——打开时只对当前章分页（`paginateChapter(ci)` + `ensureChapter(ci)`），翻页/跳章用到哪章才分页哪章，字号变更 / 旋转才全量重置；不再一次性布局整本。真机导入 75.9 万字符（8 章 × 2000 段、展开约 401 页）打开仅 0.84s，导入 0.06s。
- **3. 导入 TXT 小说移到加号一级**：底部「＋」菜单第三、四项拆为「导入 PDF」与「导入 TXT 小说」，点选直接拉起对应 file input（不再经「导入资料」二级菜单）。
- **4. 管理项可点击筛选错题**：科目管理 / 题型 / 错因 / 标签的具体条目行改为可点，点击后跳回首页并按该条目值筛选（如「科目·数学」），底部 toast 提示。
- **5. 管理分组可收起折叠**：科目管理、题型、错因、标签、科目字段显示五组标题前新增折叠按钮，**默认全部收起**，点击展开/收起（状态存 `state.manageCollapsed`）。
- **6. 全局点击动画去帧**：视图切换 `viewIn`、卡片 `cardIn` 由 transform+opacity 改为**纯 opacity** 淡入（避免满屏 `backdrop-filter` 卡片每帧重算模糊），时长 .42s→.24s/.26s，加 `will-change:opacity`；环境光斑 drift 改用 `translate3d`，并加 `prefers-reduced-motion` 降级。
- **7. HTML / PDF 查看器标题单行**：顶部文件名改为单行显示（`white-space:nowrap` + `text-overflow:ellipsis`），字号 17px→14px，长文件名不再换行挤占阅读区。
- **8. HTML / PDF 记忆阅读位置**：查看器关闭时把阅读进度写回记录 `progress`（PDF 存 `page`+`ratio`；HTML 由注入的桥脚本经 `postMessage` 上报滚动百分比，宿主用 `latestPct` 单一来源持久化），重开自动跳回上次位置。真机验证 HTML 滚动 66%→关闭→重开桥脚本带 `saved=0.66`；PDF 关闭存 `{page,ratio}`。
- **打包 / 版本**：版本号 1.0.4 → **1.0.5**（Gradle `versionCode` 5→6，手工包 `--version-code 6`）；Service Worker 缓存 v21 → **cuotiben-v22**。

## 二·补4、v1.0.4 更新说明

本版根据用户反馈重做小说阅读器并修复隐藏 bug，四点改动：

- **1. 小说按屏分页 + 章内滑动翻页 + 沉浸式阅读（重做）**：上一版做的是「滑动换章」（整章切到下一章），并非用户要的番茄小说式效果。本版把每章正文按内容区高度切成多页（`paginate()` 用隐藏测量容器逐段量高后分页），左滑/右滑或点「下一页 / 上一页」在**章内逐页**翻动，翻到章末才进入下一章；顶栏显示「第 X/N 章 · 第 P/M 页」。新增「沉浸」按钮：点击后顶栏与底栏淡出（`opacity:0`、`pointer-events:none`），正文铺满屏幕，只留内容，与番茄小说阅读器一致；再点一次或轻点正文恢复。**关键 bug 修复**：初版 `paginate()` 在 overlay 加入 DOM 之前调用，此时 `clientHeight/offsetTop/offsetHeight` 全为 0，导致每章被折叠成单页、分页从未生效；本版把 `appendChild(root)` 移到 `paginate()` 之前，真机实测 60 段被正确切成 13 页。
- **2. 按科目自定义字段显示（沿用并校验）**：管理页「科目字段显示」组可选科目并开关「题干 / 正确答案·我的答案 / 错因」；开关写入 `DEFAULT_CONFIG.hiddenFields`，录入端与详情页按 `fieldHidden(subject,key)` 隐藏对应内容（数据保留）。真机实测开关持久化 `hiddenFields={数学:[stem]}`。
- **3. 修复导入 HTML 看不到手机 HTML 文件**：原生 `openFileChooser` 对文档输入放宽 MIME 白名单（`setType("*/*")` 且不附加 `EXTRA_MIME_TYPES`），避免厂商文件管理器把 `text/html` 当作严格过滤条件而隐藏本地 html；htmlFileInput 的 `accept` 含 `.html,.htm,text/html`。真机导入中文名 `手机页面.html` 成功。
- **4. 打开 PDF / 小说动画去帧**：全屏 `backdrop-filter` 在 translateY 动画期间每帧重算高斯模糊导致掉帧。新增 `U.enterSheet()`：入场期间临时移除毛玻璃、仅用 GPU transform/opacity 动画，动画结束恢复；时长 .42s→.32s。
- **打包 / 版本**：版本号 1.0.3 → **1.0.4**（Gradle `versionCode` 4→5，手工包 `--version-code 5`）；Service Worker 缓存 v20 → **v21**；新增 `css/novel.css`、`js/novel.js` 已在预缓存与打包清单内。

## 二·补3、v1.0.3 更新说明

- **小说滑动翻页**：小说阅读器正文区新增左右滑动手势翻章（横向位移 > 55px 且横向主导、时长 < 900ms 判定为翻页；左滑下一章、右滑上一章），带 translateX + 淡入的轻量翻页反馈；与原有点击翻页 / 点击中部切换沉浸、纵向滚动共存，滑动后抑制合成 click。
- **按科目自定义字段显示**：管理页新增「科目字段显示」分组——选科目后可分别开关「题干 / 正确答案·我的答案 / 错因」的显示（默认全部显示）。隐藏后该科目录入页不显示对应输入框、详情页不显示对应板块，数据仍保留不删除；适合用图片替代题干的科目。题干被隐藏时允许仅凭图片/答案保存。配置存 `DEFAULT_CONFIG.hiddenFields`（按科目名映射），不 bump DB_VERSION。
- **修复 HTML 导入看不到文件**：原生文件选择器原对文档输入附加 `EXTRA_MIME_TYPES`（含 `text/html` + `application/octet-stream`），部分 Android / 厂商文件管理器不把本地 `.html` 索引为 `text/html` 或把 MIME extras 当作严格/AND 过滤，导致 HTML 文件在选择界面不显示。现文档分支改用纯 `setType("*/*")`、不再附加 MIME 白名单，选择界面显示全部文件（扩展名 / 魔数校验仍在 Web 层做），HTML 可见可选。
- **打开动画去掉帧**：PDF / 小说等全屏 sheet 打开时，全屏 `backdrop-filter: blur(34px)` 在 translateY 滑动的每一帧都被重算导致掉帧。现入场期间通过 `U.enterSheet()` 临时移除 backdrop-filter（CSS `.entering`），仅用 GPU transform（`translate3d`）+ 纯色背景滑动，动画结束再恢复毛玻璃；动画时长 .42s → .32s，并加 `will-change` / `backface-visibility`。
- **打包 / 版本**：版本号 1.0.2 → **1.0.3**（Gradle `versionCode` 3→4，手工包 `--version-code 4`）；Service Worker 缓存 v19 → **v20**。


## 二·补2、v1.0.2 更新说明

- **管理中按科目筛选标签**：管理页「标签」分组顶部新增科目选择条（「全部科目」+ 各科目 chip）；选中某科目后只显示该科目错题实际用到的标签，其余隐藏，分组头显示「可见/总数」并给出提示；点「全部科目」恢复。纯 UI 筛选，不写库。
- **资料页右上角按钮移除 + 资料/小说切换**：资料页顶部原「打开本地 HTML」「导入 PDF」两个图标按钮已删除；新增「资料 / 小说」分段切换（`.doc-tabs`）。资料 tab 保留 PDF / 本地 HTML 列表；小说 tab 内置「导入 TXT 小说」按钮与书架。
- **TXT 小说阅读器（番茄小说式）**：新增 `js/novel.js` + `css/novel.css` 独立模块（window.Novel）；TXT（≤20MB）按「第X章 / Chapter N / 数字、」自动分章，存 `pdfs` store（`kind:"txt"`）；书架显示章节数与阅读进度；阅读器全屏沉浸、护眼纸张/类纸/夜间三档主题、字号 A-/A+、目录抽屉、上下章、分区点击翻页、键盘导航、翻章与滚动进度写回本地、重开续读。
- **修复首页加号「导入资料」无效**：原第三项只切到资料页不弹文件选择；现弹二级菜单「PDF 文档 / 本地 HTML / TXT 小说」，分别拉起对应 file input（`doPromptDocImport`）。
- **打包 / 版本**：`js/novel.js` 与 `css/novel.css` 加入 `sw.js` 预缓存与两条构建链的 assets；版本号 1.0.1 → **1.0.2**（Gradle `versionCode` 2→3，手工包 `--version-code 3`）；Service Worker 缓存 v18 → **v19**。

## 二·补、v1.0.1 更新说明

- **应用改名**：项目 / App 名称由「错题本」统一改为 **Noteee**（标题、首页 H1、关于卡、`manifest.json`、`strings.xml`、APK 文件名 `Noteee-v1.0.2.apk` / `Noteee-v1.0.2-签名版.apk`、UA `Noteee/1.0.2 (offline)`、备份目录 `Download/Noteee备份`）。版本号 1.0.0 → **1.0.1**（Gradle `versionCode` 1→2，手工包 `--version-code 2`）。
- **本地 HTML 离线查看**：资料页顶部「文档」图标（`打开本地 HTML`）选取 `.html/.htm`（≤12MB），以文本存进 `pdfs` store（`kind:"html"`），列表里点开用沙箱 `iframe srcdoc` 离线渲染，与 PDF 共用同一个「资料」入口和删除逻辑。
- **批量导入后自动删除 ZIP**：设置 →「导入后删除 ZIP」开关（默认关闭）；开启后，通过 ZIP 包批量导入成功时调用原生桥 `CuotiBridge.deleteLastPickedZip()` 删除来源压缩包（仅 Android 原生端生效；PWA 端无此桥，静默跳过）。开关值存 `DEFAULT_CONFIG.autoDeleteZip`。
- **底部导航调整**：底部标签第 2 项「统计」→「资料」（`data-view="pdf"`，i-pdf）；统计入口移到首页顶栏的图表按钮 `#btnStats`（`setView('stats')`）。原顶栏「查看 PDF」按钮移除。
- Service Worker 缓存 v17 → **v18**（前端 HTML/JS/CSS/图标均改动）。



## 三、工程结构

```
cuotiben-app/
├── index.html                 # 单页骨架、SVG 图标 sprite、四个 view、手机框
├── css/glass.css              # 液态玻璃设计系统（全部组件与深浅色 token）
├── js/utils.js                # 工具：日期、图标、图片压缩/裁剪、toast（含撤销）、下载
├── js/zip.js                  # 零依赖 ZIP 读写（store 模式 + CRC32，支持 deflate-raw 读取）
├── js/db.js                   # IndexedDB 数据层、事务 bundle、合并/替换、残留图清理
├── js/vision.js               # 离线 OCR、文字/图形分类、数学公式结构恢复、纯白背景算法、KaTeX 渲染
├── js/app.js                  # 全部页面逻辑与交互（单 IIFE，含 openCropper / openBatchImport / openPdfLibrary / openPdfViewer）
├── js/batch.js                # 批量导入：格式解析 / 校验 / 归一化 / 模板（window.Batch）
├── js/pdf.js
├── js/novel.js                # TXT 小说：分章 / 书架 / 阅读器（window.Novel）                  # PDF 导入 / 加载 / 渲染封装（window.Pdf，按需注入 PDF.js）
├── sw.js / manifest.json      # PWA 离线缓存与安装清单（缓存含 OCR / KaTeX / PDF.js 资源与 batch.js / pdf.js）
├── icons/                     # source-icon.jpg（用户提供的 3D 原图）+ 192 / 512 / maskable PNG（favicon 用 192 PNG）
├── samples/                   # 批量导入示例：batch-example.json / batch-example.csv（不进 APK）
├── ocr/                       # 随包内置的离线识别资源（约 18 MB）
│   ├── tesseract.min.js / worker.min.js
│   ├── tesseract-core-{simd-,}lstm.wasm.js / .wasm   # 两个 LSTM 变体
│   ├── lang/chi_sim.traineddata.gz / eng.traineddata.gz  # best_int 精简词库
│   ├── katex/katex.min.js / katex.min.css / fonts/*.woff2  # 公式离线渲染
│   └── *-LICENSE.txt          # Tesseract.js / tesseract.js-core 许可证
├── pdf/                       # 随包内置的 PDF.js 3.11.174 离线资源（186 个文件 / 约 3.35 MB）
│   ├── pdf.min.js / pdf.worker.min.js   # 主库与 classic worker（320 KB / 1.09 MB）
│   ├── cmaps/*.bcmap          # 168 个 CMap（中日韩字符映射）
│   └── standard_fonts/*       # 16 个标准字体（.ttf / .pfb）
├── build_apk.py               # 手工 APK 构建（aapt2 → javac → d8 → zipalign → apksigner）
├── build-apk.bat              # Windows 一键构建入口
├── android/
│   ├── AndroidManifest.xml    # 竖屏、权限、WebView 壳、CaptureProvider
│   ├── java/com/cuotiben/app/
│   │   ├── MainActivity.java  # 本地资源映射、相机/相册、备份写盘、状态栏、返回键
│   │   └── CaptureProvider.java
│   ├── res/                   # 主题 / 字符串 / 启动图标
│   ├── cuotiben.jks           # 持久化签名密钥（首次构建自动生成，勿删）
│   └── build/                 # 构建中间产物（可删除）
├── Noteee-v1.0.8.apk        # 已签名可安装 APK（v2 + v3 签名，4 字节对齐）
├── Noteee-v1.0.8-签名版.apk          # 中文名副本
└── README.md
```

### 数据模型

`IndexedDB: cuotiben`，**DB_VERSION = 2**（本轮新增 `pdfs` store，备份 schema 仍为 1）、四个 store：`questions`（索引 createdAt / updatedAt / subject）、`images`、`config`、`pdfs`。

```js
question = { id, stem, options:{A,B,C,D}, correctAnswer, myAnswer,
             cause, causeExtra, analysis, subject, qtype, difficulty,
             mastery, tags, imageIds, notes:[{id,text,createdAt}],
             cover: null | { mode:'subject' } | { mode:'image', data:dataURL },
             createdAt, updatedAt }
image    = { id, full, thumb, createdAt, width, height }  // full/thumb 为 dataURL
pdf      = { id, name, data, size, createdAt }             // data 为 PDF 原始 ArrayBuffer
```

> 说明：`myAnswer`（我的错误答案）与 `difficulty`（难度星级）的**录入 UI 已按最新要求移除**，但数据模型仍保留这两个字段以兼容已有错题、备份包与批量导入；历史数据不会丢失，新录入的题这两项为空。
>
> `cover` 是题目封面：默认 `null`（卡片用首张题目图或文字题干）；`{mode:'subject'}` 显示按科目自动生成的渐变封面（canvas 绘制，按 科目+尺寸 缓存，不占存储）；`{mode:'image', data}` 是用户导入图片压缩后的缩略图 dataURL。封面随 question 一起存入 IndexedDB，**自动进入备份 ZIP**，编辑错题时也会被保留。

`DB.saveQuestionBundle(question, newImages, removedImageIds)` 与 `deleteQuestionBundle(id)` 在**单个 readwrite 事务**里同时写 `questions` + `images`，满足「图片与文字同时成功才落库」。

### 备份包格式

```
manifest.json  { app, format:"cuotiben-backup", schema:1, dbVersion:1,
                 exportedAt, exportedAtText, counts }
data.json      { schema:1, questions:[...], config:{...} }
images/<id>.webp        原图（普通照片，WebP/JPEG 兜底）
images/<id>_thumb.webp  缩略图
images/<id>.png         纯白背景图形 / 线稿（无损 PNG，扩展名按实际 MIME 记录）
images/<id>_thumb.png   对应的缩略图
```

ZIP 用 store 模式写入（UTF-8 文件名标志 `0x0800`），读取时兼容 deflate（`DecompressionStream('deflate-raw')`）。导入时按文件名扩展名还原 MIME 与 dataURL，白底图形不会因重新压缩而变脏。

---

## 四、图片智能处理（本次新增）

录入页选图后会进入「编辑图片」弹层，除原有的**框选裁剪 / 亮度**外，新增**拍照自动截取**、**数学公式识别**与三个预览页签。六个操作按钮分两行排列：

| 控件 | 作用 |
| --- | --- |
| `智能识别`（推荐） | 跑一次 OCR + 公式结构恢复：文字题 → 弹出可编辑结果（含公式预览）；图形题 → 自动转成纯白背景图形并切到「纯白图形」页签 |
| `转文字` | 纯文本 OCR，结果可「替换题干 / 追加到题干 / 填入解析」，纯图片题也能被全文搜索命中 |
| `识别公式` | 专门跑 `Vision.recognizeMath()`：保留上下标、分式、根号等结构，输出 `正文 + $LaTeX$` 混合文本，并用 KaTeX 离线渲染预览 |
| `截取区域` | 打开**独立全屏截取器**，只保留题目部分（拍照来源会自动先弹出），不跑 OCR |
| `截取并识别` | 截取后立刻跑公式识别，框得越小识别越准 |
| `白底图形` / `黑白线稿` | 不跑 OCR，直接把照片净化成纯白背景彩色图形或灰度线稿 |
| 净化强度滑块 | 8–42%，控制「多暗才算墨迹」，纸面越脏调高一点 |
| 公式快插（结果层） | `√ 根号` / `a/b 分式` / `xⁿ 上标` / `xₙ 下标`，在光标处插入 LaTeX 片段并即时刷新预览，修正 OCR 误差 |

### 直接截取题目区域

`openCropper()` 是一个全屏玻璃弹层：照片按 `min(360/w, 440/h, 1)` 缩放显示，默认选「题目区」预设（上下左右留 8–10%），可拖动四角控制点缩放、拖动选区内部平移、空白处重新框选，并画三分辅助线对齐题目；另有「整张 / 题目区 / 宽幅」三个预设。三个结果按钮为「取消 / 截取 / 截取并识别」。

截取结果用 `canvas.drawImage` 从**原始全分辨率图**按 `sel / scale` 裁出 JPEG（质量 0.94），得到新的全分辨率源 `sourceDataUrl`，再由它派生 1600px 的显示副本 `workDataUrl` —— 后续 OCR 直接用 `sourceDataUrl`（`vision.js` 内部再按需缩到 1800px），白底化/裁剪坐标基于 `workDataUrl`，坐标不会出现错位。

> **为何这样分层（修复「截取界面发虚、识别变差」）**：早期版本先把整张照片压到长边 1600px 的 `workDataUrl`，截取器却拿这张缩略图去裁 —— 截取那一刻细节已丢失，高分屏上预览也因 canvas 没有按 DPR 放大 backing store 而显得很模糊。现在：① 截取器直接读 `sourceDataUrl`（原始全分辨率），高分屏 canvas 按 `devicePixelRatio` 放大 backing store（`ctx.setTransform(dpr,…)`，坐标仍用 CSS 像素，触摸/四角拖拽不受影响）；② OCR（`runMath` / `runOcr`）也从 `sourceDataUrl` 取图，不再用 1600px 副本。实测 3000×2000 拍照 → 截取「题目区」得 **2520×1520**（旧逻辑只有约 1344×912），OCR 仍正常出字。截图见 `shot-crop-sharp.png`。

「使用这张」后图片仍按常规流程压缩入库（长边 1600，符合非功能要求；实测 900×600 → 截取 756×456 正常落库）。

### 数学公式识别

Tesseract 只输出字符与 bbox，不输出上下标/分式结构。`vision.js` 用 `worker.recognize(image, {}, {text:true, blocks:true})` 拿 `lines[].words[].symbols[]`，再做三层恢复：

- **上下标**：每行以 `baseline.y0` 为基准、以正文字高中位数 `hRef` 为标尺；字高在 `0.4–0.9 × hRef` 之间且底部明显高于 baseline 判为上标、明显低于 baseline 判为下标，连续的同级符号合并成 `^{...}` / `_{...}`。等号、减号、逗号字高只有正文 0.1–0.3 倍，先按字高区间排除，避免误判。
- **文本兜底**：紧贴的上标常被 Tesseract 并进相邻字符（bbox 里没有独立 symbol），`implicitExponents()` 再把 `x²` / `x2`（后接 `+ - * / = , ) ] ;` 或行尾）补成 `x^{2}`；`polishMath()` 把 `1/2`、`a÷b` 转 `\frac{}{}`，把 `√(...)` 转 `\sqrt{}`，映射 `× ÷ ≤ ≥ ∑ ∫ π` 等为 LaTeX 命令。
- **堆叠分式**：`detectFractions()` 先在灰度图上找「又长又薄」的分数线（`thick<=3`、`24<=bw<=w*0.5`、`bw/thick>=8`），再取分子/分母的实际墨迹边界做**紧裁二次 OCR**（结果必须是纯 ASCII 数学片段才采纳），最后把上下两行文字合并成 `\frac{分子}{分母}`。实测 `f(x) = x2 - 2x + 3` → `f(x) = x^{2} - 2x + 3`，`1/2 + 3/4 = 5/4` → `\frac{1}{2} + \frac{3}{4} = \frac{5}{4}`，独立分数线 `1` 上 `2` 下 → `\frac{1}{2}`。

`recognizeMath()` 返回 `{text, plain, latex, formulas, confidence, fractions}`：`text` 是「中文正文 + `$...$`」可直接填入题干，`latex` 交给 `Vision.renderMath()` 用本地 `ocr/katex/` 资源渲染成公式图片预览。结果层文本域可任意修改，改完会自动重取 `$...$` 段刷新预览。

**公式渲染（详情页 + 首页卡片）**：录入的题干/选项/正确答案/错因/解析存的是「普通文字 + `$行内公式$` + `$$块公式$$`」混合文本。`vision.js` 的 `Vision.renderMathText()` 会逐段拆开：普通文字按原样显示（含换行），`$…$` 片段交给 KaTeX 内联渲染，`$$…$$` 渲染成块级公式（超宽可横向滚动）。`openDetail()` 给这些面板挂 `data-math-text`，打开详情时统一渲染；`renderHome()` 也在渲染完卡片列表后对每张卡片的题干调用 `renderDetailMath()`，因此**首页卡片的题干公式同样会渲染**，不再显示 `$Oxy$` 源码。KaTeX 资源未就绪或加载失败时保留原始 `$…$` 文本，绝不空白（浏览器与 Android 模拟器均已实测，截图 `shot-mathdetail.png` / `shot-emu-mathdetail.png`）。

> 为什么不用 `equ` 数学词库：实测 `@tesseract.js-data/equ` 是 legacy 模型（无 LSTM），对普通 Times 字体公式输出乱码，且需额外引入 2 个完整内核（约 +16 MB）。故改为在现有 `chi_sim+eng` LSTM 结果上做结构恢复，配合 KaTeX 离线渲染 —— 体积小、中英混排正常、结果可编辑。

### 界面细节修复（最新一轮）

- **状态栏不再重叠**：原生壳用透明状态栏 + `SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN` 沉浸式从 y=0 绘制内容，普通页面 `.view` 早有 `padding-top: env(safe-area-inset-top)`，但全屏弹层 `.sheet-full` 漏了，导致详情页/编辑器标题顶到状态栏下被遮挡。现给 `.sheet-full` 也加上 `padding-top: env(safe-area-inset-top)`，真机实测详情页标题落在 y≈25px，避开状态栏（截图 `shot-4fix-detail-emu.png`）。
- **图片自适应居中不拉伸**：详情页 `.detail-imgs` 改为 flex 居中换行，`.detail-imgs img` 用 `max-width:100%; max-height:300px; width:auto; height:auto; object-fit:contain; object-position:center`，保持原始宽高比（实测 200×400 竖图按 151×300 等比显示）；编辑器草稿缩略图 `.img-tile img` 同样改为 `contain` 居中，不再裁切拉伸。
- **去掉选项框**：详情页移除「选项」面板（题干 → 正确答案 → 错因 → 解析 → 属性），编辑页移除 ABCD 四个选项输入框，只留正确答案。数据层 `options` 字段保留以兼容旧数据与备份，仅不再展示与采集。
- **新的《批量导入说明.docx》**：随工程生成一份 10 节的 Word 文档（从哪导入 / 三种格式 / JSON 结构 / 18 字段逐项 / mastery 对照 / **ZIP 图片包** / 去重模式 / 公式写法 / 三个坑 / 完整范例），由 `make_import_docx.py` 生成，取代旧版仅 JSON 的说明。

### 首页题干多显示几行（最新一轮）

- **只改首页卡片展示**：把题干 `.qcard-title` 的 `-webkit-line-clamp` 从 2 行提高到 **4 行**（行高 1.5），从列表就能读到更完整的题目内容；其余（答案、解析、图片/备注计数、详情页、录入、数据层）一概不动。
- 曾尝试在卡片上加「答案 + 解析摘要 + 图片/备注数」预览框，但用户明确要的是"显示更多**题目**信息，而不是答案和其他信息"，故已全部撤销，回到干净的题干卡片结构。
- 实测：短题干维持原高度；长题干（200+ 字）显示满 4 行（84px = 4×21px），超出部分截断、进详情看全文；页面无横向滚动、各元素不重叠、题干公式仍走 KaTeX。截图 `shot-stem4lines.png`（浏览器长题干验收）。

### 备注公式、长公式换行与题目封面

- **备考备注也渲染公式**：此前备注项用 `esc(n.text)` 直接输出，`$a_2$`、`$\tan^3t\sim t^2$` 只能看到源码。现在备注内容挂上 `data-math-text`，`renderDetailMath()` 会一并用 `Vision.renderMathText()` 渲染成 KaTeX（实测含 3 个公式的备注正确显示 `a₂` / `tan³t∼t²`，无残留 `$`）。
- **长公式限制换行、不再溢出屏幕**：`.sheet-body` 加 `overflow-x:hidden`；`.panel-text` 加 `overflow-wrap:anywhere; max-width:100%`；行内公式 `.math-inline` 改 `display:inline-block; max-width:100%; overflow-x:auto`（超宽公式在自己框内横向滚动，不撑破面板），`.math-display` / `.katex-display` / 备注 `.katex` 都限定 `max-width:100%`。实测含超长积分公式 + 长中文的解析，`.sheet-body` 的 `scrollWidth == clientWidth`（横向溢出为 0）。
- **题目封面功能**：详情页底部新增「封面」按钮 → `openCoverPicker()` 弹选项：① **默认封面**（`{mode:'subject'}`）—— 用 canvas 画出与 APP 同风格的紫蓝渐变圆角卡 + 玻璃高光斜带 + 圆点装饰 + 科目文字（按科目哈希选 6 组渐变之一，按 科目+尺寸 缓存为 PNG dataURL，不落存储）；② **导入图片作封面**（选图 → `U.makeVariants` 压缩 → `{mode:'image',data:thumb}`）；③ 已设封面时追加 **恢复默认**（`cover=null`，回到首张题目图 / 文字题干）。封面显示在首页卡片左上角缩略图位置，随 question 存库、随备份走、编辑错题时保留。

### 文字识别、自动分类与图形净化

- **OCR**：Tesseract.js v5 + 本地 wasm（LSTM）+ `chi_sim` / `eng` 词库，中英混排。结果会先清洗（挤掉中文模式在汉字之间插入的多余空格，保留 `f(x) = x - 2` 这类公式空格）再由用户确认填入。worker 全局单例复用，首次约 5–10 秒，之后 2–4 秒。
- **文字 / 图形自动分类**：`classify()` 同时要求「有连续文字串、汉字/字母足够多、数字占比不高、置信度达标」，判据为 `confidence >= 38 && run >= 5 && chars >= 5 && letters >= 5 && digitRatio < 0.62`。几何图上散落的 `A / B / C / O` 标注与纸面噪点（常被 OCR 读成一串 `1`）都不会被误判成一段文字，因此会自动走纯白背景流程。智能识别若已恢复出公式，即使文字较少也不会误判成图形。
- **词库名自适应**：手工 `aapt2` 打包保留 `*.traineddata.gz`；Android Studio / AGP 的 aapt2 会把 `.gz` 解压并去掉后缀，变成 `*.traineddata`。`vision.js` 在原生 WebView 里先 HEAD 探测一次，自动选择 `gzip: true / false` 与对应文件名；浏览器 / PWA 固定用 `.gz`。两套包都能加载词库。
- **纯白背景算法**：32px 分块估计纸面背景亮度（暗底取 15 分位，亮底取 85 分位）→ 3×3 平滑后双线性插值成背景图 → 按相对亮度 `g/B` 与彩色饱和度提取墨迹（彩色像素必须同时够暗，避免泛黄纸面被留成色块）→ 两轮去孤立噪点 → 非墨迹像素强制 `(255,255,255)`，墨迹按 `k=255/B` 白平衡保留原色（线稿模式压成 24–96 灰）→ 输出**无损 PNG**。缩略图/详情图也走 `lossless:true`，避免 WebP 有损压缩把纯白染成灰白。

- **完全离线**：`ocr/` 目录里的引擎、wasm、词库与 KaTeX CSS/JS/字体、`pdf/` 里的 PDF.js 主库 / worker / 168 个 cmaps / 16 个标准字体全部随包内置；APK 不声明 `INTERNET` 权限，PWA 由 Service Worker（`CACHE = 'cuotiben-v25'`，预缓存前端 9 个 JS（含 `js/pdf.js`、`js/novel.js`）与 `css/novel.css`+ 8 个 OCR 资源 + 22 个 KaTeX 资源 + `PDF_ASSETS` 的 `pdf.min.js` / `pdf.worker.min.js`；cmaps / 标准字体由 fetch handler 按需缓存）提供离线兜底，不上传任何图片或 PDF。原生壳内不注册 SW，资源直接由 `shouldInterceptRequest` 从 assets 读取。

> Android 打包注意：`wasm / gz / js` 资源都大于 1 MB，`aapt2 link` 用 `-0 wasm -0 gz -0 js -0 txt -0 woff2` 让它们以 STORED 方式入包，否则 `AssetManager.open()` 解压大文件会触发 `UNCOMPRESS_DATA_MAX` 限制；原生层 `mimeOf()` 相应补充了 `application/wasm` / `application/gzip` / `font/woff2`。Gradle 侧因为 `.gz` 被解压改名，`androidResources.noCompress` 还要额外加 `traineddata`，同时由前端的「词库名自适应」配合。PDF 资源里只有 `pdf/pdf.worker.min.js`（1,087,212 B）超过 1 MB，其 `.js` 扩展名已被 `-0 js` / `noCompress 'js'` 覆盖为 STORED；`cmaps/*.bcmap` 与 `standard_fonts/*` 均小于 1 MB，原生 `mimeOf()` 回落到 `application/octet-stream`，PDF.js 用 `fetch(...).arrayBuffer()` 读取，无需扩充 MIME 表。

---

## 五、Android 壳说明

原生层是**极简 WebView 壳**，不含任何第三方库、不含 Gradle 依赖：

- **稳定 origin**：`shouldInterceptRequest` 把 `https://cuotiben.local/**` 映射到 `assets/www/**`，因此 IndexedDB / DOM Storage / 相对路径与浏览器行为一致，且是安全上下文。Manifest **不声明 `INTERNET` 权限**，所有非本地导航一律拒绝 —— 真·离线。
- **相机 / 相册**：`onShowFileChooser` 中，`capture` 模式拉起 `ACTION_IMAGE_CAPTURE` 并用自写 `CaptureProvider`（无 androidx 依赖）把照片写进应用私有目录；非 capture 模式拉起 `ACTION_GET_CONTENT`（支持多选）。相册与相机权限在启动时动态申请（`READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` / `CAMERA`）。
- **导入文件选择器**：非 capture 的 `ACTION_GET_CONTENT` 按 `<input accept>` 决定 MIME —— 图片输入保持 `image/*`，备份 ZIP 与批量导入的 JSON / CSV 用 `*/*` + `EXTRA_MIME_TYPES`。早期版本对所有输入都写死 `image/*`，导致 APK 内选不到 ZIP / JSON 文件，现已修复。
- **备份导出**：`CuotiBridge.saveBase64(base64, filename)` 由 JS 把 ZIP 转成 base64 交给原生；API 29+ 用 MediaStore 写入 `下载/Noteee备份/`，API 26–28 写公共 Download 目录。
- **深浅色状态栏**：`CuotiBridge.setLightStatusBar(bool)` 同步系统栏图标颜色；`viewport-fit=cover` + CSS `env(safe-area-inset-*)` 适配刘海。
- **返回键**：`window.CuotiBack()` 先关闭最上层弹层，再退出应用。
- **Service Worker**：原生壳内跳过注册（避免 SW 的 fetch 绕过 `shouldInterceptRequest`）；浏览器 / PWA 仍正常注册。
- **PDF 资源直供**：`shouldInterceptRequest` 对 `pdf/**` 同样映射到 `assets/www/pdf/**`；`.bcmap` / `.pfb` / `.ttf` 走默认 `application/octet-stream`，PDF.js 通过 `fetch` 取 `ArrayBuffer` 正常渲染（真机 CDP 已验证一页 PDF 真实出字）。

---

## 六、重新构建 APK

> **工程位置**：本项目现位于 `E:\Vibecoding\ctb\cuotiben-app\`（同级还有 `cuotiben\` 早期 Flutter 草稿、`screenshots\`、`req_content.txt`、`extract_req.py`）。工程本身不含 SDK / JDK，可以再次整体复制到任意目录；下面所有相对路径都相对 `cuotiben-app\` 自身。

### 前置条件（本机已具备）

- Android SDK：`platforms/android-34/android.jar` + `build-tools/34.0.0`（`aapt2.exe`、`d8.bat`、`zipalign.exe`、`apksigner.bat`）
- JDK 17（`javac.exe` / `jar.exe` / `keytool.exe`）
- Python 3（用于拷贝资源、拼装 zip、驱动命令）

脚本 `build_apk.py` 会自动查找工具链，**优先用环境变量，其次用本机常见安装位置**，因此搬走工程后仍可直接构建：

| 项目 | 查找顺序 |
| --- | --- |
| SDK | `CUOTIBEN_SDK` → `ANDROID_HOME` / `ANDROID_SDK_ROOT` → `../build/sdk`、`../.toolchain/android-sdk` → `D:\Android Projects` → 原工作区 `build\sdk` |
| JDK | `CUOTIBEN_JAVA_HOME` → `JAVA_HOME` → PATH 上的 `javac` → `D:\AndroidBuild\zulu17` → `../.toolchain/zulu*`、`jdk*` |

> 换机器时最省事的做法是设 `CUOTIBEN_SDK=<SDK 根目录>` 与 `CUOTIBEN_JAVA_HOME=<JDK 根目录>`（也可设 `ANDROID_HOME` / `JAVA_HOME`）。脚本优先选 `android-34` + `build-tools/34.0.0`，没有时退回已安装的最新版本。SDK 路径含空格（例如 `D:\Android Projects`）时 `d8.bat` / `apksigner.bat` 走 `cmd /c` 会丢引号，`build_apk.py` 的 `run_bat()` 已整体加引号处理。

### 用 Android Studio / Gradle 运行（本机已配置）

工程在 `cuotiben-app/android-studio/`，是**标准 AGP 工程**，与手工构建共用同一份 `android/` 下的 Java / Manifest / res 源码：

1. Android Studio → `File > Open` → 选择 `cuotiben-app/android-studio/`，等 Gradle Sync 完成（`local.properties` 已写好 `sdk.dir=D:/Android Projects`；AGP 8.5.2 与 Gradle 8.7 已在本机 Gradle 缓存中，可离线 Sync）。
2. 选择 AVD（本机为 `Medium_Phone_API_37.0`）或 USB 真机，点 **Run ▶**。产物为 `android-studio/app/build/outputs/apk/debug/app-debug.apk`。
3. 命令行等价：`android-studio\build-gradle.bat`，或 `D:\AndroidBuild\gradle-8.7\bin\gradle.bat --offline assembleDebug`。

`app/build.gradle` 里的 `syncWebAssets` Sync 任务挂在 `preBuild` / `merge*Assets` 之前，每次 Run 都会把根目录的 `index.html / css / js / icons / ocr / pdf / sw.js / manifest.json`（`include 'pdf/**'`）同步进 assets，所以改完前端直接 Run 即可看到最新效果，无需手工拷贝。大资源通过 `androidResources { noCompress += ['wasm', 'gz', 'js', 'txt', 'traineddata', 'woff2'] }` 以 STORED 入包，避免 `AssetManager` 的 1 MB 解压上限。

> 两份 APK 的 `applicationId` 相同但签名不同：Gradle 用默认 debug keystore，手工 `build-apk.bat` 用持久化的 `android/cuotiben.jks`。互相覆盖安装时需先卸载（卸载会清数据，请先导出备份 ZIP）。

### 一键构建（手工 aapt2 / d8 方式）

```bat
cd cuotiben-app
build-apk.bat
```

或：

```bash
python build_apk.py
```

构建步骤：

1. 把 `index.html / css / js / icons / ocr / pdf / manifest.json / sw.js` 拷进 `android/build/assets/www/`（含 KaTeX 字体、js/batch.js、js/pdf.js 与 186 个 PDF.js 资源，共 234 个文件）
2. `aapt2 compile --dir android/res` → `aapt2 link -A assets -I android.jar --manifest ... -0 wasm -0 gz -0 js -0 txt -0 woff2` 生成 `base.apk`（大资源不压缩，见第四节说明）
3. `javac -bootclasspath android.jar` → `jar cf` → `d8 --lib android.jar --min-api 26` 生成 `classes.dex`
4. 用 `classes.dex` 全量重建干净的 `unsigned.apk`（保留各 entry 的压缩方式，避免追加写导致 zip 头不一致）
5. `zipalign -f 4` → `apksigner sign`（v2 + v3）→ `apksigner verify`
6. 产出 `Noteee-v1.0.8.apk` 与中文名副本 `Noteee-v1.0.8-签名版.apk`

> 签名密钥持久化在 `android/cuotiben.jks`（首次构建自动生成，口令 `cuotiben123`），构建只覆盖 `android/build/` 里的中间产物、不会动密钥，所以重复构建签名一致、可直接覆盖安装。`build_apk.py` 已改为复用该目录（不再整目录清空），`copy_web_assets()` 只删除本次已不存在的旧资源，避免杀毒软件或批量删除保护干扰重复构建。请自行保管好这个 jks；一旦删除并重新生成，新包与旧包签名不同，只能先卸载再安装（卸载会清数据，务必先导出备份 ZIP）。

> `build-apk.bat` 内容保持纯 ASCII，配合 `chcp 65001` 只用于让 Python 的 UTF-8 输出正常显示，避免中文批处理在 cmd 下被按 GBK 拆解执行。

### 校验

```bash
# 用脚本查到的同一套 build-tools 校验（也可直接写 D:\Android Projects\build-tools\34.0.0\...）
"<SDK>/build-tools/34.0.0/zipalign.exe" -c -v 4 Noteee-v1.0.8.apk
"<SDK>/build-tools/34.0.0/apksigner.bat" verify --verbose Noteee-v1.0.8.apk
"<SDK>/build-tools/34.0.0/aapt.exe" dump badging Noteee-v1.0.8.apk
```

> 本轮在 `E:\Vibecoding\ctb\cuotiben-app` 实跑 `build-apk.bat`（`apksigner verify` 通过）与 `gradle --offline assembleDebug`（`BUILD SUCCESSFUL in 11s`），两种构建方式均正常，产物见下。

本次交付包校验结果：`Verifies`，v2 = true、v3 = true、Number of signers: 1，`zipalign -c 4` 通过，`sdkVersion:26`、`targetSdkVersion:34`、竖屏、`application-label:'错题本'`，包含 `classes.dex`、`resources.arsc` 与 **236 个 `assets/www/*` 文件**（`ocr/` 含 22 个 KaTeX 资源，`pdf/` 186 个 = 2 个 JS + 168 个 cmaps + 16 个标准字体）；超过 1 MB 的 `pdf/pdf.worker.min.js`（1,087,212 B）与 wasm / 词库 / glue 资源均为 STORED（bad-compressed = 0）。签名包 `Noteee-v1.0.8.apk` 22,196 KB / 244 entries；Android Studio debug 包 `android-studio/app/build/outputs/apk/debug/app-debug.apk` 25,762,642 B / 246 entries。两包逐项校验：`js/app.js` 含 `chen5` / `openPdfLibrary` / `openPdfViewer` / `.pdf-sheet`，设置页渲染段无「批量导入错题」；`index.html` 含 `#btnPdf` 与 `js/pdf.js`；`js/pdf.js`、`pdf/pdf.min.js`、`pdf/pdf.worker.min.js` 均存在且为 STORED；`sw.js` 为 `CACHE='cuotiben-v25'` 且含 `PDF_ASSETS`；`css/glass.css` 含 PDF LIBRARY + VIEWER 样式块与 `.sheet-full` 的状态栏避让。

### 更换应用图标

图标源文件是用户提供的 3D 黏土风格原图 `icons/source-icon.jpg`（卡片 + 放大镜 + 橙红点缀）。想换成别的图，只需替换它并重跑：

```bash
python make_icons.py
```

脚本会：按测量坐标 `CROP = (352, 346, 1698, 1702)` 裁出奶油圆角方块本体 → 居中裁方后缩放填满画幅（`cover_square`）→ 半径 `int(0.235*size)` 圆角 mask、`CREAM(250,247,236)` 填四角 → 192 / 512 PWA 图标、maskable（图形缩到中央 80% 安全区 + CREAM 底板）与 Android 五个密度的 `ic_launcher.png` 一次生成；favicon 走 `icons/icon-192.png`。改完重跑上面的 `build-apk.bat` / `build-gradle.bat` 即可。改动图标或前端资源（含 `pdf/`）时记得把 `sw.js` 的 `CACHE` 版本号 +1（当前为 cuotiben-v25），避免 PWA 缓存旧文件；同时确认 `build_apk.py` 的 `copy_web_assets()` 与 `android-studio/app/build.gradle` 的 `syncWebAssets` 都包含新增目录（本轮已为 `pdf` 补齐）。

### 模拟器实测（Android Studio AVD）

AVD `Medium_Phone_API_37.0` 装 `app-debug.apk` 后通过 WebView DevTools（CDP）验证：

- `Vision.checkResources()` → `{ok:true, missing:[]}`；`ocr/tesseract-core-simd-lstm.wasm`（2.86 MB）与 `ocr/katex/fonts/KaTeX_Main-Regular.woff2` 均可 `fetch(...{method:'HEAD'})` 返回 200，证明 STORED 大资源能被 `AssetManager` 直接读出、KaTeX 字体随包可用。
- 给 `#fileCamera` 塞入公式照片 → 自动弹出截取器（`.crop-sheet`、`360×240` 画布、3 个预设、`截取` / `截取并识别`）；点「截取」回到 6 按钮编辑器；点「识别公式」→ 结果层出现 `公式识别 · 3 个公式 · 置信度 51%`、4 个公式快插按钮、KaTeX 正确渲染上下标与分式（`#ocrMath .katex` 存在、`document.fonts.check('16px KaTeX_Main')` 为 true）。
- 快插「√ 根号」在光标处插入 `\sqrt{x}`，「填入题干」把混合文本写进 `#f-stem` 并关闭结果层。
- **详情页公式渲染**：`Vision.renderMathText` 为 function；插入含 `$Oxy$ / P(x,y) / x\ne0 / \frac{a}{b}` 的题干后打开详情 → 9 个 `.katex` 内联公式、无残留 `$`、KaTeX CSS 与字体均加载成功，中文正文原样保留。截图 `shot-emu-mathdetail.png`。
- 截图：`shot-emu-crop.png`、`shot-emu-math.png`、`shot-emu-mathdetail.png`。
- **6 点改造 + ZIP 导入**（浏览器实测，流程同上）：首页卡片知识点第一行 + 题干 KaTeX（4 个 `.katex`、`$Oxy$` 不再显示源码）、无星级、无掌握按钮；加号弹出「直接录入 / 批量导入」两个子选项；编辑器与详情页均无「我的错误答案」与难度；构造 `data.json + images/q1.png` 的 ZIP 导入 → 1 道题 + 1 张图正确入库（图片自动转 WebP）、标签自动新增、`撤销`可用。截图 `shot-6fix-home.png`。
- **状态栏 / 图片 / 选项框修复**（浏览器 + 模拟器实测）：`.sheet-full` 的 `padding-top: env(safe-area-inset-top)` 生效（详情页标题 y≈25px 避开状态栏）；200×400 竖图在详情页按 151×300 等比居中显示、`object-fit:contain`（不拉伸）；详情页面板顺序 题干 → 正确答案 → 错因 → 解析 → 属性，**无「选项」框**，编辑器无 `f-opt-A..D` 输入。截图 `shot-4fix-detail.png`、`shot-4fix-detail-emu.png`、`shot-4fix-top-emu.png`。
- **备注公式 / 长公式换行 / 封面**（浏览器 + 真机 WebView 实测）：含 `$a_2$`、`$\tan^3t\sim t^2$` 的备考备注渲染出 2–3 个 `.katex`、无残留 `$`；超长积分公式解析的 `.sheet-body` 横向溢出为 0；详情页「封面」按钮弹出「默认封面 / 导入图片作封面」选项，选默认后 `q.cover={mode:'subject'}` 且卡片缩略图变成 PNG dataURL，导入图片后变 `{mode:'image',data:...webp}`，恢复默认后 `cover=null`，编辑错题后封面保持不变。截图 `shot-formula-notes.png`、`shot-formula-notes-bottom.png`（浏览器）、`shot-3fix-emu.png`（真机封面弹层）、`shot-3fix-notes-emu.png`（真机备注公式 + 封面按钮）。
- **4 点改造（PDF 导入 / 查看 + 设置页清理 + 备份目录修复 + 关于 chen5）**（浏览器 + 模拟器 CDP 实测）：首页顶栏 `#btnPdf`「查看 PDF」与 `#btnTheme` 同在 `.topbar-acts`（真机 x296 / x347，42×42 无重叠）；`Pdf.checkResources()` 两个 JS 均 `ok:true`；`#btnPdf` 打开 `.pdf-sheet`（表头「PDF 资料 / 导入」、空态与 `#pdfAddBtn`）；FAB 三项「直接录入错题 / 批量导入错题 / 导入 PDF」，第三项用 `#i-pdf` 图标。
- 用 `DataTransfer` 把 599 B 的 `%PDF-1.4` 文件塞进 `#pdfFileInput` 触发 change → `DB.getAllPdfs()` 1 条、库自动刷新出 1 行「高中数学公式手册.pdf 599 B · 2026.11.17」；打开 viewer → `#pvLabel`「1 / 1」、canvas 896×560（CSS 448×280）、**像素扫描确认 6014 个墨迹像素、bbox [88,212,576,252]，`Hello Cuotiben PDF` 真实出字**；删除走「删除这份 PDF？」二次确认后回到空态。
- 浏览器端 `caches.keys()` 只有 `cuotiben-v25`、48 entries，含 `/js/pdf.js`、`/pdf/pdf.min.js`、`/pdf/pdf.worker.min.js` 与按需缓存的 `/pdf/standard_fonts/LiberationSans-Regular.ttf`；原生壳按设计不注册 SW（`window.CuotiBridge` 存在时跳过），资源全部由 `shouldInterceptRequest` 从 APK assets 直供。
- 设置页：`/批量导入错题/` 0 次匹配；关于卡片 `个人自用版 · v1.0.8 · chen5`；「数据占用空间」显示 `0 道错题 · 0 张图片 · 1 份 PDF 599 B`；点「修改」→ `promptDialog` 标题「备份目录」→ 改为 `Download/CDP验证目录` 后 `DB.getConfig().backupDir` 与 DOM `.grow-sub` **同步更新**，再改回默认值同样生效，彻底修复早期 `showDirectoryPicker` 静默失效导致的「点击无效」。
- 截图：`shot-pdf-home-emu.png`（真机首页顶栏多出「查看 PDF」）、`shot-pdf-library-emu.png`（PDF 资料库）、`shot-pdf-viewer-emu.png`（真机 PDF 渲染出字 + 翻页工具条）。
- **交互升级实测（CACHE v15）**：底部 `− 140% +` 缩放控件已移除（`#pvZoom/#pvZoomIn/#pvZoomOut` 均不存在），只留上一页 / 下一页；页面自适应——wrap 411×776 时 canvas 386×241 整页装入（未溢出）；CDP `Input.dispatchTouchEvent` 模拟双指张开 → canvas `transform` 由 none 变 `scale(3)`，抬手后重绘为清晰版（canvas 2322×1451、墨迹像素 46491）；双击复位、关闭按钮经修正确认生效。
- **连续滚动实测（CACHE v16）**：导入 12 页 PDF → `.pdf-scroll` 纵向容器 `scrollH 3106 / clientH 776`、顶部「1 / 12」、无底部缩放控件、上下页按钮在；可见前 6 页 canvas 790×493 出字（墨迹约 75），未进入视口的页仍是 300×150 空 canvas（懒渲染符合预期）；`scrollTop` 跳到第 7 页 → 顶部变「7 / 12」（滚动切页 OK）；点顶部页码弹「跳转页面」→ 输入 2 → 顶部「2 / 12」且 `scrollTop 332`（跳页 OK）；双指 pinch `scale(2.5)` 抬手后**提交生效**（`zoom 2.5`、wrapW 395→988、canvas 1975px；此前 `slice(7,-1)` 解析 `scale(2.5)` 误得 `0.5` 的 bug 已用 `pinchFactor` 变量修复）；Ctrl+滚轮放大 wrapW 395→474→632；关闭 `doc.destroy()` 生效。
- **阅读区背景主题融合（CACHE v17）**：原先 `.pdf-scroll` 硬编码 `background:#20242e` 灰黑底，深色主题下是一块突兀的黑、且不随深浅色切换。现改为 `var(--bg)` 打底 + 三层 `color-mix()` 光斑（复用首页 `--blob1/2/3`）呼应 liquid-glass 氛围，深浅色主题自动切换；白纸页阴影由硬编码 `rgba(0,0,0,.4)` 改为主题变量 `var(--shadow-sm)`，浅色下不再过重。`color-mix` 不支持时回退到纯 `var(--bg)`。

---

## 七、已知边界

- 纯图片题若完全不填文字题干，全文搜索搜不到内容（需求中已列为风险，界面给出提示）；用「转文字」把 OCR 结果填入题干即可被检索。
- 内置的是精简 `best_int` 词库（约 4.7 MB，中英），手写体、极小字号会有误差，识别结果层可直接修改后再填入；不影响原图与白底图形。
- 数学公式采用「Tesseract 字符 + bbox 结构恢复 + 文本兜底」而非专用公式模型：印刷体上下标（`x²`）、行内 `1/2`、堆叠分式识别稳定；真实根号 `√` 常被读成 `V`，为避免误伤 `V=IR` 之类不做自动转换，可在结果层用「√ 根号」按钮手动改为 `\sqrt{}`。矩阵、大型连加、复杂多层嵌套公式建议直接在结果层编辑 LaTeX，KaTeX 预览会即时确认。
- 拍照后默认弹出「题目区」截取预设，若题目实际靠边请用四角拖拽或「整张 / 宽幅」预设调整；截取是破坏性的（原图会被替换），可取消重拍。
- 白底化对浅色纸面 / 米黄试卷效果最好；深色底会自动反转判断，彩色印刷或阴影极重的照片可调「净化强度」或先框选裁剪。输出为无损 PNG，体积比 WebP 大，属正常。
- OCR 引擎与词库属于 App 自带资源，不写入备份 ZIP；备份包只含用户录入的错题与图片。
- **PDF 资料不写入备份 ZIP**：PDF 存在 `pdfs` store 供离线查看，但备份包按需求只含错题 + 图片，且单个 PDF 允许到 60 MB；换机 / 重装 / 「导入恢复」后需重新导入 PDF 原文件。
- 备份合并以 `updatedAt` 较新者胜出；不同设备各自录入的同一 id 极少出现，若出现按此规则收敛。
- 不提供云同步、账号、多设备同步；数据只在本机，卸载 APK 会清除数据，请定期导出 ZIP。
- 设置页「备份目录」统一用文本输入框填写（相对系统下载目录的目录名），改动立即写库并刷新显示；原生端由 `CuotiBridge.saveBase64` 落盘，桌面浏览器若已持有授权的目录句柄（`state.dirHandle`）仍优先写该目录，否则走普通下载。早期优先调用 `showDirectoryPicker` 在 WebView 里静默失效、表现为「点击修改无效」，本轮已移除该分支。
- 目标为竖屏单手使用，未适配平板横屏布局。

---

## 八、界面预览

已逐屏截图验收（文件位于 `E:\Vibecoding\ctb\screenshots\`）：`shot-home.png`（空状态）、`shot-list.png`、`shot-light.png`（浅色液态玻璃）、`shot-stats3.png`、`shot-manage.png`、`shot-settings.png`、`shot-editor.png`、`shot-detail.png`、`shot-detail-img.png`、`shot-img-editor.png`、`shot-final.png`（最终深色首页）、`shot-vision-editor.png`（带 OCR / 白底按钮的图片编辑器）、`shot-vision-clean.png`（智能识别后自动转成的纯白背景几何图）、`shot-emu-home.png`（模拟器首页）、`shot-emu-ocr.png`（模拟器内中文 OCR 识别结果层）、`shot-emu-figure.png`（模拟器内图形自动转纯白背景）、`shot-final2.png`（最终深色首页）、`shot-crop.png`（拍照自动弹出的截取器）、`shot-math.png`（公式识别结果层与 KaTeX 预览）、`shot-emu-crop.png` / `shot-emu-math.png`（Android 模拟器内截取器与公式识别实测截图）、`shot-relocated.png`（搬迁到 `E:\Vibecoding` 后从新位置启动预览的验收截图）、`shot-mathdetail.png` / `shot-emu-mathdetail.png`（详情页题干 LaTeX 渲染修复的浏览器与真机实测截图）、`shot-6fix-home.png`（本轮 6 点改造后的首页：知识点第一行 + 题干 KaTeX 公式 + 无星级 / 无掌握按钮；含 ZIP 图片批量导入实测）、`shot-emu-6fix.png`（本轮改造后 Android 模拟器真机首页：知识点胶囊 + 题干公式 KaTeX 渲染 + 无星级 / 无掌握按钮）、`shot-4fix-detail.png` / `shot-4fix-detail-emu.png`（状态栏避让 + 图片等比居中 + 去选项框后的详情页浏览器/真机截图）、`shot-4fix-top-emu.png`（真机首页状态栏无重叠验收）、`shot-formula-notes.png` / `shot-formula-notes-bottom.png`（备注公式 KaTeX 渲染 + 长公式不溢出，浏览器）、`shot-3fix-emu.png`（真机封面弹层）、`shot-3fix-notes-emu.png`（真机备注公式渲染 + 封面按钮）、`shot-stem4lines.png`（首页题干 4 行显示，长题干验收；早期 2 行方案已撤销）、`shot-pdf-home-emu.png` / `shot-pdf-library-emu.png` / `shot-pdf-viewer-emu.png`（本轮 4 点改造的真机截图：顶栏「查看 PDF」入口、PDF 资料库、离线渲染出的 PDF 页面与工具条）。

---

## 九、批量导入错题（自动化对接格式 v1）

### 9.1 入口与流程

**首页中间的加号「＋」→「批量导入错题」**（这是唯一入口，设置页的批量导入按钮已按要求移除）。加号另两个子选项：「直接录入错题」手动录入一道、「导入资料」弹「PDF 文档 / 本地 HTML / TXT 小说」二级菜单（第十节）。可选文件、从剪贴板读取、或直接粘贴文本；弹层内可下载 JSON / CSV / **ZIP 模板**。工程内附完整示例：`samples/batch-example.json`、`samples/batch-example.csv`。

流程：解析 → 预览（有效条数、将新增/更新/跳过、错误明细、前 6 条预览、将自动新增的分类值）→ 选择重复处理方式 → 导入 → 9 秒内可「撤销」。

> 与「导入恢复」不同：这里读的是**外部生成的题目清单**，不是备份 ZIP，不会清空现有数据。
> App 不会自动扫描手机目录，需要手动选择文件或粘贴内容；原生壳已能选择 `.zip/.json/.csv/.txt`。

### 9.2 规范格式（自动化请使用这一种）

**UTF-8 编码的单个 JSON 文件，扩展名 `.json`**：

```json
{
  "format": "cuotiben-batch",
  "version": 1,
  "generatedAt": "2026-11-16T01:50:00+08:00",
  "source": "your-automation",
  "questions": [
    {
      "externalId": "math-2026-11-16-001",
      "stem": "已知二次函数 f(x)=x²-2x+3，求其在区间 [0,3] 上的最小值。",
      "options": { "A": "1", "B": "2", "C": "3", "D": "4" },
      "correctAnswer": "B",
      "myAnswer": "A",
      "cause": "审题粗心",
      "causeExtra": "漏看了区间限制",
      "analysis": "配方得 f(x)=(x-1)²+2，最小值为 2。",
      "subject": "数学",
      "qtype": "单选",
      "difficulty": 3,
      "mastery": "unmastered",
      "tags": ["月考", "压轴题"],
      "notes": ["老师补充：端点也要比较"],
      "createdAt": "2026-11-16T01:50:00+08:00",
      "updatedAt": "2026-11-16T01:50:00+08:00",
      "images": []
    }
  ]
}
```

| 顶层字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `format` | string | 是 | 必须为 `cuotiben-batch`；写成别的值会被明确拒绝（防止误传备份包） |
| `version` | number | 是 | 必须为 `1`；不兼容版本直接报错，便于以后平滑升级 |
| `questions` | array | 是 | 1–5000 条，超出需拆分文件 |
| `generatedAt` | string | 否 | 生成时间，仅作记录，不参与导入逻辑 |
| `source` | string | 否 | 来源标记，仅作记录 |

### 9.3 `questions[]` 字段

| 字段 | 类型 | 必填 | 缺省 | 说明 |
| --- | --- | --- | --- | --- |
| `externalId` | string | **强烈建议** | 空 | 幂等键，见 9.5；同一来源内保持唯一且稳定 |
| `stem` | string | 条件必填 | 空 | 题干文字。**`stem` 与 `images` 至少有一项**，都没有的条目会被跳过并计入错误列表 |
| `options` | object | 否 | A/B/C/D 均空 | `{"A":"","B":"","C":"","D":""}`；也接受平铺的 `optionA`…`optionD` |
| `correctAnswer` | string | 否 | 空 | 正确答案 / 完整解题过程 |
| `myAnswer` | string | 否 | 空 | 我的错误答案 |
| `cause` | string | 否 | 空 | 错因；新值会自动加入「管理」页 |
| `causeExtra` | string | 否 | 空 | 错因补充说明 |
| `analysis` | string | 否 | 空 | 解析，支持换行 |
| `subject` | string | 否 | 配置里第一个科目 | 新科目自动加入「管理」页 |
| `qtype` | string | 否 | 配置里第一个题型 | 新题型自动加入「管理」页 |
| `difficulty` | number | 否 | `3` | 整数 1–5，超范围钳到边界 |
| `mastery` | string | 否 | `unmastered` | 枚举见 9.4 |
| `tags` | string[] | 否 | `[]` | 也接受 `"月考｜压轴题"` 这类分隔字符串；新标签自动加入配置 |
| `notes` | string[] 或 object[] | 否 | `[]` | 备考备注；对象形式 `{"text":"…","createdAt":"…"}` |
| `createdAt` | number / string | 否 | 当前时间 | 毫秒时间戳（秒级也兼容）或 ISO 8601 字符串 |
| `updatedAt` | number / string | 否 | 同 `createdAt` | 同上 |
| `images` | string[] | 否 | `[]` | 题目图片，见 9.6；每条最多 8 张 |

### 9.4 枚举与固定取值

| 字段 | 允许值 |
| --- | --- |
| `mastery` | `unmastered`（未掌握）/ `fuzzy`（模糊）/ `mastered`（已掌握）；兼容中文与 `0/1/2` |
| `difficulty` | `1` `2` `3` `4` `5` |
| `options` | 键固定 `A` `B` `C` `D` |
| `tags` 分隔符 | 半角竖线 &#124;、全角竖线 `｜`、顿号 `、`、半角/全角逗号、半角/全角分号、换行 |
| 时间 | 毫秒 Unix 时间戳，或 `2026-11-16T01:50:00+08:00` 这类 ISO 8601 |

### 9.5 幂等与重复处理（定时任务重点）

脚本**每次给同一道题固定不变的 `externalId`**（例如 `来源:试卷ID:题号`），同一批文件反复导入就不会产生重复题目。

- 匹配顺序：`externalId` 精确匹配 → 都没有时按内容指纹 `fp = hash(去空白的 stem + subject)` 匹配 → 纯图片题没有文字题干，不生成指纹，只能靠 `externalId` 去重。
- 导入时三种可选模式：
  - **跳过重复**（默认，推荐定时任务）：已存在的不动，只导入新题。
  - **更新已有**：用文件内容更新文字字段，保留原 `createdAt`、原有图片与历史备注（备注按文本去重追加）。
  - **全部新建**：忽略幂等键，每条都新建，可能产生重复。
- 同一个文件内部出现重复的 `externalId` / 指纹时，后一条一律跳过。

### 9.6 图片（可选）

`images` 数组元素可以是 `data:image/png;base64,…` 形式的 dataURL、纯 base64 字符串，或 `{"dataUrl":"…"}` / `{"data":"…","mime":"image/jpeg"}`。导入时统一按现有规则压缩成 1600px 原图 + 320px 缩略图再入库；单张处理失败会跳过该图并记录警告，不阻断整批。**CSV 不支持图片，需要图片请用 JSON 或 ZIP 包。**

**方案二：ZIP 包（推荐用于带图片批量导入）**。把题目清单写成 `data.json`（就是 9.2 的规范 JSON），题目 `images` 字段填**包内相对路径**（如 `images/1.png`），再把图片文件放进同名 `images/` 目录，一起打成 ZIP。目录结构：

```
batch.zip
├── data.json          # {"format":"cuotiben-batch","version":1,"questions":[…,"images":["images/1.png"]]}
└── images/
    ├── 1.png
    └── 2.jpg           # 支持 png/jpg/jpeg/webp/gif
```

在批量导入弹层点「选择 .zip / .json / .csv / .txt」选这个 ZIP（或点「ZIP 模板」拿到带示例的包再改），App 会解包、把 `images` 里的相对路径按文件名宽松匹配替换成图片数据，再走正常解析预览与导入（toast 会提示 `ZIP 已解包 · 图片 N 张，路径替换 M 处`）。缺失的图片会保留原路径并计入警告，不阻断其他题。实测浏览器与 APK 均能正确导入图片题（截图 `shot-6fix-home.png`）。

### 9.7 兼容输入（不推荐自动化使用）

除规范格式外，解析器还能读：顶层裸数组、单条 question 对象、**JSONL**（每行一个 JSON 对象，适合逐行追加）、**CSV**（UTF-8，模板带 BOM，支持引号内逗号/换行）。字段键名兼容中文别名（如 `题干`、`科目`、`难度`、`标签`）与英文别名，但**自动化请始终使用 9.3 的标准英文键**，别名只是给手工录入兜底。

### 9.8 生成脚本示例（Python）

```python
import json, pathlib, datetime

questions = [{
    "externalId": f"quiz-2026-11-16-{i:03d}",
    "stem": stem,
    "correctAnswer": answer,
    "subject": "数学",
    "qtype": "单选",
    "difficulty": 3,
    "mastery": "unmastered",
    "tags": ["月考"],
} for i, (stem, answer) in enumerate(rows, 1)]

payload = {
    "format": "cuotiben-batch",
    "version": 1,
    "generatedAt": datetime.datetime.now().astimezone().isoformat(),
    "source": "my-pipeline",
    "questions": questions,
}
pathlib.Path("batch.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
)
```

把 `batch.json` 传到手机，在 App 里选择文件即可；桌面浏览器也可直接把内容复制进剪贴板再点「从剪贴板」。

### 9.9 导入行为与可靠性

- 解析出的题目 + 图片 + 配置在**一个 IndexedDB readwrite 事务**里提交，中途失败不留半写数据。
- 无效条目只跳过、不中断整批，错误与警告在预览里逐条列出。
- 新科目 / 题型 / 错因 / 标签自动追加到「管理」页配置，不需要事先手工建好。
- 导入完成后 toast 提供 9 秒「撤销」：删除本次新建的记录与图片、恢复被覆盖的记录与导入前配置。
- 全程离线解析，不上传任何内容；文件本身也不会被写进备份 ZIP。
- 解析实现见 `js/batch.js`（`window.Batch`），落库事务见 `js/db.js` 的 `bulkImport` / `undoImport`，界面逻辑在 `js/app.js` 的 `openBatchImport()`。

---

## 十、PDF 资料（导入与离线查看）

本轮新增，用来把试卷、讲义、公式手册等 PDF 学习资料收进 App 并**完全离线**查看，与「错题」数据是两条独立的存储。

### 10.1 入口

| 入口 | 位置 | 作用 |
| --- | --- | --- |
| 底部标签「资料」 | 底部导航第 2 项（`data-view="pdf"`） | 打开 **资料页**，内含「资料 / 小说」两个 tab：按导入时间倒序列出全部 PDF，显示文件名 / 体积 / 日期；行内红色 PDF 图标、删除按钮（二次确认）、右侧箭头进入查看 |
| 「导入 PDF」 | 首页加号 → 三个子选项的第三项 | 拉起系统文件选择器（`accept=".pdf,application/pdf"`），选完直接入库 |
| 「导入」 | PDF 资料库右上角按钮 | 同上，在库内继续追加 |

设置页的「数据占用空间」会额外显示 `N 份 PDF`；资料库为空时给出「点首页的「+」→「导入 PDF」」引导。

### 10.2 存储与格式

- 文件以 **`ArrayBuffer`** 原样存进 IndexedDB 的 `pdfs` store（`{id, name, data, size, createdAt}`），不做转码、不上传、不写临时文件。
- `js/pdf.js`（`window.Pdf`）负责校验：扩展名 / MIME、≤ 60 MB、`%PDF-` 魔数（`0x25 0x50 0x44 0x46 0x2d`）；文件名过 `slug()` 去掉路径分隔符，长度截断 80 字符。
- 渲染引擎是随包内置的 **Mozilla PDF.js 3.11.174**（UMD + classic worker）：`ensureLib()` 按需注入 `pdf/pdf.min.js`，并把 `GlobalWorkerOptions.workerSrc` 指向 `pdf/pdf.worker.min.js`；`getDocument()` 额外指定 `cMapUrl: pdf/cmaps/`、`standardFontDataUrl: pdf/standard_fonts/`，因此中日韩字符与标准字体（Helvetica → LiberationSans）都能正常出字，`useSystemFonts:false` 保证不依赖系统字体、也不联网。
- `renderPage()` 按 `min(2, devicePixelRatio)` 放大 canvas backing store、`alpha:false` 先填纯白底，再 `page.render()`；`getPageSize()` 取 scale=1 的页面原始尺寸供自适应计算。查看器改为**连续滚动布局**：`.pdf-scroll` 纵向滚动容器内 `.pdf-pages` 把所有页垂直堆叠（`.pdf-page` 白底、页间 10px 缝、宽度自适应容器），每页按 `pageWidth()*zoom/sizes[p].width` 单独渲染；`renderVisible()` 只渲染视口前后约两屏内的页（懒渲染，未进入视口的页保留空 canvas），滚动时 `updateActive()` 按 `scrollTop` 更新顶部「当前页 / 总数」。顶部页码按钮点击弹 `promptDialog` 跳页，底部保留上一页 / 下一页（无底部缩放控件）。交互为**双指 pinch 缩放（touchmove 里算好 `pinchFactor`，CSS `scale()` 即时预览；touchend 用该倍率调 `applyZoom()` 重绘清晰版，不再解析 transform 字符串）、单指原生滚动跨页、双击切 1x/2x、桌面 Ctrl/⌘+滚轮缩放**；`applyZoom()` 维持滚动位置比例并 clamp 到 1–4；横竖屏切换 200ms 防抖重新适配；关闭时 `doc.destroy()` 并移除 resize 监听。

### 10.3 离线保证（两种形态）

| 形态 | 资源来源 | 缓存策略 |
| --- | --- | --- |
| 浏览器 / PWA | 站点静态文件 | `sw.js` 的 `CACHE = 'cuotiben-v25'` 预缓存 `js/pdf.js` + `PDF_ASSETS`（`pdf/pdf.min.js`、`pdf/pdf.worker.min.js`）；168 个 cmaps 与 16 个标准字体由 fetch handler 按需写入缓存（实测 `cuotiben-v25` 共 48 entries） |
| Android APK | `assets/www/pdf/**` | 原生壳不注册 SW，`shouldInterceptRequest` 把 `https://cuotiben.local/pdf/**` 直接映射到 APK assets；`build_apk.py` 与 `build.gradle` 均把 `pdf/` 纳入拷贝 / 同步 |

### 10.4 打包注意

- `pdf/pdf.worker.min.js` 为 1,087,212 B（唯一 >1 MB 的 PDF 资源），因扩展名是 `.js`，已被 `aapt2 link -0 js` 与 `androidResources.noCompress 'js'` 覆盖为 **STORED**；否则 `AssetManager.open()` 会触发 `UNCOMPRESS_DATA_MAX`（约 1 MB）限制。
- `cmaps/*.bcmap` 与 `standard_fonts/*.ttf/.pfb` 均 < 1 MB，按默认压缩入包即可；原生 `mimeOf()` 对它们回落到 `application/octet-stream`，PDF.js 用 `fetch` 取 `ArrayBuffer`，不受影响。
- 手工构建链 `copy_web_assets()` 的目录白名单、Gradle `syncWebAssets` 的 `include 'pdf/**'` 缺一不可：少了任何一个，对应 APK 里就没有 PDF.js 资源，查看器会报「无法加载 PDF 渲染引擎」。

### 10.5 实测记录

- 浏览器：导入 593 B 的一页 PDF → 库出现 1 行 → viewer 顶部「1 / 1」、canvas 448×280、像素采样有墨迹 → 双指缩放 / 双击复位 / 连续滚动跨页 / 点页码跳页 → 删除二次确认后回到空态；`caches.keys()` = `cuotiben-v25`。
- Android 模拟器（AVD `Medium_Phone_API_37.0`，Chrome/145 WebView CDP）：`location.href = https://cuotiben.local/`、`Pdf.checkResources()` 两个 JS 均 `ok:true`；导入 599 B PDF 后 `DB.getAllPdfs()` 1 条、库自动刷新；viewer canvas 896×560、扫描出 **6014 个墨迹像素、bbox [88,212,576,252]**，等于真实渲染出 `Hello Cuotiben PDF`；备份目录改 `Download/CDP验证目录` 后 DB 与 DOM 同步更新、改回默认值亦生效；设置页无「批量导入错题」、关于含 `chen5`。
- 截图：`shot-pdf-home-emu.png`、`shot-pdf-library-emu.png`、`shot-pdf-viewer-emu.png`（`E:\Vibecoding\ctb\screenshots\`）。
- 注意：CDP 的 `Page.captureScreenshot` 在本 WebView 上抓不到加速 2D canvas 图层，所以上述真机截图用 `adb shell screencap` 取真实帧缓冲；canvas 本身的内容用 `canvas.toDataURL()` 校验。

> PDF 资料**不进入备份 ZIP**（备份包按需求只含错题 + 图片）；换机或重装请重新导入 PDF 原文件。
