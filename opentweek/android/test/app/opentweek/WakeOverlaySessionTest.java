package app.opentweek;
public final class WakeOverlaySessionTest {
    static void check(boolean ok) { if (!ok) throw new AssertionError(); }
    public static void main(String[] args) {
        WakeOverlaySession s = new WakeOverlaySession(100);
        s.captured(); s.requestResume(); check(!s.takeResume(101, false));
        s.released(); check(!s.takeResume(101, true));
        check(s.takeResume(101, false)); check(!s.takeResume(101, false));
        s.captured(); s.released(); s.requestResume(); check(s.takeResume(102, false));
        check(s.remaining(102) == WakeOverlaySession.LIMIT_MS - 2);
        s.released(); s.requestResume(); s.stop(); check(!s.takeResume(103, false));
        s = new WakeOverlaySession(100); s.released(); s.requestResume();
        check(!s.takeResume(100 + WakeOverlaySession.LIMIT_MS, false));
        System.out.println("WakeOverlaySession tests passed");
    }
}
