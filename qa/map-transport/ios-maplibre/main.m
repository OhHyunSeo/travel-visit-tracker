#import <UIKit/UIKit.h>
#import <MapLibre/MapLibre.h>
#import <MapLibre/MLNNetworkConfiguration.h>
#import "TPTransport.h"
#import "MLRNTransformRequest.h"

static NSURL *TPRunDirectory;
static NSString *TPOrigin;
static BOOL TPStarted, TPRunning, TPPriorIdle;

static void TPWrite(NSDictionary *value) {
    if (!TPRunDirectory) return;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [data writeToURL:[TPRunDirectory URLByAppendingPathComponent:@"result.json"] options:NSDataWritingAtomic error:nil];
}
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
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC));
    [task cancel]; [session invalidateAndCancel];
    return result;
}

@interface TPSDKController : UIViewController <MLNMapViewDelegate>
@property UILabel *label;
@property MLNMapView *map;
@property NSMutableArray *cases;
@property NSUInteger transforms, rewrittenStyles, externalTileRequests, phase;
@property BOOL styleLoaded, fullyRendered, finishing;
@property NSTimer *timer;
@property MLRNTransformRequest *transform;
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
    self.map.frame = CGRectMake(0, top + 116, self.view.bounds.size.width, MAX(200, self.view.bounds.size.height - top - 116));
}
- (void)finish:(BOOL)pass reason:(NSString *)reason {
    if (self.finishing) return;
    self.finishing = YES; [self.timer invalidate];
    TPRunning = NO; UIApplication.sharedApplication.idleTimerDisabled = TPPriorIdle;
    NSUInteger transforms, rewrites;
    @synchronized(self) { transforms = self.transforms; rewrites = self.rewrittenStyles; }
    TPWrite(@{@"complete": @YES, @"pass": @(pass), @"reason": reason,
              @"cases": self.cases ?: @[], @"process": @(NSProcessInfo.processInfo.processIdentifier),
              @"transforms": @(transforms), @"rewrittenStyles": @(rewrites), @"externalTileRequests": @(self.externalTileRequests),
              @"delegatePreserved": @(self.transform && MLNNetworkConfiguration.sharedManager.delegate == self.transform),
              @"delegateClass": self.transform ? NSStringFromClass(self.transform.class) : @"none",
              @"scope": @"isolated MapLibre6.31.0 with actual RN11.5 native transform class; no JS/TurboModule bridge, TLS/HTTP2/provider/OS-byte acceptance"});
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
    NSString *runID = env[@"QA_RUN_ID"];
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,64}$" options:0 error:nil];
    BOOL valid = runID && [pattern numberOfMatchesInString:runID options:0 range:NSMakeRange(0, runID.length)] == 1;
    NSURL *documents = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    TPRunDirectory = [documents URLByAppendingPathComponent:valid ? runID : @"invalid-input"];
    BOOL fresh = ![[NSFileManager defaultManager] fileExistsAtPath:TPRunDirectory.path];
    if (!valid || !fresh || ![TPTransport safeOrigin:TPOrigin]) { TPRunDirectory = nil; [self finish:NO reason:@"unsafe or reused inputs"]; return; }
    [[NSFileManager defaultManager] createDirectoryAtURL:TPRunDirectory withIntermediateDirectories:YES attributes:nil error:nil];
    self.cases = [NSMutableArray new];
    TPWrite(@{@"complete": @NO, @"phase": @"waiting-for-local-fixture"});
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSTimeInterval end = NSProcessInfo.processInfo.systemUptime + 45;
        BOOL ready = NO;
        while (NSProcessInfo.processInfo.systemUptime < end) {
            if ([TPControl(@"/stats")[@"resourceCount"] isKindOfClass:NSNumber.class]) { ready = YES; break; }
            [NSThread sleepForTimeInterval:0.15];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!ready) { [self finish:NO reason:@"local fixture not ready"]; return; }
            [self createMap];
        });
    });
}
- (void)createMap {
    MLNNetworkConfiguration *network = MLNNetworkConfiguration.sharedManager;
    if (network.delegate) { [self finish:NO reason:@"unexpected preexisting SDK delegate"]; return; }
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
    [self.transform addHeader:@"qa-auth" match:match name:@"Authorization" value:@"synthetic-sdk-secret-must-not-forward"];
    [self.transform addHeader:@"qa-cookie" match:match name:@"Cookie" value:@"synthetic-sdk-cookie-must-not-forward=1"];
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.protocolClasses = @[TPTransport.class]; configuration.URLCache = nil;
    configuration.HTTPCookieStorage = nil; configuration.URLCredentialStorage = nil;
    configuration.HTTPShouldSetCookies = NO;
    network.sessionConfiguration = configuration;
    if (network.delegate != self.transform) { [self finish:NO reason:@"session configuration replaced delegate"]; return; }
    if (![TPTransport configureOrigin:TPOrigin ledgerURL:[TPRunDirectory URLByAppendingPathComponent:@"render-ledger.json"] maxRequests:32 maxTiles:16 maxReservedBytes:8192]) { [self finish:NO reason:@"ledger not ready"]; return; }
    self.phase = 1;
    // Explicit style avoids constructing a default network style before the gate.
    self.map = [[MLNMapView alloc] initWithFrame:CGRectMake(0, 120, self.view.bounds.size.width, 300) styleURL:[NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/entry"]]];
    self.map.delegate = self; self.map.prefetchesTiles = NO;
    self.map.shouldRequestAuthorizationToUseLocationServices = NO;
    self.map.showsUserLocation = NO; self.map.scrollEnabled = NO; self.map.zoomEnabled = NO;
    self.map.rotateEnabled = NO; self.map.pitchEnabled = NO;
    [self.map setCenterCoordinate:CLLocationCoordinate2DMake(0, 0) zoomLevel:0 animated:NO];
    [self.view insertSubview:self.map belowSubview:self.label]; [self.view setNeedsLayout];
    self.label.text = @"합성 지도를 확인하고 있습니다.\n기존 여행 기록은 사용하지 않습니다.";
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *timer) { [self inspectProgress]; }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ if (!self.finishing) [self finish:NO reason:@"SDK trial deadline"]; });
}
- (void)observedTransformURL:(NSString *)url {
    @synchronized(self) {
        self.transforms++;
        if ([url isEqual:[TPOrigin stringByAppendingString:@"/resource/style/sdk"]]) self.rewrittenStyles++;
        NSURLComponents *parts = [NSURLComponents componentsWithString:url];
        if (self.phase == 3 && [parts.scheme isEqual:@"http"] && [parts.host isEqual:@"example.invalid"] && (!parts.port || parts.port.integerValue == 80) && [parts.path isEqual:@"/resource/tile/0_0_0"] && !parts.query && !parts.fragment) self.externalTileRequests++;
    }
}
- (void)mapView:(MLNMapView *)mapView didFinishLoadingStyle:(MLNStyle *)style {
    self.styleLoaded = [style sourceWithIdentifier:@"t"] != nil && [style layerWithIdentifier:@"t"] != nil;
}
- (void)mapViewDidFinishRenderingFrame:(MLNMapView *)mapView fullyRendered:(BOOL)fullyRendered {
    if (!self.styleLoaded || !fullyRendered || self.phase > 2) return;
    NSDictionary *native = TPTransport.snapshot;
    NSUInteger minimumTiles = self.phase == 2 ? 4 : 1;
    if ([native[@"active"] integerValue] == 0 && [native[@"ledger"][@"tiles"] unsignedIntegerValue] >= minimumTiles && [native[@"blockedBeforeDispatch"] integerValue] == 0) self.fullyRendered = YES;
}
- (void)inspectProgress {
    if (self.finishing) return;
    NSDictionary *native = TPTransport.snapshot;
    if (self.phase == 1 && self.styleLoaded && self.fullyRendered && [native[@"ledger"][@"tiles"] integerValue] >= 1 && [native[@"active"] integerValue] == 0 && [native[@"blockedBeforeDispatch"] integerValue] == 0 && [native[@"httpRequestSendsSettled"] integerValue] >= 2 && [native[@"acceptedBodyBytes"] integerValue] > 256) {
        self.phase = 2;
        [self.cases addObject:@{@"name": @"actual RN native transform class and SDK raster render", @"pass": @YES, @"native": native, @"styleLoaded": @YES, @"fullyRendered": @YES}];
        self.styleLoaded = NO; self.fullyRendered = NO;
        if (![TPTransport configureOrigin:TPOrigin ledgerURL:[TPRunDirectory URLByAppendingPathComponent:@"multi-ledger.json"] maxRequests:32 maxTiles:16 maxReservedBytes:8192]) { [self finish:NO reason:@"multi ledger not ready"]; return; }
        [self.map setCenterCoordinate:CLLocationCoordinate2DMake(0, 0) zoomLevel:2 animated:NO];
        self.map.styleURL = [NSURL URLWithString:[TPOrigin stringByAppendingString:@"/resource/style/multi"]];
    } else if (self.phase == 2 && self.styleLoaded && self.fullyRendered && [native[@"active"] integerValue] == 0 && [native[@"ledger"][@"tiles"] integerValue] >= 4 && [native[@"maxActive"] integerValue] == 4 && [native[@"blockedBeforeDispatch"] integerValue] == 0) {
        self.phase = 3;
        [self.cases addObject:@{@"name": @"actual SDK multi-tile bodies stay within four native permits", @"pass": @YES, @"native": native, @"styleLoaded": @YES, @"fullyRendered": @YES}];
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
