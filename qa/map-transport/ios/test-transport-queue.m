#import <Foundation/Foundation.h>
#import "TPTransport.h"
#import <unistd.h>

static BOOL Wait(BOOL (^predicate)(void)) {
    NSTimeInterval end = NSProcessInfo.processInfo.systemUptime + 5;
    while (NSProcessInfo.processInfo.systemUptime < end) {
        if (predicate()) return YES;
        usleep(10000);
    }
    return NO;
}
static BOOL Write(NSDictionary *value, NSString *path) {
    return [[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil]
            writeToFile:path options:NSDataWritingAtomic error:nil];
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 4) return 2;
        NSString *origin = [NSString stringWithUTF8String:argv[1]];
        NSString *ledger = [NSString stringWithUTF8String:argv[2]];
        NSString *mode = [NSString stringWithUTF8String:argv[3]];
        if (![@[@"queue", @"pending-cancel", @"active-cancel"] containsObject:mode] ||
            ![TPTransport configureOrigin:origin ledgerURL:[NSURL fileURLWithPath:ledger] maxRequests:16 maxTiles:16 maxReservedBytes:4096]) return 3;
        NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.protocolClasses = @[TPTransport.class]; config.URLCache = nil;
        config.HTTPCookieStorage = nil; config.URLCredentialStorage = nil;
        NSOperationQueue *callbacks = [NSOperationQueue new]; callbacks.maxConcurrentOperationCount = 1;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:config delegate:nil delegateQueue:callbacks];
        NSMutableArray<NSURLSessionDataTask *> *tasks = [NSMutableArray new];
        NSMutableDictionary *results = [NSMutableDictionary new];
        for (NSUInteger i = 0; i < 8; i++) {
            NSURL *url = [NSURL URLWithString:[origin stringByAppendingFormat:@"/resource/tile/q_%lu", (unsigned long)i]];
            NSURLSessionDataTask *task = [session dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                @synchronized(results) { results[@(i).stringValue] = @{@"error": @(error.code), @"length": @(data.length)}; }
            }];
            [tasks addObject:task];
        }
        for (NSUInteger i = 0; i < 4; i++) [tasks[i] resume];
        if (!Wait(^BOOL { return [TPTransport.snapshot[@"active"] integerValue] == 4; })) return 4;
        for (NSUInteger i = 4; i < 8; i++) [tasks[i] resume];
        if (!Wait(^BOOL { return [TPTransport.snapshot[@"pending"] integerValue] == 4; })) return 5;
        if ([mode isEqual:@"pending-cancel"]) {
            [tasks[4] cancel]; [tasks[4] cancel];
            if (!Wait(^BOOL { NSDictionary *s = TPTransport.snapshot; return [s[@"pending"] integerValue] == 3 && [s[@"cancelledPending"] integerValue] == 1; })) return 6;
        }
        if (!Write(TPTransport.snapshot, [ledger stringByAppendingString:@".checkpoint"])) return 7;
        if ([mode isEqual:@"active-cancel"]) {
            if (!Wait(^BOOL { return [[NSFileManager defaultManager] fileExistsAtPath:[ledger stringByAppendingString:@".cancel"]]; })) return 8;
            [tasks[0] cancel]; [tasks[0] cancel];
            if (!Wait(^BOOL { NSDictionary *s = TPTransport.snapshot; return [s[@"cancelledActive"] integerValue] == 1 && [s[@"released"] integerValue] == 1 && [s[@"started"] integerValue] == 5; })) return 9;
            if (!Write(TPTransport.snapshot, [ledger stringByAppendingString:@".after-cancel"])) return 10;
        }
        if (!Wait(^BOOL { @synchronized(results) { return results.count == 8; } })) return 11;
        if (!Wait(^BOOL { NSDictionary *s = TPTransport.snapshot; return [s[@"active"] integerValue] == 0 && [s[@"pending"] integerValue] == 0; })) return 12;
        NSDictionary *output;
        @synchronized(results) { output = @{@"results": [results copy], @"native": TPTransport.snapshot}; }
        NSData *body = [NSJSONSerialization dataWithJSONObject:output options:NSJSONWritingSortedKeys error:nil];
        fwrite(body.bytes, 1, body.length, stdout); fputc('\n', stdout);
        [session invalidateAndCancel];
        return 0;
    }
}
