#import <Foundation/Foundation.h>
#import "TPTransport.h"
#import "TPHTTPExchange.h"

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 6) return 2;
        NSString *origin = [NSString stringWithUTF8String:argv[1]];
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:argv[2]]];
        NSData *certificate = [TPTransport fixtureCertificateFromBase64:[NSString stringWithUTF8String:argv[3]]];
        NSURL *ledger = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[4]]];
        NSString *mode = [NSString stringWithUTF8String:argv[5]];
        if (![@[@"gate", @"exchange", @"legacy", @"mixed", @"gate-mixed-budget"] containsObject:mode]) return 2;
        __block NSDictionary *result;
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        NSURLSession *session;
        __block TPHTTPExchange *exchange;
        if ([mode isEqual:@"exchange"]) {
            dispatch_queue_t queue = dispatch_queue_create("app.trippainting.qa.private-tls-test", DISPATCH_QUEUE_SERIAL);
            dispatch_async(queue, ^{
                exchange = [[TPHTTPExchange alloc] initWithURL:url queue:queue timeout:1 privateFixtureOrigin:origin fixtureCertificate:certificate completion:^(NSHTTPURLResponse *response, NSData *data, NSError *error) {
                    result = @{@"error": @(error.code), @"length": @(data.length), @"sends": @(exchange.requestSendCount), @"trustAccepted": @(exchange.trustAccepted), @"diagnostics": exchange.diagnostics};
                    dispatch_semaphore_signal(done);
                }];
                [exchange start];
            });
        } else {
            BOOL configured;
            if ([mode isEqual:@"mixed"]) {
                configured = [TPTransport configureMixedPrivateFixtureTLSOrigin:origin ledgerURL:ledger certificate:certificate];
            } else if ([mode isEqual:@"gate-mixed-budget"]) {
                configured = [TPTransport configurePrivateFixtureTLSOrigin:origin ledgerURL:ledger maxRequests:16 maxTiles:8 maxReservedBytes:16384 certificate:certificate];
            } else if ([mode isEqual:@"legacy"]) {
                configured = [TPTransport configureFixtureTLSOrigin:origin ledgerURL:ledger maxRequests:2 maxTiles:2 maxReservedBytes:512 certificate:certificate];
            } else {
                configured = [TPTransport configurePrivateFixtureTLSOrigin:origin ledgerURL:ledger maxRequests:2 maxTiles:2 maxReservedBytes:512 certificate:certificate];
            }
            if (!configured) { result = @{@"configured": @NO}; dispatch_semaphore_signal(done); }
            else {
                NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
                configuration.protocolClasses = @[TPTransport.class]; configuration.URLCache = nil;
                configuration.HTTPCookieStorage = nil; configuration.URLCredentialStorage = nil;
                session = [NSURLSession sessionWithConfiguration:configuration];
                [[session dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                    result = @{@"configured": @YES, @"error": @(error.code), @"length": @(data.length), @"native": TPTransport.snapshot};
                    dispatch_semaphore_signal(done);
                }] resume];
            }
        }
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC))) return 3;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        [session invalidateAndCancel];
        return 0;
    }
}
