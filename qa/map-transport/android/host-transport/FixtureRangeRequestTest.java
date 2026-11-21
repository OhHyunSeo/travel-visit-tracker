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

public final class FixtureRangeRequestTest {
  private static final String RANGE = "bytes=2-3";

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static String execute(FixtureHttpClient client, String url, String range, String etag) throws Exception {
    CompletableFuture<String> result = new CompletableFuture<>();
    new FixtureMapLibreRequest(client).executeRequest(new HttpResponder() {
      @Override public void onResponse(int code, String receivedTag, String receivedDate, String cache, String expires,
          String retry, String rate, byte[] body) {
        result.complete(code + ":" + new String(body, StandardCharsets.UTF_8));
      }

      @Override public void handleFailure(int type, String error) {
        result.complete("failure:" + type);
      }
    }, 0, url, range, etag, "", true);
    return result.get(2, TimeUnit.SECONDS);
  }

  public static void main(String[] args) throws Exception {
    KeyStore keys = FixtureTlsTest.keys("loopback");
    HttpsServer server = FixtureTlsTest.server(keys);
    LinkedBlockingQueue<String> seen = new LinkedBlockingQueue<>();
    try {
      server.createContext("/", exchange -> {
        try {
          String path = exchange.getRequestURI().getPath();
          seen.add(exchange.getRequestHeaders().getFirst("Range") + "|"
              + exchange.getRequestHeaders().getFirst("If-None-Match"));
          if (path.endsWith("/empty")) {
            exchange.sendResponseHeaders(304, -1);
          } else if (path.endsWith("/multi")) {
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write(new byte[]{'c', 'd'});
          } else {
            String contentRange = path.endsWith("/blocked") ? "bytes 1-2/6" : "bytes 2-3/6";
            exchange.getResponseHeaders().set("Content-Range", contentRange);
            if (path.endsWith("/mixed")) exchange.getResponseHeaders().set("Content-Type", "multipart/byteranges; boundary=x");
            boolean shortRange = path.endsWith("/held");
            exchange.sendResponseHeaders(206, shortRange ? 1 : 2);
            exchange.getResponseBody().write(shortRange ? new byte[]{'c'} : new byte[]{'c', 'd'});
          }
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String origin = "https://127.0.0.1:" + port + "/resource";
      String style = origin + "/style/";
      try (FixtureBudget budget = new FixtureBudget(10, 3, 4, 40);
           FixtureHttpClient client = FixtureHttpClient.https(port, chain -> chain.proceed(chain.request().newBuilder()
               .header("Range", "bytes=0-100").build()), budget, (X509Certificate) keys.getCertificate("fixture"))) {
        check("206:cd".equals(execute(client, style + "sdk", RANGE, "")), "matching range body accepted");
        check("304:".equals(execute(client, style + "empty", RANGE, "\"cached\"")), "conditional range may be unmodified");
        for (String path : List.of("multi", "blocked", "held", "mixed")) {
          check("failure:2".equals(execute(client, style + path, RANGE, "")), "bad range response rejected: " + path);
        }
        check("failure:2".equals(execute(client, origin + "/tile/0_0_0", "", "")), "unsolicited partial tile rejected");
        for (String range : List.of("bytes=0-", "bytes=-2", "bytes=0-1,2-3", "bytes=3-2", "bytes=0-4", "bytes=0-65536",
            "bytes=9223372036854775808-9223372036854775809")) {
          check("failure:2".equals(execute(client, style + "sdk", range, "")), "invalid or over-budget range refused: " + range);
        }
        check(List.copyOf(seen).equals(List.of(RANGE + "|null", RANGE + "|\"cached\"", RANGE + "|null", RANGE + "|null",
            RANGE + "|null", RANGE + "|null", "null|null")), "range allowlist and zero requests for invalid metadata");
        FixtureBudget.Snapshot snapshot = budget.snapshot();
        check(snapshot.attempts == 7 && snapshot.tileAttempts == 1 && snapshot.reservedBytes == 28,
            "all seven exchanges retain fixed charges");
      }
      System.out.println("FixtureRangeRequest PASS: exact partial body, conditional 304, invalid ranges and fixed charges");
    } finally {
      server.stop(0);
    }
  }
}
