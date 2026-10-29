#import "TPTransport.h"
#import <arpa/inet.h>
#import <fcntl.h>
#import <unistd.h>
#import <math.h>
#import <errno.h>

static dispatch_queue_t TPQueue;
static NSMutableArray<TPTransport *> *TPPending;
static NSString *TPOrigin;
static NSURL *TPLedgerURL;
static NSMutableDictionary *TPLedger;
static BOOL TPLedgerOK;
static NSUInteger TPActive, TPMaxActive, TPBlocked, TPStarted, TPObserved, TPAccepted;
static NSUInteger TPMaxRequests, TPMaxTiles, TPMaxReserved;
static const NSUInteger TPReservation = 256;
static NSString * const TPUA = @"TripPaintingMapTransportQA/1.0";

@interface TPTransport ()
@property NSURLSession *forwardSession;
@property NSURLSessionDataTask *forwardTask;
@property BOOL acquired, stopped, settled, failed;
@property NSUInteger observed, accepted;
@property NSString *reservationID;
@end

@implementation TPTransport
+ (void)initialize {
    if (self == TPTransport.class) {
        TPQueue = dispatch_queue_create("app.trippainting.maptransportqa.gate", DISPATCH_QUEUE_SERIAL);
        TPPending = [NSMutableArray new];
    }
}
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    return [@[@"http", @"https"] containsObject:request.URL.scheme.lowercaseString];
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
+ (BOOL)safeOrigin:(NSString *)origin {
    NSURL *u = [NSURL URLWithString:origin];
    if (![u.scheme isEqual:@"http"] || u.user || u.password || u.query || u.fragment || !u.port || u.port.integerValue < 1 || u.port.integerValue > 65535 || (u.path.length && ![u.path isEqual:@"/"])) return NO;
    struct in_addr a;
    if (inet_pton(AF_INET, u.host.UTF8String, &a) != 1) return NO;
    uint32_t ip = ntohl(a.s_addr);
    return (ip >> 24) == 127 || (ip >> 24) == 10 || (ip >> 20) == 0xac1 || (ip >> 16) == 0xc0a8;
}
+ (BOOL)persistLedger {
    NSError *error;
    NSData *data = [NSJSONSerialization dataWithJSONObject:TPLedger options:NSJSONWritingSortedKeys error:&error];
    if (!data) return NO;
    NSURL *directory = TPLedgerURL.URLByDeletingLastPathComponent;
    if (![[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) return NO;
    NSString *temporary = [TPLedgerURL.path stringByAppendingFormat:@".%@.tmp", NSUUID.UUID.UUIDString];
    int fd = open(temporary.fileSystemRepresentation, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fd < 0) return NO;
    const uint8_t *bytes = data.bytes;
    size_t written = 0;
    BOOL ok = YES;
    while (written < data.length) {
        ssize_t n = write(fd, bytes + written, data.length - written);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { ok = NO; break; }
        written += (size_t)n;
    }
    if (ok && fsync(fd)) ok = NO;
    if (close(fd)) ok = NO;
    if (ok && rename(temporary.fileSystemRepresentation, TPLedgerURL.path.fileSystemRepresentation)) ok = NO;
    if (ok) {
        int dirfd = open(directory.path.fileSystemRepresentation, O_RDONLY);
        if (dirfd < 0) ok = NO;
        else { if (fsync(dirfd)) ok = NO; close(dirfd); }
    }
    if (!ok) unlink(temporary.fileSystemRepresentation);
    return ok;
}
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes {
    __block BOOL ok;
    dispatch_sync(TPQueue, ^{
        if (TPActive || TPPending.count) { ok = NO; return; }
        TPOrigin = [origin stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/"]];
        TPLedgerURL = ledgerURL;
        TPMaxRequests = requests; TPMaxTiles = tiles; TPMaxReserved = bytes;
        TPMaxActive = TPBlocked = TPStarted = TPObserved = TPAccepted = 0;
        BOOL exists = [[NSFileManager defaultManager] fileExistsAtPath:ledgerURL.path];
        NSData *data = exists ? [NSData dataWithContentsOfURL:ledgerURL] : nil;
        id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
        TPLedger = exists ? saved : [@{@"schema": @1, @"origin": TPOrigin ?: @"", @"requests": @0, @"tiles": @0, @"reservedBytes": @0, @"unresolved": [NSMutableArray new], @"maxRequests": @(requests), @"maxTiles": @(tiles), @"maxReservedBytes": @(bytes), @"reservationBytes": @(TPReservation)} mutableCopy];
        TPLedgerOK = [self safeOrigin:TPOrigin] && [TPLedger isKindOfClass:NSMutableDictionary.class] && [TPLedger[@"schema"] isEqual:@1] && [TPLedger[@"origin"] isEqual:TPOrigin] && [TPLedger[@"maxRequests"] isEqual:@(requests)] && [TPLedger[@"maxTiles"] isEqual:@(tiles)] && [TPLedger[@"maxReservedBytes"] isEqual:@(bytes)] && [TPLedger[@"reservationBytes"] isEqual:@(TPReservation)];
        for (NSString *key in @[@"requests", @"tiles", @"reservedBytes"]) {
            id value = TPLedgerOK ? TPLedger[key] : nil;
            if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() || !isfinite([value doubleValue]) || [value doubleValue] < 0 || floor([value doubleValue]) != [value doubleValue]) TPLedgerOK = NO;
        }
        if (TPLedgerOK && (![TPLedger[@"unresolved"] isKindOfClass:NSMutableArray.class] || [TPLedger[@"requests"] unsignedIntegerValue] > requests || [TPLedger[@"tiles"] unsignedIntegerValue] > tiles || [TPLedger[@"tiles"] unsignedIntegerValue] > [TPLedger[@"requests"] unsignedIntegerValue] || [TPLedger[@"reservedBytes"] unsignedIntegerValue] != [TPLedger[@"requests"] unsignedIntegerValue] * TPReservation || [TPLedger[@"reservedBytes"] unsignedIntegerValue] > bytes)) TPLedgerOK = NO;
        if (TPLedgerOK) for (id value in TPLedger[@"unresolved"]) if (![value isKindOfClass:NSString.class]) TPLedgerOK = NO;
        if (TPLedgerOK && !exists) TPLedgerOK = [self persistLedger];
        ok = TPLedgerOK;
    });
    return ok;
}
+ (NSDictionary *)snapshot {
    __block NSDictionary *result;
    dispatch_sync(TPQueue, ^{
        result = @{@"active": @(TPActive), @"maxActive": @(TPMaxActive), @"blockedBeforeDispatch": @(TPBlocked), @"started": @(TPStarted), @"observedBodyBytes": @(TPObserved), @"acceptedBodyBytes": @(TPAccepted), @"ledgerOK": @(TPLedgerOK), @"ledger": TPLedgerOK ? [NSJSONSerialization JSONObjectWithData:[NSJSONSerialization dataWithJSONObject:TPLedger options:0 error:nil] options:0 error:nil] : @{}};
    });
    return result;
}
- (BOOL)allowedRequest {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.request.URL resolvingAgainstBaseURL:NO];
    NSString *origin = [NSString stringWithFormat:@"%@://%@:%@", parts.scheme, parts.host, parts.port];
    if (![origin isEqual:TPOrigin] || parts.user || parts.password || parts.fragment || ![self.request.HTTPMethod isEqual:@"GET"]) return NO;
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^/resource/(style|tile|glyph|sprite)/[A-Za-z0-9_-]{1,64}$" options:0 error:nil];
    NSString *path = parts.percentEncodedPath;
    if ([pattern numberOfMatchesInString:path options:0 range:NSMakeRange(0, path.length)] != 1) return NO;
    NSDictionary *limits = @{@"bytes": @65536, @"delayMs": @2000, @"status": @599, @"chunked": @1, @"gzip": @1, @"redirect": @1, @"hold": @1};
    NSMutableSet *seen = [NSMutableSet new];
    NSCharacterSet *digits = [NSCharacterSet characterSetWithCharactersInString:@"0123456789"].invertedSet;
    for (NSURLQueryItem *item in parts.queryItems) {
        if (!limits[item.name] || [seen containsObject:item.name] || !item.value.length || [item.value rangeOfCharacterFromSet:digits].location != NSNotFound || item.value.integerValue > [limits[item.name] integerValue]) return NO;
        if (![item.value isEqual:[NSString stringWithFormat:@"%ld", (long)item.value.integerValue]]) return NO;
        if ([item.name isEqual:@"status"] && (item.value.integerValue < 200 || [@[@204, @205, @304] containsObject:@(item.value.integerValue)])) return NO;
        if ([@[@"chunked", @"gzip", @"redirect", @"hold"] containsObject:item.name] && ![item.value isEqual:@"1"]) return NO;
        [seen addObject:item.name];
    }
    return YES;
}
- (void)fail:(NSInteger)code {
    if (self.failed || self.stopped) return;
    self.failed = YES;
    [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:@"MapTransportQA" code:code userInfo:nil]];
}
+ (void)drain {
    while (TPActive < 4 && TPPending.count) {
        TPTransport *p = TPPending.firstObject;
        [TPPending removeObjectAtIndex:0];
        if (p.stopped) continue;
        if (!TPLedgerOK) { TPBlocked++; [p fail:3]; continue; }
        BOOL tile = [p.request.URL.path hasPrefix:@"/resource/tile/"];
        NSUInteger used = [TPLedger[@"requests"] unsignedIntegerValue];
        NSUInteger tileUsed = [TPLedger[@"tiles"] unsignedIntegerValue];
        NSUInteger bytes = [TPLedger[@"reservedBytes"] unsignedIntegerValue];
        if (!TPLedgerOK || used >= TPMaxRequests || (tile && tileUsed >= TPMaxTiles) || bytes > TPMaxReserved || TPMaxReserved - bytes < TPReservation) { TPBlocked++; [p fail:2]; continue; }
        p.reservationID = NSUUID.UUID.UUIDString;
        TPLedger[@"requests"] = @(used + 1); TPLedger[@"tiles"] = @(tileUsed + (tile ? 1 : 0)); TPLedger[@"reservedBytes"] = @(bytes + TPReservation);
        [TPLedger[@"unresolved"] addObject:p.reservationID];
        if (![self persistLedger]) { TPLedgerOK = NO; TPBlocked++; [p fail:3]; continue; }
        p.acquired = YES; TPActive++; TPStarted++; TPMaxActive = MAX(TPMaxActive, TPActive);
        NSMutableURLRequest *request = [p.request mutableCopy];
        [request setValue:TPUA forHTTPHeaderField:@"User-Agent"];
        [request setValue:nil forHTTPHeaderField:@"Authorization"];
        [request setValue:nil forHTTPHeaderField:@"Cookie"];
        [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
        request.HTTPShouldHandleCookies = NO;
        NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        configuration.protocolClasses = @[]; configuration.URLCache = nil; configuration.HTTPCookieStorage = nil; configuration.URLCredentialStorage = nil; configuration.HTTPShouldSetCookies = NO;
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 45;
        NSOperationQueue *callbacks = [NSOperationQueue new]; callbacks.maxConcurrentOperationCount = 1;
        p.forwardSession = [NSURLSession sessionWithConfiguration:configuration delegate:p delegateQueue:callbacks];
        p.forwardTask = [p.forwardSession dataTaskWithRequest:request];
        [p.forwardTask resume];
    }
}
- (void)startLoading {
    dispatch_async(TPQueue, ^{
        if (![self allowedRequest]) { TPBlocked++; [self fail:1]; return; }
        [TPPending addObject:self]; [TPTransport drain];
    });
}
- (void)stopLoading {
    dispatch_async(TPQueue, ^{
        self.stopped = YES;
        [TPPending removeObject:self];
        [self.forwardTask cancel];
        // An active permit stays held until the native completion callback.
    });
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
    completionHandler(nil);
    dispatch_async(TPQueue, ^{ [self fail:4]; [self.forwardTask cancel]; });
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    dispatch_async(TPQueue, ^{
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        NSString *encoding = [http valueForHTTPHeaderField:@"Content-Encoding"];
        BOOL allowed = !self.stopped && !self.failed && http.statusCode == 200 && response.expectedContentLength >= 0 && response.expectedContentLength <= TPReservation && (!encoding.length || [encoding.lowercaseString isEqual:@"identity"]);
        if (allowed) { [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed]; completionHandler(NSURLSessionResponseAllow); }
        else { [self fail:5]; completionHandler(NSURLSessionResponseCancel); }
    });
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
    dispatch_async(TPQueue, ^{
        self.observed += data.length; TPObserved += data.length;
        if (self.stopped || self.failed) return;
        if (data.length > TPReservation - self.accepted) { [self fail:6]; [self.forwardTask cancel]; return; }
        self.accepted += data.length; TPAccepted += data.length;
        [self.client URLProtocol:self didLoadData:data];
    });
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
    dispatch_async(TPQueue, ^{
        if (self.settled) return;
        self.settled = YES;
        if (self.acquired) {
            [TPLedger[@"unresolved"] removeObject:self.reservationID];
            if (![TPTransport persistLedger]) TPLedgerOK = NO;
            TPActive--; self.acquired = NO;
        }
        if (!self.stopped && !self.failed) {
            if (error) [self fail:7];
            else [self.client URLProtocolDidFinishLoading:self];
        }
        [self.forwardSession finishTasksAndInvalidate]; self.forwardTask = nil; self.forwardSession = nil;
        [TPTransport drain];
    });
}
@end
