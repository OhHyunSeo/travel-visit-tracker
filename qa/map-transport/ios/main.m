#import <UIKit/UIKit.h>
#import "TPTransport.h"

static NSString *TPBase;
static NSURL *TPDocuments;
static NSString *TPRunID;
static NSMutableArray *TPResults;

static NSDictionary *TPFetch(NSURLSession *session, NSString *path) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSData *body;
    __block NSError *failure;
    NSURL *url = [NSURL URLWithString:path relativeToURL:[NSURL URLWithString:[TPBase stringByAppendingString:@"/"]]];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    [request setValue:@"synthetic-secret-must-not-forward" forHTTPHeaderField:@"Authorization"];
    [request setValue:@"synthetic-cookie-must-not-forward=1" forHTTPHeaderField:@"Cookie"];
    NSURLSessionDataTask *task = [session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) { body = data; failure = error; dispatch_semaphore_signal(done); }];
    [task resume];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC))) { [task cancel]; return @{@"error": @(-9999), @"length": @0}; }
    id json = body ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil] : nil;
    return @{@"error": @(failure ? failure.code : 0), @"length": @(body.length), @"json": json ?: @{}};
}
static NSURLSession *TPControl(void) {
    NSURLSessionConfiguration *c = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    c.timeoutIntervalForRequest = 3; c.timeoutIntervalForResource = 4;
    c.HTTPCookieStorage = nil; c.URLCredentialStorage = nil; c.HTTPShouldSetCookies = NO; c.URLCache = nil;
    return [NSURLSession sessionWithConfiguration:c];
}
static NSURLSession *TPOuter(void) {
    NSURLSessionConfiguration *c = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    c.protocolClasses = @[TPTransport.class]; c.URLCache = nil; c.HTTPCookieStorage = nil; c.URLCredentialStorage = nil;
    c.timeoutIntervalForResource = 60;
    return [NSURLSession sessionWithConfiguration:c];
}
static BOOL TPStatsValid(NSDictionary *stats) {
    return [stats isKindOfClass:NSDictionary.class] && [stats[@"active"] isKindOfClass:NSNumber.class] && [stats[@"resourceCount"] isKindOfClass:NSNumber.class] && [stats[@"nonControlRequestCount"] isKindOfClass:NSNumber.class];
}
static NSDictionary *TPStats(NSURLSession *control) {
    NSDictionary *response = TPFetch(control, @"stats");
    id stats = response[@"json"];
    return [response[@"error"] integerValue] == 0 && TPStatsValid(stats) ? stats : @{};
}
static BOOL TPWait(BOOL (^predicate)(void), NSUInteger milliseconds) {
    NSTimeInterval deadline = NSProcessInfo.processInfo.systemUptime + (double)milliseconds / 1000.0;
    while (NSProcessInfo.processInfo.systemUptime < deadline) { if (predicate()) return YES; [NSThread sleepForTimeInterval:0.05]; }
    return NO;
}
static BOOL TPIdle(NSURLSession *control) {
    return TPWait(^BOOL { NSDictionary *stats = TPStats(control); return TPStatsValid(stats) && [TPTransport.snapshot[@"active"] unsignedIntegerValue] == 0 && [stats[@"active"] unsignedIntegerValue] == 0; }, 4000);
}
static void TPWrite(NSString *name, NSDictionary *value) {
    NSData *body = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [body writeToURL:[TPDocuments URLByAppendingPathComponent:name] options:NSDataWritingAtomic error:nil];
}
static void TPCase(NSString *name, BOOL pass, NSDictionary *details) {
    [TPResults addObject:@{@"name": name, @"pass": @(pass), @"details": details ?: @{}}];
    TPWrite(@"result.json", @{@"stage": @"basic", @"complete": @NO, @"cases": TPResults, @"process": @(NSProcessInfo.processInfo.processIdentifier)});
}
static NSURL *TPLedger(NSString *suffix) { return [[TPDocuments URLByAppendingPathComponent:TPRunID isDirectory:YES] URLByAppendingPathComponent:[suffix stringByAppendingString:@".json"]]; }
static BOOL TPOpen(NSString *suffix, NSUInteger requests, NSUInteger tiles, NSUInteger bytes) { return [TPTransport configureOrigin:TPBase ledgerURL:TPLedger(suffix) maxRequests:requests maxTiles:tiles maxReservedBytes:bytes]; }
static NSArray *TPBatch(NSURLSession *outer, NSArray<NSString *> *paths) {
    dispatch_group_t group = dispatch_group_create();
    NSMutableArray *results = [NSMutableArray new];
    NSMutableArray *tasks = [NSMutableArray new];
    for (NSString *path in paths) {
        dispatch_group_enter(group);
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[TPBase stringByAppendingFormat:@"/%@", path]]];
        [request setValue:@"synthetic-secret-must-not-forward" forHTTPHeaderField:@"Authorization"];
        [request setValue:@"synthetic-cookie-must-not-forward=1" forHTTPHeaderField:@"Cookie"];
        NSURLSessionDataTask *task = [outer dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            @synchronized (results) { [results addObject:@{@"length": @(data.length), @"error": @(error ? error.code : 0)}]; }
            dispatch_group_leave(group);
        }];
        [tasks addObject:task]; [task resume];
    }
    if (dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 12 * NSEC_PER_SEC))) {
        for (NSURLSessionDataTask *task in tasks) [task cancel];
        dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
    }
    @synchronized (results) { return [results copy]; }
}
static BOOL TPAllSuccess(NSArray *results, NSUInteger expected) {
    if (results.count != expected) return NO;
    for (NSDictionary *result in results) if ([result[@"error"] integerValue] || [result[@"length"] unsignedIntegerValue] != 64) return NO;
    return YES;
}
static void TPCancellation(NSURLSession *outer, NSURLSession *control, BOOL cancelActive) {
    TPOpen(@"main", 64, 32, 16384); TPFetch(control, @"reset");
    NSDictionary *ledgerBefore = TPTransport.snapshot[@"ledger"];
    dispatch_group_t group = dispatch_group_create();
    NSMutableArray<NSURLSessionDataTask *> *tasks = [NSMutableArray new];
    NSMutableArray *results = [NSMutableArray new];
    for (NSUInteger i = 0; i < 4; i++) {
        dispatch_group_enter(group);
        NSURL *url = [NSURL URLWithString:[TPBase stringByAppendingFormat:@"/resource/tile/held%lu?hold=1&delayMs=20", (unsigned long)i]];
        NSURLSessionDataTask *task = [outer dataTaskWithURL:url completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) { @synchronized(results) { [results addObject:@{@"error": @(error ? error.code : 0), @"length": @(data.length)}]; } dispatch_group_leave(group); }];
        [tasks addObject:task]; [task resume];
    }
    BOOL held = TPWait(^BOOL { return [TPStats(control)[@"active"] integerValue] == 4; }, 4000);
    dispatch_group_enter(group);
    NSURLSessionDataTask *fifth = [outer dataTaskWithURL:[NSURL URLWithString:[TPBase stringByAppendingString:@"/resource/style/fifth?delayMs=20"]] completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) { @synchronized(results) { [results addObject:@{@"error": @(error ? error.code : 0), @"length": @(data.length)}]; } dispatch_group_leave(group); }];
    [fifth resume]; [NSThread sleepForTimeInterval:0.15];
    [(cancelActive ? tasks.firstObject : fifth) cancel];
    if (cancelActive) TPWait(^BOOL { return [TPStats(control)[@"resourceCount"] integerValue] == 5; }, 3000);
    TPFetch(control, @"release");
    BOOL finished = dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 6 * NSEC_PER_SEC)) == 0;
    if (!finished) { [fifth cancel]; for (NSURLSessionDataTask *task in tasks) [task cancel]; }
    BOOL idle = TPIdle(control);
    NSDictionary *stats = TPStats(control), *native = TPTransport.snapshot;
    NSUInteger errors = 0, successes = 0;
    NSArray *finishedResults;
    @synchronized(results) { finishedResults = [results copy]; for (NSDictionary *result in finishedResults) { if ([result[@"error"] integerValue]) errors++; else if ([result[@"length"] integerValue] == 64) successes++; } }
    NSUInteger expectedResources = cancelActive ? 5 : 4;
    BOOL pass = held && finished && idle && TPStatsValid(stats) && [native[@"started"] unsignedIntegerValue] == expectedResources && [native[@"ledger"][@"requests"] unsignedIntegerValue] - [ledgerBefore[@"requests"] unsignedIntegerValue] == expectedResources && [native[@"ledger"][@"reservedBytes"] unsignedIntegerValue] - [ledgerBefore[@"reservedBytes"] unsignedIntegerValue] == expectedResources * 256 && errors == 1 && successes == 4 && [stats[@"resourceCount"] unsignedIntegerValue] == expectedResources && [stats[@"maxActive"] integerValue] <= 4 && [native[@"maxActive"] integerValue] <= 4;
    TPCase(cancelActive ? @"active cancellation retains permit until native completion" : @"queued cancellation makes no request or reservation", pass, @{@"fixture": stats, @"native": native, @"results": finishedResults});
}
static void TPBasic(NSURLSession *outer, NSURLSession *control) {
    TPResults = [NSMutableArray new];
    BOOL ready = TPWait(^BOOL { return TPStatsValid(TPStats(control)); }, 30000);
    if (!ready) { TPCase(@"local fixture reachable", NO, @{}); TPWrite(@"result.json", @{@"stage": @"basic", @"complete": @YES, @"pass": @NO, @"cases": TPResults}); return; }
    BOOL opened = TPOpen(@"main", 64, 32, 16384); TPFetch(control, @"reset");
    NSMutableArray *paths = [NSMutableArray new];
    for (NSString *kind in @[@"style", @"tile", @"glyph", @"sprite"]) for (NSUInteger i = 0; i < 3; i++) [paths addObject:[NSString stringWithFormat:@"resource/%@/p%lu?delayMs=100", kind, (unsigned long)i]];
    NSArray *responses = TPBatch(outer, paths); BOOL idle = TPIdle(control);
    NSDictionary *stats = TPStats(control), *native = TPTransport.snapshot;
    BOOL headers = YES;
    for (NSDictionary *request in stats[@"requests"]) if (![request[@"ua"] isEqual:@"TripPaintingMapTransportQA/1.0"] || [request[@"receivedAuthHeader"] boolValue] || [request[@"cookieHeader"] boolValue]) headers = NO;
    TPCase(@"four request body lifetimes, scoped UA and stripped synthetic credentials", opened && idle && TPStatsValid(stats) && TPAllSuccess(responses, 12) && [stats[@"resourceCount"] integerValue] == 12 && [stats[@"maxActive"] integerValue] == 4 && [native[@"maxActive"] integerValue] == 4 && headers, @{@"fixture": stats, @"native": native});
    TPCancellation(outer, control, NO);
    TPCancellation(outer, control, YES);

    TPOpen(@"main", 64, 32, 16384); TPFetch(control, @"reset");
    NSDictionary *external = TPFetch(outer, @"http://example.invalid/resource/tile/blocked");
    NSDictionary *unknown = TPFetch(outer, @"resource/tile/blocked?unknown=1");
    NSDictionary *path = TPFetch(outer, @"not-a-resource");
    idle = TPIdle(control); stats = TPStats(control); native = TPTransport.snapshot;
    TPCase(@"external host and unknown resource rejected before dispatch", idle && TPStatsValid(stats) && [external[@"error"] integerValue] && [unknown[@"error"] integerValue] && [path[@"error"] integerValue] && [stats[@"nonControlRequestCount"] integerValue] == 0 && [native[@"blockedBeforeDispatch"] integerValue] == 3 && [native[@"started"] integerValue] == 0, @{@"fixture": stats, @"native": native});

    for (NSString *query in @[@"redirect=1", @"chunked=1", @"gzip=1", @"status=500", @"bytes=512"]) {
        TPOpen(@"main", 64, 32, 16384); TPFetch(control, @"reset");
        NSDictionary *response = TPFetch(outer, [@"resource/style/reject?delayMs=20&" stringByAppendingString:query]);
        idle = TPIdle(control); stats = TPStats(control); native = TPTransport.snapshot;
        TPCase([@"response policy rejects " stringByAppendingString:query], idle && TPStatsValid(stats) && [response[@"error"] integerValue] && [native[@"started"] integerValue] == 1 && [native[@"acceptedBodyBytes"] integerValue] == 0 && [stats[@"resourceCount"] integerValue] == 1, @{@"fixture": stats, @"native": native, @"response": response});
    }
    opened = TPOpen(@"budget", 8, 2, 768); TPFetch(control, @"reset");
    NSArray *budget = @[@"resource/tile/t1?delayMs=0", @"resource/tile/t2?delayMs=0", @"resource/tile/t3?delayMs=0", @"resource/style/s1?delayMs=0", @"resource/style/s2?delayMs=0"];
    NSMutableArray *budgetResults = [NSMutableArray new]; for (NSString *path in budget) [budgetResults addObject:TPFetch(outer, path)];
    idle = TPIdle(control); native = TPTransport.snapshot; stats = TPStats(control);
    TPCase(@"nonrefunding tile task counts and body reservations stop later requests", opened && idle && TPStatsValid(stats) && TPAllSuccess(@[budgetResults[0], budgetResults[1], budgetResults[3]], 3) && [budgetResults[2][@"error"] integerValue] != 0 && [budgetResults[4][@"error"] integerValue] != 0 && [stats[@"resourceCount"] integerValue] == 3 && [native[@"blockedBeforeDispatch"] integerValue] == 2 && [native[@"ledger"][@"requests"] integerValue] == 3 && [native[@"ledger"][@"tiles"] integerValue] == 2 && [native[@"ledger"][@"reservedBytes"] integerValue] == 768, @{@"fixture": stats, @"native": native, @"responses": budgetResults});

    NSData *malformed = [@"{malformed ledger" dataUsingEncoding:NSUTF8StringEncoding];
    [[NSFileManager defaultManager] createDirectoryAtURL:TPLedger(@"malformed").URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    [malformed writeToURL:TPLedger(@"malformed") atomically:YES];
    opened = TPOpen(@"malformed", 8, 2, 768); TPFetch(control, @"reset");
    NSDictionary *denied = TPFetch(outer, @"resource/tile/denied");
    stats = TPStats(control);
    TPCase(@"malformed ledger stays unchanged and denies network", !opened && TPStatsValid(stats) && [denied[@"error"] integerValue] && [[NSData dataWithContentsOfURL:TPLedger(@"malformed")] isEqual:malformed] && [stats[@"nonControlRequestCount"] integerValue] == 0, @{@"fixture": stats, @"native": TPTransport.snapshot});
    BOOL passed = YES; for (NSDictionary *result in TPResults) if (![result[@"pass"] boolValue]) passed = NO;
    TPWrite(@"result.json", @{@"stage": @"basic", @"complete": @YES, @"pass": @(passed), @"cases": TPResults, @"process": @(NSProcessInfo.processInfo.processIdentifier), @"scope": @"standalone physical iOS NSURLProtocol; per-forwarded-task reservations, not per-network-exchange or MapLibre/OS-received-byte proof"});
}
static void TPRestart(NSURLSession *outer, NSURLSession *control, BOOL resume) {
    BOOL ready = TPWait(^BOOL { return TPStatsValid(TPStats(control)); }, 15000);
    BOOL opened = TPOpen(@"restart", 8, 4, 2048);
    NSDictionary *before = TPTransport.snapshot;
    if (resume) {
        TPFetch(control, @"release"); TPIdle(control); TPFetch(control, @"reset");
        NSDictionary *response = TPFetch(outer, @"resource/style/resumed?delayMs=20"); BOOL idle = TPIdle(control);
        NSDictionary *after = TPTransport.snapshot;
        BOOL pass = ready && opened && idle && [before[@"ledger"][@"requests"] integerValue] == 1 && [before[@"ledger"][@"reservedBytes"] integerValue] == 256 && [before[@"ledger"][@"unresolved"] count] == 1 && [response[@"error"] integerValue] == 0 && [after[@"ledger"][@"requests"] integerValue] == 2 && [after[@"ledger"][@"reservedBytes"] integerValue] == 512 && [after[@"ledger"][@"unresolved"] count] == 1;
        TPWrite(@"result.json", @{@"stage": @"resume", @"complete": @YES, @"pass": @(pass), @"before": before, @"after": after, @"response": response, @"process": @(NSProcessInfo.processInfo.processIdentifier)});
    } else {
        TPFetch(control, @"reset");
        NSURLSessionDataTask *held = [outer dataTaskWithURL:[NSURL URLWithString:[TPBase stringByAppendingString:@"/resource/tile/restart?hold=1"]] completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {}];
        [held resume];
        BOOL active = TPWait(^BOOL { return [TPStats(control)[@"active"] integerValue] == 1; }, 4000);
        TPWrite(@"result.json", @{@"stage": @"hold", @"readyForTermination": @(ready && opened && active), @"native": TPTransport.snapshot, @"process": @(NSProcessInfo.processInfo.processIdentifier)});
    }
}
@interface TPAppDelegate : UIResponder <UIApplicationDelegate>
@property UIWindow *window;
@property UILabel *label;
@end
@implementation TPAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    application.idleTimerDisabled = YES;
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    UIViewController *controller = [UIViewController new]; controller.view.backgroundColor = UIColor.systemBackgroundColor;
    self.label = [[UILabel alloc] initWithFrame:CGRectInset(UIScreen.mainScreen.bounds, 24, 120)]; self.label.numberOfLines = 0; self.label.textAlignment = NSTextAlignmentCenter;
    self.label.text = @"지도 통신 시험\n\n기존 여행색칠과 분리된 시험 앱입니다.\n로컬 네트워크 안내가 나오면 허용해 주세요.";
    [controller.view addSubview:self.label]; self.window.rootViewController = controller; [self.window makeKeyAndVisible];
    NSDictionary *env = NSProcessInfo.processInfo.environment;
    TPBase = env[@"QA_SERVER_ORIGIN"];
    TPRunID = env[@"QA_RUN_ID"] ?: @"invalid";
    TPDocuments = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
    NSString *stage = env[@"QA_STAGE"] ?: @"basic";
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSURLSession *control = TPControl(), *outer = TPOuter();
        if (!TPBase || ![TPTransport safeOrigin:TPBase]) {
            TPWrite(@"result.json", @{@"complete": @YES, @"pass": @NO, @"error": @"missing or unsafe private fixture origin"});
        } else if ([stage isEqual:@"basic"]) TPBasic(outer, control);
        else TPRestart(outer, control, [stage isEqual:@"resume"]);
        dispatch_async(dispatch_get_main_queue(), ^{ self.label.text = [stage isEqual:@"hold"] ? @"재실행 시험 준비 중\n기존 여행색칠의 자료는 사용하지 않습니다." : @"통신 시험을 마쳤습니다.\n결과를 Mac에서 확인하고 있습니다."; });
        if (![stage isEqual:@"hold"]) { [outer invalidateAndCancel]; [control invalidateAndCancel]; dispatch_async(dispatch_get_main_queue(), ^{ application.idleTimerDisabled = NO; }); }
    });
    return YES;
}
@end
int main(int argc, char **argv) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(TPAppDelegate.class)); } }
