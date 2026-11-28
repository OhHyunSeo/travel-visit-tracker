#import <Foundation/Foundation.h>
#import "TPTransport.h"

// Host-only configuration/file driver. It creates no session, task or exchange.
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSData *input = [[NSString stringWithUTF8String:argv[1]] dataUsingEncoding:NSUTF8StringEncoding];
        id configurations = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
        if (![configurations isKindOfClass:NSArray.class]) return 2;
        NSMutableArray *results = [NSMutableArray new];
        for (NSDictionary *config in configurations) {
            NSDictionary *before = TPTransport.snapshot;
            NSURL *url = [NSURL URLWithString:config[@"url"]];
            NSUInteger requests = [config[@"requests"] unsignedLongLongValue];
            NSUInteger tiles = [config[@"tiles"] unsignedLongLongValue];
            NSUInteger bytes = [config[@"bytes"] unsignedLongLongValue];
            NSData *certificate = [TPTransport fixtureCertificateFromBase64:config[@"certificate"]];
            BOOL accepted;
            if ([config[@"mode"] isEqual:@"tls"]) accepted = [TPTransport configureFixtureTLSOrigin:config[@"origin"] ledgerURL:url maxRequests:requests maxTiles:tiles maxReservedBytes:bytes certificate:certificate];
            else if ([config[@"mode"] isEqual:@"private-tls"]) accepted = [TPTransport configurePrivateFixtureTLSOrigin:config[@"origin"] ledgerURL:url maxRequests:requests maxTiles:tiles maxReservedBytes:bytes certificate:certificate];
            else accepted = [TPTransport configureOrigin:config[@"origin"] ledgerURL:url maxRequests:requests maxTiles:tiles maxReservedBytes:bytes];
            [results addObject:@{@"configured": @(accepted), @"before": before, @"after": TPTransport.snapshot}];
        }
        NSData *output = [NSJSONSerialization dataWithJSONObject:results options:NSJSONWritingSortedKeys error:nil];
        fwrite(output.bytes, 1, output.length, stdout); fputc('\n', stdout);
        return 0;
    }
}
