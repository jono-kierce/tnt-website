// Cut a player out of a match photo — macOS's own "lift subject" model (the
// one Photos uses), so no download and no account. Writes a transparent PNG
// the full size of the source, ready to crop and centre for a poster (see
// "Cutouts" in graphics/README.md).
//
//   clang -fobjc-arc -O2 graphics/scripts/cutout.m -o /tmp/cutout \
//     -framework Foundation -framework Vision -framework CoreImage \
//     -framework CoreVideo -framework CoreGraphics
//   /tmp/cutout "~/Documents/TNT/TNT Media/S5 Photos/r6/DSC06724.JPG" out.png [instances]
//
// It prints each subject it found with its bounding box. `instances` is a
// comma-separated list (e.g. "1" or "1,3") when the frame has a second person
// in it you don't want; default all. macOS 14+ at runtime. The API is declared
// below by hand because the Command Line Tools SDK can predate it.

#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>

// Runtime-only API (macOS 14+), declared here because the SDK predates it.
@protocol InstanceObs
@property (readonly) NSIndexSet *allInstances;
- (CVPixelBufferRef)generateMaskedImageOfInstances:(NSIndexSet *)i fromRequestHandler:(VNImageRequestHandler *)h croppedToInstancesExtent:(BOOL)c error:(NSError **)e;
- (CVPixelBufferRef)generateScaledMaskForImageForInstances:(NSIndexSet *)i fromRequestHandler:(VNImageRequestHandler *)h error:(NSError **)e;
@end

int main(int argc, const char **argv) {
  @autoreleasepool {
    NSURL *inURL = [NSURL fileURLWithPath:@(argv[1])];
    NSURL *outURL = [NSURL fileURLWithPath:@(argv[2])];
    NSString *pick = argc > 3 ? @(argv[3]) : @"all";
    CIImage *ci = [CIImage imageWithContentsOfURL:inURL options:@{kCIImageApplyOrientationProperty: @YES}];
    CIContext *ctx = [CIContext context];
    CGImageRef cg = [ctx createCGImage:ci fromRect:ci.extent];
    Class R = NSClassFromString(@"VNGenerateForegroundInstanceMaskRequest");
    if (!R) { fprintf(stderr, "no API\n"); return 1; }
    VNRequest *req = [[R alloc] init];
    VNImageRequestHandler *h = [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
    NSError *err = nil;
    if (![h performRequests:@[req] error:&err]) { NSLog(@"%@", err); return 1; }
    id<InstanceObs> obs = (id<InstanceObs>)req.results.firstObject;
    if (!obs) { fprintf(stderr, "no subject\n"); return 2; }
    NSIndexSet *all = obs.allInstances;
    printf("size %.0fx%.0f instances:", ci.extent.size.width, ci.extent.size.height);
    [all enumerateIndexesUsingBlock:^(NSUInteger i, BOOL *s){ printf(" %lu", i); }]; printf("\n");
    // per-instance bbox, from the scaled mask
    [all enumerateIndexesUsingBlock:^(NSUInteger i, BOOL *s){
      CVPixelBufferRef m = [obs generateScaledMaskForImageForInstances:[NSIndexSet indexSetWithIndex:i] fromRequestHandler:h error:nil];
      CVPixelBufferLockBaseAddress(m, 0);
      size_t w = CVPixelBufferGetWidth(m), hh = CVPixelBufferGetHeight(m), bpr = CVPixelBufferGetBytesPerRow(m);
      OSType fmt = CVPixelBufferGetPixelFormatType(m);
      uint8_t *base = CVPixelBufferGetBaseAddress(m);
      long x0=w,y0=hh,x1=-1,y1=-1, n=0;
      for (size_t y=0;y<hh;y+=2) for (size_t x=0;x<w;x+=2) {
        float v = fmt == kCVPixelFormatType_OneComponent32Float ? ((float*)(base+y*bpr))[x] : base[y*bpr+x]/255.0;
        if (v>0.5){ n++; if((long)x<x0)x0=x; if((long)x>x1)x1=x; if((long)y<y0)y0=y; if((long)y>y1)y1=y; }
      }
      CVPixelBufferUnlockBaseAddress(m, 0);
      printf("  #%lu bbox x %ld-%ld y %ld-%ld (of %zux%zu) area %ld\n", i, x0, x1, y0, y1, w, hh, n*4);
    }];
    NSMutableIndexSet *set = [NSMutableIndexSet indexSet];
    if ([pick isEqualToString:@"all"]) [set addIndexes:all];
    else for (NSString *p in [pick componentsSeparatedByString:@","]) [set addIndex:p.integerValue];
    CVPixelBufferRef buf = [obs generateMaskedImageOfInstances:set fromRequestHandler:h croppedToInstancesExtent:NO error:&err];
    if (!buf) { NSLog(@"%@", err); return 1; }
    CIImage *out = [CIImage imageWithCVPixelBuffer:buf];
    CGColorSpaceRef cs = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (![ctx writePNGRepresentationOfImage:out toURL:outURL format:kCIFormatRGBA8 colorSpace:cs options:@{} error:&err]) { NSLog(@"%@", err); return 1; }
  }
  return 0;
}
