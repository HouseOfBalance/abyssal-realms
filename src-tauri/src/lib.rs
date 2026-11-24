#![no_std]

use core::panic::PanicInfo;
use core::sync::atomic::{AtomicI64, Ordering};

/// Global atomic counter tracking JNI invocations into the Rust Native Core.
static RUST_JNI_CALL_COUNT: AtomicI64 = AtomicI64::new(0);

/// Null-terminated UTF-8 banner returned to Android/WebView via JNI `NewStringUTF`.
static ENGINE_BANNER_CSZ: &[u8] =
    b"Rust Native Core v2.0 (ARM64/x86_64 JNI \xE2\x80\xA2 Cross-Play WebRTC/WS)\0";

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {
        core::hint::spin_loop();
    }
}

/// Compiler builtin required by freestanding no_std shared libraries on some targets.
#[no_mangle]
pub extern "C" fn rust_eh_personality() {}

// ── Minimal JNI C-ABI Definitions ────────────────────────────────────────────
pub type JNIEnv = *const *const usize;
pub type JObject = *mut core::ffi::c_void;
pub type JClass = *mut core::ffi::c_void;
pub type JString = *mut core::ffi::c_void;
pub type JInt = i32;
pub type JLong = i64;

const JNI_VERSION_1_6: JInt = 0x0001_0006;
/// Index 167 in JNINativeInterface_ table is `NewStringUTF(JNIEnv*, const char*)`.
const JNI_NEW_STRING_UTF_INDEX: usize = 167;

type NewStringUtfFn = unsafe extern "C" fn(env: JNIEnv, utf: *const u8) -> JString;

#[no_mangle]
pub extern "C" fn JNI_OnLoad(_vm: *mut core::ffi::c_void, _reserved: *mut core::ffi::c_void) -> JInt {
    RUST_JNI_CALL_COUNT.store(1, Ordering::Relaxed);
    JNI_VERSION_1_6
}

/// Returns the Rust Native Engine status banner string to Java/WebView.
#[no_mangle]
pub unsafe extern "C" fn Java_com_abyssalrealms_game_RustBridge_nativeGetEngineBanner(
    env: JNIEnv,
    _class: JClass,
) -> JString {
    RUST_JNI_CALL_COUNT.fetch_add(1, Ordering::Relaxed);
    if env.is_null() {
        return core::ptr::null_mut();
    }
    let vtable = *env;
    if vtable.is_null() {
        return core::ptr::null_mut();
    }
    let fn_ptr = *vtable.add(JNI_NEW_STRING_UTF_INDEX);
    let new_string_utf: NewStringUtfFn = core::mem::transmute(fn_ptr);
    new_string_utf(env, ENGINE_BANNER_CSZ.as_ptr())
}

/// Deterministic Mulberry32 / SplitMix64 dungeon floor hash computed in native Rust
/// to guarantee 100% seed parity between Android APK and Web browser cross-play peers.
#[no_mangle]
pub extern "C" fn Java_com_abyssalrealms_game_RustBridge_nativeComputeSeededDungeonHash(
    _env: JNIEnv,
    _class: JClass,
    seed: JLong,
    floor: JInt,
) -> JLong {
    RUST_JNI_CALL_COUNT.fetch_add(1, Ordering::Relaxed);
    let mut state = (seed as u32).wrapping_add((floor as u32).wrapping_mul(0x9E37_79B9));
    if state == 0 {
        state = 1337;
    }
    let mut acc: u64 = 0xCBF2_9CE4_8422_2325;
    let mut i = 0;
    while i < 16 {
        state = state.wrapping_add(0x6D2B_79F5);
        let mut t = state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        let out = t ^ (t >> 14);
        acc ^= out as u64;
        acc = acc.wrapping_mul(0x0000_0100_0000_01B3);
        i += 1;
    }
    (acc & 0x7FFF_FFFF_FFFF_FFFF) as JLong
}

/// Native Rust octile A* heuristic & path step estimator for grid navigation.
#[no_mangle]
pub extern "C" fn Java_com_abyssalrealms_game_RustBridge_nativeSolveAStarGrid(
    _env: JNIEnv,
    _class: JClass,
    cols: JInt,
    rows: JInt,
    start_col: JInt,
    start_row: JInt,
    goal_col: JInt,
    goal_row: JInt,
) -> JInt {
    RUST_JNI_CALL_COUNT.fetch_add(1, Ordering::Relaxed);
    if cols <= 0 || rows <= 0 {
        return -1;
    }
    let dx = (goal_col - start_col).abs();
    let dy = (goal_row - start_row).abs();
    let (min_d, max_d) = if dx < dy { (dx, dy) } else { (dy, dx) };
    // Octile distance scaled by 1000 (diagonal = 1414, cardinal = 1000)
    min_d.saturating_mul(1414).saturating_add((max_d - min_d).saturating_mul(1000))
}

/// Compresses 3D position (millimeters) + yaw (milliradians) into a compact 64-bit packet
/// for low-latency 20Hz-30Hz WebRTC / WebSocket cross-play synchronization.
#[no_mangle]
pub extern "C" fn Java_com_abyssalrealms_game_RustBridge_nativeCompressPositionPacket(
    _env: JNIEnv,
    _class: JClass,
    x_milli: JInt,
    y_milli: JInt,
    z_milli: JInt,
    yaw_milli: JInt,
) -> JLong {
    RUST_JNI_CALL_COUNT.fetch_add(1, Ordering::Relaxed);
    let ux = ((x_milli + 32768).clamp(0, 65535) as u64) & 0xFFFF;
    let uy = ((y_milli + 32768).clamp(0, 65535) as u64) & 0xFFFF;
    let uz = ((z_milli + 32768).clamp(0, 65535) as u64) & 0xFFFF;
    let uyaw = ((yaw_milli + 32768).clamp(0, 65535) as u64) & 0xFFFF;
    ((ux << 48) | (uy << 32) | (uz << 16) | uyaw) as JLong
}

/// Returns total number of JNI calls processed by the Rust Native Core.
#[no_mangle]
pub extern "C" fn Java_com_abyssalrealms_game_RustBridge_nativeGetTickCounter(
    _env: JNIEnv,
    _class: JClass,
) -> JLong {
    RUST_JNI_CALL_COUNT.fetch_add(1, Ordering::Relaxed) + 1
}
