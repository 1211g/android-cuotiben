#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
手工构建 错题本 Android APK（无需 Gradle / 无需联网）。

流程：
  1. 把 Web App 拷进 assets/www
  2. aapt2 compile + link  -> base.apk（含 resources.arsc / res / assets / Manifest）
  3. javac + jar + d8      -> classes.dex
  4. 用 classes.dex 全量重建 unsigned.apk（避免 zip 头不一致）
  5. zipalign -> apksigner 签名 -> cuotiben-v1.0.0.apk
     （签名密钥 android/cuotiben.jks 持久化，重复构建可覆盖安装）

用法：python build_apk.py
可用环境变量覆盖：CUOTIBEN_SDK / ANDROID_HOME / ANDROID_SDK_ROOT、
                  CUOTIBEN_JAVA_HOME / JAVA_HOME

项目目录可以整体搬走；构建工具链（SDK / JDK）仍可用环境变量指定，
或自动回退到本机常见安装位置（见 find_sdk / find_jdk）。
"""
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANDROID = HERE / "android"
WORKSPACE = HERE.parent
OUT = ANDROID / "build"

# 本工程允许整体搬迁到任意目录（例如 E:\Vibecoding\cuotiben-app）。
# 工具链不在工程内，因此除了 WORKSPACE 下的相对位置，再补几个本机固定安装位置；
# 都不存在时仍可用 CUOTIBEN_SDK / CUOTIBEN_JAVA_HOME 显式指定。
LEGACY_WORKSPACE = Path(r"C:\Users\chen5\Documents\deepseek-harness\default-workspace")
EXTRA_SDK_DIRS = [
    Path(r"D:\Android Projects"),                 # Android Studio SDK（aapt2 可写任意目录）
    LEGACY_WORKSPACE / "build" / "sdk",           # 原工作区内的手工 SDK 兜底
]
EXTRA_JDK_DIRS = [
    Path(r"D:\AndroidBuild\zulu17"),              # Gradle 用的 Zulu17
]
EXTRA_TOOLCHAIN_DIRS = [WORKSPACE / ".toolchain", LEGACY_WORKSPACE / ".toolchain"]

APP_NAME = "cuotiben-v1.0.0.apk"
CN_NAME = "错题本-v1.0.0.apk"
STOREPASS = "cuotiben123"
ALIAS = "cuotiben"
# 放在 android/ 而非 android/build/：build/ 每次构建会清空，密钥必须持久保留，
# 否则重新打包后签名不一致，已安装的 App 无法覆盖升级。
KEYSTORE = ANDROID / "cuotiben.jks"


def log(msg):
    print("[build] " + msg, flush=True)


def run(cmd, env=None, cwd=None):
    log("> " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, env=env, cwd=str(cwd) if cwd else None)


def run_bat(bat, args, env=None):
    """SDK 路径可能含空格（如 D:\\Android Projects）。cmd /c 会剥掉首尾引号，
    因此把整条命令再包一层引号，避免 'D:\\Android' is not recognized。"""
    inner = subprocess.list2cmdline([str(bat)] + [str(a) for a in args])
    cmdline = 'cmd /c "' + inner + '"'
    log("> " + cmdline)
    subprocess.run(cmdline, check=True, env=env)


def pick_dir(base, pattern):
    hits = sorted([p for p in base.glob(pattern) if p.is_dir()], key=lambda p: p.name)
    return hits[-1] if hits else None


def find_sdk():
    candidates = []
    for key in ("CUOTIBEN_SDK", "ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(key):
            candidates.append(Path(os.environ[key]))
    candidates += [WORKSPACE / "build" / "sdk", WORKSPACE / ".toolchain" / "android-sdk"]
    candidates += EXTRA_SDK_DIRS
    for sdk in candidates:
        if not sdk.is_dir():
            continue
        # 优先用已验证的 android-34 / build-tools 34.0.0；没有时再退回最新版本。
        plat = (sdk / "platforms" / "android-34") if (sdk / "platforms" / "android-34" / "android.jar").exists() \
            else pick_dir(sdk / "platforms", "android-*")
        bt = (sdk / "build-tools" / "34.0.0") if (sdk / "build-tools" / "34.0.0" / "aapt2.exe").exists() \
            else pick_dir(sdk / "build-tools", "*")
        if plat and (plat / "android.jar").exists() and bt and (bt / "aapt2.exe").exists():
            log("SDK       = " + str(sdk))
            log("platform  = " + plat.name + "  build-tools = " + bt.name)
            return sdk, plat / "android.jar", bt
    raise SystemExit("找不到可用的 Android SDK（需要 platforms/android-*/android.jar 与 build-tools/*/aapt2.exe）。"
                     "请设置 CUOTIBEN_SDK / ANDROID_HOME，或先运行 sdkmanager 安装 platforms;android-34 与 build-tools;34.0.0。")


def find_jdk():
    candidates = []
    if os.environ.get("CUOTIBEN_JAVA_HOME"):
        candidates.append(Path(os.environ["CUOTIBEN_JAVA_HOME"]))
    if os.environ.get("JAVA_HOME"):
        candidates.append(Path(os.environ["JAVA_HOME"]))
    which = shutil.which("javac")
    if which:
        candidates.append(Path(which).parent.parent)
    # 优先使用独立的本机 JDK；放在旧工作区 .toolchain 里的 JDK 被沙箱限制，
    # 无法把 .class 写到工程搬迁后的新目录。
    candidates += EXTRA_JDK_DIRS
    for base in EXTRA_TOOLCHAIN_DIRS:
        if base.is_dir():
            candidates += sorted(base.glob("zulu*"))
            candidates += sorted(base.glob("jdk*"))
    for jdk in candidates:
        bin_dir = jdk / "bin" if (jdk / "bin").is_dir() else jdk
        if (bin_dir / "javac.exe").exists() and (bin_dir / "jar.exe").exists():
            log("JDK       = " + str(jdk))
            return bin_dir
    raise SystemExit("找不到 JDK 17（需要 javac.exe / jar.exe / keytool.exe），请设置 JAVA_HOME。")


def copy_web_assets():
    www = OUT / "assets" / "www"
    www.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for name in ("index.html", "manifest.json", "sw.js"):
        src = HERE / name
        if src.exists():
            dst = www / name
            shutil.copy2(src, dst)
            wanted.add(dst)
    for d in ("css", "js", "icons", "ocr", "pdf"):
        src = HERE / d
        if not src.is_dir():
            continue
        for f in src.rglob("*"):
            if not f.is_file():
                continue
            dst = www / d / f.relative_to(src)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
            wanted.add(dst)
    # Only remove assets that disappeared since the previous build (usually none).
    # Avoids a bulk delete of the whole assets tree on every rebuild.
    for old in www.rglob("*"):
        if old.is_file() and old not in wanted:
            old.unlink()
    n = sum(1 for _ in www.rglob("*") if _.is_file())
    log("assets/www: %d 个文件" % n)


def main():
    # Incremental-friendly: reuse android/build and overwrite intermediates
    # instead of deleting the whole tree (avoids antivirus / bulk-delete guards
    # and keeps repeat builds fast). Only stale generated files are removed.
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "classes").mkdir(exist_ok=True)
    (OUT / "dex").mkdir(exist_ok=True)
    for name in ("res.zip", "base.apk", "unsigned.apk", "aligned.apk", "classes.jar"):
        p = OUT / name
        if p.is_file():
            p.unlink()
    dex_old = OUT / "dex" / "classes.dex"
    if dex_old.is_file():
        dex_old.unlink()
    for p in (OUT / "classes").rglob("*.class"):
        p.unlink()

    sdk, android_jar, bt = find_sdk()
    jdk_bin = find_jdk()

    env = os.environ.copy()
    env["JAVA_HOME"] = str(jdk_bin.parent)
    env["PATH"] = str(jdk_bin) + os.pathsep + env.get("PATH", "")

    aapt2 = bt / "aapt2.exe"
    zipalign = bt / "zipalign.exe"
    d8 = bt / "d8.bat"
    apksigner = bt / "apksigner.bat"

    copy_web_assets()

    # ---------- 1. resources ----------
    res_zip = OUT / "res.zip"
    base_apk = OUT / "base.apk"
    run([aapt2, "compile", "--dir", ANDROID / "res", "-o", res_zip])
    run([aapt2, "link",
         "-o", base_apk,
         "-I", android_jar,
         "--manifest", ANDROID / "AndroidManifest.xml",
         "-R", res_zip,
         "-A", OUT / "assets",
         "--auto-add-overlay",
         "--min-sdk-version", "26",
         "--target-sdk-version", "34",
         "--version-code", "1",
         "--version-name", "1.0.0",
         # OCR wasm / traineddata assets are >1 MB. AssetManager.open() can only
         # uncompress up to UNCOMPRESS_DATA_MAX (~1 MB), so store them uncompressed.
         "-0", "wasm", "-0", "gz", "-0", "js", "-0", "txt", "-0", "woff2"])

    # ---------- 2. java -> dex ----------
    java_src = sorted((ANDROID / "java" / "com" / "cuotiben" / "app").glob("*.java"))
    run([jdk_bin / "javac.exe", "-encoding", "UTF-8",
         "-source", "8", "-target", "8",
         "-bootclasspath", android_jar,
         "-classpath", android_jar,
         "-d", OUT / "classes", *java_src], env=env)
    classes_jar = OUT / "classes.jar"
    run([jdk_bin / "jar.exe", "cf", classes_jar, "-C", OUT / "classes", "."], env=env)
    run_bat(d8, ["--lib", android_jar, "--min-api", "26",
                 "--output", OUT / "dex", classes_jar], env=env)
    dex = OUT / "dex" / "classes.dex"
    if not dex.exists():
        raise SystemExit("d8 未生成 classes.dex")

    # ---------- 3. rebuild a clean zip with classes.dex ----------
    # Rebuilding (rather than appending in place) keeps every local header
    # consistent; zipalign then produces a warning-free, 4-byte aligned APK.
    unsigned = OUT / "unsigned.apk"
    with zipfile.ZipFile(base_apk) as src, zipfile.ZipFile(unsigned, "w") as dst:
        for info in src.infolist():
            ni = zipfile.ZipInfo(info.filename, info.date_time)
            ni.compress_type = info.compress_type
            ni.external_attr = info.external_attr
            ni.internal_attr = info.internal_attr
            ni.create_system = info.create_system
            ni.flag_bits = 0
            dst.writestr(ni, src.read(info.filename))
        di = zipfile.ZipInfo("classes.dex", (1980, 1, 1, 0, 0, 0))
        di.compress_type = zipfile.ZIP_DEFLATED
        dst.writestr(di, dex.read_bytes())
    log("classes.dex 已写入 APK (%d bytes)" % dex.stat().st_size)

    # ---------- 4. align ----------
    aligned = OUT / "aligned.apk"
    run([zipalign, "-f", "4", unsigned, aligned])

    # ---------- 5. sign ----------
    jks = KEYSTORE
    if not jks.exists():
        log("生成签名密钥：" + str(jks))
        run([jdk_bin / "keytool.exe", "-genkeypair", "-noprompt",
             "-keystore", jks, "-alias", ALIAS,
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storepass", STOREPASS, "-keypass", STOREPASS,
             "-dname", "CN=Cuotiben, OU=Personal, O=Cuotiben, L=Local, S=Local, C=CN"], env=env)
    else:
        log("复用已有签名密钥：" + str(jks))

    signed = HERE / APP_NAME
    run_bat(apksigner, ["sign",
                        "--ks", jks,
                        "--ks-key-alias", ALIAS,
                        "--ks-pass", "pass:" + STOREPASS,
                        "--key-pass", "pass:" + STOREPASS,
                        "--v1-signing-enabled", "false",
                        "--v2-signing-enabled", "true",
                        "--v3-signing-enabled", "true",
                        "--out", signed, aligned], env=env)
    run_bat(apksigner, ["verify", "--verbose", signed], env=env)

    shutil.copy2(signed, HERE / CN_NAME)
    log("完成：%s  (%.1f KB)" % (signed.name, signed.stat().st_size / 1024.0))
    log("同时生成中文名副本：" + CN_NAME)
    return 0


if __name__ == "__main__":
    sys.exit(main())
