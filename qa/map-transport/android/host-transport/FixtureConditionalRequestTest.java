package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpsServer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.maplibre.android.http.HttpResponder;

public final class FixtureConditionalRequestTest {
  private static final String DATE = "Wed, 11 Nov 2026 12:00:00 GMT";

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static String execute(FixtureHttpClient client, String url, String etag, String modified) throws Exception {
    CompletableFuture<String> result = new CompletableFuture<>();
    new FixtureMapLibreRequest(client).executeRequest(new HttpResponder() {
      @Override public void onResponse(int code, String receivedTag, String receivedDate, String cache, String expires,
          String retry, String rate, byte[] body) {
        result.complete(code + ":" + receivedTag + ":" + new String(body, StandardCharsets.UTF_8));
      }

      @Override public void handleFailure(int type, String error) {
        result.complete("failure:" + type);
      }
    }, 0, url, "", etag, modified, false);
    return result.get(2, TimeUnit.SECONDS);
  }

  public static void main(String[] args) throws Exception {
    KeyStore keys = FixtureTlsTest.keys("loopback");
    HttpsServer server = FixtureTlsTest.server(keys);
    LinkedBlockingQueue<String> seen = new LinkedBlockingQueue<>();
    try {
      server.createContext("/resource/style/sdk", exchange -> {
        try {
          String tag = exchange.getRequestHeaders().getFirst("If-None-Match");
          String date = exchange.getRequestHeaders().getFirst("If-Modified-Since");
          seen.add(tag + "|" + date);
          exchange.getResponseHeaders().set("ETag", "\"v2\"");
          if ("\"old\"".equals(tag)) {
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write(new byte[]{'o', 'k'});
          } else {
            if (DATE.equals(date)) exchange.getResponseHeaders().set("Content-Length", "0");
            if ("\"bad-body\"".equals(tag)) exchange.getResponseHeaders().set("Content-Length", "1");
            exchange.sendResponseHeaders(304, -1);
          }
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String url = "https://127.0.0.1:" + port + "/resource/style/sdk";
      try (FixtureBudget budget = new FixtureBudget(8, 3, 4, 32);
           FixtureHttpClient client = FixtureHttpClient.https(port, chain -> chain.proceed(chain.request().newBuilder()
               .header("If-None-Match", "\"injected\"").header("If-Modified-Since", DATE).build()), budget,
               (X509Certificate) keys.getCertificate("fixture"))) {
        check("304:\"v2\":".equals(execute(client, url, "W/\"v2\"", DATE)), "empty ETag response");
        check("304:\"v2\":".equals(execute(client, url, "", DATE)), "empty date response");
        check("200:\"v2\":ok".equals(execute(client, url, "\"old\"", "")), "changed resource body");
        check("failure:2".equals(execute(client, url, "", "")), "unsolicited 304 refused");
        check("failure:2".equals(execute(client, url, "\"bad-body\"", "")), "304 with positive length refused");
        for (String tag : List.of("*", "\"a\", \"b\"", "\"a\"\r\nX: b")) {
          check("failure:2".equals(execute(client, url, tag, "")), "malformed ETag refused before sending");
        }
        check("failure:2".equals(execute(client, url, "", "Wed, 32 Nov 2026 12:00:00 GMT")),
            "malformed date refused before sending");
        check(List.copyOf(seen).equals(List.of("W/\"v2\"|null", "null|" + DATE, "\"old\"|null", "null|null", "\"bad-body\"|null")),
            "only adapter-selected validator reaches the server");
        FixtureBudget.Snapshot snapshot = budget.snapshot();
        check(snapshot.attempts == 5 && snapshot.tileAttempts == 0 && snapshot.reservedBytes == 20,
            "all five exchanges retain the fixed reservation");
      }
      System.out.println("FixtureConditionalRequest PASS: ETag/date precedence, empty 304, changed body, malformed metadata and fixed charges");
    } finally {
      server.stop(0);
    }
  }
}
