#import <React/RCTBridgeModule.h>
#import "TripPainting-Swift.h"

@interface TripPaintingOfflineMaps : NSObject <RCTBridgeModule>
@end

@implementation TripPaintingOfflineMaps

RCT_EXPORT_MODULE()

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isCacheOnly) {
  return @([TripPaintingMapBootstrap isCacheOnly]);
}

RCT_REMAP_METHOD(validateDownloadScope,
                 validateDownloadScope:(NSString *)scopeJSON
                 styleJSON:(NSString *)styleJSON
                 metadataJSON:(NSString *)metadataJSON
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@(scopeJSON && styleJSON && metadataJSON &&
            [TripPaintingMapBootstrap validateDownloadScope:scopeJSON styleJSON:styleJSON metadataJSON:metadataJSON]));
}

RCT_REMAP_METHOD(registerPreparedStyle,
                 registerPreparedStyle:(NSString *)scopeJSON
                 styleJSON:(NSString *)styleJSON
                 metadataJSON:(NSString *)metadataJSON
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(scopeJSON && styleJSON && metadataJSON ?
            [TripPaintingMapBootstrap registerPreparedStyle:scopeJSON styleJSON:styleJSON metadataJSON:metadataJSON] : nil);
}

@end
