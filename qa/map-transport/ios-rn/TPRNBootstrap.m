#import "TPRNBootstrap.h"
#import "TPTransport.h"
#import "MLRNTransformRequest.h"
#import "TripPainting-Swift.h"
#import <React/RCTBridgeModule.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import <MapLibre/MLNSettings.h>
#import <MapLibre/MLNStyle.h>

static NSString *TPRNOrigin, *TPRNRunID;
static NSURL *TPRNDirectory;
static MLRNTransformRequest *TPRNDelegate;
static NSMutableArray<NSDictionary *> *TPRNRequests;
static NSURL *TPRNOriginalDefaultStyle;
static NSString *TPRNInitialStyleMode;
static BOOL TPRNLocalBootstrap, TPRNRenderConfirmed, TPRNRecoveryReported, TPRNRecoveryPassed;
static NSString *TPRNTrial;
static NSString *const TPRNPackStylePath = @"/resource/style/pack-recovery";
static NSString *const TPRNPackTilePath = @"/resource/tile/pack_8_219_98";
static NSString *const TPRNPackGateError = @"TripPaintingFixturePackGate";
static BOOL TPRNPackPreflightStarted, TPRNPackAuthorized;
static NSUInteger TPRNPackClosedDenials, TPRNPackScopeDenials;

enum { TPRNPackClosed = 1, TPRNPackOutsideScope = 2 };

static BOOL TPRNIsPackTrial(void) { return ![TPRNTrial isEqual:@"render"]; }

@interface TPRNTransport : TPTransport
@end

@implementation TPRNTransport
- (void)startLoading {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.request.URL resolvingAgainstBaseURL:NO];
    NSString *origin = [NSString stringWithFormat:@"%@://%@:%@", parts.scheme, parts.host, parts.port];
    NSString *path = parts.percentEncodedPath;
    NSArray *fixturePaths = TPRNIsPackTrial() ? @[TPRNPackStylePath, TPRNPackTilePath] :
        @[@"/resource/style/rn-entry", @"/resource/style/sdk", @"/resource/tile/0_0_0", @"/resource/style/empty"];
    BOOL fixtureOrigin = [origin isEqual:TPRNOrigin];
    BOOL fixturePath = fixtureOrigin && [fixturePaths containsObject:path ?: @""];
    NSString *resource = fixturePath ? path : @"other";
    NSInteger denial = 0;
    @synchronized (TPRNTransport.class) {
        if (TPRNIsPackTrial()) {
            if (!fixturePath || parts.user || parts.password || parts.percentEncodedQuery || parts.fragment ||
                ![self.request.HTTPMethod isEqual:@"GET"]) {
                TPRNPackScopeDenials++;
                denial = TPRNPackOutsideScope;
            } else if (!TPRNPackAuthorized) {
                TPRNPackClosedDenials++;
                denial = TPRNPackClosed;
            }
        }
        if (!denial && TPRNRequests.count < 12) {
            [TPRNRequests addObject:@{@"fixtureOrigin": @(fixtureOrigin), @"resource": resource,
                @"sdkDefaultStyle": @([self.request.URL isEqual:TPRNOriginalDefaultStyle]),
                @"query": @(parts.percentEncodedQuery != nil), @"fragment": @(parts.fragment != nil),
                @"get": @([self.request.HTTPMethod isEqual:@"GET"])}];
        }
    }
    if (denial) {
        [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:TPRNPackGateError code:denial userInfo:nil]];
        return;
    }
    [super startLoading];
}
@end

static NSDictionary *TPRNPackGateSnapshot(void) {
    @synchronized (TPRNTransport.class) {
        return @{@"authorized": @(TPRNPackAuthorized), @"deniedWhileClosed": @(TPRNPackClosedDenials),
            @"deniedOutsideScope": @(TPRNPackScopeDenials)};
    }
}

