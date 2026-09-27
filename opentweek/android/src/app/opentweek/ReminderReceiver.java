package app.opentweek;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Fires when a reminder's alarm goes off and posts the notification. */
public class ReminderReceiver extends BroadcastReceiver {
    private static final int FLAG_IMMUTABLE = 0x04000000;

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Reminders.notificationsAllowed(c)) return;
        Reminders.createChannel(c);
        int id = intent.getIntExtra("id", 0);

        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra("taskId", intent.getStringExtra("taskId"));
        open.putExtra("date", intent.getStringExtra("date"));
        PendingIntent content = PendingIntent.getActivity(c, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);

        Notification.Builder b = new Notification.Builder(c)
                .setSmallIcon(R.drawable.ic_stat_opentweek)
                .setColor(0xFF2F6CF6)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setContentIntent(content)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL);
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                Notification.Builder.class.getMethod("setChannelId", String.class).invoke(b, Reminders.CHANNEL);
            } catch (Exception ignored) {
            }
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(id, b.build());
    }
}
