#import <Foundation/Foundation.h>
#import "TPHTTPExchange.h"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 5) return 2;
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:argv[1]]];
        NSData *certificate = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[2]]];
        if (!certificate) return 2;
        double timeout = strtod(argv[3], NULL), cancellation = strtod(argv[4], NULL);
        dispatch_queue_t queue = dispatch_queue_create("app.trippainting.maptransportqa.tls-host", DISPATCH_QUEUE_SERIAL);
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSDictionary *result;
        __block TPHTTPExchange *exchange;
        __block NSUInteger completions = 0;
        dispatch_async(queue, ^{
            exchange = [[TPHTTPExchange alloc] initWithURL:url queue:queue timeout:timeout fixtureCertificate:certificate completion:^(NSHTTPURLResponse *response, NSData *data, NSError *error) {
                completions++;
                result = @{@"error": @(error.code), @"length": @(data.length), @"sends": @(exchange.requestSendCount), @"receivedHTTPBytes": @(exchange.receivedHTTPBytes), @"trustAccepted": @(exchange.trustAccepted), @"chainTrusted": @(exchange.chainTrusted), @"alpn": exchange.negotiatedProtocol};
                // Observe a small late window, including a repeated cancel.
                [exchange cancel];
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), queue, ^{ dispatch_semaphore_signal(done); });
            }];
            [exchange start]; [exchange start];
            if (cancellation > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, cancellation * NSEC_PER_SEC), queue, ^{ [exchange cancel]; [exchange cancel]; });
        });
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) return 3;
        __block NSMutableDictionary *output;
        dispatch_sync(queue, ^{ output = [result mutableCopy]; output[@"completions"] = @(completions); });
        NSData *json = [NSJSONSerialization dataWithJSONObject:output options:NSJSONWritingSortedKeys error:nil];
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        return 0;
    }
}
