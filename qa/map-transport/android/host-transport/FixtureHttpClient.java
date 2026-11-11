package app.trippainting.maptransportqa;

import java.net.ProtocolException;
import java.net.Proxy;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Authenticator;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.Dispatcher;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;

/** A dedicated HTTP/1.1 client for exercising the fixture policy on the host. */
final class FixtureHttpClient implements AutoCloseable {
  private static final int MAX_ASYNC_REQUESTS = 4;
  private final OkHttpClient client;

  private static final class Exchange {
    final AtomicBoolean started = new AtomicBoolean();
  }

  FixtureHttpClient(int port, Interceptor transform) {
    this(port, transform, new FixtureBudget(100, 40, 256, 8192));
  }

  FixtureHttpClient(int port, Interceptor transform, FixtureBudget budget) {
    FixtureRequestPolicy policy = new FixtureRequestPolicy(port);
    Dispatcher dispatcher = new Dispatcher();
    dispatcher.setMaxRequests(MAX_ASYNC_REQUESTS);
    dispatcher.setMaxRequestsPerHost(MAX_ASYNC_REQUESTS);
    client = new OkHttpClient.Builder()
        .dispatcher(dispatcher)
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
          return chain.proceed(request);
        })
        .build();
  }

  Call newCall(Request request) {
    return client.newCall(request);
  }

  int queuedAsyncCalls() {
    return client.dispatcher().queuedCallsCount();
  }

  @Override public void close() {
    client.dispatcher().cancelAll();
    client.connectionPool().evictAll();
    client.dispatcher().executorService().shutdown();
  }
}
