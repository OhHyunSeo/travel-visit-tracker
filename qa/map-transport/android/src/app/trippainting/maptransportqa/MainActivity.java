package app.trippainting.maptransportqa;

import android.app.Activity;
import android.os.Bundle;
import android.util.AtomicFile;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.CookieJar;
import okhttp3.Dispatcher;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONObject;

/** A separate synthetic transport app. No MapLibre, auth, location or personal-app access. */
public final class MainActivity extends Activity {
  static final String UA = "TripPaintingMapTransportQA/0.1 (synthetic fixture only)";
  static final long RESERVATION = 128;
  TextView text;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    text = new TextView(this);
    text.setText("지도 전송 시험 준비 중");
    setContentView(text);
    new Thread(() -> {
      try { runScenario(); }
      catch (Throwable error) {
        try { publish(new JSONObject().put("done", true).put("fatal", error.toString())); }
        catch (Exception ignored) { }
      }
    }, "synthetic-map-qa").start();
  }

  void runScenario() throws Exception {
    String origin = getIntent().getStringExtra("origin");
    if (origin == null) origin = "http://10.0.2.2:3187";
    HttpUrl base = HttpUrl.get(origin);
    if (!base.scheme().equals("http") || !base.host().equals("10.0.2.2") ||
        !base.encodedPath().equals("/") || !base.username().isEmpty() ||
        !base.password().isEmpty() || base.query() != null || base.fragment() != null)
      throw new IOException("QA origin must be the emulator host bridge only");
    String run = getIntent().getStringExtra("run_id");
    if (run == null) run = "manual";
    if (!run.matches("[a-z0-9_-]{1,40}")) throw new IOException("Invalid QA run name");
    String scenario = getIntent().getStringExtra("scenario");
    if (scenario == null) scenario = "batch";
    Ledger ledger = new Ledger(new File(getFilesDir(), "ledger-" + run + ".json"), run);
    Gate gate = new Gate(base, ledger);
    Gate secondGate = new Gate(base, ledger);
    List<CompletableFuture<JSONObject>> pending = new ArrayList<>();
    if (scenario.equals("inspect")) {
      // This path intentionally performs no HTTP and retains every uncertain reservation.
    } else if (scenario.equals("batch")) {
      String[] kinds = {"style", "tile", "glyph", "sprite"};
      for (int i = 0; i < 12; i++)
        pending.add((i % 2 == 0 ? gate : secondGate).get("/resource/" + kinds[i % 4] + "/batch" + i + "?bytes=64&delayMs=150"));
    } else if (scenario.equals("reject")) {
      pending.add(gate.get("http://example.invalid/resource/tile/external"));
      pending.add(gate.get("/resource/unknown/unknown"));
      pending.add(gate.get("/resource/tile/query?token=forbidden"));
      pending.add(gate.get("/resource/tile/redirect?redirect=1&delayMs=0"));
    } else if (scenario.equals("bodies")) {
      pending.add(gate.get("/resource/tile/known?bytes=64&delayMs=0"));
      pending.add(gate.get("/resource/tile/large?bytes=512&delayMs=0"));
      pending.add(gate.get("/resource/glyph/chunked?chunked=1&delayMs=0"));
      pending.add(gate.get("/resource/sprite/gzip?gzip=1&delayMs=0"));
      pending.add(gate.get("/resource/style/error?status=503&delayMs=0"));
    } else if (scenario.equals("budget")) {
      for (int i = 0; i < 70; i++)
        pending.add(gate.get("/resource/glyph/budget" + i + "?bytes=64&delayMs=0"));
    } else if (scenario.equals("tile-budget")) {
      for (int i = 0; i < 45; i++)
        pending.add(gate.get("/resource/tile/budget" + i + "?bytes=64&delayMs=0"));
    } else if (scenario.equals("hold")) {
      pending.add(gate.get("/resource/tile/held?hold=1&delayMs=0"));
      publish(new JSONObject().put("done", false).put("phase", "holding").put("ledger", ledger.snapshot()));
    } else if (scenario.equals("resume")) {
      pending.add(gate.get("/resource/tile/retry?bytes=64&delayMs=0"));
    } else throw new IOException("Unknown QA scenario");
    JSONArray results = new JSONArray();
    for (CompletableFuture<JSONObject> result : pending) results.put(result.get(70, TimeUnit.SECONDS));
    publish(new JSONObject().put("done", true).put("scenario", scenario).put("results", results)
      .put("ledger", ledger.snapshot()).put("maxNativeBodies", gate.maxActive.get())
      .put("metric", "accepted body bytes; not OS received bytes")
      .put("batchClientCount", scenario.equals("batch") ? 2 : 1)
      .put("mapLibreIntegrated", false));
    gate.client.connectionPool().evictAll();
    secondGate.client.connectionPool().evictAll();
  }

  void publish(JSONObject result) throws Exception {
    result.put("run_id", getIntent().getStringExtra("run_id"));
    writeAtomic(new File(getFilesDir(), "result.json"), result);
    runOnUiThread(() -> text.setText(result.optBoolean("done") ? "지도 전송 시험 완료" : "재실행 보존 시험 대기 중"));
  }

  static void writeAtomic(File target, JSONObject value) throws Exception {
    AtomicFile file = new AtomicFile(target);
    FileOutputStream stream = file.startWrite();
    try {
      stream.write(value.toString().getBytes(StandardCharsets.UTF_8));
      stream.getFD().sync();
      file.finishWrite(stream);
    } catch (Exception error) {
      file.failWrite(stream);
      throw error;
    }
  }

  static final class Ledger {
    final File path;
    final JSONObject state;
    Ledger(File path, String run) throws Exception {
      this.path = path;
      if (path.exists()) {
        byte[] bytes = new AtomicFile(path).readFully();
        if (bytes.length > 65_536) throw new IOException("Oversized QA ledger");
        state = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (state.getInt("version") != 1 || !state.getString("scope").equals(run))
          throw new IOException("QA ledger identity mismatch");
        int attempts = state.getInt("attempts");
        JSONArray entries = state.getJSONArray("entries");
        int tiles = 0;
        long accepted = 0;
        if (attempts < 0 || attempts > 100 || attempts != entries.length() ||
            state.getLong("chargedBodyBytes") != attempts * RESERVATION || attempts * RESERVATION > 8192)
          throw new IOException("Invalid persistent reservation totals");
        for (int i = 0; i < entries.length(); i++) {
          JSONObject entry = entries.getJSONObject(i);
          long size = entry.getLong("accepted");
          String status = entry.getString("status");
          if (entry.getInt("id") != i + 1 || entry.getLong("reservation") != RESERVATION ||
              size < 0 || size > RESERVATION ||
              !(status.equals("pending") || status.equals("success") || status.equals("failed")) ||
              (status.equals("pending") && size != 0)) throw new IOException("Invalid persistent reservation entry");
          if (entry.getBoolean("tile")) tiles++;
          accepted += size;
        }
        if (tiles > 40 || state.getInt("tileAttempts") != tiles || state.getLong("acceptedBodyBytes") != accepted)
          throw new IOException("Invalid persistent tile/body totals");
      } else {
        state = new JSONObject().put("version", 1).put("scope", run).put("attempts", 0)
          .put("tileAttempts", 0).put("chargedBodyBytes", 0).put("acceptedBodyBytes", 0)
          .put("entries", new JSONArray());
        writeAtomic(path, state);
      }
    }
    synchronized int reserve(boolean tile) throws Exception {
      int attempts = state.getInt("attempts");
      int tiles = state.getInt("tileAttempts");
      long charged = state.getLong("chargedBodyBytes");
      if (attempts >= 100 || (tile && tiles >= 40) || charged + RESERVATION > 8192)
        throw new IOException("Persistent QA budget exhausted");
      int id = attempts + 1;
      state.put("attempts", id).put("tileAttempts", tiles + (tile ? 1 : 0))
        .put("chargedBodyBytes", charged + RESERVATION);
      state.getJSONArray("entries").put(new JSONObject().put("id", id).put("status", "pending")
        .put("reservation", RESERVATION).put("accepted", 0).put("tile", tile));
      // Charges are intentionally never refunded, including on process termination.
      writeAtomic(path, state);
      return id;
    }
    synchronized void finish(int id, long accepted, boolean success) throws Exception {
      JSONObject entry = state.getJSONArray("entries").getJSONObject(id - 1);
      if (!entry.getString("status").equals("pending") || accepted < 0 || accepted > RESERVATION)
        throw new IOException("Invalid or repeated completion");
      entry.put("accepted", accepted).put("status", success ? "success" : "failed");
      state.put("acceptedBodyBytes", state.getLong("acceptedBodyBytes") + accepted);
      writeAtomic(path, state);
    }
    synchronized JSONObject snapshot() throws Exception { return new JSONObject(state.toString()); }
  }

  static final class Tag {
    final AtomicInteger exchanges = new AtomicInteger();
  }

  static final class Gate {
    static final Dispatcher SHARED_DISPATCHER = new Dispatcher();
    static {
      SHARED_DISPATCHER.setMaxRequests(4);
      SHARED_DISPATCHER.setMaxRequestsPerHost(4);
    }
    final HttpUrl base;
    final Ledger ledger;
    final OkHttpClient client;
    static final AtomicInteger active = new AtomicInteger();
    static final AtomicInteger maxActive = new AtomicInteger();
    Gate(HttpUrl base, Ledger ledger) {
      this.base = base;
      this.ledger = ledger;
      client = new OkHttpClient.Builder().dispatcher(SHARED_DISPATCHER).cookieJar(CookieJar.NO_COOKIES)
        .proxy(Proxy.NO_PROXY).cache(null).followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).protocols(Arrays.asList(Protocol.HTTP_1_1))
        .callTimeout(60, TimeUnit.SECONDS).connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS).addNetworkInterceptor(chain -> {
          Request request = chain.request();
          validate(request.url());
          Tag tag = request.tag(Tag.class);
          if (tag == null || tag.exchanges.incrementAndGet() != 1)
            throw new IOException("Automatic follow-up blocked before exchange");
          if (!UA.equals(request.header("User-Agent")) || request.header("Authorization") != null ||
              request.header("Cookie") != null) throw new IOException("Unsafe QA headers");
          return chain.proceed(request);
        }).build();
    }
    void validate(HttpUrl url) throws IOException {
      if (!url.scheme().equals(base.scheme()) || !url.host().equals(base.host()) ||
          url.port() != base.port() || !url.username().isEmpty() || !url.password().isEmpty() ||
          url.fragment() != null || !url.encodedPath().matches("/resource/(style|tile|glyph|sprite)/[A-Za-z0-9_-]{1,64}"))
        throw new IOException("Address outside the synthetic fixture allowlist");
      for (String name : url.queryParameterNames()) {
        List<String> values = url.queryParameterValues(name);
        if (values.size() != 1) throw new IOException("Repeated fixture parameter");
        String value = values.get(0);
        if (name.equals("bytes") || name.equals("delayMs") || name.equals("status")) {
          if (value == null || !value.matches("[0-9]{1,5}")) throw new IOException("Invalid fixture number");
          int n = Integer.parseInt(value);
          if ((name.equals("bytes") && n > 65536) || (name.equals("delayMs") && n > 2000) ||
              (name.equals("status") && (n < 200 || n > 599))) throw new IOException("Fixture number outside range");
        } else if (!(name.equals("chunked") || name.equals("gzip") || name.equals("redirect") ||
                     name.equals("hold")) || !"1".equals(value)) throw new IOException("Unknown fixture parameter");
      }
    }
    CompletableFuture<JSONObject> get(String relative) {
      CompletableFuture<JSONObject> future = new CompletableFuture<>();
      final int id;
      final HttpUrl url;
      try {
        url = base.resolve(relative);
        if (url == null) throw new IOException("Invalid fixture URL");
        validate(url);
        id = ledger.reserve(url.encodedPath().startsWith("/resource/tile/"));
      } catch (Exception error) {
        future.complete(result(false, 0, error.getMessage()));
        return future;
      }
      Request request = new Request.Builder().url(url).header("User-Agent", UA)
        .header("Accept-Encoding", "identity").tag(Tag.class, new Tag()).build();
      client.newCall(request).enqueue(new Callback() {
        @Override public void onFailure(Call call, IOException error) { complete(false, 0, error.getMessage()); }
        @Override public void onResponse(Call call, Response response) {
          int count = active.incrementAndGet();
          maxActive.accumulateAndGet(count, Math::max);
          long accepted = 0;
          boolean success = false;
          String failure = null;
          try (Response owned = response) {
            ResponseBody body = owned.body();
            if (!owned.isSuccessful()) throw new IOException("HTTP status refused: " + owned.code());
            String encoding = owned.header("Content-Encoding");
            if (encoding != null && !encoding.equalsIgnoreCase("identity"))
              throw new IOException("Compressed fixture refused before body acceptance");
            if (body == null || body.contentLength() < 0 || body.contentLength() > RESERVATION)
              throw new IOException("Unknown or oversized length refused before body acceptance");
            try (InputStream input = body.byteStream()) {
              byte[] buffer = new byte[64];
              int read;
              while ((read = input.read(buffer)) != -1) {
                if (accepted + read > RESERVATION) throw new IOException("Accepted body budget exceeded");
                for (int i = 0; i < read; i++) if (buffer[i] != 0x61) throw new IOException("Invalid synthetic payload");
                accepted += read;
              }
            }
            if (accepted != body.contentLength()) throw new IOException("Truncated fixture body");
            success = true;
          } catch (Exception error) { failure = error.getMessage(); }
          finally { active.decrementAndGet(); }
          complete(success, accepted, failure);
        }
        void complete(boolean success, long accepted, String error) {
          try { ledger.finish(id, accepted, success); }
          catch (Exception persistenceError) { success = false; error = "Ledger completion not durable"; }
          future.complete(result(success, accepted, error));
        }
      });
      return future;
    }
    static JSONObject result(boolean success, long accepted, String error) {
      JSONObject value = new JSONObject();
      try { value.put("success", success).put("acceptedBodyBytes", accepted).put("error", error == null ? JSONObject.NULL : error); }
      catch (Exception impossible) { throw new RuntimeException(impossible); }
      return value;
    }
  }
}
