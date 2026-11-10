#import "TPRNBootstrap.h"
#import "TPTransport.h"
#import "MLRNTransformRequest.h"
#import <MapLibre/MLNNetworkConfiguration.h>

static NSString *TPRNOrigin, *TPRNRunID;
static NSURL *TPRNDirectory;
static MLRNTransformRequest *TPRNDelegate;

static void TPRNWrite(BOOL complete, BOOL pass, NSDictionary *native) {
    NSDictionary *result = @{@"complete": @(complete), @"pass": @(pass), @"runID": TPRNRunID,
        @"process": @(NSProcessInfo.processInfo.processIdentifier), @"native": native,
        @"delegatePreserved": @((BOOL)(MLNNetworkConfiguration.sharedManager.delegate == TPRNDelegate))};
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRNDirectory URLByAppendingPathComponent:@"result.json"] options:NSDataWritingAtomic error:nil];
}

@implementation TPRNBootstrap
+ (BOOL)prepare {
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    NSString *origin = env[@"QA_SERVER_ORIGIN"], *run = env[@"QA_RUN_ID"];
    NSData *leaf = [TPTransport fixtureCertificateFromBase64:env[@"QA_TLS_LEAF_DER_BASE64"]];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"\\A[A-Za-z0-9_-]{1,64}\\z" options:0 error:nil];
    if (!origin.length || ![TPTransport safePrivateFixtureTLSOrigin:origin] || !leaf || !run.length || run.length > 64 ||
        [pattern numberOfMatchesInString:run options:0 range:NSMakeRange(0, run.length)] != 1) return NO;

    NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    NSURL *directory = [documents URLByAppendingPathComponent:run];
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate || [[NSFileManager defaultManager] fileExistsAtPath:directory.path]) return NO;
    if (![TPTransport configurePrivateFixtureTLSOrigin:origin ledgerURL:[directory URLByAppendingPathComponent:@"ledger.json"]
                                            maxRequests:8 maxTiles:4 maxReservedBytes:2048 certificate:leaf]) return NO;

    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.protocolClasses = @[TPTransport.class];
    config.URLCache = nil;
    config.HTTPCookieStorage = nil;
    config.URLCredentialStorage = nil;
    config.HTTPShouldSetCookies = NO;
    network.sessionConfiguration = config;
    TPRNDelegate = MLRNTransformRequest.sharedInstance;
    if (!TPRNDelegate || network.delegate != TPRNDelegate) return NO;
    TPRNOrigin = origin;
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
        BOOL pass = delegateOK && idle && [native[@"ledgerOK"] isEqual:@YES] &&
            [native[@"blockedBeforeDispatch"] isEqual:@0] && [native[@"started"] isEqual:@3] &&
            [native[@"tlsVerifiedExchanges"] isEqual:@3] && [native[@"ledger"][@"tiles"] isEqual:@1];
        if (pass || !delegateOK || [native[@"blockedBeforeDispatch"] unsignedIntegerValue] ||
            [native[@"started"] unsignedIntegerValue] > 3 || NSProcessInfo.processInfo.systemUptime >= deadline) {
            [timer invalidate];
            TPRNWrite(YES, pass, native);
        }
    }];
}
@end
