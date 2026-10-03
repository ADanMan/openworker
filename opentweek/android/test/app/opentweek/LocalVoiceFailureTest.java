package app.opentweek;

import java.io.IOException;

/** Prevent platform failures from being mistaken for recognizer silence. */
public final class LocalVoiceFailureTest {
    public static void main(String[] args) {
        equal("permission_denied", LocalVoiceFailure.recognition(new SecurityException("private detail")));
        equal("microphone_silenced", LocalVoiceFailure.recognition(new LocalVoiceFailure("microphone_silenced")));
        equal("microphone_disconnected", LocalVoiceFailure.readError(-6));
        equal("microphone_read_failed", LocalVoiceFailure.readError(-3));
        equal("microphone_read_failed", LocalVoiceFailure.readError(-2));
        equal("recognition_failed", LocalVoiceFailure.recognition(new IOException("private detail")));
        equal("recognition_failed", LocalVoiceFailure.recognition(new LinkageError("private path")));
        equal("foreground_service_denied", LocalVoiceFailure.service(new SecurityException("private detail")));
        equal("foreground_service_unavailable", LocalVoiceFailure.service(new IllegalStateException("private detail")));
        System.out.println("LocalVoiceFailure tests passed");
    }
    private static void equal(String want, String actual) {
        if (!want.equals(actual)) throw new AssertionError("Expected " + want + ", got " + actual);
    }
}
