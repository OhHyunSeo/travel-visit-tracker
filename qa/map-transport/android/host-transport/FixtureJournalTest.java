package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureJournalTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static FixtureBudget open(Path root) throws IOException {
    return FixtureBudget.open(root, 5, 2, 4, 20);
  }

  private static void refuse(Callable<?> operation, String message) throws Exception {
    try {
      Object unexpected = operation.call();
      if (unexpected instanceof AutoCloseable) ((AutoCloseable) unexpected).close();
    } catch (IOException expected) {
      check(expected.getMessage().contains(message), "unexpected refusal: " + expected);
      return;
    }
    throw new AssertionError("Expected refusal: " + message);
  }

  private static void get(FixtureHttpClient client, String url) throws IOException {
    try (Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
      check(response.code() == 200 && "a".equals(response.body().string()), "complete body");
    }
  }

  private static void remove(Path root) throws IOException {
    try (java.util.stream.Stream<Path> paths = Files.walk(root)) {
      for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) Files.delete(path);
    }
  }

  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("trip-journal-test-").toRealPath();
    HttpServer server = HttpServer.create();
    AtomicInteger requests = new AtomicInteger();
    AtomicBoolean journalBeforeRequest = new AtomicBoolean(true);
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", exchange -> {
        int current = requests.incrementAndGet();
        if (Files.size(root.resolve("budget.journal")) < 28 + current * 24L) journalBeforeRequest.set(false);
        try {
          exchange.sendResponseHeaders(200, 1);
          exchange.getResponseBody().write('a');
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = "http://127.0.0.1:" + port;
      String tile = base + "/resource/tile/0_0_0";
      try (FixtureBudget budget = open(root);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        refuse(() -> open(root), "already in use");
        get(client, tile);
        get(client, base + "/resource/style/sdk");
      }
      try (FixtureBudget budget = open(root);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        FixtureBudget.Snapshot restored = budget.snapshot();
        check(restored.attempts == 2 && restored.tileAttempts == 1 && restored.reservedBytes == 8, "reopened reservation totals");
        get(client, tile);
        refuse(() -> { get(client, tile); return null; }, "budget exhausted");
        check(budget.snapshot().attempts == 3 && budget.snapshot().reservedBytes == 12, "replay charged again");
      }
      check(requests.get() == 3 && journalBeforeRequest.get(), "reservation records observed before each server request");
      refuse(() -> FixtureBudget.open(root, 6, 2, 4, 24), "limits or header differ");

      try (FixtureBudget budget = open(root)) {
        Files.write(root.resolve("budget.journal"), new byte[]{1}, StandardOpenOption.APPEND);
        refuse(() -> { budget.reserve(FixtureRequestPolicy.Kind.STYLE); return null; }, "changed size");
        refuse(() -> { budget.reserve(FixtureRequestPolicy.Kind.STYLE); return null; }, "closed or failed");
      }
      long tornSize = Files.size(root.resolve("budget.journal"));
      refuse(() -> open(root), "journal length");
      check(Files.size(root.resolve("budget.journal")) == tornSize, "torn journal retained");

      Path concurrent = Files.createDirectory(root.resolve("concurrent"),
          java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rwx------")));
      ExecutorService workers = Executors.newFixedThreadPool(8);
      try (FixtureBudget budget = FixtureBudget.open(concurrent, 4, 2, 4, 16)) {
        List<Callable<Boolean>> work = new ArrayList<>();
        for (int index = 0; index < 12; index++) work.add(() -> {
          try {
            budget.reserve(FixtureRequestPolicy.Kind.STYLE);
            return true;
          } catch (IOException exhausted) {
            return false;
          }
        });
        int accepted = 0;
        for (Future<Boolean> future : workers.invokeAll(work)) if (future.get()) accepted++;
        check(accepted == 4 && budget.snapshot().reservedBytes == 16, "concurrent reservations serialized at cap");
      } finally {
        workers.shutdownNow();
      }
      try (FixtureBudget restored = FixtureBudget.open(concurrent, 4, 2, 4, 16)) {
        check(restored.snapshot().attempts == 4 && restored.snapshot().reservedBytes == 16, "concurrent totals persisted");
      }

      Path corrupt = Files.createDirectory(root.resolve("corrupt"),
          java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rwx------")));
      try (FixtureBudget budget = open(corrupt)) {
        budget.reserve(FixtureRequestPolicy.Kind.GLYPH);
      }
      Path corruptFile = corrupt.resolve("budget.journal");
      byte[] damaged = Files.readAllBytes(corruptFile);
      damaged[damaged.length - 1] ^= 1;
      Files.write(corruptFile, damaged, StandardOpenOption.TRUNCATE_EXISTING);
      refuse(() -> open(corrupt), "reservation record");
      check(java.util.Arrays.equals(Files.readAllBytes(corruptFile), damaged), "corrupt journal retained");

      Path links = Files.createDirectory(root.resolve("links"),
          java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rwx------")));
      Path link = links.resolve("budget.journal");
      Files.createSymbolicLink(link, concurrent.resolve("budget.journal"));
      refuse(() -> FixtureBudget.open(links, 4, 2, 4, 16), "private regular file");
      Files.delete(link);
      Files.createLink(link, concurrent.resolve("budget.journal"));
      refuse(() -> FixtureBudget.open(links, 4, 2, 4, 16), "private regular file");
      System.out.println("FixtureJournal PASS: write before send, reopen, exclusive lock, fixed limits, torn file, links and concurrent cap");
    } finally {
      server.stop(0);
      remove(root);
    }
  }
}
