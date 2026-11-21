# 墙面照片更新、SAM2 标注与审核操作手册

本文记录 Stoneham 的实际更新方法，让下一次更新可以沿用同样的判断和产物，
也方便其他维护者接手。流程概览见 [wall-update-workflow.md](wall-update-workflow.md)，
正式发布和线路兼容逻辑见 [wall-publication.md](wall-publication.md)。

**原图 → 核对上一版 → 配准与拼接 → 新旧对比 → 全部旧点重跑 SAM2 →
补充新增点 → 身份与边界审核 → 查缺补漏 → 回放验证与归档 → 发布。**

截至 2026-11-21，正式站仍是 **v8 / 801 点**；本次 **v9 / 852 点**是已经完成
assistant 审核的候选，尚未发布。以后更新时应重新核对当时的正式版本，
不要把这里的日期、版本号、数量或参数直接当成最新状态。

快速定位：[工具与目录](#2-环境目录和工具边界) ·
[配准](#4-先做单张配准再拼图) · [拼接与接缝](#5-拼接接缝与旧图补边) ·
[SAM2 旧点刷新](#7-所有旧点重跑-sam220-inset) · [新增点搜索](#8-发现并补充新点) ·
[审核规则](#9-审核先判断身份再判断边界) ·
[审核页面与进度](#10-人工审核和-assistant-审核如何落地) ·
[验证归档](#11-查缺补漏验证与归档) · [问题速查](#13-常见问题速查)。

## 1. 先分清各类数据

| 数据 | 作用 | 能否直接作为正式墙面 |
| --- | --- | --- |
| 原始照片 | 观察现实中的墙，保留全分辨率和 EXIF | 否 |
| 配准后的候选图 | 下一轮标注的坐标基准 | 否 |
| 上一版已发布 hold map | 提供位置提示和旧 ID | 不能自动继承本轮审核状态 |
| SAM2 proposals | 待审核的边界建议，含分数和关联 | 否 |
| Review checkpoint | 针对这一张图的逐条审核决定和历史 | 验证后可提取候选几何 |
| Reviewed geometry | 从通过回放验证的 checkpoint 提取的点位 | 仍需独立发布流程 |
| 已发布 image/map/catalog | 网站和线路兼容判断所用的版本 | 是 |

关键区别：**边界、物理身份和发布状态是三件事。**
同一个旧点可以因为拍摄角度不同而需要新边界，但保留原 ID；同一个位置换了
另一个点，即使 SAM2 分数很高，也需要新 ID。导出审核结果不会发布墙面。

## 2. 环境、目录和工具边界

### 2.1 所需环境

图像处理使用 Python、OpenCV、NumPy、Pillow、SciPy；SAM2 使用含 PyTorch 和
官方 SAM2 包的 Python 环境。安装方式和模型校验见
[SAM2 环境说明](sam2-top-left-experiment.md#reproduce-python-312-tested)。

当前批处理使用 **SAM2.1 Small**：

- 配置：`configs/sam2.1/sam2.1_hiera_s.yaml`。
- 权重：`sam2.1_hiera_small.pt`。
- 权重 SHA-256：`6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`。
- 可以在 CPU 上运行；记录实际设备、线程数、软件版本、随机种子和耗时。
- 审核回放使用能直接运行本项目 TypeScript 的 Node 环境。

### 2.2 工作目录

先在生产目录以外处理，建议每次独立建目录：

```text
wall-update-YYYY-MM-DD/
  originals/                  # 原图，只读保留
  originals-manifest.json     # 名称、大小、尺寸、SHA-256
  reference.jpg               # 当前已发布墙图
  reference-holds.json        # 与该图对应的已发布 hold map
  registration/               # 匹配点、H 矩阵、残差、局部修正场
  image-r1/                   # 第一版拼接图、coverage/source index
  image-r2/                   # 如需修订，另开目录
  comparisons/                # GIF、分区对比、疑点裁剪图
  sam2-inherited/             # 全部旧点的原始建议
  sam2-new/                   # 新位置提示及原始建议
  review-bundle/              # 不可变的本轮审核 baseline
  reviewed/                   # checkpoint、提取几何、summary、QA
```

不要覆盖已交给审核者使用的图片、baseline 或 checkpoint。
如果图片或输入证据改变，创建新候选和对应 session；不能直接套用旧 session 的批准。

### 2.3 哪些已经是工具，哪些还不是

| 部分 | 入口 | 当前性质 |
| --- | --- | --- |
| 特征匹配、拼接和轮廓辅助 | `tools/wall_rescan/` | 可复用模块；具体入口需看参数 |
| 全部旧点 SAM2 刷新 | `python -m tools.wall_rescan.sam2_refresh` | 可参数化 CLI |
| 打包审核 baseline | `python -m tools.wall_rescan.candidate_review` | 可参数化 CLI |
| 人工审核与交互 SAM2 | `tools/sam2_annotation_server.py`、现有审核 UI | 可复用 |
| 审核决定与历史回放 | `src/wallReview.ts`、`src/wallProposals.ts` | 可复用 API |
| v9 配准、拼接、新点搜索、局部重跑、手工修正和归档 | [v9 pipeline/](../reviews/2026-11-v9-assistant-reviewed/pipeline/) | 本次运行脚本，含日期、绝对路径、区域和照片数量等常量 |

**目前还不是从任意 Drive 文件夹一键发布的流水线。** v9 脚本保留的是实际
算法和运行记录。复用前复制到新工作目录，检查全部路径、参考版本、照片数量、
排除区域及输出名；部分脚本还依赖当次工作目录中的中间文件。
不能按文件名排序后全部执行，也不能不改常量就处理下一批照片。

## 3. 下载原图并确认参考版本

1. 从用户提供的文件夹列出文件，确认数量、名称、类型、大小，再下载原始文件。
   不要使用聊天缩略图、Drive 预览截图或浏览器压缩图代替原图。
2. 为每张原图记录 SHA-256、文件字节数、原始尺寸和来源身份。原文件不改写。
3. 从 `src/wallVersions.ts` 和对应的版本 manifest 找到当前墙；同时核对 backend
   catalog。准备开始时，验证站上实际图片与本地参考图的 hash 是否一致。
4. 复制该版本**已经发布的**图片和 hold map，记录版本、hash、尺寸、点数。
   如果发布时做过 ID 修正，应使用修正后的已发布 map，不能倒回原始审核导出。
5. 创建新的 candidate version/scan ID，保留参考版本和源照片的关联。

例如 v8 发布时为两个替换点分配过新 ID，所以 v9 的参考是
`src/data/walls/2026-11-v8/holds.json`，而不是未经发布修正的 v8 原始 checkpoint。

读取照片时对工作副本做 `ImageOps.exif_transpose`，然后转为 RGB。
匹配、warp、提示点坐标必须对应同一方向；原始 EXIF 文件继续保留。

当前标准画布为 **7292 × 5514**，坐标从左上角开始。hold polygon 使用 `[0,1]`
归一化坐标：`x = u × width`、`y = v × height`。裁剪、缩放或换 EXIF 方向后，
必须同步换算坐标，不能只凭“画面看起来差不多”套旧 polygon。

## 4. 先做单张配准，再拼图

### 4.1 全局配准

每张新照片直接对齐上一版墙图，不只对齐相邻新照片，避免沿拼接链积累漂移。
v9 的实际实现可参考 [register_compare.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/register_compare.py)。

本次使用的参数示例：

- SIFT 特征匹配：匹配工作尺寸最长边 2600，最多 30000 个特征。
- `matches` 使用 Lowe ratio 0.75 和互相匹配检查；本次选择 FLANN matcher。
- 用 `cv2.findHomography(..., cv2.USAC_MAGSAC, 18, maxIters=10000,
  confidence=.999)` 估计照片到参考图的 H；这里的 18 是本次原生画布像素阈值。
- 保存 source/reference 对应点、inlier 标记、矩阵和每张照片的覆盖图。
- 输出 inlier 数、原生像素下残差的中位数/P95，以及覆盖比例。

参数是起点，不是通过标准。需要检查匹配点是否分布在整张可见墙面上；
只在一个小区域匹配得很好，不能证明其余区域准确。
如果特征不足或整体对不齐，先检查方向、清晰度、重叠与参考图；
必要时用明确静态地标或补拍，不要靠放宽阈值掩盖错误。

### 4.2 有界局部修正

墙面、凸出的 holds 和倾斜的 kickboard 不在同一平面，单个 H 不能消除全部视差。
全局配准后，允许用**确认静止的墙面特征**拟合平滑、有限幅度的残差修正。

v9 的 [build_candidate.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/build_candidate.py)
采用：

1. 从修正拟合中排除旧 hold 多边形及其邻域，并排除变化疑点区域。
2. 将保留的对应点固定随机划分为约 80% 拟合、20% 检查。
3. 用散点插值拟合残差场，在 731 × 553 网格平滑，并将位移限制在
   **12 个原生像素以内**。
4. 在留出的检查点上比较修正前后的中位数与 P95；本次只在两者符合脚本条件时启用，
   否则退回零局部修正。
5. 保存场、H、拟合/检查点数、误差统计和启用状态，供最终逆采样使用。

这套留出检查仍来自图像特征匹配，不等于独立测量精度。
**不能用移动过的点拟合变形，把真实移动“拉回旧位置”。**
后续审核发现原先未知的变化落在拟合区域时，应重新评估修正是否受其影响。

## 5. 拼接、接缝与旧图补边

### 5.1 选照片来源，尽量保持整个点完整

v9 在约 1800 像素宽的工作图上选接缝，再用原图渲染原生尺寸：

- 先使用 graph-cut 的颜色/梯度接缝，选择每个像素来自哪张照片。
- 结合到照片边缘的距离、局部清晰度和配准误差评价可选来源。
- 对完整 hold 或相邻 hold 群做来源保护，尽量让轮廓和周围一小圈来自同一张照片。
- 已知变化区域也尽量取自单张完整覆盖的照片。
- 曝光匹配仅使用稳定区域，RGB gain 有上下界；v9 示例范围为 0.85–1.18。
- 按保存的 H 和局部场从原图逆采样；尽量在几何和选源完成后才编码最终 JPEG，
  避免反复放大、缩小和有损重存。

不要把错位的两个 hold 轮廓直接平均混合。那会生成现实中不存在的双边缘，
随后 SAM2 可能把双影、影子或半个点当成实体。

### 5.2 Kickboard 要单独检查

v9 第一版出现过这种情况：旧 polygon 内取照片 A，外面取照片 B；
由于脚点视差比保护区域大，同一个点被切成两部分，甚至变成细条。
这是拼图问题，不能靠修改 polygon 把它“审核通过”。

本次修正为底部使用连续的单照片区域，接缝放在脚点之间的空白。
当次参数是 `y >= 0.925`，按 `x = 0.35 / 0.68` 分成三段；
**这些值只适用于这三张照片，下一次必须重新选。**
对比证据见 [kickboard-seam-fix.jpg](../reviews/2026-11-v9-assistant-reviewed/evidence/kickboard-seam-fix.jpg)。

每次检查墙折线、底部脚点、凸出 volume 和照片边缘。
如果改了拼接图，应重新绑定候选证据并重跑对应标注流程；不要把旧图上的审核直接继承过来。

### 5.3 补边必须留证据

新照片未覆盖的空白边缘可以用上一版补齐视觉画布，但同时保留：

| 文件 | 含义 |
| --- | --- |
| `wall.jpg` | 精确的候选照片，不含标注线 |
| `coverage.png` | 实际新照片采样到的像素；旧图补边为 0 |
| `source-index.png` | 新照片来源编号；0 表示上一版补边 |
| `uncertainty.png` | 本轮的接缝/跨来源/缺覆盖等证据标记 |
| composition manifest、alignment 文件 | 来源 hash、矩阵、局部场、选源与覆盖统计 |

不能把补边改标为“新照片已观察”。整幅覆盖率也不能代替每个 hold 的覆盖率。
v9 整幅新覆盖约 98.72%，但所有审核后 hold polygon 的新覆盖都是 100%。
有 hold 落在缺覆盖区时，保留疑点并补拍或明确记录覆盖限制，不能据此判定拆除。

## 6. 输出对比图，冻结本轮候选

至少输出清晰预览、整墙切换 GIF，以及变化区/底部的放大对比。
新旧图保持相同画布、缩放和裁剪；GIF 两帧用**同一个调色板**，减少色闪。
v9 使用约 2000 像素预览、1800 像素整墙 GIF，以及九个有重叠的 old/new 分区。

先检查大范围错位、接缝切点、重复影像、局部模糊、曝光跳变和旧图补边范围。
图片本身有问题时先修图，再做最终标注。

图片稳定后，生成 `stoneham-wall-candidate-v1` manifest。具体字段参考
[v9 candidate manifest](../reviews/2026-11-v9-assistant-reviewed/candidate-manifest.json)
和 [prepare_sam2_candidate_r2.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/prepare_sam2_candidate_r2.py)。
它绑定候选版本、参考版本、画布、原图来源、参考 image/map hash、候选 image/mask
hash 和 source session，初始状态为 `candidate-needs-review`、`publishable: false`。

接缝与缺覆盖的位标记不是可以随意删除的“报错”。v9 使用 1 标记接缝、8 标记
旧轮廓内跨来源、16 标记未观察区域；其他工具可能还有别的位。
应按生成器和消费者的实际定义解释，不能把这个例子当成统一的二值风险图。

## 7. 所有旧点重跑 SAM2：20% inset

使用上一版**已发布 map 的每一个点**作为未审核提示，包括脚点、大小点及 volume。
不要因为它看起来没变就跳过；同一个点在新拍摄角度下，投影轮廓也可能改变。

当前可复用命令如下，路径需替换成这次的实际文件，且使用含 SAM2 的 Python：

```sh
python -m tools.wall_rescan.sam2_refresh \
  --version-manifest /path/to/candidate-manifest.json \
  --old-holds /path/to/published-reference-holds.json \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --prompt-inset .2 \
  --threads 2 \
  --output /path/to/new-empty-inherited-output
```

20% 的含义是**线性缩放到 0.8 倍**，不是面积减少 20%，也不是最终边界向内缩。
`inset_prompt_for` 的处理是：

1. 将旧 polygon 栅格化，选择安全的缩放中心；凹形的质心落在外面时改用内部点。
2. 线性缩放 0.8，并与原 mask 相交，避免凹形缩放后跑到原轮廓外。
3. 在收缩区域中取内部正点，最多五个，避免只靠可能落在螺栓孔里的几何中心。
4. 保留基于旧外轮廓、带少量 padding 的 box 和周围图像上下文。
5. 让 SAM2 长回真实可见边缘；不把最终 mask 裁到 inset 区域。

批处理按 3 × 3 区域缓存 embedding，区域边缘有上下文重叠。
输出记录每个旧 ID 的提示、候选关联、模型分数、旧新 IoU、面积比、中心漂移、
观察覆盖及不确定证据，并保留未成功的项。去重只针对 proposals，不应把同一
mask 关联到多个旧 ID 的事实隐藏掉。

默认只提示旧区域覆盖达到 99% 的项。若确实需要给部分覆盖位置也生成草稿，
可显式加 `--include-partial`；它不会改变 coverage、认可缺失或自动批准结果。
运行结束应核对旧点总数、实际 prompt 数、失败数和去重关联，不能只看成功 mask 数。

## 8. 发现并补充新点

旧 polygon 提示只能更新旧位置，**不会自动找到整墙所有新点**。
必须另外检查旧轮廓之间、墙边、稀疏脚点区、volume 上的小点，以及新位置。

### 8.1 差异筛查

v9 做了两种辅助筛查：

- **旧点外观排名**：在多张对齐照片上比较旧点核心区域，做局部模板搜索来容忍
  小位移，再综合 Lab 色差和相关性排序，优先复查高差异旧点。
- **旧轮廓外的新颜色区域**：把旧 polygon 及其邻域排除，比较新旧 Lab 色度差，
  结合新图饱和度，做形态学闭运算和连通域分析，生成带编号的候选裁剪图。

当次第二种方法在 3600 像素宽图上使用了色度差 >12、饱和度 >45 等阈值；
这些是候选搜索参数，随画质、曝光和颜色调整，不是 hold 存在性的判据。
具体实现见 [score_holds.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/score_holds.py)
和 [find_new_holds.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/find_new_holds.py)。

色差会被粉痕、阴影、灯光和视角影响；白点、黑点或与旧物颜色相近的新点也容易
被漏掉。**排名低不代表未变化，残差少也不代表没有新点。** 九区全图对照和空隙检查仍然需要做。

### 8.2 从候选变成独立提示

逐个看 old/new 裁剪图，将候选判为新增点、旧点外观变化、墙面设施/阴影或待确认。
一个连通域可能含多个 hold：v9 的一组橙色残差实际包含三个新点，必须拆成三条提示。
相反，同一个点的多块残差也不能算多个新增点。

为确认的新位置建立临时 hint：独立 ID、中心、粗 polygon/box 和证据编号，
再单独跑 SAM2。新位置先使用 proposal ID；审核确认时再创建新的正式候选 hold ID，
绝不能为了方便借用附近旧 ID。

## 9. 审核：先判断身份，再判断边界

### 9.1 物理身份规则

| 观察结果 | ID 和动作 |
| --- | --- |
| 同一 hold 仍在原处，仅投影/轮廓变化 | 保留旧 ID，refine 边界 |
| 同一 hold 且旧轮廓在新图上确实仍准确 | 可 confirm unchanged |
| 旧位置有充分新照片证据显示点已拆除 | remove 旧 ID |
| 同位置换了不同 hold | replace：移除旧身份并添加新 ID |
| hold 移到另一位置 | 通常按旧位置移除、新位置新 ID 处理，并明确记录判断 |
| 原来空白处新增 hold | add 新 ID |
| 缺覆盖、遮挡或身份无法确认 | 保留 pending/疑点，补证据 |

比较形状、颜色、纹理、孔位、螺栓位置、朝向和周围点的关系。
不能仅凭“中心差不多”“颜色一样”或“模型 0.97 分”保留身份。
ID 判断会直接决定旧线路是否仍有效，位置相近的替换点不能继承兼容性。

### 9.2 边界逐项检查

对比 old/new/overlay，重点查：

- 是否包含墙面、投影、邻近 hold 或外部螺栓，而不是真实点体。
- 是否只分出了螺栓孔或一个面，遗漏侧面/另一部分。
- 小点是否被识别成承载它的整块 volume。
- 两个点是否共用一个 mask；一个点是否生成了重复条目。
- 细长、凹形和白色点的轮廓，以及边缘/底部的位移。
- 轮廓不佳是否其实源自拼接切点；若是，返回图像阶段修复。

分数、IoU、面积比、漂移用于安排复查顺序。旧新 IoU 很低可能来自 kickboard
视差，不能直接判定替换；高 IoU 也不能证明同一个物理 hold。

### 9.3 局部重跑和手动修正

如果整墙 tile 把小点缩得过小，裁出包含周围上下文的原生分辨率区域重新跑。
在可见点体内部给正点，在误包含的邻点或墙面给负点，调整 box，检查返回结果。
v9 尝试过约 420–440 像素量级的局部 crop；尺寸要随 hold 大小和上下文调整。

注意两类失败：粗矩形 hint 的“内部点”可能实际落在背景；把白色点误归为暗色物体，
可能只选中黑色螺栓孔。点与框都要以真实照片核对。

**局部重跑不保证更好。** v9 的部分新点局部结果反而多圈进阴影或邻点，因此保留
这些试验作为证据，没有直接覆盖原始建议；最终对 11 个新增边界和 2 个脚点边界
做了显式多边形修正。修正时保留裁剪范围、裁剪坐标、换算后的归一化顶点和理由。
当前几何校验要求每个 polygon 有 3–16 个归一化顶点且不自交；最终轮廓不能沿用调试缩略图坐标。

## 10. 人工审核和 assistant 审核如何落地

### 10.1 生成不可变 baseline

先将最终选定的原始 proposals 合并成与候选 manifest 匹配的文件，保留每次运行来源，
再用可复用 CLI 打包。以下命令用于用户明确委托 assistant 审核的场景；
人工审核省略 `--reviewer-kind assistant`，默认是 human。

```sh
python -m tools.wall_rescan.candidate_review \
  --manifest /path/to/candidate-manifest.json \
  --proposals /path/to/final-sam2-proposals.json \
  --old-holds /path/to/published-reference-holds.json \
  --reference /path/to/reference.jpg \
  --reviewer-kind assistant \
  --output /path/to/new-empty-review-bundle
```

该步骤校验输入 hash 和关联，生成新的审核 session、pending 队列、旧几何和原始建议。
**生成 bundle 本身不批准任何点。** baseline 后续不改写，决定放到 checkpoint 中。

### 10.2 人工审核页面

使用含 SAM2 的 Python，在 repo 根目录构建并启动同源服务：

```sh
npm ci
npm run build
python tools/sam2_annotation_server.py \
  --rescan-session /path/to/review-bundle \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --port 8790
```

打开 `http://127.0.0.1:8790/?review=1`，选择 **Open local server scan**。
只需已存建议和手工编辑时，可用 `--review-only` 代替 `--checkpoint ...`。
远程 HTTPS 服务的访问密钥与续期操作见 [review server setup](wall-v5-review-server.md)。
不要把未鉴权的推理服务直接暴露到公网，也不要提交临时访问链接或密钥。

墙图下的五个常用操作为 **Next pending hold / Confirm / Mark removed /
Mark replaced / Generate mask**。Next 加载已存建议，不会自动确认；生成 mask
也不等于保存决定。对比模式下先观察，返回新图编辑模式再记录决定。

批量确认仅用于显式选择的合格旧点：当前实现要求覆盖充分、关联唯一、没有相关
不确定证据且 recommendation 合格。新增点和已知变化要单独检查，不能单凭分数批量放行。
单条确认允许明确记录部分覆盖；bulk 仍要求至少 99%，remove/replace 也有覆盖门槛。
这些操作不会修改真实 coverage 证据。

### 10.3 Assistant 审核记录

只有用户明确要求 assistant 代审时才采用此身份；不能把模型输出伪装为人工批准。
先完成上面的照片/身份/轮廓检查，然后通过真实审核 API 记录动作，例如：

```ts
const next = applyReview(
  current,
  { type: 'refine', id: oldId, hold: correctedHold },
  'Codex (assistant visual review)',
  new Date().toISOString(),
  'assistant',
)
validateProgress(next, baseline)
```

`applyReview` 在 `src/wallReview.ts` 中。新增使用 `add`，替换使用带 `replaces`
的 `add`，以保持原子历史和 ID 关系。不要只改 JSON 中的 status，也不要给所有点
机械写入 confirm 来代替查看照片。每个动作有 reviewer、reviewerKind、时间、
before/after 和 revision；未解决的项继续 pending。

已有人工 checkpoint 保持兼容。人工可以在支持此字段的编辑器中接着修改 assistant
checkpoint，后续决定会保留先前 assistant 的历史。具体调用与本次决定清单见
[v9 review archive](../reviews/2026-11-v9-assistant-reviewed/README.md)。

### 10.4 进度存在哪里

**人工审核决定当前保存在浏览器 IndexedDB，不保存在 Python/SAM2 server。**
`localStorage` 是旧版迁移来源，不是主存储。曾出现的 `QuotaExceededError` 是浏览器
存储配额问题，不能据此认定是 Vercel 免费版限制。

定期使用 **Session, reviewer & backups → Export progress**。
更换设备、浏览器或临时域名时，可能需要重新导入导出文件；保留同一 origin、同一
bundle/session 有助于恢复进度，但不能保证跨域自动恢复。服务过期只影响页面/推理可用性，
不代表能从服务端取回浏览器的最后决定。

续期时恢复精确的图片和 baseline，导入对应 checkpoint，验证 session/image hash。
不能把原始 pending 队列或隔离浏览器测试产生的决定当成用户已完成的审核。

## 11. 查缺补漏、验证与归档

### 11.1 最后一轮完整检查

按有重叠的分区重新扫整墙，检查全部轮廓以及它们之间的空隙，尤其是底部和边缘。
再看一遍只显示新增点的视图，并逐个查看拆除/替换项。

数据检查至少包含：

- pending 和未解决身份疑点数；新位置是否都得到明确决定。
- 活跃 hold 数、ID 唯一性、旧 ID 保留/移除集合、新 ID 集合。
- 归一化范围、3–16 顶点、自交、面积及异常中心/面积变化。
- 同一实体重复 polygon、误合并，以及每个最终 polygon 的真实新照片覆盖。
- 嵌在 volume 上的小点可以与大点轮廓包含，不能把“包含”一律当成重复。
- 所有决定是否属于同一份精确 image/baseline/proposal 证据。

### 11.2 回放而不是相信最终状态

用 `initializeReview` 从不可变 baseline 初始化，再用 `validateProposals` 检查建议、
`validateProgress` 回放每条决定。提取 `verified-unchanged`、`verified-refined`、
`new` 状态的活跃几何，
比较其与 `confirmed-geometry.json` 是否完全一致。校验 checkpoint 原始字节的 SHA-256。

v9 的真实归档验证命令为：

```sh
node reviews/2026-11-v9-assistant-reviewed/validate.mjs
```

这个 validator 还验证了本次固定数量和 reviewer，因此是 **v9 专用验证器**。
下一次应沿用检查逻辑，更新版本、预期数量和来源，不能修改 v9 记录让它替其他版本背书。

### 11.3 归档内容

将精确候选图、candidate/composition manifest、coverage/uncertainty/source index、
alignment、原图 hash、immutable baseline、原始模型试验、最终 checkpoint、
回放提取几何、逐项修正、summary、几何 QA、对比证据与 validator 一起归档。
使用 archive manifest 为文件记录 hash/字节数；不改写用户原始导出。
临时图片和运行结果尽量在确定后再提交到版本化候选目录。

Reviewer 的名字只是历史归属，不能代替 session/image 校验或发布权限。
正式提取的候选仍保持 `publishable: false`，直到单独完成发布流程。

### 11.4 编辑包与只读预览

- **可编辑 review bundle**：原始 manifest、prelabels、queue、report、精确
  `wall_registered.jpg`、coverage/uncertainty、proposals、reference image/map，
  以及用于恢复的 `review-progress.json`。用户解压后用匹配版本的编辑器导入。
- **只读预览**：展示新旧图、最终轮廓、只看新增和逐点浏览。只读页不用启动 SAM2，
  也不会写入数据库。v9 的示例为 `/wall/candidates/2026-11-v9/index.html`。

预览部署有 Vercel 保护时，使用现有授权生成临时分享链接；不为打开预览关闭项目保护。
分享链接过期与审核包丢失是不同问题，归档和离线导出应独立保留。
发布前检查手机与桌面上的图像加载、切换、轮廓数量、筛选、逐点定位、恢复全墙及 JS 错误；
生成编辑包时，还应验证它包含与 checkpoint 匹配的精确文件。

## 12. 发布交接与线路影响

审核完成后先汇报：候选图、对比图、总点数、保留/新增/移除/替换数量、疑点、
覆盖限制、验证结果和归档位置。按用户的发布指令接续
[wall-publication.md](wall-publication.md)；本手册中的检查命令不执行生产发布。

线路兼容只看 **全部 hold ID 是否存在**，包括 Start、Finish 和 foot-only。
有新图不等于已更新数据库。可先做只读影响分析，但公开列表可能不含全部记录，
不能用它替代正式发布时对数据库所有分页的兼容扫描。

发布要注册不可变的 image/map，协调 frontend/backend catalog，部署 backend，
执行 dry-run 和实际 compatibility sweep，再发布 frontend 并验证历史线路与 Upgrade。
兼容线路增加 `supportedWallVersionIds`；不兼容线路标记 Outdated。
保留线路 ID、作者、内容、角色、评论、评分和 sends，以及历史 image/map。

## 13. 常见问题速查

| 现象 | 优先检查 | 处理 |
| --- | --- | --- |
| 某个点有双边缘、被切半或变细条 | 源照片视差、接缝、过小的旧轮廓保护范围 | 改选源/接缝，特别检查 kickboard；不要只改标注 |
| 所有点整体错位 | EXIF、画布、参考版本、裁剪/缩放 | 修正坐标链，再生成候选 |
| 单个高分 mask 包住邻点或整块 volume | 小点分辨率、正点是否落在背景、共享 proposal | 局部 crop、负点、分开重跑或显式手工修正 |
| 白色点只剩螺栓孔 | 提示落在孔中、颜色/亮度启发式选错对象 | 把正点放到点体、检查完整侧面，必要时手工画 |
| 没有 usable mask | 提示偏移、阈值、覆盖、分辨率 | 保留 pending 并复查；不是拆点证据 |
| 残差很多但 hold 似乎没变 | 粉痕、曝光、阴影、视角 | 多张原图和纹理/孔位对照，避免误换 ID |
| 自动新点搜索漏了白点/黑点 | 色差筛查的局限 | 分区人工/assistant 全图检查，补独立 hint |
| 覆盖不足却想确认一个可辨认的点 | 真正观察到的区域及该动作覆盖规则 | 记录明确的单条决定和限制，不伪造 coverage、不批量放行拆除 |
| 页面出现 QuotaExceededError | 浏览器存储、旧 localStorage 版本 | 导出备份，使用 IndexedDB 版本；不是 Vercel 存储套餐判断依据 |
| Sandbox 过期、SAM2 报 410 | 推理服务和域名状态 | 恢复同一 bundle，检查连接/导入 checkpoint；别清空审核历史 |
| 改了图后想直接套上次批准 | image/session 证据已变化 | 新 session，旧几何只能当未审核提示 |

## 14. v9 实例与复用顺序

本次实例的详细产物见 [v9 README](../reviews/2026-11-v9-assistant-reviewed/README.md)：
三张原图、801 个旧点提示、51 个新增点、854 个 assistant 决定、852 个活跃点、
零 pending、全体最终 polygon 新覆盖 100%，尚未发布。

复用时按**依赖关系**阅读脚本：

| 阶段 | v9 实现/产物 |
| --- | --- |
| 全局配准 | `pipeline/register_compare.py` |
| 旧点外观差异 | `pipeline/score_holds.py` |
| 配准修正、选源、原生渲染 | `pipeline/build_candidate.py` |
| 底部拼接修订 | `pipeline/fix_kickboard.py` |
| 候选证据和 session manifest | `pipeline/prepare_sam2_candidate_r2.py` |
| 整墙旧点刷新 | 公共 CLI `tools.wall_rescan.sam2_refresh`；原始输出在 `inference/` |
| 新位置候选和独立 SAM2 | `pipeline/find_new_holds.py`、`pipeline/run_new_sam2_r2.py`、`new-location-hints.json` |
| 局部试验、漏点和嵌套小点处理 | `pipeline/refine_new_*.py`、`pipeline/fix_inherited_*.py` |
| 人工指定的轮廓修正 | `assistant-boundary-corrections.json`、`assistant-foot-corrections.json` |
| 建立动作清单、写审核历史 | `pipeline/assemble_final_model.py`、`pipeline/record_assistant_review.mjs` |
| 最终覆盖/重复 QA、归档 | `pipeline/archive_candidate.py`、`geometry-qa.json`、`archive-manifest.json` |
| 只读预览和编辑包 | `pipeline/make_candidate_viewer.py`、`pipeline/package_review.py` |
| 历史回放与 hash 验证 | `validate.mjs` |

不要把 v9 的手工顶点、区域划分或确认结论当成下一轮的默认值。
真正要复用的是：**保持坐标与来源可追溯、让模型建议和审核决定分开、逐个核对物理身份，
并让下一位维护者能够从原始证据回放到最终结果。**
