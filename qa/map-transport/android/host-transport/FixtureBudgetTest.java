package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureBudgetTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void get(FixtureHttpClient client, String url) throws IOException {
    try (Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
      check(response.code() == 200 && "ab".equals(response.body().string()), "complete fixture body");
    }
  }

  private static void exhausted(FixtureHttpClient client, String url) throws IOException {
    try {
      get(client, url);
    } catch (IOException expected) {
      check(expected.getMessage().contains("budget exhausted"), "budget refusal");
      return;
    }
    throw new AssertionError("Exhausted download sent a request");
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create();
    AtomicInteger requests = new AtomicInteger();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/", exchange -> {
        requests.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write(new byte[]{'a', 'b'});
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = "http://127.0.0.1:" + port;
      String tile = base + "/resource/tile/0_0_0";
      FixtureBudget budget = new FixtureBudget(4, 2, 4, 20);
      try (FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        get(client, base + "/resource/style/sdk");
        get(client, tile);
        get(client, tile);
        exhausted(client, tile);
        check(requests.get() == 3, "repeated tile charged twice, third blocked before send");
        get(client, base + "/resource/glyph/QA/0-255.pbf");
        exhausted(client, base + "/resource/sprite/mixed.png");
        FixtureBudget.Snapshot snapshot = budget.snapshot();
        check(snapshot.attempts == 4 && snapshot.tileAttempts == 2 && snapshot.reservedBytes == 16,
            "all resource reservations retained after completion");
      }
      FixtureBudget byteBudget = new FixtureBudget(5, 2, 4, 8);
      try (FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), byteBudget)) {
        get(client, base + "/resource/style/sdk");
        get(client, base + "/resource/glyph/QA/0-255.pbf");
        exhausted(client, base + "/resource/sprite/mixed.png");
        FixtureBudget.Snapshot snapshot = byteBudget.snapshot();
        check(snapshot.attempts == 2 && snapshot.tileAttempts == 0 && snapshot.reservedBytes == 8,
            "fixed byte reservation exhausted by nontile resources");
      }
      FixtureBudget smallBody = new FixtureBudget(2, 1, 1, 2);
      try (FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), smallBody)) {
        try {
          get(client, tile);
          throw new AssertionError("Response exceeded its per-request reservation");
        } catch (IOException expected) {
          check(expected.getMessage().contains("exceeds reservation"), "stream rejected before callback body acceptance");
        }
        FixtureBudget.Snapshot snapshot = smallBody.snapshot();
        check(snapshot.attempts == 1 && snapshot.tileAttempts == 1 && snapshot.reservedBytes == 1,
            "rejected response reservation retained");
      }
      check(requests.get() == 7, "only admitted requests reached server");
      System.out.println("FixtureBudget PASS: repeated tile, total attempts, nontile bytes and rejected response charge");
    } finally {
      server.stop(0);
    }
  }
}
