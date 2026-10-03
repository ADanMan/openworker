package app.opentweek;

public final class WakePhraseTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        String[] rejected = {"эй", "твик", "эй твикс", "эй твик запиши", "эй твик эй твик", "привет твик", "[unk]", "эй тви к", "hey tweek"};
        for (String text : rejected) {
            for (String verified : new String[]{"ты", "эй вик", "эй твитер", "ты твик"}) {
            WakePhrase dual = new WakePhrase(100);
            check(!dual.recognized("эй твик", verified, true, 101));
        }
        WakePhrase gate = new WakePhrase(100);
            check(!gate.recognized(text, text, true, 101));
            check(gate.state() == WakePhrase.State.WAITING);
        }
        for (String verified : new String[]{"ты", "эй вик", "эй твитер", "ты твик"}) {
            WakePhrase dual = new WakePhrase(100);
            check(!dual.recognized("эй твик", verified, true, 101));
        }
        WakePhrase gate = new WakePhrase(100);
        check(!gate.recognized("эй твик", "эй твик", false, 101));
        check(gate.recognized(" ЭЙ, ТВИК! ", "эй твик", true, 102));
        check(!gate.recognized("эй твик", "эй твик", true, 103));
        check(gate.finish()); check(!gate.finish());
        check(!gate.recognized("эй твик", "эй твик", true, 104));
        gate = new WakePhrase(100); gate.cancel();
        check(!gate.recognized("эй твик", "эй твик", true, 101)); check(!gate.finish());
        gate = new WakePhrase(100);
        check(!gate.expired(100 + WakePhrase.WAIT_LIMIT_MS - 1));
        check(!gate.recognized("эй твик", "эй твик", true, 100 + WakePhrase.WAIT_LIMIT_MS));
        check(gate.expired(100 + WakePhrase.WAIT_LIMIT_MS + 1));
        check(gate.state() == WakePhrase.State.DONE);
        System.out.println("WakePhrase tests passed");
    }
}
