package app.opentweek;

import java.io.IOException;

/** Stable, non-sensitive error codes crossing the native bridge. */
final class LocalVoiceFailure extends IOException {
    LocalVoiceFailure(String code) { super(code); }
    static String recognition(Throwable error) {
        if (error instanceof SecurityException) return "permission_denied";
        if (error instanceof LocalVoiceFailure) return error.getMessage();
        return "recognition_failed";
    }
    static String service(RuntimeException error) {
        return error instanceof SecurityException ? "foreground_service_denied" : "foreground_service_unavailable";
    }
    static String readError(int result) {
        // AudioRecord.ERROR_DEAD_OBJECT (-6): the native capture object needs recreation.
        return result == -6 ? "microphone_disconnected" : "microphone_read_failed";
    }
}