static BOOL TPRNHasEmptyPackBudget(void) {
    NSDictionary *native = TPTransport.snapshot;
    NSDictionary *ledger = native[@"ledger"];
    return [native[@"ledgerOK"] isEqual:@YES] && [native[@"active"] isEqual:@0] &&
        [native[@"pending"] isEqual:@0] && [native[@"started"] isEqual:@0] &&
        [ledger[@"origin"] isEqual:TPRNOrigin] && [ledger[@"requests"] isEqual:@0] &&
        [ledger[@"tiles"] isEqual:@0] && [ledger[@"reservedBytes"] isEqual:@0] &&
        [ledger[@"maxRequests"] isEqual:@2] && [ledger[@"maxTiles"] isEqual:@1] &&
        [ledger[@"maxReservedBytes"] isEqual:@512];
}

static void TPRNProbePackDenial(NSURLSession *session, NSString *path, NSInteger expected,
                                void (^completion)(BOOL)) {
    NSURL *url = [NSURL URLWithString:[TPRNOrigin stringByAppendingString:path]];
    NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                        timeoutInterval:3];
    [[session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        completion(!response && !data.length && [error.domain isEqual:TPRNPackGateError] && error.code == expected);
    }] resume];
}

@interface TPRNProbe : NSObject <RCTBridgeModule>
@end

@implementation TPRNProbe
RCT_EXPORT_MODULE(TPRNProbe)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(confirmRendered:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSDictionary *native = TPTransport.snapshot;
    BOOL ready = [native[@"active"] isEqual:@0] && [native[@"pending"] isEqual:@0] &&
        [native[@"started"] isEqual:@2] && [native[@"tlsVerifiedExchanges"] isEqual:@2] &&
        [native[@"ledger"][@"tiles"] isEqual:@1];
    TPRNRenderConfirmed |= ready;
    resolve(@(ready));
}
RCT_EXPORT_METHOD(authorizeFixturePackStart:(NSString *)styleURL resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSURLSessionConfiguration *config = MLNNetworkConfiguration.sharedManager.sessionConfiguration;
    if (![TPRNTrial isEqual:@"pack-recovery"] ||
        ![styleURL isEqual:[TPRNOrigin stringByAppendingString:TPRNPackStylePath]] ||
        config.protocolClasses.firstObject != TPRNTransport.class || !TPRNHasEmptyPackBudget()) {
        resolve(@NO);
        return;
    }
    @synchronized (TPRNTransport.class) {
        if (TPRNPackPreflightStarted) { resolve(@NO); return; }
        TPRNPackPreflightStarted = YES;
    }
    NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
    TPRNProbePackDenial(session, TPRNPackStylePath, TPRNPackClosed, ^(BOOL closed) {
        TPRNProbePackDenial(session, @"/resource/style/empty", TPRNPackOutsideScope, ^(BOOL outside) {
            [session finishTasksAndInvalidate];
            BOOL empty = TPRNHasEmptyPackBudget();
            BOOL authorized;
            @synchronized (TPRNTransport.class) {
                authorized = closed && outside && empty && TPRNPackClosedDenials == 1 && TPRNPackScopeDenials == 1;
                TPRNPackAuthorized = authorized;
            }
            resolve(@(authorized));
        });
    });
}
RCT_EXPORT_METHOD(reportPackRecovery:(NSDictionary *)report resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    if (!TPRNIsPackTrial() || TPRNRecoveryReported) { resolve(@NO); return; }
    NSData *data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingSortedKeys error:nil];
    NSURL *file = [TPRNDirectory URLByAppendingPathComponent:@"pack-recovery.json"];
    TPRNRecoveryReported = data.length > 0 && [data writeToURL:file options:NSDataWritingAtomic error:nil];
    TPRNRecoveryPassed = TPRNRecoveryReported && [report[@"pass"] isEqual:@YES];
    resolve(@(TPRNRecoveryReported));
}
@end

