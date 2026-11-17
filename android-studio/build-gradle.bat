@echo off
setlocal
rem Offline Gradle build for the Cuotiben Android Studio project.
rem This file is deliberately pure ASCII: cmd.exe mangles non-ASCII bytes
rem under some OEM code pages, which can split a line into commands.

rem Gradle 8.7 / AGP 8.5.2 require JDK 17. Android Studio's JBR here is
rem JDK 25, whose Groovy 3.0.17 fails with "Unsupported class file major
rem version 69". The Zulu17 JDK shipped inside this workspace cannot run
rem Gradle from a sandboxed shell (writes outside the workspace are denied
rem for java.exe launched there), so a copy was placed outside it at
rem D:\AndroidBuild\zulu17. Override with CUOTIBEN_JAVA_HOME if needed.
set "JAVA_HOME=D:\AndroidBuild\zulu17"
if not exist "%JAVA_HOME%\bin\java.exe" set "JAVA_HOME=C:\Users\chen5\Documents\deepseek-harness\default-workspace\.toolchain\zulu17.54.21-ca-jdk17.0.13-win_x64"
if defined CUOTIBEN_JAVA_HOME set "JAVA_HOME=%CUOTIBEN_JAVA_HOME%"

rem Force a valid Windows temp dir. When this script is launched from Git
rem Bash, TEMP=/tmp leaks in and Java cannot create its temp/lock files.
if not exist "%LOCALAPPDATA%\Temp" mkdir "%LOCALAPPDATA%\Temp"
set "TEMP=%LOCALAPPDATA%\Temp"
set "TMP=%LOCALAPPDATA%\Temp"

set "ANDROID_HOME=D:\Android Projects"
set "ANDROID_SDK_ROOT=D:\Android Projects"

cd /d "%~dp0"

rem --offline is the default; set CUOTIBEN_GRADLE_OFFLINE=0 to allow network.
if /I "%CUOTIBEN_GRADLE_OFFLINE%"=="0" (
    call "D:\AndroidBuild\gradle-8.7\bin\gradle.bat" assembleDebug %*
) else (
    call "D:\AndroidBuild\gradle-8.7\bin\gradle.bat" --offline assembleDebug %*
)
set "CUOTIBEN_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CUOTIBEN_EXIT%
