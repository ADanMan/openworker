package app.opentweek;

import java.util.Locale;

/** Pure gate: only a finalized exact wake phrase can activate one dictation. */
final class WakePhrase {
    static final long WAIT_LIMIT_MS = 5 * 60 * 1000;
    enum State { WAITING, RECORDING, DONE }
    private volatile State state = State.WAITING;
    private final long started;
    private final long waitLimit;
    private boolean timedOut;
    WakePhrase(long started) { this(started, WAIT_LIMIT_MS); }
    WakePhrase(long started, long waitLimit) { this.started = started; this.waitLimit = Math.max(1, waitLimit); }
    State state() { return state; }
    boolean expired(long now) {
        if (state == State.WAITING && now - started >= waitLimit) { state = State.DONE; timedOut = true; return true; }
        return timedOut;
    }
    boolean recognized(String text, String verifiedText, boolean finalized, long now) {
        if (expired(now) || state != State.WAITING || !finalized) return false;
        if (!matches(text) || !matches(verifiedText)) return false;
        state = State.RECORDING;
        return true;
    }
    static boolean matches(String text) {
        String normalized = text == null ? "" : text.toLowerCase(Locale.ROOT)
            .replaceAll("[\\p{P}\\p{Z}\\s]+", " ").trim();
        return "эй твик".equals(normalized);
    }
    void cancel() { state = State.DONE; }
    boolean finish() {
        if (state != State.RECORDING) return false;
        state = State.DONE; return true;
    }
}
