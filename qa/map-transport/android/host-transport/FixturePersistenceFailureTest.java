package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.http.HttpResponder;

public final class FixturePersistenceFailureTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static final class Failure implements HttpResponder {
    final AtomicInteger callbacks = new AtomicInteger();
    final CompletableFuture<Integer> result = new CompletableFuture<>();

    @Override public void onResponse(int code, String etag, String modified, String cache, String expires,
        String retry, String reset, byte[] body) {
      callbacks.incrementAndGet();
      result.completeExceptionally(new AssertionError("Persistence failure delivered body"));
    }

    @Override public void handleFailure(int type, String message) {
      callbacks.incrementAndGet();
      result.complete(type);
    }
  }

  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("trip-journal-failure-").toRealPath();
    HttpServer server = HttpServer.create();
    AtomicInteger requests = new AtomicInteger();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", exchange -> {
        requests.incrementAndGet();
        exchange.sendResponseHeaders(500, -1);
        exchange.close();
      });
      server.start();
      int port = server.getAddress().getPort();
      String url = "http://127.0.0.1:" + port + "/resource/tile/0_0_0";
      for (String fault : new String[]{"partial-tail", "modified", "permissions"}) {
        Path directory = Files.createDirectory(root.resolve(fault),
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        try (FixtureBudget budget = FixtureBudget.open(directory, 2, 2, 4, 8);
             FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
          Path journal = directory.resolve("budget.journal");
          if (fault.equals("partial-tail")) Files.write(journal, new byte[]{1}, StandardOpenOption.APPEND);
          else if (fault.equals("modified")) Files.setLastModifiedTime(journal,
              FileTime.fromMillis(Files.getLastModifiedTime(journal).toMillis() + 10_000));
          else Files.setPosixFilePermissions(journal, PosixFilePermissions.fromString("rw-r--r--"));
          byte[] failedBytes = Files.readAllBytes(journal);
          for (int attempt = 0; attempt < 2; attempt++) {
            Failure failure = new Failure();
            new FixtureMapLibreRequest(client).executeRequest(failure, 0, url, "", "", "", true);
            check(failure.result.get(2, TimeUnit.SECONDS) == 2 && failure.callbacks.get() == 1,
                "one failure callback for " + fault);
          }
          budget.close();
          check(budget.snapshot().attempts == 0 && budget.snapshot().reservedBytes == 0, "failed reservation not reported successful");
          check(Arrays.equals(failedBytes, Files.readAllBytes(journal)), "failed journal bytes retained");
          check(requests.get() == 0, "journal failure prevented HTTP request headers");
        }
      }
      System.out.println("FixturePersistenceFailure PASS: partial tail, timestamp and permissions block HTTP and preserve bytes");
    } finally {
      server.stop(0);
      try (java.util.stream.Stream<Path> paths = Files.walk(root)) {
        for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) Files.delete(path);
      }
    }
  }
}
