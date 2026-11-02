#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Controlled HTTP/1.1 fixture experiment, not a general HTTP client or provider adapter.
// All methods and callbacks run on the supplied serial queue.
@interface TPHTTPExchange : NSObject
@property (nonatomic, readonly) NSUInteger requestSendCount;
@property (nonatomic, readonly) NSUInteger receivedHTTPBytes;
@property (nonatomic, readonly) BOOL trustAccepted;
@property (nonatomic, readonly) BOOL chainTrusted;
@property (nonatomic, readonly) NSString *negotiatedProtocol;
- (instancetype)initWithURL:(NSURL *)url
                      queue:(dispatch_queue_t)queue
                    timeout:(NSTimeInterval)timeout
                 completion:(void (^)(NSHTTPURLResponse * _Nullable, NSData * _Nullable, NSError * _Nullable))completion;
// Loopback-only opt-in TLS probe. The supplied DER leaf is trusted only for this
// exchange; no system trust changes, public origins or HTTP/2 implementation.
- (instancetype)initWithURL:(NSURL *)url
                      queue:(dispatch_queue_t)queue
                    timeout:(NSTimeInterval)timeout
         fixtureCertificate:(NSData *)certificate
                 completion:(void (^)(NSHTTPURLResponse * _Nullable, NSData * _Nullable, NSError * _Nullable))completion;
- (void)start;
- (void)cancel;
@end

NS_ASSUME_NONNULL_END