static void TPRNWrite(BOOL complete, BOOL pass, NSDictionary *native) {
    NSArray *requests;
    @synchronized (TPRNTransport.class) { requests = [TPRNRequests copy]; }
    NSMutableDictionary *result = [@{@"complete": @(complete), @"pass": @(pass), @"runID": TPRNRunID,
        @"process": @(NSProcessInfo.processInfo.processIdentifier), @"native": native,
        @"observedRequests": requests,
        @"rnSchema": @2, @"initialStyleMode": TPRNInitialStyleMode,
        @"localBootstrap": @(TPRNLocalBootstrap), @"renderConfirmedAfterTile": @(TPRNRenderConfirmed),
        @"delegatePreserved": @((BOOL)(MLNNetworkConfiguration.sharedManager.delegate == TPRNDelegate))} mutableCopy];
    if (TPRNIsPackTrial()) result[@"packGate"] = TPRNPackGateSnapshot();
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRNDirectory URLByAppendingPathComponent:@"result.json"] options:NSDataWritingAtomic error:nil];
}

@implementation TPRNBootstrap
+ (BOOL)prepare {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    NSString *origin = env[@"QA_SERVER_ORIGIN"], *run = env[@"QA_RUN_ID"];
    NSData *leaf = [TPTransport fixtureCertificateFromBase64:env[@"QA_TLS_LEAF_DER_BASE64"]];
    NSString *mode = env[@"QA_INITIAL_STYLE"] ?: @"local-empty";
    NSString *trial = env[@"QA_RN_CASE"] ?: @"render";
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"\\A[A-Za-z0-9_-]{1,64}\\z" options:0 error:nil];
    if (!origin.length || ![TPTransport safePrivateFixtureTLSOrigin:origin] || !leaf || !run.length || run.length > 64 ||
        [pattern numberOfMatchesInString:run options:0 range:NSMakeRange(0, run.length)] != 1 ||
        ![@[@"local-empty", @"local-missing", @"sdk-default"] containsObject:mode] ||
        ![@[@"render", @"pack-recovery", @"pack-reopen"] containsObject:trial] ||
        (![trial isEqual:@"render"] && ![mode isEqual:@"local-empty"])) return NO;

    NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *directory = [documents URLByAppendingPathComponent:run];
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate || [[NSFileManager defaultManager] fileExistsAtPath:directory.path]) return NO;
    BOOL packTrial = ![trial isEqual:@"render"];
    if (![TPTransport configurePrivateFixtureTLSOrigin:origin ledgerURL:[directory URLByAppendingPathComponent:@"ledger.json"]
                                            maxRequests:packTrial ? 2 : 8 maxTiles:packTrial ? 1 : 4
                                        maxReservedBytes:packTrial ? 512 : 2048 certificate:leaf]) return NO;

    TPRNOriginalDefaultStyle = MLNStyle.defaultStyleURL;
    // SDK 6.31 exposes the default as an alias and normalizes it before HTTP dispatch.
    MLNTileServerOptions *originalOptions = MLNSettings.tileServerOptions;
    if ([TPRNOriginalDefaultStyle.absoluteString isEqual:@"maplibre://maps/style"] &&
        [originalOptions.baseURL isEqual:@"https://demotiles.maplibre.org"] &&
        [originalOptions.uriSchemeAlias isEqual:@"maplibre"] &&
        [originalOptions.styleDomainName isEqual:@"maps"] &&
        [originalOptions.styleTemplate isEqual:@"{path}.json"]) {
        TPRNOriginalDefaultStyle = [NSURL URLWithString:@"https://demotiles.maplibre.org/style.json"];
    }
    TPRNInitialStyleMode = mode;
    TPRNRenderConfirmed = NO;
    TPRNTrial = trial;
    TPRNRecoveryReported = NO;
    TPRNRecoveryPassed = NO;
    TPRNLocalBootstrap = ![mode isEqual:@"sdk-default"];
    if (TPRNLocalBootstrap) {
        BOOL missing = [mode isEqual:@"local-missing"];
        NSURL *styleDirectory = missing ? directory : NSBundle.mainBundle.bundleURL;
        NSURL *file = [styleDirectory URLByAppendingPathComponent:@"TripPaintingBootstrapStyle.json"];
        if ([[NSFileManager defaultManager] fileExistsAtPath:file.path] == missing) return NO;
        if (![TripPaintingMapBootstrap configureInDirectory:styleDirectory]) return NO;
        if (![MLNStyle.defaultStyleURL isEqual:file]) return NO;
    } else if (![@[@"http", @"https"] containsObject:TPRNOriginalDefaultStyle.scheme]) {
        return NO;
    }

    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    TPRNOrigin = origin;
    TPRNRequests = [NSMutableArray array];
    config.protocolClasses = @[TPRNTransport.class];
    config.URLCache = nil;
    config.HTTPCookieStorage = nil;
    config.URLCredentialStorage = nil;
    config.HTTPShouldSetCookies = NO;
    network.sessionConfiguration = config;
    TPRNDelegate = MLRNTransformRequest.sharedInstance;
    if (!TPRNDelegate || network.delegate != TPRNDelegate) return NO;
    TPRNRunID = run;
    TPRNDirectory = directory;
    TPRNWrite(NO, NO, TPTransport.snapshot);
    return YES;
}
+ (NSDictionary *)initialProperties { return @{ @"origin": TPRNOrigin, @"trial": TPRNTrial }; }
+ (void)observe {
    NSTimeInterval deadline = NSProcessInfo.processInfo.systemUptime + 30;
    [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        NSDictionary *native = TPTransport.snapshot;
        BOOL delegateOK = MLNNetworkConfiguration.sharedManager.delegate == TPRNDelegate;
        BOOL idle = [native[@"active"] isEqual:@0] && [native[@"pending"] isEqual:@0];
        NSNumber *expectedBlocks = TPRNLocalBootstrap ? @0 : @1;
        BOOL reopening = [TPRNTrial isEqual:@"pack-reopen"];
        NSDictionary *packGate = TPRNPackGateSnapshot();
        BOOL packGateOK = !TPRNIsPackTrial() || ([packGate[@"authorized"] isEqual:@(!reopening)] &&
            [packGate[@"deniedWhileClosed"] isEqual:@(reopening ? 0 : 1)] &&
            [packGate[@"deniedOutsideScope"] isEqual:@(reopening ? 0 : 1)]);
        NSNumber *expectedStarts = reopening ? @0 : (TPRNIsPackTrial() ? @2 : @3);
        NSNumber *expectedTiles = reopening ? @0 : @1;
        BOOL confirmed = TPRNIsPackTrial() ? TPRNRecoveryPassed : TPRNRenderConfirmed;
        BOOL pass = delegateOK && idle && confirmed && packGateOK && [native[@"ledgerOK"] isEqual:@YES] &&
            [native[@"blockedBeforeDispatch"] isEqual:expectedBlocks] && [native[@"started"] isEqual:expectedStarts] &&
            [native[@"tlsVerifiedExchanges"] isEqual:expectedStarts] && [native[@"ledger"][@"tiles"] isEqual:expectedTiles];
        BOOL blocked = [native[@"blockedBeforeDispatch"] unsignedIntegerValue] > 0;
        if (pass || !delegateOK || (TPRNIsPackTrial() && (blocked || (TPRNRecoveryReported && !TPRNRecoveryPassed))) ||
            (blocked && idle && [native[@"started"] unsignedIntegerValue] >= expectedStarts.unsignedIntegerValue) ||
            [native[@"started"] unsignedIntegerValue] > expectedStarts.unsignedIntegerValue || NSProcessInfo.processInfo.systemUptime >= deadline) {
            [timer invalidate];
            TPRNWrite(YES, pass, native);
        }
    }];
}
@end
