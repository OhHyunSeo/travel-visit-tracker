#import <Foundation/Foundation.h>

@interface TPTransport : NSURLProtocol
// NO leaves the entire previous configuration/counters/queue unchanged; callers
// must honor rejection. Existing ledger reads are bounded to 64KiB regular files.
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes;
// Opt-in pinned loopback TLS uses the same persistent reservations and permits.
// This fixture path is not enabled for SDK/product or public-provider traffic.
+ (BOOL)configureFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate;
// Explicit private QA origin + immutable DER, never inferred from a request.
+ (BOOL)configurePrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes certificate:(NSData *)certificate;
// Fixed budget and exact resource paths for the separate mixed QA style.
+ (BOOL)configureMixedPrivateFixtureTLSOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL certificate:(NSData *)certificate;
+ (BOOL)safePrivateFixtureTLSOrigin:(NSString *)origin;
+ (NSData *)fixtureCertificateFromBase64:(NSString *)encoded;
+ (NSDictionary *)snapshot;
+ (BOOL)safeOrigin:(NSString *)origin;
@end
