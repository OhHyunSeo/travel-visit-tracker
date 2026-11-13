#import "TPTransport.h"
#import "TPHTTPExchange.h"
#import <arpa/inet.h>
#import <fcntl.h>
#import <unistd.h>
#import <math.h>
#import <errno.h>
#import <sys/stat.h>
#import <Security/Security.h>

static dispatch_queue_t TPQueue;
static NSMutableArray<TPTransport *> *TPPending;
static NSString *TPOrigin;
static NSData *TPFixtureCertificate;
static BOOL TPPrivateFixtureTLS, TPMixedResources;
static NSURL *TPLedgerURL;
static NSMutableDictionary *TPLedger;
static BOOL TPLedgerOK;
static NSUInteger TPActive, TPMaxActive, TPBlocked, TPStarted, TPAccepted;
static NSUInteger TPMaxRequests, TPMaxTiles, TPMaxReserved;
static NSUInteger TPHTTPSends, TPHTTPReceived;
static NSUInteger TPVerifiedTLS;
static NSDictionary *TPLastExchangeDiagnostics;
static NSUInteger TPMaxPending, TPCancelledPending, TPCancelledActive, TPReleased;
static NSUInteger TPMixedActiveSprites;
static const NSUInteger TPLedgerReadLimit = 64 * 1024;

static NSUInteger TPReservation(BOOL mixed) {
    return mixed ? TPMixedFixtureBodyLimit : TPFixtureBodyLimit;
}

static BOOL TPMixedFixturePath(NSString *path) {
    if ([path isEqual:@"/resource/style/mixed"] || [path isEqual:@"/resource/glyph/QA/0-255.pbf"] ||
        [path isEqual:@"/resource/glyph/Noto%20Sans%20Regular/0-255.pbf"]) return YES;
    static NSRegularExpression *resources;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        resources = [NSRegularExpression regularExpressionWithPattern:@"^/resource/(tile/m_2_[0-3]_[0-3]|sprite/mixed(@2x)?\\.(json|png))$" options:0 error:nil];
    });
    return [resources numberOfMatchesInString:path options:0 range:NSMakeRange(0, path.length)] == 1;
}

static BOOL TPUnsignedInteger(id value, NSUInteger *result) {
    if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()
        || CFNumberIsFloatType((__bridge CFNumberRef)value)) return NO;
    NSString *text = [value stringValue];
    if (!text.length) return NO;
    NSUInteger number = 0;
    for (NSUInteger i = 0; i < text.length; i++) {
        unichar c = [text characterAtIndex:i];
        if (c < '0' || c > '9' || number > (NSUIntegerMax - (c - '0')) / 10) return NO;
        number = number * 10 + (c - '0');
    }
    *result = number;
    return YES;
}

static BOOL TPLedgerFileURL(NSURL *url) {
    if (![url isKindOfClass:NSURL.class] || !url.isFileURL || url.host.length || url.user || url.password || url.query || url.fragment
        || ![url.path hasPrefix:@"/"] || url.path.length < 2) return NO;
    for (NSUInteger i = 0; i < url.path.length; i++) if ([url.path characterAtIndex:i] == 0) return NO;
    return YES;
}

static BOOL TPMatchingLedgerStat(struct stat a, struct stat b) {
    return S_ISREG(b.st_mode) && b.st_nlink == 1 && a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size
        && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec
        && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}

