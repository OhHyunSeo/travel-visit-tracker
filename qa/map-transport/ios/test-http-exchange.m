#import <Foundation/Foundation.h>
#import "TPHTTPExchange.h"
#import "TPTransport.h"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 5 && argc != 6) return 2;
        NSUInteger count = argc == 6 ? strtoul(argv[5], NULL, 10) : 1;
        if (count < 1 || count > 16) return 2;
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:argv[1]]];
        double timeout = strtod(argv[2], NULL), cancellation = strtod(argv[3], NULL);
        NSString *ledgerPath = [NSString stringWithUTF8String:argv[4]];
        dispatch_queue_t queue = dispatch_queue_create("app.trippainting.maptransportqa.host", DISPATCH_QUEUE_SERIAL);
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSDictionary *result;
        __block TPHTTPExchange *exchange;
        NSURLSession *outer;
        if (![ledgerPath isEqual:@"-"]) {
            NSURLComponents *parts = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
            NSString *origin = [NSString stringWithFormat:@"http://%@:%@", parts.host, parts.port];
            NSUInteger maximum = count > 1 ? 16 : 2;
            if (![TPTransport configureOrigin:origin ledgerURL:[NSURL fileURLWithPath:ledgerPath] maxRequests:maximum maxTiles:maximum maxReservedBytes:maximum * 256]) return 3;
            NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
            configuration.protocolClasses = @[TPTransport.class];
            outer = [NSURLSession sessionWithConfiguration:configuration];
            NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
            [request setValue:@"must-not-forward" forHTTPHeaderField:@"Authorization"];
            [request setValue:@"must-not-forward" forHTTPHeaderField:@"Cookie"];
            NSMutableArray *results = [NSMutableArray new];
            for (NSUInteger i = 0; i < count; i++) [[outer dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                @synchronized(results) {
                    [results addObject:@{@"error": @(error.code), @"length": @(data.length)}];
                    if (results.count == count) {
                        result = count == 1 ? @{@"error": @(error.code), @"length": @(data.length), @"native": TPTransport.snapshot} : @{@"results": [results copy], @"native": TPTransport.snapshot};
                        dispatch_semaphore_signal(done);
                    }
                }
            }] resume];
        } else dispatch_async(queue, ^{
            exchange = [[TPHTTPExchange alloc] initWithURL:url queue:queue timeout:timeout completion:^(NSHTTPURLResponse *response, NSData *data, NSError *error) {
                result = @{@"error": @(error.code), @"length": @(data.length), @"sends": @(exchange.requestSendCount), @"receivedHTTPBytes": @(exchange.receivedHTTPBytes)};
                dispatch_semaphore_signal(done);
            }];
            [exchange start];
            [exchange start]; // Double-start may never write a second request.
            if (cancellation > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, cancellation * NSEC_PER_SEC), queue, ^{ [exchange cancel]; });
        });
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC))) return 4;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        [outer invalidateAndCancel];
        return 0;
    }
}
