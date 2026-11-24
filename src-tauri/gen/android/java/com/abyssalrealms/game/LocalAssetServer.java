package com.abyssalrealms.game;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * High-speed local loopback HTTP server (`http://127.0.0.1:<port>`) serving bundled
 * APK assets (`assets/www/`).
 *
 * Running on `http://127.0.0.1` guarantees that Android Chromium WebView treats the game
 * as a W3C Secure Context (`window.isSecureContext === true`), enabling:
 *  - ES Modules (`<script type="module" crossorigin>`) with zero CORS restrictions
 *  - PeerJS WebRTC P2P (`RTCPeerConnection` + DataChannel) cross-play with Web browsers
 *  - WebRTC 3D Spatial Voice Chat (`navigator.mediaDevices.getUserMedia`)
 *  - Custom WebSocket Relay (`ws://` and `wss://`) cross-play
 */
public final class LocalAssetServer {
    private final AssetManager assets;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket serverSocket;
    private volatile boolean running = false;
    private int port = 0;

    public LocalAssetServer(AssetManager assets) {
        this.assets = assets;
    }

    public synchronized int start() throws IOException {
        if (running && serverSocket != null) {
            return port;
        }
        // Bind to 127.0.0.1 only (loopback security) on preferred port 18787 or ephemeral fallback
        try {
            serverSocket = new ServerSocket(18787, 32, InetAddress.getByName("127.0.0.1"));
        } catch (IOException e) {
            serverSocket = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
        }
        port = serverSocket.getLocalPort();
        running = true;

        Thread acceptThread = new Thread(this::acceptLoop, "AbyssalRustAssetServer");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return port;
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket client = serverSocket.accept();
                pool.execute(() -> handleClient(client));
            } catch (IOException ignored) {
                if (!running) break;
            }
        }
    }

    private void handleClient(Socket client) {
        try (Socket sock = client;
             InputStream in = sock.getInputStream();
             OutputStream out = sock.getOutputStream()) {

            sock.setSoTimeout(5000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            String rawPath = parts.length > 1 ? parts[1] : "/";
            int qIdx = rawPath.indexOf('?');
            String cleanPath = qIdx >= 0 ? rawPath.substring(0, qIdx) : rawPath;
            if (cleanPath.isEmpty() || "/".equals(cleanPath)) {
                cleanPath = "/index.html";
            }
            while (cleanPath.startsWith("/")) {
                cleanPath = cleanPath.substring(1);
            }

            if ("api/rust-status".equals(cleanPath)) {
                String json = "{\"active\":" + (RustBridge.nativeGetTickCounter() > 0)
                        + ",\"banner\":\"" + RustBridge.nativeGetEngineBanner() + "\"}";
                byte[] body = json.getBytes(StandardCharsets.UTF_8);
                writeResponse(out, "200 OK", "application/json; charset=utf-8", body);
                return;
            }

            String assetPath = "www/" + cleanPath;
            byte[] payload;
            String mime;
            try {
                payload = readAssetBytes(assetPath);
                mime = guessMimeType(cleanPath);
            } catch (IOException notFound) {
                // SPA fallback to index.html
                payload = readAssetBytes("www/index.html");
                mime = "text/html; charset=utf-8";
            }

            writeResponse(out, "200 OK", mime, payload);
        } catch (Throwable ignored) {
        }
    }

    private byte[] readAssetBytes(String assetPath) throws IOException {
        try (InputStream is = assets.open(assetPath)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        }
    }

    private void writeResponse(OutputStream out, String status, String contentType, byte[] body) throws IOException {
        String headers = "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
            }
            serverSocket = null;
        }
    }
}
