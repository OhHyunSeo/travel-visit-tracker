package app.trippainting.maptransportqa;

import android.content.Context;
import com.sun.net.httpserver.HttpServer;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.LibraryLoader;
import org.maplibre.android.LibraryLoaderProvider;
import org.maplibre.android.MapLibre;
import org.maplibre.android.ModuleProvider;
import org.maplibre.android.http.HttpRequest;
import org.maplibre.android.http.HttpResponder;

public final class FixtureModuleProviderTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void refuse(FixtureHttpClient client, String expected) {
    try {
      FixtureModuleProvider.install(client);
      throw new AssertionError("Provider install accepted invalid startup state");
    } catch (IllegalStateException error) {
      check(error.getMessage().contains(expected), "startup failure: " + error);
    }
  }

  public static void main(String[] args) throws Exception {
    ClassLoader loader = MapLibre.class.getClassLoader();
    check(MapLibre.class.getProtectionDomain().getCodeSource().getLocation().equals(
        HttpRequest.class.getProtectionDomain().getCodeSource().getLocation()), "HTTP API resolved from the SDK JAR");
    check(!MapLibre.class.getProtectionDomain().getCodeSource().getLocation().equals(
        FixtureModuleProviderTest.class.getProtectionDomain().getCodeSource().getLocation()), "SDK is outside fixture classes");
    check(!MapLibre.hasInstance(), "isolated JVM before SDK initialization");
    ModuleProvider original = MapLibre.getModuleProvider();
    LibraryLoaderProvider originalLoader = original.createLibraryLoaderProvider();
    AtomicInteger loaderSelections = new AtomicInteger();
    ModuleProvider observed = new ModuleProvider() {
      @Override public HttpRequest createHttpRequest() { throw new AssertionError("SDK HTTP fallback invoked"); }

      @Override public LibraryLoaderProvider createLibraryLoaderProvider() {
        loaderSelections.incrementAndGet();
        return originalLoader;
      }
    };
    HttpServer server = HttpServer.create();
    AtomicInteger arrivals = new AtomicInteger();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext("/resource/style/sdk", exchange -> {
        arrivals.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write(new byte[]{'a', 'b'});
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      try (FixtureBudget budget = new FixtureBudget(3, 2, 4, 12);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        MapLibre.setModuleProvider(observed);
        FixtureModuleProvider.install(client);
        ModuleProvider installed = MapLibre.getModuleProvider();
        check(installed instanceof FixtureModuleProvider && loaderSelections.get() == 0, "install precedes loader selection");
        Class.forName(LibraryLoader.class.getName(), true, loader);
        check(loaderSelections.get() == 1, "SDK loader static initializer delegates once to the prior provider");
        check(installed.createLibraryLoaderProvider() == originalLoader, "exact prior loader provider returned");
        refuse(client, "already installed");

        HttpRequest first = installed.createHttpRequest();
        check(first != installed.createHttpRequest(), "each SDK resource receives its own request");
        CompletableFuture<String> result = new CompletableFuture<>();
        first.executeRequest(new HttpResponder() {
          @Override public void onResponse(int code, String etag, String modified, String cache, String expires,
              String retry, String reset, byte[] body) {
            result.complete(code + ":" + new String(body, StandardCharsets.UTF_8));
          }

          @Override public void handleFailure(int type, String message) {
            result.completeExceptionally(new AssertionError(message));
          }
        }, 0, "http://127.0.0.1:" + port + "/resource/style/sdk", "", "", "", false);
        check("200:ab".equals(result.get(3, TimeUnit.SECONDS)), "actual SDK interface dispatch receives bounded fixture response");
        check(arrivals.get() == 1 && budget.snapshot().reservedBytes == 4, "one request and one shared reservation");

        // Exercise the late-install predicate without entering Android/JNI startup.
        Constructor<MapLibre> constructor = MapLibre.class.getDeclaredConstructor(Context.class, String.class);
        constructor.setAccessible(true);
        Field instance = MapLibre.class.getDeclaredField("INSTANCE");
        instance.setAccessible(true);
        instance.set(null, constructor.newInstance(null, null));
        try {
          refuse(client, "before MapLibre initialization");
        } finally {
          instance.set(null, null);
        }
      }
      System.out.println("FixtureModuleProvider PASS: released SDK Java provider and loader selection, synthetic startup guard, bounded HTTP");
    } finally {
      MapLibre.setModuleProvider(original);
      server.stop(0);
    }
  }
}
