#import <UIKit/UIKit.h>
#import <MapLibre/MapLibre.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import "TPTransport.h"
#import "MLRNTransformRequest.h"
#import "TPFixtureActionGate.h"
#import "MapLibreQA-Swift.h"

static NSURL *TPRunDirectory;
static NSString *TPOrigin;
static BOOL TPStarted, TPRunning, TPPriorIdle;
static NSString *const TPEmptyStyleJSON = @"{\"version\":8,\"sources\":{},\"layers\":[]}";

static BOOL TPTLSStage(NSString *stage) {
    return [@[@"tls-render", @"tls-queue", @"tls-cancel-retry", @"tls-mixed", @"tls-policy", @"tls-pack", @"tls-pack-reopen"] containsObject:stage];
}

static BOOL TPCancellationStage(NSString *stage) {
    return [@[@"cancel-retry", @"tls-cancel-retry", @"offline-map-cancel-retry"] containsObject:stage];
}

static void TPWriteDocument(NSString *name, NSDictionary *value) {
    if (!TPRunDirectory) return;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRunDirectory URLByAppendingPathComponent:name] options:NSDataWritingAtomic error:nil];
}
static void TPWrite(NSDictionary *value) { TPWriteDocument(@"result.json", value); }
static NSDictionary *TPControl(NSString *path) {
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.timeoutIntervalForRequest = 2; config.timeoutIntervalForResource = 3;
    config.URLCache = nil; config.HTTPCookieStorage = nil; config.URLCredentialStorage = nil;
    config.HTTPShouldSetCookies = NO;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:config];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSDictionary *result = @{};
    NSURLSessionDataTask *task = [session dataTaskWithURL:[NSURL URLWithString:[TPOrigin stringByAppendingString:path]] completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        id json = data && !error ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if ([json isKindOfClass:NSDictionary.class]) result = json;
        dispatch_semaphore_signal(done);
    }];
    [task resume];
    long timedOut = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC));
    [task cancel]; [session invalidateAndCancel];
    // On timeout never read a value the late completion may still be writing.
    return timedOut ? @{@"controlError": @"deadline"} : result;
}

static NSDictionary *TPProbe(NSURLSession *session, NSURL *url) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSDictionary *result;
    NSURLSessionDataTask *task = [session dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? [(NSHTTPURLResponse *)response statusCode] : 0;
        result = @{@"status": @(status), @"errorDomain": error.domain ?: @"", @"errorCode": @(error.code), @"bodyBytes": @(data.length)};
        dispatch_semaphore_signal(done);
    }];
    [task resume];
    if (!dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC))) return result;
    [task cancel];
    return @{@"deadline": @YES};
}

@interface TPSDKController : UIViewController <MLNMapViewDelegate>
@property UILabel *label;
@property MLNMapView *map;
@property MLNOfflinePack *offlinePack;
@property NSUInteger offlineErrors;
@property NSString *priorPackRunID;
@property BOOL expectPackRevalidation;
@property BOOL blockPackNetwork;
@property BOOL resumePackNetwork;
@property BOOL testPackRetryLimit;
@property NSTimeInterval packRetryLimitObservedAt;
@property NSMutableArray<NSString *> *offlineRequestAttempts;
@property NSMutableArray *cases;
@property NSUInteger transforms, rewrittenStyles, externalTileRequests, phase;
@property BOOL styleLoaded, fullyRendered, finishing;
@property NSTimer *timer;
@property MLRNTransformRequest *transform;
@property NSDictionary *waitingSnapshot;
@property NSString *stage;
@property BOOL controlBusy;
@property NSDictionary *waitingServer, *cancelledSnapshot, *cancelledServer, *releaseControl;
@property NSDictionary *emptyStyleEvidence;
@property NSDictionary *mixedStyleEvidence;
@property NSString *policyTarget;
@property NSUInteger policyOriginAttempts, policyPathAttempts, policyRedirectAttempts;
@property NSTimeInterval policyObservationStarted;
@property NSData *fixtureCertificate;
@property NSString *runID;
@property TPFixtureActionGate *actionGate;
@property NSMutableArray *actionAttempts;
@end

