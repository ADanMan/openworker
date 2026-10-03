package app.opentweek;

import java.io.*;
import java.nio.file.Files;
import java.util.zip.*;

/** JVM regression checks: archive path traversal, bounds, cancellation, required structure. */
public final class LocalVoiceModelTest {
    static File zip(File base, String[] names) throws Exception {
        File f = new File(base, "test.zip");
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(f))) {
            for (String name : names) { out.putNextEntry(new ZipEntry(name)); out.write(1); out.closeEntry(); }
        }
        return f;
    }
    static void reject(String... names) throws Exception {
        File base = Files.createTempDirectory("voice-policy").toFile();
        try {
            File archive = zip(base, names), stage = new File(base, "stage"); stage.mkdir();
            try { LocalVoiceModel.unpack(archive, stage, () -> {}); throw new AssertionError("Accepted invalid ZIP"); }
            catch (IOException expected) { }
        } finally { LocalVoiceModel.delete(base); }
    }
    public static void main(String[] args) throws Exception {
        String prefix = LocalVoiceModel.NAME + "/";
        reject(prefix + "../../outside");
        reject("/absolute");
        reject(prefix + "..\\outside");
        reject("other/model");
        reject(prefix + "am/final.mdl");
        String[] many = new String[2001];
        for (int i = 0; i < many.length; i++) many[i] = prefix + "item" + i;
        reject(many);
        File base = Files.createTempDirectory("voice-policy").toFile();
        try {
            File archive = zip(base, new String[]{prefix + "am/final.mdl", prefix + "conf/model.conf", prefix + "graph/Gr.fst"});
            File stage = new File(base, "stage"); stage.mkdir();
            LocalVoiceModel.unpack(archive, stage, () -> {});
            if (!LocalVoiceModel.valid(new File(stage, LocalVoiceModel.NAME))) throw new AssertionError("Valid ZIP rejected");
            try { LocalVoiceModel.unpack(archive, new File(base, "cancelled"), () -> { throw new IOException("cancelled"); }); throw new AssertionError("Cancellation ignored"); }
            catch (IOException expected) { }
            if (new File(base, "cancelled").exists()) throw new AssertionError("Cancelled extraction wrote files");
        } finally { LocalVoiceModel.delete(base); }
        File largeBase = Files.createTempDirectory("voice-limit").toFile();
        try {
            File archive = new File(largeBase, "large.zip");
            try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(archive))) {
                out.putNextEntry(new ZipEntry(prefix + "oversized"));
                byte[] block = new byte[1024 * 1024];
                for (int i = 0; i < 257; i++) out.write(block);
            }
            try { LocalVoiceModel.unpack(archive, new File(largeBase, "stage"), () -> {}); throw new AssertionError("Expansion bound ignored"); }
            catch (IOException expected) { }
        } finally { LocalVoiceModel.delete(largeBase); }
        if (LocalVoiceModel.BYTES != 46236750L || LocalVoiceModel.SHA256.length() != 64) throw new AssertionError("Missing model pin");
        System.out.println("LocalVoiceModel policy checks passed");
    }
}
