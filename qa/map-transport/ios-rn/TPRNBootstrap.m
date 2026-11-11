#import "TPRNBootstrap.h"
#import "TPTransport.h"
#import "MLRNTransformRequest.h"
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
static BOOL TPRNLocalBootstrap, TPRNRenderConfirmed;

@interface TPRNTransport : TPTransport
@end

@implementation TPRNTransport
- (void)startLoading {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.request.URL resolvingAgainstBaseURL:NO];
    NSString *origin = [NSString stringWithFormat:@"%@://%@:%@", parts.scheme, parts.host, parts.port];
    NSString *path = parts.percentEncodedPath;
    NSArray *fixturePaths = @[@"/resource/style/rn-entry", @"/resource/style/sdk",
        @"/resource/tile/0_0_0", @"/resource/style/empty"];
    BOOL fixtureOrigin = [origin isEqual:TPRNOrigin];
    NSString *resource = fixtureOrigin && [fixturePaths containsObject:path ?: @""] ? path : @"other";
    @synchronized (TPRNTransport.class) {
        if (TPRNRequests.count < 12) {
            [TPRNRequests addObject:@{@"fixtureOrigin": @(fixtureOrigin), @"resource": resource,
                @"sdkDefaultStyle": @([self.request.URL isEqual:TPRNOriginalDefaultStyle]),
                @"query": @(parts.percentEncodedQuery != nil), @"fragment": @(parts.fragment != nil),
                @"get": @([self.request.HTTPMethod isEqual:@"GET"])}];
        }
    }
    [super startLoading];
}
@end

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
@end

static void TPRNWrite(BOOL complete, BOOL pass, NSDictionary *native) {
    NSArray *requests;
    @synchronized (TPRNTransport.class) { requests = [TPRNRequests copy]; }
    NSDictionary *result = @{@"complete": @(complete), @"pass": @(pass), @"runID": TPRNRunID,
        @"process": @(NSProcessInfo.processInfo.processIdentifier), @"native": native,
        @"observedRequests": requests,
        @"rnSchema": @2, @"initialStyleMode": TPRNInitialStyleMode,
        @"localBootstrap": @(TPRNLocalBootstrap), @"renderConfirmedAfterTile": @(TPRNRenderConfirmed),
        @"delegatePreserved": @((BOOL)(MLNNetworkConfiguration.sharedManager.delegate == TPRNDelegate))};
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRNDirectory URLByAppendingPathComponent:@"result.json"] options:NSDataWritingAtomic error:nil];
}

@implementation TPRNBootstrap
+ (BOOL)prepare {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    NSString *origin = env[@"QA_SERVER_ORIGIN"], *run = env[@"QA_RUN_ID"];
    NSData *leaf = [TPTransport fixtureCertificateFromBase64:env[@"QA_TLS_LEAF_DER_BASE64"]];
    NSString *mode = env[@"QA_INITIAL_STYLE"] ?: @"local-empty";
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"\\A[A-Za-z0-9_-]{1,64}\\z" options:0 error:nil];
    if (!origin.length || ![TPTransport safePrivateFixtureTLSOrigin:origin] || !leaf || !run.length || run.length > 64 ||
        [pattern numberOfMatchesInString:run options:0 range:NSMakeRange(0, run.length)] != 1 ||
        ![@[@"local-empty", @"sdk-default"] containsObject:mode]) return NO;

    NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *directory = [documents URLByAppendingPathComponent:run];
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate || [[NSFileManager defaultManager] fileExistsAtPath:directory.path]) return NO;
    if (![TPTransport configurePrivateFixtureTLSOrigin:origin ledgerURL:[directory URLByAppendingPathComponent:@"ledger.json"]
                                            maxRequests:8 maxTiles:4 maxReservedBytes:2048 certificate:leaf]) return NO;

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
    TPRNLocalBootstrap = [mode isEqual:@"local-empty"];
    if (TPRNLocalBootstrap) {
        NSURL *file = [directory URLByAppendingPathComponent:@"bootstrap-style.json"];
        NSData *empty = [NSJSONSerialization dataWithJSONObject:@{@"version": @8, @"sources": @{}, @"layers": @[]}
                                                       options:0 error:nil];
        if (![empty writeToURL:file options:NSDataWritingAtomic error:nil]) return NO;
        MLNTileServerOptions *options = MLNSettings.tileServerOptions;
        if (!options) return NO;
        MLNDefaultStyle *style = [MLNDefaultStyle new];
        style.url = file;
        style.name = @"TPRN local bootstrap";
        style.version = 1;
        options.defaultStyles = @[style];
        options.defaultStyle = style;
        MLNSettings.tileServerOptions = options;
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
+ (NSDictionary *)initialProperties { return @{ @"origin": TPRNOrigin }; }
+ (void)observe {
    NSTimeInterval deadline = NSProcessInfo.processInfo.systemUptime + 30;
    [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        NSDictionary *native = TPTransport.snapshot;
        BOOL delegateOK = MLNNetworkConfiguration.sharedManager.delegate == TPRNDelegate;
        BOOL idle = [native[@"active"] isEqual:@0] && [native[@"pending"] isEqual:@0];
        NSNumber *expectedBlocks = TPRNLocalBootstrap ? @0 : @1;
        BOOL pass = delegateOK && idle && TPRNRenderConfirmed && [native[@"ledgerOK"] isEqual:@YES] &&
            [native[@"blockedBeforeDispatch"] isEqual:expectedBlocks] && [native[@"started"] isEqual:@3] &&
            [native[@"tlsVerifiedExchanges"] isEqual:@3] && [native[@"ledger"][@"tiles"] isEqual:@1];
        BOOL blocked = [native[@"blockedBeforeDispatch"] unsignedIntegerValue] > 0;
        if (pass || !delegateOK || (blocked && idle && [native[@"started"] unsignedIntegerValue] >= 3) ||
            [native[@"started"] unsignedIntegerValue] > 3 || NSProcessInfo.processInfo.systemUptime >= deadline) {
            [timer invalidate];
            TPRNWrite(YES, pass, native);
        }
    }];
}
@end
