#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Fixture signals only, not production authentication. The controller must also
// check its current native state, and the host must independently check the server.
// This object never opens a URL or performs a transport/SDK action itself.
@interface TPFixtureActionGate : NSObject
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
- (nullable instancetype)initWithRunID:(NSString *)runID
                   processIdentifier:(NSInteger)processIdentifier
                         cancelNonce:(NSString *)cancelNonce
                         reloadNonce:(NSString *)reloadNonce;
// Exact canonical URL + phase10(cancel), then phase12(reload), once each.
- (BOOL)acceptURL:(NSURL *)url phase:(NSUInteger)phase;
@property (nonatomic, readonly) NSUInteger lastAcceptedSequence;
@end

NS_ASSUME_NONNULL_END
