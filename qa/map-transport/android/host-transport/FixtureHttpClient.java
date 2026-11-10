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

  private static final class Exchange {
    final AtomicBoolean started = new AtomicBoolean();
  }

  FixtureHttpClient(int port, Interceptor transform) {
    FixtureRequestPolicy policy = new FixtureRequestPolicy(port);
    client = new OkHttpClient.Builder()
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
          policy.classify(request);
          Exchange exchange = request.tag(Exchange.class);
          if (exchange == null || !exchange.started.compareAndSet(false, true)) {
            throw new ProtocolException("Additional fixture exchange refused");
          }
          return chain.proceed(request);
        })
        .build();
  }

  Call newCall(Request request) {
    return client.newCall(request);
  }

  @Override public void close() {
    client.dispatcher().cancelAll();
    client.connectionPool().evictAll();
    client.dispatcher().executorService().shutdown();
  }
}
