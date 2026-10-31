#import "TPHTTPExchange.h"
#import <Network/Network.h>
#import <arpa/inet.h>
#import <math.h>

static const NSUInteger TPHeaderLimit = 8192, TPBodyLimit = 256;

@interface TPHTTPExchange ()
@property NSURL *url;
@property dispatch_queue_t queue;
@property nw_connection_t connection;
@property dispatch_source_t timer;
@property NSTimeInterval timeout;
@property (copy) void (^completion)(NSHTTPURLResponse *, NSData *, NSError *);
@property NSMutableData *header, *body;
@property NSHTTPURLResponse *response;
@property NSError *failure;
@property NSUInteger contentLength, requestSendCount, receivedHTTPBytes;
@property BOOL started, finishing, completed;
@end

@implementation TPHTTPExchange
- (instancetype)initWithURL:(NSURL *)url queue:(dispatch_queue_t)queue timeout:(NSTimeInterval)timeout completion:(void (^)(NSHTTPURLResponse *, NSData *, NSError *))completion {
    if ((self = [super init])) {
        _url = url; _queue = queue; _timeout = timeout; _completion = [completion copy];
        _header = [NSMutableData new]; _body = [NSMutableData new];
    }
    return self;
}
- (void)deliver {
    if (self.completed) return;
    self.completed = YES;
    if (self.timer) { dispatch_source_cancel(self.timer); self.timer = nil; }
    void (^completion)(NSHTTPURLResponse *, NSData *, NSError *) = self.completion;
    self.completion = nil;
    if (completion) completion(self.failure ? nil : self.response, self.failure ? nil : [self.body copy], self.failure);
    self.connection = nil;
}
- (void)finish:(NSInteger)code {
    if (self.finishing) return;
    self.finishing = YES;
    if (code) self.failure = [NSError errorWithDomain:@"MapTransportSingleExchange" code:code userInfo:nil];
    // Keep the caller's global permit until Network reports this connection cancelled.
    if (self.connection) nw_connection_cancel(self.connection);
    else [self deliver];
}
- (BOOL)validURL {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.url resolvingAgainstBaseURL:NO];
    struct in_addr address;
    if (![parts.scheme isEqual:@"http"] || !parts.port || parts.port.integerValue < 1 || parts.port.integerValue > 65535 || parts.user || parts.password || parts.fragment || inet_pton(AF_INET, parts.host.UTF8String, &address) != 1) return NO;
    uint32_t ip = ntohl(address.s_addr);
    if ((ip >> 24) != 127 && (ip >> 24) != 10 && (ip >> 20) != 0xac1 && (ip >> 16) != 0xc0a8) return NO;
    NSString *target = [self requestTarget];
    NSData *bytes = [target dataUsingEncoding:NSASCIIStringEncoding allowLossyConversion:NO];
    if (!bytes || ![target hasPrefix:@"/resource/"] || bytes.length > 1024) return NO;
    const uint8_t *p = bytes.bytes;
    for (NSUInteger i = 0; i < bytes.length; i++) if (p[i] <= 32 || p[i] >= 127) return NO;
    return isfinite(self.timeout) && self.timeout >= 0.05 && self.timeout <= 30;
}
- (NSString *)requestTarget {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:self.url resolvingAgainstBaseURL:NO];
    return parts.percentEncodedQuery ? [NSString stringWithFormat:@"%@?%@", parts.percentEncodedPath, parts.percentEncodedQuery] : parts.percentEncodedPath;
}
- (void)start {
    if (self.started || self.finishing) return;
    self.started = YES;
    if (![self validURL]) { [self finish:1]; return; }
    nw_parameters_t parameters = nw_parameters_create_secure_tcp(NW_PARAMETERS_DISABLE_PROTOCOL, NW_PARAMETERS_DEFAULT_CONFIGURATION);
    nw_endpoint_t endpoint = nw_endpoint_create_host(self.url.host.UTF8String, self.url.port.stringValue.UTF8String);
    self.connection = nw_connection_create(endpoint, parameters);
    nw_connection_set_queue(self.connection, self.queue);
    nw_connection_set_state_changed_handler(self.connection, ^(nw_connection_state_t state, nw_error_t error) {
        if (state == nw_connection_state_cancelled) { [self deliver]; return; }
        if (self.finishing) return;
        if (state == nw_connection_state_ready) [self sendOnce];
        else if (state == nw_connection_state_failed || state == nw_connection_state_waiting) [self finish:2];
    });
    self.timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, self.queue);
    dispatch_source_set_timer(self.timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(self.timeout * NSEC_PER_SEC)), DISPATCH_TIME_FOREVER, NSEC_PER_MSEC);
    dispatch_source_set_event_handler(self.timer, ^{ [self finish:3]; });
    dispatch_resume(self.timer);
    nw_connection_start(self.connection);
}
- (void)sendOnce {
    if (self.requestSendCount || self.finishing) return;
    self.requestSendCount++;
    // A fresh TCP connection, one write, no HTTP retry/auth/redirect implementation.
    // Never use NW_CONNECTION_SEND_IDEMPOTENT_CONTENT, restart(), or a reused connection.
    NSString *text = [NSString stringWithFormat:@"GET %@ HTTP/1.1\r\nHost: %@:%@\r\nUser-Agent: TripPaintingMapTransportQA/1.0\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n", [self requestTarget], self.url.host, self.url.port];
    NSData *bytes = [text dataUsingEncoding:NSASCIIStringEncoding];
    dispatch_data_t data = dispatch_data_create(bytes.bytes, bytes.length, self.queue, ^{ (void)bytes; });
    nw_connection_send(self.connection, data, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true, ^(nw_error_t error) {
        if (self.finishing) return;
        if (error) [self finish:4];
        else [self receive];
    });
}
- (BOOL)parseHeader {
    NSString *text = [[NSString alloc] initWithData:self.header encoding:NSASCIIStringEncoding];
    if (!text) return NO;
    NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\r\n"];
    if (![lines.firstObject hasPrefix:@"HTTP/1.1 200 "] || lines.count < 4) return NO;
    for (NSUInteger i = 0; i < lines.firstObject.length; i++) {
        unichar c = [lines.firstObject characterAtIndex:i];
        if (c < 32 || c >= 127) return NO;
    }
    NSMutableDictionary *fields = [NSMutableDictionary new];
    NSCharacterSet *fieldCharacters = [NSCharacterSet characterSetWithCharactersInString:@"!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyz"].invertedSet;
    for (NSUInteger i = 1; i + 2 < lines.count; i++) {
        NSString *line = lines[i];
        NSRange colon = [line rangeOfString:@":"];
        if (colon.location == NSNotFound || colon.location == 0) return NO;
        NSString *name = [[line substringToIndex:colon.location] lowercaseString];
        NSString *value = [[line substringFromIndex:colon.location + 1] stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" \t"]];
        if ([name rangeOfCharacterFromSet:fieldCharacters].location != NSNotFound || fields[name]) return NO;
        for (NSUInteger j = 0; j < value.length; j++) if (([value characterAtIndex:j] < 32 && [value characterAtIndex:j] != '\t') || [value characterAtIndex:j] == 127) return NO;
        fields[name] = value;
    }
    NSString *length = fields[@"content-length"];
    if (!length.length || length.length > 3 || [length rangeOfCharacterFromSet:[NSCharacterSet decimalDigitCharacterSet].invertedSet].location != NSNotFound) return NO;
    NSUInteger number = length.integerValue;
    if (number > TPBodyLimit || ![length isEqual:[NSString stringWithFormat:@"%lu", (unsigned long)number]] || fields[@"transfer-encoding"] || (fields[@"content-encoding"] && [fields[@"content-encoding"] caseInsensitiveCompare:@"identity"] != NSOrderedSame)) return NO;
    self.contentLength = number;
    self.response = [[NSHTTPURLResponse alloc] initWithURL:self.url statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:fields];
    return self.response != nil;
}
- (void)consume:(const uint8_t *)bytes length:(NSUInteger)length {
    NSUInteger i = 0;
    while (!self.response && i < length) {
        [self.header appendBytes:bytes + i length:1]; i++;
        if (self.header.length > TPHeaderLimit) { [self finish:5]; return; }
        const uint8_t *h = self.header.bytes;
        NSUInteger n = self.header.length;
        if (n >= 4 && !memcmp(h + n - 4, "\r\n\r\n", 4)) {
            if (![self parseHeader]) { [self finish:6]; return; }
        }
    }
    if (self.response && i < length) {
        if (length - i > self.contentLength - self.body.length) { [self finish:7]; return; }
        [self.body appendBytes:bytes + i length:length - i];
    }
    // Wait for EOF after the declared body to reject extra bytes and late tails.
}
- (void)receive {
    if (self.finishing) return;
    nw_connection_receive(self.connection, 1, 1024, ^(dispatch_data_t data, nw_content_context_t context, bool complete, nw_error_t error) {
        if (self.finishing) return;
        if (data) dispatch_data_apply(data, ^bool(dispatch_data_t region, size_t offset, const void *buffer, size_t size) {
            self.receivedHTTPBytes += size;
            [self consume:buffer length:size];
            return !self.finishing;
        });
        if (self.finishing) return;
        if (error) [self finish:8];
        else if (complete) [self finish:self.response && self.body.length == self.contentLength ? 0 : 9];
        else [self receive];
    });
}
- (void)cancel { [self finish:10]; }
@end
