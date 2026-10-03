package app.opentweek;

import java.io.*;
import java.util.zip.*;

/** Pure Java archive policy; no audio or Android dependency. */
final class LocalVoiceModel {
    static final String NAME = "vosk-model-small-ru-0.22";
    static final String URL = "https://alphacephei.com/vosk/models/" + NAME + ".zip";
    // Official archive independently downloaded and verified during implementation.
    static final long BYTES = 46236750L;
    static final String SHA256 = "961d5ff98a17f4aa6de69864d0aa71fa5bac682301d2b5d17a3f24c5c99a46d4";
    interface Check { void check() throws IOException; }
    static void unpack(File archive, File stage, Check check) throws Exception {
        long total = 0; int entries = 0;
        String root = stage.getCanonicalPath() + File.separator;
        try (ZipInputStream zip = new ZipInputStream(new FileInputStream(archive))) {
            ZipEntry entry;
            byte[] buffer = new byte[32768];
            while ((entry = zip.getNextEntry()) != null) {
                check.check();
                if (++entries > 2000) throw new IOException("Too many archive entries");
                String name = entry.getName();
                if (!name.startsWith(NAME + "/") || name.contains("\\") || name.contains("../"))
                    throw new IOException("Unsafe archive path");
                File output = new File(stage, name);
                if (!output.getCanonicalPath().startsWith(root)) throw new IOException("Unsafe archive path");
                if (entry.isDirectory()) { if (!output.mkdirs() && !output.isDirectory()) throw new IOException("Cannot create directory"); continue; }
                if (!output.getParentFile().mkdirs() && !output.getParentFile().isDirectory()) throw new IOException("Cannot create directory");
                if (output.exists()) throw new IOException("Duplicate archive entry");
                try (OutputStream out = new FileOutputStream(output)) {
                    int n;
                    while ((n = zip.read(buffer)) != -1) {
                        check.check(); total += n;
                        if (total > 256L * 1024 * 1024) throw new IOException("Model archive too large");
                        out.write(buffer, 0, n);
                    }
                }
            }
        }
        if (!valid(new File(stage, NAME))) throw new IOException("Incomplete model");
    }
    static boolean valid(File directory) {
        return new File(directory, "am/final.mdl").isFile()
            && new File(directory, "conf/model.conf").isFile()
            && new File(directory, "graph/Gr.fst").isFile();
    }
    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
    static void delete(File file) {
        File[] files = file.listFiles();
        if (files != null) for (File child : files) delete(child);
        file.delete();
    }
}
