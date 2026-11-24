import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;

/**
 * Generates a 192x192 PNG launcher icon and packages the Android APK with strict
 * Android 11-15 PackageInstaller compliance:
 *  - `resources.arsc` and `lib/*.so` are written with ZIP method 0 (ZipEntry.STORED)
 *  - All paths use forward slashes (`/`)
 */
public final class ApkPackager {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            throw new IllegalArgumentException("Usage: ApkPackager <mode: icon|pack> <paths...>");
        }
        String mode = args[0];
        if ("icon".equals(mode)) {
            generateLauncherIconPng(new File(args[1]));
        } else if ("pack".equals(mode)) {
            packApkDirectory(new File(args[1]).toPath(), new File(args[2]));
        } else {
            throw new IllegalArgumentException("Unknown mode: " + mode);
        }
    }

    private static void generateLauncherIconPng(File outFile) throws IOException {
        int size = 192;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        // Rounded Dark Void Background
        g.setPaint(new GradientPaint(0, 0, new Color(0x16, 0x0F, 0x29), 0, size, new Color(0x07, 0x05, 0x0E)));
        g.fillRoundRect(4, 4, size - 8, size - 8, 42, 42);

        // Golden Runic Shield Border
        g.setColor(new Color(0xC8, 0x9B, 0x3C));
        g.setStroke(new BasicStroke(6f));
        g.drawRoundRect(8, 8, size - 16, size - 16, 38, 38);

        // Golden Shattered Crown
        Polygon crown = new Polygon(
                new int[]{36, 56, 74, 96, 118, 136, 156, 144, 48},
                new int[]{68, 102, 58, 92, 58, 102, 68, 136, 136},
                9
        );
        g.setPaint(new GradientPaint(0, 48, new Color(0xFF, 0xF3, 0xBF), 0, 140, new Color(0xC8, 0x9B, 0x3C)));
        g.fillPolygon(crown);
        g.setColor(new Color(0xFF, 0xF9, 0xDB));
        g.setStroke(new BasicStroke(2.5f));
        g.drawPolygon(crown);

        // Crimson Abyssal Gem in Center
        Polygon gem = new Polygon(
                new int[]{96, 112, 96, 80},
                new int[]{86, 110, 132, 110},
                4
        );
        g.setColor(new Color(0xE0, 0x31, 0x31));
        g.fillPolygon(gem);
        g.setColor(new Color(0xFF, 0xC9, 0xC9));
        g.drawPolygon(gem);

        g.dispose();
        outFile.getParentFile().mkdirs();
        ImageIO.write(img, "PNG", outFile);
    }

    private static void packApkDirectory(Path rootDir, File outApk) throws IOException {
        List<Path> files;
        try (Stream<Path> walk = Files.walk(rootDir)) {
            files = walk.filter(Files::isRegularFile).sorted().collect(Collectors.toList());
        }

        try (FileOutputStream fos = new FileOutputStream(outApk);
             ZipOutputStream zos = new ZipOutputStream(fos)) {
            zos.setLevel(Deflater.BEST_COMPRESSION);

            for (Path file : files) {
                String relPath = rootDir.relativize(file).toString().replace('\\', '/');
                byte[] data = Files.readAllBytes(file);

                ZipEntry entry = new ZipEntry(relPath);
                boolean mustStoreUncompressed = "resources.arsc".equals(relPath)
                        || relPath.endsWith(".so")
                        || relPath.endsWith(".png");

                if (mustStoreUncompressed) {
                    entry.setMethod(ZipEntry.STORED);
                    entry.setSize(data.length);
                    entry.setCompressedSize(data.length);
                    CRC32 crc = new CRC32();
                    crc.update(data);
                    entry.setCrc(crc.getValue());
                } else {
                    entry.setMethod(ZipEntry.DEFLATED);
                }

                zos.putNextEntry(entry);
                zos.write(data);
                zos.closeEntry();
            }
        }
    }
}
