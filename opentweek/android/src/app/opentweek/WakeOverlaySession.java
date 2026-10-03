package app.opentweek;

/** A single explicit consent permits repeat captures until stop or the original one-hour deadline. */
final class WakeOverlaySession {
    static final long LIMIT_MS = 60 * 60 * 1000;
    private final long deadline;
    private volatile boolean stopped;
    private boolean released, resume;
    WakeOverlaySession(long now) { deadline = now + LIMIT_MS; }
    long remaining(long now) { return stopped ? 0 : Math.max(0, deadline - now); }
    void stop() { stopped = true; resume = false; }
    void captured() { released = false; resume = false; }
    void released() { released = true; }
    void requestResume() { resume = true; }
    boolean takeResume(long now, boolean pendingResult) {
        if (!resume || !released || pendingResult || remaining(now) == 0) return false;
        resume = false; released = false; return true;
    }
}
