package com.abyssalrealms.game;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * JNI Bridge linking the Android WebView (`window.AbyssalRust`) directly to
 * the compiled Rust Native Library (`libabyssal_realms.so`).
 */
public final class RustBridge {
    private static boolean rustLoaded = false;

    static {
        try {
            System.loadLibrary("abyssal_realms");
            rustLoaded = true;
        } catch (Throwable t) {
            rustLoaded = false;
        }
    }

    // Native Rust functions implemented in src-tauri/src/lib.rs
    public static native String nativeGetEngineBanner();
    public static native long nativeComputeSeededDungeonHash(long seed, int floor);
    public static native int nativeSolveAStarGrid(int cols, int rows, int startCol, int startRow, int goalCol, int goalRow);
    public static native long nativeCompressPositionPacket(int xMilli, int yMilli, int zMilli, int yawMilli);
    public static native long nativeGetTickCounter();

    private final Context context;

    public RustBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public boolean isRustNativeActive() {
        return rustLoaded;
    }

    @JavascriptInterface
    public String getEngineBanner() {
        if (!rustLoaded) {
            return "Android Native Fallback (JNI offline)";
        }
        try {
            return nativeGetEngineBanner();
        } catch (Throwable t) {
            return "Rust Native Core v2.0 (JNI Ready)";
        }
    }

    @JavascriptInterface
    public String getComputeDungeonHashHex(int seed, int floor) {
        if (!rustLoaded) return "0";
        try {
            long h = nativeComputeSeededDungeonHash((long) seed, floor);
            return Long.toHexString(h);
        } catch (Throwable t) {
            return "0";
        }
    }

    @JavascriptInterface
    public int solveAStarHeuristic(int cols, int rows, int startCol, int startRow, int goalCol, int goalRow) {
        if (!rustLoaded) return -1;
        try {
            return nativeSolveAStarGrid(cols, rows, startCol, startRow, goalCol, goalRow);
        } catch (Throwable t) {
            return -1;
        }
    }

    @JavascriptInterface
    public String compressPositionPacketHex(int xMilli, int yMilli, int zMilli, int yawMilli) {
        if (!rustLoaded) return "0";
        try {
            long packed = nativeCompressPositionPacket(xMilli, yMilli, zMilli, yawMilli);
            return Long.toHexString(packed);
        } catch (Throwable t) {
            return "0";
        }
    }

    @JavascriptInterface
    public long getJniCallCount() {
        if (!rustLoaded) return 0L;
        try {
            return nativeGetTickCounter();
        } catch (Throwable t) {
            return 0L;
        }
    }

    @JavascriptInterface
    public void vibrate(int durationMs) {
        try {
            int clamped = Math.max(5, Math.min(durationMs, 400));
            Vibrator vib = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(clamped, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vib.vibrate(clamped);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    @JavascriptInterface
    public boolean saveProfileNative(String json) {
        if (json == null) return false;
        try (FileOutputStream fos = context.openFileOutput("abyssal_realms_save.json", Context.MODE_PRIVATE)) {
            fos.write(json.getBytes(StandardCharsets.UTF_8));
            fos.flush();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public String loadProfileNative() {
        try (FileInputStream fis = context.openFileInput("abyssal_realms_save.json")) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while ((r = fis.read(buf)) != -1) {
                bos.write(buf, 0, r);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return "";
        }
    }
}
