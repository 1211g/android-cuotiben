# -*- coding: utf-8 -*-
"""生成《批量导入错题说明》Word 文档（Web App 版，含 ZIP 图片包）。"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

CN_FONT = "微软雅黑"
MONO = "Consolas"
ACCENT = RGBColor(0x6C, 0x4F, 0xE0)
ACCENT2 = RGBColor(0x3A, 0x7D, 0xD8)
GREY = RGBColor(0x60, 0x60, 0x60)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


def set_cn(run, font=CN_FONT):
    run.font.name = font
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), font)
    rfonts.set(qn('w:ascii'), font)
    rfonts.set(qn('w:hAnsi'), font)


def add_para(doc, text="", size=11, bold=False, color=None, align=None,
             font=CN_FONT, space_after=6, space_before=0):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(space_before)
    if text:
        r = p.add_run(text)
        r.font.size = Pt(size)
        r.bold = bold
        if color:
            r.font.color.rgb = color
        set_cn(r, font)
    return p


def add_heading(doc, text, level=1):
    sizes = {0: 22, 1: 15, 2: 12.5}
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level else 0)
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(sizes.get(level, 12))
    r.font.color.rgb = ACCENT if level else RGBColor(0x22, 0x22, 0x22)
    set_cn(r)
    return p


def shade_cell(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


def style_cell_text(cell, text, bold=False, color=None, size=9.5, font=CN_FONT):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(2)
    r = p.add_run(text)
    r.bold = bold
    r.font.size = Pt(size)
    if color:
        r.font.color.rgb = color
    set_cn(r, font)


def code_block(doc, lines):
    for line in lines:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.left_indent = Inches(0.2)
        r = p.add_run(line if line else " ")
        r.font.size = Pt(9.5)
        r.font.name = MONO
        rpr = r._element.get_or_add_rPr()
        rfonts = OxmlElement('w:rFonts')
        rfonts.set(qn('w:eastAsia'), MONO)
        rfonts.set(qn('w:ascii'), MONO)
        rfonts.set(qn('w:hAnsi'), MONO)
        rpr.append(rfonts)
        if line.strip().startswith('"') and ':' in line:
            r.font.color.rgb = RGBColor(0x1F, 0x6F, 0xB2)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def bullet(doc, text, bold_prefix=None):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(4)
    if bold_prefix:
        r1 = p.add_run(bold_prefix)
        r1.bold = True
        r1.font.size = Pt(10.5)
        set_cn(r1)
        r2 = p.add_run(text)
        r2.font.size = Pt(10.5)
        set_cn(r2)
    else:
        r = p.add_run(text)
        r.font.size = Pt(10.5)
        set_cn(r)
    return p


def make_table(doc, headers, rows, widths, header_fill="6C4FE0"):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = table.rows[0].cells
    for j, h in enumerate(headers):
        style_cell_text(hdr[j], h, bold=True, color=WHITE, size=9.5)
        shade_cell(hdr[j], header_fill)
    for ri, row in enumerate(rows):
        cells = table.add_row().cells
        for j, val in enumerate(row):
            col = None
            if j == 1 and "必填" in val:
                col = RGBColor(0xC0, 0x39, 0x2B)
            style_cell_text(cells[j], val, size=9, color=col, bold=(j == 0))
        if ri % 2 == 1:
            for c in cells:
                shade_cell(c, "F4F1FB")
    for row in table.rows:
        for j, c in enumerate(row.cells):
            c.width = Inches(widths[j])
    return table


def main():
    doc = Document()
    normal = doc.styles['Normal']
    normal.font.name = CN_FONT
    normal.font.size = Pt(11)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), CN_FONT)

    add_heading(doc, "错题本 · 批量导入说明", level=0)
    add_para(doc, "适用于「错题本」App（Web App 版）—— 本文档说明如何批量导入错题，以及导入文件里每个字段应该写什么。",
             size=10.5, color=GREY, space_after=4)
    add_para(doc, "本次新增：支持 ZIP 图片包（题目图片随 JSON 一起打包导入）。",
             size=10.5, color=ACCENT, bold=True, space_after=12)

    # 一、入口
    add_heading(doc, "一、从哪里导入", level=1)
    for i, t in enumerate([
        "打开 App 首页，点屏幕底部中间的「＋」号。",
        "在弹出菜单里选「批量导入错题」。",
        "点「选择 .zip / .json / .csv / .txt」，选中你准备好的文件。",
        "解析后先预览（会显示将新增 / 更新 / 跳过多少条），确认无误再点「导入」。导入是追加，不会删除已有错题。",
    ], 1):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        r1 = p.add_run(f"{i}. ")
        r1.bold = True
        r1.font.size = Pt(10.5); set_cn(r1)
        r2 = p.add_run(t)
        r2.font.size = Pt(10.5); set_cn(r2)

    # 二、三种文件格式
    add_heading(doc, "二、支持三种文件格式", level=1)
    make_table(doc,
        ["格式", "适用场景", "怎么选"],
        [
            ("JSON", "纯文字题 / 公式题，无图片", "最常用。字段最全、别名最全。"),
            ("CSV / TXT", "从 Excel 表格整理的大批量文字题", "表头用标准字段名；公式里的换行不方便。"),
            ("ZIP 图片包", "题目带图片（截图、几何图、公式图）", "推荐：data.json + images/ 文件夹一起打包，图片自动入库存档。"),
        ],
        [1.3, 2.4, 2.9])
    add_para(doc, "也可以直接把 JSON 文本粘贴进导入页的文本框（支持裸数组、单条对象、JSONL 每行一个对象）。",
             size=10.5, color=GREY, space_before=6, space_after=6)

    # 三、JSON 整体结构
    add_heading(doc, "三、JSON 文件的整体结构", level=1)
    add_para(doc, "顶层是一个对象 {...}，错题放在 questions 数组里。format 可省略，写了就必须是 \"cuotiben-batch\"；数组键名也可用「题目」/ items / list / data。",
             size=10.5, space_after=8)
    code_block(doc, [
        "{",
        '  "format": "cuotiben-batch",',
        '  "version": 1,',
        '  "questions": [',
        '    { "stem": "已知 $f(x)=x^2-2x+3$，求最小值。",',
        '      "subject": "数学", "correctAnswer": "B",',
        '      "analysis": "配方得…", "mastery": "unmastered" },',
        '    { "stem": "如图，求 $\\angle A$ 的度数。",',
        '      "subject": "数学", "images": ["images/1.png"] }',
        "  ]",
        "}",
    ])

    # 四、字段逐项说明（核心）
    add_heading(doc, "四、每道题的字段（逐字段说明）", level=1)
    add_para(doc, "英文字段名与中文别名都可以使用，大小写不敏感（空格、下划线、连字符会被忽略）。下表中「必填」列标注了哪些字段不能同时为空。",
             size=10.5, space_after=8)
    make_table(doc,
        ["字段（英文 / 中文别名）", "必填", "写什么", "实际存进 App 的哪里"],
        [
            ("stem / 题干、题目、question、text", "与图片二选一", "题干文字，支持 $公式$ 与 $$独立公式$$", "题干正文（会渲染成数学公式）"),
            ("images / 图片、题目图片、照片", "与 stem 二选一", "图片：ZIP 内相对路径 / dataURL / base64，最多 8 张", "题目图片，自动压缩存档（见第六节）"),
            ("correctAnswer / 正确答案、答案、answer", "选填", "正确答案文字或选项字母", "「正确答案」面板（首页卡片与详情页显示）"),
            ("analysis / 解析、解答、explanation", "选填", "解析文字，支持公式", "「解析」面板"),
            ("cause / 错因、错误原因、原因", "选填", "错因文字（内置 8 种之一才会成为错因标签）", "命中内置→错因标签；否则进备注"),
            ("causeExtra / 错因说明、补充说明", "选填", "错因补充说明", "并入错因面板的说明文字"),
            ("notes / 备注、备考备注、note", "选填", "任意备考备注（字符串或数组）", "「备考备注」面板，追加不覆盖"),
            ("subject / 科目、学科、sub", "选填", "科目名", "不存在会自动新建；不填用现有第一个科目"),
            ("qtype / 题型、题目类型、type", "选填", "题型名", "题型；不填用现有第一个题型"),
            ("mastery / 掌握状态、状态、status", "选填", "0-3 / unmastered 等 / 未掌握等中文", "掌握状态（默认未掌握，见第五节）"),
            ("tags / 标签、tag", "选填", '数组 ["a","b"] 或逗号/顿号分隔字符串', "标签；首页卡片第一行显示前两个作为知识点"),
            ("externalId / 外部id、题号、唯一编号", "选填", "你自己的唯一编号", "用于去重与「更新」模式匹配（见第七节）"),
            ("createdAt / 录入时间、创建时间", "选填", "ISO 时间串 或毫秒时间戳", "录入时间"),
            ("updatedAt / 修改时间、更新时间", "选填", "同上", "修改时间（去重时用于判断新旧）"),
            ("optionA-D / 选项A-D、a/b/c/d", "兼容", "选项 A/B/C/D 的文字", "仅兼容旧导入；当前界面不再显示选项框"),
            ("myAnswer / 我的答案、错误答案", "兼容", "你当时选的答案", "仅兼容旧导入；当前界面不再显示"),
            ("difficulty / 难度、星级、stars", "兼容", "1-5", "仅兼容旧导入；当前界面不再显示星级"),
        ],
        [2.05, 0.85, 2.05, 2.0])
    add_para(doc, "注：被标注为「兼容」的字段仍会被解析并在导入时保留，但当前版本的界面已不再展示选项框、我的错误答案和难度星级，填写它们不会影响显示效果。",
             size=10, color=GREY, space_before=6)

    # 五、掌握状态对照
    add_heading(doc, "五、mastery 掌握状态取值对照", level=1)
    add_para(doc, "数字 / 英文 / 中文三种写法等价，导入后统一为三档。", size=10.5, space_after=8)
    make_table(doc,
        ["数字", "英文", "中文写法", "含义"],
        [
            ("0", "unmastered", "未掌握 / 不会 / red", "还没学会"),
            ("1", "fuzzy", "模糊 / 有点生疏 / 半懂 / yellow", "半懂不懂"),
            ("2", "mastered", "已掌握 / 掌握 / 会了 / green", "已经掌握"),
        ],
        [1.0, 1.6, 2.9, 1.6], header_fill="3A7DD8")

    # 六、ZIP 图片包（新增重点）
    add_heading(doc, "六、带图片的 ZIP 包怎么写（新增）", level=1)
    add_para(doc, "要给题目配图片，请把一个 JSON 文件和所有图片一起打包成 .zip。目录结构如下：", size=10.5, space_after=8)
    code_block(doc, [
        "我的错题包.zip",
        "├── data.json          ← 第三节的 JSON（ questions 数组）",
        "└── images/",
        "    ├── 1.png          ← 第一题的图片",
        "    ├── 2.jpg          ← 第二题的图片",
        "    └── ...",
    ])
    add_para(doc, "在 JSON 里用相对路径引用图片即可，导入时会自动把相对路径替换成图片数据并入库存档：", size=10.5, space_after=8)
    code_block(doc, [
        '{ "stem": "如图求角 A。", "subject": "数学",',
        '  "images": ["images/1.png", "images/2.jpg"] }',
    ])
    bullet(doc, "图片格式支持 png / jpg / jpeg / webp / gif；每题最多 8 张。", bold_prefix="图片格式：")
    bullet(doc, "相对路径按文件名宽松匹配（images/1.png 与 1.png 都能对上），找不到会在结果里提示缺失张数。", bold_prefix="路径匹配：")
    bullet(doc, "导入页点「ZIP 模板」可下载一个现成的压缩包，照着改最省事。", bold_prefix="现成模板：")
    bullet(doc, "图片入库前会自动压缩并生成缩略图；详情页点击图片可双指放大查看。", bold_prefix="自动处理：")

    # 七、去重与更新
    add_heading(doc, "七、重复题目怎么处理", level=1)
    add_para(doc, "导入时可以选择三种模式：", size=10.5, space_after=8)
    bullet(doc, "遇到相同题目直接跳过（默认，最安全）。")
    bullet(doc, "用新数据覆盖同题，externalId 或题干+答案相同视为同一题。")
    bullet(doc, "保留为两条独立错题。")
    add_para(doc, "判重依据：优先比对 externalId；没有则用「题干 + 正确答案」生成的指纹。更新模式下，以 updatedAt 较新的一方为准。",
             size=10.5, color=GREY, space_before=4, space_after=6)

    # 八、公式写法
    add_heading(doc, "八、数学公式怎么写", level=1)
    add_para(doc, "题干、正确答案、解析里都可以写公式，导入后由 KaTeX 离线渲染（无需联网）：", size=10.5, space_after=8)
    bullet(doc, "$f(x)=x^2-2x+3$ —— 行内公式。", bold_prefix="行内：")
    bullet(doc, "$$\\frac{a}{b}+x^{2}$$ —— 独立成行的大公式。", bold_prefix="独立：")
    bullet(doc, 'JSON 里反斜杠要写成两个，例如 \\frac 要在 JSON 文本中写 "\\\\frac{a}{b}"，否则 JSON 非法。',
           bold_prefix="反斜杠转义：")

    # 九、坑点
    add_heading(doc, "九、三个最容易踩的坑", level=1)
    bullet(doc, "每道题的 stem 与 images 至少要有一个，否则该题被跳过并计入警告。", bold_prefix="题干或图片至少有一个：")
    bullet(doc, "JSON 里 \\frac 必须写成 \\\\frac（否则 JSON 非法）；公式用 $...$ 行内、$$...$$ 独立。", bold_prefix="公式反斜杠要转义：")
    bullet(doc, "ZIP 包必须是标准 zip，data.json 放在压缩包根目录（不要在 zip 里再套一层文件夹）。", bold_prefix="ZIP 目录层级：")

    # 十、范例
    add_heading(doc, "十、完整范例", level=1)
    add_para(doc, "导入页的「JSON 模板」「ZIP 模板」按钮可下载可直接修改的范例文件。一个最小可用的 JSON 范例如下：",
             size=10.5, space_after=8)
    code_block(doc, [
        '{',
        '  "format": "cuotiben-batch",',
        '  "questions": [',
        '    {',
        '      "externalId": "no-001",',
        '      "stem": "已知 $f(x)=x^2-2x+3$，求其最小值。",',
        '      "correctAnswer": "2",',
        '      "analysis": "配方得 $f(x)=(x-1)^2+2$，故最小值为 2。",',
        '      "subject": "数学", "qtype": "解答",',
        '      "mastery": "unmastered", "tags": ["二次函数", "配方"]',
        '    }',
        '  ]',
        '}',
    ])

    out = r"E:\Vibecoding\ctb\cuotiben-app\批量导入说明.docx"
    doc.save(out)
    print("SAVED", out)


if __name__ == "__main__":
    main()
