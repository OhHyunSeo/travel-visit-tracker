#import <Foundation/Foundation.h>

@interface TPRNBootstrap : NSObject
+ (BOOL)prepare;
+ (NSDictionary *)initialProperties;
+ (void)observe;
@end
