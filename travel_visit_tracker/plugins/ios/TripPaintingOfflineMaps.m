#import <React/RCTBridgeModule.h>
#import "TripPainting-Swift.h"

@interface TripPaintingOfflineMaps : NSObject <RCTBridgeModule>
@end

@implementation TripPaintingOfflineMaps

RCT_EXPORT_MODULE()

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isCacheOnly) {
  return @([TripPaintingMapBootstrap isCacheOnly]);
}

@end
