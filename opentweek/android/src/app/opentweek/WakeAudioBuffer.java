package app.opentweek;

/** Bounded five-second PCM candidate; never written to disk. */
final class WakeAudioBuffer {
    static final int CAPACITY = 16000 * 2 * 5;
    private final byte[] ring = new byte[CAPACITY];
    private int position, size;
    void append(byte[] bytes, int length) {
        for (int i = 0; i < length; i++) {
            ring[position] = bytes[i]; position = (position + 1) % ring.length;
            if (size < ring.length) size++;
        }
    }
    byte[] snapshot() {
        byte[] result = new byte[size];
        int begin = (position - size + ring.length) % ring.length;
        for (int i = 0; i < size; i++) result[i] = ring[(begin + i) % ring.length];
        return result;
    }
    void reset() { java.util.Arrays.fill(ring, (byte)0); position = 0; size = 0; }
}
