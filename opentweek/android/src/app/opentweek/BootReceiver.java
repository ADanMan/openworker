package app.opentweek;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms do not survive a reboot or an app update; re-arm them from the saved schedule. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        Reminders.restore(c);
    }
}
