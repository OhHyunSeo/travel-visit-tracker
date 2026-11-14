import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** Relays up to two synthetic TLS connections without terminating TLS in the guest. */
public final class FixtureLoopbackRelay {
  static final int DIRECTION_LIMIT = 65_536;

  public static void main(String[] args) throws IOException, InterruptedException {
    if ((args.length != 1 && !(args.length == 2 && "--raster-tile".equals(args[1])))
        || !args[0].matches("[1-9][0-9]{3,4}")) {
      throw new IllegalArgumentException("Usage: FixtureLoopbackRelay <fixture port> [--raster-tile]");
    }
    int port = Integer.parseInt(args[0]);
    if (port < 1024 || port > 65535) throw new IllegalArgumentException("Invalid fixture port");
    try (ServerSocket listener = new ServerSocket()) {
      listener.bind(new InetSocketAddress("127.0.0.1", port), 1);
      System.out.println("RELAY_READY port=" + port);
      InetSocketAddress upstream = new InetSocketAddress("10.0.2.2", port);
      if (args.length == 1) {
        System.out.println("RELAY_COMPLETE forwarded=" + relayOnce(listener, upstream, 30_000));
      } else {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        int bytes = relayConnection(listener, upstream, deadline, false);
        bytes += relayConnection(listener, upstream, deadline, true);
        System.out.println("RELAY_COMPLETE connections=2 forwarded=" + bytes);
      }
    }
  }

  static int relayOnce(ServerSocket listener, InetSocketAddress target, int timeoutMillis)
      throws IOException, InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
    return relayConnection(listener, target, deadline, true);
  }

  private static int relayConnection(ServerSocket listener, InetSocketAddress target, long deadline, boolean last)
      throws IOException, InterruptedException {
    listener.setSoTimeout(remainingMillis(deadline));
    ExecutorService workers = Executors.newFixedThreadPool(2);
    try (Socket client = listener.accept(); Socket upstream = new Socket()) {
      if (last) listener.close();
      upstream.connect(target, Math.min(2_000, remainingMillis(deadline)));
      ExecutorCompletionService<Integer> transfers = new ExecutorCompletionService<>(workers);
      transfers.submit(() -> copy(client, upstream));
      transfers.submit(() -> copy(upstream, client));
      return await(transfers, deadline) + await(transfers, deadline);
    } finally {
      workers.shutdownNow();
      if (!workers.awaitTermination(2, TimeUnit.SECONDS)) throw new IOException("Fixture relay workers did not terminate");
    }
  }

  private static int copy(Socket from, Socket to) throws IOException {
    InputStream input = from.getInputStream();
    OutputStream output = to.getOutputStream();
    byte[] buffer = new byte[4096];
    int forwarded = 0;
    while (true) {
      int read = input.read(buffer, 0, Math.min(buffer.length, DIRECTION_LIMIT - forwarded + 1));
      if (read == -1) {
        to.shutdownOutput();
        return forwarded;
      }
      if (read > DIRECTION_LIMIT - forwarded) throw new IOException("Fixture relay byte limit exceeded");
      output.write(buffer, 0, read);
      forwarded += read;
    }
  }

  private static int await(ExecutorCompletionService<Integer> transfers, long deadline)
      throws IOException, InterruptedException {
    Future<Integer> finished = transfers.poll(remainingMillis(deadline), TimeUnit.MILLISECONDS);
    if (finished == null) throw new SocketTimeoutException("Fixture relay deadline exceeded");
    try {
      return finished.get();
    } catch (ExecutionException error) {
      throw new IOException("Fixture relay transfer failed", error.getCause());
    }
  }

  private static int remainingMillis(long deadline) throws SocketTimeoutException {
    long remaining = deadline - System.nanoTime();
    if (remaining <= 0) throw new SocketTimeoutException("Fixture relay deadline exceeded");
    return (int) Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining));
  }
}
