#import <Foundation/Foundation.h>

@interface TPTransport : NSURLProtocol <NSURLSessionDataDelegate>
+ (BOOL)configureOrigin:(NSString *)origin ledgerURL:(NSURL *)ledgerURL maxRequests:(NSUInteger)requests maxTiles:(NSUInteger)tiles maxReservedBytes:(NSUInteger)bytes;
+ (NSDictionary *)snapshot;
+ (BOOL)safeOrigin:(NSString *)origin;
@end
