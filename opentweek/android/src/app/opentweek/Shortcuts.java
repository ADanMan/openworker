package app.opentweek;

import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * Launcher shortcuts (long-press the app icon): "Voice task" and "New task".
 * ShortcutManager is API 25; the APK compiles against API 23, so it is reached
 * via reflection. Static shortcuts.xml cannot be used: aapt for API 23 rejects
 * its attributes.
 */
final class Shortcuts {
    private Shortcuts() {
    }

    static void install(Context c) {
        if (Build.VERSION.SDK_INT < 25) return;
        try {
            List<Object> list = new ArrayList<Object>();
            list.add(build(c, "voice", R.string.shortcut_voice, R.drawable.ic_shortcut_mic, MainActivity.ACTION_VOICE));
            list.add(build(c, "new", R.string.shortcut_new, R.drawable.ic_shortcut_add, MainActivity.ACTION_NEW));
            Class<?> managerClass = Class.forName("android.content.pm.ShortcutManager");
            Object manager = c.getSystemService(managerClass);
            managerClass.getMethod("setDynamicShortcuts", List.class).invoke(manager, list);
        } catch (Exception ignored) {
            // Launchers without shortcut support: nothing to do.
        }
    }

    private static Object build(Context c, String id, int label, int icon, String action) throws Exception {
        Intent intent = new Intent(action);
        intent.setClass(c, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Class<?> builderClass = Class.forName("android.content.pm.ShortcutInfo$Builder");
        Object b = builderClass.getConstructor(Context.class, String.class).newInstance(c, id);
        call(builderClass, b, "setShortLabel", CharSequence.class, c.getString(label));
        call(builderClass, b, "setLongLabel", CharSequence.class, c.getString(label));
        call(builderClass, b, "setIcon", Icon.class, Icon.createWithResource(c, icon));
        call(builderClass, b, "setIntent", Intent.class, intent);
        return builderClass.getMethod("build").invoke(b);
    }

    private static void call(Class<?> cls, Object target, String name, Class<?> arg, Object value) throws Exception {
        Method m = cls.getMethod(name, arg);
        m.invoke(target, value);
    }
}
