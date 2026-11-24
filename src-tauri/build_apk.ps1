$ErrorActionPreference = "Stop"

$ToolchainDir = "C:\Users\TRAN VAN HUNG\.gemini\antigravity\scratch\toolchain"
$ProjectDir   = "C:\Users\TRAN VAN HUNG\.gemini\antigravity\scratch\abyssal-realms"
$AndroidDir   = "$ProjectDir\src-tauri\gen\android"
$BuildDir     = "$ProjectDir\src-tauri\target\android-build"
$AndroidSdk   = "$ToolchainDir\android-sdk"

$env:JAVA_HOME   = "$ToolchainDir\jdk"
$env:RUSTUP_HOME = "$ToolchainDir\rustup"
$env:CARGO_HOME  = "$ToolchainDir\cargo"
$env:PATH        = "$env:JAVA_HOME\bin;$env:CARGO_HOME\bin;$env:PATH"

$BuildToolsDir = "$AndroidSdk\build-tools\34.0.0"
$PlatformDir   = "$AndroidSdk\platforms\android-34"
$Aapt2         = "$BuildToolsDir\aapt2.exe"
$ZipAlign      = "$BuildToolsDir\zipalign.exe"
$D8Jar         = "$BuildToolsDir\lib\d8.jar"
$SignerJar     = "$BuildToolsDir\lib\apksigner.jar"
$AndroidJar    = "$PlatformDir\android.jar"

# 1. Compile ApkPackager helper & generate raster PNG launcher icon (100% OEM installer compatible)
Write-Host "[1/7] Compiling ApkPackager & generating PNG launcher icon..."
if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$BuildDir\tools", "$BuildDir\compiled_res", "$BuildDir\gen_r", "$BuildDir\classes", "$BuildDir\dex", "$BuildDir\apk_root" | Out-Null

& "$env:JAVA_HOME\bin\javac.exe" -encoding UTF-8 -d "$BuildDir\tools" "$ProjectDir\src-tauri\ApkPackager.java"

if (Test-Path "$AndroidDir\res\drawable\ic_launcher.xml") {
    Remove-Item "$AndroidDir\res\drawable\ic_launcher.xml" -Force
}
& "$env:JAVA_HOME\bin\java.exe" -cp "$BuildDir\tools" ApkPackager icon "$AndroidDir\res\drawable\ic_launcher.png"

# 2. Compile Rust Native Core (`src-tauri/src/lib.rs`) to ARM64 & x86_64 Android `.so` binaries (16KB page-aligned for Android 14/15)
Write-Host "[2/7] Compiling Rust Native Core (libabyssal_realms.so) for arm64-v8a & x86_64..."
$Rustc = "$ToolchainDir\cargo\bin\rustc.exe"
$Lld = Get-ChildItem "$ToolchainDir\rustup\toolchains" -Recurse -Filter "rust-lld.exe" | Select-Object -First 1 -ExpandProperty FullName

$JniArm64 = "$AndroidDir\lib\arm64-v8a"
$JniX64   = "$AndroidDir\lib\x86_64"
New-Item -ItemType Directory -Force -Path $JniArm64, $JniX64 | Out-Null

& $Rustc --edition 2021 --crate-type cdylib -C opt-level=3 -C panic=abort -C strip=symbols `
    -C linker="$Lld" -C linker-flavor=ld.lld `
    -C link-arg=--soname=libabyssal_realms.so `
    -C link-arg=-z -C link-arg=max-page-size=16384 `
    --target aarch64-linux-android "$ProjectDir\src-tauri\src\lib.rs" -o "$JniArm64\libabyssal_realms.so"

& $Rustc --edition 2021 --crate-type cdylib -C opt-level=3 -C panic=abort -C strip=symbols `
    -C linker="$Lld" -C linker-flavor=ld.lld `
    -C link-arg=--soname=libabyssal_realms.so `
    -C link-arg=-z -C link-arg=max-page-size=16384 `
    --target x86_64-linux-android "$ProjectDir\src-tauri\src\lib.rs" -o "$JniX64\libabyssal_realms.so"

# 3. Compile Android resources with aapt2
Write-Host "[3/7] Compiling Android resources with aapt2..."
& $Aapt2 compile --dir "$AndroidDir\res" -o "$BuildDir\compiled_res\resources.zip"
& $Aapt2 link `
    -I "$AndroidJar" `
    --manifest "$AndroidDir\AndroidManifest.xml" `
    --java "$BuildDir\gen_r" `
    -o "$BuildDir\base-resources.apk" `
    "$BuildDir\compiled_res\resources.zip" `
    --auto-add-overlay

