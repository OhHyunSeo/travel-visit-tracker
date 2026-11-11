package app.trippainting.maptransportqa;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import okhttp3.Dispatcher;

/** Monotonic reservations with optional host journal persistence. */
final class FixtureBudget implements AutoCloseable {
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
  private FixtureBudgetJournal journal;
  private boolean closed;
  private boolean failed;
  private boolean cleanupDone;
  private final Dispatcher dispatcher = new Dispatcher();
  private final CountDownLatch closedIdle = new CountDownLatch(1);

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
    dispatcher.setMaxRequests(4);
    dispatcher.setMaxRequestsPerHost(4);
    dispatcher.setIdleCallback(() -> {
      synchronized (FixtureBudget.this) {
        if (closed) closedIdle.countDown();
      }
    });
  }

  static FixtureBudget open(Path directory, int maxAttempts, int maxTiles, int bytesPerAttempt, long maxBytes)
      throws IOException {
    FixtureBudget budget = new FixtureBudget(maxAttempts, maxTiles, bytesPerAttempt, maxBytes);
    budget.journal = FixtureBudgetJournal.open(directory, maxAttempts, maxTiles, bytesPerAttempt, maxBytes);
    Snapshot state = budget.journal.snapshot();
    budget.attempts = state.attempts;
    budget.tiles = state.tileAttempts;
    budget.bytes = state.reservedBytes;
    return budget;
  }

  synchronized void reserve(FixtureRequestPolicy.Kind kind) throws IOException {
    if (closed || failed) throw new IOException("Fixture budget is closed or failed");
    if (kind == null) throw new IOException("Missing fixture resource kind");
    boolean tile = kind == FixtureRequestPolicy.Kind.TILE;
    if (attempts == maxAttempts || (tile && tiles == maxTiles) || bytesPerAttempt > maxBytes - bytes) {
      throw new IOException("Fixture download budget exhausted");
    }
    if (journal != null) {
      try {
        journal.append(kind);
      } catch (IOException error) {
        failed = true;
        throw error;
      }
    }
    attempts++;
    if (tile) tiles++;
    bytes += bytesPerAttempt;
  }

  synchronized Snapshot snapshot() {
    return new Snapshot(attempts, tiles, bytes);
  }

  synchronized Dispatcher dispatcher() {
    if (closed || failed) throw new IllegalStateException("Fixture download session is closed or failed");
    return dispatcher;
  }

  @Override public void close() throws IOException {
    synchronized (this) {
      if (cleanupDone) return;
      closed = true;
    }
    dispatcher.cancelAll();
    if (dispatcher.runningCallsCount() == 0 && dispatcher.queuedCallsCount() == 0) closedIdle.countDown();
    try {
      if (!closedIdle.await(5, TimeUnit.SECONDS)) throw new IOException("Fixture callbacks still active; journal lock retained");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IOException("Fixture session close interrupted; journal lock retained", error);
    }
    synchronized (this) {
      if (cleanupDone) return;
      if (journal != null) journal.close();
      dispatcher.executorService().shutdown();
      cleanupDone = true;
    }
  }
}
