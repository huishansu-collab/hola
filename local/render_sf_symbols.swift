import AppKit
let mapping = ["Download":"arrow.down.to.line","FolderOpen":"folder","NewCase":"doc.badge.plus","Folder":"folder","Document":"doc.text","Plus":"plus","Code":"curlybraces","Play":"play.fill","Pause":"pause.fill","SkipBack":"backward.end.fill","ZoomIn":"plus.magnifyingglass","ZoomOut":"minus.magnifyingglass","ScanLine":"arrow.left.and.right.righttriangle.left.righttriangle.right","MousePointer2":"cursorarrow","ChevronRight":"chevron.right","AudioLines":"waveform","SlidersHorizontal":"slider.horizontal.3","Flag":"flag","X":"xmark","Crosshair":"scope","Brackets":"viewfinder","Clock3":"clock","PanelLeftClose":"sidebar.left","PanelLeftOpen":"sidebar.left","Check":"checkmark","ArrowRight":"arrow.right","Info":"info.circle"]
var out:[String:String]=[:]
for (key,name) in mapping {
 guard let image=NSImage(systemSymbolName:name,accessibilityDescription:nil)?.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize:32,weight:.light)) else {fatalError(name)}
 let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:96,pixelsHigh:96,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
 let ratio=min(84/image.size.width,84/image.size.height)
 image.draw(in:NSRect(x:(96-image.size.width*ratio)/2,y:(96-image.size.height*ratio)/2,width:image.size.width*ratio,height:image.size.height*ratio))
 NSGraphicsContext.restoreGraphicsState()
 out[key]="data:image/png;base64,"+bitmap.representation(using:.png,properties:[:])!.base64EncodedString()
}
let data=try! JSONSerialization.data(withJSONObject:out,options:[.sortedKeys])
try! data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