# 4. Compile Java classes (R.java, RustBridge.java, LocalAssetServer.java, MainActivity.java)
Write-Host "[4/7] Compiling Android Java -> DEX bytecode (javac + d8)..."
$JavaFiles = @(
    Get-ChildItem "$BuildDir\gen_r" -Recurse -Filter "*.java" | Select-Object -ExpandProperty FullName
    Get-ChildItem "$AndroidDir\java" -Recurse -Filter "*.java" | Select-Object -ExpandProperty FullName
)

& "$env:JAVA_HOME\bin\javac.exe" -encoding UTF-8 --release 8 -classpath "$AndroidJar" -d "$BuildDir\classes" $JavaFiles

$ClassFiles = Get-ChildItem "$BuildDir\classes" -Recurse -Filter "*.class" | Select-Object -ExpandProperty FullName
& "$env:JAVA_HOME\bin\java.exe" -cp "$D8Jar" com.android.tools.r8.D8 --lib "$AndroidJar" --min-api 21 --output "$BuildDir\dex" $ClassFiles

# 5. Assemble APK Archive with true ZIP_STORED (Method 0) for resources.arsc and lib/*.so
Write-Host "[5/7] Assembling APK bundle with ZIP_STORED resources.arsc, Rust native .so, and game assets..."
tar.exe -xf "$BuildDir\base-resources.apk" -C "$BuildDir\apk_root"
Copy-Item "$BuildDir\dex\classes.dex" "$BuildDir\apk_root\classes.dex" -Force

New-Item -ItemType Directory -Force -Path "$BuildDir\apk_root\lib\arm64-v8a", "$BuildDir\apk_root\lib\x86_64" | Out-Null
Copy-Item "$JniArm64\libabyssal_realms.so" "$BuildDir\apk_root\lib\arm64-v8a\libabyssal_realms.so" -Force
Copy-Item "$JniX64\libabyssal_realms.so" "$BuildDir\apk_root\lib\x86_64\libabyssal_realms.so" -Force

New-Item -ItemType Directory -Force -Path "$BuildDir\apk_root\assets\www" | Out-Null
Copy-Item "$ProjectDir\dist\*" "$BuildDir\apk_root\assets\www" -Recurse -Force

$UnalignedApk = "$BuildDir\unaligned.apk"
& "$env:JAVA_HOME\bin\java.exe" -cp "$BuildDir\tools" ApkPackager pack "$BuildDir\apk_root" $UnalignedApk

# 6. Zipalign on 4-byte & 4KB page boundaries
Write-Host "[6/7] Running zipalign (-f -p 4)..."
$AlignedApk = "$BuildDir\aligned.apk"
& $ZipAlign -f -p 4 $UnalignedApk $AlignedApk
& $ZipAlign -c -v 4 $AlignedApk | Select-Object -Last 5

# 7. Sign APK with V1 + V2 + V3 Signatures via apksigner
Write-Host "[7/7] Signing APK with V1 + V2 + V3 cryptographic signatures..."
$Keystore = "$ProjectDir\src-tauri\abyssal-release-key.jks"
if (-not (Test-Path $Keystore)) {
    & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair `
        -v -keystore $Keystore `
        -alias abyssal_key `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass abyssal123 -keypass abyssal123 `
        -dname "CN=Abyssal Realms, OU=Rust Engine, O=AbyssalStudio, L=HCMC, S=VN, C=VN"
}

$FinalApkRoot = "$ProjectDir\VucThamHuyenBi-v2.0-rust-crossplay.apk"
$FinalApkReleaseDir = "$ProjectDir\src-tauri\target\release\apk"
New-Item -ItemType Directory -Force -Path $FinalApkReleaseDir | Out-Null
$FinalApkRelease = "$FinalApkReleaseDir\VucThamHuyenBi-v2.0-rust-crossplay.apk"

& "$env:JAVA_HOME\bin\java.exe" -jar "$SignerJar" sign `
    --ks $Keystore `
    --ks-key-alias abyssal_key `
    --ks-pass pass:abyssal123 `
    --key-pass pass:abyssal123 `
    --min-sdk-version 21 `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v3-signing-enabled true `
    --out $FinalApkRoot `
    $AlignedApk

Copy-Item $FinalApkRoot $FinalApkRelease -Force

Write-Host "Verifying APK signature..."
& "$env:JAVA_HOME\bin\java.exe" -jar "$SignerJar" verify --verbose $FinalApkRoot
