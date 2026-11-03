#import "TPFixtureActionGate.h"
#import <limits.h>

static BOOL TPActionRunID(id value) {
    if (![value isKindOfClass:NSString.class] || ![value length] || [value length] > 64) return NO;
    for (NSUInteger i = 0; i < [value length]; i++) {
        unichar c = [value characterAtIndex:i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return NO;
    }
    return YES;
}
static BOOL TPActionNonce(id value) {
    if (![value isKindOfClass:NSString.class] || [value length] != 64) return NO;
    for (NSUInteger i = 0; i < 64; i++) {
        unichar c = [value characterAtIndex:i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return NO;
    }
    return YES;
}

@interface TPFixtureActionGate ()
@property (copy) NSString *cancelURL, *reloadURL;
@property NSUInteger acceptedSequence;
@end

@implementation TPFixtureActionGate
- (instancetype)initWithRunID:(NSString *)runID processIdentifier:(NSInteger)processIdentifier cancelNonce:(NSString *)cancelNonce reloadNonce:(NSString *)reloadNonce {
    if (!(self = [super init])) return nil;
    if (!TPActionRunID(runID) || processIdentifier < 1 || processIdentifier > INT_MAX
        || !TPActionNonce(cancelNonce) || !TPActionNonce(reloadNonce) || [cancelNonce isEqual:reloadNonce]) return nil;
    // All interpolated values have a narrow ASCII alphabet; no URL decoding,
    // query aliases, duplicate fields or parameter reordering is accepted.
    self.cancelURL = [NSString stringWithFormat:@"trippainting-map-qa-control://cancel?runID=%@&pid=%ld&nonce=%@", runID, (long)processIdentifier, cancelNonce];
    self.reloadURL = [NSString stringWithFormat:@"trippainting-map-qa-control://reload?runID=%@&pid=%ld&nonce=%@", runID, (long)processIdentifier, reloadNonce];
    return self;
}
- (BOOL)acceptURL:(NSURL *)url phase:(NSUInteger)phase {
    if (![url isKindOfClass:NSURL.class]) return NO;
    NSString *actual = [url.absoluteString copy];
    if (!actual.length || actual.length > 512) return NO;
    @synchronized(self) {
        if (self.acceptedSequence == 0 && phase == 10 && [actual isEqual:self.cancelURL]) {
            self.acceptedSequence = 1; return YES;
        }
        if (self.acceptedSequence == 1 && phase == 12 && [actual isEqual:self.reloadURL]) {
            self.acceptedSequence = 2; return YES;
        }
        return NO;
    }
}
- (NSUInteger)lastAcceptedSequence { @synchronized(self) { return self.acceptedSequence; } }
@end
