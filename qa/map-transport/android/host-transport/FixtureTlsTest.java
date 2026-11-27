package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureTlsTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  static KeyStore keys(String name) throws Exception {
    Path file = Path.of(System.getProperty("trip.fixture.tlsRoot"), name + ".p12");
    if (Files.size(file) > 16_384) throw new IOException("Oversized fixture identity");
    KeyStore store = KeyStore.getInstance("PKCS12");
    try (InputStream input = Files.newInputStream(file)) { store.load(input, "fixture-only-password".toCharArray()); }
    return store;
  }

  static HttpsServer server(KeyStore keys) throws Exception {
    KeyManagerFactory factory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    factory.init(keys, "fixture-only-password".toCharArray());
    SSLContext context = SSLContext.getInstance("TLS");
    context.init(factory.getKeyManagers(), null, null);
    HttpsServer server = HttpsServer.create();
    server.setHttpsConfigurator(new HttpsConfigurator(context));
    server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
    return server;
  }

  private static void refused(FixtureHttpClient client, String url, boolean tlsFailure) throws Exception {
    try (Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
      throw new AssertionError("Unexpected accepted TLS response: " + response.code());
    } catch (IOException error) {
      check(tlsFailure ? error instanceof SSLException : error.getMessage().contains("outside the fixture origin"),
          "expected TLS or policy refusal: " + error);
    }
  }

  public static void main(String[] args) throws Exception {
    KeyStore normal = keys("loopback");
    KeyStore wrongHost = keys("localhost");
    HttpsServer first = server(normal);
    HttpsServer second = server(wrongHost);
    AtomicInteger requests = new AtomicInteger();
    AtomicInteger secondRequests = new AtomicInteger();
    try {
      first.createContext("/", exchange -> {
        requests.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write(new byte[]{'a', 'b'});
        } finally {
          exchange.close();
        }
      });
      second.createContext("/", exchange -> {
        secondRequests.incrementAndGet();
        exchange.sendResponseHeaders(500, -1);
        exchange.close();
      });
      first.start();
      second.start();
      int firstPort = first.getAddress().getPort();
      int secondPort = second.getAddress().getPort();
      String path = "/resource/style/sdk";
      String firstUrl = "https://127.0.0.1:" + firstPort + path;
      try (FixtureBudget budget = new FixtureBudget(5, 3, 4, 20);
           FixtureHttpClient client = FixtureHttpClient.https(firstPort, chain -> chain.proceed(chain.request()), budget,
               (X509Certificate) normal.getCertificate("fixture"))) {
        try (Response response = client.newCall(new Request.Builder().url(firstUrl).build()).execute()) {
          check(response.protocol() == Protocol.HTTP_1_1 && "ab".equals(response.body().string()), "pinned HTTPS body and protocol");
          check(response.handshake() != null, "TLS handshake recorded");
          System.out.println("FixtureTls negotiated " + response.handshake().tlsVersion().javaName());
        }
        refused(client, "http://127.0.0.1:" + firstPort + path, false);
        check(budget.snapshot().attempts == 1 && budget.snapshot().reservedBytes == 4, "HTTPS reservation and no downgrade reservation");
      }
      for (int port : new int[]{firstPort, secondPort}) {
        try (FixtureBudget budget = new FixtureBudget(2, 2, 4, 8);
             FixtureHttpClient client = FixtureHttpClient.https(port, chain -> chain.proceed(chain.request()), budget,
                 (X509Certificate) wrongHost.getCertificate("fixture"))) {
          refused(client, "https://127.0.0.1:" + port + path, true);
          check(budget.snapshot().attempts == 0, "certificate or host refusal before HTTP reservation");
        }
      }
      check(requests.get() == 1 && secondRequests.get() == 0, "only trusted exact-host HTTP request arrived");
      System.out.println("FixtureTls PASS: pinned fixture key, hostname, HTTP/1.1, wrong identity and downgrade refusal");
    } finally {
      first.stop(0);
      second.stop(0);
    }
  }
}
