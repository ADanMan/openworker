package app.opentweek;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Reminder schedule owned by the OS (AlarmManager), so reminders fire while the
 * app is closed. The last schedule is persisted to re-arm alarms after reboot.
 *
 * Compiled against API 23: newer APIs (NotificationChannel, 26+) are reached via
 * reflection so the APK can be built with the Debian/Ubuntu android.jar.
 */
final class Reminders {
    static final String CHANNEL = "reminders";
    private static final String PREFS = "reminders";
    private static final String KEY = "schedule";
    private static final int FLAG_IMMUTABLE = 0x04000000; // PendingIntent.FLAG_IMMUTABLE (API 23)

    private Reminders() {
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            Class<?> channel = Class.forName("android.app.NotificationChannel");
            Object ch = channel.getConstructor(String.class, CharSequence.class, int.class)
                    .newInstance(CHANNEL, c.getString(R.string.channel_reminders), 4 /* IMPORTANCE_HIGH */);
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.getClass().getMethod("createNotificationChannel", channel).invoke(nm, ch);
        } catch (Exception ignored) {
        }
    }

    static boolean notificationsAllowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT < 24) return true;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            return (Boolean) nm.getClass().getMethod("areNotificationsEnabled").invoke(nm);
        } catch (Exception e) {
            return true;
        }
    }

    static synchronized void replace(Context c, String json) {
        SharedPreferences prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancel(c, prefs.getString(KEY, "[]"));
        prefs.edit().putString(KEY, json == null ? "[]" : json).apply();
        schedule(c, json);
    }

    /** Re-arm the persisted schedule (after reboot or app update). */
    static synchronized void restore(Context c) {
        schedule(c, c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"));
    }

    private static Intent intentFor(Context c, JSONObject r) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.putExtra("id", r.optInt("id"));
        i.putExtra("title", r.optString("title"));
        i.putExtra("body", r.optString("body"));
        i.putExtra("taskId", r.optString("taskId"));
        i.putExtra("date", r.optString("date"));
        return i;
    }

    private static void schedule(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        long now = System.currentTimeMillis();
        try {
            JSONArray items = new JSONArray(json);
            for (int n = 0; n < items.length(); n++) {
                JSONObject r = items.getJSONObject(n);
                long at = r.getLong("at");
                if (at <= now) continue;
                PendingIntent pi = PendingIntent.getBroadcast(c, r.getInt("id"), intentFor(c, r),
                        PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
                try {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } catch (SecurityException e) {
                    // Exact alarms revoked by the user: fall back to an inexact one.
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static void cancel(Context c, String json) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        try {
            JSONArray items = new JSONArray(json);
            for (int n = 0; n < items.length(); n++) {
                JSONObject r = items.getJSONObject(n);
                PendingIntent pi = PendingIntent.getBroadcast(c, r.getInt("id"), intentFor(c, r),
                        PendingIntent.FLAG_NO_CREATE | FLAG_IMMUTABLE);
                if (pi != null) {
                    am.cancel(pi);
                    pi.cancel();
                }
            }
        } catch (Exception ignored) {
        }
    }
}