@implementation TPSDKController
- (void)viewDidLoad {
    [super viewDidLoad]; self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.label = [[UILabel alloc] initWithFrame:CGRectZero]; self.label.numberOfLines = 0;
    self.label.textAlignment = NSTextAlignmentCenter;
    self.label.text = @"지도 엔진 시험 준비 중\n로컬 네트워크 안내가 뜨면 허용해 주세요.\n기존 여행색칠의 기록은 사용하지 않습니다.";
    [self.view addSubview:self.label];
}
- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    CGFloat top = self.view.safeAreaInsets.top;
    self.label.frame = CGRectMake(12, top + 8, self.view.bounds.size.width - 24, 100);
    // A larger QA viewport requests more than four distinct z2 tiles without
    // changing the source, making the SDK wait queue observable on any phone.
    CGSize size = self.phase == 2 || TPCancellationStage(self.stage) ? CGSizeMake(1024, 1024) : CGSizeMake(self.view.bounds.size.width, MAX(200, self.view.bounds.size.height - top - 116));
    self.map.frame = CGRectMake(0, top + 116, size.width, size.height);
}
- (void)finish:(BOOL)pass reason:(NSString *)reason {
    if (self.finishing) return;
    self.finishing = YES; [self.timer invalidate];
    TPRunning = NO; UIApplication.sharedApplication.idleTimerDisabled = TPPriorIdle;
    NSUInteger transforms, rewrites;
    @synchronized(self) { transforms = self.transforms; rewrites = self.rewrittenStyles; }
    NSString *scope = @"isolated MapLibre6.31.0 with actual RN11.5 native transform class; no JS/TurboModule bridge, TLS/HTTP2/provider/OS-byte acceptance";
    if ([self.stage isEqual:@"action-gate"]) scope = @"fixture URL delivery only; no SDK, transport, cancellation or reload acceptance";
    else if ([self.stage isEqual:@"offline-session-toggle"]) scope = @"isolated product guard with a live MapLibre-configured URLSession and an independent URLSession";
    else if ([self.stage isEqual:@"offline-map-cancel-retry"]) scope = @"isolated product guard and SDK local style cancellation, blocked reload and explicit retry";
    else if ([self.stage isEqual:@"tls-cancel-retry"]) scope = @"isolated pinned HTTPS HTTP1 SDK style cancellation and manual reload";
    else if ([self.stage isEqual:@"tls-mixed"]) scope = @"isolated pinned HTTPS HTTP1 SDK style, tile, glyph and sprite requests";
    else if ([self.stage isEqual:@"tls-policy"]) scope = @"isolated pinned HTTPS SDK origin, path and redirect refusal";
    else if ([self.stage isEqual:@"tls-pack"]) scope = @"isolated MapLibre offline pack and private fixture HTTPS requests";
    else if ([self.stage isEqual:@"tls-pack-reopen"]) scope = @"isolated MapLibre pack reopen and render with the fixture stopped";
    else if (TPTLSStage(self.stage)) scope = @"isolated pinned private-fixture HTTPS HTTP1 SDK; no cancel/restart, HTTP2, RN JS bridge, provider or OS-byte acceptance";
    TPWrite(@{@"complete": @YES, @"pass": @(pass), @"reason": reason,
              @"cases": self.cases ?: @[], @"stage": self.stage ?: @"invalid", @"process": @(NSProcessInfo.processInfo.processIdentifier),
              @"runID": self.runID ?: @"invalid", @"fixtureActionAttempts": self.actionAttempts ?: @[],
              @"fixtureActionSequence": @(self.actionGate.lastAcceptedSequence), @"mapCreated": @((BOOL)(self.map != nil)),
              @"nativeAtFinish": TPTransport.snapshot,
              @"cancellationTrigger": TPCancellationStage(self.stage) ? @"local-style-json" : @"none",
              @"trialPhase": @(self.phase), @"emptyStyleEvidence": self.emptyStyleEvidence ?: @{},
              @"transforms": @(transforms), @"rewrittenStyles": @(rewrites), @"externalTileRequests": @(self.externalTileRequests),
              @"policyAttempts": [self policyAttempts],
              @"delegatePreserved": @(self.transform && MLNNetworkConfiguration.sharedManager.delegate == self.transform),
              @"delegateClass": self.transform ? NSStringFromClass(self.transform.class) : @"none",
              @"scope": scope});
    self.label.text = pass ? @"지도 엔진 시험을 마쳤습니다.\n결과를 Mac에서 확인하고 있습니다." : @"지도 시험 결과를 확인하고 있습니다.\nMac 안내를 확인해 주세요.";
    self.map.delegate = nil;
    self.transform.logCallback = nil;
}
- (void)start {
    if (TPStarted) return;
    TPStarted = YES; TPRunning = YES;
    TPPriorIdle = UIApplication.sharedApplication.idleTimerDisabled;
    UIApplication.sharedApplication.idleTimerDisabled = YES;
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    TPOrigin = env[@"QA_SERVER_ORIGIN"];
    self.stage = env[@"QA_STAGE"] ?: @"queue";
    BOOL tlsTrial = TPTLSStage(self.stage);
    self.policyTarget = env[@"QA_POLICY_TARGET"];
    BOOL policyTrial = [self.stage isEqual:@"tls-policy"];
    BOOL policyOK = !self.policyTarget;
    if (policyTrial && self.policyTarget.length && [TPTransport safePrivateFixtureTLSOrigin:self.policyTarget] && ![self.policyTarget isEqual:TPOrigin]) {
        policyOK = [[NSURL URLWithString:self.policyTarget].host isEqual:[NSURL URLWithString:TPOrigin].host];
    } else if (policyTrial) policyOK = NO;
    BOOL actionTrial = [self.stage isEqual:@"action-gate"];
    BOOL toggleTrial = [self.stage isEqual:@"offline-session-toggle"];
    BOOL usesActionGate = actionTrial || [self.stage isEqual:@"tls-cancel-retry"];
    self.fixtureCertificate = [TPTransport fixtureCertificateFromBase64:env[@"QA_TLS_LEAF_DER_BASE64"]];
    NSString *runID = env[@"QA_RUN_ID"];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,64}$" options:0 error:nil];
    BOOL valid = runID && [pattern numberOfMatchesInString:runID options:0 range:NSMakeRange(0, runID.length)] == 1;
    BOOL reopening = [self.stage isEqual:@"tls-pack-reopen"];
    self.priorPackRunID = env[@"QA_PACK_RUN_ID"];
    NSString *revalidation = env[@"QA_PACK_EXPECT_REVALIDATION"];
    NSString *blockNetwork = env[@"QA_PACK_BLOCK_NETWORK"];
    NSString *resumeNetwork = env[@"QA_PACK_RESUME_NETWORK"];
    NSString *testRetryLimit = env[@"QA_PACK_TEST_RETRY_LIMIT"];
    self.expectPackRevalidation = reopening && [revalidation isEqual:@"1"];
    self.blockPackNetwork = reopening && [blockNetwork isEqual:@"1"];
    self.resumePackNetwork = self.blockPackNetwork && [resumeNetwork isEqual:@"1"];
    self.testPackRetryLimit = self.resumePackNetwork && [testRetryLimit isEqual:@"1"];
    BOOL packInputsOK = reopening ? self.priorPackRunID.length && ![self.priorPackRunID isEqual:runID] &&
        [[NSURL URLWithString:TPOrigin ?: @""].host isEqual:@"127.0.0.1"] &&
        [pattern numberOfMatchesInString:self.priorPackRunID options:0 range:NSMakeRange(0, self.priorPackRunID.length)] == 1 &&
        (!revalidation || self.expectPackRevalidation) && (!blockNetwork || self.blockPackNetwork) &&
        (!resumeNetwork || self.resumePackNetwork) && (!testRetryLimit || self.testPackRetryLimit) &&
        !(self.blockPackNetwork && self.expectPackRevalidation) :
        !self.priorPackRunID && !revalidation && !blockNetwork && !resumeNetwork && !testRetryLimit;
    self.runID = valid ? runID : nil;
    if (usesActionGate && valid) self.actionGate = [[TPFixtureActionGate alloc] initWithRunID:runID processIdentifier:NSProcessInfo.processInfo.processIdentifier cancelNonce:env[@"QA_FIXTURE_CANCEL_NONCE"] reloadNonce:env[@"QA_FIXTURE_RELOAD_NONCE"]];
    NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    TPRunDirectory = [documents URLByAppendingPathComponent:valid ? runID : @"invalid-input"];
    BOOL fresh = ![[NSFileManager defaultManager] fileExistsAtPath:TPRunDirectory.path];
    BOOL originOK = actionTrial ? !env[@"QA_SERVER_ORIGIN"] && !env[@"QA_TLS_LEAF_DER_BASE64"] : (tlsTrial ? [TPTransport safePrivateFixtureTLSOrigin:TPOrigin] && self.fixtureCertificate : [TPTransport safeOrigin:TPOrigin] && !env[@"QA_TLS_LEAF_DER_BASE64"]);
    BOOL offlineCancellation = [self.stage isEqual:@"offline-map-cancel-retry"];
    if (toggleTrial || offlineCancellation) originOK = originOK && [[NSURL URLWithString:TPOrigin].host isEqual:@"127.0.0.1"];
    BOOL signalsOK = usesActionGate ? self.actionGate != nil : !env[@"QA_FIXTURE_CANCEL_NONCE"] && !env[@"QA_FIXTURE_RELOAD_NONCE"];
    BOOL supportedStage = tlsTrial || actionTrial || toggleTrial || offlineCancellation || [@[@"queue", @"cancel-retry"] containsObject:self.stage];
    if (!valid || !fresh || !supportedStage || !originOK || !signalsOK || !policyOK || !packInputsOK) { TPRunDirectory = nil; [self finish:NO reason:@"unsafe or reused inputs"]; return; }
    if (![[NSFileManager defaultManager] createDirectoryAtURL:TPRunDirectory withIntermediateDirectories:YES attributes:nil error:nil]) { TPRunDirectory = nil; [self finish:NO reason:@"run directory not ready"]; return; }
    self.cases = [NSMutableArray new];
    if (usesActionGate) self.actionAttempts = [NSMutableArray new];
    TPWrite(@{@"complete": @NO, @"phase": actionTrial ? @"waiting-for-fixture-signal" : @"waiting-for-local-fixture"});
    if (actionTrial) {
        self.phase = 10;
        [self publishActionProgress];
        self.label.text = @"검사 신호를 확인하고 있습니다.\nMac의 안내를 기다려 주세요.";
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ if (!self.finishing) [self finish:NO reason:@"fixture signal deadline"]; });
        return;
    }
    if (toggleTrial) { [self verifyOfflineSessionToggle]; return; }
    // The host prepares and verifies the TLS fixture before launch. No unpinned
    // readiness/control NSURLSession is used by the TLS stages.
    if (tlsTrial) { [self createMap]; return; }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSTimeInterval end = NSProcessInfo.processInfo.systemUptime + 45;
        BOOL ready = NO;
        while (NSProcessInfo.processInfo.systemUptime < end) {
            NSDictionary *stats = TPControl(@"/stats");
            if ([stats[@"resourceCount"] isEqual:@0] && [stats[@"heldReleased"] isEqual:@NO]) { ready = YES; break; }
            [NSThread sleepForTimeInterval:0.15];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!ready) { [self finish:NO reason:@"local fixture not ready"]; return; }
            [self createMap];
        });
    });
}
- (void)verifyOfflineSessionToggle {
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate) { [self finish:NO reason:@"unexpected preexisting SDK delegate"]; return; }
    self.transform = MLRNTransformRequest.sharedInstance;
    if (network.delegate != self.transform || ![TripPaintingMapBootstrap configureInDirectory:NSBundle.mainBundle.bundleURL]) {
        [self finish:NO reason:@"map startup or transform unavailable"]; return;
    }
    NSURLSession *mapSession = [NSURLSession sessionWithConfiguration:network.sessionConfiguration];
    NSURLSession *independentSession = [NSURLSession sessionWithConfiguration:NSURLSessionConfiguration.ephemeralSessionConfiguration];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSURL *(^fixtureURL)(NSString *) = ^NSURL *(NSString *path) {
            return [NSURL URLWithString:[TPOrigin stringByAppendingString:path]];
        };
        NSDictionary *online = TPProbe(mapSession, fixtureURL(@"/resource/style/sdk"));
        [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:YES];
        NSDictionary *blockedHTTP = TPProbe(mapSession, fixtureURL(@"/resource/style/held"));
        NSURLComponents *https = [NSURLComponents componentsWithURL:fixtureURL(@"/resource/style/held") resolvingAgainstBaseURL:NO];
        https.scheme = @"https";
        NSDictionary *blockedHTTPS = TPProbe(mapSession, https.URL);
        NSDictionary *independent = TPProbe(independentSession, fixtureURL(@"/resource/style/empty"));
        [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:NO];
        NSDictionary *resumed = TPProbe(mapSession, fixtureURL(@"/resource/style/held"));
        [mapSession invalidateAndCancel]; [independentSession invalidateAndCancel];
        BOOL pass = YES;
        for (NSDictionary *response in @[online, independent, resumed]) {
            pass &= [response[@"status"] isEqual:@200] && [response[@"errorCode"] isEqual:@0] && [response[@"bodyBytes"] integerValue] > 0;
        }
        for (NSDictionary *response in @[blockedHTTP, blockedHTTPS]) {
            pass &= [response[@"status"] isEqual:@0] && [response[@"errorDomain"] isEqual:NSURLErrorDomain] &&
                [response[@"errorCode"] isEqual:@(NSURLErrorNotConnectedToInternet)] && [response[@"bodyBytes"] isEqual:@0];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.cases addObject:@{@"online": online, @"blockedHTTP": blockedHTTP, @"blockedHTTPS": blockedHTTPS,
                @"independentWhileBlocked": independent, @"resumedSameSession": resumed}];
            [self finish:pass && network.delegate == self.transform reason:@"product guard session toggle completed"];
        });
    });
}
- (void)publishActionProgress {
    NSMutableDictionary *value = [@{@"kind": @"fixture-action-progress", @"stage": self.stage, @"runID": self.runID,
                                    @"process": @(NSProcessInfo.processInfo.processIdentifier), @"phase": @(self.phase),
                                    @"sequence": @(self.actionGate.lastAcceptedSequence), @"attempts": [self.actionAttempts copy]} mutableCopy];
    if ([self.stage isEqual:@"tls-cancel-retry"]) value[@"native"] = TPTransport.snapshot;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRunDirectory URLByAppendingPathComponent:@"action-progress.json"] options:NSDataWritingAtomic error:nil];
}
- (void)receiveFixtureURL:(NSURL *)url {
    if (!TPRunning || self.finishing || !self.actionGate) return;
    BOOL tlsCancel = [self.stage isEqual:@"tls-cancel-retry"];
    if (tlsCancel && self.phase != 10 && self.phase != 12) return;
    if (self.actionAttempts.count >= 8) { [self finish:NO reason:@"too many fixture signals"]; return; }
    if (tlsCancel) {
        NSDictionary *expected = self.phase == 10 ? self.waitingSnapshot : self.cancelledSnapshot;
        if (![TPTransport.snapshot isEqual:expected] || !self.styleLoaded) {
            [self finish:NO reason:@"HTTPS action state changed before signal"];
            return;
        }
    }
    NSUInteger phaseBefore = self.phase, sequenceBefore = self.actionGate.lastAcceptedSequence;
    BOOL accepted = [self.actionGate acceptURL:url phase:self.phase];
    if (accepted) self.phase = self.phase == 10 ? (tlsCancel ? 11 : 12) : 13;
    [self.actionAttempts addObject:@{@"accepted": @(accepted), @"phaseBefore": @(phaseBefore), @"phaseAfter": @(self.phase),
                                    @"sequenceBefore": @(sequenceBefore), @"sequenceAfter": @(self.actionGate.lastAcceptedSequence)}];
    [self publishActionProgress];
    if (tlsCancel && accepted) {
        self.styleLoaded = NO; self.fullyRendered = NO;
        // Use only SDK style changes to trigger cancellation and reload.
        if (self.phase == 11) self.map.styleJSON = TPEmptyStyleJSON;
        else self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/held"]];
        return;
    }
    if (accepted && self.phase == 13) {
        [self.cases addObject:@{@"name": @"run-bound fixture URL delivery", @"pass": @YES, @"attempts": [self.actionAttempts copy]}];
        [self finish:self.map == nil && self.actionGate.lastAcceptedSequence == 2 reason:@"fixture URL delivery completed; no map actions performed"];
    }
}
- (void)createMap {
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate) { [self finish:NO reason:@"unexpected preexisting SDK delegate"]; return; }
    if (self.blockPackNetwork) self.offlineRequestAttempts = [NSMutableArray new];
    // Link the installed package's unmodified native class; no React/JS bridge or stub.
    self.transform = MLRNTransformRequest.sharedInstance;
    if (network.delegate != self.transform) { [self finish:NO reason:@"native transform did not install its delegate"]; return; }
    __weak TPSDKController *weakSelf = self;
    self.transform.logCallback = ^(NSString *level, NSString *tag, NSString *message) {
        TPSDKController *owner = weakSelf;
        if (owner && [message hasPrefix:@"Final URL: "]) [owner observedTransformURL:[message substringFromIndex:11]];
    };
    NSString *match = [@"^" stringByAppendingString:[NSRegularExpression escapedPatternForString:[TPOrigin stringByAppendingString:@"/resource/"]]];
    [self.transform addUrlTransform:@"qa-entry" match:match find:@"/resource/style/entry$" replace:@"/resource/style/sdk"];
    if ([self.stage isEqual:@"tls-queue"]) [self.transform addUrlTransform:@"qa-multi-entry" match:match find:@"/resource/style/multi-entry$" replace:@"/resource/style/multi"];
    [self.transform addHeader:@"qa-auth" match:match name:@"Authorization" value:@"synthetic-sdk-secret-must-not-forward"];
    [self.transform addHeader:@"qa-cookie" match:match name:@"Cookie" value:@"synthetic-sdk-cookie-must-not-forward=1"];
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.protocolClasses = @[TPTransport.class];
    configuration.URLCache = nil;
    configuration.HTTPCookieStorage = nil; configuration.URLCredentialStorage = nil;
    configuration.HTTPShouldSetCookies = NO;
    network.sessionConfiguration = configuration;
    if ([self.stage isEqual:@"tls-pack"] || self.blockPackNetwork || [self.stage isEqual:@"offline-map-cancel-retry"]) {
        NSURL *localDirectory = NSBundle.mainBundle.bundleURL;
        if (![TripPaintingMapBootstrap configureInDirectory:localDirectory]) {
            [self finish:NO reason:@"product startup did not select a local style"]; return;
        }
        NSURLSessionConfiguration *installed = network.sessionConfiguration;
        if (![TripPaintingMapBootstrap configureInDirectory:localDirectory] ||
            installed != network.sessionConfiguration || installed == configuration ||
            installed.protocolClasses.count != 2 || installed.protocolClasses.lastObject != TPTransport.class ||
            ![configuration.protocolClasses isEqual:@[TPTransport.class]] || installed.URLCache ||
            installed.HTTPCookieStorage || installed.URLCredentialStorage || installed.HTTPShouldSetCookies) {
            [self finish:NO reason:@"product guard did not preserve the SDK session configuration"]; return;
        }
        if (self.blockPackNetwork) [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:YES];
    }
    if (network.delegate != self.transform) { [self finish:NO reason:@"session configuration replaced delegate"]; return; }
    BOOL cancelTrial = TPCancellationStage(self.stage);
    BOOL tlsTrial = TPTLSStage(self.stage);
    BOOL tlsCancel = [self.stage isEqual:@"tls-cancel-retry"];
    BOOL tlsQueue = [self.stage isEqual:@"tls-queue"];
    BOOL tlsMixed = [self.stage isEqual:@"tls-mixed"];
    BOOL tlsPolicy = [self.stage isEqual:@"tls-policy"];
    NSURL *ledgerURL = [TPRunDirectory URLByAppendingPathComponent:tlsTrial ? @"tls-ledger.json" : (cancelTrial ? @"cancel-ledger.json" : @"render-ledger.json")];
    BOOL configured;
    if (tlsMixed || tlsPolicy) configured = [TPTransport configureMixedPrivateFixtureTLSOrigin:TPOrigin ledgerURL:ledgerURL certificate:self.fixtureCertificate];
    else if (tlsTrial) {
        BOOL boundedPack = self.expectPackRevalidation || self.testPackRetryLimit;
        configured = [TPTransport configurePrivateFixtureTLSOrigin:TPOrigin ledgerURL:ledgerURL maxRequests:boundedPack ? 2 : 32 maxTiles:boundedPack ? 1 : 16 maxReservedBytes:boundedPack ? 512 : 8192 certificate:self.fixtureCertificate];
    }
    else configured = [TPTransport configureOrigin:TPOrigin ledgerURL:ledgerURL maxRequests:cancelTrial ? 64 : 32 maxTiles:cancelTrial ? 32 : 16 maxReservedBytes:cancelTrial ? 16384 : 8192];
    if (!configured) { [self finish:NO reason:@"ledger not ready"]; return; }
    if ([self.stage isEqual:@"tls-pack"]) { [self startOfflinePack]; return; }
    if ([self.stage isEqual:@"tls-pack-reopen"]) { [self reopenOfflinePack]; return; }
    self.phase = tlsCancel ? 9 : (cancelTrial ? 10 : ((tlsQueue || tlsMixed) ? 2 : 1));
    // Explicit style avoids constructing a default network style before the gate.
    BOOL largeViewport = cancelTrial || tlsQueue || tlsMixed;
    NSString *stylePath = (tlsMixed || tlsPolicy) ? @"/resource/style/mixed" : (cancelTrial ? @"/resource/style/held" : (tlsQueue ? @"/resource/style/multi-entry" : @"/resource/style/entry"));
    self.map = [[MLNMapView alloc] initWithFrame:CGRectMake(0, 120, largeViewport ? 1024 : self.view.bounds.size.width, largeViewport ? 1024 : 300) styleURL:[NSURL URLWithString:[TPOrigin stringByAppendingString:stylePath]]];
    self.map.delegate = self; self.map.prefetchesTiles = NO;
    self.map.shouldRequestAuthorizationToUseLocationServices = NO;
    self.map.showsUserLocation = NO; self.map.scrollEnabled = NO; self.map.zoomEnabled = NO;
    self.map.rotateEnabled = NO; self.map.pitchEnabled = NO;
    [self.map setCenterCoordinate:CLLocationCoordinate2DMake(0, 0) zoomLevel:largeViewport ? 2 : 0 animated:NO];
    [self.view insertSubview:self.map belowSubview:self.label]; [self.view setNeedsLayout];
    self.label.text = @"합성 지도를 확인하고 있습니다.\n기존 여행 기록은 사용하지 않습니다.";
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) { [self inspectProgress]; }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (tlsCancel ? 45 : 30) * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ if (!self.finishing) [self finish:NO reason:@"SDK trial deadline"]; });
}
- (MLNOfflineStorage *)trialOfflineStorage {
    MLNOfflineStorage *storage = MLNOfflineStorage.sharedOfflineStorage;
    NSString *home = [NSHomeDirectory() stringByStandardizingPath];
    NSString *database = storage.databaseURL.URLByResolvingSymlinksInPath.path;
    if (!database.length || ![database hasPrefix:[[home stringByResolvingSymlinksInPath] stringByAppendingString:@"/"]]) {
        [self finish:NO reason:@"offline database is outside the trial app"];
        return nil;
    }
    return storage;
}
- (void)startOfflinePack {
    MLNOfflineStorage *storage = [self trialOfflineStorage];
    if (!storage) return;
    NSURL *style = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/pack"]];
    MLNCoordinateBounds bounds = MLNCoordinateBoundsMake(CLLocationCoordinate2DMake(1, 1), CLLocationCoordinate2DMake(2, 2));
    MLNTilePyramidOfflineRegion *region = [[MLNTilePyramidOfflineRegion alloc] initWithStyleURL:style bounds:bounds fromZoomLevel:0 toZoomLevel:0];
    NSData *context = [self.runID dataUsingEncoding:NSUTF8StringEncoding];
    [storage addPackForRegion:region withContext:context completionHandler:^(MLNOfflinePack *pack, NSError *error) {
        if (self.finishing) return;
        if (error || !pack || ![pack.context isEqual:context] || pack.state != MLNOfflinePackStateInactive || storage.packs.count != 1) {
            [self finish:NO reason:@"offline pack creation did not produce one inactive trial pack"];
            return;
        }
        self.offlinePack = pack;
        [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(offlinePackError:) name:MLNOfflinePackErrorNotification object:pack];
        [pack resume];
        self.timer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) { [self inspectOfflinePack]; }];
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.finishing) [self finish:NO reason:@"offline pack trial deadline"];
    });
}
- (void)reopenOfflinePack {
    MLNOfflineStorage *storage = [self trialOfflineStorage];
    if (!storage) return;
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) {
        [self inspectReopenedPack:storage];
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.finishing) [self finish:NO reason:@"offline pack reopen deadline"];
    });
}
- (void)inspectReopenedPack:(MLNOfflineStorage *)storage {
    NSDictionary *native = TPTransport.snapshot;
    if (self.resumePackNetwork && self.phase == 1) {
        if (![native[@"ledgerOK"] isEqual:@YES] || [native[@"started"] unsignedIntegerValue] > 2) {
            [self finish:NO reason:@"online reload exceeded the trial bounds"];
            return;
        }
        if (self.testPackRetryLimit) { [self inspectPackRetryLimit:native]; return; }
        if (![native[@"blockedBeforeDispatch"] isEqual:@0]) {
            [self finish:NO reason:@"unexpected blocked request during online reload"]; return;
        }
    } else if (self.expectPackRevalidation) {
        if (![native[@"ledgerOK"] isEqual:@YES] || [native[@"started"] unsignedIntegerValue] > 2 ||
            ![native[@"httpRequestSendsSettled"] isEqual:@0] || ![native[@"blockedBeforeDispatch"] isEqual:@0]) {
            [self finish:NO reason:@"expired pack transport differed from the bounded trial"];
            return;
        }
    } else if (![self idleNative:native] || ![native[@"started"] isEqual:@0]) {
        [self finish:NO reason:@"unexpected network request during pack reopen"];
        return;
    }
    if (!self.offlinePack) {
        NSArray<MLNOfflinePack *> *packs = storage.packs;
        if (!packs) return;
        MLNOfflinePack *pack = packs.firstObject;
        NSURL *style = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/pack"]];
        if (packs.count != 1 || ![pack.context isEqual:[self.priorPackRunID dataUsingEncoding:NSUTF8StringEncoding]] ||
            pack.regionId.longLongValue <= 0 || ![pack.region.styleURL isEqual:style]) {
            [self finish:NO reason:@"reopened pack identity differs"];
            return;
        }
        self.offlinePack = pack;
        [pack requestProgress];
        return;
    }
    if (self.offlinePack.state == MLNOfflinePackStateUnknown) return;
    MLNOfflinePackProgress progress = self.offlinePack.progress;
    if (self.offlinePack.state != MLNOfflinePackStateComplete || progress.countOfResourcesCompleted != 2 ||
        progress.countOfResourcesExpected != 2 || progress.countOfTilesCompleted != 1) {
        [self finish:NO reason:@"reopened pack progress differs"];
        return;
    }
    if (!self.map) {
        self.map = [[MLNMapView alloc] initWithFrame:CGRectMake(0, 120, self.view.bounds.size.width, 300)
                                          styleURL:self.offlinePack.region.styleURL];
        self.map.delegate = self;
        self.map.prefetchesTiles = NO;
        self.map.shouldRequestAuthorizationToUseLocationServices = NO;
        self.map.showsUserLocation = NO;
        [self.map setCenterCoordinate:CLLocationCoordinate2DMake(1.5, 1.5) zoomLevel:0 animated:NO];
        [self.view insertSubview:self.map belowSubview:self.label];
        [self.view setNeedsLayout];
        return;
    }
    if (!self.styleLoaded || !self.fullyRendered) return;
    if (self.expectPackRevalidation && (![self idleNative:native] || ![native[@"started"] isEqual:@2])) return;
    NSArray<NSString *> *blocked = nil;
    if (self.blockPackNetwork && self.phase == 0) {
        @synchronized(self) { blocked = [self.offlineRequestAttempts copy]; }
        NSSet<NSString *> *expected = [NSSet setWithArray:@[@"/resource/style/pack", @"/resource/tile/pack_0_0_0"]];
        NSSet<NSString *> *seen = [NSSet setWithArray:blocked];
        if (blocked.count < 2) return;
        if (![seen isSubsetOfSet:expected] || (!self.testPackRetryLimit && (blocked.count != 2 || ![seen isEqual:expected]))) {
            [self finish:NO reason:@"unexpected denied offline requests"];
            return;
        }
        if (![native[@"started"] isEqual:@0] || ![native[@"blockedBeforeDispatch"] isEqual:@0] ||
            ![native[@"ledger"][@"requests"] isEqual:@0] || ![native[@"ledger"][@"reservedBytes"] isEqual:@0]) {
            [self finish:NO reason:@"a blocked request reached the downstream transport"];
            return;
        }
    }
    NSMutableDictionary *result = [@{@"packId": self.offlinePack.regionId, @"packRunID": self.priorPackRunID,
        @"contextMatches": @YES, @"complete": @YES, @"resources": @(progress.countOfResourcesCompleted),
        @"tiles": @(progress.countOfTilesCompleted), @"storedBytes": @(progress.countOfBytesCompleted),
        @"styleLoaded": @YES, @"fullyRendered": @YES} mutableCopy];
    if (blocked) result[@"blockedRequests"] = blocked;
    if (self.resumePackNetwork && self.phase == 0) {
        result[@"transportBeforeEnable"] = native;
        [self.cases addObject:result];
        self.phase = 1; self.styleLoaded = NO; self.fullyRendered = NO;
        self.map.styleJSON = TPEmptyStyleJSON;
        [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:NO];
        self.map.styleURL = self.offlinePack.region.styleURL;
        return;
    }
    if (self.resumePackNetwork) {
        if (![self idleNative:native] || ![native[@"started"] isEqual:@1] ||
            ![native[@"tlsVerifiedExchanges"] isEqual:@1] || ![native[@"ledger"][@"tiles"] isEqual:@0]) return;
        result[@"transportAfterEnable"] = native;
        [self.cases addObject:result];
        [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"same stored map rendered before and after explicit online reload"];
        return;
    }
    [self.cases addObject:result];
    NSString *reason = self.expectPackRevalidation ? @"expired pack rendered after bounded connection attempts" :
        @"reopened pack rendered without transport requests";
    [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:reason];
}
- (void)inspectPackRetryLimit:(NSDictionary *)native {
    NSDictionary *ledger = native[@"ledger"];
    if (![native[@"active"] isEqual:@0] || ![native[@"pending"] isEqual:@0] ||
        ![native[@"started"] isEqual:@2] || ![native[@"released"] isEqual:@2] || [ledger[@"unresolved"] count] != 0 ||
        ![native[@"httpRequestSendsSettled"] isEqual:@2] || ![native[@"tlsVerifiedExchanges"] isEqual:@2] ||
        ![ledger[@"requests"] isEqual:@2] || ![ledger[@"reservedBytes"] isEqual:@512] ||
        [native[@"blockedBeforeDispatch"] unsignedIntegerValue] == 0) return;
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    if (!self.packRetryLimitObservedAt) self.packRetryLimitObservedAt = now;
    NSUInteger observedMs = (NSUInteger)((now - self.packRetryLimitObservedAt) * 1000);
    if (observedMs < 2500) return;
    [self.cases addObject:@{@"transportAfterEnable": native, @"afterBudgetRefusalMs": @(observedMs)}];
    [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"temporary pack revalidation stopped at the fixture budget"];
}
- (void)offlinePackError:(NSNotification *)notification {
    self.offlineErrors++;
}
- (void)inspectOfflinePack {
    NSDictionary *native = TPTransport.snapshot;
    if (self.offlineErrors || ![native[@"ledgerOK"] isEqual:@YES] || ![native[@"blockedBeforeDispatch"] isEqual:@0]) {
        [self finish:NO reason:@"offline pack or transport reported an error"];
        return;
    }
    if (self.offlinePack.state != MLNOfflinePackStateComplete || ![self idleNative:native]) return;
    MLNOfflinePackProgress progress = self.offlinePack.progress;
    [self.cases addObject:@{@"contextMatches": @([self.offlinePack.context isEqual:[self.runID dataUsingEncoding:NSUTF8StringEncoding]]),
        @"complete": @YES, @"packId": self.offlinePack.regionId ?: NSNull.null,
        @"resources": @(progress.countOfResourcesCompleted), @"tiles": @(progress.countOfTilesCompleted),
        @"expectedResources": @(progress.countOfResourcesExpected), @"storedBytes": @(progress.countOfBytesCompleted),
        @"databaseInTrialApp": @YES, @"errors": @(self.offlineErrors)}];
    BOOL counts = self.offlinePack.regionId.longLongValue > 0 && progress.countOfResourcesCompleted == 2 &&
        progress.countOfResourcesExpected == 2 && progress.countOfTilesCompleted == 1 &&
        [native[@"started"] isEqual:@2] && [native[@"tlsVerifiedExchanges"] isEqual:@2] && [native[@"ledger"][@"tiles"] isEqual:@1];
    [self finish:counts && MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"offline pack and transport reached their final counts"];
}
- (void)observedTransformURL:(NSString *)url {
    @synchronized(self) {
        self.transforms++;
        if (self.blockPackNetwork && self.offlineRequestAttempts.count < 3) {
            NSString *originPrefix = [TPOrigin stringByAppendingString:@"/"];
            [self.offlineRequestAttempts addObject:[url hasPrefix:originPrefix] ? ([NSURL URLWithString:url].path ?: @"") : @"unexpected origin"];
        }
        if ([self.stage isEqual:@"tls-policy"]) {
            if ([url isEqual:[self.policyTarget stringByAppendingString:@"/resource/tile/m_2_0_0"]]) self.policyOriginAttempts++;
            else if ([url isEqual:[TPOrigin stringByAppendingString:@"/resource/tile/denied_0_0_0"]]) self.policyPathAttempts++;
            else if ([url isEqual:[TPOrigin stringByAppendingString:@"/resource/tile/m_2_0_0"]]) self.policyRedirectAttempts++;
        }
        if ([url isEqual:[TPOrigin stringByAppendingString:[self.stage isEqual:@"tls-queue"] ? @"/resource/style/multi" : @"/resource/style/sdk"]]) self.rewrittenStyles++;
        NSURLComponents *parts = [NSURLComponents componentsWithString:url];
        if (self.phase == 3 && [parts.scheme isEqual:@"http"] && [parts.host isEqual:@"example.invalid"] && (!parts.port || parts.port.integerValue == 80) && [parts.path isEqual:@"/resource/tile/0_0_0"] && !parts.query && !parts.fragment) self.externalTileRequests++;
    }
}
- (NSDictionary *)policyAttempts {
    @synchronized(self) {
        return @{@"origin": @(self.policyOriginAttempts), @"path": @(self.policyPathAttempts),
                 @"redirectSource": @(self.policyRedirectAttempts)};
    }
}
- (void)mapView:(MLNMapView *)mapView didFinishLoadingStyle:(MLNStyle *)style {
    if ([self.stage isEqual:@"tls-policy"]) {
        self.styleLoaded = YES;
        for (NSString *identifier in @[@"t", @"p", @"h"]) {
            if (![[style sourceWithIdentifier:identifier] isKindOfClass:MLNRasterTileSource.class] ||
                ![[style layerWithIdentifier:identifier] isKindOfClass:MLNRasterStyleLayer.class]) self.styleLoaded = NO;
        }
        return;
    }
    if ([self.stage isEqual:@"tls-mixed"]) {
        self.mixedStyleEvidence = @{@"rasterSource": @([[style sourceWithIdentifier:@"t"] isKindOfClass:MLNRasterTileSource.class]),
                                    @"rasterLayer": @([[style layerWithIdentifier:@"t"] isKindOfClass:MLNRasterStyleLayer.class]),
                                    @"symbolSource": @([[style sourceWithIdentifier:@"p"] isKindOfClass:MLNShapeSource.class]),
                                    @"symbolLayer": @([[style layerWithIdentifier:@"s"] isKindOfClass:MLNSymbolStyleLayer.class])};
        self.styleLoaded = ![self.mixedStyleEvidence.allValues containsObject:@NO];
        return;
    }
    if (self.phase == 11 || self.phase == 12) {
        NSData *data = [style.styleJSON dataUsingEncoding:NSUTF8StringEncoding];
        id json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSArray *sources = [[[style.sources valueForKey:@"identifier"] allObjects] sortedArrayUsingSelector:@selector(compare:)];
        NSArray *layers = [[style.layers valueForKey:@"identifier"] sortedArrayUsingSelector:@selector(compare:)];
        // SDK-owned annotation objects can remain in the exposed style collections.
        // Verify the actual empty input JSON and absence of our raster, not total counts.
        self.styleLoaded = [json isEqual:@{@"version": @8, @"sources": @{}, @"layers": @[]}] && ![style sourceWithIdentifier:@"t"] && ![style layerWithIdentifier:@"t"];
        self.emptyStyleEvidence = @{@"json": json ?: @{}, @"nativeSourceIDs": sources ?: @[], @"nativeLayerIDs": layers ?: @[], @"noSyntheticRaster": @(self.styleLoaded)};
        return;
    }
    self.styleLoaded = [style sourceWithIdentifier:@"t"] != nil && [style layerWithIdentifier:@"t"] != nil;
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fullyRendered {
    if ([self.stage isEqual:@"tls-pack-reopen"]) {
        if (self.styleLoaded && fullyRendered) self.fullyRendered = YES;
        return;
    }
    if (self.phase == 13) {
        NSDictionary *native = TPTransport.snapshot;
        if (self.styleLoaded && fullyRendered && [mapView.styleURL.path isEqual:@"/resource/style/held"] && [native[@"active"] isEqual:@0] && [native[@"pending"] isEqual:@0]) self.fullyRendered = YES;
        return;
    }
    if (!self.styleLoaded || !fullyRendered || self.phase > 2) return;
    NSDictionary *native = TPTransport.snapshot;
    if ([self.stage isEqual:@"tls-mixed"]) {
        if ([self idleNative:native] && [native[@"tlsVerifiedExchanges"] isEqual:@10] && [native[@"ledger"][@"tiles"] isEqual:@6]) self.fullyRendered = YES;
        return;
    }
    NSUInteger minimumTiles = self.phase == 2 ? 5 : 1;
    if ([native[@"active"] integerValue] == 0 && [native[@"ledger"][@"tiles"] unsignedIntegerValue] >= minimumTiles && [native[@"blockedBeforeDispatch"] integerValue] == 0) self.fullyRendered = YES;
}
- (void)control:(NSString *)path completion:(void (^)(NSDictionary *))completion {
    self.controlBusy = YES;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSDictionary *value = TPControl(path);
        dispatch_async(dispatch_get_main_queue(), ^{
            self.controlBusy = NO;
            if (!self.finishing) completion(value);
        });
    });
}
- (BOOL)idleNative:(NSDictionary *)native {
    return [native[@"ledgerOK"] isEqual:@YES] && [native[@"active"] isEqual:@0] && [native[@"pending"] isEqual:@0] && [native[@"blockedBeforeDispatch"] isEqual:@0] && [native[@"released"] isEqual:native[@"started"]] && [native[@"ledger"][@"unresolved"] count] == 0;
}
- (BOOL)serverHasNoCredentials:(NSDictionary *)server {
    if (![server[@"requests"] isKindOfClass:NSArray.class]) return NO;
    for (NSDictionary *entry in server[@"requests"]) {
        if (![entry[@"ua"] isEqual:@"TripPaintingMapTransportQA/1.0"] || ![entry[@"receivedAuthHeader"] isEqual:@NO] || ![entry[@"cookieHeader"] isEqual:@NO]) return NO;
    }
    return YES;
}
- (void)inspectCancellation {
    if (self.controlBusy) return;
    BOOL offlineGuard = [self.stage isEqual:@"offline-map-cancel-retry"];
    NSDictionary *native = TPTransport.snapshot;
    if (![native[@"ledgerOK"] isEqual:@YES] || [native[@"maxActive"] integerValue] > 4 || ![native[@"blockedBeforeDispatch"] isEqual:@0]) { [self finish:NO reason:@"cancel trial native gate failed"]; return; }
    if (self.phase == 10 && self.styleLoaded && [native[@"active"] isEqual:@4] && [native[@"pending"] integerValue] >= 1) {
        [self control:@"/stats" completion:^(NSDictionary *server) {
            NSDictionary *current = TPTransport.snapshot;
            if (![current[@"active"] isEqual:@4] || [current[@"pending"] integerValue] < 1 || ![server[@"heldActive"] isEqual:@4] || ![server[@"active"] isEqual:@4] || ![server[@"heldReleased"] isEqual:@NO]) return;
            if (![self serverHasNoCredentials:server]) { [self finish:NO reason:@"cancel baseline server headers failed"]; return; }
            self.waitingSnapshot = current; self.waitingServer = server;
            // Load local JSON: a remote empty style would queue behind held tiles.
            // Only the SDK's style change cancels work; no task/transport cancel calls.
            self.phase = 11; self.styleLoaded = NO; self.fullyRendered = NO;
            if (offlineGuard) [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:YES];
            self.map.styleJSON = TPEmptyStyleJSON;
        }];
    } else if (self.phase == 11 && self.styleLoaded && [self idleNative:native] && [native[@"cancelledActive"] integerValue] >= 1 && [native[@"cancelledPending"] integerValue] >= 1) {
        [self control:@"/stats" completion:^(NSDictionary *server) {
            NSDictionary *current = TPTransport.snapshot;
            if (![self idleNative:current] || ![server[@"active"] isEqual:@0] || ![server[@"heldActive"] isEqual:@0]) return;
            NSArray *old = self.waitingServer[@"requests"], *now = server[@"requests"];
            if (now.count < old.count || ![self serverHasNoCredentials:server]) { [self finish:NO reason:@"cancel server evidence missing"]; return; }
            NSUInteger closed = 0;
            for (NSUInteger i = 0; i < old.count; i++) if ([old[i][@"held"] isEqual:@YES]) {
                NSDictionary *entry = now[i];
                if (![entry[@"path"] isEqual:old[i][@"path"]] || ![entry[@"closedBeforeFinish"] isEqual:@YES] || ![entry[@"finished"] isEqual:@NO] || ![entry[@"bytesWritten"] isEqual:@0]) { [self finish:NO reason:@"old held response was not closed without body"]; return; }
                closed++;
            }
            if (closed != 4 || [current[@"ledger"][@"reservedBytes"] unsignedIntegerValue] < [self.waitingSnapshot[@"ledger"][@"reservedBytes"] unsignedIntegerValue]) { [self finish:NO reason:@"cancel refunded charge or lost held requests"]; return; }
            self.cancelledSnapshot = current; self.cancelledServer = server;
            [self.cases addObject:@{@"name": @"SDK style change cancels active and pending requests", @"pass": @YES, @"native": current, @"waitingSnapshot": self.waitingSnapshot, @"waitingServer": self.waitingServer, @"serverAfterCancel": server, @"localEmptyStyleLoaded": @YES, @"emptyStyleEvidence": self.emptyStyleEvidence}];
            if (offlineGuard) {
                self.phase = 14;
                self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/empty"]];
                return;
            }
            self.phase = 12;
            [self control:@"/release-held" completion:^(NSDictionary *released) {
                if (![released[@"heldReleased"] isEqual:@YES] || ![released[@"releasedOpenBodies"] isEqual:@0]) { [self finish:NO reason:@"release revived an old response"]; return; }
                self.releaseControl = released;
                // Keep the same durable ledger and all counters across manual reload.
                self.phase = 13; self.styleLoaded = NO; self.fullyRendered = NO;
                self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/held"]];
            }];
        }];
    } else if (self.phase == 13 && self.styleLoaded && self.fullyRendered && [self idleNative:native]) {
        [self control:@"/stats" completion:^(NSDictionary *server) {
            NSDictionary *current = TPTransport.snapshot;
            if (![self idleNative:current] || ![server[@"active"] isEqual:@0] || ![server[@"heldActive"] isEqual:@0]) return;
            if (![self serverHasNoCredentials:server]) { [self finish:NO reason:@"retry server headers failed"]; return; }
            NSArray *entries = server[@"requests"];
            NSUInteger before = [self.cancelledServer[@"resourceCount"] unsignedIntegerValue];
            NSMutableSet *oldPaths = [NSMutableSet new], *finishedPaths = [NSMutableSet new];
            for (NSDictionary *entry in self.waitingServer[@"requests"]) if ([entry[@"held"] isEqual:@YES]) [oldPaths addObject:entry[@"path"]];
            for (NSUInteger i = before; i < entries.count; i++) {
                NSDictionary *entry = entries[i];
                if ([entry[@"held"] isEqual:@YES] && [entry[@"finished"] isEqual:@YES] && [entry[@"bytesWritten"] isEqual:entry[@"bytes"]]) [finishedPaths addObject:entry[@"path"]];
            }
            if (finishedPaths.count < 5 || ![oldPaths isSubsetOfSet:finishedPaths]) { [self finish:NO reason:@"same-path retry did not reach server"]; return; }
            if ([current[@"ledger"][@"reservedBytes"] unsignedIntegerValue] <= [self.cancelledSnapshot[@"ledger"][@"reservedBytes"] unsignedIntegerValue] || ![current[@"httpRequestSendsSettled"] isEqual:server[@"resourceCount"]]) { [self finish:NO reason:@"retry charge or send evidence mismatch"]; return; }
            [self.cases addObject:@{@"name": @"manual SDK style reload repeats paths with retained charge", @"pass": @YES, @"native": current, @"server": server, @"beforeRetry": self.cancelledSnapshot, @"releaseControl": self.releaseControl, @"styleLoaded": @YES, @"fullyRendered": @YES}];
            [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK style cancellation and manual same-path reload completed"];
        }];
    }
}
- (void)mapViewDidFailLoadingMap:(MLNMapView *)mapView withError:(NSError *)error {
    if (![self.stage isEqual:@"offline-map-cancel-retry"] || self.phase != 14 || self.finishing) return;
    if (![mapView.styleURL.path isEqual:@"/resource/style/empty"] || !error) {
        [self finish:NO reason:@"unexpected offline style failure"]; return;
    }
    self.phase = 15;
    [self control:@"/stats" completion:^(NSDictionary *server) {
        NSDictionary *current = TPTransport.snapshot;
        if (![server isEqual:self.cancelledServer] || ![current isEqual:self.cancelledSnapshot]) {
            [self finish:NO reason:@"the blocked map style reached transport"]; return;
        }
        [self.cases addObject:@{@"name": @"new SDK style request refused with the guard on", @"pass": @YES,
            @"domain": error.domain, @"code": @(error.code), @"native": current, @"server": server}];
        [self control:@"/release-held" completion:^(NSDictionary *released) {
            if (![released[@"heldReleased"] isEqual:@YES] || ![released[@"releasedOpenBodies"] isEqual:@0]) {
                [self finish:NO reason:@"release revived an old response"]; return;
            }
            self.releaseControl = released;
            self.phase = 13; self.styleLoaded = NO; self.fullyRendered = NO;
            [TripPaintingMapBootstrap setOfflineMapRequestsBlocked:NO];
            self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/held"]];
        }];
    }];
}
- (void)inspectTLSCancellation:(NSDictionary *)native {
    NSDictionary *ledger = native[@"ledger"];
    if (![native[@"ledgerOK"] isEqual:@YES] || [native[@"maxActive"] unsignedIntegerValue] > 4 || ![native[@"blockedBeforeDispatch"] isEqual:@0]) {
        [self finish:NO reason:@"HTTPS cancellation native gate failed"];
        return;
    }
    if (self.phase == 9 && self.styleLoaded && [native[@"active"] isEqual:@4] && [native[@"pending"] unsignedIntegerValue] > 0 &&
        [native[@"started"] isEqual:@5] && [native[@"released"] isEqual:@1] && [native[@"tlsVerifiedExchanges"] isEqual:@1] &&
        [ledger[@"requests"] isEqual:@5] && [ledger[@"tiles"] isEqual:@4] && [ledger[@"reservedBytes"] isEqual:@1280]) {
        self.waitingSnapshot = native;
        self.phase = 10;
        [self publishActionProgress];
    } else if (self.phase == 11 && self.styleLoaded && [self idleNative:native]) {
        NSDictionary *waitingLedger = self.waitingSnapshot[@"ledger"];
        if (![native[@"started"] isEqual:@5] || ![native[@"cancelledActive"] isEqual:@4] ||
            ![native[@"cancelledPending"] isEqual:self.waitingSnapshot[@"pending"]] || ![native[@"httpRequestSendsSettled"] isEqual:@5] ||
            ![native[@"tlsVerifiedExchanges"] isEqual:@1] || ![native[@"acceptedBodyBytes"] isEqual:self.waitingSnapshot[@"acceptedBodyBytes"]] ||
            ![ledger[@"requests"] isEqual:waitingLedger[@"requests"]] || ![ledger[@"tiles"] isEqual:waitingLedger[@"tiles"]] ||
            ![ledger[@"reservedBytes"] isEqual:waitingLedger[@"reservedBytes"]]) {
            [self finish:NO reason:@"HTTPS cancellation counts or retained charge differ"];
            return;
        }
        self.cancelledSnapshot = native;
        [self.cases addObject:@{@"name": @"SDK style change cancels active and pending requests", @"pass": @YES,
                               @"native": native, @"waitingSnapshot": self.waitingSnapshot,
                               @"localEmptyStyleLoaded": @YES, @"emptyStyleEvidence": self.emptyStyleEvidence}];
        self.phase = 12;
        [self publishActionProgress];
    } else if (self.phase == 13 && self.styleLoaded && self.fullyRendered && [self idleNative:native] && [native[@"started"] unsignedIntegerValue] >= 12) {
        if (![native[@"started"] isEqual:@12] || ![native[@"httpRequestSendsSettled"] isEqual:@12] ||
            ![native[@"tlsVerifiedExchanges"] isEqual:@8] || ![native[@"cancelledActive"] isEqual:@4] ||
            ![native[@"cancelledPending"] isEqual:self.cancelledSnapshot[@"cancelledPending"]] ||
            ![ledger[@"requests"] isEqual:@12] || ![ledger[@"tiles"] isEqual:@10] || ![ledger[@"reservedBytes"] isEqual:@3072]) {
            [self finish:NO reason:@"HTTPS reload counts or retained charge differ"];
            return;
        }
        [self.cases addObject:@{@"name": @"manual SDK style reload repeats paths with retained charge", @"pass": @YES,
                               @"native": native, @"beforeRetry": self.cancelledSnapshot, @"styleLoaded": @YES, @"fullyRendered": @YES}];
        [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK HTTPS style cancellation and manual reload completed"];
    }
}
- (void)inspectTLSMixed:(NSDictionary *)native {
    NSUInteger released = [native[@"released"] unsignedIntegerValue];
    if (![native[@"ledgerOK"] isEqual:@YES] || ![native[@"blockedBeforeDispatch"] isEqual:@0] || [native[@"started"] unsignedIntegerValue] > 10) {
        [self finish:NO reason:@"HTTPS mixed resource gate failed"];
        return;
    }
    if (!self.waitingSnapshot && [native[@"active"] isEqual:@4] && [native[@"pending"] unsignedIntegerValue] > 0 &&
        [native[@"mixedActiveSprites"] isEqual:@0] && released >= 1 && released <= 3 &&
        [native[@"tlsVerifiedExchanges"] unsignedIntegerValue] == released) {
        self.waitingSnapshot = native;
        TPWriteDocument(@"mixed-waiting.json", @{@"kind": @"mixed-waiting", @"runID": self.runID,
                                               @"process": @(NSProcessInfo.processInfo.processIdentifier), @"native": native});
    }
    if (self.styleLoaded && self.fullyRendered && self.waitingSnapshot && [self idleNative:native] &&
        [native[@"started"] isEqual:@10] && [native[@"httpRequestSendsSettled"] isEqual:@10] &&
        [native[@"ledger"][@"reservedBytes"] isEqual:@10240] && [native[@"ledger"][@"tiles"] isEqual:@6]) {
        [self.cases addObject:@{@"name": @"SDK pinned HTTPS mixed resources", @"pass": @YES, @"native": native,
                               @"waitingSnapshot": self.waitingSnapshot, @"styleEvidence": self.mixedStyleEvidence,
                               @"styleLoaded": @YES, @"fullyRendered": @YES}];
        [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK HTTPS mixed resource check completed"];
    }
}
- (void)inspectTLSPolicy:(NSDictionary *)native {
    NSDictionary *attempts = [self policyAttempts];
    NSUInteger started = [native[@"started"] unsignedIntegerValue];
    NSDictionary *last = native[@"lastExchange"];
    // The gate reserves only the allowed style and redirect source. The latter
    // fails at the HTTP status line, while the other two URLs never dispatch.
    if (!self.styleLoaded || ![native[@"ledgerOK"] isEqual:@YES] || ![native[@"active"] isEqual:@0] ||
        ![native[@"pending"] isEqual:@0] || [native[@"blockedBeforeDispatch"] unsignedIntegerValue] < 2 ||
        ![attempts[@"origin"] unsignedIntegerValue] || ![attempts[@"path"] unsignedIntegerValue] ||
        ![attempts[@"redirectSource"] unsignedIntegerValue] || started < 2 ||
        ![native[@"released"] isEqual:@(started)] || ![native[@"httpRequestSendsSettled"] isEqual:@(started)] ||
        ![native[@"tlsVerifiedExchanges"] isEqual:@1] || ![last[@"finishCode"] isEqual:@6]) return;
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    if (!self.policyObservationStarted) self.policyObservationStarted = now;
    NSUInteger elapsed = (NSUInteger)((now - self.policyObservationStarted) * 1000);
    if (elapsed < 2500) return;
    [self.cases addObject:@{@"name": @"SDK HTTPS policy refusal", @"pass": @YES, @"styleLoaded": @YES,
                           @"attempts": attempts, @"observationMs": @(elapsed), @"native": native}];
    [self finish:MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK HTTPS policy observation completed"];
}
- (void)inspectProgress {
    if (self.finishing) return;
    if ([self.stage isEqual:@"cancel-retry"] || [self.stage isEqual:@"offline-map-cancel-retry"]) { [self inspectCancellation]; return; }
    NSDictionary *native = TPTransport.snapshot;
    if ([self.stage isEqual:@"tls-mixed"]) { [self inspectTLSMixed:native]; return; }
    if ([self.stage isEqual:@"tls-policy"]) { [self inspectTLSPolicy:native]; return; }
    if ([self.stage isEqual:@"tls-cancel-retry"]) { [self inspectTLSCancellation:native]; return; }
    if ([self.stage isEqual:@"tls-render"]) {
        if (self.phase == 1 && self.styleLoaded && self.fullyRendered && [self idleNative:native] && [native[@"started"] isEqual:@2] && [native[@"httpRequestSendsSettled"] isEqual:@2] && [native[@"tlsVerifiedExchanges"] isEqual:@2] && [native[@"ledger"][@"tiles"] isEqual:@1]) {
            [self.cases addObject:@{@"name": @"SDK pinned HTTPS raster render", @"pass": @YES, @"native": native, @"styleLoaded": @YES, @"fullyRendered": @YES}];
            NSUInteger rewrites; @synchronized(self) { rewrites = self.rewrittenStyles; }
            [self finish:rewrites >= 1 && MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK pinned HTTPS single-raster check completed"];
        }
        return;
    }
    if ([self.stage isEqual:@"tls-queue"]) {
        if (!self.waitingSnapshot && [native[@"active"] isEqual:@4] && [native[@"pending"] integerValue] >= 1 && [native[@"released"] isEqual:@1] && [native[@"tlsVerifiedExchanges"] isEqual:@1]) self.waitingSnapshot = native;
        if (self.phase == 2 && self.styleLoaded && self.fullyRendered && self.waitingSnapshot && [self idleNative:native] && [native[@"maxActive"] isEqual:@4] && [native[@"maxPending"] integerValue] >= 1 && [native[@"started"] isEqual:@7] && [native[@"httpRequestSendsSettled"] isEqual:@7] && [native[@"tlsVerifiedExchanges"] isEqual:@7] && [native[@"ledger"][@"tiles"] isEqual:@6]) {
            [self.cases addObject:@{@"name": @"SDK pinned HTTPS fifth request waits", @"pass": @YES, @"native": native, @"waitingSnapshot": self.waitingSnapshot, @"styleLoaded": @YES, @"fullyRendered": @YES}];
            NSUInteger rewrites; @synchronized(self) { rewrites = self.rewrittenStyles; }
            [self finish:rewrites >= 1 && MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK pinned HTTPS queue check completed"];
        }
        return;
    }
    if (self.phase == 2 && !self.waitingSnapshot && [native[@"active"] integerValue] == 4 && [native[@"pending"] integerValue] > 0) self.waitingSnapshot = native;
    if (self.phase == 1 && self.styleLoaded && self.fullyRendered && [native[@"ledger"][@"tiles"] integerValue] >= 1 && [native[@"active"] integerValue] == 0 && [native[@"blockedBeforeDispatch"] integerValue] == 0 && [native[@"httpRequestSendsSettled"] integerValue] >= 2 && [native[@"acceptedBodyBytes"] integerValue] > 256) {
        self.phase = 2;
        [self.cases addObject:@{@"name": @"actual RN native transform class and SDK raster render", @"pass": @YES, @"native": native, @"styleLoaded": @YES, @"fullyRendered": @YES}];
        self.styleLoaded = NO; self.fullyRendered = NO;
        if (![TPTransport configureOrigin:TPOrigin ledgerURL:[TPRunDirectory URLByAppendingPathComponent:@"multi-ledger.json"] maxRequests:32 maxTiles:16 maxReservedBytes:8192]) { [self finish:NO reason:@"multi ledger not ready"]; return; }
        [self.map setCenterCoordinate:CLLocationCoordinate2DMake(0, 0) zoomLevel:2 animated:NO];
        self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/multi"]];
        [self.view setNeedsLayout]; [self.view layoutIfNeeded];
    } else if (self.phase == 2 && self.styleLoaded && self.fullyRendered && self.waitingSnapshot && [native[@"active"] integerValue] == 0 && [native[@"pending"] integerValue] == 0 && [native[@"ledger"][@"tiles"] integerValue] >= 5 && [native[@"maxActive"] integerValue] == 4 && [native[@"maxPending"] integerValue] >= 1 && [native[@"blockedBeforeDispatch"] integerValue] == 0) {
        self.phase = 3;
        [self.cases addObject:@{@"name": @"actual SDK fifth tile waits behind four native permits", @"pass": @YES, @"native": native, @"waitingSnapshot": self.waitingSnapshot, @"styleLoaded": @YES, @"fullyRendered": @YES}];
        self.styleLoaded = NO; self.fullyRendered = NO;
        if (![TPTransport configureOrigin:TPOrigin ledgerURL:[TPRunDirectory URLByAppendingPathComponent:@"blocked-ledger.json"] maxRequests:32 maxTiles:16 maxReservedBytes:8192]) { [self finish:NO reason:@"blocked ledger not ready"]; return; }
        self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/blocked"]];
    } else if (self.phase == 3 && self.styleLoaded && self.externalTileRequests >= 1 && [native[@"active"] integerValue] == 0 && [native[@"blockedBeforeDispatch"] integerValue] >= 1 && [native[@"httpRequestSendsSettled"] integerValue] == 1) {
        [self.cases addObject:@{@"name": @"actual SDK external tile refused before dispatch", @"pass": @YES, @"native": native}];
        NSUInteger rewrites; @synchronized(self) { rewrites = self.rewrittenStyles; }
        [self finish:rewrites >= 1 && MLNNetworkConfiguration.sharedManager.delegate == self.transform reason:@"SDK native transform and concurrency checks completed"];
    }
}
@end

@interface TPSDKScene : UIResponder <UIWindowSceneDelegate>
@property UIWindow *window;
@property TPSDKController *controller;
@end
@implementation TPSDKScene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    if (![scene isKindOfClass:UIWindowScene.class]) return;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.controller = [TPSDKController new]; self.window.rootViewController = self.controller;
    [self.window makeKeyAndVisible];
}
- (void)sceneDidBecomeActive:(UIScene *)scene {
    if (!TPStarted) [self.controller start];
    else if (TPRunning) UIApplication.sharedApplication.idleTimerDisabled = YES;
}
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts {
    // Existing-scene delivery only. Cold-launch URL contexts deliberately do
    // not authorize an action in a different/unconfigured process.
    if (URLContexts.count == 1) [self.controller receiveFixtureURL:URLContexts.anyObject.URL];
}
- (void)sceneWillResignActive:(UIScene *)scene { if (TPStarted) UIApplication.sharedApplication.idleTimerDisabled = TPPriorIdle; }
- (void)sceneDidDisconnect:(UIScene *)scene { if (TPStarted) UIApplication.sharedApplication.idleTimerDisabled = TPPriorIdle; }
@end
@interface TPSDKApp : UIResponder <UIApplicationDelegate>
@end
@implementation TPSDKApp
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options { return YES; }
- (UISceneConfiguration *)application:(UIApplication *)application configurationForConnectingSceneSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *config = [[UISceneConfiguration alloc] initWithName:@"MapLibre QA" sessionRole:session.role]; config.delegateClass = TPSDKScene.class; return config;
}
@end
int main(int argc, char **argv) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(TPSDKApp.class)); } }
