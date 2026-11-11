package app.trippainting.maptransportqa;

import java.net.ProtocolException;
import java.net.Proxy;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Authenticator;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;

/** A dedicated HTTP/1.1 client for exercising the fixture policy on the host. */
final class FixtureHttpClient implements AutoCloseable {
  private final OkHttpClient client;
  private final FixtureBudget budget;
  private final boolean ownsBudget;
  private final Owner owner = new Owner();
  private boolean closed;

  private static final class Owner {}

  private static final class Exchange {
    final AtomicBoolean started = new AtomicBoolean();
  }

  FixtureHttpClient(int port, Interceptor transform) {
    this(port, transform, new FixtureBudget(100, 40, 256, 8192), true, null);
  }

  FixtureHttpClient(int port, Interceptor transform, FixtureBudget budget) {
    this(port, transform, budget, false, null);
  }

  static FixtureHttpClient https(int port, Interceptor transform, FixtureBudget budget,
      java.security.cert.X509Certificate certificate) throws java.security.GeneralSecurityException, java.io.IOException {
    return new FixtureHttpClient(port, transform, budget, false, new FixtureTls(certificate));
  }

  private FixtureHttpClient(int port, Interceptor transform, FixtureBudget budget, boolean ownsBudget, FixtureTls tls) {
    this.budget = budget;
    this.ownsBudget = ownsBudget;
    FixtureRequestPolicy policy = new FixtureRequestPolicy(port, tls == null ? "http" : "https");
    OkHttpClient.Builder builder = new OkHttpClient.Builder()
        .dispatcher(budget.dispatcher())
        .proxy(Proxy.NO_PROXY)
        .protocols(List.of(Protocol.HTTP_1_1))
        .cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE)
        .proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .callTimeout(5, TimeUnit.SECONDS)
        .addInterceptor(chain -> chain.proceed(chain.request().newBuilder()
            .tag(Exchange.class, new Exchange()).build()))
        .addInterceptor(transform)
        .addInterceptor(chain -> {
          Request request = policy.prepare(chain.request());
          if (request.tag(Exchange.class) == null) throw new ProtocolException("Fixture exchange context lost");
          return chain.proceed(request);
        })
        .addNetworkInterceptor(chain -> {
          Request request = chain.request();
          FixtureRequestPolicy.Kind kind = policy.classify(request);
          Exchange exchange = request.tag(Exchange.class);
          if (exchange == null || !exchange.started.compareAndSet(false, true)) {
            throw new ProtocolException("Additional fixture exchange refused");
          }
          // Charge every new Call before HTTP request headers are sent.
          // A cancellation, rejected response or later retry gets no refund.
          budget.reserve(kind);
          return FixtureBody.guard(chain.proceed(request), budget.bytesPerAttempt);
        });
    if (tls != null) tls.configure(builder);
    client = builder.build();
  }

  synchronized Call newCall(Request request) {
    if (closed) throw new IllegalStateException("Fixture client closed");
    budget.dispatcher();
    return client.newCall(request.newBuilder().tag(Owner.class, owner).build());
  }

  int queuedAsyncCalls() {
    return client.dispatcher().queuedCallsCount();
  }

  @Override public void close() throws java.io.IOException {
    synchronized (this) { closed = true; }
    for (Call call : client.dispatcher().queuedCalls()) if (call.request().tag(Owner.class) == owner) call.cancel();
    for (Call call : client.dispatcher().runningCalls()) if (call.request().tag(Owner.class) == owner) call.cancel();
    client.connectionPool().evictAll();
    if (ownsBudget) budget.close();
  }
}
