# NX10 建模踩坑清单（实测记录，别再重复试）

> 每条都是真跑 journal 得到的结论。遇到同类需求直接跳到"绕行"，别在原 API 上耗。

## 1. 螺纹孔 HolePackageBuilder —— 走不通，用圆柱代替
- `HolePackageBuilder.Types.ThreadedHole` + `ThreadStandard="Metric"` + `ThreadSize="M6"`
  设置都合法，但 `CommitFeature()` 报 `NXException: Missing target body`。
- `HolePosition` 是 **READ-ONLY**（不能 `hb.HolePosition = sec`），
  要用 `hb.HolePosition.AddToSection(...)` 定位；即便定位对了，仍报缺目标体。
- 连续 2 轮不同写法都失败 → **绕行：用圆柱布尔减做底孔**。
  - M6 → ?5 光孔；M10 → ?8.5 光孔。
  - 只是没有装饰螺纹线，外形尺寸完全对。

## 2. 导出 STEP —— Commit 成功但文件不落盘，别用来读几何
- `s.DexManager.CreateStep214Creator()`，设 `ExportFrom=ExistingPart`、
  `InputFile`、`OutputFile`，`Commit()` 返回成功、无异常，**但输出文件不存在**。
- 试过 `FileSaveFlag=True/False` 都一样。
- 绕行：**读几何用 Expressions / Features / Sketches**（见 api-notes.md），不要指望 STEP。

## 3. 草图轮廓拉伸 —— 容易 self intersecting
- 从别处 dump 出的 Line/Arc 直接重画再拉伸，常报：
  `Selected objects will result in a self intersecting section`。
- 原因：弧的起止角（弧度）方向、曲线首尾相接顺序，跟 API 约定不一致就会自交。
- 绕行优先级：
  1. **能用基本体（block/cylinder + 布尔）拼出来的，别用草图轮廓。**
     耳、槽、缺口、台阶全都能用圆柱/方块布尔搞定（本项目的底座就是这么建的）。
  2. 真要轮廓：按**端点首尾相接**重排曲线，再逐条核对弧的 start/end 方向，别靠角度猜。

## 4. Point3d 是值类型
- `If p IsNot Nothing` → 编译错 "IsNot requires reference-type operand"。
- 直接用坐标比较判断，别判空。

## 5. NewDisplay 不能覆盖同名文件
- 目标 .prt 存在时 `NewDisplay` 抛 `File already exists`。
- 脚本开头先 `Remove-Item -Force` 删掉旧 prt。

## 6. NX 会锁住打开的 .prt
- ugraf 打开着该零件时，覆盖/删除会失败。
- 先 `Stop-Process -Name ugraf -Force`，等 1-2 秒，再操作。

## 7. 圆弧边采样不到极值（验证脚本的坑）
- 用"遍历 Edge 端点求包围盒"自检时，圆弧边的端点取不到极值，
  会出现 DX/DY 明显偏小（如 ?12 球报 DX=7.9）。
- 想准确验尺寸：优先验**直角边**，或直接读表达式/已知尺寸，别只信包围盒。

## 8. run_journal 输出被 PowerShell 包成 NativeCommandError
- stderr 会被当成报错显示，但正文（Compilation failed: Line N / Runtime error / NXException）
  照读即可。成功时打印 `Execution was successful.`。