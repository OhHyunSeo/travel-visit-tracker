package app.trippainting.maptransportqa;

import java.io.IOException;

/** Monotonic in-memory reservations for one synthetic download session. */
final class FixtureBudget {
  static final class Snapshot {
    final int attempts;
    final int tileAttempts;
    final long reservedBytes;

    Snapshot(int attempts, int tileAttempts, long reservedBytes) {
      this.attempts = attempts;
      this.tileAttempts = tileAttempts;
      this.reservedBytes = reservedBytes;
    }
  }

  final int bytesPerAttempt;
  private final int maxAttempts;
  private final int maxTiles;
  private final long maxBytes;
  private int attempts;
  private int tiles;
  private long bytes;

  FixtureBudget(int maxAttempts, int maxTiles, int bytesPerAttempt, long maxBytes) {
    if (maxAttempts < 1 || maxAttempts > 10_000 || maxTiles < 0 || maxTiles > 2_500
        || maxTiles > maxAttempts || bytesPerAttempt < 1 || bytesPerAttempt > 65_536
        || maxBytes < bytesPerAttempt || maxBytes > 50_000_000) {
      throw new IllegalArgumentException("Invalid fixture reservation limits");
    }
    this.maxAttempts = maxAttempts;
    this.maxTiles = maxTiles;
    this.bytesPerAttempt = bytesPerAttempt;
    this.maxBytes = maxBytes;
  }

  synchronized void reserve(FixtureRequestPolicy.Kind kind) throws IOException {
    if (kind == null) throw new IOException("Missing fixture resource kind");
    boolean tile = kind == FixtureRequestPolicy.Kind.TILE;
    if (attempts == maxAttempts || (tile && tiles == maxTiles) || bytesPerAttempt > maxBytes - bytes) {
      throw new IOException("Fixture download budget exhausted");
    }
    attempts++;
    if (tile) tiles++;
    bytes += bytesPerAttempt;
  }

  synchronized Snapshot snapshot() {
    return new Snapshot(attempts, tiles, bytes);
  }
}
