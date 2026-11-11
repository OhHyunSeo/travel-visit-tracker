package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ProtocolException;
import java.net.Proxy;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

public final class FixtureHttpClientTest {
  private static final String SDK = "/resource/style/sdk";
  private static final String HELD = "/resource/style/held";
  private static final String BLOCKED = "/resource/style/blocked";
  private static final String EMPTY = "/resource/style/empty";
  private static final String OVERSIZED = "/resource/tile/0_0_0";
  private static final String CHUNKED = "/resource/tile/2_0_0";
  private static final String ENCODED = "/resource/tile/2_0_1";

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static Request request(String url) {
    return new Request.Builder().url(url).build();
  }

  private static String origin(HttpServer server) {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  private static void reply(HttpExchange exchange, int status) throws IOException {
    try {
      exchange.sendResponseHeaders(status, 1);
      exchange.getResponseBody().write('a');
    } finally {
      exchange.close();
    }
  }

  private static void expectRefusal(FixtureHttpClient client, String url, String message) throws Exception {
    try (Response response = client.newCall(request(url)).execute()) {
      throw new AssertionError("Unexpected HTTP response " + response.code());
    } catch (IOException error) {
      check(error.getMessage().contains(message), "unexpected refusal: " + error);
      if (message.startsWith("Additional")) check(error instanceof ProtocolException, "exchange refusal type");
    }
  }

  private static void expectBodyRefusal(FixtureHttpClient client, String url, String message) throws Exception {
    try {
      FixtureBody.read(client.newCall(request(url)).execute(), 2);
    } catch (IOException error) {
      check(error.getMessage().contains(message), "unexpected body refusal: " + error);
      return;
    }
    throw new AssertionError("Unexpected accepted body: " + url);
  }

  private static void expectBodyRefusal(Response response, String message) throws Exception {
    try {
      FixtureBody.read(response, 2);
    } catch (IOException error) {
      check(error.getMessage().contains(message), "unexpected body refusal: " + error);
      return;
    }
    throw new AssertionError("Unexpected accepted body: " + response.request().url());
  }

  private static Response syntheticBody(String body) {
    return new Response.Builder().request(request("http://127.0.0.1/"))
        .protocol(Protocol.HTTP_1_1).code(200).message("OK").header("Content-Length", "2")
        .body(ResponseBody.create(null, 2, new Buffer().writeUtf8(body))).build();
  }

  public static void main(String[] args) throws Exception {
    expectBodyRefusal(syntheticBody("a"), "Incomplete fixture body");
    expectBodyRefusal(syntheticBody("abc"), "exceeded its declared length");
    InetSocketAddress local = new InetSocketAddress("127.0.0.1", 0);
    HttpServer target = HttpServer.create();
    HttpServer fixture = HttpServer.create();
    AtomicInteger targetRequests = new AtomicInteger();
    AtomicInteger credentialFree = new AtomicInteger();
    List<String> requests = Collections.synchronizedList(new ArrayList<>());
    try {
      target.bind(local, 0);
      fixture.bind(local, 0);
      target.createContext("/", exchange -> {
        targetRequests.incrementAndGet();
        reply(exchange, 200);
      });
      fixture.createContext("/", exchange -> {
        String path = exchange.getRequestURI().getPath();
        requests.add(path);
        if (path.equals(SDK) && "TripPainting-Android-Map-QA/1".equals(exchange.getRequestHeaders().getFirst("User-Agent"))
            && "identity".equals(exchange.getRequestHeaders().getFirst("Accept-Encoding"))
            && exchange.getRequestHeaders().getFirst("Authorization") == null
            && exchange.getRequestHeaders().getFirst("Cookie") == null) credentialFree.incrementAndGet();
        if (path.equals(HELD)) exchange.getResponseHeaders().set("Retry-After", "0");
        if (path.equals(BLOCKED)) exchange.getResponseHeaders().set("Location", origin(target) + SDK);
        if (path.equals(ENCODED)) exchange.getResponseHeaders().set("Content-Encoding", "gzip");
        if (path.equals(OVERSIZED) || path.equals(CHUNKED)) {
          try {
            exchange.sendResponseHeaders(200, path.equals(CHUNKED) ? 0 : 3);
            exchange.getResponseBody().write(new byte[]{'a', 'b', 'c'});
          } finally {
            exchange.close();
          }
          return;
        }
        reply(exchange, path.equals(HELD) ? 503 : path.equals(BLOCKED) ? 302 : 200);
      });
      target.start();
      fixture.start();
      String base = origin(fixture);
      OkHttpClient control = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
          .retryOnConnectionFailure(false).callTimeout(5, TimeUnit.SECONDS).build();
      try (Response response = control.newCall(request(base + HELD)).execute()) {
        check(response.code() == 503 && requests.equals(List.of(HELD, HELD)), "control performs one 503 follow-up");
      } finally {
        control.connectionPool().evictAll();
        control.dispatcher().executorService().shutdown();
      }
      requests.clear();
      try (FixtureHttpClient guarded = new FixtureHttpClient(fixture.getAddress().getPort(), chain -> {
        Request input = chain.request();
        if (input.url().encodedPath().equals("/rewrite")) {
          input = input.newBuilder().url(base + SDK).header("Authorization", "synthetic")
              .header("Cookie", "synthetic=1").build();
        } else if (input.url().encodedPath().equals(EMPTY)) {
          input = input.newBuilder().url(origin(target) + SDK).build();
        } else if (input.url().encodedPath().equals("/double")) {
          input = input.newBuilder().url(base + "/resource/style/multi").build();
          try (Response first = chain.proceed(input)) {
            check(first.code() == 200 && "a".equals(first.body().string()), "first transformed exchange completed");
          }
        } else if (input.url().encodedPath().equals("/context-lost")) {
          input = request(base + SDK);
        }
        return chain.proceed(input);
      })) {
        byte[] accepted = FixtureBody.read(guarded.newCall(request(base + "/rewrite")).execute(), 1);
        check(accepted.length == 1 && accepted[0] == 'a', "transformed request completed within one-byte reservation");
        expectRefusal(guarded, base + EMPTY, "outside the fixture origin");
        expectRefusal(guarded, base + "/resource/tile/denied_0_0_0", "outside the fixture allowlist");
        try (Response response = guarded.newCall(request(base + BLOCKED)).execute()) {
          check(response.code() == 302, "redirect was not followed");
        }
        expectRefusal(guarded, base + HELD, "Additional fixture exchange refused");
        expectRefusal(guarded, base + "/double", "Additional fixture exchange refused");
        expectRefusal(guarded, base + "/context-lost", "Fixture exchange context lost");
        expectBodyRefusal(guarded, base + OVERSIZED, "exceeds reservation");
        expectBodyRefusal(guarded, base + CHUNKED, "fixed Content-Length");
        expectBodyRefusal(guarded, base + ENCODED, "Encoded fixture body refused");
        check(requests.equals(List.of(SDK, BLOCKED, HELD, "/resource/style/multi", OVERSIZED, CHUNKED, ENCODED)),
            "exact primary server request sequence");
        check(targetRequests.get() == 0, "second origin received no requests");
        check(credentialFree.get() == 1, "fixed headers and stripped credentials reached server");
      }
      System.out.println("FixtureHttpClient PASS: 503 control=2, guarded=1, alternate origin=0, fixed body acceptance and three refusals");
    } finally {
      fixture.stop(0);
      target.stop(0);
    }
  }
}
