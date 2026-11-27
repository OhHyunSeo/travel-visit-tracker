package app.trippainting.maptransportqa;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureTlsDeadlineTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static Call start(FixtureHttpClient client, String url, CompletableFuture<IOException> result) {
    Call call = client.newCall(new Request.Builder().url(url).build());
    call.enqueue(new Callback() {
      @Override public void onFailure(Call failed, IOException error) { result.complete(error); }

      @Override public void onResponse(Call completed, Response response) {
        response.close();
        result.completeExceptionally(new AssertionError("Incomplete TLS handshake produced HTTP"));
      }
    });
    return call;
  }

  public static void main(String[] args) throws Exception {
    ExecutorService workers = Executors.newFixedThreadPool(3);
    List<Socket> sockets = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch[] hello = {new CountDownLatch(1), new CountDownLatch(1)};
    try (ServerSocket listener = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))) {
      Future<?> accepts = workers.submit(() -> {
        for (int index = 0; index < 2; index++) {
          Socket socket = listener.accept();
          sockets.add(socket);
          CountDownLatch received = hello[index];
          workers.submit(() -> {
            try (Socket owned = socket) {
              owned.setSoTimeout(2_000);
              if (owned.getInputStream().read() != -1) received.countDown();
              release.await(12, TimeUnit.SECONDS);
            } catch (IOException closed) {
              // The client may close its socket after cancellation or timeout.
            } catch (InterruptedException interrupted) {
              Thread.currentThread().interrupt();
            }
          });
        }
        return null;
      });
      int port = listener.getLocalPort();
      String url = "https://127.0.0.1:" + port + "/resource/style/sdk";
      try (FixtureBudget budget = new FixtureBudget(2, 2, 4, 8);
           FixtureHttpClient client = FixtureHttpClient.https(port, chain -> chain.proceed(chain.request()), budget,
               (X509Certificate) FixtureTlsTest.keys("loopback").getCertificate("fixture"))) {
        CompletableFuture<IOException> timeout = new CompletableFuture<>();
        long began = System.nanoTime();
        start(client, url, timeout);
        check(hello[0].await(2, TimeUnit.SECONDS), "first TLS client hello reached server");
        check(timeout.get(7, TimeUnit.SECONDS) instanceof InterruptedIOException, "TLS handshake call deadline");
        check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) >= 4_000, "deadline was not immediate refusal");

        CompletableFuture<IOException> cancelled = new CompletableFuture<>();
        Call active = start(client, url, cancelled);
        check(hello[1].await(2, TimeUnit.SECONDS), "second TLS client hello reached server");
        active.cancel();
        active.cancel();
        cancelled.get(2, TimeUnit.SECONDS);
        check(active.isCanceled(), "handshake cancellation observed");
        budget.close();
        check(budget.snapshot().attempts == 0 && budget.snapshot().reservedBytes == 0,
            "no HTTP reservation before either TLS handshake completed");
      }
      accepts.get(2, TimeUnit.SECONDS);
      check(sockets.size() == 2, "exact handshake connection count");
      System.out.println("FixtureTlsDeadline PASS: incomplete handshake times out or cancels, no HTTP reservation");
    } finally {
      release.countDown();
      synchronized (sockets) { for (Socket socket : sockets) socket.close(); }
      workers.shutdownNow();
    }
  }
}
