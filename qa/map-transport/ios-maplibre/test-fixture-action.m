#import <Foundation/Foundation.h>
#import <CoreFoundation/CoreFoundation.h>
#import "TPFixtureActionGate.h"

static BOOL Integer(id value) {
    return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID()
        && !CFNumberIsFloatType((__bridge CFNumberRef)value);
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSData *data = [[NSString stringWithUTF8String:argv[1]] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *input = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        id run = input[@"runID"], cancel = input[@"cancelNonce"], reload = input[@"reloadNonce"];
        BOOL mutate = [input[@"mutateInputsAfterInit"] isEqual:@YES];
        if (mutate) { run = [run mutableCopy]; cancel = [cancel mutableCopy]; reload = [reload mutableCopy]; }
        TPFixtureActionGate *gate;
        if (Integer(input[@"pid"])) gate = [[TPFixtureActionGate alloc] initWithRunID:run processIdentifier:[input[@"pid"] integerValue] cancelNonce:cancel reloadNonce:reload];
        if (mutate) { [run appendString:@"_changed"]; [cancel setString:@"changed"]; [reload setString:@"changed"]; }
        NSMutableArray *steps = [NSMutableArray new];
        for (NSDictionary *step in input[@"steps"]) {
            id raw = step[@"url"];
            NSURL *url = [raw isKindOfClass:NSString.class] ? [NSURL URLWithString:raw] : nil;
            BOOL accepted = Integer(step[@"phase"]) && [step[@"phase"] integerValue] >= 0 && [gate acceptURL:url phase:[step[@"phase"] unsignedIntegerValue]];
            [steps addObject:@{@"accepted": @(accepted), @"sequence": @(gate.lastAcceptedSequence)}];
        }
        BOOL configured = gate != nil;
        NSDictionary *result = @{@"configured": @(configured), @"steps": steps, @"sequence": @(gate.lastAcceptedSequence)};
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:nil];
        fwrite(json.bytes, 1, json.length, stdout); fputc('\n', stdout);
        return 0;
    }
}