// A missing file is distinct from an unreadable/unsafe existing file. The size
// check precedes allocation; one stack byte checks EOF without growing the body.
static BOOL TPReadLedger(NSURL *url, NSData **data) {
    *data = nil;
    int fd = open(url.path.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return errno == ENOENT;
    struct stat before, after;
    BOOL ok = fstat(fd, &before) == 0 && S_ISREG(before.st_mode) && before.st_nlink == 1
        && before.st_size > 0 && before.st_size <= (off_t)TPLedgerReadLimit;
    NSMutableData *body = ok ? [NSMutableData dataWithLength:(NSUInteger)before.st_size] : nil;
    NSUInteger offset = 0;
    while (ok && offset < body.length) {
        ssize_t n = read(fd, (uint8_t *)body.mutableBytes + offset, body.length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { ok = NO; break; }
        offset += (NSUInteger)n;
    }
    uint8_t extra;
    ssize_t tail = -1;
    if (ok) do { tail = read(fd, &extra, 1); } while (tail < 0 && errno == EINTR);
    if (ok) ok = tail == 0 && fstat(fd, &after) == 0 && TPMatchingLedgerStat(before, after);
    if (close(fd)) ok = NO;
    if (ok) *data = body;
    return ok;
}

static BOOL TPValidLedger(NSMutableDictionary *ledger, NSString *origin, NSUInteger requests, NSUInteger tiles, NSUInteger bytes, NSData *certificate, BOOL mixed) {
    if (![ledger isKindOfClass:NSMutableDictionary.class]) return NO;
    NSMutableSet *keys = [NSMutableSet setWithArray:@[@"schema", @"origin", @"requests", @"tiles", @"reservedBytes", @"unresolved", @"maxRequests", @"maxTiles", @"maxReservedBytes", @"reservationBytes"]];
    if (certificate) [keys addObject:@"fixtureTLSLeafDER"];
    if (mixed) [keys addObject:@"fixtureResourceProfile"];
    if (![[NSSet setWithArray:ledger.allKeys] isEqual:keys] || ![ledger[@"origin"] isKindOfClass:NSString.class] || ![ledger[@"origin"] isEqual:origin]) return NO;
    NSUInteger reservation = TPReservation(mixed);
    NSDictionary *identity = @{@"schema": @1, @"maxRequests": @(requests), @"maxTiles": @(tiles), @"maxReservedBytes": @(bytes), @"reservationBytes": @(reservation)};
    for (NSString *key in identity) {
        NSUInteger value;
        if (!TPUnsignedInteger(ledger[key], &value) || value != [identity[key] unsignedIntegerValue]) return NO;
    }
    if (certificate && (![ledger[@"fixtureTLSLeafDER"] isKindOfClass:NSString.class]
        || ![ledger[@"fixtureTLSLeafDER"] isEqual:[certificate base64EncodedStringWithOptions:0]])) return NO;
    if (mixed && ![ledger[@"fixtureResourceProfile"] isEqual:@"mixed-v1"]) return NO;
    NSUInteger used, tileUsed, reserved;
    if (!TPUnsignedInteger(ledger[@"requests"], &used) || !TPUnsignedInteger(ledger[@"tiles"], &tileUsed)
        || !TPUnsignedInteger(ledger[@"reservedBytes"], &reserved) || used > requests || tileUsed > tiles || tileUsed > used
        || used > NSUIntegerMax / reservation || reserved != used * reservation || reserved > bytes
        || ![ledger[@"unresolved"] isKindOfClass:NSMutableArray.class] || [ledger[@"unresolved"] count] > used) return NO;
    NSMutableSet *seen = [NSMutableSet new];
    for (id value in ledger[@"unresolved"]) {
        if (![value isKindOfClass:NSString.class] || [value length] != 36 || [seen containsObject:value]) return NO;
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:value];
        if (!uuid || ![uuid.UUIDString isEqual:value]) return NO;
        [seen addObject:value];
    }
    return YES;
}

@interface TPTransport ()
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes fixtureCertificate:(NSData *)certificate;
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes fixtureCertificate:(NSData *)certificate privateTLS:(BOOL)privateTLS mixedResources:(BOOL)mixed;
+ (BOOL)configurePrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate mixedResources:(BOOL)mixed;
@property TPHTTPExchange *exchange;
@property BOOL acquired, stopped, settled, failed, mixedSprite;
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
    if (![origin isKindOfClass:NSString.class]) return NO;
    NSURL *u = [NSURL URLWithString:origin];
    if (![u.scheme isEqual:@"http"] || u.user || u.password || u.query || u.fragment || !u.port || u.port.integerValue < 1 || u.port.integerValue > 65535 || (u.path.length && ![u.path isEqual:@"/"])) return NO;
    struct in_addr a;
    if (inet_pton(AF_INET, u.host.UTF8String, &a) != 1) return NO;
    uint32_t ip = ntohl(a.s_addr);
    return (ip >> 24) == 127 || (ip >> 24) == 10 || (ip >> 20) == 0xac1 || (ip >> 16) == 0xc0a8;
}
+ (BOOL)persistLedger:(NSDictionary *)ledger toURL:(NSURL *)ledgerURL {
    NSError *error;
    NSData *data = [NSJSONSerialization dataWithJSONObject:ledger options:NSJSONWritingSortedKeys error:&error];
    if (!data || data.length > TPLedgerReadLimit) return NO;
    NSURL *directory = ledgerURL.URLByDeletingLastPathComponent;
    if (![[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) return NO;
    NSString *temporary = [ledgerURL.path stringByAppendingFormat:@".%@.tmp", NSUUID.UUID.UUIDString];
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
    if (ok && rename(temporary.fileSystemRepresentation, ledgerURL.path.fileSystemRepresentation)) ok = NO;
    if (ok) {
        int dirfd = open(directory.path.fileSystemRepresentation, O_RDONLY);
        if (dirfd < 0) ok = NO;
        else { if (fsync(dirfd)) ok = NO; close(dirfd); }
    }
    if (!ok) unlink(temporary.fileSystemRepresentation);
    return ok;
}
+ (BOOL)persistLedger { return [self persistLedger:TPLedger toURL:TPLedgerURL]; }
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes {
    return [self configureOrigin:origin ledgerURL:ledgerURL maxRequests:requests maxTiles:tiles maxReservedBytes:bytes fixtureCertificate:nil];
}
+ (BOOL)configureFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate {
    if (@available(macOS 15.5, iOS 18.5, *)) { /* Matches TPHTTPExchange's TLS API. */ }
    else return NO;
    if (![origin isKindOfClass:NSString.class] || ![certificate isKindOfClass:NSData.class]) return NO;
    NSURL *url = [NSURL URLWithString:origin];
    if (![url.scheme isEqual:@"https"] || ![url.host isEqual:@"127.0.0.1"] || url.user || url.password || url.query || url.fragment || !url.port || url.port.integerValue < 1 || url.port.integerValue > 65535 || (url.path.length && ![url.path isEqual:@"/"]) || !certificate.length || certificate.length > 16384) return NO;
    SecCertificateRef leaf = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)certificate);
    if (!leaf) return NO;
    CFRelease(leaf);
    return [self configureOrigin:origin ledgerURL:ledgerURL maxRequests:requests maxTiles:tiles maxReservedBytes:bytes fixtureCertificate:[certificate copy]];
}
+ (BOOL)safePrivateFixtureTLSOrigin:(NSString *)origin { return [TPHTTPExchange safePrivateFixtureTLSOrigin:origin]; }
+ (NSData *)fixtureCertificateFromBase64:(NSString *)encoded {
    if (![encoded isKindOfClass:NSString.class] || !encoded.length || encoded.length > 21848) return nil;
    NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
    if (!data.length || data.length > 16384 || ![[data base64EncodedStringWithOptions:0] isEqual:encoded]) return nil;
    SecCertificateRef leaf = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)data);
    if (!leaf) return nil;
    CFRelease(leaf);
    return [data copy];
}
+ (BOOL)configurePrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate {
    return [self configurePrivateFixtureTLSOrigin:origin ledgerURL:ledgerURL maxRequests:requests maxTiles:tiles maxReservedBytes:bytes certificate:certificate mixedResources:NO];
}
+ (BOOL)configureMixedPrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL certificate:(NSData *)certificate {
    return [self configurePrivateFixtureTLSOrigin:origin ledgerURL:ledgerURL maxRequests:16 maxTiles:8 maxReservedBytes:16384 certificate:certificate mixedResources:YES];
}
+ (BOOL)configurePrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate mixedResources:(BOOL)mixed {
    if (@available(macOS 15.5, iOS 18.5, *)) { /* Matches the existing TLS API. */ }
    else return NO;
    if (![origin isKindOfClass:NSString.class] || ![certificate isKindOfClass:NSData.class] || ![self safePrivateFixtureTLSOrigin:origin] || !certificate.length || certificate.length > 16384) return NO;
    SecCertificateRef leaf = SecCertificateCreateWithData(NULL, (__bridge CFDataRef)certificate);
    if (!leaf) return NO;
    CFRelease(leaf);
    return [self configureOrigin:origin ledgerURL:ledgerURL maxRequests:requests maxTiles:tiles maxReservedBytes:bytes fixtureCertificate:[certificate copy] privateTLS:YES mixedResources:mixed];
}
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes fixtureCertificate:(NSData *)certificate {
    return [self configureOrigin:origin ledgerURL:ledgerURL maxRequests:requests maxTiles:tiles maxReservedBytes:bytes fixtureCertificate:certificate privateTLS:NO mixedResources:NO];
}
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes fixtureCertificate:(NSData *)certificate privateTLS:(BOOL)privateTLS mixedResources:(BOOL)mixed {
    __block BOOL ok = NO;
    dispatch_sync(TPQueue, ^{
        NSUInteger reservation = TPReservation(mixed);
        if (TPActive || TPPending.count || ![origin isKindOfClass:NSString.class] || !TPLedgerFileURL(ledgerURL)
            || !requests || requests > NSUIntegerMax / reservation || tiles > requests || bytes < reservation) return;
        NSString *candidateOrigin = [origin stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/"]];
        if (!certificate && ![self safeOrigin:candidateOrigin]) return;
        NSData *data;
        if (!TPReadLedger(ledgerURL, &data)) return;
        id candidate = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil]
            : [@{@"schema": @1, @"origin": candidateOrigin, @"requests": @0, @"tiles": @0, @"reservedBytes": @0, @"unresolved": [NSMutableArray new], @"maxRequests": @(requests), @"maxTiles": @(tiles), @"maxReservedBytes": @(bytes), @"reservationBytes": @(reservation)} mutableCopy];
        if (!data && certificate) candidate[@"fixtureTLSLeafDER"] = [certificate base64EncodedStringWithOptions:0];
        if (!data && mixed) candidate[@"fixtureResourceProfile"] = @"mixed-v1";
        if (!TPValidLedger(candidate, candidateOrigin, requests, tiles, bytes, certificate, mixed)) return;
        if (!data && ![self persistLedger:candidate toURL:ledgerURL]) return;
        // Publish only after all validation/persistence succeeds. A rejected
        // reconfiguration keeps the previous configuration and counters intact.
        TPOrigin = candidateOrigin;
        TPFixtureCertificate = [certificate copy];
        TPPrivateFixtureTLS = privateTLS; TPMixedResources = mixed; TPMixedActiveSprites = 0;
        TPLedgerURL = ledgerURL;
        TPMaxRequests = requests; TPMaxTiles = tiles; TPMaxReserved = bytes;
        TPMaxActive = TPBlocked = TPStarted = TPAccepted = 0;
        TPHTTPSends = TPHTTPReceived = TPVerifiedTLS = 0;
        TPLastExchangeDiagnostics = @{};
        TPMaxPending = TPCancelledPending = TPCancelledActive = TPReleased = 0;
        TPLedger = candidate; TPLedgerOK = YES;
        ok = YES;
    });
    return ok;
}
+ (NSDictionary *)snapshot {
    __block NSDictionary *result;
    dispatch_sync(TPQueue, ^{
        result = @{@"active": @(TPActive), @"maxActive": @(TPMaxActive), @"pending": @(TPPending.count), @"maxPending": @(TPMaxPending), @"cancelledPending": @(TPCancelledPending), @"cancelledActive": @(TPCancelledActive), @"released": @(TPReleased), @"blockedBeforeDispatch": @(TPBlocked), @"started": @(TPStarted), @"httpRequestSendsSettled": @(TPHTTPSends), @"receivedHTTPBytesSettled": @(TPHTTPReceived), @"lastExchange": TPLastExchangeDiagnostics ?: @{}, @"tlsVerifiedExchanges": @(TPVerifiedTLS), @"transport": TPFixtureCertificate ? (TPPrivateFixtureTLS ? @"pinned-private-tls-http1-fixture" : @"pinned-loopback-tls-http1-fixture") : @"single-send-http1-fixture", @"acceptedBodyBytes": @(TPAccepted), @"ledgerOK": @(TPLedgerOK), @"ledger": TPLedgerOK ? [NSJSONSerialization JSONObjectWithData:[NSJSONSerialization dataWithJSONObject:TPLedger options:0 error:nil] options:0 error:nil] : @{}};
        if (TPMixedResources) {
            NSMutableDictionary *mixed = [result mutableCopy];
            mixed[@"mixedActiveSprites"] = @(TPMixedActiveSprites);
            result = [mixed copy];
        }
    });
    return result;
}
- (BOOL)allowedRequest {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.request.URL resolvingAgainstBaseURL:NO];
    NSString *origin = [NSString stringWithFormat:@"%@://%@:%@", parts.scheme, parts.host, parts.port];
    if (![origin isEqual:TPOrigin] || parts.user || parts.password || parts.fragment || ![self.request.HTTPMethod isEqual:@"GET"]) return NO;
    NSString *path = parts.percentEncodedPath;
    if (TPMixedResources) return !parts.percentEncodedQuery && TPMixedFixturePath(path);
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^/resource/(style|tile|glyph|sprite)/[A-Za-z0-9_-]{1,64}$" options:0 error:nil];
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
    NSUInteger reservation = TPReservation(TPMixedResources);
    while (TPActive < 4 && TPPending.count) {
        TPTransport *p = TPPending.firstObject;
        [TPPending removeObjectAtIndex:0];
        if (p.stopped) continue;
        if (!TPLedgerOK) { TPBlocked++; [p fail:3]; continue; }
        BOOL tile = [p.request.URL.path hasPrefix:@"/resource/tile/"];
        NSUInteger used = [TPLedger[@"requests"] unsignedIntegerValue];
        NSUInteger tileUsed = [TPLedger[@"tiles"] unsignedIntegerValue];
        NSUInteger bytes = [TPLedger[@"reservedBytes"] unsignedIntegerValue];
        if (!TPLedgerOK || used >= TPMaxRequests || (tile && tileUsed >= TPMaxTiles) || bytes > TPMaxReserved || TPMaxReserved - bytes < reservation) { TPBlocked++; [p fail:2]; continue; }
        p.reservationID = NSUUID.UUID.UUIDString;
        TPLedger[@"requests"] = @(used + 1); TPLedger[@"tiles"] = @(tileUsed + (tile ? 1 : 0)); TPLedger[@"reservedBytes"] = @(bytes + reservation);
        [TPLedger[@"unresolved"] addObject:p.reservationID];
        if (![self persistLedger]) { TPLedgerOK = NO; TPBlocked++; [p fail:3]; continue; }
        p.acquired = YES; TPActive++; TPStarted++; TPMaxActive = MAX(TPMaxActive, TPActive);
        p.mixedSprite = TPMixedResources && [p.request.URL.path hasPrefix:@"/resource/sprite/"];
        if (p.mixedSprite) TPMixedActiveSprites++;
        void (^completion)(NSHTTPURLResponse *, NSData *, NSError *) = ^(NSHTTPURLResponse *response, NSData *data, NSError *error) {
            [p exchangeCompleted:response data:data error:error];
        };
        if (TPPrivateFixtureTLS) p.exchange = [[TPHTTPExchange alloc] initWithURL:p.request.URL queue:TPQueue timeout:10 privateFixtureOrigin:TPOrigin fixtureCertificate:TPFixtureCertificate mixedResources:TPMixedResources completion:completion];
        else if (TPFixtureCertificate) p.exchange = [[TPHTTPExchange alloc] initWithURL:p.request.URL queue:TPQueue timeout:10 fixtureCertificate:TPFixtureCertificate completion:completion];
        else p.exchange = [[TPHTTPExchange alloc] initWithURL:p.request.URL queue:TPQueue timeout:10 completion:completion];
        [p.exchange start];
    }
}
- (void)startLoading {
    dispatch_async(TPQueue, ^{
        if (self.stopped) return;
        if (![self allowedRequest]) { TPBlocked++; [self fail:1]; return; }
        [TPPending addObject:self]; [TPTransport drain];
        TPMaxPending = MAX(TPMaxPending, TPPending.count);
    });
}
- (void)stopLoading {
    dispatch_async(TPQueue, ^{
        if (self.stopped) return;
        if ([TPPending containsObject:self]) TPCancelledPending++;
        if (self.acquired && !self.settled) TPCancelledActive++;
        self.stopped = YES;
        [TPPending removeObject:self];
        [self.exchange cancel];
        // An active permit stays held until the native completion callback.
    });
}
- (void)exchangeCompleted:(NSHTTPURLResponse *)response data:(NSData *)data error:(NSError *)error {
    if (self.settled) return;
    self.settled = YES;
    TPLastExchangeDiagnostics = [self.exchange.diagnostics copy];
    TPHTTPSends += self.exchange.requestSendCount;
    TPHTTPReceived += self.exchange.receivedHTTPBytes;
    if (!error && self.exchange.trustAccepted && [self.exchange.negotiatedProtocol isEqual:@"http/1.1"]) TPVerifiedTLS++;
    if (self.acquired) {
        if (self.mixedSprite) TPMixedActiveSprites--;
        [TPLedger[@"unresolved"] removeObject:self.reservationID];
        if (![TPTransport persistLedger]) TPLedgerOK = NO;
        TPActive--; TPReleased++; self.acquired = NO;
    }
    if (!self.stopped && !self.failed) {
        if (error) [self fail:7];
        else {
            TPAccepted += data.length;
            [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
            [self.client URLProtocol:self didLoadData:data];
            [self.client URLProtocolDidFinishLoading:self];
        }
    }
    self.exchange = nil;
    [TPTransport drain];
}
@end
