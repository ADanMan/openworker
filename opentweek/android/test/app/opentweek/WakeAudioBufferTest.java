package app.opentweek;

public final class WakeAudioBufferTest {
    public static void main(String[] args) {
        WakeAudioBuffer ring = new WakeAudioBuffer();
        byte[] input = new byte[WakeAudioBuffer.CAPACITY + 32];
        for (int i = 0; i < input.length; i++) input[i] = (byte)i;
        ring.append(input, input.length);
        byte[] result = ring.snapshot();
        if (result.length != WakeAudioBuffer.CAPACITY) throw new AssertionError("not bounded");
        for (int i = 0; i < result.length; i++) if (result[i] != input[i + 32]) throw new AssertionError("order");
        ring.reset(); if (ring.snapshot().length != 0) throw new AssertionError("reset");
        ring.append(new byte[]{1, 2, 3}, 3);
        result = ring.snapshot(); if (result.length != 3 || result[0] != 1 || result[2] != 3) throw new AssertionError();
        System.out.println("WakeAudioBuffer tests passed");
    }
}
