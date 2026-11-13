package app.trippainting.maptransportqa;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import okhttp3.Response;
import org.maplibre.android.MapLibre;
import org.maplibre.android.ModuleProvider;
import org.maplibre.android.http.NativeHttpRequest;

/** Exercises the released SDK Java wrapper on the host, with no JNI pointer. */
public final class FixtureSdkStyleProbe {
  public static void run(int port, Path certificateFile, Path journal) throws Exception {
    X509Certificate certificate;
    try (InputStream input = Files.newInputStream(certificateFile)) {
      certificate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
    }
    CompletableFuture<String> received = new CompletableFuture<>();
    ModuleProvider previous = MapLibre.getModuleProvider();
    try (FixtureBudget budget = FixtureBudget.open(journal, 16, 8, 4096, 65536);
         FixtureHttpClient client = FixtureHttpClient.https(port, chain -> {
           Response response = chain.proceed(chain.request());
           byte[] body = response.peekBody(4097).bytes();
           String style = new String(body, StandardCharsets.UTF_8);
           if (response.code() != 200 || body.length != 124 || !style.contains("fixture-background")) {
             response.close();
             IOException failure = new IOException("Unexpected SDK style response");
             received.completeExceptionally(failure);
             throw failure;
           }
           received.complete(style);
           return response;
         }, budget, certificate)) {
      FixtureModuleProvider.install(client);
      Constructor<NativeHttpRequest> request = NativeHttpRequest.class.getDeclaredConstructor(
          long.class, String.class, String.class, String.class, String.class, boolean.class);
      request.setAccessible(true);
      request.newInstance(0L, "https://127.0.0.1:" + port + "/resource/style/sdk", "", "", "", false);
      received.get(3, TimeUnit.SECONDS);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
      while (budget.dispatcher().runningCallsCount() != 0 || budget.dispatcher().queuedCallsCount() != 0) {
        if (System.nanoTime() >= deadline) throw new AssertionError("SDK request did not complete");
        Thread.sleep(5);
      }
      FixtureBudget.Snapshot totals = budget.snapshot();
      if (totals.attempts != 1 || totals.tileAttempts != 0 || totals.reservedBytes != 4096) {
        throw new AssertionError("Unexpected SDK reservation totals");
      }
      System.out.println("SDK_STYLE_RESPONSE code=200 bytes=124 attempts=1 tiles=0 reserved=4096");
    } finally {
      MapLibre.setModuleProvider(previous);
    }
  }
}
