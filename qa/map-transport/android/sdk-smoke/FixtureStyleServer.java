import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

/** Host-only HTTPS server for the isolated Android smoke APK. */
public final class FixtureStyleServer {
  private static final byte[] STYLE = ("{\"version\":8,\"sources\":{},\"layers\":[{\"id\":\"fixture-background\","
      + "\"type\":\"background\",\"paint\":{\"background-color\":\"#177878\"}}]}")
      .getBytes(StandardCharsets.UTF_8);

  public static void main(String[] args) throws Exception {
    if (args.length != 2 || !args[1].matches("[1-9][0-9]{3,4}")) {
      throw new IllegalArgumentException("Usage: java FixtureStyleServer.java <fixture.p12> <port>");
    }
    int port = Integer.parseInt(args[1]);
    if (port < 1024 || port > 65535) throw new IllegalArgumentException("Invalid fixture port");
    char[] password = "fixture-only-password".toCharArray();
    KeyStore keys = KeyStore.getInstance("PKCS12");
    try (InputStream input = Files.newInputStream(Path.of(args[0]))) {
      keys.load(input, password);
    }
    KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    managers.init(keys, password);
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(managers.getKeyManagers(), null, null);

    HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(tls));
    server.createContext("/", exchange -> {
      try {
        if (!"/resource/style/sdk".equals(exchange.getRequestURI().toASCIIString())) {
          exchange.sendResponseHeaders(404, -1);
          return;
        }
        if (!"GET".equals(exchange.getRequestMethod())) {
          exchange.getResponseHeaders().set("Allow", "GET");
          exchange.sendResponseHeaders(405, -1);
          return;
        }
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, STYLE.length);
        exchange.getResponseBody().write(STYLE);
        System.out.println("SERVED_STYLE bytes=" + STYLE.length);
      } finally {
        exchange.close();
      }
    });
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
    server.start();
    System.out.println("STYLE_SERVER_READY port=" + port);
  }
}
