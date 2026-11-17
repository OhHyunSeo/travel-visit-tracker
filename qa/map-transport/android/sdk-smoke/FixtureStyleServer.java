import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.List;
import javax.imageio.ImageIO;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

/** Host-only HTTPS server for the isolated Android smoke APK. */
public final class FixtureStyleServer {
  private static final String FIXTURE_AGENT = "TripPainting-Android-Map-QA/1";
  private static final byte[] STYLE = ("{\"version\":8,\"sources\":{},\"layers\":[{\"id\":\"fixture-background\","
      + "\"type\":\"background\",\"paint\":{\"background-color\":\"#177878\"}}]}")
      .getBytes(StandardCharsets.UTF_8);

  public static void main(String[] args) throws Exception {
    boolean raster = args.length >= 3 && "--raster-tile".equals(args[2]);
    boolean expire = args.length == 4 && "--expire-pack".equals(args[3]);
    boolean recover = args.length == 4 && "--online-recovery".equals(args[3]);
    boolean rn = args.length == 4 && "--rn-recovery".equals(args[3]);
    if (!(args.length == 2 || (raster && (args.length == 3 || expire || recover || rn))) || !args[1].matches("[1-9][0-9]{3,4}")) {
      throw new IllegalArgumentException("Usage: FixtureStyleServer <fixture.p12> <port> [--raster-tile [--expire-pack | --online-recovery | --rn-recovery]]");
    }
    int port = Integer.parseInt(args[1]);
    if (port < 1024 || port > 65535) throw new IllegalArgumentException("Invalid fixture port");
    HttpsServer server = bind(Path.of(args[0]), port, raster, expire, recover, rn);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
    server.start();
    System.out.println("STYLE_SERVER_READY port=" + port);
  }

  static HttpsServer bind(Path keyStore, int port) throws Exception {
    return bind(keyStore, port, false, false, false, false);
  }

  private static HttpsServer bind(Path keyStore, int port, boolean raster, boolean expire, boolean recover, boolean rn) throws Exception {
    String tilePath = rn ? "/resource/tile/8_219_98" : "/resource/tile/0_0_0";
    byte[] style = raster ? rasterStyle(port, rn ? 8 : 0) : STYLE;
    byte[] tile = raster ? rasterTile(recover ? new Color(52, 121, 206) : new Color(217, 93, 47)) : null;
    char[] password = "fixture-only-password".toCharArray();
    KeyStore keys = KeyStore.getInstance("PKCS12");
    try (InputStream input = Files.newInputStream(keyStore)) {
      keys.load(input, password);
    }
    KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    managers.init(keys, password);
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(managers.getKeyManagers(), null, null);

    HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", port), 1);
    server.setHttpsConfigurator(new HttpsConfigurator(tls));
    server.createContext("/", exchange -> {
      try {
        exchange.getResponseHeaders().set("Connection", "close");
        String path = exchange.getRequestURI().toASCIIString();
        boolean tileRequest = raster && tilePath.equals(path);
        if (!"/resource/style/sdk".equals(path) && !tileRequest) {
          System.out.println("REJECTED_STYLE reason=path");
          exchange.sendResponseHeaders(404, -1);
          return;
        }
        if (!"GET".equals(exchange.getRequestMethod())) {
          System.out.println("REJECTED_STYLE reason=method");
          exchange.getResponseHeaders().set("Allow", "GET");
          exchange.sendResponseHeaders(405, -1);
          return;
        }
        Headers request = exchange.getRequestHeaders();
        if (!List.of(FIXTURE_AGENT).equals(request.get("User-Agent"))
            || !List.of("identity").equals(request.get("Accept-Encoding"))
            || List.of("Authorization", "Cookie", "Range", "If-None-Match", "If-Modified-Since").stream()
                .anyMatch(request::containsKey)) {
          System.out.println("REJECTED_STYLE reason=headers");
          exchange.sendResponseHeaders(400, -1);
          return;
        }
        byte[] body = tileRequest ? tile : style;
        exchange.getResponseHeaders().set("Content-Type", tileRequest ? "image/png" : "application/json");
        exchange.getResponseHeaders().set("Cache-Control", expire ? "max-age=1" : raster ? "max-age=300" : "no-store");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        String resource = tileRequest ? "TILE path=" + tilePath : "STYLE";
        System.out.println("SERVED_" + resource + " bytes=" + body.length);
      } finally {
        exchange.close();
      }
    });
    return server;
  }

  private static byte[] rasterStyle(int port, int zoom) {
    return ("{\"version\":8,\"center\":[0,0],\"zoom\":0,\"sources\":{\"fixture\":{\"type\":\"raster\","
        + "\"tiles\":[\"https://127.0.0.1:" + port + "/resource/tile/{z}_{x}_{y}\"],\"tileSize\":512,\"minzoom\":"
        + zoom + ",\"maxzoom\":" + zoom + "}},"
        + "\"layers\":[{\"id\":\"fixture-background\",\"type\":\"background\",\"paint\":{\"background-color\":\"#177878\"}},"
        + "{\"id\":\"fixture-raster\",\"type\":\"raster\",\"source\":\"fixture\",\"paint\":{\"raster-fade-duration\":0}}]}")
        .getBytes(StandardCharsets.UTF_8);
  }

  private static byte[] rasterTile(Color color) throws Exception {
    BufferedImage image = new BufferedImage(512, 512, BufferedImage.TYPE_INT_RGB);
    var graphics = image.createGraphics();
    try {
      graphics.setColor(color);
      graphics.fillRect(0, 0, 512, 512);
    } finally {
      graphics.dispose();
    }
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    if (!ImageIO.write(image, "png", output)) throw new IllegalStateException("PNG writer unavailable");
    return output.toByteArray();
  }
}
