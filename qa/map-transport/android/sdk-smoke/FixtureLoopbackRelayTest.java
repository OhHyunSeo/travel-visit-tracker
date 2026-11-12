import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

public final class FixtureLoopbackRelayTest {
  private static void require(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }

  private static ServerSocket listen() throws IOException {
    ServerSocket listener = new ServerSocket();
    listener.bind(new InetSocketAddress("127.0.0.1", 0));
    listener.setSoTimeout(3_000);
    return listener;
  }

  private static SSLContext trust(Path certificate) throws Exception {
    Certificate fixture;
    try (InputStream input = Files.newInputStream(certificate)) {
      fixture = CertificateFactory.getInstance("X.509").generateCertificate(input);
    }
    KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
    store.load(null, null);
    store.setCertificateEntry("fixture", fixture);
    TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    trust.init(store);
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(null, trust.getTrustManagers(), null);
    return tls;
  }

  private static void tls(ExecutorService work, Path keyStore, Path certificate) throws Exception {
    HttpsServer server = FixtureStyleServer.bind(keyStore, 0);
    try (ServerSocket listener = listen()) {
      server.start();
      int port = listener.getLocalPort();
      Future<Integer> relay = work.submit(() -> FixtureLoopbackRelay.relayOnce(listener, server.getAddress(), 5_000));
      try (SSLSocket client = (SSLSocket) trust(certificate).getSocketFactory().createSocket("127.0.0.1", port)) {
        client.setSoTimeout(3_000);
        SSLParameters params = client.getSSLParameters();
        params.setEndpointIdentificationAlgorithm("HTTPS");
        client.setSSLParameters(params);
        client.getOutputStream().write(("GET /resource/style/sdk HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n\r\n")
            .getBytes(StandardCharsets.US_ASCII));
        String response = new String(client.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int body = response.indexOf("\r\n\r\n");
        require(body > 0 && response.startsWith("HTTP/1.1 200 ") && response.substring(body + 4).length() == 124,
            "exact HTTP status and body size through TLS");
        require(response.contains("\"id\":\"fixture-background\"") && response.contains("#177878"), "synthetic style through TLS");
      }
      int forwarded = relay.get(3, TimeUnit.SECONDS);
      require(forwarded > 124 && listener.isClosed(), "one connection, including TLS framing");
      System.out.println("Fixture relay PASS: retained certificate and synthetic HTTPS style");
    } finally {
      server.stop(0);
    }
  }

  private static void byteLimit(ExecutorService work) throws Exception {
    try (ServerSocket listener = listen(); ServerSocket target = listen()) {
      int port = listener.getLocalPort();
      Future<Integer> relay = work.submit(() -> FixtureLoopbackRelay.relayOnce(listener, (InetSocketAddress) target.getLocalSocketAddress(), 5_000));
      try (Socket client = new Socket("127.0.0.1", port); Socket upstream = target.accept()) {
        upstream.setSoTimeout(3_000);
        client.getOutputStream().write(new byte[FixtureLoopbackRelay.DIRECTION_LIMIT + 1]);
        require(upstream.getInputStream().readAllBytes().length <= FixtureLoopbackRelay.DIRECTION_LIMIT,
            "relay cannot forward over its limit");
        try {
          relay.get(3, TimeUnit.SECONDS);
          throw new AssertionError("relay accepted an oversized transfer");
        } catch (ExecutionException expected) {
          require(expected.getCause().getCause() instanceof IOException
              && expected.getCause().getCause().getMessage().contains("byte limit"), "byte limit caused the failure");
        }
      }
    }
    System.out.println("Fixture relay PASS: excessive bytes stopped");
  }

  private static void deadline(ExecutorService work) throws Exception {
    try (ServerSocket listener = listen(); ServerSocket target = listen()) {
      int port = listener.getLocalPort();
      Future<Integer> relay = work.submit(() -> FixtureLoopbackRelay.relayOnce(listener, (InetSocketAddress) target.getLocalSocketAddress(), 600));
      try (Socket client = new Socket("127.0.0.1", port); Socket upstream = target.accept()) {
        try {
          relay.get(3, TimeUnit.SECONDS);
          throw new AssertionError("relay accepted an idle connection");
        } catch (ExecutionException expected) {
          require(expected.getCause() instanceof SocketTimeoutException, "deadline caused the failure");
        }
        client.setSoTimeout(1_000);
        upstream.setSoTimeout(1_000);
        require(client.getInputStream().read() == -1 && upstream.getInputStream().read() == -1, "deadline closes both sockets");
      }
    }
    System.out.println("Fixture relay PASS: idle deadline closes both sockets");
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("Usage: FixtureLoopbackRelayTest <fixture.p12> <fixture.der>");
    ExecutorService work = Executors.newSingleThreadExecutor();
    try {
      tls(work, Path.of(args[0]), Path.of(args[1]));
      byteLimit(work);
      deadline(work);
    } finally {
      work.shutdownNow();
      require(work.awaitTermination(3, TimeUnit.SECONDS), "host test executor exits");
    }
  }
}
