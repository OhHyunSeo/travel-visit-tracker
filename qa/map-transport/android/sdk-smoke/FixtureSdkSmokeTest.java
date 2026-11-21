import com.sun.net.httpserver.HttpsServer;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import app.trippainting.maptransportqa.FixtureSdkStyleProbe;

/** Host wiring for the fixture APK's port and certificate through the relay. */
public final class FixtureSdkSmokeTest {
  public static void main(String[] args) throws Exception {
    if (args.length != 4) throw new IllegalArgumentException("Expected key store, certificate, journal directory and APK port");
    HttpsServer server = FixtureStyleServer.bind(Path.of(args[0]), 0);
    ExecutorService worker = Executors.newSingleThreadExecutor();
    try (ServerSocket listener = new ServerSocket()) {
      int port = Integer.parseInt(args[3]);
      listener.bind(new InetSocketAddress("127.0.0.1", port), 1);
      server.start();
      var relay = worker.submit(() -> FixtureLoopbackRelay.relayOnce(listener, server.getAddress(), 8_000));
      FixtureSdkStyleProbe.run(port, Path.of(args[1]), Path.of(args[2]));
      int bytes = relay.get(4, TimeUnit.SECONDS);
      if (bytes <= 124 || bytes > 2 * FixtureLoopbackRelay.DIRECTION_LIMIT) {
        throw new AssertionError("Unexpected relay byte count");
      }
      System.out.println("SDK_STYLE_RELAY forwarded=" + bytes);
    } finally {
      server.stop(0);
      worker.shutdownNow();
      if (!worker.awaitTermination(2, TimeUnit.SECONDS)) throw new AssertionError("Relay executor did not stop");
    }
  }
}
